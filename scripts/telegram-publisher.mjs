const AUTO_MARKER = "🤖 Автообновление";

const COUNTRY_BY_CITY = new Map([
  ["алматы", ["Казахстан", "🇰🇿"]], ["астана", ["Казахстан", "🇰🇿"]],
  ["шымкент", ["Казахстан", "🇰🇿"]], ["атырау", ["Казахстан", "🇰🇿"]],
  ["актобе", ["Казахстан", "🇰🇿"]], ["актау", ["Казахстан", "🇰🇿"]],
  ["костанай", ["Казахстан", "🇰🇿"]], ["кызылорда", ["Казахстан", "🇰🇿"]],
  ["тараз", ["Казахстан", "🇰🇿"]], ["уральск", ["Казахстан", "🇰🇿"]],
  ["петропавловск", ["Казахстан", "🇰🇿"]], ["караганда", ["Казахстан", "🇰🇿"]],

  ["пхукет", ["Таиланд", "🇹🇭"]], ["бангкок", ["Таиланд", "🇹🇭"]],
  ["куалалумпур", ["Малайзия", "🇲🇾"]],
  ["сеул", ["Южная Корея", "🇰🇷"]], ["инчхон", ["Южная Корея", "🇰🇷"]],
  ["нячанг", ["Вьетнам", "🇻🇳"]], ["камрань", ["Вьетнам", "🇻🇳"]],
  ["дананг", ["Вьетнам", "🇻🇳"]], ["фукуок", ["Вьетнам", "🇻🇳"]],
  ["анталия", ["Турция", "🇹🇷"]], ["анталья", ["Турция", "🇹🇷"]],
  ["аланья", ["Турция", "🇹🇷"]], ["алания", ["Турция", "🇹🇷"]],
  ["газипаша", ["Турция", "🇹🇷"]], ["газипашааланья", ["Турция", "🇹🇷"]],
  ["стамбул", ["Турция", "🇹🇷"]],
  ["шармэшшейх", ["Египет", "🇪🇬"]], ["шармэльшейх", ["Египет", "🇪🇬"]],
  ["хургада", ["Египет", "🇪🇬"]], ["каир", ["Египет", "🇪🇬"]],
  ["дубай", ["ОАЭ", "🇦🇪"]], ["шарджа", ["ОАЭ", "🇦🇪"]],
  ["абудаби", ["ОАЭ", "🇦🇪"]],
  ["санья", ["Китай", "🇨🇳"]], ["мале", ["Мальдивы", "🇲🇻"]],
  ["коломбо", ["Шри-Ланка", "🇱🇰"]], ["маттала", ["Шри-Ланка", "🇱🇰"]],
  ["гоа", ["Индия", "🇮🇳"]], ["тбилиси", ["Грузия", "🇬🇪"]],
  ["батуми", ["Грузия", "🇬🇪"]], ["баку", ["Азербайджан", "🇦🇿"]],
  ["ереван", ["Армения", "🇦🇲"]], ["доха", ["Катар", "🇶🇦"]],
  ["джидда", ["Саудовская Аравия", "🇸🇦"]], ["белград", ["Сербия", "🇷🇸"]],
  ["милан", ["Италия", "🇮🇹"]], ["рим", ["Италия", "🇮🇹"]],
  ["мюнхен", ["Германия", "🇩🇪"]], ["барселона", ["Испания", "🇪🇸"]],
  ["париж", ["Франция", "🇫🇷"]], ["прага", ["Чехия", "🇨🇿"]],
  ["вена", ["Австрия", "🇦🇹"]], ["ларнака", ["Кипр", "🇨🇾"]],
  ["бишкек", ["Кыргызстан", "🇰🇬"]], ["ташкент", ["Узбекистан", "🇺🇿"]],
  ["москва", ["Россия", "🇷🇺"]], ["санктпетербург", ["Россия", "🇷🇺"]],
  ["сочи", ["Россия", "🇷🇺"]]
]);

const COUNTRY_DISPLAY = new Map([
  ["Казахстан", "Kazakhstan"], ["Таиланд", "Thailand"], ["Малайзия", "Malaysia"], ["Вьетнам", "Vietnam"],
  ["Турция", "Turkiye"], ["Египет", "Egypt"], ["ОАЭ", "UAE"],
  ["Китай", "Hainan"], ["Мальдивы", "Maldives"], ["Шри-Ланка", "Sri Lanka"],
  ["Индия", "India"], ["Грузия", "Georgia"], ["Азербайджан", "Azerbaijan"],
  ["Армения", "Armenia"], ["Катар", "Qatar"], ["Саудовская Аравия", "Saudi Arabia"],
  ["Сербия", "Serbia"], ["Италия", "Italy"], ["Германия", "Germany"],
  ["Испания", "Spain"], ["Франция", "France"], ["Чехия", "Czech Republic"],
  ["Австрия", "Austria"], ["Кипр", "Cyprus"], ["Кыргызстан", "Kyrgyzstan"],
  ["Узбекистан", "Uzbekistan"], ["Россия", "Russia"],
  ["Южная Корея", "South Korea"],
  ["Другие направления", "Other destinations"]
]);

const ENTRY_REQUIREMENT_BY_COUNTRY = new Map([
  ["Таиланд", "TDAC обязательно"],
  ["Малайзия", "MDAC обязательно"],
  ["Вьетнам", "Arrival Card обязательно"],
  ["Мальдивы", "Health Declaration обязательно"],
  ["Китай", "Arrival Card обязательно"]
]);

const CITY_DISPLAY = new Map([
  ["сеул", "Seoul"], ["инчхон", "Incheon"],
  ["алматы", "Almaty"], ["астана", "Astana"], ["шымкент", "Shymkent"],
  ["атырау", "Atyrau"], ["актобе", "Aktobe"], ["актау", "Aktau"],
  ["костанай", "Kostanay"], ["кызылорда", "Kyzylorda"], ["тараз", "Taraz"],
  ["уральск", "Uralsk"], ["петропавловск", "Petropavlovsk"], ["караганда", "Karaganda"],
  ["пхукет", "Phuket"], ["бангкок", "Bangkok"], ["куалалумпур", "Kuala Lumpur"], ["нячанг", "Nha Trang"],
  ["камрань", "Cam Ranh"], ["дананг", "Da Nang"], ["фукуок", "Phu Quoc"],
  ["анталия", "Antalya"], ["анталья", "Antalya"], ["аланья", "Alanya"],
  ["алания", "Alanya"], ["газипаша", "Gazipasa"], ["газипашааланья", "Gazipasa"],
  ["стамбул", "Istanbul"], ["шармэшшейх", "Sharm El Sheikh"],
  ["шармэльшейх", "Sharm El Sheikh"], ["хургада", "Hurghada"], ["каир", "Cairo"],
  ["дубай", "Dubai"], ["шарджа", "Sharjah"], ["абудаби", "Abu Dhabi"],
  ["санья", "Sanya"], ["мале", "Male"], ["коломбо", "Colombo"],
  ["маттала", "Mattala"], ["гоа", "Goa"], ["тбилиси", "Tbilisi"],
  ["батуми", "Batumi"], ["баку", "Baku"], ["ереван", "Yerevan"],
  ["доха", "Doha"], ["джидда", "Jeddah"], ["белград", "Belgrade"],
  ["милан", "Milan"], ["рим", "Rome"], ["мюнхен", "Munich"],
  ["барселона", "Barcelona"], ["париж", "Paris"], ["прага", "Prague"],
  ["вена", "Vienna"], ["ларнака", "Larnaca"], ["бишкек", "Bishkek"],
  ["ташкент", "Tashkent"], ["москва", "Moscow"], ["санктпетербург", "Saint Petersburg"],
  ["сочи", "Sochi"]
]);

function cityKey(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/\([^)]*(?:\)|$)/g, " ")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_~`]/g, "")
    .replace(/[^а-яёa-z0-9]/giu, "");
}

function cleanCity(value) {
  return String(value || "")
    .replace(/^\s*(?:OW|RT)\s+/i, "")
    .replace(/\([^)]*(?:\)|$)/g, " ")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:|/\\-]+|[\s,.;:|/\\-]+$/g, "")
    .trim();
}

function displayCity(value) {
  return CITY_DISPLAY.get(cityKey(value)) || cleanCity(value);
}

function cityCountry(value) {
  const found = COUNTRY_BY_CITY.get(cityKey(value));
  return found ? { name: found[0], flag: found[1] } : null;
}

function sameCountry(a, b) {
  return a?.name && b?.name && a.name === b.name;
}

function countryKey(country) {
  return country ? country.name : "Другие направления";
}

export function countryForFlight(flight) {
  const fromCountry = cityCountry(flight?.from);
  const toCountry = cityCountry(flight?.to);

  if (fromCountry?.name === "Казахстан" && toCountry?.name !== "Казахстан") {
    return toCountry || { name: "Другие направления", flag: "🌍" };
  }
  if (toCountry?.name === "Казахстан" && fromCountry?.name !== "Казахстан") {
    return fromCountry || { name: "Другие направления", flag: "🌍" };
  }
  if (toCountry && toCountry.name !== "Казахстан") return toCountry;
  if (fromCountry && fromCountry.name !== "Казахстан") return fromCountry;
  return sameCountry(fromCountry, toCountry)
    ? fromCountry
    : (fromCountry || toCountry || { name: "Другие направления", flag: "🌍" });
}

export function parsePublishTargets(value) {
  const raw = String(value || "-1002106608923,-1002285584868");
  return raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(chat => chat.startsWith("@") || /^-?\d+$/.test(chat) ? chat : "@" + chat);
}

export function sourceIdForTarget(target) {
  const normalized = String(target || "").trim().replace(/^@/, "").toLowerCase();
  if (normalized === "charterkaz") return "telegram:charterkaz";
  if (normalized === "charter_forever_travel") return "telegram:charter_forever_travel";
  return null;
}

export function shouldSkipParsedTelegramMessage(text) {
  return String(text || "").includes(AUTO_MARKER);
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtDate(value) {
  if (!value) return "дата уточняется";
  const date = new Date(value + "T12:00:00");
  if (Number.isNaN(date.getTime())) return String(value);
  return String(date.getDate()).padStart(2, "0") + "." + String(date.getMonth() + 1).padStart(2, "0");
}

function fmtPrice(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0)).replace(/\u00a0/g, " ");
}

function seatLabel(value) {
  const text = String(value || "").trim();
  if (!text || text === "Наличие уточняется") return "";
  if (/последн/iu.test(text)) return "последнее место";
  const match = text.match(/\b(\d{1,3})\b/);
  if (!match) return text;
  const count = Number(match[1]);
  if (count === 1) return "1 место";
  if (count >= 2 && count <= 4) return count + " места";
  return count + " мест";
}

function routeKey(flight) {
  return [
    cityKey(flight?.from),
    cityKey(flight?.to),
    String(flight?.trip || "OW")
  ].join("|");
}

function routeTitleEnglish(flight) {
  const from = esc(displayCity(flight?.from));
  const to = esc(displayCity(flight?.to));
  return flight?.trip === "RT"
    ? from + " " + to + " " + from
    : from + " " + to;
}

function routeTitleRussian(flight) {
  return esc(cleanCity(flight?.from)) + " - " + esc(cleanCity(flight?.to));
}

function airlinePrefix(value) {
  const airline = String(value || "").trim();
  if (!airline) return "*";

  const normalized = airline
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-яё0-9]+/giu, " ")
    .trim();

  if (normalized.includes("air astana") || normalized.includes("эйр астана")) return "A";
  if (
    normalized.includes("vietjet")
    || normalized.includes("вьетжет")
    || normalized.includes("vietravel")
  ) return "V";
  if (normalized.includes("scat") || normalized.includes("sunday")) return "S";
  if (normalized.includes("sun phu quoc")) return "*";
  if (
    normalized.includes("flyarystan")
    || normalized.includes("fly arystan")
    || normalized.includes("flydubai")
  ) return "F";
  if (normalized.includes("pegasus")) return "P";
  if (normalized.includes("neos")) return "N";

  return "*";
}

function offerLine(flight) {
  const roundTrip = flight?.trip === "RT" && Boolean(flight?.returnDate);
  const date = roundTrip
    ? fmtDate(flight.departureDate) + "–" + fmtDate(flight.returnDate)
    : fmtDate(flight.departureDate);
  const airline = String(flight?.airline || "").trim();
  const prefix = airlinePrefix(airline);
  const carrier = prefix === "*" && airline ? esc(airline) + " " : (prefix !== "*" ? prefix + " " : "");
  const match = String(flight?.seats || "").match(/\\b(\\d{1,3})\\b/);
  const seats = match ? " (" + Number(match[1]) + ")" : "";
  const nights = roundTrip ? stayDays(flight) : null;
  const duration = roundTrip && nights ? " | " + nights + " ночей" : "";
  return carrier + date + duration + " - " + fmtPrice(flight.price) + " ₸" + seats;
}

const MONTH_LABELS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"
];

function monthKey(value) {
  if (!value) return "";
  const date = new Date(value + "T12:00:00");
  if (Number.isNaN(date.getTime())) return "";
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function monthLabel(value) {
  if (!value) return "";
  const date = new Date(value + "T12:00:00");
  if (Number.isNaN(date.getTime())) return "";
  return MONTH_LABELS[date.getMonth()] || "";
}

function stayDays(flight) {
  if (!flight?.departureDate || !flight?.returnDate) return null;
  const departure = new Date(flight.departureDate + "T12:00:00Z");
  const returned = new Date(flight.returnDate + "T12:00:00Z");
  const diff = Math.round((returned.getTime() - departure.getTime()) / 86400000);
  return Number.isFinite(diff) && diff > 0 ? diff : null;
}

function roundTripLabel(items) {
  const durations = new Set(
    items
      .map(stayDays)
      .filter(value => Number.isInteger(value) && value > 0)
  );
  return durations.size === 1
    ? "  -туда обратно " + [...durations][0]
    : "  -туда обратно-";
}

function ticketOrder(flight) {
  if (flight?.trip === "RT") return 3;

  const fromKz = cityCountry(flight?.from)?.name === "Казахстан";
  const toKz = cityCountry(flight?.to)?.name === "Казахстан";

  if (fromKz && !toKz) return 1;
  if (!fromKz && toKz) return 2;
  return 4;
}

function routeRows(routeFlights) {
  const rows = [];
  let previousMonth = "";

  for (const flight of routeFlights) {
    const currentMonth = monthKey(flight?.departureDate);
    if (previousMonth && currentMonth && currentMonth !== previousMonth) {
      const label = monthLabel(flight?.departureDate);
      if (label) rows.push({ text: "— " + label + " —", id: null });
    }

    rows.push({
      text: offerLine(flight),
      id: flight?.id || null
    });

    if (currentMonth) previousMonth = currentMonth;
  }

  return rows;
}

function routeSections(items) {
  const routes = new Map();

  for (const flight of items) {
    const key = routeKey(flight);
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push(flight);
  }

  return [...routes.values()]
    .map(routeFlights => {
      routeFlights.sort((a, b) =>
        String(a.departureDate || "").localeCompare(String(b.departureDate || ""))
        || String(a.returnDate || "").localeCompare(String(b.returnDate || ""))
        || Number(a.price || 0) - Number(b.price || 0)
      );

      const sample = routeFlights[0];
      return {
        title: routeTitleRussian(sample),
        rows: routeRows(routeFlights),
        order: ticketOrder(sample),
        firstDate: String(sample?.departureDate || "")
      };
    })
    .sort((a, b) =>
      a.order - b.order
      || a.firstDate.localeCompare(b.firstDate)
      || a.title.localeCompare(b.title, "ru")
    );
}

function groupFlightsByCountry(flights) {
  const groups = new Map();
  for (const flight of Array.isArray(flights) ? flights : []) {
    const country = countryForFlight(flight);
    const fromKz = cityCountry(flight?.from)?.name === "Казахстан";
    const toKz = cityCountry(flight?.to)?.name === "Казахстан";
    const roundTrip = flight?.trip === "RT" && Boolean(flight?.returnDate);
    const direction = roundTrip ? "roundtrip" : fromKz && !toKz
      ? "outbound" : !fromKz && toKz ? "return" : "other";
    const key = countryKey(country) + "|" + direction;
    if (!groups.has(key)) groups.set(key, { country, key, direction, flights: [] });
    groups.get(key).flights.push(flight);
  }
  const directionOrder = { outbound: 0, return: 1, roundtrip: 2, other: 3 };
  return [...groups.values()].sort((a, b) =>
    a.country.name.localeCompare(b.country.name, "ru")
    || directionOrder[a.direction] - directionOrder[b.direction]
  );
}

function normalizeNotice(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeNotice).filter(Boolean).join("\n");
  }
  return String(value || "").replace(/\s+/g, " ").trim();
}

function countryNotices(group) {
  const requirement = ENTRY_REQUIREMENT_BY_COUNTRY.get(group?.country?.name);
  return requirement ? ["⚠️ " + esc(requirement)] : [];
}

function baggageLines(items) {
  const lines = [];
  const seen = new Set();

  for (const flight of items) {
    const airline = String(flight?.airline || "").trim();
    const baggage = String(flight?.baggage || "").trim();
    if (!airline || !baggage) continue;

    const line = "🧳 " + esc(airline) + ": " + esc(baggage);
    const key = line.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }

  return lines;
}

function footerFor(items) {
  return items.some(flight => Boolean(flight?.cachedFallback))
    ? "💳 Цены в KZT\n🕒 Цена и наличие — по последним полученным данным"
    : "💳 Цены в KZT\n🕒 Цена и наличие актуальны на момент публикации";
}

function countryHeader(country, direction = "other") {
  const heading = direction === "return" ? "ОБРАТНЫЕ БИЛЕТЫ"
    : direction === "outbound" ? "БИЛЕТЫ ТУДА"
    : direction === "roundtrip" ? "ТУДА И ОБРАТНО (RT)" : "ЧАРТЕРНЫЕ РЕЙСЫ";
  return country.flag + " <b>" + heading + " · " + esc(country.name.toLocaleUpperCase("ru-RU")) + "</b>";
}

function sectionText(section, rows = section.rows) {
  return [section.title, ...rows.map(row => row.text)].filter(Boolean).join("\n");
}

function countryPostText(group, parts) {
  const blocks = [countryHeader(group.country, group.direction)];
  blocks.push(...parts);
  const airlines = [...new Set(group.flights.map(f => String(f?.airline || "").trim()).filter(Boolean))];
  const legend = [];
  if (airlines.some(a => airlinePrefix(a) === "S")) legend.push("S - SCAT");
  if (airlines.some(a => airlinePrefix(a) === "A")) legend.push("A - Air Astana");
  if (airlines.some(a => airlinePrefix(a) === "V")) legend.push("V - VietJet Air");
  if (legend.length) blocks.push(legend.join("\\n"));
  blocks.push("💳 Цены в ₸. Наличие и стоимость уточняются при бронировании.");
  return blocks.join("\\n\\n");
}

function packCountryPosts(group, maxChars) {
  const sections = routeSections(group.flights);
  const posts = [];
  let currentParts = [];
  let currentIds = [];

  const emitCurrent = () => {
    if (!currentParts.length) return;
    posts.push({
      text: countryPostText(group, currentParts),
      flightIds: [...new Set(currentIds)],
      country: group.key
    });
    currentParts = [];
    currentIds = [];
  };

  for (const section of sections) {
    const fullSection = sectionText(section);
    const sectionIds = section.rows.map(row => row.id).filter(Boolean);
    const candidate = countryPostText(group, [...currentParts, fullSection]);

    if (candidate.length <= maxChars) {
      currentParts.push(fullSection);
      currentIds.push(...sectionIds);
      continue;
    }

    emitCurrent();

    const single = countryPostText(group, [fullSection]);
    if (single.length <= maxChars) {
      currentParts = [fullSection];
      currentIds = [...sectionIds];
      continue;
    }

    let chunkRows = [];
    let chunkIds = [];

    const emitChunk = () => {
      if (!chunkRows.length) return;
      posts.push({
        text: countryPostText(group, [sectionText(section, chunkRows)]),
        flightIds: [...new Set(chunkIds)],
        country: group.country.name
      });
      chunkRows = [];
      chunkIds = [];
    };

    for (const row of section.rows) {
      const candidateRows = [...chunkRows, row];
      if (
        chunkRows.length
        && countryPostText(group, [sectionText(section, candidateRows)]).length > maxChars
      ) {
        emitChunk();
      }

      chunkRows.push(row);
      if (row.id) chunkIds.push(row.id);
    }

    emitChunk();
  }

  emitCurrent();
  return posts;
}

export function buildFlightPostBatches(flights, maxChars = 4050) {
  const posts = [];

  for (const group of groupFlightsByCountry(flights)) {
    posts.push(...packCountryPosts(group, maxChars));
  }

  return posts;
}

export function buildFlightPosts(flights, maxChars = 4050) {
  return buildFlightPostBatches(flights, maxChars).map(post => post.text);
}

export function filterFlightsForTarget(flights, target) {
  const targetSourceId = sourceIdForTarget(target);
  if (!targetSourceId) return [...flights];
  return flights.filter(flight => !Array.isArray(flight.sourceIds) || !flight.sourceIds.includes(targetSourceId));
}

export function telegramPublicationWindowStatus(now = new Date(), {
  timeZone = "Asia/Almaty",
  startHour = 10,
  endHour = 20
} = {}) {
  const start = Math.max(0, Math.min(23, Math.floor(Number(startHour) || 0)));
  const endRaw = Number(endHour);
  const end = Math.max(1, Math.min(24, Number.isFinite(endRaw) ? Math.floor(endRaw) : 20));

  let localHour;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now);
    localHour = Number(parts.find(part => part.type === "hour")?.value);
  } catch {
    return { open: false, timeZone, startHour: start, endHour: end, localHour: null };
  }

  const open = start < end
    ? localHour >= start && localHour < end
    : localHour >= start || localHour < end;

  return { open, timeZone, startHour: start, endHour: end, localHour };
}

async function telegramApi(token, method, payload, fetchImpl = fetch) {
  const response = await fetchImpl("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    throw new Error(result?.description || ("Telegram API " + response.status));
  }
  return result.result;
}

export async function publishFreshFlights({
  token,
  targets,
  flights,
  publicAppUrl,
  managerPhone,
  editMessageIds = {},
  fetchImpl = fetch,
  delayMs = Math.max(0, Number(process.env.POST_DELAY_SECONDS || 2) * 1000),
  maxPostsPerRun = Math.max(1, Math.floor(Number(process.env.MAX_POSTS_PER_RUN || 100)))
}) {
  const botToken = String(token || "").trim();
  const appUrl = String(publicAppUrl || "").trim();
  const phone = String(managerPhone || process.env.VITE_MANAGER_WHATSAPP || "77007772414").replace(/\D/g, "");
  const buyUrl = phone
    ? "https://wa.me/" + phone + "?text=" + encodeURIComponent("Здравствуйте! Хочу купить билет на чартерный рейс из публикации.")
    : "";

  if (!botToken) {
    return { published: 0, skipped: true, reason: "TELEGRAM_BOT_TOKEN missing", targets: [] };
  }

  const targetList = parsePublishTargets(targets);
  const results = [];
  let published = 0;

  for (const target of targetList) {
    const targetFlights = filterFlightsForTarget(flights, target);
    const allPosts = buildFlightPostBatches(targetFlights);
    const posts = allPosts.slice(0, maxPostsPerRun);
    const countryPostCounts = new Map();
    for (const post of allPosts) {
      countryPostCounts.set(post.country, (countryPostCounts.get(post.country) || 0) + 1);
    }

    let sent = 0;
    let error = null;
    const sentFlightIds = [];
    const countryMessages = {};

    for (const post of posts) {
      const configuredMessageId = Number(editMessageIds?.[post.country] || 0);
      const existingMessageId =
        configuredMessageId > 0 && countryPostCounts.get(post.country) === 1
          ? configuredMessageId
          : null;
      const payload = {
        chat_id: target,
        text: post.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: buyUrl ? {
          inline_keyboard: [[{ text: "🎫 Купить билет", url: buyUrl }]]
        } : (appUrl ? {
          inline_keyboard: [[{ text: "✈️ Посмотреть рейсы", url: appUrl }]]
        } : undefined)
      };
      if (existingMessageId) payload.message_id = existingMessageId;

      try {
        let apiResult;
        try {
          apiResult = await telegramApi(
            botToken,
            existingMessageId ? "editMessageText" : "sendMessage",
            payload,
            fetchImpl
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (existingMessageId && /message is not modified/i.test(message)) {
            apiResult = { message_id: existingMessageId };
          } else {
            throw err;
          }
        }

        const messageId = Number(apiResult?.message_id || existingMessageId || 0);
        if (messageId > 0) countryMessages[post.country] = messageId;
        sent += 1;
        published += 1;
        sentFlightIds.push(...post.flightIds);
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        break;
      }
    }

    results.push({
      target,
      flights: targetFlights.length,
      posts: posts.length,
      postsAvailable: allPosts.length,
      postsSkipped: Math.max(0, allPosts.length - posts.length),
      sent,
      sentFlightIds: [...new Set(sentFlightIds)],
      countryMessages,
      error
    });
  }

  return { published, skipped: false, targets: results };
}

export { AUTO_MARKER };
