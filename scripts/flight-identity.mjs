import { createHash } from "node:crypto";

const normalize = value => String(value || "").toLocaleLowerCase("ru-RU").replace(/[^а-яёa-z0-9]/giu, "");
const hash = value => createHash("sha1").update(value).digest("hex").slice(0, 16);

export function legacyFlightId(flight) {
  return hash([flight.from, flight.to, flight.departureDate, flight.returnDate || "", flight.trip].join("|"));
}

export function flightIdentity(flight) {
  return [normalize(flight.from), normalize(flight.to), flight.departureDate, flight.returnDate || "",
    flight.trip, normalize(flight.airline), normalize(flight.flightNumber), flight.departureTime || ""].join("|");
}

export function stableFlightId(flight) {
  return hash(flightIdentity(flight));
}

export function dedupeFlights(flights) {
  const map = new Map();
  for (const flight of flights) {
    const key = flightIdentity(flight);
    const current = map.get(key);
    if (!current) {
      map.set(key, { ...flight, sourceIds: [...new Set(flight.sourceIds || [])] });
      continue;
    }
    const stamp = item => Date.parse(item.sourcePostedAt || item.updatedAt || "") || 0;
    const newest = stamp(flight) > stamp(current) ? flight : current;
    const winner = flight.price < current.price || (flight.price === current.price && newest === flight)
      ? { ...flight } : { ...current };
    winner.seats = newest.seats || winner.seats;
    winner.sourcePostedAt = newest.sourcePostedAt || winner.sourcePostedAt;
    winner.sourceIds = [...new Set([...(current.sourceIds || []), ...(flight.sourceIds || [])])];
    map.set(key, winner);
  }
  return [...map.values()].sort((a, b) => a.offset - b.offset || a.price - b.price);
}
