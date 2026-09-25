import assert from "node:assert/strict";
import {
  buildTelegramHomeKeyboard,
  createTelegramRuntime,
  normalizePublicUrl,
  parseTelegramCommand
} from "../scripts/telegram-bot.mjs";

assert.equal(normalizePublicUrl("charter-app-production-6bf5.up.railway.app"), "https://charter-app-production-6bf5.up.railway.app");
assert.equal(parseTelegramCommand("/start abc"), "/start");
assert.equal(parseTelegramCommand("/menu@charter_bot"), "/menu");
assert.equal(parseTelegramCommand("hello"), null);

const keyboard = buildTelegramHomeKeyboard("https://example.com/", "+7 700 777 24 14");
assert.equal(keyboard.inline_keyboard[0][0].web_app.url, "https://example.com");
assert.equal(keyboard.inline_keyboard[1][0].url, "https://wa.me/77007772414");

const calls = [];
const fakeFetch = async (url, options) => {
  const method = String(url).split("/").pop();
  const payload = JSON.parse(options.body || "{}");
  calls.push({ method, payload });
  const result = method === "getMe"
    ? { id: 1, is_bot: true, first_name: "Charter", username: "charter_test_bot" }
    : true;
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const runtime = createTelegramRuntime({
  token: "123:test",
  publicAppUrl: "https://example.com",
  webhookSecret: "secret-123",
  managerPhone: "77007772414",
  fetchImpl: fakeFetch
});

assert.equal(runtime.status.enabled, true);
assert.equal(runtime.isWebhookAuthorized("secret-123"), true);
assert.equal(runtime.isWebhookAuthorized("wrong"), false);

await runtime.configure();
assert.equal(runtime.status.configured, true);
assert.equal(runtime.status.username, "charter_test_bot");
assert.ok(calls.some(call => call.method === "setMyCommands"));
assert.ok(calls.some(call => call.method === "setMyDescription"));
assert.ok(calls.some(call => call.method === "setMyShortDescription"));
assert.ok(calls.some(call => call.method === "setChatMenuButton"));
const webhookCall = calls.find(call => call.method === "setWebhook");
assert.equal(webhookCall.payload.url, "https://example.com/api/telegram/webhook");
assert.equal(webhookCall.payload.secret_token, "secret-123");

await runtime.handleUpdate({
  message: {
    chat: { id: 42 },
    from: { first_name: "Ирина" },
    text: "/start"
  }
});
const startMessage = calls.filter(call => call.method === "sendMessage").at(-1);
assert.equal(startMessage.payload.chat_id, 42);
assert.ok(startMessage.payload.text.includes("Ирина"));
assert.equal(startMessage.payload.reply_markup.inline_keyboard[0][0].web_app.url, "https://example.com");

console.log("Telegram runtime commands, webhook, menu button, and Mini App keyboard: passed");
