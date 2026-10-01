import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestSources } from "./source-registry.mjs";
import { writeSourceStatus } from "./source-status.mjs";
import { fetchTelegramSourceOffers } from "./telegram-source-adapter.mjs";
import { calculateSalePrice, loadPricingConfig } from "./pricing-engine.mjs";
import { reconcileLifecycle } from "./offer-lifecycle.mjs";
import { selectCachedFallbackFlights } from "./cached-flight-fallback.mjs";
import { validateFlightsForPublication } from "./flight-validator.mjs";
import {
  filterFlightsForTarget,
  parsePublishTargets,
  publishFreshFlights,
  shouldSkipParsedTelegramMessage,
  telegramPublicationWindowStatus
} from "./telegram-publisher.mjs";
import {
  initializePublicationState,
  isPublicationPending,
  isPublicationStateInitialized,
  isTargetPublishAllowed,
  loadPublicationState,
  markFlightsPublished,
  markTargetBatchPublished,
  prunePublicationState,
  savePublicationState
} from "./telegram-publication-state.mjs";

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

function dayOffset(iso, now) {
  const target = new Date(iso + "T12:00:00Z");
  const base = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12
  ));
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function stableId(flight) {
  const raw = [
    flight.from,
    flight.to,
    flight.departureDate,
    flight.returnDate || "",
    flight.trip
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
    baggage: input.baggage || undefined,
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
  const maxPages = Math.max(
    1,
    Math.min(20, Math.floor(envNumber("TELEGRAM_SOURCE_MAX_PAGES") || 6))
  );

  const result = await fetchTelegramSourceOffers({
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
      currency: "KZT",
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

function dedupeFlights(flights) {
  const map = new Map();

  for (const flight of flights) {
    const key = [
      normalizeCity(flight.from),
      normalizeCity(flight.to),
      flight.departureDate,
      flight.returnDate || "",
      flight.trip
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
    winner.sourcePostedAt = freshest.sourcePostedAt || winner.sourcePostedAt;
    winner.sourceIds = [
      ...new Set([...(current.sourceIds || []), ...(flight.sourceIds || [])])
    ];

    map.set(key, winner);
  }

  return [...map.values()]
    .sort((a, b) => a.offset - b.offset || a.price - b.price)
    .slice(0, 300);
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
    flights: payload.flights
  });
}

const now = new Date();
const collected = [];
const statuses = [];
const sources = ingestSources();
const pricingConfig = await loadPricingConfig();

for (const source of sources) {
  try {
    const result = await syncTelegramSource(source, now, pricingConfig);
    collected.push(...result.flights);
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

const freshFlights = dedupeFlights(collected);
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

  await mkdir(resolve("public"), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(emptyPayload, null, 2) + "\n",
    "utf8"
  );

  console.warn("No fresh Telegram charter offers; cleared the public feed.");
  console.log("Source status:", JSON.stringify(statuses, null, 2));
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

const publishWindow = telegramPublicationWindowStatus(now, {
  timeZone: process.env.TELEGRAM_PUBLISH_TIMEZONE || "Asia/Almaty",
  startHour: envNumber("TELEGRAM_PUBLISH_START_HOUR") ?? 10,
  endHour: envNumber("TELEGRAM_PUBLISH_END_HOUR") ?? 20
});

if (
  flights.length
  && process.env.TELEGRAM_PUBLISH_ENABLED !== "false"
  && publishWindow.open
) {
  try {
    const targets = parsePublishTargets(process.env.TELEGRAM_PUBLISH_CHATS);
    const statePath =
      process.env.TELEGRAM_PUBLISH_STATE_PATH ||
      "/data/telegram-publications.json";
    const retentionDays = Math.max(
      1,
      Number(process.env.TELEGRAM_PUBLICATION_RETENTION_DAYS || 30)
    );
    const republishCooldownHours = Math.max(
      0,
      Number(process.env.TELEGRAM_REPUBLISH_COOLDOWN_HOURS || 24)
    );
    const minPublishIntervalMinutes = Math.max(
      0,
      Number(process.env.TELEGRAM_MIN_PUBLISH_INTERVAL_MINUTES || 15)
    );

    const publicationState = await loadPublicationState(statePath);
    let publishedFlights = 0;
    let publishedPosts = 0;
    const targetResults = [];

    if (!isPublicationStateInitialized(publicationState)) {
      const initializedAt = now.toISOString();
      initializePublicationState(publicationState, initializedAt);
      await savePublicationState(statePath, publicationState);
      console.log(
        "Telegram publishing state initialized; existing flights remain pending for ordered country rollout."
      );
    }

    for (const target of targets) {
      const eligibleFlights = filterFlightsForTarget(flights, target);

      if (!isTargetPublishAllowed(publicationState, target, {
        now,
        minIntervalMinutes: minPublishIntervalMinutes
      })) {
        targetResults.push({
          target,
          pendingFlights: 0,
          sent: 0,
          sentFlightIds: [],
          skipped: "publish_interval"
        });
        continue;
      }

      const pendingFlights = eligibleFlights.filter(flight =>
        isPublicationPending(publicationState, target, flight, {
          now,
          cooldownHours: republishCooldownHours
        })
      );

      if (!pendingFlights.length) {
        targetResults.push({
          target,
          pendingFlights: 0,
          sent: 0,
          sentFlightIds: []
        });
        continue;
      }

      const publishResult = await publishFreshFlights({
        token: process.env.TELEGRAM_BOT_TOKEN,
        targets: [target],
        flights: pendingFlights,
        publicAppUrl:
          process.env.PUBLIC_APP_URL ||
          process.env.RAILWAY_PUBLIC_DOMAIN,
        managerPhone: process.env.VITE_MANAGER_WHATSAPP
      });

      const result = publishResult.targets?.[0] || {
        target,
        sent: 0,
        sentFlightIds: [],
        error: publishResult.reason || null
      };

      const sentIds = new Set(result.sentFlightIds || []);
      const sentFlights = pendingFlights.filter(flight =>
        sentIds.has(flight.id)
      );

      if (sentFlights.length) {
        const publishedAt = now.toISOString();
        markFlightsPublished(publicationState, target, sentFlights, publishedAt);
        markTargetBatchPublished(publicationState, target, publishedAt);
        prunePublicationState(publicationState, { now, retentionDays });
        await savePublicationState(statePath, publicationState);
      }

      publishedFlights += sentFlights.length;
      publishedPosts += Number(result.sent || 0);
      targetResults.push({
        ...result,
        pendingFlights: pendingFlights.length
      });
    }

    console.log(
      "Telegram publishing:",
      JSON.stringify(
        {
          eligibleFlights: flights.length,
          publishedFlights,
          publishedPosts,
          publishWindow,
          targets: targetResults
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      "Telegram publishing failed:",
      error instanceof Error ? error.message : String(error)
    );
  }
} else {
  console.log(
    !flights.length
      ? "No Telegram charter offers are eligible for publication."
      : process.env.TELEGRAM_PUBLISH_ENABLED === "false"
        ? "Telegram publishing is disabled."
        : "Telegram publishing paused outside configured daytime window: " + JSON.stringify(publishWindow)
  );
}

console.log("Source status:", JSON.stringify(statuses, null, 2));
