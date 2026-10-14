/**
 * Publication schedule.
 *
 * Collection may run every 15 minutes, but sending is only ever allowed inside
 * three local windows. Everything outside them is refused here, so no caller
 * can publish off-schedule by accident.
 */

import { readFileSync } from "node:fs";
import { classifyFlight, countryByCode, resolveCity, TICKET_CATEGORIES } from "./charter-geo.mjs";

export const PUBLICATION_TIME_ZONE = "Asia/Almaty";

/**
 * `kind: "full"` is the complete morning digest, `kind: "update"` only sends
 * country digests whose content actually changed.
 */
export const PUBLICATION_WINDOWS = validateWindows(JSON.parse(readFileSync(
  new URL("../config/telegram-publication-windows.json", import.meta.url), "utf8"
)));

function validateWindows(windows) {
  const fail = () => { throw new Error("INVALID_PUBLICATION_WINDOWS"); };
  if (!Array.isArray(windows) || !windows.length) fail();
  const ids = new Set();
  const countries = new Set();
  for (const item of windows) {
    if (!item || !/^[a-z][a-z0-9_-]*$/.test(item.id) || ids.has(item.id)
      || !Number.isInteger(item.startHour) || !Number.isInteger(item.endHour)
      || item.startHour < 0 || item.endHour > 24 || item.startHour >= item.endHour
      || !["full", "update"].includes(item.kind)
      || !Array.isArray(item.countries) || !item.countries.length) fail();
    ids.add(item.id);
    for (const code of item.countries) {
      if (!countryByCode(code) || code === "KZ" || code !== code.toUpperCase() || countries.has(code)) fail();
      countries.add(code);
    }
    if (item.cities != null && (typeof item.cities !== "object" || Array.isArray(item.cities))) fail();
    for (const [code, cities] of Object.entries(item.cities || {})) {
      if (!item.countries.includes(code) || !Array.isArray(cities) || !cities.length
        || cities.some(city => resolveCity(city)?.country.code !== code)) fail();
    }
  }
  const sorted = [...windows].sort((a, b) => a.startHour - b.startHour);
  if (sorted.some((item, index) => index && sorted[index - 1].endHour > item.startHour)) fail();
  return windows;
}

/** A malformed operator override closes publishing instead of using permissive defaults. */
export function publicationWindows(env = process.env) {
  const raw = env?.TELEGRAM_PUBLICATION_WINDOWS_JSON;
  if (!raw) return PUBLICATION_WINDOWS;
  try { return validateWindows(JSON.parse(raw)); }
  catch { throw new Error("INVALID_PUBLICATION_WINDOWS"); }
}

export function filterFlightsForWindow(flights, window) {
  const eligible = [];
  const excluded = [];
  for (const flight of flights) {
    const c = classifyFlight(flight);
    // Leave unresolved data to the renderer's detailed diagnostics.
    if (!c.country) { eligible.push(flight); continue; }
    const city = c.fromCity.country.code === "KZ" ? c.toCity : c.fromCity;
    const allowedCities = window?.cities?.[c.country.code];
    const allowed = window?.countries?.includes(c.country.code)
      && [TICKET_CATEGORIES.OUTBOUND, TICKET_CATEGORIES.INBOUND, TICKET_CATEGORIES.ROUND_TRIP].includes(c.category)
      && (!allowedCities || allowedCities.some(value => resolveCity(value)?.id === city.id));
    if (allowed) eligible.push(flight);
    else excluded.push({ id: flight.id, country: c.country.code, reason: "OUTSIDE_REGIONAL_WINDOW" });
  }
  return { eligible, excluded };
}

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
export function describeSchedule(timeZone = PUBLICATION_TIME_ZONE, windows = PUBLICATION_WINDOWS) {
  return windows
    .map(item =>
      item.id + " "
      + String(item.startHour).padStart(2, "0") + ":00-"
      + String(item.endHour).padStart(2, "0") + ":00 "
      + timeZone + " [" + item.countries.join(", ") + "]"
    )
    .join(", ");
}
