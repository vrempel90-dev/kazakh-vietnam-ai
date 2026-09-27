function isoDate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function obviousParseArtifact(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  if (/^(?:rt|ow)\b/iu.test(text)) return true;
  if (/\b(?:air astana|scat|hh)$/iu.test(text) && /\s/u.test(text)) return true;
  return false;
}

export function selectCachedFallbackFlights(existing, {
  now = new Date(),
  maxAgeHours = 72,
  ttlHours = 6,
  maxFlights = 80
} = {}) {
  const flights = Array.isArray(existing?.flights) ? existing.flights : [];
  const today = isoDate(now);
  const cutoff = now.getTime() - Math.max(1, Number(maxAgeHours) || 72) * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + Math.max(1, Number(ttlHours) || 6) * 60 * 60 * 1000).toISOString();

  return flights
    .filter(flight => {
      if (!flight?.id || !flight?.from || !flight?.to || !flight?.departureDate) return false;
      if (String(flight.departureDate) <= today) return false;
      if (!Number.isFinite(Number(flight.price)) || Number(flight.price) <= 0) return false;
      if (obviousParseArtifact(flight.from) || obviousParseArtifact(flight.to)) return false;

      const observedAt = flight.updatedAt || flight.publishedAt || existing?.generatedAt;
      const observedMs = new Date(observedAt || 0).getTime();
      return Number.isFinite(observedMs) && observedMs >= cutoff;
    })
    .sort((a, b) => String(a.departureDate).localeCompare(String(b.departureDate)) || Number(a.price) - Number(b.price))
    .slice(0, Math.max(1, Math.floor(Number(maxFlights) || 80)))
    .map(flight => {
      const target = new Date(String(flight.departureDate) + "T12:00:00Z");
      const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
      const offset = Math.max(0, Math.round((target.getTime() - base.getTime()) / 86400000));
      return {
        ...flight,
        offset,
        cachedFallback: true,
        verificationNote: "Цена и наличие требуют подтверждения",
        expiresAt
      };
    });
}

export const __test = { obviousParseArtifact };
