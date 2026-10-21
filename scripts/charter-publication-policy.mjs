/**
 * Route admissibility: the single gate that decides whether one offer may be
 * published at all.
 *
 * Geography lives in `charter-geo.mjs` and the commercial region table in
 * `telegram-schedule.mjs`. This module is the only place that combines them
 * into a yes/no for one offer, and every stage of the pipeline - the customer
 * feed, the digest renderer and the publication orchestrator - must ask it.
 *
 * Having one gate is the point. The forbidden Uzbekistan and Saudi Arabia
 * posts happened because "may this be published" was answered twice, in two
 * different places, with two different rules: the digest asked only whether a
 * country could be *resolved*, and the schedule asked only whether a country's
 * region owned the *current window* - and for a country no region claimed it
 * answered "yes, in every window".
 *
 * The rule, agreed with the client:
 *
 *   1. Exactly one endpoint is in Kazakhstan.
 *   2. The other endpoint's country is claimed by a region (the allowed list).
 *
 * Both directions pass. Everything else - a flight between two foreign
 * countries (Sharjah -> Tashkent), a country outside the list (Uzbekistan,
 * Saudi Arabia), a domestic hop and an unresolved city - is refused here with
 * a named reason, so it is reported in diagnostics instead of silently lost
 * or silently published.
 */

import { TICKET_CATEGORIES, classifyFlight } from "./charter-geo.mjs";
import { allowedCountryCodes, isPublishableCountry } from "./telegram-schedule.mjs";

/** Reasons a route is refused. Each one is reported, never swallowed. */
export const POLICY_REASONS = {
  COUNTRY_NOT_ALLOWED: "COUNTRY_NOT_ALLOWED",
  FOREIGN_TO_FOREIGN_ROUTE: "FOREIGN_TO_FOREIGN_ROUTE",
  DOMESTIC_ROUTE: "DOMESTIC_ROUTE",
  NO_KAZAKHSTAN_ENDPOINT: "NO_KAZAKHSTAN_ENDPOINT"
};

/**
 * Decides whether one offer may be published.
 *
 * @returns {{allowed: boolean, reason: string|null, classification: object,
 *   country: object|null, countryCode: string|null}}
 */
export function evaluateOfferForPublication(flight) {
  const classification = classifyFlight(flight);

  const refuse = reason => ({
    allowed: false,
    reason,
    classification,
    country: classification.country,
    countryCode: classification.country?.code || null
  });

  // An unresolved city, a same-city route or a corrupt return date already
  // carries its own reason from the classifier.
  if (classification.category === TICKET_CATEGORIES.UNKNOWN) {
    return refuse(classification.reason || "UNCLASSIFIED_OFFER");
  }

  // A flight between two foreign countries is never ours to sell, whichever
  // of the two countries is on the allowed list.
  if (classification.category === TICKET_CATEGORIES.FOREIGN) {
    return refuse(POLICY_REASONS.FOREIGN_TO_FOREIGN_ROUTE);
  }

  if (classification.category === TICKET_CATEGORIES.DOMESTIC) {
    return refuse(POLICY_REASONS.DOMESTIC_ROUTE);
  }

  const fromKz = classification.fromCity?.country.code === "KZ";
  const toKz = classification.toCity?.country.code === "KZ";
  if (!fromKz && !toKz) return refuse(POLICY_REASONS.NO_KAZAKHSTAN_ENDPOINT);

  // The destination country must be one the client agreed to publish. A
  // country no region claims is held, never published "in every window".
  if (!isPublishableCountry(classification.country?.code)) {
    return refuse(POLICY_REASONS.COUNTRY_NOT_ALLOWED);
  }

  return {
    allowed: true,
    reason: null,
    classification,
    country: classification.country,
    countryCode: classification.country.code
  };
}

/** Convenience predicate for call sites that only need the verdict. */
export function isOfferPublishable(flight) {
  return evaluateOfferForPublication(flight).allowed;
}

/**
 * Partitions offers into the publishable ones and a diagnostic record per
 * refusal. Nothing is dropped without a reason.
 */
export function partitionOffersByPolicy(flights) {
  const allowed = [];
  const refused = [];

  for (const flight of Array.isArray(flights) ? flights : []) {
    const verdict = evaluateOfferForPublication(flight);
    if (verdict.allowed) {
      allowed.push(flight);
      continue;
    }
    refused.push({
      id: flight?.id || null,
      from: flight?.from ?? null,
      to: flight?.to ?? null,
      trip: flight?.trip ?? null,
      departureDate: flight?.departureDate ?? null,
      category: verdict.classification.category,
      country: verdict.countryCode,
      reason: verdict.reason
    });
  }

  return { allowed, refused, allowedCountries: allowedCountryCodes() };
}

/** Reason -> count, for the run report. */
export function policyReasonCounts(refused) {
  const counts = {};
  for (const item of Array.isArray(refused) ? refused : []) {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
  }
  return counts;
}
