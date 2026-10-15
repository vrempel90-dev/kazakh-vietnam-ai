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
  { id: "middle-east", name: "Ближний Восток", countries: ["AE", "OM", "EG"] },
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

/**
 * What to do with a country that no region claims (today: Turkey, South Korea,
 * Kyrgyzstan, Uzbekistan, Saudi Arabia and anything new the source starts
 * carrying). Half of the live inventory sits in such countries, so the default
 * preserves the behaviour they have had all along - they travel with every
 * window - until the client assigns them a region.
 *
 *  - `all-windows` (default)  publish in every window, as before
 *  - `hold`                   never publish; report in diagnostics
 *  - `morning|afternoon|evening`  publish only in that window
 */
export const UNASSIGNED_POLICIES = ["all-windows", "hold", ...PUBLICATION_WINDOWS.map(w => w.id)];

export function unassignedPolicy(env = process.env) {
  const raw = String(env?.TELEGRAM_UNASSIGNED_COUNTRY_POLICY || "").trim().toLowerCase();
  return UNASSIGNED_POLICIES.includes(raw) ? raw : "all-windows";
}

const REGION_BY_ID = new Map(REGIONS.map(region => [region.id, region]));
const REGION_BY_COUNTRY = new Map(
  REGIONS.flatMap(region => region.countries.map(code => [code, region]))
);

export function regionForCountry(code) {
  return REGION_BY_COUNTRY.get(String(code || "").toUpperCase()) || null;
}

export function regionForWindow(windowId) {
  const window = PUBLICATION_WINDOWS.find(item => item.id === windowId);
  return window ? REGION_BY_ID.get(window.region) || null : null;
}

/**
 * Decides whether a country may be published in a window.
 *
 * Returns `{ allowed, reason, region }`. `reason` names the decision so the run
 * report can state why a digest was not sent instead of leaving a silent gap.
 */
export function isCountryAllowedInWindow(code, windowId, { policy = "all-windows" } = {}) {
  const region = regionForCountry(code);

  if (region) {
    const window = PUBLICATION_WINDOWS.find(item => item.region === region.id);
    return window && window.id === windowId
      ? { allowed: true, reason: null, region }
      : {
          allowed: false,
          reason: "REGION_WINDOW_IS_" + String(window?.id || "none").toUpperCase(),
          region
        };
  }

  if (policy === "hold") {
    return { allowed: false, reason: "COUNTRY_HAS_NO_REGION", region: null };
  }
  if (policy === "all-windows") {
    return { allowed: true, reason: null, region: null };
  }
  return policy === windowId
    ? { allowed: true, reason: null, region: null }
    : { allowed: false, reason: "UNASSIGNED_WINDOW_IS_" + policy.toUpperCase(), region: null };
}

/** Countries present in the data that no region claims yet. */
export function unassignedCountries(codes) {
  return [...new Set((Array.isArray(codes) ? codes : []).map(code => String(code || "").toUpperCase()))]
    .filter(code => code && !REGION_BY_COUNTRY.has(code))
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
