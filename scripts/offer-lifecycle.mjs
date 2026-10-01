export function hasMaterialChange(previous, current) {
  if (!previous) return true;
  return previous.price !== current.price
    || previous.seats !== current.seats
    || previous.airline !== current.airline
    || previous.baggage !== current.baggage
    || previous.departureDate !== current.departureDate
    || previous.returnDate !== current.returnDate
    || previous.trip !== current.trip;
}

export function reconcileLifecycle(flights, existing, now, ttlHours = 24) {
  const existingById = new Map(
    Array.isArray(existing?.flights) ? existing.flights.map(flight => [flight.id, flight]) : []
  );
  const configuredTtl = Number(ttlHours);
  const validTtl = Number.isFinite(configuredTtl) && configuredTtl > 0
    && Number.isFinite(new Date(now.getTime() + configuredTtl * 3600000).getTime());
  const ttlMs = (validTtl ? Math.max(1, configuredTtl) : 24) * 3600000;
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  return flights.map(flight => {
    const previous = existingById.get(flight.id) || existingById.get(flight.legacyId);
    const changed = hasMaterialChange(previous, flight);
    const validPreviousTime = value => value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= now.getTime();
    const previousPublishedAt = validPreviousTime(previous?.publishedAt)
      ? previous.publishedAt
      : validPreviousTime(previous?.updatedAt) ? previous.updatedAt : undefined;
    const publishedAt = changed || !previousPublishedAt ? nowIso : previousPublishedAt;
    const updatedAt = changed || !validPreviousTime(previous?.updatedAt) ? publishedAt : previous.updatedAt;

    return {
      ...flight,
      publishedAt,
      updatedAt,
      lastSeenAt: nowIso,
      expiresAt
    };
  });
}
