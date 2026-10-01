import assert from "node:assert/strict";
import { hasMaterialChange, reconcileLifecycle } from "../scripts/offer-lifecycle.mjs";

const now = new Date("2026-09-26T15:30:00.000Z");

const stableFlight = {
  id: "stable",
  from: "Алматы",
  to: "Камрань",
  price: 218000,
  trip: "RT",
  seats: "Наличие уточняется",
  airline: "SCAT",
  departureDate: "2026-09-30",
  returnDate: "2026-10-08"
};

const existing = {
  flights: [{
    ...stableFlight,
    publishedAt: "2026-09-24T12:00:00.000Z",
    updatedAt: "2026-09-24T12:00:00.000Z",
    expiresAt: "2026-09-25T12:00:00.000Z"
  }]
};

const [renewed] = reconcileLifecycle([stableFlight], existing, now, 24);
assert.equal(renewed.publishedAt, "2026-09-24T12:00:00.000Z");
assert.equal(renewed.updatedAt, "2026-09-24T12:00:00.000Z");
assert.equal(renewed.lastSeenAt, now.toISOString());
assert.equal(renewed.expiresAt, "2026-09-27T15:30:00.000Z");
assert.equal(hasMaterialChange(existing.flights[0], stableFlight), false);

const changedFlight = { ...stableFlight, price: 225000 };
const [changed] = reconcileLifecycle([changedFlight], existing, now, 24);
assert.equal(changed.publishedAt, now.toISOString());
assert.equal(changed.updatedAt, now.toISOString());
assert.equal(changed.expiresAt, "2026-09-27T15:30:00.000Z");
assert.equal(hasMaterialChange(existing.flights[0], changedFlight), true);

const [created] = reconcileLifecycle([{ ...stableFlight, id: "new" }], existing, now, 12);
assert.equal(created.publishedAt, now.toISOString());
assert.equal(created.updatedAt, now.toISOString());
assert.equal(created.expiresAt, "2026-09-27T03:30:00.000Z");

for (const invalidTtl of [Infinity, -Infinity, NaN, 0, -1, "invalid", 1e300]) {
  const [flight] = reconcileLifecycle([stableFlight], existing, now, invalidTtl);
  assert.equal(flight.expiresAt, "2026-09-27T15:30:00.000Z", `Invalid TTL ${String(invalidTtl)} uses the existing 24h default`);
}
const [migrated] = reconcileLifecycle([{ ...stableFlight, id: "new-identity", legacyId: "stable" }], existing, now, 24);
assert.equal(migrated.publishedAt, existing.flights[0].publishedAt, "Identity migration preserves observed publication timestamp");
const [repairedTimestamps] = reconcileLifecycle([stableFlight], { flights: [{ ...stableFlight, publishedAt: "invalid", updatedAt: "2099-01-01T00:00:00Z" }] }, now, 24);
assert.equal(repairedTimestamps.publishedAt, now.toISOString());
assert.equal(repairedTimestamps.updatedAt, now.toISOString());
assert.deepEqual(reconcileLifecycle([], existing, now, 24), [], "Offers absent from live sources do not persist through lifecycle reconciliation");

console.log("Offer lifecycle live re-observation TTL, price updates, identity migration, invalid TTL/timestamps, and absent-offer expiry: passed");
