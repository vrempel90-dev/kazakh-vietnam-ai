/**
 * Publication orchestrator.
 *
 * One entry point owns the whole decision chain: is this environment allowed
 * to publish, is a window open, has this channel already had its package for
 * that window, which country digests actually changed, and what must be sent,
 * edited, skipped or held back.
 *
 * Every Telegram call is bracketed by a durable state write, so a crash or a
 * restart can never turn into a duplicate post.
 */

import { randomUUID } from "node:crypto";
import { buildCountryDigests, TELEGRAM_TEXT_LIMIT } from "./telegram-digest.mjs";
import { resolvePublicationWindow, windowKey, describeSchedule } from "./telegram-schedule.mjs";
import {
  TelegramApiError,
  editDigestMessage,
  filterFlightsForTarget,
  isPublishingEnvironmentAllowed,
  parsePublishTargets,
  sendDigestMessage
} from "./telegram-publisher.mjs";
import {
  WINDOW_STATUS,
  acquireRunLease,
  acquireRunLock,
  releaseRunLock,
  beginWindowRun,
  finishWindowRun,
  initializePublicationState,
  isWindowCompleted,
  loadPublicationState,
  markOffersPublished,
  planMessageAction,
  prunePublicationState,
  recordMessageFailure,
  recordMessageIntent,
  recordMessageSent,
  releaseRunLease,
  savePublicationState
} from "./telegram-publication-state.mjs";

const DEFAULT_STATE_PATH = "/data/telegram-publications.json";

function envNumber(env, name, fallback) {
  const raw = env?.[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : fallback;
}

function sleep(ms) {
  return ms > 0 ? new Promise(done => setTimeout(done, ms)) : Promise.resolve();
}

function emptyCounts() {
  return { sent: 0, edited: 0, skipped: 0, held: 0, failed: 0, deferred: 0 };
}

/**
 * @param {object} options
 * @param {Array} options.flights  validated, publishable offers
 * @param {boolean} [options.dryRun]  plan everything, touch neither Telegram nor state
 * @param {string[]} [options.targets]  overrides TELEGRAM_PUBLISH_CHATS (test chat)
 * @param {boolean} [options.ignoreWindow]  only for an explicit test-chat delivery
 */
export async function runTelegramPublication({
  flights = [],
  now = new Date(),
  env = process.env,
  statePath = env?.TELEGRAM_PUBLISH_STATE_PATH || DEFAULT_STATE_PATH,
  fetchImpl = fetch,
  reason = "scheduled",
  dryRun = false,
  targets: targetsOverride = null,
  ignoreWindow = false,
  logger = console
} = {}) {
  const timeZone = env?.TELEGRAM_PUBLISH_TIMEZONE || "Asia/Almaty";
  const schedule = resolvePublicationWindow(now, { timeZone });

  const base = {
    reason,
    dryRun,
    schedule: describeSchedule(timeZone),
    window: schedule.window
      ? { ...schedule.window, localDate: schedule.localDate, timeZone }
      : null,
    localDate: schedule.localDate,
    localTime: schedule.localHour == null
      ? null
      : String(schedule.localHour).padStart(2, "0") + ":" + String(schedule.localMinute).padStart(2, "0"),
    channels: [],
    totals: { ...emptyCounts(), countries: 0, offers: 0 },
    diagnostics: []
  };

  if (!flights.length) {
    return { ...base, skipped: true, reason: "NO_PUBLISHABLE_OFFERS" };
  }

  // A redeploy or crash-restart must never fire an unscheduled package; the
  // next scheduled sync inside the window does the work.
  if (reason === "startup" && !ignoreWindow) {
    return { ...base, skipped: true, reason: "STARTUP_RUN_DOES_NOT_PUBLISH" };
  }

  const environment = isPublishingEnvironmentAllowed(env);
  if (!environment.allowed && !dryRun) {
    return { ...base, skipped: true, reason: environment.reason };
  }

  if (!schedule.open && !ignoreWindow) {
    return { ...base, skipped: true, reason: schedule.reason || "OUTSIDE_PUBLICATION_WINDOW" };
  }

  const activeWindow = schedule.window || { id: "manual", kind: "update" };
  const chatIds = Array.isArray(targetsOverride) && targetsOverride.length
    ? parsePublishTargets(targetsOverride.join(","))
    : parsePublishTargets(env?.TELEGRAM_PUBLISH_CHATS);

  if (!chatIds.length) {
    return { ...base, skipped: true, reason: "NO_PUBLISH_CHATS_CONFIGURED" };
  }

  const maxChars = Math.min(
    TELEGRAM_TEXT_LIMIT,
    envNumber(env, "TELEGRAM_MAX_MESSAGE_CHARS", 3900)
  );
  const maxMessagesPerWindow = Math.max(1, envNumber(env, "TELEGRAM_MAX_MESSAGES_PER_WINDOW", 40));
  const postDelayMs = Math.max(0, envNumber(env, "POST_DELAY_SECONDS", 2) * 1000);
  const retentionDays = Math.max(1, envNumber(env, "TELEGRAM_PUBLICATION_RETENTION_DAYS", 30));
  const retryUnconfirmed =
    String(env?.TELEGRAM_RETRY_UNCONFIRMED || "").toLowerCase() === "true";
  const token = String(env?.TELEGRAM_BOT_TOKEN || "").trim();
  const managerPhone = env?.VITE_MANAGER_WHATSAPP || "";
  const publicAppUrl = env?.PUBLIC_APP_URL || env?.RAILWAY_PUBLIC_DOMAIN || "";
  // Unique per run, not per process: two runs in one process must still
  // contend for the lease.
  const leaseOwner = [
    String(env?.RAILWAY_DEPLOYMENT_ID || "local"),
    process.pid,
    randomUUID().slice(0, 8)
  ].join(":");

  // The lock is taken before the state is read, so an overlapping run cannot
  // act on a snapshot that is about to change underneath it.
  let lock = null;
  if (!dryRun) {
    lock = await acquireRunLock(statePath, { owner: leaseOwner, now, ttlMinutes: 10 });
    if (!lock.acquired) {
      return {
        ...base,
        skipped: true,
        reason: "ANOTHER_RUN_IN_PROGRESS",
        lease: { heldBy: lock.heldBy, acquiredAt: lock.acquiredAt }
      };
    }
  }

  const state = await loadPublicationState(statePath);
  initializePublicationState(state, now.toISOString());

  if (!dryRun) {
    acquireRunLease(state, { owner: leaseOwner, now, ttlMinutes: 10 });
    state.meta.lastRunAt = now.toISOString();
    await savePublicationState(statePath, state);
  }

  const key = windowKey(schedule.localDate, activeWindow.id);
  const channelReports = [];

  try {
    for (const chatId of chatIds) {
      const report = {
        chatId,
        window: activeWindow.id,
        localDate: schedule.localDate,
        status: "ok",
        counts: emptyCounts(),
        messages: [],
        countries: 0,
        offers: 0,
        coverage: null,
        diagnostics: [],
        error: null
      };

      if (!dryRun && isWindowCompleted(state, chatId, key)) {
        report.status = "skipped";
        report.error = "WINDOW_ALREADY_PUBLISHED";
        channelReports.push(report);
        continue;
      }

      const eligible = filterFlightsForTarget(flights, chatId);
      const { digests, diagnostics, summary } = buildCountryDigests(eligible, { maxChars });

      report.countries = summary.countries;
      report.offers = summary.offers;
      report.diagnostics = diagnostics;
      report.coverage = {
        eligible: eligible.length,
        rendered: summary.offers,
        unclassified: diagnostics.length,
        duplicates: summary.duplicates,
        complete: summary.offers + diagnostics.length + summary.duplicates >= eligible.length
      };

      if (!dryRun) beginWindowRun(state, chatId, key, { now });

      let fatal = null;
      let delivered = 0;

      for (const digest of digests) {
        const plan = planMessageAction(state, chatId, digest, { retryUnconfirmed });
        const entry = {
          key: digest.key,
          country: digest.countryName,
          part: digest.part + "/" + digest.parts,
          offers: digest.offers,
          chars: digest.text.length,
          action: plan.action,
          reason: plan.reason,
          messageId: plan.record?.messageId ?? null,
          error: null
        };

        if (plan.action === "skip") {
          report.counts.skipped += 1;
          report.messages.push(entry);
          continue;
        }

        if (plan.action === "hold") {
          report.counts.held += 1;
          report.messages.push(entry);
          continue;
        }

        if (delivered >= maxMessagesPerWindow) {
          entry.action = "deferred";
          entry.reason = "MESSAGE_BUDGET_REACHED";
          report.counts.deferred += 1;
          report.messages.push(entry);
          continue;
        }

        if (dryRun) {
          entry.action = plan.action === "edit" ? "would_edit" : "would_send";
          report.messages.push(entry);
          continue;
        }

        recordMessageIntent(state, chatId, digest.key, {
          country: digest.country,
          countryName: digest.countryName,
          part: digest.part,
          parts: digest.parts,
          contentHash: digest.contentHash,
          offerIds: digest.offerIds,
          localDate: schedule.localDate,
          window: activeWindow.id,
          action: plan.action,
          messageId: plan.record?.messageId ?? null,
          now
        });
        await savePublicationState(statePath, state);

        try {
          const messageId = await deliver({
            action: plan.action,
            token,
            chatId,
            messageId: plan.record?.messageId,
            text: digest.text,
            managerPhone,
            publicAppUrl,
            fetchImpl
          });

          recordMessageSent(state, chatId, digest.key, { messageId, now: new Date() });
          await savePublicationState(statePath, state);

          const covered = eligible.filter(flight => digest.offerIds.includes(flight.id));
          markOffersPublished(state, chatId, covered, new Date().toISOString());

          entry.messageId = messageId;
          if (plan.action === "edit") report.counts.edited += 1;
          else report.counts.sent += 1;
          delivered += 1;
          report.messages.push(entry);

          if (postDelayMs > 0) await sleep(postDelayMs);
        } catch (error) {
          const apiError = error instanceof TelegramApiError
            ? error
            : new TelegramApiError(String(error?.message || error), { definitive: false });

          recordMessageFailure(state, chatId, digest.key, {
            error: apiError.message,
            definitive: apiError.definitive,
            now: new Date()
          });
          await savePublicationState(statePath, state);

          entry.action = apiError.definitive ? "failed" : "unconfirmed";
          entry.error = apiError.message;
          report.counts.failed += 1;
          report.messages.push(entry);

          if (apiError.fatalForChannel) {
            fatal = apiError.message;
            break;
          }
          if (apiError.retryAfter) await sleep(Math.min(apiError.retryAfter, 60) * 1000);
        }
      }

      if (!dryRun) {
        const incomplete = report.counts.failed > 0
          || report.counts.held > 0
          || report.counts.deferred > 0
          || Boolean(fatal);

        finishWindowRun(state, chatId, key, {
          // A partial window may be retried inside the same window for the
          // failed parts only; a completed one is never touched again.
          status: incomplete ? WINDOW_STATUS.PARTIAL : WINDOW_STATUS.COMPLETED,
          now: new Date(),
          counts: { ...report.counts }
        });
        await savePublicationState(statePath, state);
      }

      if (fatal) {
        report.status = "error";
        report.error = fatal;
      } else if (report.counts.failed || report.counts.held || report.counts.deferred) {
        report.status = "partial";
      }

      channelReports.push(report);
    }
  } finally {
    if (!dryRun) {
      prunePublicationState(state, { now, retentionDays });
      releaseRunLease(state, leaseOwner);
      await savePublicationState(statePath, state);
      await releaseRunLock(statePath, leaseOwner);
    }
  }

  const totals = channelReports.reduce((acc, report) => {
    for (const field of Object.keys(emptyCounts())) acc[field] += report.counts[field];
    acc.countries = Math.max(acc.countries, report.countries);
    acc.offers = Math.max(acc.offers, report.offers);
    return acc;
  }, { ...emptyCounts(), countries: 0, offers: 0 });

  const result = {
    ...base,
    skipped: false,
    reason: null,
    channels: channelReports,
    totals,
    diagnostics: channelReports[0]?.diagnostics || []
  };

  if (logger?.log) {
    logger.log("Telegram publication: " + JSON.stringify({
      window: activeWindow.id,
      localDate: schedule.localDate,
      localTime: result.localTime,
      dryRun,
      totals,
      channels: channelReports.map(report => ({
        chatId: report.chatId,
        status: report.status,
        counts: report.counts,
        coverage: report.coverage
      }))
    }, null, 2));
  }

  return result;
}

async function deliver({
  action,
  token,
  chatId,
  messageId,
  text,
  managerPhone,
  publicAppUrl,
  fetchImpl
}) {
  if (action === "edit" && Number(messageId) > 0) {
    return editDigestMessage({
      token, chatId, messageId, text, managerPhone, publicAppUrl, fetchImpl
    });
  }
  return sendDigestMessage({ token, chatId, text, managerPhone, publicAppUrl, fetchImpl });
}
