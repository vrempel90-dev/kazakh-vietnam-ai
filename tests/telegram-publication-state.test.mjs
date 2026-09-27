import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPublicationPending,
  loadPublicationState,
  markFlightsPublished,
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
assert.equal(isPublicationPending(state, "@channel", flight), true);

markFlightsPublished(state, "@channel", [flight], "2026-09-27T08:00:00.000Z");
assert.equal(isPublicationPending(state, "@channel", flight), false);
assert.equal(
  isPublicationPending(state, "@channel", { ...flight, price: 126000 }),
  true,
  "price change must be publishable again"
);
assert.equal(
  isPublicationPending(state, "@channel", { ...flight, seats: "1 место" }),
  true,
  "availability change must be publishable again"
);

await savePublicationState(path, state);
const stored = JSON.parse(await readFile(path, "utf8"));
assert.equal(stored.targets["@channel"]["flight-1"].fingerprint, publicationFingerprint(flight));

const reloaded = await loadPublicationState(path);
assert.equal(isPublicationPending(reloaded, "@channel", flight), false);

prunePublicationState(reloaded, {
  now: new Date("2026-11-15T00:00:00.000Z"),
  retentionDays: 30
});
assert.equal(reloaded.targets["@channel"]["flight-1"], undefined);

console.log("Telegram publication state deduplication and persistence: passed");
