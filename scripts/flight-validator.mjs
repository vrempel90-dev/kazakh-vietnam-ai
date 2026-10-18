import { localClock } from "./telegram-schedule.mjs";

function normalizeCity(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^а-яёa-z0-9]/giu, "");
}

function dayOffset(iso, now) {
  const value = String(iso || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const target = new Date(value + "T12:00:00Z");
  if (Number.isNaN(target.getTime()) || target.toISOString().slice(0, 10) !== value) return null;
  const base = new Date(localClock(now).date + "T12:00:00Z");
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function sourceCount(flights) {
  const ids = new Set();
  for (const flight of flights) {
    for (const sourceId of flight?.sourceIds || []) {
      const clean = String(sourceId || "").trim();
      if (clean) ids.add(clean);
    }
  }
  return ids.size;
}

function basicRejectReason(flight, now) {
  const from = normalizeCity(flight?.from);
  const to = normalizeCity(flight?.to);
  if (!from || !to) return "MISSING_ROUTE";
  if (from === to) return "SAME_ORIGIN_DESTINATION";

  const price = Number(flight?.price);
  if (!Number.isFinite(price) || price <= 0) return "INVALID_PRICE";

  const offset = dayOffset(flight?.departureDate, now);
  if (offset == null) return "INVALID_DEPARTURE_DATE";
  if (offset < 0 || offset > 365) return "DEPARTURE_DATE_OUT_OF_RANGE";

  if (!["OW", "RT"].includes(String(flight?.trip || ""))) {
    return "INVALID_TRIP_TYPE";
  }

  return null;
}


// Do not advertise a disputed airline/route pairing solely because it was
// copied from Telegram. A manager reported that SCAT has no inbound Phuket
// to Almaty programme. Unknown carriers on that route also require review.
// This is a publication-safety hold, not an assertion about live schedules.
function carrierRouteReviewReason(flight) {
  const from = normalizeCity(flight?.from);
  const to = normalizeCity(flight?.to);
  const phuket = new Set(["пхукет", "phuket", "hkt"]);
  const almaty = new Set(["алматы", "almaty", "ala"]);
  if (!phuket.has(from) || !almaty.has(to) || flight?.trip !== "OW") return null;

  const airlineCode = String(flight?.airlineCode || "").trim().toUpperCase();
  const airline = String(flight?.airline || "").toLocaleLowerCase("ru-RU").trim();
  if (airlineCode === "S" || /(?:^|[^a-zа-яё])scat(?:$|[^a-zа-яё])|ска[тд]|sunday airlines/iu.test(airline)) {
    return "DISPUTED_SCAT_PHUKET_ALMATY_ROUTE";
  }
  if (!airline || airlineCode === "*" && !airline) {
    return "UNVERIFIED_CARRIER_PHUKET_ALMATY_ROUTE";
  }
  return null;
}

function pairKey(flight) {
  const from = normalizeCity(flight.from);
  const to = normalizeCity(flight.to);
  return [from, to].sort().join("<>") + "|" + flight.departureDate;
}

function directionKey(flight) {
  return normalizeCity(flight.from) + ">" + normalizeCity(flight.to);
}

function reasonCounts(items) {
  const counts = {};
  for (const item of items) {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
  }
  return counts;
}

/**
 * Protects auto-publication from ambiguous Telegram route direction.
 *
 * A mirrored same-day one-way pair (A -> B and B -> A) is treated as ambiguous
 * when a direction is supported by fewer than mirroredRouteMinSources distinct
 * sources. Weak directions are quarantined instead of being published.
 *
 * This is intentionally conservative: a valid same-day turnaround can still be
 * published automatically when it is independently corroborated.
 */
export function validateFlightsForPublication(flights, {
  now = new Date(),
  mirroredRouteMinSources = 2
} = {}) {
  const requiredSources = Math.max(
    1,
    Math.floor(Number(mirroredRouteMinSources) || 2)
  );

  const rejected = [];
  const candidates = [];

  for (const flight of Array.isArray(flights) ? flights : []) {
    const reason = basicRejectReason(flight, now);
    if (reason) {
      rejected.push({ flight, reason });
    } else {
      candidates.push(flight);
    }
  }

  const routeReview = [];
  const publishCandidates = [];
  for (const flight of candidates) {
    const reason = carrierRouteReviewReason(flight);
    if (reason) routeReview.push({ flight, reason });
    else publishCandidates.push(flight);
  }

  const mirroredGroups = new Map();
  for (const flight of publishCandidates) {
    if (flight.trip !== "OW" || flight.returnDate) continue;
    const key = pairKey(flight);
    const group = mirroredGroups.get(key) || new Map();
    const direction = directionKey(flight);
    const directionFlights = group.get(direction) || [];
    directionFlights.push(flight);
    group.set(direction, directionFlights);
    mirroredGroups.set(key, group);
  }

  const reviewById = new Map();

  for (const group of mirroredGroups.values()) {
    if (group.size < 2) continue;

    const directions = [...group.entries()];
    for (const [direction, directionFlights] of directions) {
      const support = sourceCount(directionFlights);
      if (support >= requiredSources) continue;

      const opposite = directions.find(([other]) => other !== direction);
      for (const flight of directionFlights) {
        const key = String(flight?.id || direction + "|" + flight?.price);
        reviewById.set(key, {
          flight,
          reason: "MIRRORED_ROUTE_UNCONFIRMED",
          details: {
            sourceCount: support,
            requiredSources,
            oppositeDirection: opposite?.[0] || null
          }
        });
      }
    }
  }

  const needsReview = [...routeReview, ...reviewById.values()];
  const reviewIds = new Set(needsReview.map(item => item.flight?.id).filter(Boolean));
  const reviewObjects = new Set(needsReview.map(item => item.flight));

  const verified = publishCandidates.filter(flight =>
    flight?.id ? !reviewIds.has(flight.id) : !reviewObjects.has(flight)
  );

  return {
    verified,
    needsReview,
    rejected,
    summary: {
      checked: (Array.isArray(flights) ? flights.length : 0),
      verified: verified.length,
      needsReview: needsReview.length,
      rejected: rejected.length,
      reasons: {
        ...reasonCounts(needsReview),
        ...reasonCounts(rejected)
      }
    }
  };
}
