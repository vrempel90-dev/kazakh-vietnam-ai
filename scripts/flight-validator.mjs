function normalizeCity(value) {
  return String(value || "").toLocaleLowerCase("ru-RU").replace(/[^а-яёa-z]/giu, "");
}

function validCity(value) {
  const text = String(value || "").trim();
  return text.length >= 2 && text.length <= 80
    && !/[\d<>:=\n\r]|→|->|⇄|⇆|↔|₸|https?:/iu.test(text)
    && !/^(?:OW|RT)(?:\s|$)|^(?:вылет|возврат|багаж|цена)(?:\s|:|$)/iu.test(text);
}

function isoDate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(text + "T12:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

function flightCalendarDay(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const value = type => Number(parts.find(part => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day"), 12));
}

function basicRejectReason(flight, now) {
  const from = normalizeCity(flight?.from);
  const to = normalizeCity(flight?.to);
  if (!from || !to) return "MISSING_ROUTE";
  if (!validCity(flight?.from) || !validCity(flight?.to)) return "INVALID_ROUTE";
  if (from === to) return "SAME_ORIGIN_DESTINATION";

  const price = Number(flight?.price);
  if (!Number.isFinite(price) || price <= 0) return "INVALID_PRICE";

  const departure = isoDate(flight?.departureDate);
  if (!departure) return "INVALID_DEPARTURE_DATE";
  const base = flightCalendarDay(now);
  const offset = Math.round((departure.getTime() - base.getTime()) / 86400000);
  if (offset <= 0 || offset > 365) return "DEPARTURE_DATE_OUT_OF_RANGE";

  if (!["OW", "RT"].includes(flight?.trip)) return "INVALID_TRIP_TYPE";
  if (flight.trip === "OW" && flight.returnDate) return "OW_HAS_RETURN_DATE";
  if (flight.trip === "RT") {
    const returning = isoDate(flight.returnDate);
    if (!returning) return "INVALID_RETURN_DATE";
    if (returning <= departure) return "RETURN_DATE_NOT_AFTER_DEPARTURE";
  }
  return null;
}

/** Validates each explicit route independently. Same-day opposite OW flights
 * are a normal turnaround, and source count does not prove a route is wrong. */
export function validateFlightsForPublication(flights, { now = new Date() } = {}) {
  const verified = [];
  const rejected = [];
  const reasons = {};
  for (const flight of Array.isArray(flights) ? flights : []) {
    const reason = basicRejectReason(flight, now);
    if (reason) {
      rejected.push({ flight, reason });
      reasons[reason] = (reasons[reason] || 0) + 1;
    } else {
      verified.push(flight);
    }
  }
  return {
    verified,
    needsReview: [],
    rejected,
    summary: {
      checked: Array.isArray(flights) ? flights.length : 0,
      verified: verified.length,
      needsReview: 0,
      rejected: rejected.length,
      reasons
    }
  };
}
