import { createHash } from "node:crypto";

const AIRLINES = [
  "Air Astana", "Эйр Астана", "SCAT", "Scat", "VietJet Air", "Вьетжет Эйр",
  "Fly Arystan", "FlyArystan", "Pegasus", "Sunday Airlines", "Air Cairo",
  "Red Sea", "Neos", "Neos Air", "Sun Phu Quoc", "Air Arabia", "Centrum Air",
  "CENTRUM AIR", "Qazaq Air", "Turkish Airlines", "Wizz Air", "Charter", "Чартер"
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function cleanHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/t\.me\/(?:s\/)?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
}

export function parseTelegramSourceList(value) {
  return String(value || "")
    .split(",")
    .map(cleanHandle)
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

export function sourceFromHandle(handle) {
  const clean = cleanHandle(handle);
  return {
    id: "telegram:" + clean,
    label: "Telegram @" + clean,
    kind: "telegram_public",
    adapter: "telegram_public_feed",
    priceKind: "cost",
    url: "https://t.me/s/" + clean,
    handle: clean,
    enabled: Boolean(clean),
    ingest: Boolean(clean)
  };
}

function postIdFromDataPost(value) {
  const match = String(value || "").match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function extractPublicTelegramPosts(html) {
  const posts = [];
  const blockRe = /<div class="tgme_widget_message_wrap[^"]*"[^>]*>([\s\S]*?)(?=<div class="tgme_widget_message_wrap|<div class="tgme_channel_info|<\/body>|$)/gi;

  for (const blockMatch of String(html || "").matchAll(blockRe)) {
    const block = blockMatch[1];
    const dataPost = block.match(/data-post="([^"]+)"/i)?.[1] || "";
    const datetime = block.match(/<time[^>]*datetime="([^"]+)"/i)?.[1] || null;
    const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const text = textMatch ? decodeHtml(textMatch[1]) : "";
    if (!text) continue;
    posts.push({
      dataPost,
      id: postIdFromDataPost(dataPost),
      postedAt: datetime,
      text
    });
  }

  if (!posts.length) {
    const textRe = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let index = 0;
    for (const match of String(html || "").matchAll(textRe)) {
      const text = decodeHtml(match[1]);
      if (text) posts.push({ dataPost: "", id: null, postedAt: null, text, fallbackIndex: index++ });
    }
  }

  return posts;
}

function normalizeCity(value) {
  return String(value || "")
    .replace(/^\p{Extended_Pictographic}+\s*/u, "")
    .replace(/^\s*(?:OW|RT)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/[,.]+$/g, "")
    .trim();
}

function sameCity(a, b) {
  return normalizeCity(a).toLocaleLowerCase("ru-RU") === normalizeCity(b).toLocaleLowerCase("ru-RU");
}

function isRouteNoise(value) {
  return /^(?:OW|RT|туда|обратно|туда[- ]?обратно|в одну сторону|эконом|бизнес|багаж|вылет|последн)/iu.test(value);
}

export function parseRouteLine(line) {
  const raw = String(line || "")
    .replace(/^[-•]+\s*/, "")
    .replace(/^✈️?\s*/u, "")
    .replace(/[),]+$/g, "")
    .trim();
  if (!raw || /^\d{1,2}[./]\d{1,2}/.test(raw) || isRouteNoise(raw)) return null;

  const parts = raw
    .split(/\s*(?:→|->|⟶|➡|⇄|⇆|↔)\s*|\s+[—–-]\s+/u)
    .map(normalizeCity)
    .filter(Boolean);

  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some(part => /^\d/.test(part) || part.length < 2 || /^(?:₸|тенге)$/iu.test(part))) return null;

  const from = parts[0];
  const to = parts[1];
  const roundTrip = parts.length === 3 && sameCity(parts[0], parts[2]);
  return { from, to, trip: roundTrip ? "RT" : "OW" };
}

function inferYear(day, month, now) {
  let year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day, 12));
  const diffDays = (candidate.getTime() - now.getTime()) / 86400000;
  if (diffDays < -120) year += 1;
  return year;
}

function toIso(day, month, explicitYear, now) {
  const d = Number(day);
  const m = Number(month);
  if (!d || !m || d > 31 || m > 12) return null;
  let year = Number(explicitYear);
  if (!Number.isFinite(year) || !year) year = inferYear(d, m, now);
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, m - 1, d, 12));
  if (Number.isNaN(date.getTime()) || date.getUTCDate() !== d || date.getUTCMonth() + 1 !== m) return null;
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

function dateFromText(value, now) {
  const match = String(value || "").match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  return match ? toIso(match[1], match[2], match[3], now) : null;
}

function addDays(iso, days) {
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + Number(days));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

function numericPrice(value) {
  const n = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n >= 5000 && n <= 5000000 ? n : null;
}

export function parseOfferLine(line, now) {
  const text = String(line || "").replace(/\u00a0/g, " ").trim();
  if (!text) return null;

  let departureDate = null;
  let returnDate = null;
  let price = null;

  const range = text.match(/(?:^|\s)(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*(?:→|->|—|–|-)\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*(?:=|—|–|-)\s*([\d\s.,]{4,})/u);
  if (range) {
    departureDate = dateFromText(range[1], now);
    returnDate = dateFromText(range[2], now);
    price = numericPrice(range[3]);
  }

  if (!departureDate) {
    const nights = text.match(/(?:^|\s)(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s+на\s+(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s+ноч(?:ь|и|ей)\s*(?:=|—|–|-)\s*([\d\s.,]{4,})/iu);
    if (nights) {
      departureDate = dateFromText(nights[1], now);
      if (departureDate) returnDate = addDays(departureDate, Number(nights[2]));
      price = numericPrice(nights[3]);
    }
  }

  if (!departureDate) {
    const single = text.match(/(?:^|\s)(?:[A-ZА-Я]\s+)?(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*(?:=|—|–|-)\s*([\d\s.,]{4,})/u);
    if (single) {
      departureDate = dateFromText(single[1], now);
      price = numericPrice(single[2]);
    }
  }

  if (!departureDate || !price) return null;

  const seatMatch = text.match(/\((\d{1,2})\)|\b(\d{1,2})\s*(?:мест|место|места|кресл)/iu);
  const count = Number(seatMatch?.[1] || seatMatch?.[2] || 0);
  const lastSeat = /последн(?:ее|ий|яя)\s+(?:место|кресло)/iu.test(text);

  return {
    departureDate,
    returnDate,
    price,
    hot: /🔥/u.test(text),
    seats: lastSeat ? "Последнее место" : count > 0 ? count + " мест" : "Наличие уточняется"
  };
}

function detectAirline(line) {
  const text = String(line || "").trim();
  const direct = AIRLINES.find(name => text.toLocaleLowerCase("ru-RU").includes(name.toLocaleLowerCase("ru-RU")));
  if (direct) return direct === "Charter" ? "Чартер" : direct;
  const tagged = text.match(/(?:а\/к|airline)\s*[:\-]?\s*([A-Za-zА-ЯЁ][A-Za-zА-ЯЁ0-9 .-]{1,40})/iu);
  return tagged ? tagged[1].trim() : null;
}

function daysUntil(iso, now) {
  const target = new Date(iso + "T12:00:00Z");
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function stableExternalId(sourceId, postId, index, offer) {
  if (postId != null) return sourceId + ":" + postId + ":" + index;
  const raw = [sourceId, offer.from, offer.to, offer.departureDate, offer.returnDate || "", offer.trip, offer.price].join("|");
  return sourceId + ":" + createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

export function parseTelegramPost(text, {
  sourceId,
  postId = null,
  postedAt = null,
  now = new Date()
} = {}) {
  const lines = String(text || "").split("\n").map(line => line.trim()).filter(Boolean);
  const offers = [];
  let route = null;
  let tripHint = "OW";
  let airline = null;

  for (const line of lines) {
    const foundAirline = detectAirline(line);
    const maybeRoute = parseRouteLine(line);

    if (foundAirline && !maybeRoute) {
      airline = foundAirline;
      continue;
    }

    if (maybeRoute) {
      route = maybeRoute;
      tripHint = maybeRoute.trip;
      const inlineAirline = detectAirline(line);
      if (inlineAirline) airline = inlineAirline;
      continue;
    }

    if (/\b(?:RT|туда[ -]?обратно)\b/iu.test(line)) {
      tripHint = "RT";
      continue;
    }
    if (/\b(?:OW|в одну сторону)\b/iu.test(line)) {
      tripHint = "OW";
      continue;
    }

    const parsed = parseOfferLine(line, now);
    if (!parsed || !route) continue;

    const trip = parsed.returnDate ? "RT" : tripHint;
    const offset = daysUntil(parsed.departureDate, now);
    if (offset <= 0 || offset > 365) continue;

    const offer = {
      sourceId,
      externalId: "",
      from: route.from,
      to: route.to,
      departureDate: parsed.departureDate,
      returnDate: parsed.returnDate,
      trip,
      airline: airline || undefined,
      sourcePrice: parsed.price,
      currency: "KZT",
      seats: parsed.seats,
      hot: parsed.hot,
      postedAt
    };
    offer.externalId = stableExternalId(sourceId, postId, offers.length, offer);
    offers.push(offer);
  }

  return offers;
}

function isWithinTtl(postedAt, now, ttlHours) {
  if (!postedAt) return true;
  const stamp = new Date(postedAt);
  if (Number.isNaN(stamp.getTime())) return true;
  const ageMs = now.getTime() - stamp.getTime();
  return ageMs >= -3600000 && ageMs <= ttlHours * 3600000;
}

async function fetchPage(url, fetchImpl, timeoutMs) {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CharterFlightSync/4.0)",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error("Telegram HTTP " + response.status);
  return response.text();
}

export async function fetchTelegramSourceOffers({
  source,
  now = new Date(),
  ttlHours = 24,
  maxPages = 6,
  timeoutMs = 15000,
  fetchImpl = fetch,
  shouldSkipText = () => false
}) {
  const allPosts = new Map();
  let pageUrl = source.url;
  let pages = 0;

  while (pageUrl && pages < maxPages) {
    const html = await fetchPage(pageUrl, fetchImpl, timeoutMs);
    pages += 1;
    const posts = extractPublicTelegramPosts(html);
    if (!posts.length) break;

    for (const post of posts) {
      const key = post.dataPost || "fallback:" + pages + ":" + (post.fallbackIndex ?? allPosts.size);
      if (!allPosts.has(key)) allPosts.set(key, post);
    }

    const dated = posts.filter(post => post.postedAt).map(post => new Date(post.postedAt)).filter(date => !Number.isNaN(date.getTime()));
    if (dated.length) {
      const oldestDate = new Date(Math.min(...dated.map(date => date.getTime())));
      if (now.getTime() - oldestDate.getTime() > ttlHours * 3600000) break;
    }

    const ids = posts.map(post => post.id).filter(Number.isInteger);
    if (!ids.length) break;
    const oldestId = Math.min(...ids);
    pageUrl = "https://t.me/s/" + source.handle + "?before=" + oldestId;
  }

  let postsRead = 0;
  let skippedOld = 0;
  let skippedAuto = 0;
  const offers = [];

  for (const post of allPosts.values()) {
    if (!isWithinTtl(post.postedAt, now, ttlHours)) {
      skippedOld += 1;
      continue;
    }
    postsRead += 1;
    if (shouldSkipText(post.text)) {
      skippedAuto += 1;
      continue;
    }
    offers.push(...parseTelegramPost(post.text, {
      sourceId: source.id,
      postId: post.id,
      postedAt: post.postedAt,
      now
    }));
  }

  return {
    offers,
    status: {
      id: source.id,
      kind: source.kind,
      status: "ok",
      pages,
      posts: postsRead,
      offers: offers.length,
      skippedOld,
      skippedAuto
    }
  };
}
