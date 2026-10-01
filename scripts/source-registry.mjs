import { parseTelegramSourceList, sourceFromHandle } from "./telegram-source-adapter.mjs";

const OWN_PUBLICATION_CHANNEL_HANDLES = new Set([
  "charter_forever_travel"
]);

const DEFAULT_PUBLIC_TELEGRAM_CHANNELS = [
  "bilettu",
  "biletuu",
  "avia07",
  "chartersavia",
  "charter_antalya"
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
  priceKind: "cost",
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
      priceKind: "cost"
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
