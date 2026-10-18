/**
 * Immediate, separately tracked alerts for departures today or tomorrow.
 *
 * The scheduled country publisher owns regional windows. This module is the
 * single exception: a freshly observed near-term offer may be sent during any
 * scheduled collector sync, with all countries batched where space allows.
 *
 * A durable intent is written before each Telegram API request. Unconfirmed
 * and interrupted sends are quarantined instead of being blindly re-sent.
 */
import { createHash, randomUUID } from "node:crypto";
import { buildCountryDigests, FOOTER_TEXT, TELEGRAM_TEXT_LIMIT } from "./telegram-digest.mjs";
import { localClock } from "./telegram-schedule.mjs";
import {
  TelegramApiError, filterFlightsForTarget, isPublishingEnvironmentAllowed,
  parsePublishTargets, sendDigestMessage
} from "./telegram-publisher.mjs";
import {
  acquireRunLock, releaseRunLock, initializePublicationState,
  isOfferPublished, listMessageRecords, loadPublicationState,
  markOffersPublished, prunePublicationState, recordMessageFailure,
  recordMessageIntent, recordMessageSent, savePublicationState
} from "./telegram-publication-state.mjs";

export const HOT_HEADER = "🔥 Горящие! Вылет сегодня–завтра";
const DEFAULT_STATE_PATH = "/data/telegram-publications.json";

function dayAfter(iso) {
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Only fresh, confidently parsed offers; never resurrect a cached fare. */
export function selectNearTermOffers(flights, { now = new Date(), timeZone = "Asia/Almaty" } = {}) {
  const today = localClock(now, timeZone).date;
  const tomorrow = dayAfter(today);
  return (Array.isArray(flights) ? flights : []).filter(flight => {
    const date = String(flight?.departureDate || "");
    const price = Number(flight?.price);
    return (date === today || date === tomorrow)
      && !flight?.cachedFallback
      && Boolean(flight?.from && flight?.to)
      && Number.isFinite(price) && price > 0;
  });
}

/**
 * Combine multiple countries into one alert when it fits; split without
 * dropping any flights if Telegram's message limit is reached.
 * Country sections reuse the production renderer (routes, dates and legends).
 */
export function buildHotDigests(flights, {
  now = new Date(),
  maxChars = 3900
} = {}) {
  const limit = Math.min(TELEGRAM_TEXT_LIMIT, Math.max(700, Number(maxChars) || 3900));
  const room = limit - HOT_HEADER.length - FOOTER_TEXT.length - 80;
  const countryDigests = buildCountryDigests(flights, { now, maxChars: room }).digests;
  if (!countryDigests.length) return [];

  const blocks = countryDigests.map(digest => ({
    ...digest,
    body: digest.text.endsWith(FOOTER_TEXT)
      ? digest.text.slice(0, -FOOTER_TEXT.length).trimEnd()
      : digest.text
  }));
  const batches = [];
  let pending = [];
  const render = items => [HOT_HEADER, ...items.map(item => item.body), FOOTER_TEXT].join("\n\n");
  for (const block of blocks) {
    if (pending.length && render([...pending, block]).length > limit) {
      batches.push(pending);
      pending = [];
    }
    pending.push(block);
    if (render(pending).length > limit) {
      throw new Error("HOT_DIGEST_EXCEEDS_TELEGRAM_LIMIT");
    }
  }
  if (pending.length) batches.push(pending);

  return batches.map((items, index) => {
    const text = render(items);
    const offerIds = [...new Set(items.flatMap(item => item.offerIds))];
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 32);
    return {
      key: "HOT#" + hash,
      text,
      contentHash: hash,
      country: null,
      countryName: "Горящие",
      part: index + 1,
      parts: batches.length,
      offerIds,
      offers: offerIds.length
    };
  });
}

function heldUrgentOfferIds(state, chatId) {
  const ids = new Set();
  for (const record of listMessageRecords(state, chatId)) {
    if (!String(record.key || "").startsWith("HOT#")) continue;
    if (record.status !== "pending" && record.status !== "unconfirmed") continue;
    for (const id of [...(record.offerIds || []), ...(record.pendingOfferIds || [])]) ids.add(String(id));
  }
  return ids;
}

/**
 * No Telegram call at startup, in GitHub Actions, in disabled environments or
 * in dry-run mode. Production sends are serialized by the SAME file lock as
 * scheduled publication and use the SAME confirmation state.
 */
export async function runHotPublication({
  flights = [], now = new Date(), env = process.env,
  statePath = env?.TELEGRAM_PUBLISH_STATE_PATH || DEFAULT_STATE_PATH,
  fetchImpl = fetch, reason = "scheduled", dryRun = false,
  targets = null, logger = console
} = {}) {
  const report = { sent: 0, failed: 0, held: 0, skipped: 0, planned: 0, messages: [], reason: null };
  if (reason === "startup") return { ...report, reason: "STARTUP_RUN_DOES_NOT_PUBLISH" };
  const allowed = isPublishingEnvironmentAllowed(env);
  if (!allowed.allowed && !dryRun) return { ...report, reason: allowed.reason };

  const timeZone = env?.TELEGRAM_PUBLISH_TIMEZONE || "Asia/Almaty";
  let candidates;
  try {
    candidates = selectNearTermOffers(flights, { now, timeZone });
  } catch {
    return { ...report, reason: "INVALID_TIME_ZONE" };
  }
  if (!candidates.length) return { ...report, reason: "NO_NEAR_TERM_OFFERS" };
  const chats = targets?.length
    ? parsePublishTargets(targets.join(","))
    : parsePublishTargets(env?.TELEGRAM_PUBLISH_CHATS);
  if (!chats.length) return { ...report, reason: "NO_PUBLISH_CHATS_CONFIGURED" };

  const owner = String(process.pid) + ":" + randomUUID().slice(0, 8);
  const lock = dryRun ? null : await acquireRunLock(statePath, { owner, now, ttlMinutes: 10 });
  if (!dryRun && !lock.acquired) return { ...report, reason: "ANOTHER_RUN_IN_PROGRESS" };

  try {
    const state = await loadPublicationState(statePath);
    initializePublicationState(state, now.toISOString());
    for (const chatId of chats) {
      const held = heldUrgentOfferIds(state, chatId);
      const eligible = filterFlightsForTarget(candidates, chatId)
        .filter(flight => !isOfferPublished(state, chatId, flight) && !held.has(String(flight.id)));
      if (!eligible.length) {
        report.skipped += 1;
        continue;
      }
      const maxChars = Number(env?.TELEGRAM_MAX_MESSAGE_CHARS) || 3900;
      const digests = buildHotDigests(eligible, { now, maxChars });
      for (const digest of digests) {
        const prior = listMessageRecords(state, chatId).find(item => item.key === digest.key);
        if (prior?.status === "sent") {
          report.skipped += 1;
          continue;
        }
        if (prior?.status === "pending" || prior?.status === "unconfirmed") {
          report.held += 1;
          continue;
        }
        if (dryRun) {
          report.planned += 1;
          report.messages.push({ chatId, key: digest.key, action: "would_send", offers: digest.offers });
          continue;
        }
        const localDate = localClock(now, timeZone).date;
        recordMessageIntent(state, chatId, digest.key, {
          countryName: "Горящие", offerIds: digest.offerIds,
          contentHash: digest.contentHash, localDate, window: "hot", now
        });
        await savePublicationState(statePath, state);
        try {
          const messageId = await sendDigestMessage({
            token: String(env?.TELEGRAM_BOT_TOKEN || ""),
            chatId, text: digest.text,
            managerPhone: env?.VITE_MANAGER_WHATSAPP || "",
            publicAppUrl: env?.PUBLIC_APP_URL || env?.RAILWAY_PUBLIC_DOMAIN || "",
            fetchImpl
          });
          recordMessageSent(state, chatId, digest.key, { messageId, now: new Date() });
          markOffersPublished(state, chatId,
            eligible.filter(flight => digest.offerIds.includes(flight.id)), new Date().toISOString());
          await savePublicationState(statePath, state);
          report.sent += 1;
          report.messages.push({ chatId, key: digest.key, action: "sent", messageId, offers: digest.offers });
        } catch (error) {
          const apiError = error instanceof TelegramApiError
            ? error : new TelegramApiError(String(error?.message || error), { definitive: false });
          recordMessageFailure(state, chatId, digest.key, {
            error: apiError.message, definitive: apiError.definitive, now: new Date()
          });
          await savePublicationState(statePath, state);
          report.failed += 1;
          report.messages.push({ chatId, key: digest.key,
            action: apiError.definitive ? "failed" : "unconfirmed", error: apiError.message });
          if (apiError.fatalForChannel) break;
        }
      }
    }
    if (!dryRun) {
      prunePublicationState(state, { now, retentionDays: Number(env?.TELEGRAM_PUBLICATION_RETENTION_DAYS) || 30 });
      await savePublicationState(statePath, state);
    }
    report.reason = report.failed ? "DELIVERY_FAILURE" : report.sent ? "HOT_ALERT_SENT"
      : report.planned ? "HOT_ALERT_PLANNED" : "NO_NEW_NEAR_TERM_OFFERS";
    return report;
  } finally {
    if (!dryRun) await releaseRunLock(statePath, owner);
    if (logger && report.failed) logger.warn?.("Hot Telegram alerts:", JSON.stringify(report));
  }
}
