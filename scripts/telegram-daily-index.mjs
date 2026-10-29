/**
 * One dated navigation post per Telegram chat and publication day.
 *
 * Only links to successfully delivered country posts are included. The
 * publication date is not represented as the date of any particular flight.
 */
import { createHash } from "node:crypto";
import { resolveCity } from "./charter-geo.mjs";

export const DAILY_INDEX_KEY = "DAILY_INDEX#1";

function esc(text) {
  return String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function telegramMessageLink(chatId, messageId) {
  const chat = String(chatId || "").trim();
  const id = Number(messageId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (/^@[a-z0-9_]{5,}$/i.test(chat)) {
    return "https://t.me/" + chat.slice(1) + "/" + id;
  }
  const privateChat = chat.match(/^-100(\d+)$/);
  if (privateChat) return "https://t.me/c/" + privateChat[1] + "/" + id;
  return null;
}

function nextDate(iso) {
  const day = new Date(iso + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

function shortDate(iso) {
  return iso.slice(8, 10) + "." + iso.slice(5, 7);
}

export function buildDailyIndexDigest(records, { chatId, localDate, flights = [] } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDate || ""))) return null;
  const countries = new Map();
  const deliveredOffers = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.country || record?.status !== "sent" || record?.localDate !== localDate) continue;
    const link = telegramMessageLink(chatId, record.messageId);
    if (!link) continue;
    for (const offerId of record.offerIds || []) {
      if (!deliveredOffers.has(offerId)) deliveredOffers.set(offerId, link);
    }
    const countryCode = String(record.country);
    const current = countries.get(countryCode);
    if (!current) {
      countries.set(countryCode, {
        name: String(record.countryName || countryCode),
        parts: Number(record.parts) || 1,
        part: Number(record.part) || 1,
        link
      });
    } else {
      current.parts = Math.max(current.parts, Number(record.parts) || 1);
      if (Number(record.part) < current.part) {
        current.link = link;
        current.part = Number(record.part);
      }
    }
  }
  if (!countries.size) return null;
  const date = localDate.slice(8, 10) + "." + localDate.slice(5, 7) + "." + localDate.slice(0, 4);
  const lines = [
    "<b>📌 ПОДБОРКИ ЧАРТЕРОВ ЗА " + date + "</b>",
    "",
    "Выберите страну, чтобы открыть список маршрутов и дат вылета:",
    ""
  ];
  for (const country of [...countries.values()].sort((a, b) => a.name.localeCompare(b.name, "ru"))) {
    lines.push("• <a href=\"" + country.link + "\">" + esc(country.name) + "</a>"
      + (country.parts > 1 ? " (частей: " + country.parts + ")" : ""));
  }
  // Quick navigation for the traveler's "from Almaty tomorrow" use case:
  // only show an exact flight date/direction when that offer is already
  // included in a confirmed published message from today.
  const tomorrow = nextDate(localDate);
  const urgent = new Map();
  for (const flight of Array.isArray(flights) ? flights : []) {
    const link = deliveredOffers.get(flight?.id);
    if (!link || ![localDate, tomorrow].includes(flight?.departureDate)) continue;
    const from = resolveCity(flight?.from);
    const to = resolveCity(flight?.to);
    if (from?.country?.code !== "KZ" || !to || to.country.code === "KZ") continue;
    const key = flight.departureDate + "|" + from.id + "|" + to.id;
    if (!urgent.has(key)) urgent.set(key, {
      date: flight.departureDate,
      from: from.name,
      to: to.name,
      link,
      count: 0
    });
    urgent.get(key).count += 1;
  }

  const suffix = [
    "",
    "Дата " + date + " — дата публикации подборки, не дата вылета.",
    "Проверяйте город отправления и дату в каждом предложении.",
    "Точное время вылета, стоимость и наличие подтверждаются при бронировании."
  ];
  const quick = ["", "<b>🛫 БЛИЖАЙШИЕ ВЫЛЕТЫ ИЗ КАЗАХСТАНА</b>"];
  const byDate = [...urgent.values()].sort((a, b) =>
    a.date.localeCompare(b.date)
    || a.from.localeCompare(b.from, "ru")
    || a.to.localeCompare(b.to, "ru")
  );
  if (!byDate.length) {
    quick.push("В опубликованных сегодня подборках пока нет вылетов из Казахстана на сегодня или завтра.");
  } else {
    let omitted = 0;
    for (const item of byDate) {
      const row = "• " + shortDate(item.date) + ": " + esc(item.from)
        + " → " + esc(item.to) + " — <a href=\"" + item.link + "\">посмотреть</a>";
      const budget = 4096 - suffix.join("\n").length - lines.join("\n").length - 110;
      if ([...quick, row].join("\n").length <= budget) quick.push(row);
      else omitted += 1;
    }
    if (omitted) quick.push("Другие ближайшие направления смотрите в подборках по странам выше.");
  }
  lines.push(...quick, ...suffix);
  const text = lines.join("\n");
  // Never silently truncate the country index: it is the navigation source.
  if (text.length > 4096) return null;
  return {
    key: DAILY_INDEX_KEY,
    country: null,
    countryName: null,
    part: 1,
    parts: 1,
    offerIds: [],
    text,
    contentHash: createHash("sha256").update(text).digest("hex").slice(0, 32)
  };
}
