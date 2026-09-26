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

console.log("Offer lifecycle refreshes TTL for every offer that is still present in a live source: passed");
