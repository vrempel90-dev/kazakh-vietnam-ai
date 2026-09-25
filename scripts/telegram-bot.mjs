import { parseAdminTelegramIds } from "./telegram-admin-auth.mjs";
const DEFAULT_MANAGER_PHONE = "77007772414";

export function normalizePublicUrl(value) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
}

export function buildTelegramHomeKeyboard(publicAppUrl, managerPhone = DEFAULT_MANAGER_PHONE) {
  const appUrl = normalizePublicUrl(publicAppUrl);
  const phone = String(managerPhone || DEFAULT_MANAGER_PHONE).replace(/\D/g, "");
  return {
    inline_keyboard: [
      [{ text: "✈️ Открыть авиабилеты", web_app: { url: appUrl } }],
      [{ text: "💬 Написать менеджеру", url: "https://wa.me/" + phone }]
    ]
  };
}

export function parseTelegramCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return null;
  return raw.split(/\s+/)[0].split("@")[0].toLowerCase();
}

export function createTelegramRuntime({
  token,
  publicAppUrl,
  webhookSecret,
  managerPhone = DEFAULT_MANAGER_PHONE,
  adminTelegramIds = "",
  fetchImpl = fetch
}) {
  const botToken = String(token || "").trim();
  const appUrl = normalizePublicUrl(publicAppUrl);
  const secret = String(webhookSecret || "").trim();
  const manager = String(managerPhone || DEFAULT_MANAGER_PHONE).replace(/\D/g, "");
  const adminIds = parseAdminTelegramIds(adminTelegramIds);
  const base = botToken ? "https://api.telegram.org/bot" + botToken + "/" : "";

  const status = {
    enabled: Boolean(botToken && appUrl && secret),
    configured: false,
    username: null,
    lastConfiguredAt: null,
    lastError: null
  };

  async function api(method, payload = {}) {
    if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    const response = await fetchImpl(base + method, {
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

  function isWebhookAuthorized(value) {
    if (!secret) return false;
    return String(value || "") === secret;
  }

  async function sendHome(chatId, firstName = "") {
    const hello = firstName ? ", " + firstName : "";
    return api("sendMessage", {
      chat_id: chatId,
      text:
        "Здравствуйте" + hello + "! ✈️\n\n" +
        "Здесь собраны актуальные чартерные авиабилеты. " +
        "Откройте приложение, выберите направление и рейс — после этого можно сразу написать менеджеру для оформления.\n\n" +
        "Цена и наличие перепроверяются перед оформлением.",
      reply_markup: buildTelegramHomeKeyboard(appUrl, manager)
    });
  }

  async function handleUpdate(update) {
    const message = update?.message;
    if (!message?.chat?.id) return;
    const chatId = message.chat.id;
    const command = parseTelegramCommand(message.text);
    const firstName = String(message.from?.first_name || "").trim();

    if (command === "/start" || command === "/flights" || command === "/menu") {
      await sendHome(chatId, firstName);
      return;
    }

    if (command === "/admin") {
      const userId = String(message.from?.id || "");
      const isPrivate = message.chat?.type === "private" || !message.chat?.type;
      if (!isPrivate) {
        await api("sendMessage", {
          chat_id: chatId,
          text: "Админ-панель доступна только в личном чате с ботом."
        });
        return;
      }
      if (!adminIds.has(userId)) {
        await api("sendMessage", {
          chat_id: chatId,
          text:
            "Доступ к админ-панели запрещён.\n\n" +
            "Ваш Telegram ID: " + userId
        });
        return;
      }
      await api("sendMessage", {
        chat_id: chatId,
        text: "⚙️ Админ-панель\n\nУправление рейсами, синхронизацией и наценками.",
        reply_markup: {
          inline_keyboard: [[{
            text: "Открыть админ-панель",
            web_app: { url: appUrl + "/?admin=1" }
          }]]
        }
      });
      return;
    }

    if (command === "/help") {
      await api("sendMessage", {
        chat_id: chatId,
        text:
          "Нажмите «Открыть авиабилеты», чтобы посмотреть актуальные рейсы. " +
          "В карточке выбранного рейса есть кнопка WhatsApp для связи с менеджером.",
        reply_markup: buildTelegramHomeKeyboard(appUrl, manager)
      });
      return;
    }

    await api("sendMessage", {
      chat_id: chatId,
      text: "Для поиска чартерных рейсов откройте приложение 👇",
      reply_markup: buildTelegramHomeKeyboard(appUrl, manager)
    });
  }

  async function configure() {
    if (!status.enabled) {
      status.lastError = "Telegram integration is missing token, public URL, or webhook secret";
      return status;
    }
    try {
      const me = await api("getMe");
      status.username = me?.username || null;

      await Promise.all([
        api("setMyCommands", {
          commands: [
            { command: "start", description: "Открыть чартерные авиабилеты" },
            { command: "flights", description: "Актуальные рейсы" },
            { command: "menu", description: "Главное меню" },
            { command: "admin", description: "Админ-панель" },
            { command: "help", description: "Помощь" }
          ]
        }),
        api("setMyDescription", {
          description:
            "Актуальные чартерные авиабилеты. Выберите рейс в Mini App и свяжитесь с менеджером для оформления."
        }),
        api("setMyShortDescription", {
          short_description: "Актуальные чартерные рейсы и связь с менеджером ✈️"
        }),
        api("setChatMenuButton", {
          menu_button: {
            type: "web_app",
            text: "Запустить приложение",
            web_app: { url: appUrl }
          }
        })
      ]);

      await api("setWebhook", {
        url: appUrl + "/api/telegram/webhook",
        secret_token: secret,
        allowed_updates: ["message"],
        drop_pending_updates: false
      });

      status.configured = true;
      status.lastConfiguredAt = new Date().toISOString();
      status.lastError = null;
    } catch (error) {
      status.configured = false;
      status.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
    return status;
  }

  return {
    status,
    api,
    configure,
    handleUpdate,
    isWebhookAuthorized,
    isAdminUser: userId => adminIds.has(String(userId || ""))
  };
}
