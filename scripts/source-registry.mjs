import { parseTelegramSourceList, sourceFromHandle } from "./telegram-source-adapter.mjs";

const DEFAULT_PUBLIC_TELEGRAM_CHANNELS = [
  "charter_forever_travel",
  "charterkaz"
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
  note: "Public Telegram charter source"
}));

export function configuredTelegramSources(env = process.env) {
  return parseTelegramSourceList(env.TELEGRAM_SOURCE_CHANNELS)
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
  ]);
}

// Kept as an empty compatibility export so older diagnostics/tests do not break.
// The production pipeline is Telegram-only and does not probe websites.
export function monitoredSources() {
  return [];
}

export function enabledSources(env = process.env) {
  return ingestSources(env);
}
