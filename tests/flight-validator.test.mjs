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

test("allows legitimate same-day mirrored OW routes from single sources", () => {
  const outbound = flight({ id: "out", from: "Алматы", to: "Пхукет", price: 78000 });
  const inbound = flight({
    id: "back",
    from: "Пхукет",
    to: "Алматы",
    price: 79000,
    sourceIds: ["telegram:source-b"]
  });

  const result = validateFlightsForPublication([outbound, inbound], { now });

  assert.deepEqual(result.verified, [outbound, inbound]);
  assert.equal(result.needsReview.length, 0);
});

test("source count in one direction does not invalidate the opposite direction", () => {
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

  assert.deepEqual(result.verified.map(item => item.id), ["out", "back"]);
  assert.deepEqual(result.needsReview, []);
});

test("validates mirrored OW and RT matrix independently of sources, dates and prices", () => {
  for (const trip of ["OW", "RT"]) {
    for (const sameDate of [true, false]) {
      for (const sameSource of [true, false]) {
        for (const samePrice of [true, false]) {
          const out = flight({ id: "out", trip, ...(trip === "RT" ? { returnDate: "2026-11-05" } : {}) });
          const back = flight({
            id: "back", from: "Пхукет", to: "Алматы", trip,
            departureDate: sameDate ? out.departureDate : "2026-10-30",
            sourceIds: sameSource ? out.sourceIds : ["telegram:source-b", "telegram:source-c"],
            price: samePrice ? out.price : 120000,
            ...(trip === "RT" ? { returnDate: "2026-11-07" } : {})
          });
          const result = validateFlightsForPublication([out, back], { now });
          assert.deepEqual(result.verified, [out, back]);
          assert.equal(result.rejected.length, 0);
        }
      }
    }
  }
});

test("rejects invalid calendar dates and inconsistent round trips", () => {
  const cases = [
    [{ departureDate: "2027-02-30" }, "INVALID_DEPARTURE_DATE"],
    [{ departureDate: "2026-10-29T00:00:00Z" }, "INVALID_DEPARTURE_DATE"],
    [{ trip: "RT" }, "INVALID_RETURN_DATE"],
    [{ trip: "RT", returnDate: "2027-02-30" }, "INVALID_RETURN_DATE"],
    [{ trip: "RT", returnDate: "2026-10-28" }, "RETURN_DATE_NOT_AFTER_DEPARTURE"],
    [{ trip: "RT", returnDate: "2026-10-29" }, "RETURN_DATE_NOT_AFTER_DEPARTURE"],
    [{ trip: "OW", returnDate: "2026-11-05" }, "OW_HAS_RETURN_DATE"],
    [{ from: "OW Алматы" }, "INVALID_ROUTE"],
    [{ to: "Дубай 90 000 ₸" }, "INVALID_ROUTE"],
    [{ to: "<script>Дубай</script>" }, "INVALID_ROUTE"]
  ];
  for (const [overrides, expectedReason] of cases) {
    const result = validateFlightsForPublication([flight(overrides)], { now });
    assert.equal(result.verified.length, 0);
    assert.equal(result.rejected[0].reason, expectedReason);
  }
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

test("uses the Almaty flight calendar at local midnight", () => {
  const result = validateFlightsForPublication([
    flight({ id: "today", departureDate: "2026-10-01" }),
    flight({ id: "tomorrow", departureDate: "2026-10-02" })
  ], { now: new Date("2026-09-30T19:01:00Z") });
  assert.deepEqual(result.verified.map(item => item.id), ["tomorrow"]);
  assert.equal(result.rejected[0].reason, "DEPARTURE_DATE_OUT_OF_RANGE");
});
