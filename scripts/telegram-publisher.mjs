const AUTO_MARKER = "🤖 Автообновление";

export function parsePublishTargets(value) {
  const raw = String(value || "@charterkaz,@charter_forever_travel");
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
    .replace(/^\p{Extended_Pictographic}+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function flightRoute(flight) {
  const from = cleanCity(flight.from);
  const to = cleanCity(flight.to);
  return flight.trip === "RT" ? from + " → " + to + " → " + from : from + " → " + to;
}

function flightBlock(flight) {
  const rows = [
    (flight.hot ? "🔥 " : "✈️ ") + flightRoute(flight),
    flight.airline ? "✈️ " + flight.airline : null,
    "📅 " + fmtDate(flight.departureDate)
      + (flight.returnDate ? " — " + fmtDate(flight.returnDate) : "")
      + " · " + (flight.trip === "RT" ? "туда-обратно" : "в одну сторону"),
    flight.seats && flight.seats !== "Наличие уточняется" ? "💺 " + flight.seats : null,
    "💰 " + fmtPrice(flight.price)
  ];
  return rows.filter(Boolean).join("\n");
}

export function buildFlightPosts(flights, maxChars = 3400, maxFlightsPerPost = 8) {
  const items = Array.isArray(flights) ? flights : [];
  const posts = [];
  let current = "";
  let currentCount = 0;

  const intro = "✈️ <b>Свежие чартерные рейсы</b>\n\n";
  const footer = "\n\nЦены и наличие актуальны на момент публикации.\n" + AUTO_MARKER;

  for (const flight of items) {
    const block = flightBlock(flight);
    const candidate = (current ? current + "\n\n────────\n\n" : intro) + block;
    const finalLength = candidate.length + footer.length;

    if (current && (finalLength > maxChars || currentCount >= maxFlightsPerPost)) {
      posts.push(current + footer);
      current = intro + block;
      currentCount = 1;
    } else {
      current = candidate;
      currentCount += 1;
    }
  }

  if (current) posts.push(current + footer);
  return posts;
}

export function filterFlightsForTarget(flights, target) {
  const targetSourceId = sourceIdForTarget(target);
  if (!targetSourceId) return [...flights];
  return flights.filter(flight => !Array.isArray(flight.sourceIds) || !flight.sourceIds.includes(targetSourceId));
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
  fetchImpl = fetch,
  delayMs = 350
}) {
  const botToken = String(token || "").trim();
  const appUrl = String(publicAppUrl || "").trim();
  if (!botToken) return { published: 0, skipped: true, reason: "TELEGRAM_BOT_TOKEN missing", targets: [] };

  const targetList = parsePublishTargets(targets);
  const results = [];
  let published = 0;

  for (const target of targetList) {
    const targetFlights = filterFlightsForTarget(flights, target);
    const posts = buildFlightPosts(targetFlights);
    let sent = 0;
    let error = null;

    for (const text of posts) {
      try {
        await telegramApi(botToken, "sendMessage", {
          chat_id: target,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: appUrl ? {
            inline_keyboard: [[{ text: "🚀 Запустить приложение", url: appUrl }]]
          } : undefined
        }, fetchImpl);
        sent += 1;
        published += 1;
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
      sent,
      error
    });
  }

  return { published, skipped: false, targets: results };
}

export { AUTO_MARKER };
