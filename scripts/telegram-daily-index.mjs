/**
 * One dated navigation post per Telegram chat and publication day.
 *
 * Only links to successfully delivered country posts are included. The
 * publication date is not represented as the date of any particular flight.
 */
import { createHash } from "node:crypto";

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

export function buildDailyIndexDigest(records, { chatId, localDate } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(localDate || ""))) return null;
  const countries = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.country || record?.status !== "sent" || record?.localDate !== localDate) continue;
    const link = telegramMessageLink(chatId, record.messageId);
    if (!link) continue;
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
  lines.push(
    "",
    "Дата " + date + " — дата публикации подборки, не дата вылета.",
    "Проверяйте город отправления и дату в каждом предложении.",
    "Точное время вылета, стоимость и наличие подтверждаются при бронировании."
  );
  const text = lines.join("\n");
  // Never silently truncate the index and hide some of the countries.
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
