/**
 * Publication schedule.
 *
 * Collection may run every 15 minutes, but sending is only ever allowed inside
 * three local windows. Everything outside them is refused here, so no caller
 * can publish off-schedule by accident.
 */

export const PUBLICATION_TIME_ZONE = "Asia/Almaty";

/**
 * `kind: "full"` is the complete morning digest, `kind: "update"` only sends
 * country digests whose content actually changed.
 */
export const PUBLICATION_WINDOWS = [
  { id: "morning", startHour: 10, endHour: 12, kind: "full" },
  { id: "afternoon", startHour: 14, endHour: 15, kind: "update" },
  { id: "evening", startHour: 17, endHour: 18, kind: "update" }
];

/** Wall-clock fields for `now` in the publication time zone. */
export function localClock(now = new Date(), timeZone = PUBLICATION_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);

  const value = type => parts.find(part => part.type === type)?.value || "";
  return {
    timeZone,
    date: value("year") + "-" + value("month") + "-" + value("day"),
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}

/**
 * Resolves the active window, if any.
 *
 * A window is open for `startHour <= hour < endHour`, so 12:00, 15:00 and
 * 18:00 are already closed.
 */
export function resolvePublicationWindow(now = new Date(), {
  timeZone = PUBLICATION_TIME_ZONE,
  windows = PUBLICATION_WINDOWS
} = {}) {
  let clock;
  try {
    clock = localClock(now, timeZone);
  } catch {
    return {
      open: false,
      window: null,
      timeZone,
      localDate: null,
      localHour: null,
      localMinute: null,
      reason: "INVALID_TIME_ZONE"
    };
  }

  if (!Number.isFinite(clock.hour)) {
    return {
      open: false,
      window: null,
      timeZone,
      localDate: clock.date,
      localHour: null,
      localMinute: null,
      reason: "UNREADABLE_LOCAL_TIME"
    };
  }

  const window = windows.find(item =>
    clock.hour >= item.startHour && clock.hour < item.endHour
  ) || null;

  return {
    open: Boolean(window),
    window,
    timeZone,
    localDate: clock.date,
    localHour: clock.hour,
    localMinute: clock.minute,
    reason: window ? null : "OUTSIDE_PUBLICATION_WINDOW"
  };
}

/** Key identifying one window occurrence, used for the per-channel guard. */
export function windowKey(localDate, windowId) {
  return String(localDate || "") + ":" + String(windowId || "");
}

/** Human-readable schedule summary for logs and reports. */
export function describeSchedule(timeZone = PUBLICATION_TIME_ZONE) {
  return PUBLICATION_WINDOWS
    .map(item =>
      item.id + " "
      + String(item.startHour).padStart(2, "0") + ":00-"
      + String(item.endHour).padStart(2, "0") + ":00 "
      + timeZone
    )
    .join(", ");
}
