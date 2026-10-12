import test from "node:test";
import assert from "node:assert/strict";
import {
  PUBLICATION_WINDOWS,
  localClock,
  resolvePublicationWindow,
  windowKey
} from "../scripts/telegram-schedule.mjs";

/** Asia/Almaty is UTC+5 all year, so 10:00 local is 05:00Z. */
const atAlmaty = (hour, minute = 0) =>
  new Date(Date.UTC(2026, 9, 12, hour - 5, minute, 0));

test("only three windows exist and they are the agreed ones", () => {
  assert.deepEqual(
    PUBLICATION_WINDOWS.map(w => [w.id, w.startHour, w.endHour]),
    [["morning", 10, 12], ["afternoon", 14, 15], ["evening", 17, 18]]
  );
  assert.equal(PUBLICATION_WINDOWS[0].kind, "full");
  assert.equal(PUBLICATION_WINDOWS[1].kind, "update");
  assert.equal(PUBLICATION_WINDOWS[2].kind, "update");
});

test("windows are open from their first minute to the last minute before closing", () => {
  const cases = [
    [10, 0, "morning"], [10, 1, "morning"], [11, 59, "morning"],
    [14, 0, "afternoon"], [14, 59, "afternoon"],
    [17, 0, "evening"], [17, 59, "evening"]
  ];
  for (const [hour, minute, expected] of cases) {
    const resolved = resolvePublicationWindow(atAlmaty(hour, minute));
    assert.equal(resolved.open, true, hour + ":" + minute);
    assert.equal(resolved.window.id, expected, hour + ":" + minute);
  }
});

test("scenario 9: publishing is forbidden at 12:00, 15:00 and 18:00 sharp", () => {
  for (const hour of [12, 15, 18]) {
    const resolved = resolvePublicationWindow(atAlmaty(hour, 0));
    assert.equal(resolved.open, false, hour + ":00 must be closed");
    assert.equal(resolved.window, null);
    assert.equal(resolved.reason, "OUTSIDE_PUBLICATION_WINDOW");
  }
});

test("scenario 10: every hour outside the three windows is closed", () => {
  const openHours = new Set([10, 11, 14, 17]);
  for (let hour = 0; hour < 24; hour += 1) {
    const resolved = resolvePublicationWindow(atAlmaty(hour, 30));
    assert.equal(resolved.open, openHours.has(hour), "hour " + hour);
  }
});

test("the local date and time are reported in Asia/Almaty, not UTC", () => {
  // 20:30 UTC is already the next calendar day in Almaty.
  const clock = localClock(new Date("2026-10-12T20:30:00Z"));
  assert.equal(clock.date, "2026-10-13");
  assert.equal(clock.hour, 1);
  assert.equal(clock.minute, 30);
  assert.equal(resolvePublicationWindow(new Date("2026-10-12T20:30:00Z")).open, false);
});

test("the window guard key is scoped to one local date and one window", () => {
  assert.equal(windowKey("2026-10-12", "morning"), "2026-10-12:morning");
  assert.notEqual(
    windowKey("2026-10-12", "morning"),
    windowKey("2026-10-12", "afternoon")
  );
  assert.notEqual(
    windowKey("2026-10-12", "morning"),
    windowKey("2026-10-13", "morning")
  );
});

test("an unusable time zone closes the window instead of failing open", () => {
  const resolved = resolvePublicationWindow(new Date(), { timeZone: "Not/AZone" });
  assert.equal(resolved.open, false);
  assert.equal(resolved.reason, "INVALID_TIME_ZONE");
});
