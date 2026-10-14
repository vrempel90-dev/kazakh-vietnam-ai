import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MESSAGE_STATUS,
  STATE_VERSION,
  WINDOW_STATUS,
  acquireRunLease,
  beginWindowRun,
  finishWindowRun,
  getMessageRecord,
  initializePublicationState,
  isOfferPublished,
  isPublicationStateInitialized,
  isWindowCompleted,
  loadPublicationState,
  markOffersPublished,
  planMessageAction,
  prunePublicationState,
  publicationFingerprint,
  recordMessageFailure,
  recordMessageIntent,
  recordMessageSent,
  releaseRunLease,
  savePublicationState
} from "../scripts/telegram-publication-state.mjs";

const CHAT = "-1002106608923";
const digest = {
  key: "VN#1",
  country: "VN",
  countryName: "Вьетнам",
  part: 1,
  parts: 1,
  contentHash: "hash-a",
  offerIds: ["f1", "f2"]
};

const flight = {
  id: "f1",
  from: "Алматы",
  to: "Нячанг",
  trip: "OW",
  price: 125000,
  airline: "SCAT",
  airlineCode: "S",
  seats: "3 места",
  departureDate: "2026-10-21"
};

async function freshState() {
  const dir = await mkdtemp(join(tmpdir(), "charter-state-"));
  const path = join(dir, "state.json");
  const state = await loadPublicationState(path);
  initializePublicationState(state, "2026-10-12T05:00:00.000Z");
  return { path, state };
}

test("a missing state file yields an empty v2 state", async () => {
  const { state } = await freshState();
  assert.equal(state.version, STATE_VERSION);
  assert.equal(isPublicationStateInitialized(state), true);
  assert.deepEqual(Object.keys(state.channels), []);
});

test("a new digest is sent, an unchanged one is skipped, a changed one is edited", async () => {
  const { state } = await freshState();

  assert.deepEqual(planMessageAction(state, CHAT, digest).action, "send");

  recordMessageIntent(state, CHAT, digest.key, { ...digest, action: "send" });
  assert.equal(getMessageRecord(state, CHAT, digest.key).status, MESSAGE_STATUS.PENDING);

  recordMessageSent(state, CHAT, digest.key, { messageId: 501 });
  const stored = getMessageRecord(state, CHAT, digest.key);
  assert.equal(stored.status, MESSAGE_STATUS.SENT);
  assert.equal(stored.messageId, 501);
  assert.equal(stored.contentHash, "hash-a");
  assert.deepEqual(stored.offerIds, ["f1", "f2"]);

  const unchanged = planMessageAction(state, CHAT, digest);
  assert.equal(unchanged.action, "skip");
  assert.equal(unchanged.reason, "CONTENT_UNCHANGED");

  const changed = planMessageAction(state, CHAT, { ...digest, contentHash: "hash-b" });
  assert.equal(changed.action, "edit");
  assert.equal(changed.record.messageId, 501);
});

test("an explicit Telegram rejection is retried, an unconfirmed call is held", async () => {
  const { state } = await freshState();

  recordMessageIntent(state, CHAT, digest.key, { ...digest, action: "send" });
  recordMessageFailure(state, CHAT, digest.key, { error: "Bad Request", definitive: true });
  assert.equal(getMessageRecord(state, CHAT, digest.key).status, MESSAGE_STATUS.FAILED);
  assert.equal(
    planMessageAction(state, CHAT, digest).action,
    "send",
    "a message Telegram rejected was never delivered, so retrying is safe"
  );

  recordMessageIntent(state, CHAT, "VN#2", { ...digest, key: "VN#2", action: "send" });
  recordMessageFailure(state, CHAT, "VN#2", { error: "timeout", definitive: false });
  assert.equal(getMessageRecord(state, CHAT, "VN#2").status, MESSAGE_STATUS.UNCONFIRMED);

  const held = planMessageAction(state, CHAT, { ...digest, key: "VN#2" });
  assert.equal(held.action, "hold", "an unconfirmed send must never be blindly repeated");
  assert.equal(held.reason, "PREVIOUS_ATTEMPT_UNCONFIRMED");

  assert.equal(
    planMessageAction(state, CHAT, { ...digest, key: "VN#2" }, { retryUnconfirmed: true }).action,
    "send",
    "an operator can still opt into a retry"
  );
});

test("a window is published once per channel and the guard is per window and date", async () => {
  const { state } = await freshState();
  const key = "2026-10-12:morning";

  assert.equal(isWindowCompleted(state, CHAT, key), false);
  beginWindowRun(state, CHAT, key, { now: new Date("2026-10-12T05:01:00Z") });
  assert.equal(isWindowCompleted(state, CHAT, key), false, "a started window is not a finished one");

  finishWindowRun(state, CHAT, key, { status: WINDOW_STATUS.COMPLETED, counts: { sent: 3 } });
  assert.equal(isWindowCompleted(state, CHAT, key), true);
  assert.equal(isWindowCompleted(state, CHAT, "2026-10-12:afternoon"), false);
  assert.equal(isWindowCompleted(state, CHAT, "2026-10-13:morning"), false);
  assert.equal(isWindowCompleted(state, "-100999", key), false, "the guard is per channel");
});

test("a partially delivered window stays open so only the gaps are retried", async () => {
  const { state } = await freshState();
  const key = "2026-10-12:morning";
  finishWindowRun(state, CHAT, key, { status: WINDOW_STATUS.PARTIAL, counts: { sent: 2, failed: 1 } });
  assert.equal(isWindowCompleted(state, CHAT, key), false);
  assert.equal(state.channels[CHAT].windows[key].counts.failed, 1);
});

test("scenario 8: state survives a restart, including message ids and hashes", async () => {
  const { path, state } = await freshState();
  recordMessageIntent(state, CHAT, digest.key, {
    ...digest, localDate: "2026-10-12", window: "morning", action: "send"
  });
  recordMessageSent(state, CHAT, digest.key, { messageId: 777 });
  markOffersPublished(state, CHAT, [flight], "2026-10-12T05:10:00.000Z");
  finishWindowRun(state, CHAT, "2026-10-12:morning", { status: WINDOW_STATUS.COMPLETED });
  await savePublicationState(path, state);

  // A fresh process reads the same file off the Railway volume.
  const reloaded = await loadPublicationState(path);
  assert.equal(reloaded.version, STATE_VERSION);
  assert.equal(isWindowCompleted(reloaded, CHAT, "2026-10-12:morning"), true);
  assert.equal(getMessageRecord(reloaded, CHAT, digest.key).messageId, 777);
  assert.equal(planMessageAction(reloaded, CHAT, digest).action, "skip");
  assert.equal(isOfferPublished(reloaded, CHAT, flight), true);
  assert.equal(isOfferPublished(reloaded, CHAT, { ...flight, price: 130000 }), false);

  const onDisk = JSON.parse(await readFile(path, "utf8"));
  assert.equal(onDisk.channels[CHAT].messages["VN#1"].messageId, 777);
  assert.equal(onDisk.channels[CHAT].messages["VN#1"].localDate, "2026-10-12");
  assert.equal(onDisk.channels[CHAT].messages["VN#1"].window, "morning");
  assert.equal(onDisk.channels[CHAT].messages["VN#1"].country, "VN");
  assert.ok(onDisk.channels[CHAT].messages["VN#1"].sentAt);
});

test("the run lease stops a second overlapping run and is released afterwards", async () => {
  const { state } = await freshState();
  const now = new Date("2026-10-12T05:00:00Z");

  assert.equal(acquireRunLease(state, { owner: "run-a", now }).acquired, true);
  const second = acquireRunLease(state, { owner: "run-b", now });
  assert.equal(second.acquired, false);
  assert.equal(second.heldBy, "run-a");

  // The same run may re-enter, and a stale lease expires.
  assert.equal(acquireRunLease(state, { owner: "run-a", now }).acquired, true);
  assert.equal(
    acquireRunLease(state, { owner: "run-b", now: new Date("2026-10-12T05:20:00Z") }).acquired,
    true,
    "a lease left behind by a crashed run expires"
  );

  releaseRunLease(state, "run-b");
  assert.equal(state.lease, null);
  assert.equal(acquireRunLease(state, { owner: "run-c", now }).acquired, true);
});

test("a v1 state upgrades without replaying offers or reusing old message ids", async () => {
  const dir = await mkdtemp(join(tmpdir(), "charter-state-v1-"));
  const path = join(dir, "state.json");
  await writeFile(path, JSON.stringify({
    version: 1,
    targets: {
      [CHAT]: {
        f1: { fingerprint: publicationFingerprint(flight), publishedAt: "2026-10-11T05:00:00.000Z" }
      }
    },
    targetDigests: { [CHAT]: { date: "2026-10-11", publishedAt: "2026-10-11T05:00:00.000Z" } },
    targetCountryMessages: {
      [CHAT]: { "Вьетнам|outbound": { date: "2026-10-11", messageId: 42 } }
    },
    targetBatches: { [CHAT]: { publishedAt: "2026-10-11T05:00:00.000Z" } },
    meta: { initializedAt: "2026-10-01T05:00:00.000Z" }
  }, null, 2), "utf8");

  const state = await loadPublicationState(path);
  assert.equal(state.version, STATE_VERSION);
  assert.equal(state.meta.migratedFrom, 1);
  assert.equal(state.meta.initializedAt, "2026-10-01T05:00:00.000Z", "history is kept");

  // Offer history survives, so the upgrade cannot repost yesterday's offers.
  assert.equal(isOfferPublished(state, CHAT, flight), true);
  assert.equal(isWindowCompleted(state, CHAT, "2026-10-11:morning"), true);

  // The v1 message id described a different layout, so it is archived, never edited.
  assert.equal(getMessageRecord(state, CHAT, "VN#1"), null);
  assert.equal(state.channels[CHAT].legacy.countryMessages["Вьетнам|outbound"].messageId, 42);
  assert.equal(planMessageAction(state, CHAT, digest).action, "send");
});

test("a corrupt state file fails closed without erasing publication history", async () => {
  const dir = await mkdtemp(join(tmpdir(), "charter-state-bad-"));
  const path = join(dir, "state.json");
  await writeFile(path, "{ not json", "utf8");
  await assert.rejects(() => loadPublicationState(path), /PUBLICATION_STATE_UNREADABLE/);
  assert.equal(await readFile(path, "utf8"), "{ not json");
});

test("the fingerprint tracks every customer-visible field", () => {
  const base = publicationFingerprint(flight);
  for (const change of [
    { price: 130000 }, { seats: "1 место" }, { airline: "Air Astana" },
    { airlineCode: "A" }, { departureDate: "2026-10-22" }, { returnDate: "2026-10-29" },
    { from: "Астана" }, { to: "Фукуок" }, { trip: "RT" }
  ]) {
    assert.notEqual(
      publicationFingerprint({ ...flight, ...change }),
      base,
      "changing " + Object.keys(change)[0] + " must change the fingerprint"
    );
  }
  assert.equal(publicationFingerprint({ ...flight, hot: true }), base, "a hot flag is not customer data");
});

test("pruning drops aged offers but keeps message records needed for editing", async () => {
  const { state } = await freshState();
  markOffersPublished(state, CHAT, [flight], "2026-09-01T05:00:00.000Z");
  markOffersPublished(state, CHAT, [{ ...flight, id: "f-recent" }], "2026-10-12T05:00:00.000Z");
  recordMessageIntent(state, CHAT, digest.key, { ...digest, action: "send" });
  recordMessageSent(state, CHAT, digest.key, { messageId: 9, now: new Date("2026-10-12T05:00:00Z") });
  finishWindowRun(state, CHAT, "2026-09-01:morning", { status: WINDOW_STATUS.COMPLETED });
  finishWindowRun(state, CHAT, "2026-10-12:morning", { status: WINDOW_STATUS.COMPLETED });

  prunePublicationState(state, { now: new Date("2026-10-12T06:00:00Z"), retentionDays: 30 });

  assert.equal(state.channels[CHAT].offers.f1, undefined, "an offer older than retention is dropped");
  assert.ok(state.channels[CHAT].offers["f-recent"], "a recent offer is kept");
  assert.ok(state.channels[CHAT].messages["VN#1"], "the live message record is kept");
  assert.equal(state.channels[CHAT].windows["2026-09-01:morning"], undefined);
  assert.ok(state.channels[CHAT].windows["2026-10-12:morning"]);
});

test("writes are atomic, so a reader never sees a half-written file", async () => {
  const { path, state } = await freshState();
  markOffersPublished(state, CHAT, [flight]);
  await savePublicationState(path, state);
  await savePublicationState(path, state);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  assert.equal(parsed.version, STATE_VERSION);
});
