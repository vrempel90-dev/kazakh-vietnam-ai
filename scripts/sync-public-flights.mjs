import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCES = [
  { id: "charter_forever_travel", label: "Forever Travel", url: "https://t.me/s/charter_forever_travel" },
  { id: "charterkaz", label: "Чартерные авиабилеты", url: "https://t.me/s/charterkaz" }
];

const AIRLINES = [
  "Air Astana", "Эйр Астана", "SCAT", "Scat", "VietJet Air", "Вьетжет Эйр",
  "Fly Arystan", "FlyArystan", "Pegasus", "Sunday Airlines", "Air Cairo", "Red Sea", "Neos", "Sun Phu Quoc"
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
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

function extractMessages(html) {
  const messages = [];
  const re = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of html.matchAll(re)) {
    const text = decodeHtml(match[1]);
    if (text) messages.push(text);
  }
  return messages;
}

function cleanCity(value) {
  return value
    .replace(/^✈️\s*/u, "")
    .replace(/[,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replace(/(^|[\s(])-?([а-яёa-z])/giu, (m, prefix, letter) => prefix + letter.toLocaleUpperCase("ru-RU"));
}

function normalizeCity(value) {
  return value.toLocaleLowerCase("ru-RU").replace(/[^а-яёa-z0-9]/giu, "");
}

function parseRoute(line) {
  const cleaned = line.replace(/^[-•]+\s*/, "").trim();
  if (/^\d{1,2}\.\d{1,2}/.test(cleaned)) return null;
  if (/^(туда|в одну|ow|rt|вылет|последн|багаж|эконом|бизнес)/iu.test(cleaned)) return null;
  const parts = cleaned
    .replace(/^✈️\s*/u, "")
    .replace(/,$/, "")
    .split(/\s*(?:→|->)\s*|\s+[—–-]\s+/u)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some(part => /^\d/.test(part) || part.length < 2)) return null;
  const from = cleanCity(parts[0]);
  const to = cleanCity(parts[1]);
  const isRound = parts.length === 3 && normalizeCity(parts[0]) === normalizeCity(parts[2]);
  return { from, to, trip: isRound ? "RT" : "OW" };
}

function inferYear(day, month, now) {
  let year = now.getFullYear();
  const candidate = new Date(year, month - 1, day, 12);
  const diffDays = (candidate.getTime() - now.getTime()) / 86400000;
  if (diffDays < -120) year += 1;
  return year;
}

function toIso(dateText, now) {
  const [day, month] = dateText.split(".").map(Number);
  if (!day || !month) return null;
  const year = inferYear(day, month, now);
  const d = new Date(year, month - 1, day, 12);
  if (Number.isNaN(d.getTime())) return null;
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function dayOffset(iso, now) {
  const target = new Date(iso + "T12:00:00");
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function parsePriceLine(line, now) {
  const normalized = line.replace(/\u00a0/g, " ").trim();
  let match = normalized.match(/^(?:[A-Za-zА-ЯЁ]\s+)?(\d{1,2}\.\d{1,2})(?:\s*(?:—|–|-|→)\s*(\d{1,2}\.\d{1,2}))?\s*(?:=|—|–|-)\s*([\d\s]{4,})/u);
  let nights = null;
  if (!match) {
    match = normalized.match(/^(\d{1,2}\.\d{1,2})\s+на\s+(\d{1,2})(?:-|–|—)?(?:\d{1,2})?\s+ноч(?:ь|и|ей)\s*=\s*([\d\s]{4,})/iu);
    if (match) {
      nights = Number(match[2]);
      match = [match[0], match[1], undefined, match[3]];
    }
  }
  if (!match) return null;
  const departureDate = toIso(match[1], now);
  if (!departureDate) return null;
  let returnDate = match[2] ? toIso(match[2], now) : null;
  if (!returnDate && nights) {
    const d = new Date(departureDate + "T12:00:00");
    d.setDate(d.getDate() + nights);
    returnDate = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  }
  const price = Number(String(match[3]).replace(/\s/g, ""));
  if (!Number.isFinite(price) || price < 1000) return null;
  const countMatch = normalized.match(/\((\d{1,2})\)|\b(\d{1,2})\s*(?:мест|место|места|кресл)/iu);
  const count = Number(countMatch?.[1] || countMatch?.[2] || 0);
  const lastSeat = /последн(?:ее|ий|яя)\s+(?:место|кресло)/iu.test(normalized);
  return {
    departureDate,
    returnDate,
    price,
    hot: normalized.includes("🔥"),
    seats: lastSeat ? "Последнее место" : count > 0 ? count + " мест" : "Наличие уточняется"
  };
}

function findAirline(line) {
  return AIRLINES.find(name => line.toLocaleLowerCase("ru-RU").includes(name.toLocaleLowerCase("ru-RU"))) || null;
}

function stableId(flight) {
  const raw = [flight.from, flight.to, flight.departureDate, flight.returnDate || "", flight.trip, flight.airline || ""].join("|");
  return createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

function parseMessage(text, source, now) {
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const flights = [];
  let route = null;
  let trip = "OW";
  let airline = null;

  for (const line of lines) {
    const maybeRoute = parseRoute(line);
    if (maybeRoute) {
      route = maybeRoute;
      trip = maybeRoute.trip;
      airline = null;
      continue;
    }
    if (/\b(?:RT|туда[ -]?обратно)\b/iu.test(line)) {
      trip = "RT";
      continue;
    }
    if (/\b(?:OW|в одну сторону)\b/iu.test(line)) {
      trip = "OW";
      continue;
    }
    const foundAirline = findAirline(line);
    if (foundAirline && !/^\d/.test(line)) {
      airline = foundAirline;
      continue;
    }
    const offer = parsePriceLine(line, now);
    if (!offer || !route) continue;
    const effectiveTrip = offer.returnDate ? "RT" : trip;
    const offset = dayOffset(offer.departureDate, now);
    if (offset < 0 || offset > 365) continue;
    const flight = {
      id: "",
      from: route.from,
      to: route.to,
      offset,
      price: offer.price,
      trip: effectiveTrip,
      hot: offer.hot,
      seats: offer.seats,
      airline: airline || undefined,
      source: source.label,
      departureDate: offer.departureDate,
      returnDate: offer.returnDate || undefined,
      updatedAt: new Date().toISOString()
    };
    flight.id = stableId(flight);
    flights.push(flight);
  }
  return flights;
}

async function fetchSource(source) {
  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CharterFlightSync/1.0; +https://github.com/vrempel90-dev/kazakh-vietnam-ai)",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(source.id + " HTTP " + response.status);
  return response.text();
}

const now = new Date();
const collected = [];
const sourceStatus = [];

for (const source of SOURCES) {
  try {
    const html = await fetchSource(source);
    const messages = extractMessages(html);
    const parsed = messages.flatMap(message => parseMessage(message, source, now));
    collected.push(...parsed);
    sourceStatus.push({ id: source.id, status: "ok", messages: messages.length, offers: parsed.length });
  } catch (error) {
    sourceStatus.push({ id: source.id, status: "error", error: error instanceof Error ? error.message : String(error) });
  }
  await sleep(500);
}

const deduped = new Map();
for (const flight of collected) {
  const key = [normalizeCity(flight.from), normalizeCity(flight.to), flight.departureDate, flight.returnDate || "", flight.trip].join("|");
  const current = deduped.get(key);
  if (!current || flight.price < current.price) deduped.set(key, flight);
}

const flights = [...deduped.values()]
  .sort((a, b) => a.offset - b.offset || a.price - b.price)
  .slice(0, 120);

if (!flights.length) {
  throw new Error("No live flight offers parsed; refusing to overwrite the previous feed");
}

const payload = {
  generatedAt: new Date().toISOString(),
  mode: "public-sale-price",
  note: "Public channel prices are treated as sale prices, not supplier cost.",
  sources: sourceStatus,
  flights
};

await mkdir(resolve("public"), { recursive: true });
await writeFile(resolve("public/flights.json"), JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log("Synced", flights.length, "offers", sourceStatus);
