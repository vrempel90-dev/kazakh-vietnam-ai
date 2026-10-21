import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function cleanOptionalNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

/** A small plain object of counters, e.g. a reason -> count breakdown. */
function cleanCounters(value, limit = 40) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value)
    .filter(([, count]) => Number.isFinite(Number(count)))
    .slice(0, limit)
    .map(([reason, count]) => [String(reason).slice(0, 80), Number(count)]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** A short list of codes or names. */
function cleanCodeList(value, limit = 40) {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .filter(item => item != null)
    .slice(0, limit)
    .map(item => String(item).slice(0, 80));
  return list.length ? list : undefined;
}

/**
 * The whitelist below is what reaches the status file and `/health`.
 *
 * It used to cover only the fetch counters, so every refusal reason the
 * pipeline produces - which country was not allowed, which route could not be
 * resolved, what the parser dropped - was computed, logged once and then
 * stripped before being written down. A reason nobody can read afterwards is
 * the silent loss this file exists to prevent.
 */
export function sanitizeSourceStatus(status) {
  return {
    // Route policy, validation and parser diagnostics.
    checked: cleanOptionalNumber(status?.checked),
    allowed: cleanOptionalNumber(status?.allowed),
    refused: cleanOptionalNumber(status?.refused),
    verified: cleanOptionalNumber(status?.verified),
    needsReview: cleanOptionalNumber(status?.needsReview),
    rejected: cleanOptionalNumber(status?.rejected),
    dropped: cleanOptionalNumber(status?.dropped),
    droppedAtParse: cleanOptionalNumber(status?.droppedAtParse),
    unclassified: cleanOptionalNumber(status?.unclassified),
    reasons: cleanCounters(status?.reasons),
    droppedReasons: cleanCounters(status?.droppedReasons),
    notAllowedCountries: cleanCodeList(status?.notAllowedCountries),
    foreignToForeignCountries: cleanCodeList(status?.foreignToForeignCountries),
    allowedCountries: cleanCodeList(status?.allowedCountries),
    // Publication outcome.
    transport: status?.transport ? String(status.transport).slice(0, 40) : undefined,
    window: status?.window ? String(status.window).slice(0, 40) : undefined,
    region: status?.region ? String(status.region).slice(0, 40) : undefined,
    localDate: status?.localDate ? String(status.localDate).slice(0, 10) : undefined,
    totals: cleanCounters(status?.totals),
    stale: typeof status?.stale === "boolean" ? status.stale : undefined,
    lastNewPostAt: status?.lastNewPostAt ? String(status.lastNewPostAt).slice(0, 40) : undefined,
    // Discovery.
    selected: cleanOptionalNumber(status?.selected),
    minSubscribers: cleanOptionalNumber(status?.minSubscribers),
    id: String(status?.id || "unknown"),
    kind: String(status?.kind || "unknown"),
    status: String(status?.status || "unknown"),
    reason: status?.reason ? String(status.reason).slice(0, 500) : undefined,
    finalUrl: status?.finalUrl ? String(status.finalUrl).slice(0, 1000) : undefined,
    rows: cleanOptionalNumber(status?.rows),
    usableRows: cleanOptionalNumber(status?.usableRows),
    routes: cleanOptionalNumber(status?.routes),
    requests: cleanOptionalNumber(status?.requests),
    rawOffers: cleanOptionalNumber(status?.rawOffers),
    pricingSkipped: cleanOptionalNumber(status?.pricingSkipped),
    pages: cleanOptionalNumber(status?.pages),
    posts: cleanOptionalNumber(status?.posts),
    skippedOld: cleanOptionalNumber(status?.skippedOld),
    skippedAuto: cleanOptionalNumber(status?.skippedAuto),
    messages: cleanOptionalNumber(status?.messages),
    offers: cleanOptionalNumber(status?.offers),
    ignoredAutoPosts: cleanOptionalNumber(status?.ignoredAutoPosts),
    currencySource: status?.currencySource ? String(status.currencySource) : undefined
  };
}

export async function writeSourceStatus(path, { statuses, summary }) {
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: Array.isArray(statuses) ? statuses.map(sanitizeSourceStatus) : [],
    summary: summary && typeof summary === "object" ? summary : {}
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

export async function readSourceStatus(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
