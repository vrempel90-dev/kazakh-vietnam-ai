import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestSources } from "./source-registry.mjs";
import { writeSourceStatus } from "./source-status.mjs";
import { fetchTelegramSourceOffers } from "./telegram-source-adapter.mjs";
import { discoverLargeTelegramSources } from "./telegram-channel-discovery.mjs";
import { loadPricingConfig, resolvePublicationPrice } from "./pricing-engine.mjs";
import { reconcileLifecycle } from "./offer-lifecycle.mjs";
import { selectCachedFallbackFlights } from "./cached-flight-fallback.mjs";
import { validateFlightsForPublication } from "./flight-validator.mjs";
import { shouldSkipParsedTelegramMessage } from "./telegram-publisher.mjs";
import { runTelegramPublication } from "./telegram-publish-run.mjs";
import { classifyFlight } from "./charter-geo.mjs";
import { partitionOffersByPolicy, policyReasonCounts } from "./charter-publication-policy.mjs";
import { allowedCountryCodes, localDayOffset } from "./telegram-schedule.mjs";

function envNumber(name) {
  const raw = process.env[name];
  if (raw == null || raw === "") return null;
  const value = Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function normalizeCity(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[^а-яёa-z0-9]/giu, "");
}

const KAZAKHSTAN_CITY_KEYS = new Set([
  "алматы", "астана", "шымкент", "атырау", "актобе", "актау",
  "костанай", "кызылорда", "тараз", "уральск", "петропавловск",
  "караганда"
]);

const ENTRY_REQUIREMENT_BY_COUNTRY = new Map([
  ["Таиланд", "TDAC обязательно"],
  ["Малайзия", "MDAC обязательно"],
  ["Вьетнам", "Arrival Card обязательно"],
  ["Мальдивы", "Health Declaration обязательно"],
  ["Китай", "Arrival Card обязательно"]
]);

function isKazakhstanCity(value) {
  return KAZAKHSTAN_CITY_KEYS.has(normalizeCity(value));
}

function normalizeOfferForPublication(offer) {
  const trip = offer?.returnDate ? "RT" : String(offer?.trip || "OW");
  let from = offer?.from;
  let to = offer?.to;

  if (trip === "RT" && !isKazakhstanCity(from) && isKazakhstanCity(to)) {
    [from, to] = [to, from];
  }

  const classification = classifyFlight({
    from,
    to,
    trip,
    departureDate: offer?.departureDate,
    returnDate: offer?.returnDate
  });
  const requirement = ENTRY_REQUIREMENT_BY_COUNTRY.get(classification.country?.name);

  return {
    ...offer,
    // Canonical city names, once, at the point the public record is built.
    //
    // Whatever spelling the channel used - a Latin heading, a genitive, a
    // "Таиланд, Патонг" - the feed stores the catalogued name. The customer app
    // shows this string, and de-duplication keys on it, so leaving the raw form
    // in meant the app displayed "Таиланд, Патонг" and the same flight written
    // two ways survived as two offers. An unresolved city keeps its original
    // text so diagnostics can still quote what arrived.
    from: classification.fromCity?.name || from,
    to: classification.toCity?.name || to,
    trip,
    notice: requirement ? "❗ " + requirement : undefined
  };
}

/** Furthest departure we accept, in days. */
const MAX_DEPARTURE_HORIZON_DAYS = 365;

function stableId(flight) {
  const raw = [
    flight.from,
    flight.to,
    flight.departureDate,
    flight.returnDate || "",
    flight.trip,
    flight.airlineCode || flight.airline || "",
    flight.price
  ].join("|");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function publicFlight(input) {
  const flight = {
    id: "",
    from: input.from,
    to: input.to,
    offset: input.offset,
    price: input.price,
    trip: input.trip,
    hot: Boolean(input.hot),
    seats: input.seats || "Наличие уточняется",
    airline: input.airline || undefined,
    airlineCode: input.airlineCode || undefined,
    baggage: input.baggage || undefined,
    notice: input.notice || undefined,
    departureDate: input.departureDate,
    returnDate: input.returnDate || undefined,
    sourcePostedAt: input.sourcePostedAt || undefined,
    updatedAt: new Date().toISOString()
  };
  flight.id = stableId(flight);
  return flight;
}

async function syncTelegramSource(source, now, pricingConfig) {
  const ttlHours = envNumber("TELEGRAM_SOURCE_TTL_HOURS") || 24;
  // 6 pages was roughly 120 posts, which does not cover a full day on a busy
  // channel: the page walk stops early on its own once it reaches posts older
  // than the TTL, so a higher ceiling costs nothing on a quiet channel and
  // stops a loud one from being truncated mid-day.
  const maxPages = Math.max(
    1,
    Math.min(20, Math.floor(envNumber("TELEGRAM_SOURCE_MAX_PAGES") || 12))
  );

  const prefetchedOffers = Array.isArray(source?.prefetchedOffers)
    ? source.prefetchedOffers.filter(offer => {
        const stamp = Date.parse(offer?.postedAt || "");
        if (!Number.isFinite(stamp)) return true;
        const ageMs = now.getTime() - stamp;
        return ageMs >= -3600000 && ageMs <= ttlHours * 3600000;
      })
    : null;

  const result = prefetchedOffers
    ? {
        offers: prefetchedOffers,
        status: {
          id: source.id,
          kind: "telegram_session",
          status: "ok",
          pages: 0,
          posts: null,
          offers: prefetchedOffers.length,
          skippedOld: Math.max(0, source.prefetchedOffers.length - prefetchedOffers.length),
          skippedAuto: 0
        }
      }
    : await fetchTelegramSourceOffers({
        source,
        now,
        ttlHours,
        maxPages,
        shouldSkipText: shouldSkipParsedTelegramMessage
      });

  const flights = [];
  const dropped = [...(result.dropped || [])];
  let pricingSkipped = 0;

  const drop = (reason, offer) => {
    dropped.push({
      reason,
      sourceId: source.id,
      from: offer?.from ?? null,
      to: offer?.to ?? null,
      departureDate: offer?.departureDate ?? null
    });
  };

  for (const rawOffer of result.offers || []) {
    const offer = normalizeOfferForPublication(rawOffer);
    const priced = resolvePublicationPrice({
      sourcePrice: offer.sourcePrice,
      currency: offer.currency || "KZT",
      priceKind: source.priceKind || "cost",
      sourceId: source.id,
      offerId: offer.externalId,
      from: offer.from,
      to: offer.to,
      trip: offer.trip,
      rates: {},
      config: pricingConfig,
      roundingStep: envNumber("SALE_PRICE_ROUNDING") || 1000
    });

    if (!priced) {
      pricingSkipped += 1;
      drop("PRICING_RULE_REJECTED_OFFER", offer);
      continue;
    }

    // Asia/Almaty, and a departure today (`0`) is kept. The `offset <= 0`
    // guard that used to stand here silently deleted every same-day charter
    // seat - the most urgent inventory there is - and did so against the UTC
    // calendar day, which is a different day from the business's for most of
    // the working hours.
    const offset = localDayOffset(offer.departureDate, now);
    if (offset == null) {
      drop("INVALID_DEPARTURE_DATE", offer);
      continue;
    }
    if (offset < 0) {
      drop("DEPARTURE_IN_THE_PAST", offer);
      continue;
    }
    if (offset > MAX_DEPARTURE_HORIZON_DAYS) {
      drop("DEPARTURE_BEYOND_HORIZON", offer);
      continue;
    }

    flights.push({
      ...publicFlight({
        from: offer.from,
        to: offer.to,
        offset,
        price: priced.salePrice,
        trip: offer.trip,
        hot: offer.hot,
        seats: offer.seats,
        airline: offer.airline,
        airlineCode: offer.airlineCode,
        baggage: offer.baggage,
        notice: offer.notice,
        departureDate: offer.departureDate,
        returnDate: offer.returnDate,
        sourcePostedAt: offer.postedAt
      }),
      sourceIds: [source.id]
    });
  }

  const droppedReasons = {};
  for (const item of dropped) {
    droppedReasons[item.reason] = (droppedReasons[item.reason] || 0) + 1;
  }

  return {
    flights,
    dropped,
    status: {
      ...result.status,
      rawOffers: (result.offers || []).length,
      offers: flights.length,
      pricingSkipped,
      dropped: dropped.length,
      droppedReasons
    }
  };
}

function dedupeFlights(flights) {
  const map = new Map();

  for (const flight of flights) {
    const key = [
      normalizeCity(flight.from),
      normalizeCity(flight.to),
      flight.departureDate,
      flight.returnDate || "",
      flight.trip,
      normalizeCity(flight.airlineCode || flight.airline || "")
    ].join("|");

    const current = map.get(key);
    if (!current) {
      map.set(key, {
        ...flight,
        sourceIds: [...new Set(flight.sourceIds || [])]
      });
      continue;
    }

    const flightStamp = Date.parse(flight.sourcePostedAt || flight.updatedAt || "") || 0;
    const currentStamp = Date.parse(current.sourcePostedAt || current.updatedAt || "") || 0;
    const newer = flightStamp > currentStamp;

    const winner =
      flight.price < current.price || (flight.price === current.price && newer)
        ? { ...flight }
        : { ...current };

    const freshest = newer ? flight : current;
    winner.seats = freshest.seats || winner.seats;
    // Keep carrier and baggage attached to the selected price/source.
    // Never transfer metadata from another offer with a different fare.
    winner.airline = winner.airline || undefined;
    winner.airlineCode = winner.airlineCode || undefined;
    winner.baggage = winner.baggage || undefined;
    winner.notice = freshest.notice || winner.notice;
    winner.sourcePostedAt = freshest.sourcePostedAt || winner.sourcePostedAt;
    winner.sourceIds = [
      ...new Set([...(current.sourceIds || []), ...(flight.sourceIds || [])])
    ];

    map.set(key, winner);
  }

  // No cap. There used to be a `.slice(0, 300)` here, which silently threw
  // away every offer past the 300th - and because the list is sorted by
  // departure date, what it cut was always the far end of the schedule, a
  // whole stretch of the season at a time, with nothing reported anywhere.
  // Digest size is handled where it belongs: a country's text is split into
  // "Часть N/M" parts, which never drops an offer.
  return dropAnonymousDuplicates([...map.values()])
    .sort((a, b) => a.offset - b.offset || a.price - b.price);
}

/**
 * Removes an offer that carries no airline when an otherwise identical one
 * does.
 *
 * The de-duplication key above includes the carrier, so the same fare picked up
 * from two channels - one naming the airline, one not - survived as two offers
 * and the digest printed the same row twice, once bare and once with its
 * letter. On one live sync that was 73 redundant rows.
 *
 * Two DIFFERENT carriers at the same price on the same date are a real pair and
 * are both kept; only the nameless one is dropped, and only when a named offer
 * for exactly the same route, dates, price and seat count exists. It therefore
 * carries nothing the kept offer does not.
 */
function dropAnonymousDuplicates(flights) {
  const fareKey = flight => [
    normalizeCity(flight.from),
    normalizeCity(flight.to),
    flight.trip,
    flight.departureDate,
    flight.returnDate || "",
    Math.round(Number(flight.price) || 0),
    String(flight.seats || "")
  ].join("|");

  const named = new Set();
  for (const flight of flights) {
    if (flight.airlineCode || flight.airline) named.add(fareKey(flight));
  }

  return flights.filter(flight =>
    Boolean(flight.airlineCode || flight.airline) || !named.has(fareKey(flight))
  );
}

/**
 * The FX rates the customer feed publishes, from the operator-set
 * `FX_USD_KZT` / `FX_EUR_KZT` the pricing engine already reads.
 *
 * The feed never carried a `rates` field, so `payload.rates` was always
 * undefined in the client and the USD/EUR buttons were permanently disabled -
 * the currency switch has never worked in production. Nothing is invented
 * here: an unset variable means no rate, and the client keeps that currency
 * disabled rather than converting at a guessed rate.
 */
function publishedRates() {
  const rates = {};
  for (const [code, field] of [["USD", "USD_KZT"], ["EUR", "EUR_KZT"]]) {
    const rate = envNumber("FX_" + code + "_KZT");
    if (rate != null && rate > 0) rates[field] = rate;
  }
  return Object.keys(rates).length
    ? { ...rates, updatedAt: new Date().toISOString() }
    : undefined;
}

function offerTtlHours() {
  const configured = envNumber("OFFER_TTL_HOURS");
  return configured != null && configured >= 1 ? configured : 24;
}

function sanitizePublicFlight(flight) {
  const {
    sourceIds: _sourceIds,
    sourcePostedAt: _sourcePostedAt,
    ...publicFields
  } = flight;
  return publicFields;
}

function comparablePayload(payload) {
  return JSON.stringify({
    mode: payload.mode,
    note: payload.note,
    flights: payload.flights,
    // `updatedAt` inside rates changes every run, so compare the numbers only;
    // otherwise the feed would be rewritten on every sync.
    rates: payload.rates
      ? { USD_KZT: payload.rates.USD_KZT, EUR_KZT: payload.rates.EUR_KZT }
      : undefined
  });
}

const now = new Date();
const collected = [];
const statuses = [];
/** Every offer refused before de-duplication, with the reason it was refused. */
const droppedAtIngestion = [];

const configuredSources = ingestSources();
const discovery = await discoverLargeTelegramSources({ env: process.env, now });
statuses.push(discovery.status);

const largeChannelsOnly =
  String(process.env.TELEGRAM_LARGE_CHANNELS_ONLY || "false").toLowerCase() === "true";

const sourceMap = new Map();
for (const source of largeChannelsOnly
  ? discovery.sources
  : [...configuredSources, ...discovery.sources]) {
  if (!source?.id) continue;
  sourceMap.set(source.id, source);
}
const sources = [...sourceMap.values()];
const pricingConfig = await loadPricingConfig();

for (const source of sources) {
  try {
    const result = await syncTelegramSource(source, now, pricingConfig);
    collected.push(...result.flights);
    droppedAtIngestion.push(...(result.dropped || []));
    statuses.push(result.status);
  } catch (error) {
    statuses.push({
      id: source.id,
      kind: source.kind,
      status: "error",
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

const dedupedFlights = dedupeFlights(collected);

// The allowed-route gate runs here, before anything is written anywhere: the
// customer feed and the Telegram digest are built from the same list, so a
// forbidden route filtered only at publication time still reached customers
// through the app. Uzbekistan, Saudi Arabia and every foreign-to-foreign
// route stop at this line, each with a named reason.
const routePolicy = partitionOffersByPolicy(dedupedFlights);
const freshFlights = routePolicy.allowed;

statuses.push({
  id: "route_policy",
  kind: "policy",
  status: routePolicy.refused.length ? "filtered" : "ok",
  allowedCountries: routePolicy.allowedCountries,
  checked: dedupedFlights.length,
  allowed: freshFlights.length,
  refused: routePolicy.refused.length,
  reasons: policyReasonCounts(routePolicy.refused),
  // Kept apart on purpose. A foreign-to-foreign refusal carries the
  // DESTINATION country, which is often an allowed one (Antalya -> Dubai is
  // refused for having no Kazakhstan endpoint, not because the UAE is
  // blocked), so merging the two lists reads as "the UAE is blocked".
  notAllowedCountries: [...new Set(
    routePolicy.refused
      .filter(item => item.reason === "COUNTRY_NOT_ALLOWED")
      .map(item => item.country)
      .filter(Boolean)
  )].sort(),
  foreignToForeignCountries: [...new Set(
    routePolicy.refused
      .filter(item => item.reason === "FOREIGN_TO_FOREIGN_ROUTE")
      .map(item => item.country)
      .filter(Boolean)
  )].sort()
});

const mirroredRouteMinSources = Math.max(
  1,
  Math.floor(envNumber("MIRRORED_ROUTE_MIN_SOURCES") || 2)
);
const validation = validateFlightsForPublication(freshFlights, {
  now,
  mirroredRouteMinSources
});
const validatedFreshFlights = validation.verified;

statuses.push({
  id: "flight_validator",
  kind: "validation",
  status:
    validation.needsReview.length || validation.rejected.length
      ? "review_required"
      : "ok",
  checked: validation.summary.checked,
  verified: validation.summary.verified,
  needsReview: validation.summary.needsReview,
  rejected: validation.summary.rejected,
  reasons: validation.summary.reasons
});

const outputPath = resolve(process.env.FLIGHT_FEED_OUTPUT || "public/flights.json");

let existing = null;
try {
  existing = JSON.parse(await readFile(outputPath, "utf8"));
} catch {
  // First run may not have an existing customer feed.
}

let flights = reconcileLifecycle(
  validatedFreshFlights,
  existing,
  now,
  offerTtlHours()
);

const cachedFallbackEnabled =
  String(process.env.ALLOW_CACHED_FALLBACK || "false").toLowerCase() === "true";
let cachedFallbackMode = false;

if (!flights.length && cachedFallbackEnabled && existing) {
  const fallbackFlights = selectCachedFallbackFlights(existing, {
    now,
    maxAgeHours: envNumber("CACHED_FALLBACK_MAX_AGE_HOURS") || 72,
    ttlHours: envNumber("CACHED_FALLBACK_TTL_HOURS") || 6,
    maxFlights: envNumber("CACHED_FALLBACK_MAX_FLIGHTS") || 80
  });

  if (fallbackFlights.length) {
    const fallbackValidation = validateFlightsForPublication(fallbackFlights, {
      now,
      mirroredRouteMinSources
    });
    flights = fallbackValidation.verified;
    cachedFallbackMode = flights.length > 0;
    statuses.push({
      id: "cached_customer_feed",
      kind: "cached_fallback",
      status: flights.length ? "fallback_active" : "fallback_blocked",
      offers: flights.length,
      needsReview: fallbackValidation.needsReview.length,
      rejected: fallbackValidation.rejected.length,
      reason: flights.length
        ? "Previously observed future Telegram offers are shown temporarily and require availability confirmation."
        : "Cached offers were blocked by flight validation."
    });
  }
}

const sourceStatusPath = resolve(
  process.env.SOURCE_STATUS_PATH || "/tmp/charter-source-status.json"
);

async function persistSourceStatus() {
  try {
    await writeSourceStatus(sourceStatusPath, {
      statuses,
      summary: {
        mode: "telegram_public_only",
        ingestionSources: sources.length,
        sourceHandles: sources.map(source => source.handle).filter(Boolean).sort(),
        allowedCountries: allowedCountryCodes(),
        rawOffers: collected.length,
        deduplicatedOffers: dedupedFlights.length,
        routePolicyRefused: routePolicy.refused.length,
        droppedAtIngestion: droppedAtIngestion.length,
        droppedReasons: policyReasonCounts(droppedAtIngestion),
        validatedOffers: validatedFreshFlights.length,
        needsReviewOffers: validation.needsReview.length,
        rejectedOffers: validation.rejected.length,
        publishableOffers: flights.length,
        fallbackOffers: cachedFallbackMode ? flights.length : 0
      }
    });
  } catch (error) {
    console.warn(
      "Could not persist source diagnostics:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

// Written once now, so the ingestion diagnostics survive even if publication
// throws, and once more after publication so the delivery outcome lands in the
// file too. It used to be written only here, which is why `telegram_publisher`
// never reached the status file or /health.
await persistSourceStatus();

const publicFlights = flights.map(sanitizePublicFlight);

if (!publicFlights.length) {
  const emptyPayload = {
    generatedAt: new Date().toISOString(),
    mode: "telegram-public-only",
    note: "No fresh charter offers were found in the configured public Telegram channels.",
    flights: []
  };

  await mkdir(resolve("public"), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(emptyPayload, null, 2) + "\n",
    "utf8"
  );

  console.warn("No fresh Telegram charter offers; cleared the public feed.");
  console.log("Source status:", JSON.stringify(statuses));
  await new Promise(resolve => setTimeout(resolve, 150));
  process.exit(0);
}

const payload = {
  generatedAt: new Date().toISOString(),
  mode: cachedFallbackMode
    ? "telegram-public-cached"
    : "telegram-public-only",
  note: cachedFallbackMode
    ? "Previously observed public Telegram offers are shown temporarily. Price and availability must be confirmed before booking."
    : "Offers are collected only from configured public Telegram charter channels. Source channel identifiers are not exposed to customers.",
  rates: publishedRates(),
  flights: publicFlights
};

const feedChanged =
  !(existing && comparablePayload(existing) === comparablePayload(payload));

if (feedChanged) {
  await mkdir(resolve("public"), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(payload, null, 2) + "\n",
    "utf8"
  );
  console.log(
    "Published",
    publicFlights.length,
    cachedFallbackMode ? "cached Telegram offers" : "fresh Telegram offers"
  );
} else {
  console.log("No customer-visible flight changes.");
}

const publicationReport = await runTelegramPublication({
  flights,
  now,
  env: process.env,
  reason: process.env.SYNC_REASON || "scheduled",
  logger: console
});

if (publicationReport.skipped) {
  console.log("Telegram publication skipped:", JSON.stringify({
    status: publicationReport.publicationStatus,
    reason: publicationReport.reason,
    localDate: publicationReport.localDate,
    localTime: publicationReport.localTime,
    schedule: publicationReport.schedule
  }));
}

// A run that only edited is not a publication. This is the alert that was
// missing while three days of windows reported "ok" with sent=0.
if (publicationReport.health?.stale) {
  console.error("Telegram publication ALERT:", JSON.stringify({
    reason: publicationReport.health.reason,
    silentHours: publicationReport.health.silentHours,
    lastNewPostAt: publicationReport.health.lastNewPostAt,
    lastPlannedSendAt: publicationReport.health.lastPlannedSendAt,
    lastEditAt: publicationReport.health.lastEditAt,
    lastFailure: publicationReport.health.lastFailure
  }));
}

if (publicationReport.diagnostics?.length) {
  console.warn(
    "Offers held back for review (no country could be established):",
    JSON.stringify({
      total: publicationReport.diagnostics.length,
      sample: publicationReport.diagnostics.slice(0, 10).map(item =>
        item.reason + " " + item.from + " -> " + item.to
      )
    })
  );
}

statuses.push({
  id: "telegram_publisher",
  kind: "publication",
  // `status` is the delivery outcome, never "ok" for a run that only edited.
  status: publicationReport.publicationStatus,
  transport: publicationReport.skipped
    ? "skipped"
    : publicationReport.channels.some(channel => channel.status === "error")
      ? "error"
      : publicationReport.channels.some(channel => channel.status === "partial")
        ? "partial"
        : "ok",
  reason: publicationReport.reason,
  window: publicationReport.window?.id || null,
  region: publicationReport.window?.region?.id || null,
  allowedCountries: publicationReport.allowedCountries || null,
  localDate: publicationReport.localDate,
  totals: publicationReport.totals,
  stale: Boolean(publicationReport.health?.stale),
  lastNewPostAt: publicationReport.health?.lastNewPostAt || null,
  unclassified: publicationReport.diagnostics?.length || 0
});

await persistSourceStatus();

console.log("Source status:", JSON.stringify(statuses));
