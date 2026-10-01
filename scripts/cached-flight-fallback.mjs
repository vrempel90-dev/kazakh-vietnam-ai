import { validateFlightsForPublication } from "./flight-validator.mjs";

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
  maxFlights = 80,
  mirroredRouteMinSources = 2
} = {}) {
  const flights = Array.isArray(existing?.flights) ? existing.flights : [];
  const today = isoDate(now);
  const finiteHours = (value, fallback) => {
    const hours = Number(value);
    return Number.isFinite(hours) && hours > 0 && Number.isFinite(new Date(now.getTime() + hours * 3600000).getTime())
      ? Math.max(1, hours) : fallback;
  };
  const maxAgeMs = finiteHours(maxAgeHours, 72) * 3600000;
  const cutoff = now.getTime() - maxAgeMs;
  const fallbackDeadline = now.getTime() + finiteHours(ttlHours, 6) * 3600000;
  const limit = Number.isFinite(Number(maxFlights)) ? Math.max(1, Math.floor(Number(maxFlights) || 80)) : 80;
  const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T12:00:00Z"))
    && new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value;

  const eligible = flights
    .filter(flight => {
      if (!flight?.id || !flight?.from || !flight?.to || !flight?.departureDate) return false;
      if (!validDate(flight.departureDate)) return false;
      if (String(flight.departureDate) <= today) return false;
      if (!["number", "string"].includes(typeof flight.price)) return false;
      if (!Number.isFinite(Number(flight.price)) || Number(flight.price) <= 0) return false;
      if (obviousParseArtifact(flight.from) || obviousParseArtifact(flight.to)) return false;

      if (flight.expiresAt != null) {
        const expiryMs = Date.parse(flight.expiresAt);
        if (!Number.isFinite(expiryMs) || expiryMs <= now.getTime()) return false;
      }
      const observedAt = flight.lastSeenAt || flight.updatedAt || flight.publishedAt || existing?.generatedAt;
      const observedMs = new Date(observedAt || 0).getTime();
      return Number.isFinite(observedMs) && observedMs >= cutoff && observedMs <= now.getTime();
    });

  return validateFlightsForPublication(eligible, { now, mirroredRouteMinSources }).verified
    .sort((a, b) => String(a.departureDate).localeCompare(String(b.departureDate)) || Number(a.price) - Number(b.price))
    .slice(0, limit)
    .map(flight => {
      const target = new Date(String(flight.departureDate) + "T12:00:00Z");
      const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
      const offset = Math.max(0, Math.round((target.getTime() - base.getTime()) / 86400000));
      const observedAt = flight.lastSeenAt || flight.updatedAt || flight.publishedAt || existing?.generatedAt;
      // Cached reads never renew source observations or an existing expiry.
      const expiryMs = Math.min(
        fallbackDeadline,
        Date.parse(observedAt) + maxAgeMs,
        flight.expiresAt ? Date.parse(flight.expiresAt) : Infinity
      );
      return {
        ...flight,
        offset,
        price: Number(flight.price),
        lastSeenAt: observedAt,
        cachedFallback: true,
        verificationNote: "Цена и наличие требуют подтверждения",
        expiresAt: new Date(expiryMs).toISOString()
      };
    });
}

export const __test = { obviousParseArtifact };
