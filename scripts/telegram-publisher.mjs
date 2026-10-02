const AUTO_MARKER = "🤖 Автообновление";

const COUNTRY_BY_CITY = new Map([
  ["алматы", ["Казахстан", "🇰🇿"]], ["астана", ["Казахстан", "🇰🇿"]],
  ["шымкент", ["Казахстан", "🇰🇿"]], ["атырау", ["Казахстан", "🇰🇿"]],
  ["актобе", ["Казахстан", "🇰🇿"]], ["актау", ["Казахстан", "🇰🇿"]],
  ["костанай", ["Казахстан", "🇰🇿"]], ["кызылорда", ["Казахстан", "🇰🇿"]],
  ["тараз", ["Казахстан", "🇰🇿"]], ["уральск", ["Казахстан", "🇰🇿"]],
  ["петропавловск", ["Казахстан", "🇰🇿"]], ["караганда", ["Казахстан", "🇰🇿"]],

  ["пхукет", ["Таиланд", "🇹🇭"]], ["бангкок", ["Таиланд", "🇹🇭"]],
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
  ["Казахстан", "Kazakhstan"], ["Таиланд", "Thailand"], ["Вьетнам", "Vietnam"],
  ["Турция", "Turkiye"], ["Египет", "Egypt"], ["ОАЭ", "UAE"],
  ["Китай", "Hainan"], ["Мальдивы", "Maldives"], ["Шри-Ланка", "Sri Lanka"],
  ["Индия", "India"], ["Грузия", "Georgia"], ["Азербайджан", "Azerbaijan"],
  ["Армения", "Armenia"], ["Катар", "Qatar"], ["Саудовская Аравия", "Saudi Arabia"],
  ["Сербия", "Serbia"], ["Италия", "Italy"], ["Германия", "Germany"],
  ["Испания", "Spain"], ["Франция", "France"], ["Чехия", "Czech Republic"],
  ["Австрия", "Austria"], ["Кипр", "Cyprus"], ["Кыргызстан", "Kyrgyzstan"],
  ["Узбекистан", "Uzbekistan"], ["Россия", "Russia"],
  ["Другие направления", "Other destinations"]
]);

const CITY_DISPLAY = new Map([
  ["алматы", "Almaty"], ["астана", "Astana"], ["шымкент", "Shymkent"],
  ["атырау", "Atyrau"], ["актобе", "Aktobe"], ["актау", "Aktau"],
  ["костанай", "Kostanay"], ["кызылорда", "Kyzylorda"], ["тараз", "Taraz"],
  ["уральск", "Uralsk"], ["петропавловск", "Petropavlovsk"], ["караганда", "Karaganda"],
  ["пхукет", "Phuket"], ["бангкок", "Bangkok"], ["нячанг", "Nha Trang"],
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
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_~`]/g, "")
    .replace(/[^а-яёa-z0-9]/giu, "");
}

function cleanCity(value) {
  return String(value || "")
    .replace(/^\s*(?:OW|RT)\s+/i, "")
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
  return date.getDate() + "." + String(date.getMonth() + 1).padStart(2, "0");
}

function fmtPrice(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0));
}

function seatSuffix(value) {
  if (!value || value === "Наличие уточняется") return "";
  const match = String(value).match(/\b(\d{1,2})\b/);
  return match ? " (" + match[1] + ")" : "";
}

function routeKey(flight) {
  return [
    cityKey(flight?.from),
    cityKey(flight?.to),
    String(flight?.trip || "OW")
  ].join("|");
}

function routeTitle(flight) {
  const from = esc(cleanCity(flight?.from));
  const to = esc(cleanCity(flight?.to));
  return flight?.trip === "RT"
    ? from + " - " + to + " - " + from
    : from + " - " + to;
}

function airlinePrefix(value) {
  const airline = String(value || "").trim();
  if (!airline) return "";

  const normalized = airline.toLocaleLowerCase("ru-RU");
  if (normalized.includes("air astana") || normalized.includes("эйр астана")) return "A";
  if (normalized.includes("vietjet") || normalized.includes("вьетжет") || normalized.includes("vietravel")) return "V";
  if (normalized.includes("sunday") || normalized.includes("scat")) return "S";
  if (normalized.includes("flyarystan") || normalized.includes("fly arystan") || normalized.includes("flydubai")) return "F";
  if (normalized.includes("pegasus")) return "P";
  if (normalized.includes("neos")) return "N";

  const latin = airline.match(/[A-Za-z]/);
  if (latin) return latin[0].toUpperCase();
  const cyrillic = airline.match(/[А-ЯЁ]/iu);
  return cyrillic ? cyrillic[0].toLocaleUpperCase("ru-RU") : "";
}

function offerLine(flight) {
  const prefix = airlinePrefix(flight?.airline);
  const date = flight?.trip === "RT" && flight?.returnDate
    ? fmtDate(flight.departureDate) + " - " + fmtDate(flight.returnDate)
    : fmtDate(flight.departureDate);

  return (prefix ? prefix + " " : "")
    + date
    + " - "
    + fmtPrice(flight.price)
    + seatSuffix(flight.seats)
    + (flight.hot ? " 🔥" : "");
}

function ticketGroup(flight) {
  if (flight?.trip === "RT") {
    return { key: "roundtrip", title: "Туда-обратно", order: 3 };
  }

  const fromKz = cityCountry(flight?.from)?.name === "Казахстан";
  const toKz = cityCountry(flight?.to)?.name === "Казахстан";

  if (fromKz && !toKz) {
    return { key: "outbound", title: "Билеты туда", order: 1 };
  }
  if (!fromKz && toKz) {
    return { key: "return", title: "Обратные билеты", order: 2 };
  }
  return { key: "other", title: "Другие билеты", order: 4 };
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
        title: routeTitle(sample),
        lines: routeFlights.map(offerLine),
        flightIds: routeFlights.map(flight => flight.id).filter(Boolean),
        firstDate: String(sample?.departureDate || "")
      };
    })
    .sort((a, b) =>
      a.title.localeCompare(b.title, "ru")
      || a.firstDate.localeCompare(b.firstDate)
    );
}

function groupFlightsByTicketType(flights) {
  const groups = new Map();

  for (const flight of Array.isArray(flights) ? flights : []) {
    const group = ticketGroup(flight);
    if (!groups.has(group.key)) {
      groups.set(group.key, { ...group, flights: [] });
    }
    groups.get(group.key).flights.push(flight);
  }

  return [...groups.values()].sort((a, b) => a.order - b.order);
}

function packListPosts(group, maxChars) {
  const posts = [];
  const sections = routeSections(group.flights);
  let currentParts = [];
  let currentIds = [];

  const buildText = parts => group.title + "\n\n" + parts.join("\n\n");

  const emit = () => {
    if (!currentParts.length) return;
    posts.push({
      text: buildText(currentParts),
      flightIds: [...new Set(currentIds)],
      category: group.key
    });
    currentParts = [];
    currentIds = [];
  };

  for (const section of sections) {
    const sectionText = section.title + "\n" + section.lines.join("\n");
    const candidate = buildText([...currentParts, sectionText]);

    if (candidate.length <= maxChars) {
      currentParts.push(sectionText);
      currentIds.push(...section.flightIds);
      continue;
    }

    emit();

    const fullSingle = buildText([sectionText]);
    if (fullSingle.length <= maxChars) {
      currentParts = [sectionText];
      currentIds = [...section.flightIds];
      continue;
    }

    let chunkLines = [];
    let chunkIds = [];
    for (let index = 0; index < section.lines.length; index += 1) {
      const line = section.lines[index];
      const chunkText = section.title + "\n" + [...chunkLines, line].join("\n");
      if (buildText([chunkText]).length > maxChars && chunkLines.length) {
        posts.push({
          text: buildText([section.title + "\n" + chunkLines.join("\n")]),
          flightIds: [...chunkIds],
          category: group.key
        });
        chunkLines = [];
        chunkIds = [];
      }
      chunkLines.push(line);
      if (section.flightIds[index]) chunkIds.push(section.flightIds[index]);
    }

    if (chunkLines.length) {
      posts.push({
        text: buildText([section.title + "\n" + chunkLines.join("\n")]),
        flightIds: [...chunkIds],
        category: group.key
      });
    }
  }

  emit();
  return posts;
}

export function buildFlightPostBatches(flights, maxChars = 4050) {
  const posts = [];
  for (const group of groupFlightsByTicketType(flights)) {
    posts.push(...packListPosts(group, maxChars));
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
  fetchImpl = fetch,
  delayMs = Math.max(0, Number(process.env.POST_DELAY_SECONDS || 2) * 1000),
  maxPostsPerRun = Math.max(1, Math.floor(Number(process.env.MAX_POSTS_PER_RUN || 2)))
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
    let sent = 0;
    let error = null;
    const sentFlightIds = [];

    for (const post of posts) {
      try {
        await telegramApi(botToken, "sendMessage", {
          chat_id: target,
          text: post.text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: buyUrl ? {
            inline_keyboard: [[{ text: "🎫 Купить билет", url: buyUrl }]]
          } : (appUrl ? {
            inline_keyboard: [[{ text: "✈️ Посмотреть рейсы", url: appUrl }]]
          } : undefined)
        }, fetchImpl);

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
      error
    });
  }

  return { published, skipped: false, targets: results };
}

export { AUTO_MARKER };
