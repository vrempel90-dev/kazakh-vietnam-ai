import { resolveCity } from "./charter-geo.mjs";
import { createHash } from "node:crypto";

const normalize = value => String(value ?? "").toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const airlineKey = value => normalize(value).replace(/[^a-zа-я0-9]/giu, "");

// Agreed publication codes, not inferred initials. Ambiguous F needs a name.
const CARRIERS = [
  ["A", "Air Astana", ["эйр астана"]],
  ["S", "SCAT", ["скат"]],
  ["U", "Sunday Airlines", ["Sunday"]],
  ["V", "VietJet Air", ["VietJet", "вьетжет"]],
  ["Y", "Vietravel Airlines", ["Vietravel"]],
  ["Q", "Qazaq Air", []],
  ["T", "Turkish Airlines", ["Turkish"]],
  ["P", "Pegasus", ["Pegasus Airlines"]],
  ["N", "Neos", []],
  ["J", "AJet", []],
  ["W", "Wizz Air", ["Wizz"]],
  ["C", "Centrum Air", ["Centrum"]],
  ["D", "flydubai", []],
  ["F", "FlyArystan", []]
];

export function carrierIdentity(flight) {
  const name = String(flight?.airline || "").trim();
  const declared = String(flight?.airlineCode || "").trim().toUpperCase();
  const known = CARRIERS.find(([, canonical, aliases]) =>
    [canonical, ...aliases].some(alias => airlineKey(alias) === airlineKey(name)));
  // A reliable full name wins over a contradictory/ambiguous source letter.
  if (known) return { code: known[0], name: known[1] };
  if (name) return { code: null, name };
  const codeOnly = CARRIERS.find(([code]) => code === declared && code !== "F");
  return codeOnly ? { code: codeOnly[0], name: codeOnly[1] } : { code: null, name: "" };
}

export function knownSeatCount(value) {
  const text = normalize(value);
  const match = text.match(/^(\d{1,3})(?:\s*(?:мест(?:о|а)?|seats?))?$/u);
  const count = match ? Number(match[1]) : null;
  // "Последние места", "от 2 мест", "до 5" are not exact availability.
  return count > 0 ? count : null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return typeof value === "string" ? normalize(value) : value ?? null;
}

export function offerIdentity(flight) {
  const carrier = carrierIdentity(flight);
  return JSON.stringify([
    resolveCity(flight?.from)?.id || normalize(flight?.from),
    resolveCity(flight?.to)?.id || normalize(flight?.to),
    flight?.returnDate ? "RT" : String(flight?.trip || "OW").toUpperCase(),
    flight?.departureDate || "", flight?.returnDate || "",
    Number(flight?.price), carrier.code || normalize(carrier.name),
    // Retain an unresolved source code as identity evidence, without displaying it.
    carrier.code ? "" : normalize(flight?.airlineCode),
    knownSeatCount(flight?.seats) ?? normalize(flight?.seats),
    ...["baggage", "handBaggage", "cabin", "fare", "fareClass", "fareBasis",
      "flightNumber", "refundable", "changeable", "conditions", "notice", "currency"]
      .map(key => stableValue(flight?.[key]))
  ]);
}

/** Collapse only identical commercial offers; preserve every fare variant. */
export function dedupeFlights(flights) {
  const offers = new Map();
  for (const flight of flights) {
    const key = offerIdentity(flight);
    const previous = offers.get(key);
    const newer = (Date.parse(flight.sourcePostedAt || flight.updatedAt || "") || 0)
      > (Date.parse(previous?.sourcePostedAt || previous?.updatedAt || "") || 0);
    offers.set(key, {
      ...(previous && !newer ? previous : flight),
      sourceIds: [...new Set([...(previous?.sourceIds || []), ...(flight.sourceIds || [])])]
    });
  }
  const sorted = [...offers.values()].sort((a, b) => a.offset - b.offset || a.price - b.price
    || offerIdentity(a).localeCompare(offerIdentity(b)));
  const usedIds = new Set();
  for (const flight of sorted) {
    // Keep legacy ids for existing offers; disambiguate newly preserved conditions.
    if (flight.id && usedIds.has(flight.id)) {
      flight.id += "-" + createHash("sha256").update(offerIdentity(flight)).digest("hex").slice(0, 12);
    }
    if (flight.id) usedIds.add(flight.id);
  }
  return sorted;
}
