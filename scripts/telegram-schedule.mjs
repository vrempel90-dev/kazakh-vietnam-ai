/**
 * Publication schedule.
 *
 * Collection may run every 15 minutes, but sending is only ever allowed inside
 * three local windows. Everything outside them is refused here, so no caller
 * can publish off-schedule by accident.
 */

export const PUBLICATION_TIME_ZONE = "Asia/Almaty";

/**
 * Commercial regions, agreed with the client. One region owns one window, and
 * a country is published in that window only.
 *
 * This table is the configuration: to move a country, move its code here. No
 * other module may decide when a country is allowed to be published.
 */
export const REGIONS = [
  { id: "asia", name: "Азия", countries: ["VN", "TH", "CN", "MY", "MV", "LK", "IN"] },
  { id: "middle-east", name: "Ближний Восток", countries: ["AE", "OM", "EG", "TR"] },
  { id: "europe", name: "Европа", countries: ["IT", "CZ", "RS", "HU", "DE"] }
];

/**
 * `kind: "full"` is the complete regional digest for that window, `kind:
 * "update"` only sends country digests whose content actually changed inside
 * the same publication day.
 */
export const PUBLICATION_WINDOWS = [
  { id: "morning", startHour: 10, endHour: 12, kind: "full", region: "asia" },
  { id: "afternoon", startHour: 14, endHour: 15, kind: "update", region: "middle-east" },
  { id: "evening", startHour: 17, endHour: 18, kind: "update", region: "europe" }
];

const REGION_BY_ID = new Map(REGIONS.map(region => [region.id, region]));
const REGION_BY_COUNTRY = new Map(
  REGIONS.flatMap(region => region.countries.map(code => [code, region]))
);

export function regionForCountry(code) {
  return REGION_BY_COUNTRY.get(String(code || "").toUpperCase()) || null;
}

/**
 * Countries that are never published, by name.
 *
 * The rule is a BLOCK list, not an allow list: the client asked for every
 * country except Uzbekistan. Uzbekistan in practice only appeared as a flight
 * between two foreign countries (Sharjah -> Tashkent), which is refused anyway
 * for having no Kazakhstan endpoint - this is the belt to that braces, because
 * a Kazakhstan-to-Tashkent charter would otherwise be publishable.
 *
 * To stop publishing a country, add its code here and nowhere else.
 */
export const BLOCKED_COUNTRY_CODES = ["UZ"];

const BLOCKED = new Set(BLOCKED_COUNTRY_CODES);

/**
 * The window a country with no region of its own publishes in.
 *
 * Exactly ONE window, never several. The `all-windows` default this replaces
 * is what published Uzbekistan and Saudi Arabia three times a day, in every
 * window, and no environment variable may bring that behaviour back.
 */
const DEFAULT_REGION_ID = "middle-east";

/** Countries a region claims explicitly, each with its own window. */
export function allowedCountryCodes() {
  return [...REGION_BY_COUNTRY.keys()].sort();
}

/** True unless the country is on the block list above. */
export function isPublishableCountry(code) {
  const normalized = String(code || "").toUpperCase();
  return Boolean(normalized) && !BLOCKED.has(normalized);
}

/** True when the country is refused by name. */
export function isBlockedCountry(code) {
  return BLOCKED.has(String(code || "").toUpperCase());
}

/** The region a window publishes, or null. */
export function regionForWindow(windowId) {
  const window = PUBLICATION_WINDOWS.find(item => item.id === windowId);
  return window ? REGION_BY_ID.get(window.region) || null : null;
}

/**
 * Decides whether a country may be published in a window.
 *
 * Returns `{ allowed, reason, region }`. `reason` names the decision so the run
 * report can state why a digest was not sent instead of leaving a silent gap.
 *
 * A country no region claims is refused outright: there is no policy, no
 * default and no override that lets it through. `COUNTRY_NOT_ALLOWED` is a
 * refusal, not a loss - the country is not ours to publish at all.
 */
export function isCountryAllowedInWindow(code, windowId) {
  if (isBlockedCountry(code)) {
    return { allowed: false, reason: "COUNTRY_NOT_ALLOWED", region: null };
  }

  // A country no region claims still gets exactly ONE window, never all of
  // them. Move it into REGIONS above to give it a window of its own.
  const region = regionForCountry(code) || REGION_BY_ID.get(DEFAULT_REGION_ID) || null;

  if (!region) {
    return { allowed: false, reason: "NO_REGION_CONFIGURED", region: null };
  }

  const window = PUBLICATION_WINDOWS.find(item => item.region === region.id);
  return window && window.id === windowId
    ? { allowed: true, reason: null, region }
    : {
        allowed: false,
        reason: "REGION_WINDOW_IS_" + String(window?.id || "none").toUpperCase(),
        region
      };
}

/** Countries present in the data that are refused by name. */
export function disallowedCountries(codes) {
  return [...new Set((Array.isArray(codes) ? codes : []).map(code => String(code || "").toUpperCase()))]
    .filter(code => code && BLOCKED.has(code))
    .sort();
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whole days from "today" to `iso`, counted in the publication time zone.
 *
 * `0` is today, `1` tomorrow, a negative number is in the past. Every freshness
 * check in the pipeline goes through this, because the UTC-based arithmetic it
 * replaced read a different calendar day than the business does: Almaty is
 * UTC+5, so between 05:00 and midnight local the UTC date is still yesterday's
 * and a flight leaving *today* measured as offset 1 - or, after midnight UTC,
 * today's flight measured as 0 and then thrown away by an `offset <= 0` guard.
 *
 * Returns null when the date is unparseable, so callers can report
 * `INVALID_DEPARTURE_DATE` instead of guessing.
 */
export function localDayOffset(iso, now = new Date(), timeZone = PUBLICATION_TIME_ZONE) {
  const text = String(iso || "");
  if (!ISO_DATE.test(text)) return null;

  const target = Date.parse(text + "T12:00:00Z");
  if (!Number.isFinite(target)) return null;

  let today;
  try {
    today = localClock(now, timeZone).date;
  } catch {
    return null;
  }
  const base = Date.parse(today + "T12:00:00Z");
  if (!Number.isFinite(base)) return null;

  return Math.round((target - base) / 86400000);
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
      + " [" + (REGION_BY_ID.get(item.region)?.name || item.region) + "]"
    )
    .join(", ");
}
