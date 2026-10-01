import { redactTelegramError } from "./telegram-bot.mjs";
import { createHash } from "node:crypto";

const AUTO_MARKER = "🤖 Автообновление";

export function postFingerprint(post) {
  return createHash("sha256").update(JSON.stringify([post.text, post.country, post.flightIds])).digest("hex");
}

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

// Reuse the parser's canonical cities, with explicit common names and airport aliases
// for callers that supply feed objects directly.
const CITY_ALIASES = new Map(Object.entries({
  almaty: "алматы", ala: "алматы", astana: "астана", nqz: "астана", shymkent: "шымкент",
  aktau: "актау", sco: "актау", aktobe: "актобе", atyrau: "атырау", karaganda: "караганда",
  dubai: "дубай", dxb: "дубай", dwc: "дубай", sharjah: "шарджа", shj: "шарджа",
  abudhabi: "абудаби", auh: "абудаби", phuket: "пхукет", hkt: "пхукет",
  bangkok: "бангкок", bkk: "бангкок", antalya: "анталия", ayt: "анталия",
  istanbul: "стамбул", ist: "стамбул", saw: "стамбул", sharmelsheikh: "шармэльшейх",
  sharmelshaikh: "шармэльшейх", ssh: "шармэльшейх", hurghada: "хургада", hrg: "хургада",
  nhatrang: "нячанг", camranh: "нячанг", cxr: "нячанг", danang: "дананг", dad: "дананг",
  phuquoc: "фукуок", pqc: "фукуок", male: "мале", colombo: "коломбо", sanya: "санья"
}));

function cityCountry(value) {
  const key = cityKey(value);
  const found = COUNTRY_BY_CITY.get(CITY_ALIASES.get(key) || key);
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
    .map(chat => /^-?\d+$/.test(chat) ? chat : (chat.startsWith("@") ? chat : "@" + chat).toLowerCase())
    .filter((chat, index, chats) => chats.indexOf(chat) === index);
}

export function sourceIdForTarget(target) {
  const normalized = String(target || "").trim().replace(/^@/, "").toLowerCase();
  if (normalized && !/^-?\d+$/.test(normalized)) return "telegram:" + normalized;
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
  const details = [
    fmtDate(flight.departureDate)
      + (flight.returnDate ? "–" + fmtDate(flight.returnDate) : ""),
    fmtPrice(flight.price),
    flight.airline ? esc(flight.airline) : null,
    flight.seats && flight.seats !== "Наличие уточняется" ? esc(flight.seats) : null
  ].filter(Boolean);

  return (flight.hot ? "🔥 " : "✈️ ")
    + flightRoute(flight)
    + "\n"
    + details.join(" · ");
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

export function telegramTextLength(text) {
  return String(text).replace(/<\/?b>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").length;
}

function splitEscapedText(text, limit) {
  const chunks = [];
  let chunk = "";
  let size = 0;
  for (const token of text.match(/&(?:amp|lt|gt);|[\s\S]/gu) || []) {
    const length = token.startsWith("&") && token.endsWith(";") ? 1 : token.length;
    if (size + length > limit && chunk) { chunks.push(chunk); chunk = ""; size = 0; }
    chunk += token;
    size += length;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function buildFlightPostBatches(flights, maxChars = 4096) {
  const limit = Math.min(4096, Math.max(256, Math.floor(Number(maxChars) || 4096)));
  const posts = [];
  for (const group of groupFlightsByCountry(flights)) {
    const items = sortFlightsForCountry(group.flights, group.country);
    const title = group.country.flag + " <b>" + esc(group.country.name) + " — все актуальные чартеры";
    const footer = items.some(flight => Boolean(flight?.cachedFallback))
      ? "\n\nЦены и наличие указаны по последним полученным данным.\n" + AUTO_MARKER
      : "\n\nЦены и наличие актуальны на момент публикации.\n" + AUTO_MARKER;
    const renderBody = entries => {
      let directionKey;
      return entries.map(entry => {
        const heading = directionKey !== entry.direction.key ? entry.direction.label + "\n" : "";
        directionKey = entry.direction.key;
        return heading + entry.block;
      }).join("\n");
    };
    const entries = items.map(flight => ({ id: flight.id, block: flightBlock(flight), direction: directionInfo(flight, group.country) }));
    const whole = title + "</b>\n\n" + renderBody(entries) + footer;
    if (telegramTextLength(whole) <= limit) {
      posts.push({ text: whole, flightIds: entries.map(item => item.id).filter(Boolean), country: group.country.name });
      continue;
    }
    // Reserve a bounded part-number suffix. Split complete records wherever possible;
    // an exceptionally long single record is continued without truncating its fields.
    const overhead = telegramTextLength(title + " — часть 999999/999999</b>\n\n" + footer);
    const expanded = entries.flatMap(entry => splitEscapedText(entry.block,
      limit - overhead - telegramTextLength(entry.direction.label) - 1).map(block => ({ ...entry, block })));
    const chunks = [];
    let chunk = [];
    for (const entry of expanded) {
      if (chunk.length && overhead + telegramTextLength(renderBody([...chunk, entry])) > limit) {
        chunks.push(chunk); chunk = [];
      }
      chunk.push(entry);
    }
    if (chunk.length) chunks.push(chunk);
    for (const [index, part] of chunks.entries()) {
      const text = title + ` — часть ${index + 1}/${chunks.length}</b>\n\n` + renderBody(part) + footer;
      if (telegramTextLength(text) > limit) throw new Error("Country post cannot fit Telegram limit");
      posts.push({ text, flightIds: [...new Set(part.map(item => item.id).filter(Boolean))], country: group.country.name });
    }
  }
  return posts.map(post => ({ ...post, contentHash: postFingerprint(post) }));
}

export function buildFlightPosts(flights, maxChars = 4096) {
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
    const error = new Error(redactTelegramError(result?.description || ("Telegram API " + response.status), [token, process.env.TELEGRAM_WEBHOOK_SECRET]));
    error.definitive = result?.ok === false;
    throw error;
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
  postBatches,
  beforePost,
  afterPost,
  onPostFailure,
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
    const allPosts = postBatches || buildFlightPostBatches(targetFlights);
    const availablePosts = allPosts.filter(post => !post.status || post.status === "pending");
    const posts = availablePosts.slice(0, Math.max(1, Math.floor(Number(maxPostsPerRun) || 2)));
    let sent = 0;
    let error = null;
    const sentFlightIds = [];

    for (const post of posts) {
      await beforePost?.(target, post);
      let message;
      try {
        message = await telegramApi(botToken, "sendMessage", {
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
      } catch (err) {
        await onPostFailure?.(target, post, err);
        error = redactTelegramError(err, [botToken, process.env.TELEGRAM_WEBHOOK_SECRET]);
        break;
      }
      await afterPost?.(target, post, message);
      sent += 1;
      published += 1;
      sentFlightIds.push(...post.flightIds);
      if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    results.push({
      target,
      flights: targetFlights.length,
      posts: posts.length,
      postsAvailable: availablePosts.length,
      postsSkipped: Math.max(0, availablePosts.length - posts.length),
      sent,
      sentFlightIds: [...new Set(sentFlightIds)],
      error
    });
  }

  return { published, skipped: false, targets: results };
}

export { AUTO_MARKER };
