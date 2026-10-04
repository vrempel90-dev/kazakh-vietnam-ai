import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestSources } from "./source-registry.mjs";
import { writeSourceStatus } from "./source-status.mjs";
import { fetchTelegramSourceOffers } from "./telegram-source-adapter.mjs";
import { discoverLargeTelegramSources } from "./telegram-channel-discovery.mjs";
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
  bootstrapPublicationTarget,
  initializePublicationState,
  isDailyDigestPublished,
  isPublicationPending,
  isPublicationStateInitialized,
  loadPublicationState,
  markDailyDigestPublished,
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

function localPublicationClock(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const value = type => parts.find(part => part.type === type)?.value || "";
  return {
    date: value("year") + "-" + value("month") + "-" + value("day"),
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
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
  const maxPages = Math.max(
    1,
    Math.min(20, Math.floor(envNumber("TELEGRAM_SOURCE_MAX_PAGES") || 6))
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
      flight.trip,
      normalizeCity(flight.airlineCode || flight.airline || ""),
      flight.price
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
    winner.airline = freshest.airline || winner.airline;
    winner.airlineCode = freshest.airlineCode || winner.airlineCode;
    winner.baggage = freshest.baggage || winner.baggage;
    winner.notice = freshest.notice || winner.notice;
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

const configuredSources = ingestSources();