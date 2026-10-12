/**
 * Telegram transport and publication helpers.
 *
 * Rendering lives in `telegram-digest.mjs`, geography in `charter-geo.mjs`,
 * scheduling in `telegram-schedule.mjs` and durable bookkeeping in
 * `telegram-publication-state.mjs`. This module only talks to the Bot API and
 * owns the target/source bookkeeping around it.
 */

import { FOOTER_TEXT } from "./telegram-digest.mjs";

/** Legacy marker kept so older auto-posts are still recognised on ingestion. */
const AUTO_MARKER = "🤖 Автообновление";

export const DEFAULT_PUBLISH_CHATS = "-1002106608923,-1002285584868";

export function parsePublishTargets(value) {
  const raw = String(value ?? "").trim() || DEFAULT_PUBLISH_CHATS;
  return raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(chat => (chat.startsWith("@") || /^-?\d+$/.test(chat) ? chat : "@" + chat))
    .filter((chat, index, list) => list.indexOf(chat) === index);
}

/** Maps one of our own publication channels back to its ingestion source id. */
export function sourceIdForTarget(target) {
  const normalized = String(target || "").trim().replace(/^@/, "").toLowerCase();
  if (!normalized || /^-?\d+$/.test(normalized)) return null;
  return "telegram:" + normalized;
}

/**
 * Recognises a post this system produced, so the ingestion side never parses
 * our own digests back into "new" offers.
 */
export function shouldSkipParsedTelegramMessage(text) {
  const value = String(text || "");
  if (value.includes(AUTO_MARKER)) return true;
  return value.includes(FOOTER_TEXT);
}

/** Never publish from CI; Railway owns delivery because it holds the volume. */
export function isPublishingEnvironmentAllowed(env = process.env) {
  if (String(env.TELEGRAM_PUBLISH_ENABLED || "").toLowerCase() === "false") {
    return { allowed: false, reason: "TELEGRAM_PUBLISH_ENABLED=false" };
  }
  if (env.GITHUB_ACTIONS) {
    return { allowed: false, reason: "GITHUB_ACTIONS_CANNOT_PUBLISH" };
  }
  if (!String(env.TELEGRAM_BOT_TOKEN || "").trim()) {
    return { allowed: false, reason: "TELEGRAM_BOT_TOKEN_MISSING" };
  }
  return { allowed: true, reason: null };
}

export function filterFlightsForTarget(flights, target) {
  const targetSourceId = sourceIdForTarget(target);
  const list = Array.isArray(flights) ? flights : [];
  if (!targetSourceId) return [...list];
  return list.filter(flight =>
    !Array.isArray(flight.sourceIds) || !flight.sourceIds.includes(targetSourceId)
  );
}

export class TelegramApiError extends Error {
  /**
   * @param {boolean} definitive true when Telegram explicitly rejected the
   *   call, so nothing was delivered and a retry is safe. false when the call
   *   never reported back and delivery is genuinely unknown.
   */
  constructor(message, {
    definitive = true,
    status = null,
    notModified = false,
    retryAfter = null
  } = {}) {
    super(message);
    this.name = "TelegramApiError";
    this.definitive = definitive;
    this.status = status;
    this.notModified = notModified;
    this.retryAfter = retryAfter;
  }

  /** True when the channel itself is unusable, so the run must stop early. */
  get fatalForChannel() {
    return /chat not found|bot was blocked|unauthorized|not enough rights|chat_write_forbidden|bot is not a member|chat_admin_required/i
      .test(String(this.message));
  }
}

export async function telegramApi(token, method, payload, {
  fetchImpl = fetch,
  timeoutMs = 20000
} = {}) {
  let response;
  try {
    response = await fetchImpl("https://api.telegram.org/bot" + token + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    // The request never completed: the message may still have been delivered.
    throw new TelegramApiError(
      "Telegram request failed: " + (error instanceof Error ? error.message : String(error)),
      { definitive: false }
    );
  }

  let result = null;
  let parseError = null;
  try {
    result = await response.json();
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  if (parseError) {
    throw new TelegramApiError(
      "Telegram response could not be read (" + response.status + "): " + parseError,
      { definitive: false, status: response.status }
    );
  }

  if (response.ok && result?.ok) return result.result;

  const description = String(result?.description || "Telegram API " + response.status);
  if (/message is not modified/i.test(description)) {
    throw new TelegramApiError(description, {
      definitive: true,
      status: response.status,
      notModified: true
    });
  }

  // 4xx is an explicit rejection; 5xx leaves delivery unknown.
  const retryAfter = Number(result?.parameters?.retry_after);
  throw new TelegramApiError(description, {
    definitive: response.status < 500,
    status: response.status,
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null
  });
}

function buildReplyMarkup({ managerPhone, publicAppUrl }) {
  const phone = String(managerPhone || "").replace(/\D/g, "");
  if (phone) {
    return {
      inline_keyboard: [[{
        text: "🎫 Купить билет",
        url: "https://wa.me/" + phone + "?text=" + encodeURIComponent(
          "Здравствуйте! Хочу купить билет на чартерный рейс из публикации."
        )
      }]]
    };
  }
  const appUrl = String(publicAppUrl || "").trim();
  if (appUrl) {
    return { inline_keyboard: [[{ text: "✈️ Посмотреть рейсы", url: appUrl }]] };
  }
  return undefined;
}

/** Sends one digest part and returns its Telegram message id. */
export async function sendDigestMessage({
  token,
  chatId,
  text,
  managerPhone,
  publicAppUrl,
  fetchImpl = fetch
}) {
  const result = await telegramApi(token, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: buildReplyMarkup({ managerPhone, publicAppUrl })
  }, { fetchImpl });
  return Number(result?.message_id || 0);
}

/**
 * Edits an existing digest part in place. "Message is not modified" is treated
 * as success because the live post already carries the intended content.
 */
export async function editDigestMessage({
  token,
  chatId,
  messageId,
  text,
  managerPhone,
  publicAppUrl,
  fetchImpl = fetch
}) {
  try {
    const result = await telegramApi(token, "editMessageText", {
      chat_id: chatId,
      message_id: Number(messageId),
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: buildReplyMarkup({ managerPhone, publicAppUrl })
    }, { fetchImpl });
    return Number(result?.message_id || messageId);
  } catch (error) {
    if (error instanceof TelegramApiError && error.notModified) return Number(messageId);
    throw error;
  }
}

export { AUTO_MARKER };
