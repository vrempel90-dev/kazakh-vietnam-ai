/**
 * Persistent Telegram publication state (schema v2).
 *
 * Lives on the Railway volume, never on an ephemeral CI filesystem. For every
 * message we keep the chat, local date, window, country, category, covered
 * offer ids, content hash, Telegram message id, delivery status, timestamps
 * and the last error, which is what makes restarts and re-runs safe.
 *
 * Delivery statuses:
 *  - `sent`         Telegram confirmed the message and we stored its id.
 *  - `failed`       Telegram explicitly rejected it; retrying is safe.
 *  - `unconfirmed`  the call did not come back (timeout/network). The message
 *                   may well have been delivered, so it is never blindly
 *                   re-sent; it is reported for review instead.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const STATE_VERSION = 2;
export const MESSAGE_STATUS = {
  SENT: "sent",
  PENDING: "pending",
  FAILED: "failed",
  UNCONFIRMED: "unconfirmed"
};
export const WINDOW_STATUS = {
  COMPLETED: "completed",
  PARTIAL: "partial",
  RUNNING: "running"
};

function emptyState() {
  return {
    version: STATE_VERSION,
    meta: { initializedAt: null, migratedFrom: null, lastRunAt: null },
    lease: null,
    channels: {}
  };
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function emptyChannel() {
  return { offers: {}, windows: {}, messages: {}, legacy: {} };
}

function normalizeChannel(raw) {
  const source = plainObject(raw) || {};
  return {
    offers: plainObject(source.offers) || {},
    windows: plainObject(source.windows) || {},
    messages: plainObject(source.messages) || {},
    legacy: plainObject(source.legacy) || {}
  };
}

/**
 * Upgrades a v1 state in place-compatible fashion.
 *
 * Offer history is preserved so an upgrade never replays old offers. v1 message
 * ids are archived under `legacy` but deliberately not reused for editing: the
 * v1 keys ("Вьетнам|outbound") describe a different message layout, and editing
 * a message whose structure has changed would corrupt a live post.
 */
function migrateFromV1(parsed) {
  const state = emptyState();
  state.meta.initializedAt = parsed?.meta?.initializedAt || null;
  state.meta.migratedFrom = 1;
  state.meta.migratedAt = new Date().toISOString();

  const targets = plainObject(parsed?.targets) || {};
  const digests = plainObject(parsed?.targetDigests) || {};
  const countryMessages = plainObject(parsed?.targetCountryMessages) || {};
  const batches = plainObject(parsed?.targetBatches) || {};

  const chatIds = new Set([
    ...Object.keys(targets),
    ...Object.keys(digests),
    ...Object.keys(countryMessages),
    ...Object.keys(batches)
  ]);

  for (const chatId of chatIds) {
    const channel = emptyChannel();

    for (const [offerId, record] of Object.entries(plainObject(targets[chatId]) || {})) {
      if (!offerId || !plainObject(record)) continue;
      channel.offers[offerId] = {
        fingerprint: String(record.fingerprint || ""),
        publishedAt: String(record.publishedAt || "")
      };
    }

    const digestDate = String(digests[chatId]?.date || "");
    if (digestDate) {
      // The v1 digest flag only recorded a date, so treat it as the morning
      // window of that date having been delivered.
      channel.windows[digestDate + ":morning"] = {
        status: WINDOW_STATUS.COMPLETED,
        completedAt: String(digests[chatId]?.publishedAt || ""),
        migratedFrom: 1
      };
    }

    const legacyMessages = plainObject(countryMessages[chatId]);
    if (legacyMessages) channel.legacy.countryMessages = legacyMessages;
    if (plainObject(batches[chatId])) channel.legacy.lastBatch = batches[chatId];

    state.channels[chatId] = channel;
  }

  return state;
}

function normalizeState(parsed) {
  if (!plainObject(parsed)) throw new Error("Invalid Telegram publication state");
  if (Number(parsed.version) === 1) return migrateFromV1(parsed);
  if (Number(parsed.version) !== STATE_VERSION || !plainObject(parsed.channels)) {
    throw new Error("Unsupported or corrupt Telegram publication state");
  }
  for (const channel of Object.values(parsed.channels)) {
    if (!plainObject(channel) || !plainObject(channel.messages) || !plainObject(channel.windows)) {
      throw new Error("Corrupt Telegram channel state");
    }
    if (Object.values(channel.messages).some(record => !plainObject(record)
      || !Object.values(MESSAGE_STATUS).includes(record.status))
      || Object.values(channel.windows).some(record => !plainObject(record)
        || !Object.values(WINDOW_STATUS).includes(record.status))) {
      throw new Error("Corrupt Telegram delivery records");
    }
  }

  const state = emptyState();
  state.meta = { ...state.meta, ...plainObject(parsed.meta) };
  state.lease = plainObject(parsed.lease) || null;

  for (const [chatId, raw] of Object.entries(plainObject(parsed.channels) || {})) {
    if (!chatId) continue;
    state.channels[chatId] = normalizeChannel(raw);
  }

  return state;
}

export function publicationFingerprint(flight) {
  const payload = {
    id: String(flight?.id || ""),
    from: String(flight?.from || ""),
    to: String(flight?.to || ""),
    trip: String(flight?.trip || ""),
    price: Number(flight?.price || 0),
    airline: String(flight?.airline || ""),
    airlineCode: String(flight?.airlineCode || ""),
    seats: String(flight?.seats || ""),
    departureDate: String(flight?.departureDate || ""),
    returnDate: String(flight?.returnDate || "")
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

export async function loadPublicationState(path) {
  try {
    return normalizeState(JSON.parse(await readFile(resolve(path), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw new Error("PUBLICATION_STATE_UNREADABLE", { cause: error });
  }
}

export async function savePublicationState(path, state) {
  const filePath = resolve(path);
  await mkdir(dirname(filePath), { recursive: true });
  // A random suffix is required: two saves in the same process and the same
  // millisecond would otherwise share a temp path and one rename would fail.
  const tempPath = filePath + ".tmp-" + process.pid + "-" + randomUUID();
  await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tempPath, filePath);
}

export function isPublicationStateInitialized(state) {
  return Boolean(state?.meta?.initializedAt);
}

export function initializePublicationState(state, initializedAt = new Date().toISOString()) {
  assertState(state);
  if (!plainObject(state.meta)) state.meta = {};
  if (!state.meta.initializedAt) state.meta.initializedAt = initializedAt;
  return state;
}

function assertState(state) {
  if (!plainObject(state) || Number(state.version) !== STATE_VERSION) {
    throw new Error("Invalid Telegram publication state");
  }
}

export function channelState(state, chatId) {
  assertState(state);
  const key = String(chatId);
  if (!plainObject(state.channels)) state.channels = {};
  if (!state.channels[key]) state.channels[key] = emptyChannel();
  else state.channels[key] = normalizeChannel(state.channels[key]);
  return state.channels[key];
}

/* ------------------------------------------------------------------ leases */

/**
 * Cooperative lease so two overlapping runs (a 15-minute sync overlapping a
 * slow one, or a restart mid-run) cannot publish at the same time.
 */
export function acquireRunLease(state, {
  owner = String(process.pid),
  now = new Date(),
  ttlMinutes = 10
} = {}) {
  assertState(state);
  const existing = plainObject(state.lease);
  const expiresAt = Date.parse(existing?.expiresAt || "");

  if (existing && Number.isFinite(expiresAt) && expiresAt > now.getTime() && existing.owner !== owner) {
    return { acquired: false, heldBy: existing.owner, expiresAt: existing.expiresAt };
  }

  state.lease = {
    owner: String(owner),
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + Math.max(1, Number(ttlMinutes) || 10) * 60000).toISOString()
  };
  return { acquired: true, heldBy: String(owner), expiresAt: state.lease.expiresAt };
}

export function releaseRunLease(state, owner = String(process.pid)) {
  assertState(state);
  if (plainObject(state.lease) && state.lease.owner !== String(owner)) return state;
  state.lease = null;
  return state;
}

/* -------------------------------------------------------------- run locks */

/**
 * Filesystem mutex around a publication run.
 *
 * `acquireRunLease` records who is running for diagnostics, but only an
 * exclusive file create is actually atomic, so that is what decides whether a
 * run may proceed. A leftover lock is held for review by default: elapsed time
 * does not prove that its owner is dead. Stale takeover is an explicit operator
 * option, never enabled by the automatic publisher.
 */
export function runLockPath(statePath) {
  return resolve(statePath) + ".lock";
}

export async function acquireRunLock(statePath, {
  owner = String(process.pid),
  now = new Date(),
  ttlMinutes = 10,
  allowStaleTakeover = false
} = {}) {
  const lockPath = runLockPath(statePath);
  await mkdir(dirname(lockPath), { recursive: true });

  try {
    const handle = await open(lockPath, "wx");
    try {
      await handle.writeFile(
        JSON.stringify({ owner: String(owner), acquiredAt: now.toISOString() }),
        "utf8"
      );
    } finally {
      await handle.close();
    }
    return { acquired: true, owner: String(owner), lockPath };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  let held = null;
  try {
    held = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    held = null;
  }

  const acquiredAt = Date.parse(held?.acquiredAt || "");
  const ttlMs = Math.max(1, Number(ttlMinutes) || 10) * 60000;
  const stale = !Number.isFinite(acquiredAt) || now.getTime() - acquiredAt >= ttlMs;

  if (stale && allowStaleTakeover) {
    await unlink(lockPath).catch(() => {});
    return acquireRunLock(statePath, {
      owner, now, ttlMinutes, allowStaleTakeover: false
    });
  }

  return {
    acquired: false,
    heldBy: held?.owner ?? null,
    acquiredAt: held?.acquiredAt ?? null,
    lockPath
  };
}

export async function releaseRunLock(statePath, owner = String(process.pid)) {
  const lockPath = runLockPath(statePath);
  try {
    const held = JSON.parse(await readFile(lockPath, "utf8"));
    if (held?.owner && held.owner !== String(owner)) return false;
  } catch {
    // Never delete another process's partially written or unreadable mutex.
    return false;
  }
  await unlink(lockPath).catch(() => {});
  return true;
}

/* ----------------------------------------------------------------- windows */

export function getWindowRecord(state, chatId, key) {
  return plainObject(channelState(state, chatId).windows[String(key)]) || null;
}

/** True when this channel already received its package for this window. */
export function isWindowCompleted(state, chatId, key) {
  return getWindowRecord(state, chatId, key)?.status === WINDOW_STATUS.COMPLETED;
}

export function beginWindowRun(state, chatId, key, { now = new Date() } = {}) {
  const channel = channelState(state, chatId);
  const existing = plainObject(channel.windows[String(key)]) || {};
  channel.windows[String(key)] = {
    ...existing,
    status: existing.status === WINDOW_STATUS.COMPLETED
      ? WINDOW_STATUS.COMPLETED
      : WINDOW_STATUS.RUNNING,
    startedAt: existing.startedAt || now.toISOString(),
    attempts: Number(existing.attempts || 0) + 1
  };
  return channel.windows[String(key)];
}

export function finishWindowRun(state, chatId, key, {
  status = WINDOW_STATUS.COMPLETED,
  now = new Date(),
  counts = {}
} = {}) {
  const channel = channelState(state, chatId);
  const existing = plainObject(channel.windows[String(key)]) || {};
  channel.windows[String(key)] = {
    ...existing,
    status,
    completedAt: now.toISOString(),
    counts: { ...plainObject(existing.counts), ...counts }
  };
  return channel.windows[String(key)];
}

/* ---------------------------------------------------------------- messages */

export function getMessageRecord(state, chatId, digestKey) {
  return plainObject(channelState(state, chatId).messages[String(digestKey)]) || null;
}

export function listMessageRecords(state, chatId) {
  return Object.entries(channelState(state, chatId).messages)
    .map(([key, record]) => ({ key, ...plainObject(record) }));
}

/**
 * Writes the intent to publish BEFORE the Telegram call so a crash in between
 * leaves a durable trace instead of an invisible, possibly delivered message.
 */
export function recordMessageIntent(state, chatId, digestKey, {
  country = null,
  countryName = null,
  part = 1,
  parts = 1,
  contentHash = "",
  offerIds = [],
  localDate = "",
  window = "",
  action = "send",
  messageId = null,
  now = new Date()
} = {}) {
  const channel = channelState(state, chatId);
  const key = String(digestKey);
  const existing = plainObject(channel.messages[key]) || {};

  channel.messages[key] = {
    ...existing,
    country,
    countryName,
    part,
    parts,
    pendingContentHash: String(contentHash),
    pendingOfferIds: [...offerIds],
    localDate: String(localDate),
    window: String(window),
    action: String(action),
    messageId: messageId == null ? (existing.messageId ?? null) : Number(messageId),
    status: MESSAGE_STATUS.PENDING,
    attemptedAt: now.toISOString(),
    attempts: Number(existing.attempts || 0) + 1,
    error: null
  };
  return channel.messages[key];
}

export function recordMessageSent(state, chatId, digestKey, {
  messageId,
  now = new Date()
} = {}) {
  const channel = channelState(state, chatId);
  const key = String(digestKey);
  const existing = plainObject(channel.messages[key]) || {};
  const numericId = Number(messageId);

  channel.messages[key] = {
    ...existing,
    messageId: Number.isFinite(numericId) && numericId > 0
      ? numericId
      : (existing.messageId ?? null),
    contentHash: String(existing.pendingContentHash || existing.contentHash || ""),
    offerIds: [...(existing.pendingOfferIds || existing.offerIds || [])],
    status: MESSAGE_STATUS.SENT,
    sentAt: now.toISOString(),
    error: null
  };
  delete channel.messages[key].pendingContentHash;
  delete channel.messages[key].pendingOfferIds;
  return channel.messages[key];
}

/**
 * `definitive` distinguishes an explicit Telegram rejection (safe to retry)
 * from a call that never reported back (must not be blindly re-sent).
 */
export function recordMessageFailure(state, chatId, digestKey, {
  error = "",
  definitive = true,
  now = new Date()
} = {}) {
  const channel = channelState(state, chatId);
  const key = String(digestKey);
  const existing = plainObject(channel.messages[key]) || {};

  channel.messages[key] = {
    ...existing,
    status: definitive ? MESSAGE_STATUS.FAILED : MESSAGE_STATUS.UNCONFIRMED,
    failedAt: now.toISOString(),
    error: String(error).slice(0, 500)
  };
  if (definitive) {
    delete channel.messages[key].pendingContentHash;
    delete channel.messages[key].pendingOfferIds;
  }
  return channel.messages[key];
}

/**
 * Decides what to do with a freshly rendered digest.
 *
 * Returns one of:
 *  - `send`        no live message for this key yet
 *  - `edit`        a live message exists and the content changed
 *  - `skip`        the live message already carries this exact content
 *  - `hold`        a previous attempt was never confirmed; needs review
 */
export function planMessageAction(state, chatId, digest, { retryUnconfirmed = false } = {}) {
  const record = getMessageRecord(state, chatId, digest.key);

  if (!record) return { action: "send", record: null, reason: "NEW_DIGEST" };

  if ([MESSAGE_STATUS.UNCONFIRMED, MESSAGE_STATUS.PENDING].includes(record.status) && !retryUnconfirmed) {
    return { action: "hold", record, reason: "PREVIOUS_ATTEMPT_UNCONFIRMED" };
  }

  const liveMessageId = Number(record.messageId);
  const hasLiveMessage = Number.isFinite(liveMessageId) && liveMessageId > 0;

  if (!hasLiveMessage) {
    return { action: "send", record, reason: "NO_CONFIRMED_MESSAGE" };
  }

  if (record.status === MESSAGE_STATUS.SENT && String(record.contentHash || "") === String(digest.contentHash)) {
    return { action: "skip", record, reason: "CONTENT_UNCHANGED" };
  }

  return { action: "edit", record, reason: "CONTENT_CHANGED" };
}

/* ------------------------------------------------------------------ offers */

export function isOfferPublished(state, chatId, flight) {
  const record = plainObject(channelState(state, chatId).offers[String(flight?.id || "")]);
  return Boolean(record) && record.fingerprint === publicationFingerprint(flight);
}

export function markOffersPublished(state, chatId, flights, publishedAt = new Date().toISOString()) {
  const channel = channelState(state, chatId);
  for (const flight of Array.isArray(flights) ? flights : []) {
    if (!flight?.id) continue;
    channel.offers[String(flight.id)] = {
      fingerprint: publicationFingerprint(flight),
      publishedAt
    };
  }
  return state;
}

/* ----------------------------------------------------------------- pruning */

export function prunePublicationState(state, {
  now = new Date(),
  retentionDays = 30,
  maxOffersPerChannel = 4000
} = {}) {
  assertState(state);
  const retentionMs = Math.max(1, Number(retentionDays) || 30) * 86400000;
  const cutoff = now.getTime() - retentionMs;
  const limit = Math.max(200, Math.floor(Number(maxOffersPerChannel) || 4000));

  for (const channel of Object.values(state.channels || {})) {
    const normalized = normalizeChannel(channel);

    normalized.offers = Object.fromEntries(
      Object.entries(normalized.offers)
        .filter(([, record]) => {
          const time = Date.parse(record?.publishedAt || "");
          return Number.isFinite(time) && time >= cutoff;
        })
        .sort((a, b) => Date.parse(b[1]?.publishedAt || 0) - Date.parse(a[1]?.publishedAt || 0))
        .slice(0, limit)
    );

    normalized.windows = Object.fromEntries(
      Object.entries(normalized.windows).filter(([key]) => {
        const date = String(key).slice(0, 10);
        const time = Date.parse(date + "T12:00:00Z");
        return !Number.isFinite(time) || time >= cutoff;
      })
    );

    // Message records stay until retention expires: they are what lets a
    // later window edit an existing post instead of sending a duplicate.
    normalized.messages = Object.fromEntries(
      Object.entries(normalized.messages).filter(([, record]) => {
        // Unresolved attempts cannot age into a new send after a restart.
        if ([MESSAGE_STATUS.PENDING, MESSAGE_STATUS.UNCONFIRMED].includes(record?.status)) return true;
        const time = Date.parse(record?.sentAt || record?.attemptedAt || "");
        return !Number.isFinite(time) || time >= cutoff;
      })
    );

    channel.offers = normalized.offers;
    channel.windows = normalized.windows;
    channel.messages = normalized.messages;
  }

  return state;
}
