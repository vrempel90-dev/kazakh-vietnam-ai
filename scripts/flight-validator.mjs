import { resolveCity } from "./charter-geo.mjs";
import { localDayOffset } from "./telegram-schedule.mjs";

function normalizeCity(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^а-яёa-z0-9]/giu, "");
}

/** Furthest departure we accept, in days. */
const MAX_DEPARTURE_HORIZON_DAYS = 365;

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

  // Counted in Asia/Almaty, and `0` - a departure today - is accepted. The
  // previous `offset <= 0` test, measured against the UTC calendar day,
  // rejected every same-day charter seat as "out of range".
  const offset = localDayOffset(flight?.departureDate, now);
  if (offset == null) return "INVALID_DEPARTURE_DATE";
  if (offset < 0) return "DEPARTURE_IN_THE_PAST";
  if (offset > MAX_DEPARTURE_HORIZON_DAYS) return "DEPARTURE_BEYOND_HORIZON";

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
 * A charter flying out and back on the same day is the normal case, not a
 * suspicious one: one aircraft operates both legs, and channels post the pair
 * together.
 *
 * The mirrored-route quarantine used to fire on exactly that shape, and
 * because a single channel usually carries both legs it quarantined BOTH
 * directions - so the whole Astana <-> Phu Quoc programme, outbound and
 * inbound, was held back for review and never published. Together with the
 * undecoded `&gt;` this was the second large source of missing tickets.
 *
 * A route with exactly one Kazakhstan endpoint has no direction ambiguity to
 * protect against: the digest renders "БИЛЕТЫ ТУДА" and "ОБРАТНЫЕ БИЛЕТЫ" as
 * separate sections, and both are legitimate products. The guard is therefore
 * scoped to routes that are NOT a clean Kazakhstan-to-foreign pair, which is
 * where a parser mix-up could still produce a direction nobody sells.
 */
function isUnambiguousKazakhstanPair(flight) {
  const from = resolveCity(flight?.from);
  const to = resolveCity(flight?.to);
  if (!from || !to) return false;
  const fromKz = from.country.code === "KZ";
  const toKz = to.country.code === "KZ";
  return fromKz !== toKz;
}

/**
 * Protects auto-publication from ambiguous Telegram route direction.
 *
 * A mirrored same-day one-way pair (A -> B and B -> A) is treated as ambiguous
 * when a direction is supported by fewer than mirroredRouteMinSources distinct
 * sources. Weak directions are quarantined instead of being published.
 *
 * Kazakhstan-to-foreign pairs are exempt, for the reason above.
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
    if (isUnambiguousKazakhstanPair(flight)) continue;
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
