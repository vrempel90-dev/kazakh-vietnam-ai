export function hasMaterialChange(previous, current) {
  if (!previous) return true;
  return previous.price !== current.price
    || previous.seats !== current.seats
    || previous.airline !== current.airline
    || previous.departureDate !== current.departureDate
    || previous.returnDate !== current.returnDate
    || previous.trip !== current.trip;
}

export function reconcileLifecycle(flights, existing, now, ttlHours = 24) {
  const existingById = new Map(
    Array.isArray(existing?.flights) ? existing.flights.map(flight => [flight.id, flight]) : []
  );
  const ttlMs = Math.max(1, Number(ttlHours) || 24) * 60 * 60 * 1000;
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  return flights.map(flight => {
    const previous = existingById.get(flight.id);
    const changed = hasMaterialChange(previous, flight);
    const previousPublishedAt = previous?.publishedAt || previous?.updatedAt;
    const publishedAt = changed || !previousPublishedAt ? nowIso : previousPublishedAt;
    const updatedAt = changed ? nowIso : (previous?.updatedAt || publishedAt);

    return {
      ...flight,
      publishedAt,
      updatedAt,
      lastSeenAt: nowIso,
      expiresAt
    };
  });
}
