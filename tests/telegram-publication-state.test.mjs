import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializePublicationState,
  isPublicationPending,
  isPublicationStateInitialized,
  isTargetPublishAllowed,
  loadPublicationState,
  markFlightsPublished,
  markTargetBatchPublished,
  prunePublicationState,
  publicationFingerprint,
  savePublicationState
} from "../scripts/telegram-publication-state.mjs";

const flight = {
  id: "flight-1",
  from: "Алматы",
  to: "Камрань",
  trip: "OW",
  price: 125000,
  airline: "SCAT",
  seats: "3 места",
  departureDate: "2026-10-01"
};

const dir = await mkdtemp(join(tmpdir(), "charter-publish-state-"));
const path = join(dir, "state.json");

const state = await loadPublicationState(path);
assert.equal(isPublicationStateInitialized(state), false);
assert.equal(isPublicationPending(state, "@channel", flight), true);

initializePublicationState(state, "2026-09-27T08:00:00.000Z");
assert.equal(isPublicationStateInitialized(state), true);

markFlightsPublished(state, "@channel", [flight], "2026-09-27T08:00:00.000Z");
assert.equal(
  isPublicationPending(state, "@channel", flight, {
    now: new Date("2026-09-27T09:00:00.000Z"),
    cooldownHours: 24
  }),
  false
);
assert.equal(
  isPublicationPending(state, "@channel", { ...flight, price: 126000 }, {
    now: new Date("2026-09-27T09:00:00.000Z"),
    cooldownHours: 24
  }),
  false,
  "price change must not create another post during the anti-duplicate cooldown"
);
assert.equal(
  isPublicationPending(state, "@channel", { ...flight, price: 126000 }, {
    now: new Date("2026-09-28T09:00:00.000Z"),
    cooldownHours: 24
  }),
  true,
  "material changes can be republished after cooldown"
);

assert.equal(
  isTargetPublishAllowed(state, "@channel", {
    now: new Date("2026-09-27T08:00:00.000Z"),
    minIntervalMinutes: 60
  }),
  true
);
markTargetBatchPublished(state, "@channel", "2026-09-27T08:00:00.000Z");
assert.equal(
  isTargetPublishAllowed(state, "@channel", {
    now: new Date("2026-09-27T08:30:00.000Z"),
    minIntervalMinutes: 60
  }),
  false
);
assert.equal(
  isTargetPublishAllowed(state, "@channel", {
    now: new Date("2026-09-27T09:00:00.000Z"),
    minIntervalMinutes: 60
  }),
  true
);

await savePublicationState(path, state);
const stored = JSON.parse(await readFile(path, "utf8"));
assert.equal(stored.targets["@channel"]["flight-1"].fingerprint, publicationFingerprint(flight));
assert.equal(stored.meta.initializedAt, "2026-09-27T08:00:00.000Z");
assert.equal(stored.targetBatches["@channel"].publishedAt, "2026-09-27T08:00:00.000Z");

const reloaded = await loadPublicationState(path);
assert.equal(isPublicationStateInitialized(reloaded), true);
assert.equal(
  isPublicationPending(reloaded, "@channel", flight, {
    now: new Date("2026-09-27T10:00:00.000Z")
  }),
  false
);

prunePublicationState(reloaded, {
  now: new Date("2026-11-15T00:00:00.000Z"),
  retentionDays: 30
});
assert.equal(reloaded.targets["@channel"]["flight-1"], undefined);

console.log("Telegram publication state bootstrap, anti-duplicate cooldown, throttling, and persistence: passed");
