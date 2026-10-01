import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ingestSources } from "./source-registry.mjs";
import { writeSourceStatus } from "./source-status.mjs";
import { fetchTelegramSourceOffers } from "./telegram-source-adapter.mjs";
import { calculateSalePrice, loadPricingConfig } from "./pricing-engine.mjs";
import { reconcileLifecycle } from "./offer-lifecycle.mjs";
import { selectCachedFallbackFlights } from "./cached-flight-fallback.mjs";
import { validateFlightsForPublication } from "./flight-validator.mjs";
import { shouldSkipParsedTelegramMessage } from "./telegram-publisher.mjs";
import { localPublicationClock, runTelegramPublication } from "./telegram-publication-job.mjs";
import { atomicWriteJson } from "./atomic-json.mjs";
import { dedupeFlights, legacyFlightId, stableFlightId } from "./flight-identity.mjs";
import { withSyncLock } from "./sync-lock.mjs";
import { assertDurableStateStorage } from "./production-storage.mjs";
import { redactTelegramError } from "./telegram-bot.mjs";

function envNumber(name) {
  const raw = process.env[name];
  if (raw == null || raw === "") return null;
  const value = Number(String(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function dayOffset(iso, now) {
  const target = new Date(iso + "T12:00:00Z");
  const base = new Date(localPublicationClock(now).date + "T12:00:00Z");
  return Math.round((target.getTime() - base.getTime()) / 86400000);
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
    flightNumber: input.flightNumber || undefined,
    departureTime: input.departureTime || undefined,
    baggage: input.baggage || undefined,
    departureDate: input.departureDate,
    returnDate: input.returnDate || undefined,
    sourcePostedAt: input.sourcePostedAt || undefined,
    updatedAt: new Date().toISOString()
  };
  flight.id = stableFlightId(flight);
  flight.legacyId = legacyFlightId(flight);
  return flight;
}

async function syncTelegramSource(source, now, pricingConfig, fetchSource) {
  const ttlHours = envNumber("TELEGRAM_SOURCE_TTL_HOURS") || 24;
  const maxPages = Math.max(
    1,
    Math.min(20, Math.floor(envNumber("TELEGRAM_SOURCE_MAX_PAGES") || 6))
  );

  const result = await fetchSource({
    source,
    now,
    ttlHours,
    maxPages,
    shouldSkipText: shouldSkipParsedTelegramMessage
  });

  const flights = [];
  let pricingSkipped = 0;

  for (const offer of result.offers || []) {
    const priced = calculateSalePrice({
      sourcePrice: offer.sourcePrice,
      currency: offer.currency || "KZT",
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
      continue;
    }

    const offset = dayOffset(offer.departureDate, now);
    if (offset <= 0 || offset > 365) continue;

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
        flightNumber: offer.flightNumber,
        departureTime: offer.departureTime,
        baggage: offer.baggage,
        departureDate: offer.departureDate,
        returnDate: offer.returnDate,
        sourcePostedAt: offer.postedAt
      }),
      sourceIds: [source.id]
    });
  }

  return {
    flights,
    status: {
      ...result.status,
      rawOffers: (result.offers || []).length,
      offers: flights.length,
      pricingSkipped
    }
  };
}

function offerTtlHours() {
  const configured = envNumber("OFFER_TTL_HOURS");
  return configured != null && configured >= 1 ? configured : 24;
}

function sanitizePublicFlight(flight) {
  const {
    legacyId: _legacyId,
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
    flights: payload.flights
  });
}

async function runUnlocked({ now = new Date(), sources = ingestSources(), fetchSource = fetchTelegramSourceOffers,
  pricingConfig: suppliedPricingConfig, fetchImpl, publicationEnv } = {}) {
  const startedAt = Date.now();
  const collected = [];
  const statuses = [];
  const pricingConfig = suppliedPricingConfig || await loadPricingConfig();

  for (const source of sources) {
    try {
      const result = await syncTelegramSource(source, now, pricingConfig, fetchSource);
      collected.push(...result.flights);
      statuses.push(result.status);
    } catch (error) {
      statuses.push({
        id: source.id,
        kind: source.kind,
        status: "error",
        reason: redactTelegramError(error, [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_WEBHOOK_SECRET, process.env.ADMIN_PRICING_TOKEN])
      });
    }
  }

  const freshFlights = dedupeFlights(collected);
  const validation = validateFlightsForPublication(freshFlights, { now });
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
  } catch (error) {
    // Only absence is a first run; retain corrupt data for recovery.
    if (error.code !== "ENOENT") throw new Error("Could not load flight feed", { cause: error });
  }

  const observationPath = resolve(process.env.FLIGHT_OBSERVATION_STATE_PATH ||
    (process.env.RAILWAY_PROJECT_ID ? "/data/flight-observations.json" : ".state/flight-observations.json"));
  let observationStorageAvailable = true;
  try {
    assertDurableStateStorage(observationPath, process.env, "Flight observation state");
  } catch (error) {
    if (error.code !== "PERSISTENT_STORAGE_REQUIRED") throw error;
    observationStorageAvailable = false;
    console.warn("[flight-observations] " + error.message + "; source outage retention is unavailable until storage migration");
  }
  let observationState = { version: 1, flights: [] };
  try {
    if (observationStorageAvailable) observationState = JSON.parse(await readFile(observationPath, "utf8"));
    if (observationState?.version !== 1 || !Array.isArray(observationState.flights)
      || observationState.flights.some(f => !Array.isArray(f?.sourceIds) || !f.sourceIds.length))
      throw new Error("Invalid flight observation schema");
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Could not load private flight observations", { cause: error });
  }

  let flights = reconcileLifecycle(
    validatedFreshFlights,
    observationState.flights.length ? observationState : existing,
    now,
    offerTtlHours()
  );

  // An outage is not evidence that suppliers removed every offer. Keep the last
  // feed untouched (its existing expiry still applies in the app) and do not publish.
  if (sources.length && statuses.filter(status => status.kind !== "validation").every(status => status.status === "error")) {
    await writeSourceStatus(resolve(process.env.SOURCE_STATUS_PATH || "/tmp/charter-source-status.json"),
      { statuses, summary: { mode: "source_outage", ingestionSources: sources.length, errors: sources.length } });
    throw new Error("All Telegram sources failed; previous flight feed retained without publication");
  }

  const failedSources = new Set(statuses.filter(status => status.status === "error").map(status => status.id));
  const observedIds = new Set(flights.map(flight => flight.id));
  const retained = observationState.flights.filter(flight => !observedIds.has(flight.id)
    && flight.sourceIds.every(id => failedSources.has(id))
    && Number.isFinite(Date.parse(flight.expiresAt)) && Date.parse(flight.expiresAt) > now.getTime());
  flights.push(...validateFlightsForPublication(retained, { now }).verified.map(flight => ({
    ...flight, offset: dayOffset(flight.departureDate, now), cachedFallback: true
  })));
  if (observationStorageAvailable) {
    await atomicWriteJson(observationPath, { version: 1, observedAt: now.toISOString(), flights });
  }

  const cachedFallbackEnabled =
    String(process.env.ALLOW_CACHED_FALLBACK || "false").toLowerCase() === "true";
  let cachedFallbackMode = flights.some(flight => flight.cachedFallback);

  if (!flights.length && cachedFallbackEnabled && existing) {
    const fallbackFlights = selectCachedFallbackFlights(existing, {
      now,
      maxAgeHours: envNumber("CACHED_FALLBACK_MAX_AGE_HOURS") || 72,
      ttlHours: envNumber("CACHED_FALLBACK_TTL_HOURS") || 6,
      maxFlights: envNumber("CACHED_FALLBACK_MAX_FLIGHTS") || 80
    });

    if (fallbackFlights.length) {
      const fallbackValidation = validateFlightsForPublication(fallbackFlights, {
        now
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

  try {
    await writeSourceStatus(
      resolve(process.env.SOURCE_STATUS_PATH || "/tmp/charter-source-status.json"),
      {
        statuses,
        summary: {
          mode: "telegram_public_only",
          ingestionSources: sources.length,
          rawOffers: collected.length,
          deduplicatedOffers: freshFlights.length,
          validatedOffers: validatedFreshFlights.length,
          needsReviewOffers: validation.needsReview.length,
          rejectedOffers: validation.rejected.length,
          publishableOffers: flights.length,
          fallbackOffers: cachedFallbackMode ? flights.length : 0
        }
      }
    );
  } catch (error) {
    console.warn(
      "Could not persist source diagnostics:",
      error instanceof Error ? error.message : String(error)
    );
  }

  const publicFlights = flights.map(sanitizePublicFlight);

  if (!publicFlights.length) {
    const emptyPayload = {
      generatedAt: new Date().toISOString(),
      mode: "telegram-public-only",
      note: "No fresh charter offers were found in the configured public Telegram channels.",
      flights: []
    };

    await atomicWriteJson(outputPath, emptyPayload);

    console.warn("No fresh Telegram charter offers; cleared the public feed.");
    const summary = { flights: 0, publishedPosts: 0, publishedFlights: 0, countries: 0,
      reviewCount: validation.needsReview.length, errors: statuses.filter(s => s.status === "error").length, durationMs: Date.now() - startedAt };
    console.log("Flight synchronization:", JSON.stringify(summary));
    return summary;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    mode: cachedFallbackMode
      ? "telegram-public-cached"
      : "telegram-public-only",
    note: cachedFallbackMode
      ? "Previously observed public Telegram offers are shown temporarily. Price and availability must be confirmed before booking."
      : "Offers are collected only from configured public Telegram charter channels. Source channel identifiers are not exposed to customers.",
    flights: publicFlights
  };

  const feedChanged =
    !(existing && comparablePayload(existing) === comparablePayload(payload));

  if (feedChanged) {
    await atomicWriteJson(outputPath, payload);
    console.log(
      "Published",
      publicFlights.length,
      cachedFallbackMode ? "cached Telegram offers" : "fresh Telegram offers"
    );
  } else {
    console.log("No customer-visible flight changes.");
  }

  const publishing = await runTelegramPublication({ flights, now, fetchImpl, env: publicationEnv || process.env });
  const summary = { flights: flights.length, rejectedCount: validation.rejected.length,
    ...publishing, reviewCount: validation.needsReview.length + publishing.reviewCount,
    errors: publishing.errors + statuses.filter(s => s.status === "error").length, durationMs: Date.now() - startedAt };
  console.log("Flight synchronization:", JSON.stringify(summary));
  if (process.env.DEBUG_FLIGHT_SYNC === "true") console.log("Source status:", JSON.stringify(statuses));
  return summary;
}

export async function runFlightSync(options = {}) {
  const outputPath = resolve(process.env.FLIGHT_FEED_OUTPUT || "public/flights.json");
  const lockPath = process.env.FLIGHT_SYNC_LOCK_PATH || (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_PUBLISH_ENABLED !== "false"
    ? (process.env.TELEGRAM_PUBLISH_STATE_PATH || "/data/telegram-publications.json") + ".sync.lock" : outputPath + ".sync.lock");
  return withSyncLock(lockPath, () => runUnlocked(options));
}

export async function main() {
  try { await runFlightSync(); }
  catch (error) {
    console.error("Flight sync failed:", redactTelegramError(error, [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_WEBHOOK_SECRET, process.env.ADMIN_PRICING_TOKEN]));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
