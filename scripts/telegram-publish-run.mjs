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
import { buildCountryDigests, FOOTER_TEXT, TELEGRAM_TEXT_LIMIT } from "./telegram-digest.mjs";
import {
  allowedCountryCodes,
  describeSchedule,
  disallowedCountries,
  isCountryAllowedInWindow,
  isPublishableCountry,
  regionForWindow,
  resolvePublicationWindow,
  windowKey
} from "./telegram-schedule.mjs";
import {
  TelegramApiError,
  editDigestMessage,
  filterFlightsForTarget,
  isPublishingEnvironmentAllowed,
  parsePublishTargets,
  sendDigestMessage
} from "./telegram-publisher.mjs";
import {
  MESSAGE_STATUS,
  WINDOW_STATUS,
  acquireRunLease,
  acquireRunLock,
  releaseRunLock,
  beginWindowRun,
  finishWindowRun,
  initializePublicationState,
  isWindowCompleted,
  listMessageRecords,
  loadPublicationState,
  markOffersPublished,
  planMessageAction,
  prunePublicationState,
  publicationHealth,
  recordMessageFailure,
  recordMessageIntent,
  recordMessageRetracted,
  recordMessageSent,
  recordRunTelemetry,
  releaseRunLease,
  savePublicationState
} from "./telegram-publication-state.mjs";

/**
 * Publication outcomes. An edit is never reported as a new publication: that
 * conflation is what let three silent days pass as "ok".
 */
export const PUBLICATION_STATUS = {
  SENT: "PUBLISH_SENT",
  EDITED: "PUBLISH_EDITED",
  PLANNED: "PUBLISH_PLANNED",
  NO_NEW_OFFERS: "NO_NEW_OFFERS",
  BLOCKED: "PUBLISH_BLOCKED",
  FAILED: "PUBLISH_FAILED"
};

const STATUS_RANK = [
  PUBLICATION_STATUS.FAILED,
  PUBLICATION_STATUS.PLANNED,
  PUBLICATION_STATUS.SENT,
  PUBLICATION_STATUS.EDITED,
  PUBLICATION_STATUS.BLOCKED,
  PUBLICATION_STATUS.NO_NEW_OFFERS
];

function channelPublicationStatus(report, fatal, dryRun = false) {
  // A plan is never reported as a delivery.
  if (dryRun) {
    return report.plannedSends > 0 || report.plannedEdits > 0
      ? PUBLICATION_STATUS.PLANNED
      : PUBLICATION_STATUS.NO_NEW_OFFERS;
  }
  if (fatal || report.counts.failed > 0) return PUBLICATION_STATUS.FAILED;
  if (report.counts.sent > 0) return PUBLICATION_STATUS.SENT;
  if (report.counts.edited > 0) return PUBLICATION_STATUS.EDITED;
  if (report.counts.held > 0 || report.counts.deferred > 0) return PUBLICATION_STATUS.BLOCKED;
  if (report.error === "WINDOW_ALREADY_PUBLISHED") return PUBLICATION_STATUS.BLOCKED;
  if (report.counts.skipped > 0) return PUBLICATION_STATUS.NO_NEW_OFFERS;
  if (report.counts.outOfWindow > 0) return PUBLICATION_STATUS.BLOCKED;
  return PUBLICATION_STATUS.NO_NEW_OFFERS;
}

function worstStatus(statuses) {
  for (const status of STATUS_RANK) {
    if (statuses.includes(status)) return status;
  }
  return PUBLICATION_STATUS.NO_NEW_OFFERS;
}

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
  return {
    sent: 0,
    edited: 0,
    skipped: 0,
    held: 0,
    failed: 0,
    deferred: 0,
    outOfWindow: 0,
    retracted: 0
  };
}

/**
 * Replaces the body of a message whose country is no longer allowed. Editing
 * keeps one message id for one digest key, so withdrawing a forbidden post can
 * never create a duplicate.
 */
const RETRACTION_TEXT = "<b>Подборка снята с публикации</b>\n\n"
  + "Эти направления больше не входят в согласованный список. "
  + "Актуальные предложения публикуются в следующих подборках.\n\n"
  + FOOTER_TEXT;

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
    allowedCountries: allowedCountryCodes(),
    window: schedule.window
      ? {
          ...schedule.window,
          region: regionForWindow(schedule.window.id),
          localDate: schedule.localDate,
          timeZone
        }
      : null,
    localDate: schedule.localDate,
    localTime: schedule.localHour == null
      ? null
      : String(schedule.localHour).padStart(2, "0") + ":" + String(schedule.localMinute).padStart(2, "0"),
    channels: [],
    totals: { ...emptyCounts(), countries: 0, offers: 0 },
    publicationStatus: PUBLICATION_STATUS.BLOCKED,
    health: null,
    diagnostics: []
  };

  if (!flights.length) {
    return {
      ...base,
      skipped: true,
      reason: "NO_PUBLISHABLE_OFFERS",
      publicationStatus: PUBLICATION_STATUS.NO_NEW_OFFERS
    };
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
        publicationStatus: PUBLICATION_STATUS.NO_NEW_OFFERS,
        counts: emptyCounts(),
        plannedSends: 0,
        plannedEdits: 0,
        messages: [],
        countries: 0,
        offers: 0,
        coverage: null,
        region: null,
        disallowed: [],
        retractions: [],
        diagnostics: [],
        error: null
      };

      // A completed window is re-entered rather than refused.
      //
      // Collection runs every 15 minutes but a window is 1-2 hours long, and
      // each country now belongs to exactly one window. Refusing the window
      // outright after its first successful run meant everything the later
      // syncs collected was held until the next day - and for a departure
      // today, "the next day" is never. A seat found at 10:35 has to reach the
      // channel in the 10:00-12:00 window or not at all.
      //
      // Nothing about duplicate protection is relaxed by this: the decision to
      // send, edit or skip is made per digest by `planMessageAction`, against
      // the message record's own content hash and publication date. An
      // unchanged country is still skipped, a changed one is still edited in
      // place, and a digest key that already has a confirmed message for today
      // still never gets a second post.
      report.windowAlreadyPublished = !dryRun && isWindowCompleted(state, chatId, key);

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

      // One region owns one window. A country outside this window's region is
      // not an error and not a loss: its own window publishes it the same day.
      const regionDecisions = digests.map(digest => ({
        digest,
        decision: isCountryAllowedInWindow(digest.country, activeWindow.id)
      }));
      const publishable = regionDecisions.filter(item => item.decision.allowed);

      report.region = regionForWindow(activeWindow.id);
      report.disallowed = disallowedCountries(digests.map(digest => digest.country));

      // Runs before the "nothing to publish" exit below on purpose: when every
      // country a channel carried has become forbidden there are no publishable
      // digests at all, and that is precisely when the forbidden posts still
      // standing in the channel most need withdrawing.
      report.retractions = await retractForbiddenMessages({
        state,
        statePath,
        chatId,
        localDate: schedule.localDate,
        dryRun,
        token,
        managerPhone,
        publicAppUrl,
        fetchImpl,
        counts: report.counts
      });

      for (const { digest, decision } of regionDecisions) {
        if (decision.allowed) continue;
        report.counts.outOfWindow += 1;
        report.messages.push({
          key: digest.key,
          country: digest.countryName,
          part: digest.part + "/" + digest.parts,
          offers: digest.offers,
          chars: digest.text.length,
          action: "out_of_region_window",
          reason: decision.reason,
          messageId: null,
          error: null
        });
      }

      // An empty region produces no message at all, and must not burn the
      // window: a later 15-minute sync inside the same window can still
      // publish once the collector brings offers in.
      if (!publishable.length) {
        report.status = "ok";
        report.error = report.counts.outOfWindow
          ? "NO_OFFERS_FOR_WINDOW_REGION"
          : "NO_PUBLISHABLE_DIGESTS";
        report.publicationStatus = report.counts.outOfWindow
          ? PUBLICATION_STATUS.BLOCKED
          : PUBLICATION_STATUS.NO_NEW_OFFERS;
        channelReports.push(report);
        continue;
      }

      if (!dryRun) beginWindowRun(state, chatId, key, { now });

      let fatal = null;
      let delivered = 0;


      for (const { digest } of publishable) {
        const plan = planMessageAction(state, chatId, digest, {
          retryUnconfirmed,
          localDate: schedule.localDate
        });
        // Only an edit reuses an existing message id; a send must never carry
        // the previous day's id into its intent record or its report line.
        const liveMessageId = plan.action === "edit" ? (plan.record?.messageId ?? null) : null;
        // The honest expectation signal: a post the publisher meant to create.
        if (plan.action === "send") report.plannedSends += 1;
        if (plan.action === "edit") report.plannedEdits += 1;
        const entry = {
          key: digest.key,
          country: digest.countryName,
          part: digest.part + "/" + digest.parts,
          offers: digest.offers,
          chars: digest.text.length,
          action: plan.action,
          reason: plan.reason,
          messageId: liveMessageId,
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
            messageId: liveMessageId,
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

      report.publicationStatus = channelPublicationStatus(report, fatal, dryRun);
      channelReports.push(report);
    }
  } finally {
    if (!dryRun) {
      recordRunTelemetry(state, {
        // The run's own clock, the same one the schedule resolved: telemetry
        // and the staleness verdict must never be read against two clocks.
        now,
        window: activeWindow.id,
        region: regionForWindow(activeWindow.id)?.id || null,
        localDate: schedule.localDate,
        channels: channelReports
      });
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
    publicationStatus: worstStatus(channelReports.map(report => report.publicationStatus)),
    health: publicationHealth(state, {
      now,
      maxSilenceHours: envNumber(env, "TELEGRAM_NO_POST_ALERT_HOURS", 26)
    }),
    diagnostics: channelReports[0]?.diagnostics || []
  };

  if (logger?.log) {
    // One line per run: Railway drops messages past 500 log lines per second,
    // and a multi-line dump makes the publisher's own diagnostics unfilterable.
    logger.log("Telegram publication: " + JSON.stringify({
      status: result.publicationStatus,
      window: activeWindow.id,
      region: regionForWindow(activeWindow.id)?.id || null,
      localDate: schedule.localDate,
      localTime: result.localTime,
      dryRun,
      totals,
      health: {
        stale: result.health?.stale ?? null,
        reason: result.health?.reason ?? null,
        lastNewPostAt: result.health?.lastNewPostAt ?? null,
        silentHours: result.health?.silentHours ?? null
      },
      channels: channelReports.map(report => ({
        chatId: report.chatId,
        status: report.publicationStatus,
        counts: report.counts,
        coverage: report.coverage,
        messages: report.messages.map(message =>
          message.key + ":" + message.action + (message.messageId ? "#" + message.messageId : "")
        )
      }))
    }));
  }

  return result;
}

/**
 * Withdraws messages whose country is no longer on the allowed list.
 *
 * A country published before the list tightened still has a live message in
 * the channel. Reposting would duplicate it, and this publisher never deletes,
 * so the message is EDITED in place to a withdrawal notice: the forbidden
 * routes stop being readable, the message id and its state record stay exactly
 * as they were, and every duplicate guard is left untouched.
 *
 * Bounded to the current publication day for the same reason editing is - the
 * digest key is only country+part, so an unbounded rewrite would reach back
 * into messages published on earlier days.
 */
async function retractForbiddenMessages({
  state,
  statePath,
  chatId,
  localDate,
  dryRun,
  token,
  managerPhone,
  publicAppUrl,
  fetchImpl,
  counts
}) {
  const retractions = [];

  for (const record of listMessageRecords(state, chatId)) {
    if (isPublishableCountry(record.country)) continue;
    if (String(record.localDate || "") !== String(localDate)) continue;
    if (record.status !== MESSAGE_STATUS.SENT) continue;
    if (record.retractedAt) continue;

    const messageId = Number(record.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) continue;

    const entry = {
      key: record.key,
      country: record.countryName || record.country || null,
      action: dryRun ? "would_retract" : "retracted",
      reason: "COUNTRY_NOT_ALLOWED",
      messageId,
      error: null
    };

    if (dryRun) {
      retractions.push(entry);
      continue;
    }

    try {
      await editDigestMessage({
        token,
        chatId,
        messageId,
        text: RETRACTION_TEXT,
        managerPhone,
        publicAppUrl,
        fetchImpl
      });
      recordMessageRetracted(state, chatId, record.key, { now: new Date() });
      await savePublicationState(statePath, state);
      counts.retracted += 1;
    } catch (error) {
      // A failed withdrawal must not take the window down with it: the
      // forbidden routes are already filtered out of every new digest, so the
      // worst case is a stale post that the next run tries again.
      entry.action = "retract_failed";
      entry.error = String(error?.message || error);
    }

    retractions.push(entry);
  }

  return retractions;
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
