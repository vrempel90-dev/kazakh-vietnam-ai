import { createHash } from "node:crypto";

const AIRLINES = [
  "Air Astana", "Эйр Астана", "SCAT", "Scat", "VietJet Air", "Вьетжет Эйр",
  "Fly Arystan", "FlyArystan", "Pegasus", "Sunday Airlines", "Air Cairo",
  "Red Sea", "Neos", "Neos Air", "Sun Phu Quoc", "Air Arabia", "Centrum Air",
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
  MXP: "Милан", FCO: "Рим", BCN: "Барселона", CDG: "Париж", PRG: "Прага",
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
  "antalya": "Анталия", "sharjah": "Шарджа", "abu dhabi": "Абу-Даби",
  "sharm el sheikh": "Шарм-эль-Шейх", "hurghada": "Хургада",
  "mattala": "Маттала", "jeddah": "Джидда", "aktau": "Актау",
  "aktobe": "Актобе", "atyrau": "Атырау", "kostanay": "Костанай",
  "karaganda": "Караганда", "milan": "Милан", "batumi": "Батуми",
  "dubai": "Дубай", "дубая": "Дубай", "пхукета": "Пхукет",
  "нячанга": "Нячанг", "анталии": "Анталия", "хургады": "Хургада"
};

const MONTHS = {
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6,
  июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12
};

function decodeHtml(value) {
  const codePoint = (value, radix) => {
    const number = parseInt(value, radix);
    return number >= 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)
      ? String.fromCodePoint(number) : "�";
  };
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|blockquote)>|<(?:div|p|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => codePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => codePoint(code, 16))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function cleanHandle(value) {
  const handle = String(value || "")
    .trim()
    .replace(/^https?:\/\/t\.me\/(?:s\/)?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();
  return /^[a-z0-9_]{1,32}$/.test(handle) ? handle : "";
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

function messageTextBlocks(html) {
  const result = [];
  const opening = /<div\b[^>]*\bclass=["'][^"']*\btgme_widget_message_text\b[^"']*["'][^>]*>/gi;
  let match;
  while ((match = opening.exec(html))) {
    const contentStart = opening.lastIndex;
    const tags = /<\/?div\b[^>]*>/gi;
    tags.lastIndex = contentStart;
    let depth = 1;
    let tag;
    while ((tag = tags.exec(html))) {
      depth += /^<\//.test(tag[0]) ? -1 : 1;
      if (depth === 0) {
        result.push(decodeHtml(html.slice(contentStart, tag.index)));
        opening.lastIndex = tags.lastIndex;
        break;
      }
    }
    if (depth !== 0) break;
  }
  return result;
}

export function extractPublicTelegramPosts(html) {
  const posts = [];
  const page = String(html || "");
  const starts = [...page.matchAll(/<div\b[^>]*\bclass=["'][^"']*\btgme_widget_message_wrap\b[^"']*["'][^>]*>/gi)];
  for (let index = 0; index < starts.length; index += 1) {
    const block = page.slice(starts[index].index + starts[index][0].length, starts[index + 1]?.index ?? page.length);
    const dataPost = block.match(/data-post=["']([^"']+)["']/i)?.[1] || "";
    const datetime = block.match(/<time[^>]*datetime=["']([^"']+)["']/i)?.[1] || null;
    const text = messageTextBlocks(block)[0] || "";
    if (!text && !dataPost && !datetime) continue;
    posts.push({
      dataPost,
      id: postIdFromDataPost(dataPost),
      postedAt: datetime,
      text
    });
  }

  if (!posts.length) {
    let index = 0;
    for (const text of messageTextBlocks(page)) {
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
    .replace(/[*_~`]+/g, "")
    .replace(/^[-•]+\s*/, "")
    .replace(/^✈️?\s*/u, "")
    .replace(/,+$/g, "")
    .trim();
  const hint = raw.match(/^(OW|RT)(?=\s|:)/i)?.[1]?.toUpperCase()
    || raw.match(/\s(OW|RT)$/i)?.[1]?.toUpperCase();
  const routeText = raw.replace(/^(?:OW|RT)\s*:?\s*/i, "").replace(/\s+(?:OW|RT)$/i, "");
  if (!routeText || /^\d{1,2}[./]\d{1,2}/.test(routeText) || isRouteNoise(routeText)) return null;

  const iataRoute = routeText.match(/^([A-Z]{3})\s*[-–—→]\s*([A-Z]{3})(?:\s*[-–—→]\s*([A-Z]{3}))?$/i);
  let parts;
  if (iataRoute) {
    parts = [iataRoute[1], iataRoute[2], iataRoute[3]].filter(Boolean).map(normalizeCity);
  } else {
    const prose = routeText.match(/^из\s+(.+?)\s+(?:в|во)\s+(.+)$/iu);
    parts = prose
      ? [normalizeCity(prose[1]), normalizeCity(prose[2])]
      : routeText
          .split(/\s*(?:→|->|⟶|➡|➔|⇄|⇆|↔)\s*|\s+[—–-]\s+/u)
          .map(normalizeCity)
          .filter(Boolean);
  }

  if (parts.length < 2 || parts.length > 3) return null;
  if (parts.some(part => /\d|[<>:=]|₸|\bhttps?\b/iu.test(part) || part.length < 2 || part.length > 80)) return null;

  const from = parts[0];
  const to = parts[1];
  const roundTrip = parts.length === 3 && sameCity(parts[0], parts[2]);
  if (sameCity(from, to) || (parts.length === 3 && !roundTrip)) return null;
  return { from, to, trip: roundTrip || /⇄|⇆|↔/u.test(routeText) ? "RT" : (hint || "OW") };
}

function flightCalendarDay(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const value = type => Number(parts.find(part => part.type === type)?.value);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day"), 12));
}

function inferYear(day, month, now) {
  // A yearless stale date must not turn into a new offer eleven months later.
  // Only infer the common winter rollover; other next-year dates need a year.
  const calendar = flightCalendarDay(now);
  return calendar.getUTCFullYear() + (calendar.getUTCMonth() >= 9 && month <= 3 ? 1 : 0);
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
  const iso = text.match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (iso) return toIso(iso[3], iso[2], iso[1], now);
  const numeric = text.match(/(?<![\d.,])(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?![\d.,])/);
  if (numeric) return toIso(numeric[1], numeric[2], numeric[3], now);
  const word = text.match(/(?<!\d)(\d{1,2})\s*(янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\.?(?:\s+(\d{4}))?/iu);
  if (!word) return null;
  return toIso(word[1], MONTHS[word[2].toLocaleLowerCase("ru-RU").slice(0, 3)], word[3], now);
}

function compactRangeFromText(value, now) {
  const match = String(value || "").match(/(?<![\d./])(\d{1,2})\s*[-–—]\s*(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/u);
  if (!match) return null;
  return [toIso(match[1], match[3], match[4], now), toIso(match[2], match[3], match[4], now)];
}

function datesFromText(text, now) {
  const range = text.match(/(?<![\d./])(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s*(?:→|->|—|–|-)\s*(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)(?![\d./])/u);
  if (range) {
    const departureDate = dateFromText(range[1], now);
    const returnDate = departureDate ? dateFromText(range[2], new Date(departureDate + "T12:00:00Z")) : null;
    return departureDate && returnDate && returnDate > departureDate
      ? { departureDate, returnDate } : null;
  }
  const compact = compactRangeFromText(text, now);
  if (compact) {
    return compact[0] && compact[1] && compact[1] > compact[0]
      ? { departureDate: compact[0], returnDate: compact[1] } : null;
  }
  const nights = text.match(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)\s+на\s+(\d{1,2})(\s*[-–—]\s*\d{1,2})?\s+ноч(?:ь|и|ей)/iu);
  if (nights) {
    const departureDate = dateFromText(nights[1], now);
    // A range of nights is not one exact return date.
    return departureDate && !nights[3] && Number(nights[2]) > 0
      ? { departureDate, returnDate: addDays(departureDate, Number(nights[2])) } : null;
  }
  const departureDate = dateFromText(text, now);
  return departureDate ? { departureDate, returnDate: null } : null;
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

function hasForeignCurrency(value) {
  return /[$€₽]|(?:^|[\s\d])(?:USD|EUR|RUB|CNY|RMB|AED|руб(?:лей|ля|ль|\.)?|доллар[а-яё]*|евро|дирхам[а-яё]*)(?=\s|$|[.,])/iu.test(String(value || ""));
}

function soldOut(value) {
  return /(?:^|\s)(?:мест\s+(?:нет|не\s+осталось)|нет\s+мест|(?:0|ноль)\s+мест|sold\s*out|распродан[а-яё]*)(?=\s|$|[.!])|\(0\)/iu.test(String(value || ""));
}

function priceFromText(value) {
  const text = String(value || "");
  if (hasForeignCurrency(text)) return null;
  const thousands = text.match(/(?<![\d.,])(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:тыс\.?|к)(?![а-яё\w])/iu);
  if (thousands) {
    const number = Number(thousands[1].replace(",", ".")) * 1000;
    return Number.isFinite(number) && number >= 5000 && number <= 5000000 ? number : null;
  }
  const currency = text.match(/(?<!\d)(\d{1,3}(?:[ \u00a0.,]\d{3})+|\d{4,7})\s*(?:₸|тг\.?|тенге|kzt\b)/iu);
  if (currency) return numericPrice(currency[1]);
  const label = text.match(/(?:цена|стоимость|price)\s*[:\-–—]?\s*(?:от\s*)?(\d{1,3}(?:[ \u00a0.,]\d{3})+|\d{4,7})/iu);
  if (label) return numericPrice(label[1]);
  const separated = text.match(/(?:=|—|–|-)\s*(\d{1,3}(?:[ \u00a0.,]\d{3})+|\d{4,7})(?:\s|$)/u);
  return separated ? numericPrice(separated[1]) : null;
}

function detectBaggage(value) {
  const text = String(value || "");
  const pair = text.match(/(?<!\d)(\d{1,2})\s*\+\s*(\d{1,2})\s*(?:кг|kg)?/iu);
  if (pair) return Number(pair[1]) + " + " + Number(pair[2]) + " кг";
  const single = text.match(/багаж\D{0,12}?(\d{1,2})\s*(?:кг|kg)/iu);
  if (single) return Number(single[1]) + " кг";
  if (/без\s+багаж/iu.test(text)) return "только ручная кладь";
  return null;
}

export function parseOfferLine(line, now) {
  const text = String(line || "").replace(/\u00a0/g, " ").replace(/[*_~`]+/g, "").trim();
  if (!text || hasForeignCurrency(text) || soldOut(text)) return null;

  const dates = datesFromText(text, now);
  const price = priceFromText(text);
  if (!dates || !price) return null;
  const { departureDate, returnDate } = dates;
  const dateList = !returnDate && text.match(/(?<![\d.])(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?(?:\s*[,;]\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)+)/u);
  const departureDates = dateList ? dateList[1].split(/\s*[,;]\s*/).map(value => dateFromText(value, now)) : null;
  if (departureDates?.some(value => !value)) return null;

  const seatMatch = text.match(/\((\d{1,3})\)|\b(\d{1,3})\s*(?:мест|место|места|кресл)/iu);
  const count = Number(seatMatch?.[1] || seatMatch?.[2] || 0);
  const lastSeat = /последн(?:ее|ий|яя)\s+(?:место|кресло)/iu.test(text);

  const baggage = detectBaggage(text);
  return {
    departureDate,
    returnDate,
    price,
    hot: /🔥/u.test(text),
    seats: lastSeat ? "Последнее место" : count > 0 ? count + " мест" : "Наличие уточняется",
    ...(departureDates ? { departureDates } : {}),
    ...(baggage ? { baggage } : {})
  };
}

function detectAirline(line) {
  const text = String(line || "").trim();
  const direct = AIRLINES.find(name => text.toLocaleLowerCase("ru-RU").includes(name.toLocaleLowerCase("ru-RU")));
  const canonical = name => ({
    "эйр астана": "Air Astana", "вьетжет эйр": "VietJet Air", "скат": "SCAT", charter: "Чартер"
  })[String(name).toLocaleLowerCase("ru-RU")] || name;
  if (direct) return canonical(direct);
  const tagged = text.match(/(?:а\/к|airline)\s*[:\-]?\s*([A-Za-zА-ЯЁ][A-Za-zА-ЯЁ0-9 .-]{1,40})/iu);
  return tagged ? canonical(tagged[1].trim()) : null;
}

function daysUntil(iso, now) {
  const target = new Date(iso + "T12:00:00Z");
  const base = flightCalendarDay(now);
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

function flightMetadata(line) {
  const flightNumber = String(line).match(/(?:рейс|flight)\s*:?\s*([A-Z0-9]{2,3}\s?\d{1,4}[A-Z]?)(?![A-Z0-9])/iu)?.[1]?.replace(/\s/g, "").toUpperCase();
  const departureTime = String(line).match(/(?:время\s+вылета|departure\s+time)\s*:?\s*([0-2]?\d:[0-5]\d)/iu)?.[1]
    || String(line).match(/(?:вылет|departure)\s*:?\s*\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\s+([0-2]?\d:[0-5]\d)/iu)?.[1];
  const [hour] = String(departureTime || "").split(":");
  return {
    ...(flightNumber ? { flightNumber } : {}),
    ...(departureTime && Number(hour) < 24 ? { departureTime: departureTime.padStart(5, "0") } : {})
  };
}

function stableExternalId(sourceId, postId, index, offer) {
  if (postId != null) return sourceId + ":" + postId + ":" + index;
  const raw = [sourceId, offer.from, offer.to, offer.departureDate, offer.returnDate || "", offer.trip, offer.airline || "", offer.sourcePrice].join("|");
  return sourceId + ":" + createHash("sha1").update(raw).digest("hex").slice(0, 16);
}

export function parseTelegramPost(text, {
  sourceId,
  postId = null,
  postedAt = null,
  now = new Date()
} = {}) {
  const lines = String(text || "").split("\n").map(line => line.replace(/[*_~`]+/g, "").trim()).filter(Boolean);

  const offers = [];
  let route = null;
  let tripHint = "OW";
  let airline = null;
  let baggage = null;
  let defaultAirline = null;
  let defaultBaggage = null;
  let blockStart = 0;
  let metadata = {};
  let metadataDefaults = {};
  let pendingDeparture = null;
  let pendingReturn = null;

  const appendOffer = parsed => {
    if (!route || !parsed?.departureDate || !parsed?.price) return;
    if (parsed.departureDates) {
      for (const departureDate of parsed.departureDates) appendOffer({ ...parsed, departureDate, departureDates: null });
      return;
    }
    const offset = daysUntil(parsed.departureDate, now);
    if (offset <= 0 || offset > 365) return;
    if (parsed.returnDate && parsed.returnDate <= parsed.departureDate) return;
    const offer = {
      sourceId,
      externalId: "",
      from: route.from,
      to: route.to,
      departureDate: parsed.departureDate,
      returnDate: parsed.returnDate || null,
      trip: parsed.returnDate ? "RT" : tripHint,
      airline: airline || undefined,
      baggage: parsed.baggage || baggage || undefined,
      sourcePrice: parsed.price,
      currency: "KZT",
      seats: parsed.seats || "Наличие уточняется",
      hot: Boolean(parsed.hot),
      postedAt,
      ...metadata
    };
    offer.externalId = stableExternalId(sourceId, postId, offers.length, offer);
    offers.push(offer);
  };

  for (const rawLine of lines) {
    let line = rawLine;
    // Price currency is scoped to one offer; an unrelated USD advert must not
    // discard all the KZT offers in a supplier's message.
    if (hasForeignCurrency(line) || soldOut(line)) {
      pendingDeparture = null;
      pendingReturn = null;
      continue;
    }
    const inlineDate = line.match(/(?<!\d)(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/u);
    const inlineRoute = inlineDate && parseRouteLine(line.slice(0, inlineDate.index).trim());
    const maybeRoute = parseRouteLine(line) || inlineRoute;
    if (maybeRoute) {
      route = maybeRoute;
      tripHint = maybeRoute.trip;
      airline = defaultAirline;
      baggage = defaultBaggage;
      metadata = {};
      metadataDefaults = {};
      blockStart = offers.length;
      pendingDeparture = null;
      pendingReturn = null;
      if (!inlineRoute) continue;
      line = line.slice(inlineDate.index);
    } else if (/(?:→|->|⟶|➡|➔|⇄|⇆|↔)/u.test(line) && !inlineDate) {
      // An unsupported multi-leg or broken header must not inherit the last route.
      route = null;
      pendingDeparture = null;
      pendingReturn = null;
      continue;
    }

    const foundAirline = detectAirline(line);
    if (foundAirline) {
      airline = foundAirline;
      if (!route) defaultAirline = foundAirline;
    }
    const foundBaggage = detectBaggage(line);
    if (foundBaggage) {
      baggage = foundBaggage;
      if (!route) defaultBaggage = foundBaggage;
    }
    const foundMetadata = flightMetadata(line);
    if (inlineDate) {
      metadata = { ...metadataDefaults, ...foundMetadata };
    } else {
      metadataDefaults = { ...metadataDefaults, ...foundMetadata };
      metadata = { ...metadata, ...foundMetadata };
    }
    // Metadata on a dated row describes that row or its split price, rather
    // than changing the physical identity of previously parsed flights.
    for (const offer of inlineDate ? [] : offers.slice(blockStart)) {
      if (foundAirline) offer.airline = foundAirline;
      if (foundBaggage) offer.baggage = foundBaggage;
      Object.assign(offer, foundMetadata);
    }

    if (/(?:^|\s)(?:RT|туда[ -]?(?:и\s*)?обратно|т\/о)(?=\s|$|[:,])/iu.test(line)) tripHint = "RT";
    if (/(?:^|\s)(?:OW|в одну сторону)(?=\s|$|[:,])/iu.test(line)) tripHint = "OW";

    const parsed = parseOfferLine(line, now);
    if (parsed && route) {
      appendOffer(parsed);
      pendingDeparture = null;
      pendingReturn = null;
      continue;
    }

    const dates = datesFromText(line, now);
    if (dates && !priceFromText(line)) {
      if (/^(?:обратно|возврат|return)\s*:/iu.test(line)) {
        pendingReturn = dates.departureDate;
      } else {
        pendingDeparture = dates.departureDate;
        pendingReturn = dates.returnDate;
      }
    } else if (inlineDate && !dates) {
      pendingDeparture = null;
      pendingReturn = null;
      continue;
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
  if (!postedAt) return false;
  const stamp = new Date(postedAt);
  if (Number.isNaN(stamp.getTime())) return false;
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
  const visitedPages = new Set();
  let pageUrl = source.url;
  let pages = 0;

  while (pageUrl && pages < maxPages) {
    if (visitedPages.has(pageUrl)) break;
    visitedPages.add(pageUrl);
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
  let skippedUndated = 0;
  const offers = [];

  for (const post of allPosts.values()) {
    if (!isWithinTtl(post.postedAt, now, ttlHours)) {
      if (!post.postedAt || Number.isNaN(Date.parse(post.postedAt))) skippedUndated += 1;
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
      skippedUndated,
      skippedAuto
    }
  };
}
