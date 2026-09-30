import test from "node:test";
import assert from "node:assert/strict";
import { validateFlightsForPublication } from "../scripts/flight-validator.mjs";

const now = new Date("2026-09-30T12:00:00Z");

function flight(overrides = {}) {
  return {
    id: overrides.id || "flight-" + Math.random(),
    from: "Алматы",
    to: "Пхукет",
    price: 78000,
    trip: "OW",
    departureDate: "2026-10-29",
    sourceIds: ["telegram:source-a"],
    ...overrides
  };
}

test("quarantines an unconfirmed same-day mirrored route pair", () => {
  const outbound = flight({ id: "out", from: "Алматы", to: "Пхукет", price: 78000 });
  const inbound = flight({
    id: "back",
    from: "Пхукет",
    to: "Алматы",
    price: 79000,
    sourceIds: ["telegram:source-b"]
  });

  const result = validateFlightsForPublication([outbound, inbound], { now });

  assert.deepEqual(result.verified, []);
  assert.equal(result.needsReview.length, 2);
  assert.ok(result.needsReview.every(item => item.reason === "MIRRORED_ROUTE_UNCONFIRMED"));
});

test("keeps a corroborated direction and quarantines only the weak opposite direction", () => {
  const outbound = flight({
    id: "out",
    sourceIds: ["telegram:source-a", "telegram:source-c"]
  });
  const inbound = flight({
    id: "back",
    from: "Пхукет",
    to: "Алматы",
    sourceIds: ["telegram:source-b"]
  });

  const result = validateFlightsForPublication([outbound, inbound], { now });

  assert.deepEqual(result.verified.map(item => item.id), ["out"]);
  assert.deepEqual(result.needsReview.map(item => item.flight.id), ["back"]);
});

test("allows both mirrored directions when both are independently corroborated", () => {
  const outbound = flight({
    id: "out",
    sourceIds: ["telegram:source-a", "telegram:source-c"]
  });
  const inbound = flight({
    id: "back",
    from: "Пхукет",
    to: "Алматы",
    sourceIds: ["telegram:source-b", "telegram:source-d"]
  });

  const result = validateFlightsForPublication([outbound, inbound], { now });

  assert.deepEqual(result.verified.map(item => item.id).sort(), ["back", "out"]);
  assert.equal(result.needsReview.length, 0);
});

test("does not block unrelated single-source routes", () => {
  const first = flight({ id: "first" });
  const second = flight({
    id: "second",
    from: "Астана",
    to: "Анталия",
    departureDate: "2026-10-30",
    sourceIds: ["telegram:source-b"]
  });

  const result = validateFlightsForPublication([first, second], { now });

  assert.deepEqual(result.verified.map(item => item.id).sort(), ["first", "second"]);
  assert.equal(result.needsReview.length, 0);
});

test("does not treat opposite directions on different dates as a conflict", () => {
  const outbound = flight({ id: "out" });
  const inbound = flight({
    id: "back",
    from: "Пхукет",
    to: "Алматы",
    departureDate: "2026-10-30"
  });

  const result = validateFlightsForPublication([outbound, inbound], { now });

  assert.deepEqual(result.verified.map(item => item.id).sort(), ["back", "out"]);
  assert.equal(result.needsReview.length, 0);
});

test("rejects structurally invalid flights before publication", () => {
  const result = validateFlightsForPublication([
    flight({ id: "same-city", from: "Алматы", to: "Алматы" }),
    flight({ id: "bad-price", price: 0 })
  ], { now });

  assert.equal(result.verified.length, 0);
  assert.deepEqual(
    result.rejected.map(item => item.reason).sort(),
    ["INVALID_PRICE", "SAME_ORIGIN_DESTINATION"]
  );
});
