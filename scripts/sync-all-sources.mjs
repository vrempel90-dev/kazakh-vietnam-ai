import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { enabledSources } from "./source-registry.mjs";

const AIRLINES = [
  "Air Astana", "Эйр Астана", "SCAT", "Scat", "VietJet Air", "Вьетжет Эйр",
  "Fly Arystan", "FlyArystan", "Pegasus", "Sunday Airlines", "Air Cairo", "Red Sea", "Neos", "Neos Air", "Sun Phu Quoc"
];

const IATA = {
  ALA: "Алматы",
  NQZ: "Астана",
  MXP: "Милан",
  CXR: "Нячанг",
  PQC: "Фукуок",
  BKK: "Бангкок",
  DAD: "Дананг",
  PRG: "Прага",
  SYX: "Санья"
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  const parts = String(dateText).trim().split(".");
  if (parts.length < 2) return null;
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  const explicitYear = Number(parts[2]);
  if (!day || !month) return null;
  const year = explicitYear >= 2000 ? explicitYear : inferYear(day, month, now);
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
    departureDate: input.departureDate,
    returnDate: input.returnDate || undefined,
    updatedAt: new Date().toISOString()
  };
  flight.id = stableId(flight);
  return flight;
}

function parseTelegramMessage(text, now) {
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
    flights.push(publicFlight({
      from: route.from,
      to: route.to,
      offset,
      price: offer.price,
      trip: effectiveTrip,
      hot: offer.hot,
      seats: offer.seats,
      airline,
      departureDate: offer.departureDate,
      returnDate: offer.returnDate
    }));
  }
  return flights;
}

async function fetchText(url, timeoutMs = 20000) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; CharterFlightSync/2.0; +https://github.com/vrempel90-dev/kazakh-vietnam-ai)",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.7"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return { text: await response.text(), finalUrl: response.url, contentType: response.headers.get("content-type") || "" };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function routeFromIata(raw) {
  const normalized = String(raw || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.length !== 6) return null;
  const fromCode = normalized.slice(0, 3);
  const toCode = normalized.slice(3, 6);
  return {
    from: IATA[fromCode] || fromCode,
    to: IATA[toCode] || toCode
  };
}

function envNumber(name) {
  const value = process.env[name];
  if (value == null || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function roundSale(value) {
  const step = Math.max(1, envNumber("SALE_PRICE_ROUNDING") || 1000);
  return Math.ceil(value / step) * step;
}

function costToSale(sourceId, sourcePrice, currency) {
  const markup = envNumber("MARKUP_" + sourceId.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_PERCENT") ?? envNumber("MARKUP_PERCENT_DEFAULT");
  if (markup == null || markup < 0) return null;
  let rate = 1;
  if (currency !== "KZT") {
    rate = envNumber("FX_" + currency + "_KZT");
    if (rate == null || rate <= 0) return null;
  }
  return roundSale(sourcePrice * rate * (1 + markup / 100));
}

function parseNeosCsv(csv, source, now) {
  const rows = parseCsv(csv);
  const currency = (process.env[source.currencyEnv] || "").trim().toUpperCase();
  const parsed = [];
  let usableRows = 0;
  for (const row of rows.slice(1)) {
    const [dateText, routeText, timeText, priceText, noteText] = row;
    const departureDate = toIso(dateText, now);
    const route = routeFromIata(routeText);
    if (!departureDate || !route) continue;
    const offset = dayOffset(departureDate, now);
    if (offset < 0 || offset > 550) continue;
    const price = Number(String(priceText || "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(price) || price <= 0 || /мест\s*нет/iu.test(String(priceText) + " " + String(noteText))) continue;
    usableRows += 1;
    if (!currency) continue;
    const salePrice = costToSale(source.id, price, currency);
    if (salePrice == null) continue;
    parsed.push(publicFlight({
      from: route.from,
      to: route.to,
      offset,
      price: salePrice,
      trip: "OW",
      hot: false,
      seats: "Наличие уточняется",
      airline: "Neos Air",
      departureDate
    }));
  }
  return {
    flights: parsed,
    rows: Math.max(0, rows.length - 1),
    usableRows,
    pricingReady: Boolean(currency) && (envNumber("MARKUP_NEOS_PERCENT") ?? envNumber("MARKUP_PERCENT_DEFAULT")) != null && (currency === "KZT" || envNumber("FX_" + currency + "_KZT") != null),
    currencyConfigured: Boolean(currency)
  };
}

function classifyB2BPage(html, finalUrl) {
  const text = decodeHtml(html).slice(0, 12000);
  const publicSearch = /name=["']TOWNFROMINC["']/i.test(html)
    && /name=["']TOWNTOINC["']/i.test(html)
    && /name=["']CHECKIN["']/i.test(html);
  const login = /(?:\bвход\b|авторизац|log\s*on|sign\s*in|пароль|password)/iu.test(text) || /\/Account\/Login/i.test(finalUrl);
  const needsJs = /(?:включить javascript|turn on ["']?javascript|doesn.?t work properly without JavaScript)/iu.test(text);
  return { publicSearch, login, needsJs };
}

async function syncTelegram(source, now) {
  const { text } = await fetchText(source.url);
  const messages = extractMessages(text);
  const flights = messages.flatMap(message => parseTelegramMessage(message, now));
  return { flights, status: { id: source.id, kind: source.kind, status: "ok", messages: messages.length, offers: flights.length } };
}

async function syncNeos(source, now) {
  const { text } = await fetchText(source.url);
  const result = parseNeosCsv(text, source, now);
  let status = "ok";
  let reason;
  if (!result.currencyConfigured) {
    status = "configuration_required";
    reason = source.currencyEnv + " is not configured";
  } else if (!result.pricingReady) {
    status = "configuration_required";
    reason = "markup and/or FX rate is not configured";
  }
  return {
    flights: result.flights,
    status: {
      id: source.id,
      kind: source.kind,
      status,
      rows: result.rows,
      usableRows: result.usableRows,
      offers: result.flights.length,
      reason
    }
  };
}

async function probeB2B(source) {
  try {
    const { text, finalUrl } = await fetchText(source.url);
    const page = classifyB2BPage(text, finalUrl);
    const credentialsConfigured = Boolean(source.usernameEnv && source.passwordEnv && process.env[source.usernameEnv] && process.env[source.passwordEnv]);
    let status = "reachable";
    let reason = "Public landing page is reachable; fare extraction adapter still requires validated browser/network flow.";
    if (page.publicSearch) {
      status = "public_search_accessible";
      reason = "Public ticket-search controls are available; fare-result extraction is being handled without agency credentials.";
    } else if (page.login && !credentialsConfigured) {
      status = "credentials_required";
      reason = "Partner login is required before fare extraction.";
    } else if (page.login && credentialsConfigured) {
      status = "credentials_configured";
      reason = "Credentials are configured; authenticated fare parser must be validated for this source.";
    } else if (page.needsJs) {
      status = "browser_required";
      reason = "The ticket page requires JavaScript; browser/network adapter is required.";
    }
    return { id: source.id, kind: source.kind, status, reason, finalUrl };
  } catch (error) {
    return { id: source.id, kind: source.kind, status: "error", reason: error instanceof Error ? error.message : String(error) };
  }
}

function dedupeFlights(flights) {
  const map = new Map();
  for (const flight of flights) {
    const key = [normalizeCity(flight.from), normalizeCity(flight.to), flight.departureDate, flight.returnDate || "", flight.trip, flight.airline || ""].join("|");
    const current = map.get(key);
    if (!current || flight.price < current.price) map.set(key, flight);
  }
  return [...map.values()].sort((a, b) => a.offset - b.offset || a.price - b.price).slice(0, 300);
}

function comparablePayload(payload) {
  return JSON.stringify({ mode: payload.mode, note: payload.note, flights: payload.flights });
}

const now = new Date();
const collected = [];
const statuses = [];

for (const source of enabledSources()) {
  try {
    if (source.kind === "telegram_public") {
      const result = await syncTelegram(source, now);
      collected.push(...result.flights);
      statuses.push(result.status);
    } else if (source.kind === "google_sheet_csv") {
      const result = await syncNeos(source, now);
      collected.push(...result.flights);
      statuses.push(result.status);
    } else if (source.kind === "b2b_web") {
      statuses.push(await probeB2B(source));
    }
  } catch (error) {
    statuses.push({ id: source.id, kind: source.kind, status: "error", reason: error instanceof Error ? error.message : String(error) });
  }
  await sleep(250);
}

const flights = dedupeFlights(collected);
const outputPath = resolve("public/flights.json");
let existing = null;
try {
  existing = JSON.parse(await readFile(outputPath, "utf8"));
} catch {
  // A missing previous feed is allowed on first run.
}

if (!flights.length) {
  console.error("Source status:", JSON.stringify(statuses, null, 2));
  if (existing?.flights?.length) {
    console.warn("No fresh publishable offers; keeping the previous public feed.");
    process.exit(0);
  }
  throw new Error("No publishable flight offers and no previous feed is available");
}

const payload = {
  generatedAt: new Date().toISOString(),
  mode: "live-sale-price",
  note: "Only customer-facing sale prices are persisted. Supplier cost prices and credentials are never written to the public feed.",
  flights
};

if (existing && comparablePayload(existing) === comparablePayload(payload)) {
  console.log("No customer-visible flight changes.");
  console.log("Source status:", JSON.stringify(statuses, null, 2));
  process.exit(0);
}

await mkdir(resolve("public"), { recursive: true });
await writeFile(outputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log("Published", flights.length, "customer-visible offers");
console.log("Source status:", JSON.stringify(statuses, null, 2));
