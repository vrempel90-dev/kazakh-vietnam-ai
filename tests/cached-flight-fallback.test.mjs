import assert from "node:assert/strict";
import { selectCachedFallbackFlights } from "../scripts/cached-flight-fallback.mjs";

const now = new Date("2026-09-27T07:30:00.000Z");
const existing = {
  generatedAt: "2026-09-25T14:27:01.514Z",
  flights: [
    {
      id: "valid",
      from: "Алматы",
      to: "Нячанг",
      departureDate: "2026-09-29",
      returnDate: "2026-10-06",
      price: 179000,
      trip: "RT",
      seats: "Наличие уточняется",
      updatedAt: "2026-09-25T09:00:02.799Z"
    },
    {
      id: "today",
      from: "Алматы",
      to: "Пхукет",
      departureDate: "2026-09-27",
      price: 170000,
      trip: "OW",
      updatedAt: "2026-09-25T09:00:02.799Z"
    },
    {
      id: "bad-route",
      from: "Rt Астана-камрань",
      to: "Астана Air Astana",
      departureDate: "2026-09-29",
      price: 188000,
      trip: "OW",
      updatedAt: "2026-09-25T09:00:02.799Z"
    },
    {
      id: "too-old",
      from: "Астана",
      to: "Санья",
      departureDate: "2026-10-01",
      price: 190000,
      trip: "OW",
      updatedAt: "2026-09-20T09:00:02.799Z"
    }
  ]
};

const flights = selectCachedFallbackFlights(existing, { now, maxAgeHours: 72, ttlHours: 6 });
assert.deepEqual(flights.map(item => item.id), ["valid"]);
assert.equal(flights[0].cachedFallback, true);
assert.equal(flights[0].verificationNote, "Цена и наличие требуют подтверждения");
assert.equal(flights[0].offset, 2);
assert.equal(flights[0].expiresAt, "2026-09-27T13:30:00.000Z");

const valid = { ...existing.flights[0], lastSeenAt: "2026-09-27T06:30:00.000Z", expiresAt: "2026-09-27T09:30:00.000Z" };
const select = (flight, options = {}) => selectCachedFallbackFlights({ generatedAt: now.toISOString(), flights: [flight] }, { now, ...options });
assert.deepEqual(select({ ...valid, expiresAt: now.toISOString() }), [], "Expired offers cannot be resurrected from cache");
assert.deepEqual(select({ ...valid, expiresAt: "invalid" }), [], "Malformed explicit expiry fails closed");
assert.deepEqual(select({ ...valid, departureDate: "2026-09-26" }), []);
assert.deepEqual(select({ ...valid, departureDate: "2099-01-01" }), [], "Fallback must apply validator's departure horizon");
assert.deepEqual(select({ ...valid, departureDate: "2026-02-30" }), [], "Invalid calendar date must not normalize into a real date");
assert.deepEqual(select({ ...valid, from: "Алматы", to: "Алматы" }), [], "Fallback cannot bypass route validation");
assert.deepEqual(select({ ...valid, trip: "UNKNOWN" }), [], "Fallback cannot bypass trip validation");
assert.deepEqual(select({ ...valid, price: true }), []);
assert.deepEqual(select({ ...valid, price: Infinity }), []);
assert.deepEqual(select({ ...valid, lastSeenAt: "2026-09-27T08:30:00.000Z" }), [], "Future observation timestamps must not extend cache lifetime");
const [recentUnchanged] = select({ ...valid, updatedAt: "2026-09-01T00:00:00.000Z" });
assert.equal(recentUnchanged.id, valid.id, "lastSeenAt keeps genuinely re-observed unchanged offers available");
assert.equal(recentUnchanged.expiresAt, valid.expiresAt, "Fallback cannot extend original fresh expiry");
assert.equal(select({ ...valid, price: "179000" })[0].price, 179000);

const [firstFallback] = select(existing.flights[0]);
const [secondFallback] = selectCachedFallbackFlights({ generatedAt: "2026-09-27T09:30:00.000Z", flights: [firstFallback] }, { now: new Date("2026-09-27T09:30:00.000Z") });
assert.equal(secondFallback.expiresAt, firstFallback.expiresAt, "Repeated fallback reads cannot renew fallback TTL");
assert.equal(secondFallback.lastSeenAt, firstFallback.lastSeenAt, "Repeated fallback reads preserve source observation time");
assert.deepEqual(selectCachedFallbackFlights({ flights: [secondFallback] }, { now: new Date(firstFallback.expiresAt) }), [], "Cache stops precisely at its first fallback deadline");
const [ageBounded] = select({ ...valid, expiresAt: undefined, lastSeenAt: "2026-09-24T08:00:00.000Z" });
assert.equal(ageBounded.expiresAt, "2026-09-27T08:00:00.000Z", "Cache expiry cannot exceed max observation age");
assert.equal(select(valid, { maxAgeHours: Infinity, ttlHours: Infinity, maxFlights: Infinity }).length, 1, "Invalid configuration cannot crash fallback or generate infinite expiry");

const midnightOffer = { ...valid, departureDate: "2026-10-03", lastSeenAt: "2026-10-01T18:50:00Z", expiresAt: "2026-10-02T10:00:00Z" };
const [beforeMidnight] = selectCachedFallbackFlights({ flights: [midnightOffer] }, { now: new Date("2026-10-01T18:59:00Z") });
assert.equal(beforeMidnight.offset, 2, "At Almaty 23:59 the cached flight departs in two calendar days");
const [afterMidnight] = selectCachedFallbackFlights({ flights: [beforeMidnight] }, { now: new Date("2026-10-01T19:01:00Z") });
assert.equal(afterMidnight.offset, 1, "At Almaty 00:01 cached offsets advance with the business calendar, before UTC midnight");
assert.equal(afterMidnight.expiresAt, beforeMidnight.expiresAt, "Calendar offset refresh does not renew fallback expiry");
assert.equal(afterMidnight.lastSeenAt, beforeMidnight.lastSeenAt);
assert.deepEqual(selectCachedFallbackFlights({ flights: [{ ...midnightOffer, departureDate: "2026-10-02" }] }, { now: new Date("2026-10-01T19:01:00Z") }), [], "Same business-day departure is no longer a future fallback");

console.log("Cached fallback validation, original expiry, observation age, immutable fallback deadline, Almaty midnight offsets, invalid dates/prices/options: passed");
