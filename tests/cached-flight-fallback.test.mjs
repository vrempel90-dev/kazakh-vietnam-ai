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

console.log("Cached fallback keeps only recent future customer offers and marks them for confirmation: passed");
