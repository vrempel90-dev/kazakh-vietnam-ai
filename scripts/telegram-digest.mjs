/**
 * Country digest renderer.
 *
 * One country produces ONE logical digest. Sections for outbound, inbound,
 * round-trip and third-country tickets live inside that single digest instead
 * of becoming separate Telegram posts, which is what used to make a country
 * such as Vietnam appear several times in a row.
 *
 * When a digest cannot fit into one Telegram message it is split into the
 * smallest number of parts ("Часть 1/2"); splitting never drops an offer.
 */

import { createHash } from "node:crypto";
import {
  TICKET_CATEGORIES,
  classifyFlight,
  isPublishableCategory
} from "./charter-geo.mjs";

import { carrierIdentity, knownSeatCount, offerIdentity } from "./charter-offer.mjs";

export const TELEGRAM_TEXT_LIMIT = 4096;
const DEFAULT_MAX_CHARS = 3900;

const SECTION_ORDER = [
  [TICKET_CATEGORIES.OUTBOUND, "В одну сторону"],
  [TICKET_CATEGORIES.INBOUND, "Обратные билеты"],
  [TICKET_CATEGORIES.ROUND_TRIP, "Туда обратно"],
  [TICKET_CATEGORIES.FOREIGN, "Между странами"]
];

const SECTION_TITLES = new Map(SECTION_ORDER);
const SECTION_RANK = new Map(SECTION_ORDER.map(([category], index) => [category, index]));

export const FOOTER_TEXT = "Цены и наличие уточняются при бронировании.";

export const carrierCode = flight => carrierIdentity(flight).code;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDate(value, referenceYear = null) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const compact = text.slice(8, 10) + "." + text.slice(5, 7);
  const year = text.slice(0, 4);
  // "14.09" would read as a past date for a departure in the next year.
  return referenceYear && year !== String(referenceYear)
    ? compact + "." + year.slice(2)
    : compact;
}

function formatPrice(value) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(Number(value) || 0)).replace(/ /g, " ");
}

function seatsSuffix(flight) {
  const count = knownSeatCount(flight?.seats);
  return count ? " (" + count + ")" : "";
}

function nightsSuffix(nights) {
  const count = Number(nights);
  if (!Number.isInteger(count) || count <= 0) return "";
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word = mod100 >= 11 && mod100 <= 14 ? "ночей"
    : mod10 === 1 ? "ночь"
    : mod10 >= 2 && mod10 <= 4 ? "ночи"
    : "ночей";
  return " (" + count + " " + word + ")";
}

function routeTitle(entry) {
  const from = entry.classification.fromCity.name;
  const to = entry.classification.toCity.name;
  return entry.classification.category === TICKET_CATEGORIES.ROUND_TRIP
    ? esc(from + " - " + to + " - " + from)
    : esc(from + " - " + to);
}

function offerLine(entry, referenceYear = null) {
  const { flight, classification, code } = entry;
  const prefix = code
    ? code + " "
    : flight.airline ? esc(String(flight.airline).trim()) + " " : "";
  const departure = formatDate(flight.departureDate, referenceYear);

  if (classification.category === TICKET_CATEGORIES.ROUND_TRIP) {
    // Classification admits RT only with two real, ordered dates.
    const dates = departure + "–" + formatDate(flight.returnDate, referenceYear);
    return prefix
      + dates
      + " - " + formatPrice(flight.price) + " ₸"
      + nightsSuffix(classification.nights) + seatsSuffix(flight);
  }

  return prefix
    + departure
    + " - " + formatPrice(flight.price) + " ₸"
    + seatsSuffix(flight);
}

/** Identifies a genuinely identical offer so only true duplicates collapse. */
function offerSignature(entry) { return offerIdentity(entry.flight); }

/**
 * Splits flights into per-country publishable entries plus diagnostics for
 * everything that could not be classified with confidence.
 */
export function groupFlightsByCountry(flights) {
  const countries = new Map();
  const diagnostics = [];
  const seenSignatures = new Set();
  let duplicates = 0;

  for (const flight of Array.isArray(flights) ? flights : []) {
    const classification = classifyFlight(flight);

    if (!isPublishableCategory(classification.category)) {
      diagnostics.push({
        id: flight?.id || null,
        from: flight?.from ?? null,
        to: flight?.to ?? null,
        trip: flight?.trip ?? null,
        departureDate: flight?.departureDate ?? null,
        category: classification.category,
        reason: classification.reason || classification.category.toUpperCase(),
        details: classification.details || null
      });
      continue;
    }

    const entry = { flight, classification, code: carrierCode(flight) };
    const signature = offerSignature(entry);
    if (seenSignatures.has(signature)) {
      duplicates += 1;
      continue;
    }

    seenSignatures.add(signature);

    const code = classification.country.code;
    if (!countries.has(code)) {
      countries.set(code, { country: classification.country, entries: [] });
    }
    countries.get(code).entries.push(entry);
  }

  const groups = [...countries.values()].sort((a, b) =>
    a.country.name.localeCompare(b.country.name, "ru")
  );

  return { groups, diagnostics, duplicates };
}

function buildSections(entries) {
  const sections = new Map();

  for (const entry of entries) {
    const category = entry.classification.category;
    if (!sections.has(category)) sections.set(category, new Map());
    const routes = sections.get(category);
    const routeId = entry.classification.fromCity.id + ">" + entry.classification.toCity.id;
    if (!routes.has(routeId)) routes.set(routeId, []);
    routes.get(routeId).push(entry);
  }

  return [...sections.entries()]
    .sort((a, b) => (SECTION_RANK.get(a[0]) ?? 99) - (SECTION_RANK.get(b[0]) ?? 99))
    .map(([category, routes]) => ({
      category,
      title: SECTION_TITLES.get(category) || "ЧАРТЕРНЫЕ РЕЙСЫ",
      routes: [...routes.values()]
        .map(routeEntries => {
          routeEntries.sort((a, b) =>
            String(a.flight.departureDate || "").localeCompare(String(b.flight.departureDate || ""))
            || String(a.flight.returnDate || "").localeCompare(String(b.flight.returnDate || ""))
            || (Number(a.flight.price) || 0) - (Number(b.flight.price) || 0)
            || String(a.code || "").localeCompare(String(b.code || ""))
            || offerSignature(a).localeCompare(offerSignature(b))
          );
          return {
            title: routeTitle(routeEntries[0]),
            firstDate: String(routeEntries[0].flight.departureDate || ""),
            entries: routeEntries
          };
        })
        .sort((a, b) =>
          a.firstDate.localeCompare(b.firstDate)
          || a.title.localeCompare(b.title, "ru")
        )
    }));
}

function legendLines(entries) {
  const names = new Map();
  for (const entry of entries) {
    const carrier = carrierIdentity(entry.flight);
    if (carrier.code) names.set(carrier.code, carrier.name);
  }
  return [...names].sort(([a], [b]) => a.localeCompare(b))
    .map(([code, name]) => code + " - " + esc(name));
}

function header(country, partIndex, partCount) {
  const title = country.flag + " " + esc(country.name.toLocaleUpperCase("ru-RU"));
  const suffix = partCount > 1 ? " · Часть " + partIndex + "/" + partCount : "";
  return "<b>" + title + suffix + "</b>";
}

function renderPart({ country, blocks, entries, partIndex, partCount }) {
  const legend = legendLines(entries);
  const parts = [header(country, partIndex, partCount), ...blocks];
  if (legend.length) parts.push(legend.join("\n"));
  parts.push(FOOTER_TEXT);
  return parts.join("\n\n");
}

/**
 * Lays out one country's sections into blocks that each fit `maxChars`.
 * Returns an array of { blocks, entries } in sending order.
 */
function layoutCountry(group, maxChars, referenceYear, partCount = 1) {
  const pages = [];
  let blocks = [];
  let entries = [];
  const renderBlock = (route, rows, continued = false) =>
    "<b>" + route.title + (continued ? " (продолжение)" : "") + "</b>\n"
    + route.type + "\n\n" + rows.map(entry => offerLine(entry, referenceYear)).join("\n");
  const measure = (candidateBlocks, candidateEntries, page = pages.length + 1) =>
    renderPart({ country: group.country, blocks: candidateBlocks, entries: candidateEntries,
      partIndex: page, partCount }).length;
  const flush = () => {
    if (entries.length) pages.push({ blocks, entries });
    blocks = []; entries = [];
  };
  for (const section of buildSections(group.entries)) {
    for (const sourceRoute of section.routes) {
      const route = { ...sourceRoute, type: section.title };
      const block = renderBlock(route, route.entries);
      if (measure([...blocks, block], [...entries, ...route.entries]) <= maxChars) {
        blocks.push(block); entries.push(...route.entries); continue;
      }
      if (measure([block], route.entries, pages.length + 2) <= maxChars) {
        flush(); blocks.push(block); entries.push(...route.entries); continue;
      }
      // Only a route larger than an entire page may split at offer boundaries.
      let chunk = [];
      let continued = false;
      for (const entry of route.entries) {
        const candidate = [...chunk, entry];
        if (measure([...blocks, renderBlock(route, candidate, continued)], [...entries, ...candidate]) > maxChars) {
          if (chunk.length) {
            blocks.push(renderBlock(route, chunk, continued)); entries.push(...chunk);
            continued = true;
          }
          flush(); chunk = [];
          if (measure([renderBlock(route, [entry], continued)], [entry]) > maxChars) {
            throw new Error("OFFER_EXCEEDS_MESSAGE_LIMIT: " + entry.flight.id);
          }
        }
        chunk.push(entry);
      }
      // Leave the last chunk open so another route can share the page.
      if (chunk.length) { blocks.push(renderBlock(route, chunk, continued)); entries.push(...chunk); }
    }
  }
  flush();
  return pages;
}

/**
 * Builds the publishable digests for a set of flights.
 *
 * Each digest carries a stable key (country code + part), the rendered text,
 * a content hash used to decide between editing and sending, and the exact
 * offer ids it covers so completeness can be audited.
 */
export function buildCountryDigests(flights, {
  maxChars = DEFAULT_MAX_CHARS,
  now = new Date()
} = {}) {
  const referenceYear = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.getUTCFullYear()
    : new Date().getUTCFullYear();
  const limit = Math.min(Math.max(400, Number(maxChars) || DEFAULT_MAX_CHARS), TELEGRAM_TEXT_LIMIT);
  const { groups, diagnostics, duplicates } = groupFlightsByCountry(flights);
  const digests = [];

  for (const group of groups) {
    let pages = layoutCountry(group, limit, referenceYear);

    // Use the actual suffix width, including transitions to 10+ parts.
    let measuredParts = 1;
    while (measuredParts !== pages.length) {
      measuredParts = pages.length;
      pages = layoutCountry(group, limit, referenceYear, measuredParts);
    }

    const partCount = pages.length;
    pages.forEach((page, index) => {
      const partIndex = index + 1;
      const text = renderPart({
        country: group.country,
        blocks: page.blocks,
        entries: page.entries,
        partIndex,
        partCount
      });

      digests.push({
        key: group.country.code + "#" + partIndex,
        country: group.country.code,
        countryName: group.country.name,
        part: partIndex,
        parts: partCount,
        text,
        contentHash: createHash("sha256").update(text).digest("hex").slice(0, 32),
        offerIds: page.entries.map(entry => entry.flight.id).filter(Boolean),
        categories: [...new Set(page.entries.map(entry => entry.classification.category))],
        offers: page.entries.length
      });
    });
  }


  return {
    digests,
    diagnostics,
    duplicates,
    summary: {
      countries: groups.length,
      messages: digests.length,
      offers: digests.reduce((count, digest) => count + digest.offers, 0),
      diagnostics: diagnostics.length,
      duplicates,
      oversized: digests.filter(digest => digest.text.length > TELEGRAM_TEXT_LIMIT).length
    }
  };
}

/** Convenience wrapper used by tests and dry runs. */
export function buildDigestTexts(flights, options) {
  return buildCountryDigests(flights, options).digests.map(digest => digest.text);
}
