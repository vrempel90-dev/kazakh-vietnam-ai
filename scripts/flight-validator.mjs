function normalizeCity(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^а-яёa-z0-9]/giu, "");
}

function dayOffset(iso, now) {
  const target = new Date(String(iso || "") + "T12:00:00Z");
  if (Number.isNaN(target.getTime())) return null;
  const base = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12
  ));
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
  if (offset <= 0 || offset > 365) return "DEPARTURE_DATE_OUT_OF_RANGE";

  if (!["OW", "RT"].includes(String(flight?.trip || ""))) {
    return "INVALID_TRIP_TYPE";
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

  const mirroredGroups = new Map();
  for (const flight of candidates) {
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

  const needsReview = [...reviewById.values()];
  const reviewIds = new Set(needsReview.map(item => item.flight?.id).filter(Boolean));
  const reviewObjects = new Set(needsReview.map(item => item.flight));

  const verified = candidates.filter(flight =>
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
