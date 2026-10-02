import { createHash } from "node:crypto";

const AIRLINES = [
  "Air Astana", "Эйр Астана", "SCAT", "Scat", "VietJet Air", "Вьетжет Эйр",
  "Fly Arystan", "FlyArystan", "Pegasus", "Sunday Airlines", "Air Cairo",
  "Red Sea", "Neos", "Neos Air", "Sun Phu Quoc Airways", "Sun Phu Quoc", "Air Arabia", "Centrum Air",
  "CENTRUM AIR", "Qazaq Air", "Turkish Airlines", "Wizz Air", "Southwind",
  "AJet", "Azur Air", "Red Wings", "Corendon", "Freebird", "flydubai",
  "Vietravel", "Bamboo", "Air Serbia", "Uzbekistan Airways", "China Southern",
  "Nesma", "Charter", "Чартер"
];

const IATA = {
  ALA: "Алматы", NQZ: "Астана", CIT: "Шымкент", GUW: "Атырау", AKX: "Актобе",
  KSN: "Костанай", KZO: "Кызылорда", DMB: "Тараз", URA: "Уральск", PPK: "Петропавловск",
  SSH: "Шарм-эш-Шейх", HRG: "Хургада", CAI: "Каир", AYT: "Анталия", IST: "Стамбул",
  SAW: "Стамбул", DXB: "Дубай", DWC: "Дубай", SHJ: "Шарджа", AUH: "Абу-Даби",
  CXR: "Нячанг", DAD: "Дананг", PQC: "Фукуок", HKT: "Пхукет", BKK: "Бангкок",
  SYX: "Санья", MLE: "Мале", CMB: "Коломбо", GOI: "Гоа", TBS: "Тбилиси",
  BUS: "Батуми", GYD: "Баку", EVN: "Ереван", DOH: "Доха", BEG: "Белград",
  MXP: "Милан", FCO: "Рим", BCN: "Барселона", CDG: "Париж", PRG: "Прага", MUC: "Мюнхен", GZP: "Газипаша",
  VIE: "Вена", LCA: "Ларнака", FRU: "Бишкек", TAS: "Ташкент",
  SVO: "Москва", DME: "Москва", VKO: "Москва", LED: "Санкт-Петербург", AER: "Сочи"
};

const CITY_FORMS = {
  "астаны": "Астана", "астане": "Астана", "хургаду": "Хургада",
  "анталию": "Анталия", "анталью": "Анталия", "анталья": "Анталия",
  "дубаи": "Дубай", "камрань": "Нячанг", "камрань/нячанг": "Нячанг", "москву": "Москва",
  "almaty": "Алматы", "astana": "Астана", "shymkent": "Шымкент",
  "nha trang": "Нячанг", "cam ranh": "Нячанг", "camranh": "Нячанг",
  "phu quoc": "Фукуок", "danang": "Дананг", "da nang": "Дананг",
  "phuket": "Пхукет", "bangkok": "Бангкок", "sanya": "Санья",
  "antalya": "Анталия", "alanya": "Аланья", "gazipasa": "Газипаша", "gazipaşa": "Газипаша", "sharjah": "Шарджа", "abu dhabi": "Абу-Даби",
  "sharm el sheikh": "Шарм-эль-Шейх", "hurghada": "Хургада",
  "mattala": "Маттала", "jeddah": "Джидда", "munich": "Мюнхен", "münchen": "Мюнхен", "актау": "Актау", "актобе": "Актобе", "алания": "Аланья", "аланья": "Аланья", "газипаша": "Газипаша", "газипаша (аланья": "Газипаша", "газипаша (аланья)": "Газипаша", "aktau": "Актау",
  "aktobe": "Актобе", "atyrau": "Атырау", "kostanay": "Костанай",
  "karaganda": "Караганда", "milan": "Милан", "batumi": "Батуми"
};

const MONTHS = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6,
  июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12
};

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
  const clean = String(value || "")
    .replace(/^\s*(?:OW|RT)\s+/i, "")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0E\uFE0F\u200D]/g, "")
    .replace(/[*_~`]+/g, " ")
    .replace(/\s*\((?:вьетнам|турция|египет|китай|таиланд|казахстан|оаэ|шри[- ]?ланка)\)\s*/giu, " ")
    .replace(/\s*\((?:econom|economy|business)\)\s*$/iu, "")
    .replace(/^\(+|\)+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:|/\\-]+|[\s,.;:|/\\-]+$/g, "")
    .trim();
  const code = clean.toUpperCase();
  if (/^[A-Z]{3}$/.test(code) && IATA[code]) return IATA[code];
  return CITY_FORMS[clean.toLocaleLowerCase("ru-RU")] || clean;
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
    .replace(/,+$/g, "")
    .trim();
  if (!raw || /^\d{1,2}[./]\d{1,2}/.test(raw) || isRouteNoise(raw)) return null;
  if (/(?:багаж|ручн(?:ая|ой)\s+клад|airline)/iu.test(raw)) return null;

  const iataRoute = raw.match(/^([A-Z]{3})\s*[-–—→]\s*([A-Z]{3})(?:\s*[-–—→]\s*([A-Z]{3}))?$/);
  let parts;
  if (iataRoute) {
    parts = [iataRoute[1], iataRoute[2], iataRoute[3]].filter(Boolean).map(normalizeCity);
  } else {
    const prose = raw.match(/^из\s+(.+?)\s+(?:в|во)\s+(.+)$/iu);
    parts = prose
      ? [normalizeCity(prose[1]), normalizeCity(prose[2])]
      : raw
          .split(/\s*(?:→|->|⟶|➡|➔|⇄|⇆|↔)\s*|\s+[—–-]\s+/u)
          .map(normalizeCity)
          .filter(Boolean);
  }

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
  if (diffDays < -7) year += 1;
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
  const text = String(value || "");
  const numeric = text.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (numeric) return toIso(numeric[1], numeric[2], numeric[3], now);
  const word = text.match(/(\d{1,2})\s*(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\.?/iu);
  if (!word) return null;
  return toIso(word[1], MONTHS[word[2].toLocaleLowerCase("ru-RU").slice(0, 3)], null, now);
}

function compactRangeFromText(value, now) {
  const match = String(value || "").match(/(?<![\d./])(\d{1,2})\s*[-–—]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/u);
  if (!match) return null;
  return [toIso(match[1], match[3], match[4], now), toIso(match[2], match[3], match[4], now)];
}

function addDays(iso, days) {
  const date = new Date(iso + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + Number(days));
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}

function numericPrice(value, multiplier = 1) {
  const n = Number(String(value || "").replace(/[^0-9]/g, "")) * multiplier;
  return Number.isFinite(n) && n >= 5000 && n <= 5000000 ? n : null;
}

function priceFromText(value) {
  const text = String(value || "");
  if (/\$|\busd\b|\beur\b|€|₽|\bруб/iu.test(text)) return null;
  const thousands = text.match(/(?<![\d.,])(\d{1,4})\s*(?:тыс\.?|к)(?![а-яё\w])/iu);
  if (thousands) return numericPrice(thousands[1], 1000);
  const currency = text.match(/(?<!\d)(\d{1,3}(?:[ \u00a0.,]\d{3})+|\d{4,7})\s*(?:₸|тг\.?|тенге|kzt\b)/iu);
  if (currency) return numericPrice(currency[1]);
  const label = text.match(/(?:цена|стоимость|price)\s*[:\-–—]?\s*(?:от\s*)?(\d{1,3}(?:[ \u00a0.,]\d{3})+|\d{4,7})/iu);
  if (label) return numericPrice(label[1]);
  const separated = text.match(/(?:=|—|–|-)\s*(\d{1,3}(?:[ \u00a0.,]\d{3})+|\d{4,7})(?:\s|$)/u);
  return separated ? numericPrice(separated[1]) : null;
}

function detectBaggage(value) {
  const text = String(value || "");

  const checked = text.match(/багаж\D{0,16}?(\d{1,2})\s*(?:кг|kg)/iu);
  const hand = text.match(/ручн(?:ая|ой|ую)?\s+клад\D{0,16}?(\d{1,2})\s*(?:кг|kg)/iu);
  if (checked && hand) {
    return "багаж " + Number(checked[1]) + " кг + ручная кладь " + Number(hand[1]) + " кг";
  }
  if (checked) return "багаж " + Number(checked[1]) + " кг";
  if (hand) return "ручная кладь " + Number(hand[1]) + " кг";

  const pair = text.match(/(?<!\d)(\d{1,2})\s*\+\s*(\d{1,2})\s*(?:кг|kg)?/iu);
  if (pair) return Number(pair[1]) + " + " + Number(pair[2]) + " кг";
  if (/без\s+багаж/iu.test(text)) return "только ручная кладь";
  return null;
}

function detectOfferAirlineCode(value) {
  const match = String(value || "").trim().match(/^([A-Z*])\s+(?=\d{1,2}[./]\d{1,2})/u);
  return match ? match[1] : null;
}


export function parseOfferLine(line, now) {
  const text = String(line || "").replace(/\u00a0/g, " ").trim();
  if (!text || /\$|\busd\b|\beur\b|€|₽|\bруб/iu.test(text)) return null;

  let departureDate = null;
  let returnDate = null;
  let price = null;

  const range = text.match(/(?:^|\s)(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*(?:→|->|—|–|-)\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/u);
  if (range) {
    departureDate = dateFromText(range[1], now);
    returnDate = dateFromText(range[2], now);
    price = priceFromText(text);
  }

  if (!departureDate) {
    const compact = compactRangeFromText(text, now);
    if (compact?.[0] && compact?.[1]) {
      departureDate = compact[0];
      returnDate = compact[1];
      price = priceFromText(text);
    }
  }

  if (!departureDate) {
    const nights = text.match(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s+на\s+(\d{1,2})(?:\s*[-–—]\s*\d{1,2})?\s+ноч(?:ь|и|ей)/iu);
    if (nights) {
      departureDate = dateFromText(nights[1], now);
      if (departureDate) returnDate = addDays(departureDate, Number(nights[2]));
      price = priceFromText(text);
    }
  }

  if (!departureDate) {
    departureDate = dateFromText(text, now);
    price = priceFromText(text);
  }

  if (!departureDate || !price) return null;

  const seatMatch = text.match(/\((\d{1,3})\)|\b(\d{1,3})\s*(?:мест|место|места|кресл)/iu);
  const count = Number(seatMatch?.[1] || seatMatch?.[2] || 0);
  const lastSeat = /последн(?:ее|ий|яя)\s+(?:место|кресло)/iu.test(text);

  const baggage = detectBaggage(text);
  const airlineCode = detectOfferAirlineCode(text);
  return {
    departureDate,
    returnDate,
    price,
    hot: /🔥/u.test(text),
    seats: lastSeat ? "Последнее место" : count > 0 ? count + " мест" : "Наличие уточняется",
    ...(baggage ? { baggage } : {}),
    ...(airlineCode ? { airlineCode } : {})
  };
}

function detectAirline(line) {
  const text = String(line || "").trim();
  const direct = AIRLINES.find(name => text.toLocaleLowerCase("ru-RU").includes(name.toLocaleLowerCase("ru-RU")));
  if (direct) return direct === "Charter" ? "Чартер" : direct;
  const tagged = text.match(/(?:а\/к|airline)\s*[:\-]?\s*([A-Za-zА-ЯЁ][A-Za-zА-ЯЁ0-9 .-]{1,40})/iu);
  return tagged ? tagged[1].trim() : null;
}

function airlineCodeFromName(value) {
  const airline = String(value || "").toLocaleLowerCase("ru-RU");
  if (!airline) return null;
  if (airline.includes("air astana") || airline.includes("эйр астана")) return "A";
  if (airline.includes("vietjet") || airline.includes("вьетжет") || airline.includes("vietravel")) return "V";
  if (airline.includes("scat")) return "S";
  if (airline.includes("sun phu quoc")) return "*";
  if (airline.includes("flyarystan") || airline.includes("fly arystan") || airline.includes("flydubai")) return "F";
  if (airline.includes("pegasus")) return "P";
  if (airline.includes("neos")) return "N";
  return null;
}

function extractCarrierLegend(lines) {
  const legend = new Map();

  for (const line of lines) {
    const airline = detectAirline(line);
    const baggage = detectBaggage(line);
    if (!airline || !baggage) continue;

    const code = airlineCodeFromName(airline);
    if (!code) continue;
    legend.set(code, { airline, baggage });
  }

  return legend;
}

function extractTravelNotices(lines) {
  const notices = [];
  const seen = new Set();

  for (const line of lines) {
    const value = String(line || "").trim();
    if (!value) continue;
    if (!/(?:arrival\s*card|k-?eta|виз[аы]?|обязатель|декларац)/iu.test(value)) continue;
    if (parseRouteLine(value) || parseOfferLine(value, new Date())) continue;

    const clean = value.replace(/\s+/g, " ").trim();
    if (!seen.has(clean)) {
      seen.add(clean);
      notices.push(clean);
    }
  }

  return notices;
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
  if (/\$|\busd\b|\beur\b|€|₽|\bруб/iu.test(String(text || ""))) return [];

  const offers = [];
  const carrierLegend = extractCarrierLegend(lines);
  const travelNotices = extractTravelNotices(lines);
  const notice = travelNotices.length ? travelNotices.join("\n") : undefined;
  let route = null;
  let tripHint = "OW";
  let routeAirline = null;
  let routeBaggage = null;
  let pendingAirline = null;
  let pendingBaggage = null;
  let routeOfferCount = 0;
  let pendingDeparture = null;
  let pendingReturn = null;

  const appendOffer = parsed => {
    if (!route || !parsed?.departureDate || !parsed?.price) return;
    const offset = daysUntil(parsed.departureDate, now);
    if (offset <= 0 || offset > 365) return;

    const inlineCode = parsed.airlineCode || null;
    const routeCode = airlineCodeFromName(routeAirline);
    const airlineCode = inlineCode || routeCode || null;
    const legend = airlineCode ? carrierLegend.get(airlineCode) : null;

    const offer = {
      sourceId,
      externalId: "",
      from: route.from,
      to: route.to,
      departureDate: parsed.departureDate,
      returnDate: parsed.returnDate || null,
      trip: parsed.returnDate ? "RT" : tripHint,
      airline: legend?.airline || routeAirline || undefined,
      airlineCode: airlineCode || undefined,
      baggage: parsed.baggage || legend?.baggage || routeBaggage || undefined,
      sourcePrice: parsed.price,
      currency: "KZT",
      seats: parsed.seats || "Наличие уточняется",
      hot: Boolean(parsed.hot),
      notice,
      postedAt
    };
    offer.externalId = stableExternalId(sourceId, postId, offers.length, offer);
    offers.push(offer);
    routeOfferCount += 1;
  };

  for (const line of lines) {
    const maybeRoute = parseRouteLine(line);
    if (maybeRoute) {
      route = maybeRoute;
      tripHint = maybeRoute.trip;
      routeAirline = pendingAirline;
      routeBaggage = pendingBaggage;
      pendingAirline = null;
      pendingBaggage = null;
      routeOfferCount = 0;
      pendingDeparture = null;
      pendingReturn = null;
      continue;
    }

    const foundAirline = detectAirline(line);
    const foundBaggage = detectBaggage(line);

    // Airline/baggage metadata must stay scoped to a single route.
    // Never carry a carrier legend from one route/country into the next route.
    if (route && routeOfferCount === 0) {
      if (foundAirline) routeAirline = foundAirline;
      if (foundBaggage) routeBaggage = foundBaggage;
    } else if (!route) {
      if (foundAirline) pendingAirline = foundAirline;
      if (foundBaggage) pendingBaggage = foundBaggage;
    }

    if (/\b(?:RT|туда[ -]?(?:и\s*)?обратно|т\/о)\b/iu.test(line)) tripHint = "RT";
    if (/\b(?:OW|в одну сторону)\b/iu.test(line)) tripHint = "OW";

    const parsed = parseOfferLine(line, now);
    if (parsed && route) {
      appendOffer(parsed);
      pendingDeparture = null;
      pendingReturn = null;
      continue;
    }

    const compact = compactRangeFromText(line, now);
    if (compact?.[0]) {
      pendingDeparture = compact[0];
      pendingReturn = compact[1] || null;
    } else {
      const oneDate = dateFromText(line, now);
      if (oneDate && !priceFromText(line)) pendingDeparture = oneDate;
    }

    const standalonePrice = priceFromText(line);
    if (route && pendingDeparture && standalonePrice) {
      appendOffer({
        departureDate: pendingDeparture,
        returnDate: pendingReturn,
        price: standalonePrice,
        hot: /🔥/u.test(line),
        seats: "Наличие уточняется",
        baggage: foundBaggage
      });
      pendingDeparture = null;
      pendingReturn = null;
    }
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
