import { parseTelegramSourceList, sourceFromHandle } from "./telegram-source-adapter.mjs";

const OWN_PUBLICATION_CHANNEL_HANDLES = new Set([
  "charter_forever_travel",
  "charterkaz"
]);

/**
 * Channels ingested through the public `t.me/s/<handle>` feed. This list needs
 * no credentials and no discovery run, so a channel is only actually collected
 * from when it appears here or in `TELEGRAM_SOURCE_CHANNELS`.
 *
 * `charterticketsme` (Step2Travel) existed in this codebase only as a
 * DISCOVERY SEED, in `telegram-channel-discovery.mjs`. Discovery is off by
 * default, needs `TG_API_ID`/`TG_API_HASH`/`TG_SESSION`, and rejects any
 * channel under 10 000 subscribers - so the seed never ran and the channel was
 * never read. That is why its tickets, Astana -> Phu Quoc among them, never
 * reached the feed: not a parsing failure, the channel was simply never
 * fetched.
 */
const DEFAULT_PUBLIC_TELEGRAM_CHANNELS = [
  "bilettu",
  "biletuu",
  "avia07",
  "chartersavia",
  "charter_antalya",
  "charterticketsme"
];

function uniqueById(sources) {
  const seen = new Set();
  return sources.filter(source => {
    if (!source?.id || seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  });
}

export const sourceRegistry = DEFAULT_PUBLIC_TELEGRAM_CHANNELS.map(handle => ({
  ...sourceFromHandle(handle),
  enabled: true,
  ingest: true,
  priceKind: "sale",
  note: "Verified public Telegram charter source"
}));

export function configuredTelegramSources(env = process.env) {
  return parseTelegramSourceList(env.TELEGRAM_SOURCE_CHANNELS)
    .filter(handle => !OWN_PUBLICATION_CHANNEL_HANDLES.has(handle))
    .map(sourceFromHandle)
    .map(source => ({
      ...source,
      enabled: true,
      ingest: true,
      priceKind: "sale"
    }));
}

export function ingestSources(env = process.env) {
  return uniqueById([
    ...sourceRegistry,
    ...configuredTelegramSources(env)
  ]).filter(source => !OWN_PUBLICATION_CHANNEL_HANDLES.has(source.handle));
}

// Kept as an empty compatibility export so older diagnostics/tests do not break.
// The production pipeline is Telegram-only and does not probe websites.
export function monitoredSources() {
  return [];
}

export function enabledSources(env = process.env) {
  return ingestSources(env);
}
