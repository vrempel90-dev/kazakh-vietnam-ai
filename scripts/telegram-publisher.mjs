const AUTO_MARKER = "🤖 Автообновление";

const COUNTRY_BY_CITY = new Map([
  ["алматы", ["Казахстан", "🇰🇿"]],
  ["астана", ["Казахстан", "🇰🇿"]],
  ["шымкент", ["Казахстан", "🇰🇿"]],
  ["атырау", ["Казахстан", "🇰🇿"]],
  ["актобе", ["Казахстан", "🇰🇿"]],
  ["актау", ["Казахстан", "🇰🇿"]],
  ["костанай", ["Казахстан", "🇰🇿"]],
  ["кызылорда", ["Казахстан", "🇰🇿"]],
  ["тараз", ["Казахстан", "🇰🇿"]],
  ["уральск", ["Казахстан", "🇰🇿"]],
  ["петропавловск", ["Казахстан", "🇰🇿"]],
  ["караганда", ["Казахстан", "🇰🇿"]],

  ["пхукет", ["Таиланд", "🇹🇭"]],
  ["бангкок", ["Таиланд", "🇹🇭"]],

  ["нячанг", ["Вьетнам", "🇻🇳"]],
  ["камрань", ["Вьетнам", "🇻🇳"]],
  ["дананг", ["Вьетнам", "🇻🇳"]],
  ["фукуок", ["Вьетнам", "🇻🇳"]],

  ["анталия", ["Турция", "🇹🇷"]],
  ["анталья", ["Турция", "🇹🇷"]],
  ["стамбул", ["Турция", "🇹🇷"]],

  ["шармэшшейх", ["Египет", "🇪🇬"]],
  ["шармэльшейх", ["Египет", "🇪🇬"]],
  ["хургада", ["Египет", "🇪🇬"]],
  ["каир", ["Египет", "🇪🇬"]],

  ["дубай", ["ОАЭ", "🇦🇪"]],
  ["шарджа", ["ОАЭ", "🇦🇪"]],
  ["абудаби", ["ОАЭ", "🇦🇪"]],

  ["санья", ["Китай", "🇨🇳"]],
  ["мале", ["Мальдивы", "🇲🇻"]],
  ["коломбо", ["Шри-Ланка", "🇱🇰"]],
  ["маттала", ["Шри-Ланка", "🇱🇰"]],
  ["гоа", ["Индия", "🇮🇳"]],
  ["тбилиси", ["Грузия", "🇬🇪"]],
  ["батуми", ["Грузия", "🇬🇪"]],
  ["баку", ["Азербайджан", "🇦🇿"]],
  ["ереван", ["Армения", "🇦🇲"]],
  ["доха", ["Катар", "🇶🇦"]],
  ["джидда", ["Саудовская Аравия", "🇸🇦"]],
  ["белград", ["Сербия", "🇷🇸"]],
  ["милан", ["Италия", "🇮🇹"]],
  ["рим", ["Италия", "🇮🇹"]],
  ["барселона", ["Испания", "🇪🇸"]],
  ["париж", ["Франция", "🇫🇷"]],
  ["прага", ["Чехия", "🇨🇿"]],
  ["вена", ["Австрия", "🇦🇹"]],
  ["ларнака", ["Кипр", "🇨🇾"]],
  ["бишкек", ["Кыргызстан", "🇰🇬"]],
  ["ташкент", ["Узбекистан", "🇺🇿"]],
  ["москва", ["Россия", "🇷🇺"]],
  ["санктпетербург", ["Россия", "🇷🇺"]],
  ["сочи", ["Россия", "🇷🇺"]]
]);

function cityKey(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_~`]/g, "")
    .replace(/[^а-яёa-z0-9]/giu, "");
}

function cityCountry(value) {
  const found = COUNTRY_BY_CITY.get(cityKey(value));
  if (!found) return null;
  return { name: found[0], flag: found[1] };
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
  const kazakhstan = { name: "Казахстан", flag: "🇰🇿" };

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

function directionInfo(flight, country) {
  const fromCountry = cityCountry(flight?.from);
  const toCountry = cityCountry(flight?.to);

  if (fromCountry?.name === "Казахстан" && toCountry?.name === country?.name) {
    return { order: 0, key: "outbound", label: "🇰🇿 → " + country.flag + " <b>Из Казахстана</b>" };
  }
  if (toCountry?.name === "Казахстан" && fromCountry?.name === country?.name) {
    return { order: 1, key: "inbound", label: country.flag + " → 🇰🇿 <b>В Казахстан</b>" };
  }
  return { order: 2, key: "other", label: "✈️ <b>Другие направления</b>" };
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
  if (normalized === "charterkaz") return "charterkaz";
  if (normalized === "charter_forever_travel") return "charter_forever_travel";
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
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function fmtPrice(value) {
  return new Intl.NumberFormat("ru-RU").format(Number(value || 0)) + " ₸";
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

function flightRoute(flight) {
  const from = cleanCity(flight.from);
  const to = cleanCity(flight.to);
  const route = flight.trip === "RT" ? from + " → " + to + " → " + from : from + " → " + to;
  return esc(route);
}

function flightBlock(flight) {
  const rows = [
    (flight.hot ? "🔥 " : "✈️ ") + flightRoute(flight),
    flight.airline ? "✈️ " + esc(flight.airline) : null,
    "📅 " + fmtDate(flight.departureDate)
      + (flight.returnDate ? " — " + fmtDate(flight.returnDate) : "")
      + " · " + (flight.trip === "RT" ? "туда-обратно" : "в одну сторону"),
    flight.seats && flight.seats !== "Наличие уточняется" ? "💺 " + esc(flight.seats) : null,
    "💰 " + fmtPrice(flight.price)
  ];
  return rows.filter(Boolean).join("\n");
}

function sortFlightsForCountry(items, country) {
  return [...items].sort((a, b) => {
    const da = directionInfo(a, country).order;
    const db = directionInfo(b, country).order;
    if (da !== db) return da - db;
    const date = String(a.departureDate || "").localeCompare(String(b.departureDate || ""));
    if (date !== 0) return date;
    const route = flightRoute(a).localeCompare(flightRoute(b), "ru");
    if (route !== 0) return route;
    return Number(a.price || 0) - Number(b.price || 0);
  });
}

function groupFlightsByCountry(flights) {
  const groups = new Map();
  for (const flight of Array.isArray(flights) ? flights : []) {
    const country = countryForFlight(flight);
    const key = countryKey(country);
    if (!groups.has(key)) groups.set(key, { country, flights: [] });
    groups.get(key).flights.push(flight);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.country.name === "Другие направления") return 1;
    if (b.country.name === "Другие направления") return -1;
    const firstA = [...a.flights].sort((x, y) => String(x.departureDate || "").localeCompare(String(y.departureDate || "")))[0];
    const firstB = [...b.flights].sort((x, y) => String(x.departureDate || "").localeCompare(String(y.departureDate || "")))[0];
    const byDate = String(firstA?.departureDate || "").localeCompare(String(firstB?.departureDate || ""));
    return byDate || a.country.name.localeCompare(b.country.name, "ru");
  });
}

export function buildFlightPostBatches(flights, maxChars = 3400, maxFlightsPerPost = 10) {
  const posts = [];

  for (const group of groupFlightsByCountry(flights)) {
    const items = sortFlightsForCountry(group.flights, group.country);
    const intro = group.country.flag + " <b>" + esc(group.country.name) + " — чартерные рейсы</b>\n\n";
    const hasCached = items.some(flight => Boolean(flight?.cachedFallback));
    const footer = hasCached
      ? "\n\nЦены и наличие указаны по последним полученным данным.\n" + AUTO_MARKER
      : "\n\nЦены и наличие актуальны на момент публикации.\n" + AUTO_MARKER;

    let body = "";
    let count = 0;
    let flightIds = [];
    let currentDirection = null;

    const flush = () => {
      if (!body) return;
      posts.push({
        text: intro + body + footer,
        flightIds: [...flightIds],
        country: group.country.name
      });
      body = "";
      count = 0;
      flightIds = [];
      currentDirection = null;
    };

    for (const flight of items) {
      const direction = directionInfo(flight, group.country);
      const block = flightBlock(flight);
      const needsHeading = currentDirection !== direction.key;
      const heading = needsHeading ? direction.label + "\n\n" : "";
      const separator = body ? "\n\n────────\n\n" : "";
      const piece = separator + heading + block;
      const candidate = intro + body + piece + footer;

      if (body && (candidate.length > maxChars || count >= maxFlightsPerPost)) {
        flush();
        body = direction.label + "\n\n" + block;
        currentDirection = direction.key;
        count = 1;
        flightIds = flight?.id ? [flight.id] : [];
        continue;
      }

      body += piece;
      currentDirection = direction.key;
      count += 1;
      if (flight?.id) flightIds.push(flight.id);
    }

    flush();
  }

  return posts;
}

export function buildFlightPosts(flights, maxChars = 3400, maxFlightsPerPost = 10) {
  return buildFlightPostBatches(flights, maxChars, maxFlightsPerPost).map(post => post.text);
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
  if (!botToken) return { published: 0, skipped: true, reason: "TELEGRAM_BOT_TOKEN missing", targets: [] };

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
