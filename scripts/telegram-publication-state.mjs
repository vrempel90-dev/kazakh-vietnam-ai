import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { atomicWriteJson } from "./atomic-json.mjs";
import { postFingerprint, telegramTextLength } from "./telegram-publisher.mjs";

function emptyState() {
  return {
    version: 1,
    targets: {},
    targetBatches: {},
    targetDigests: {},
    targetPlans: {},
    meta: { initializedAt: null }
  };
}

function normalizeState(parsed) {
  const isRecord = value => value && typeof value === "object" && !Array.isArray(value);
  if (!parsed || parsed.version !== 1 || !isRecord(parsed.targets)) {
    throw new Error("Invalid Telegram publication state schema");
  }
  for (const key of ["targetBatches", "targetDigests", "targetPlans", "meta"]) {
    if (parsed[key] != null && !isRecord(parsed[key])) throw new Error("Invalid Telegram publication state " + key);
  }
  for (const entries of Object.values(parsed.targets)) {
    if (!isRecord(entries) || Object.values(entries).some(value => !isRecord(value)
      || typeof value.fingerprint !== "string" || !Number.isFinite(Date.parse(value.publishedAt)))) {
      throw new Error("Invalid Telegram publication state entries");
    }
  }
  const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T12:00:00Z")) && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;
  for (const entry of Object.values(parsed.targetBatches || {})) {
    if (!isRecord(entry) || !Number.isFinite(Date.parse(entry.publishedAt))) throw new Error("Invalid Telegram publication state batch");
  }
  for (const entry of Object.values(parsed.targetDigests || {})) {
    if (!isRecord(entry) || !validDate(entry.date) || !Number.isFinite(Date.parse(entry.publishedAt))) throw new Error("Invalid Telegram publication state digest");
  }
  for (const target of Object.values(parsed.targetPlans || {})) {
    if (!isRecord(target)) throw new Error("Invalid Telegram publication state plan target");
    for (const plan of Object.values(target)) {
      if (!isRecord(plan) || !validDate(plan.date) || !Number.isFinite(Date.parse(plan.createdAt))
        || !Array.isArray(plan.flights) || !Array.isArray(plan.posts)) throw new Error("Invalid Telegram publication state plan");
      const ids = new Set();
      for (const flight of plan.flights) {
        if (!isRecord(flight) || typeof flight.id !== "string" || !flight.id || !validDate(flight.departureDate)
          || typeof flight.from !== "string" || typeof flight.to !== "string" || !["OW", "RT"].includes(flight.trip)
          || typeof flight.price !== "number" || !Number.isFinite(flight.price) || flight.price <= 0)
          throw new Error("Invalid Telegram publication state planned flight");
        ids.add(flight.id);
      }
      for (const post of plan.posts) {
        if (!isRecord(post) || !["pending", "sending", "sent", "expired", "review"].includes(post.status)
          || typeof post.text !== "string" || !post.text || telegramTextLength(post.text) > 4096
          || typeof post.country !== "string" || !Array.isArray(post.flightIds) || !post.flightIds.length
          || post.flightIds.some(id => !ids.has(id)) || post.contentHash !== postFingerprint(post))
          throw new Error("Invalid Telegram publication state planned post");
      }
    }
  }
  return {
    version: 1,
    targets: parsed.targets || {},
    targetPlans: parsed.targetPlans || {},
    targetBatches:
      parsed.targetBatches && typeof parsed.targetBatches === "object" && !Array.isArray(parsed.targetBatches)
        ? parsed.targetBatches
        : {},
    targetDigests:
      parsed.targetDigests && typeof parsed.targetDigests === "object" && !Array.isArray(parsed.targetDigests)
        ? parsed.targetDigests
        : {},
    meta:
      parsed.meta && typeof parsed.meta === "object" && !Array.isArray(parsed.meta)
        ? parsed.meta
        : { initializedAt: null }
  };
}

export function publicationFingerprint(flight) {
  const payload = {
    id: String(flight?.id || ""),
    from: String(flight?.from || ""),
    to: String(flight?.to || ""),
    trip: String(flight?.trip || ""),
    price: Number(flight?.price || 0),
    airline: String(flight?.airline || ""),
    seats: String(flight?.seats || ""),
    departureDate: String(flight?.departureDate || ""),
    returnDate: String(flight?.returnDate || ""),
    hot: Boolean(flight?.hot)
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

export async function loadPublicationState(path) {
  const filePath = resolve(path);
  try {
    return normalizeState(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw new Error("Could not load Telegram publication state; refusing to reset duplicate protection", { cause: error });
  }
}

// Hot notifications are once per physical flight, including after price/seat edits.
export function isHotPublicationPending(state, target, flight) {
  const entries = state?.targets?.[target] || {};
  return !entries[flight?.id] && !(flight?.legacyId && entries[flight.legacyId]);
}

export function isPublicationStateInitialized(state) {
  return Boolean(state?.meta?.initializedAt);
}

export function initializePublicationState(state, initializedAt = new Date().toISOString()) {
  if (!state || state.version !== 1) throw new Error("Invalid Telegram publication state");
  if (!state.meta || typeof state.meta !== "object") state.meta = {};
  state.meta.initializedAt = initializedAt;
  return state;
}

export function isPublicationPending(state, target, flight, {
  now = new Date(),
  cooldownHours = 24
} = {}) {
  const previous = state?.targets?.[target]?.[flight?.id];
  if (!previous) return true;

  const fingerprint = publicationFingerprint(flight);
  if (previous.fingerprint === fingerprint) return false;

  const previousTime = new Date(previous.publishedAt || 0).getTime();
  if (!Number.isFinite(previousTime)) return true;

  const cooldownMs = Math.max(0, Number(cooldownHours) || 0) * 60 * 60 * 1000;
  return now.getTime() - previousTime >= cooldownMs;
}

export function isTargetPublishAllowed(state, target, {
  now = new Date(),
  minIntervalMinutes = 60
} = {}) {
  const previousTime = new Date(state?.targetBatches?.[target]?.publishedAt || 0).getTime();
  if (!Number.isFinite(previousTime)) return true;
  const intervalMs = Math.max(0, Number(minIntervalMinutes) || 0) * 60 * 1000;
  return now.getTime() - previousTime >= intervalMs;
}

export function markTargetBatchPublished(state, target, publishedAt = new Date().toISOString()) {
  if (!state || state.version !== 1) throw new Error("Invalid Telegram publication state");
  if (!state.targetBatches || typeof state.targetBatches !== "object") state.targetBatches = {};
  state.targetBatches[target] = { publishedAt };
  return state;
}

export function isDailyDigestPublished(state, target, localDate) {
  return String(state?.targetDigests?.[target]?.date || "") === String(localDate || "");
}

export function markDailyDigestPublished(
  state,
  target,
  localDate,
  publishedAt = new Date().toISOString()
) {
  if (!state || state.version !== 1) throw new Error("Invalid Telegram publication state");
  if (!state.targetDigests || typeof state.targetDigests !== "object") state.targetDigests = {};
  state.targetDigests[target] = {
    date: String(localDate || ""),
    publishedAt
  };
  return state;
}

export function markFlightsPublished(state, target, flights, publishedAt = new Date().toISOString()) {
  if (!state || state.version !== 1 || typeof state.targets !== "object") {
    throw new Error("Invalid Telegram publication state");
  }
  if (!state.targets[target]) state.targets[target] = {};

  for (const flight of flights) {
    if (!flight?.id) continue;
    state.targets[target][flight.id] = {
      fingerprint: publicationFingerprint(flight),
      publishedAt,
      departureDate: flight.departureDate
    };
  }
  return state;
}

export function prunePublicationState(state, {
  now = new Date(),
  retentionDays = 30,
  maxEntriesPerTarget = 2000
} = {}) {
  if (!state?.targets || typeof state.targets !== "object") return state;
  const retentionMs = Math.max(1, Number(retentionDays) || 30) * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - retentionMs;
  const limit = Math.max(100, Math.floor(Number(maxEntriesPerTarget) || 2000));

  for (const [target, entries] of Object.entries(state.targets)) {
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const future = Object.entries(entries || {}).filter(([, value]) => value?.departureDate >= localDate);
    const kept = Object.entries(entries || {})
      .filter(([, value]) => {
        if (value?.departureDate >= localDate) return false;
        const time = new Date(value?.publishedAt || 0).getTime();
        return Number.isFinite(time) && time >= cutoff;
      })
      .sort((a, b) => new Date(b[1]?.publishedAt || 0).getTime() - new Date(a[1]?.publishedAt || 0).getTime())
      .slice(0, Math.max(0, limit - future.length));

    state.targets[target] = Object.fromEntries([...future, ...kept]);
  }
  return state;
}

export async function savePublicationState(path, state) {
  normalizeState(state);
  await atomicWriteJson(path, state);
}
