import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function emptyState() {
  return {
    version: 1,
    targets: {},
    targetBatches: {},
    targetDigests: {},
    targetCountryMessages: {},
    meta: { initializedAt: null }
  };
}

function normalizeState(parsed) {
  if (!parsed || parsed.version !== 1 || typeof parsed.targets !== "object" || Array.isArray(parsed.targets)) {
    return emptyState();
  }
  return {
    version: 1,
    targets: parsed.targets || {},
    targetBatches:
      parsed.targetBatches && typeof parsed.targetBatches === "object" && !Array.isArray(parsed.targetBatches)
        ? parsed.targetBatches
        : {},
    targetDigests:
      parsed.targetDigests && typeof parsed.targetDigests === "object" && !Array.isArray(parsed.targetDigests)
        ? parsed.targetDigests
        : {},
    targetCountryMessages:
      parsed.targetCountryMessages
      && typeof parsed.targetCountryMessages === "object"
      && !Array.isArray(parsed.targetCountryMessages)
        ? parsed.targetCountryMessages
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
  } catch {
    return emptyState();
  }
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

export function countryMessageIdsForDate(state, target, localDate) {
  const entries = state?.targetCountryMessages?.[target];
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return {};

  return Object.fromEntries(
    Object.entries(entries)
      .filter(([, value]) =>
        String(value?.date || "") === String(localDate || "")
        && Number(value?.messageId) > 0
      )
      .map(([country, value]) => [country, Number(value.messageId)])
  );
}

export function markCountryMessagesPublished(
  state,
  target,
  countryMessages,
  localDate,
  publishedAt = new Date().toISOString()
) {
  if (!state || state.version !== 1) throw new Error("Invalid Telegram publication state");
  if (!state.targetCountryMessages || typeof state.targetCountryMessages !== "object") {
    state.targetCountryMessages = {};
  }
  if (!state.targetCountryMessages[target]) state.targetCountryMessages[target] = {};

  for (const [country, messageId] of Object.entries(countryMessages || {})) {
    const numericId = Number(messageId);
    if (!country || !Number.isFinite(numericId) || numericId <= 0) continue;
    state.targetCountryMessages[target][country] = {
      date: String(localDate || ""),
      messageId: numericId,
      publishedAt
    };
  }
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
      publishedAt
    };
  }
  return state;
}

export function bootstrapPublicationTarget(
  state,
  target,
  flights,
  localDate,
  initializedAt = new Date().toISOString()
) {
  initializePublicationState(state, initializedAt);
  markFlightsPublished(state, target, flights, initializedAt);
  markDailyDigestPublished(state, target, localDate, initializedAt);
  markTargetBatchPublished(state, target, initializedAt);
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
    const kept = Object.entries(entries || {})
      .filter(([, value]) => {
        const time = new Date(value?.publishedAt || 0).getTime();
        return Number.isFinite(time) && time >= cutoff;
      })
      .sort((a, b) => new Date(b[1]?.publishedAt || 0).getTime() - new Date(a[1]?.publishedAt || 0).getTime())
      .slice(0, limit);

    state.targets[target] = Object.fromEntries(kept);
  }
  return state;
}

export async function savePublicationState(path, state) {
  const filePath = resolve(path);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp-" + process.pid + "-" + Date.now();
  await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tempPath, filePath);
}
