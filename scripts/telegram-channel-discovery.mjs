import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseTelegramPost, sourceFromHandle } from "./telegram-source-adapter.mjs";

const OWN_CHANNELS = new Set(["charter_forever_travel", "charterkaz"]);
const DEFAULT_SEARCH_QUERIES = [
  "чартер авиабилеты",
  "чартерные рейсы",
  "горящие авиабилеты",
  "авиабилеты Казахстан",
  "Алматы Нячанг",
  "Астана Фукуок"
];

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function cleanHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/t\.me\/(?:s\/)?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

export function discoveryConfig(env = process.env) {
  const minSubscribers = Math.max(
    1000,
    Math.floor(Number(env.TELEGRAM_DISCOVERY_MIN_SUBSCRIBERS || 10000))
  );
  const maxChannels = Math.max(
    1,
    Math.min(30, Math.floor(Number(env.TELEGRAM_DISCOVERY_MAX_CHANNELS || 12)))
  );
  const minOfferPosts = Math.max(
    1,
    Math.min(20, Math.floor(Number(env.TELEGRAM_DISCOVERY_MIN_OFFER_POSTS || 3)))
  );
  const minParsedOffers = Math.max(
    1,
    Math.min(100, Math.floor(Number(env.TELEGRAM_DISCOVERY_MIN_PARSED_OFFERS || 3)))
  );
  const recentMessages = Math.max(
    10,
    Math.min(100, Math.floor(Number(env.TELEGRAM_DISCOVERY_RECENT_MESSAGES || 50)))
  );
  const maxPostAgeDays = Math.max(
    1,
    Math.min(30, Math.floor(Number(env.TELEGRAM_DISCOVERY_MAX_POST_AGE_DAYS || 7)))
  );
  const refreshHours = Math.max(
    1,
    Math.min(48, Number(env.TELEGRAM_DISCOVERY_REFRESH_HOURS || 12))
  );

  const queries = splitCsv(env.TELEGRAM_DISCOVERY_SEARCH_QUERIES);
  return {
    enabled: String(env.TELEGRAM_DISCOVERY_ENABLED || "false").toLowerCase() === "true",
    minSubscribers,
    maxChannels,
    minOfferPosts,
    minParsedOffers,
    recentMessages,
    maxPostAgeDays,
    refreshHours,
    queries: queries.length ? queries : DEFAULT_SEARCH_QUERIES,
    cachePath: resolve(env.TELEGRAM_DISCOVERY_CACHE_PATH || "/data/telegram-discovered-sources.json"),
    maxCandidates: Math.max(
      maxChannels,
      Math.min(80, Math.floor(Number(env.TELEGRAM_DISCOVERY_MAX_CANDIDATES || 35)))
    )
  };
}

export function messageLooksLikeCharter(text) {
  const value = String(text || "").replace(/\u00a0/g, " ");
  if (!value) return false;

  const hasDate = /\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b/u.test(value);
  const hasPrice = /\b\d{1,3}(?:[ .]\d{3})+\b|\b\d{2,4}\s*(?:тыс\.?|k)\b/iu.test(value);
  const hasRoute =
    /(?:→|->|➔|➡|↔|⇄)/u.test(value)
    || /\b(?:ALA|NQZ|CIT|CXR|PQC|DAD|HKT|AYT|SSH|HRG|DXB|SHJ)\b/u.test(value)
    || /\b(?:Алматы|Астана|Шымкент|Нячанг|Фукуок|Дананг|Пхукет|Антал(?:ия|ья)|Шарм|Хургада|Дубай|Шарджа)\b[\s\S]{0,40}\b(?:Алматы|Астана|Шымкент|Нячанг|Фукуок|Дананг|Пхукет|Антал(?:ия|ья)|Шарм|Хургада|Дубай|Шарджа)\b/iu.test(value);
  const hasTicketSignal = /(?:чартер|авиабилет|билет|багаж|ручн(?:ая|ой)\s+клад|туда\s*обратно|мест[ао]?)/iu.test(value);

  return hasDate && hasPrice && hasRoute && hasTicketSignal;
}

export function summarizeRecentCharterMessages(messages, {
  sourceId = "telegram:discovery",
  now = new Date(),
  maxPostAgeDays = 7
} = {}) {
  let offerPosts = 0;
  let parsedOffers = 0;
  let lastPostAt = null;
  const cutoff = now.getTime() - Math.max(1, maxPostAgeDays) * 86400000;

  for (const message of Array.isArray(messages) ? messages : []) {
    const text = String(message?.message || message?.text || "").trim();
    if (!text) continue;

    const dateValue = message?.date instanceof Date
      ? message.date
      : message?.date
        ? new Date(Number(message.date) * 1000)
        : null;
    if (dateValue && !Number.isNaN(dateValue.getTime())) {
      if (!lastPostAt || dateValue > lastPostAt) lastPostAt = dateValue;
      if (dateValue.getTime() < cutoff) continue;
    }

    const offers = parseTelegramPost(text, {
      sourceId,
      postId: Number(message?.id || 0) || null,
      postedAt: dateValue && !Number.isNaN(dateValue.getTime())
        ? dateValue.toISOString()
        : null,
      now
    });

    if (offers.length) {
      offerPosts += 1;
      parsedOffers += offers.length;
      continue;
    }

    if (messageLooksLikeCharter(text)) offerPosts += 1;
  }

  return {
    offerPosts,
    parsedOffers,
    lastPostAt: lastPostAt ? lastPostAt.toISOString() : null
  };
}

export function channelPassesLargeSourceGate(candidate, config) {
  return Boolean(
    candidate
    && candidate.handle
    && candidate.public === true
    && candidate.broadcast === true
    && Number(candidate.subscribers || 0) >= config.minSubscribers
    && Number(candidate.offerPosts || 0) >= config.minOfferPosts
    && Number(candidate.parsedOffers || 0) >= config.minParsedOffers
  );
}

async function readCache(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return parsed && Array.isArray(parsed.sources) ? parsed : null;
  } catch {
    return null;
  }
}

function cacheAgeHours(cache, now) {
  const stamp = Date.parse(cache?.updatedAt || "");
  if (!Number.isFinite(stamp)) return Infinity;
  return Math.max(0, now.getTime() - stamp) / 3600000;
}

async function saveCache(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function cacheSources(cache) {
  return (cache?.sources || [])
    .map(item => {
      const handle = cleanHandle(item?.handle);
      if (!handle || OWN_CHANNELS.has(handle)) return null;
      return {
        ...sourceFromHandle(handle),
        discovery: {
          subscribers: Number(item?.subscribers || 0),
          offerPosts: Number(item?.offerPosts || 0),
          parsedOffers: Number(item?.parsedOffers || 0),
          discoveredAt: cache.updatedAt || null
        }
      };
    })
    .filter(Boolean);
}

export function normalizeTelegramSessionString(value) {
  let session = String(value || "").trim();
  session = session.replace(/^TG_SESSION\s*[:=]\s*/i, "").trim();

  if (
    (session.startsWith('"') && session.endsWith('"'))
    || (session.startsWith("'") && session.endsWith("'"))
  ) {
    session = session.slice(1, -1).trim();
  }

  session = session.replace(/\s+/g, "");
  return session;
}

async function loadTeleprotoClient(env) {
  const apiId = Number(env.TG_API_ID);
  const apiHash = String(env.TG_API_HASH || "").trim();
  const sessionString = normalizeTelegramSessionString(env.TG_SESSION);
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !sessionString) {
    throw new Error("TG_API_ID, TG_API_HASH and TG_SESSION are required for Telegram discovery");
  }

  const [{ TelegramClient, Api }, { StringSession }] = await Promise.all([
    import("teleproto"),
    import("teleproto/sessions")
  ]);

  const client = new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3
  });
  await client.connect();
  await client.getMe();
  return { client, Api };
}

function activeUsername(chat) {
  const direct = cleanHandle(chat?.username);
  if (direct) return direct;
  const active = Array.isArray(chat?.usernames)
    ? chat.usernames.find(item => item?.active && item?.username)
    : null;
  return cleanHandle(active?.username);
}

async function collectSearchCandidates(client, Api, config) {
  const map = new Map();
  const minDate = Math.floor((Date.now() - config.maxPostAgeDays * 86400000) / 1000);

  for (const query of config.queries) {
    const result = await client.invoke(new Api.messages.SearchGlobal({
      broadcastsOnly: true,
      q: query,
      filter: new Api.InputMessagesFilterEmpty(),
      minDate,
      maxDate: 0,
      offsetRate: 0,
      offsetPeer: new Api.InputPeerEmpty(),
      offsetId: 0,
      limit: 50
    }));

    for (const chat of result?.chats || []) {
      const handle = activeUsername(chat);
      if (!handle || OWN_CHANNELS.has(handle) || chat?.broadcast !== true) continue;
      if (!map.has(handle)) {
        map.set(handle, {
          entity: chat,
          handle,
          title: String(chat?.title || handle),
          broadcast: true,
          public: true,
          hintedSubscribers: Number(chat?.participantsCount || 0),
          matchedQueries: new Set()
        });
      }
      map.get(handle).matchedQueries.add(query);
    }

    if (map.size >= config.maxCandidates) break;
  }

  return map;
}

async function addSeedCandidates(client, map, env) {
  const seeds = new Set([
    "charterticketsme",
    ...splitCsv(env.TELEGRAM_SOURCE_CHANNELS).map(cleanHandle)
  ]);

  for (const handle of seeds) {
    if (!handle || OWN_CHANNELS.has(handle) || map.has(handle)) continue;
    try {
      const entity = await client.getEntity("@" + handle);
      if (!entity || entity?.broadcast !== true) continue;
      map.set(handle, {
        entity,
        handle,
        title: String(entity?.title || handle),
        broadcast: true,
        public: true,
        hintedSubscribers: Number(entity?.participantsCount || 0),
        matchedQueries: new Set(["seed"])
      });
    } catch {
      // Ignore unavailable/private seed channels.
    }
  }
}

async function inspectCandidate(client, Api, candidate, config, now) {
  const input = await client.getInputEntity(candidate.entity);
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel: input }));
  const subscribers = Number(
    full?.fullChat?.participantsCount
    || candidate.hintedSubscribers
    || 0
  );

  if (subscribers < config.minSubscribers) {
    return {
      ...candidate,
      subscribers,
      offerPosts: 0,
      parsedOffers: 0,
      qualified: false,
      reason: "subscriber_threshold"
    };
  }

  const messages = await client.getMessages(candidate.entity, {
    limit: config.recentMessages
  });
  const summary = summarizeRecentCharterMessages(messages, {
    sourceId: "telegram:" + candidate.handle,
    now,
    maxPostAgeDays: config.maxPostAgeDays
  });

  const result = {
    ...candidate,
    subscribers,
    ...summary
  };
  result.qualified = channelPassesLargeSourceGate(result, config);
  result.reason = result.qualified ? "qualified" : "insufficient_charter_activity";
  return result;
}

export async function discoverLargeTelegramSources({
  env = process.env,
  now = new Date()
} = {}) {
  const config = discoveryConfig(env);
  const cache = await readCache(config.cachePath);

  if (!config.enabled) {
    return {
      sources: [],
      status: {
        id: "telegram_discovery",
        kind: "telegram_session_discovery",
        status: "disabled",
        minSubscribers: config.minSubscribers,
        selected: 0
      }
    };
  }

  if (cache && cacheAgeHours(cache, now) < config.refreshHours) {
    const sources = cacheSources(cache);
    return {
      sources,
      status: {
        id: "telegram_discovery",
        kind: "telegram_session_discovery",
        status: "cache",
        minSubscribers: config.minSubscribers,
        selected: sources.length,
        channels: cache.sources
      }
    };
  }

  let client = null;
  try {
    const loaded = await loadTeleprotoClient(env);
    client = loaded.client;
    const Api = loaded.Api;
    const candidates = await collectSearchCandidates(client, Api, config);
    await addSeedCandidates(client, candidates, env);

    const inspected = [];
    for (const candidate of [...candidates.values()].slice(0, config.maxCandidates)) {
      try {
        inspected.push(await inspectCandidate(client, Api, candidate, config, now));
      } catch (error) {
        inspected.push({
          handle: candidate.handle,
          title: candidate.title,
          subscribers: candidate.hintedSubscribers || 0,
          offerPosts: 0,
          parsedOffers: 0,
          qualified: false,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const selected = inspected
      .filter(item => item.qualified)
      .sort((a, b) =>
        Number(b.subscribers || 0) - Number(a.subscribers || 0)
        || Number(b.parsedOffers || 0) - Number(a.parsedOffers || 0)
      )
      .slice(0, config.maxChannels)
      .map(item => ({
        handle: item.handle,
        title: item.title,
        subscribers: item.subscribers,
        offerPosts: item.offerPosts,
        parsedOffers: item.parsedOffers,
        lastPostAt: item.lastPostAt,
        matchedQueries: [...(item.matchedQueries || [])]
      }));

    const payload = {
      updatedAt: now.toISOString(),
      minSubscribers: config.minSubscribers,
      sources: selected
    };
    await saveCache(config.cachePath, payload);

    return {
      sources: cacheSources(payload),
      status: {
        id: "telegram_discovery",
        kind: "telegram_session_discovery",
        status: "ok",
        searchedQueries: config.queries.length,
        candidates: inspected.length,
        minSubscribers: config.minSubscribers,
        selected: selected.length,
        channels: selected
      }
    };
  } catch (error) {
    if (cache && cacheAgeHours(cache, now) <= 72) {
      const sources = cacheSources(cache);
      return {
        sources,
        status: {
          id: "telegram_discovery",
          kind: "telegram_session_discovery",
          status: "stale_cache",
          reason: error instanceof Error ? error.message : String(error),
          minSubscribers: config.minSubscribers,
          selected: sources.length,
          channels: cache.sources
        }
      };
    }

    return {
      sources: [],
      status: {
        id: "telegram_discovery",
        kind: "telegram_session_discovery",
        status: "error",
        reason: error instanceof Error ? error.message : String(error),
        minSubscribers: config.minSubscribers,
        selected: 0
      }
    };
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
    }
  }
}
