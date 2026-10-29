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
import { TICKET_CATEGORIES } from "./charter-geo.mjs";
import { evaluateOfferForPublication } from "./charter-publication-policy.mjs";
import { localClock } from "./telegram-schedule.mjs";

/** Shifts an ISO date by whole days, used only for "tomorrow". */
function addLocalDays(iso, days) {
  const date = new Date(String(iso) + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

export const TELEGRAM_TEXT_LIMIT = 4096;
const DEFAULT_MAX_CHARS = 3900;
/** Room reserved for the " · Часть N/M" suffix while laying out a split digest. */
const PART_SUFFIX_RESERVE = 20;

/**
 * There is no "МЕЖДУ СТРАНАМИ" section any more. It rendered third-country
 * routes such as Sharjah -> Tashkent, which we do not sell: those offers are
 * refused by `charter-publication-policy.mjs` and reported in diagnostics.
 */
const SECTION_ORDER = [
  [TICKET_CATEGORIES.OUTBOUND, "БИЛЕТЫ ТУДА"],
  [TICKET_CATEGORIES.INBOUND, "ОБРАТНЫЕ БИЛЕТЫ"],
  [TICKET_CATEGORIES.ROUND_TRIP, "ТУДА И ОБРАТНО"]
];

const SECTION_TITLES = new Map(SECTION_ORDER);
const SECTION_RANK = new Map(SECTION_ORDER.map(([category], index) => [category, index]));

export const FOOTER_TEXT = "Цены и наличие уточняются при бронировании.";

/**
 * Carrier letters. `name` is used for the legend only when the offers
 * themselves carry no airline name.
 *
 * "F" is deliberately absent: public channels use it for both FlyArystan and
 * flydubai, so the letter is printed but never expanded into a guessed name.
 */
const CARRIER_LETTERS = [
  ["A", "Air Astana", [/air\s*astana/, /эйр\s*астана/]],
  ["S", "SCAT", [/\bscat\b/, /\bскат\b/]],
  ["U", "Sunday Airlines", [/sunday/]],
  ["V", "VietJet Air", [/vietjet/, /вьетжет/]],
  ["Y", null, [/vietravel/]],
  ["Q", "Qazaq Air", [/qazaq\s*air/]],
  ["T", "Turkish Airlines", [/turkish/]],
  ["P", "Pegasus", [/pegasus/]],
  ["N", "Neos", [/\bneos\b/]],
  ["J", "AJet", [/\bajet\b/]],
  ["W", "Wizz Air", [/wizz/]],
  ["C", "Centrum Air", [/centrum/]],
  ["D", "flydubai", [/flydubai/, /fly\s*dubai/]],
  ["F", null, [/flyarystan/, /fly\s*arystan/]]
];

const CARRIER_FALLBACK_NAME = new Map(
  CARRIER_LETTERS.filter(([, name]) => name).map(([code, name]) => [code, name])
);

function normalizeAirlineText(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

/** Letter used in front of an offer line, or null when the carrier is unknown. */
export function carrierCode(flight) {
  const declared = String(flight?.airlineCode || "").trim().toUpperCase();
  // One or two letters: the source channels use both ("V", "SE").
  if (/^[A-Z]{1,2}$/.test(declared)) return declared;

  const airline = normalizeAirlineText(flight?.airline);
  if (!airline) return null;

  for (const [code, , patterns] of CARRIER_LETTERS) {
    if (patterns.some(pattern => pattern.test(airline))) return code;
  }
  return null;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {object|null} dates  `{ year, today, tomorrow }` - the publication
 *   day in Asia/Almaty plus the year a bare "14.09" is read against.
 */
function formatDate(value, dates = null) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const compact = text.slice(8, 10) + "." + text.slice(5, 7);
  const year = text.slice(0, 4);
  // "14.09" would read as a past date for a departure in the next year.
  return dates?.year && year !== String(dates.year)
    ? compact + "." + year.slice(2)
    : compact;
}

/**
 * Marks a departure that leaves today or tomorrow. These are the offers a
 * customer has to act on within hours, and until now they never reached the
 * channel at all - the freshness guards threw today's departures away.
 */
function urgencySuffix(departureDate, dates) {
  const text = String(departureDate || "");
  if (!dates) return "";
  if (text === dates.today) return " — сегодня";
  if (text === dates.tomorrow) return " — завтра";
  return "";
}

function formatPrice(value) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(Number(value) || 0)).replace(/ /g, " ");
}

function seatsSuffix(flight) {
  const text = String(flight?.seats || "").trim();
  if (!text) return "";
  if (/последн/iu.test(text)) return " (1)";
  const match = text.match(/\b(\d{1,3})\b/);
  if (!match) return "";
  const count = Number(match[1]);
  return count > 0 ? " (" + count + ")" : "";
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

function departureTimeSuffix(flight) {
  const time = String(flight?.departureTime || "");
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
    ? " · вылет " + time
    : "";
}

function offerLine(entry, dates = null) {
  const { flight, classification, code } = entry;
  const prefix = code
    ? code + " "
    : flight.airline ? esc(String(flight.airline).trim()) + " " : "";
  const departure = formatDate(flight.departureDate, dates);

  if (classification.category === TICKET_CATEGORIES.ROUND_TRIP) {
    // Sources often publish a round-trip fare without the return date. Show
    // the dates we actually have and never fabricate the missing one.
    const dateRange = flight.returnDate
      ? departure + "–" + formatDate(flight.returnDate, dates)
      : departure;
    return prefix
      + dateRange
      + " - " + formatPrice(flight.price) + " ₸"
      + nightsSuffix(classification.nights)
      + departureTimeSuffix(flight)
      + urgencySuffix(flight.departureDate, dates);
  }

  return prefix
    + departure
    + " - " + formatPrice(flight.price) + " ₸"
    + seatsSuffix(flight)
    + departureTimeSuffix(flight)
    + urgencySuffix(flight.departureDate, dates);
}

/** Identifies a genuinely identical offer so only true duplicates collapse. */
function offerSignature(entry) {
  return [
    entry.classification.category,
    entry.classification.fromCity.id,
    entry.classification.toCity.id,
    String(entry.flight.departureDate || ""),
    String(entry.flight.returnDate || ""),
    String(entry.flight.departureTime || ""),
    Math.round(Number(entry.flight.price) || 0),
    entry.code || normalizeAirlineText(entry.flight.airline),
    String(entry.flight.seats || "")
  ].join("|");
}

/**
 * Splits flights into per-country publishable entries plus diagnostics for
 * everything that could not be classified with confidence.
 */
export function groupFlightsByCountry(flights) {
  const countries = new Map();
  const diagnostics = [];
  const seenIds = new Set();
  const seenSignatures = new Set();
  const duplicateIds = [];

  for (const flight of Array.isArray(flights) ? flights : []) {
    // One gate decides admissibility: the route must have exactly one
    // Kazakhstan endpoint and the other country must be on the allowed list.
    // Asking it here as well as in the orchestrator is deliberate - a renderer
    // that cannot produce a forbidden digest cannot be made to publish one by
    // a caller that forgot to filter.
    const verdict = evaluateOfferForPublication(flight);
    const classification = verdict.classification;

    if (!verdict.allowed) {
      diagnostics.push({
        id: flight?.id || null,
        from: flight?.from ?? null,
        to: flight?.to ?? null,
        trip: flight?.trip ?? null,
        departureDate: flight?.departureDate ?? null,
        category: classification.category,
        country: verdict.countryCode,
        reason: verdict.reason,
        details: classification.details || null
      });
      continue;
    }

    const id = flight?.id ? String(flight.id) : null;
    if (id && seenIds.has(id)) {
      duplicateIds.push(id);
      continue;
    }

    const entry = { flight, classification, code: carrierCode(flight) };
    const signature = offerSignature(entry);
    if (seenSignatures.has(signature)) {
      if (id) duplicateIds.push(id);
      continue;
    }

    if (id) seenIds.add(id);
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

  return { groups, diagnostics, duplicates: duplicateIds.length, duplicateIds };
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
    if (!entry.code) continue;
    const airline = String(entry.flight.airline || "").trim();
    if (!names.has(entry.code)) names.set(entry.code, airline || null);
    else if (!names.get(entry.code) && airline) names.set(entry.code, airline);
  }

  return [...names.entries()]
    // Channel text arrives as "Scat", "PEGASUS" or a truncated "VietJet", so
    // the canonical spelling wins whenever the letter has one.
    .map(([code, airline]) => [code, CARRIER_FALLBACK_NAME.get(code) || airline || null])
    .filter(([, airline]) => Boolean(airline))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, airline]) => code + " - " + esc(airline));
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
function layoutCountry(group, maxChars, dates) {
  const sections = buildSections(group.entries);
  const budget = Math.max(400, maxChars);
  const pages = [];

  let blocks = [];
  let entries = [];
  let openSection = null;

  const measure = (candidateBlocks, candidateEntries) =>
    renderPart({
      country: group.country,
      blocks: candidateBlocks,
      entries: candidateEntries,
      partIndex: 1,
      partCount: 1
    }).length;

  const flush = () => {
    if (!entries.length) return;
    pages.push({ blocks, entries });
    blocks = [];
    entries = [];
    openSection = null;
  };

  for (const section of sections) {
    for (const route of section.routes) {
      const needsHeading = openSection !== section.category;
      const heading = needsHeading ? ["<b>" + section.title + "</b>"] : [];
      const routeBlock = route.title + "\n\n" + route.entries.map(entry => offerLine(entry, dates)).join("\n");

      if (measure([...blocks, ...heading, routeBlock], [...entries, ...route.entries]) <= budget) {
        blocks = [...blocks, ...heading, routeBlock];
        entries = [...entries, ...route.entries];
        openSection = section.category;
        continue;
      }

      // The route does not fit on the current page: start a fresh page.
      flush();

      const freshBlock = route.title + "\n\n" + route.entries.map(entry => offerLine(entry, dates)).join("\n");
      if (measure(["<b>" + section.title + "</b>", freshBlock], route.entries) <= budget) {
        blocks = ["<b>" + section.title + "</b>", freshBlock];
        entries = [...route.entries];
        openSection = section.category;
        continue;
      }

      // Even alone the route is too long: split its offer rows, never drop them.
      let chunk = [];
      let continuation = false;

      const flushChunk = () => {
        if (!chunk.length) return;
        const title = continuation ? route.title + " (продолжение)" : route.title;
        pages.push({
          blocks: ["<b>" + section.title + "</b>", title + "\n\n" + chunk.map(entry => offerLine(entry, dates)).join("\n")],
          entries: [...chunk]
        });
        continuation = true;
        chunk = [];
      };

      for (const entry of route.entries) {
        const title = continuation ? route.title + " (продолжение)" : route.title;
        const candidate = [...chunk, entry];
        const candidateBlocks = [
          "<b>" + section.title + "</b>",
          title + "\n\n" + candidate.map(entry => offerLine(entry, dates)).join("\n")
        ];
        if (chunk.length && measure(candidateBlocks, candidate) > budget) flushChunk();
        chunk.push(entry);
      }

      flushChunk();
      openSection = null;
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
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const today = localClock(clock).date;
  const dates = {
    year: Number(today.slice(0, 4)),
    today,
    tomorrow: addLocalDays(today, 1)
  };
  const limit = Math.min(Math.max(400, Number(maxChars) || DEFAULT_MAX_CHARS), TELEGRAM_TEXT_LIMIT);
  const { groups, diagnostics, duplicates, duplicateIds } = groupFlightsByCountry(flights);
  const digests = [];

  for (const group of groups) {
    let pages = layoutCountry(group, limit, dates);

    // A split digest carries a "Часть N/M" suffix, so re-layout with the
    // suffix accounted for and keep going until the part count is stable.
    if (pages.length > 1) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const relaid = layoutCountry(group, limit - PART_SUFFIX_RESERVE, dates);
        if (relaid.length === pages.length) {
          pages = relaid;
          break;
        }
        pages = relaid;
      }
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

  const renderedOfferIds = new Set(digests.flatMap(digest => digest.offerIds));

  return {
    digests,
    diagnostics,
    duplicates,
    // The ids collapsed as duplicates, so a completeness audit can account for
    // every offer in the feed instead of reporting a silent shortfall.
    duplicateIds,
    summary: {
      countries: groups.length,
      messages: digests.length,
      offers: renderedOfferIds.size,
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
