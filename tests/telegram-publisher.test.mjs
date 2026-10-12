import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_MARKER,
  TelegramApiError,
  editDigestMessage,
  filterFlightsForTarget,
  isPublishingEnvironmentAllowed,
  parsePublishTargets,
  sendDigestMessage,
  shouldSkipParsedTelegramMessage,
  sourceIdForTarget,
  telegramApi
} from "../scripts/telegram-publisher.mjs";
import { FOOTER_TEXT } from "../scripts/telegram-digest.mjs";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

test("publication targets are normalised and de-duplicated", () => {
  assert.deepEqual(
    parsePublishTargets("charterkaz,@charter_forever_travel, -1002106608923 ,charterkaz"),
    ["@charterkaz", "@charter_forever_travel", "-1002106608923"]
  );
  assert.deepEqual(
    parsePublishTargets(""),
    ["-1002106608923", "-1002285584868"],
    "an empty configuration falls back to the known channels"
  );
});

test("a channel is never fed offers that came from itself", () => {
  const flights = [
    { id: "a", sourceIds: ["telegram:charterkaz"] },
    { id: "b", sourceIds: ["telegram:partner"] },
    { id: "c" }
  ];
  assert.equal(sourceIdForTarget("@charterkaz"), "telegram:charterkaz");
  assert.equal(sourceIdForTarget("-1002106608923"), null);
  assert.deepEqual(
    filterFlightsForTarget(flights, "@charterkaz").map(f => f.id),
    ["b", "c"]
  );
  assert.equal(filterFlightsForTarget(flights, "-1002106608923").length, 3);
});

test("our own published digests are recognised and not parsed back as new offers", () => {
  assert.equal(shouldSkipParsedTelegramMessage("Подборка\n\n" + FOOTER_TEXT), true);
  assert.equal(shouldSkipParsedTelegramMessage("legacy " + AUTO_MARKER), true);
  assert.equal(shouldSkipParsedTelegramMessage("Алматы - Нячанг\n21.10 - 96 000 ₸"), false);
});

test("CI and a missing token are refused; Railway with a token is allowed", () => {
  assert.deepEqual(
    isPublishingEnvironmentAllowed({ TELEGRAM_BOT_TOKEN: "1:x" }),
    { allowed: true, reason: null }
  );
  assert.equal(
    isPublishingEnvironmentAllowed({ TELEGRAM_BOT_TOKEN: "1:x", GITHUB_ACTIONS: "true" }).reason,
    "GITHUB_ACTIONS_CANNOT_PUBLISH"
  );
  assert.equal(
    isPublishingEnvironmentAllowed({ TELEGRAM_BOT_TOKEN: "1:x", TELEGRAM_PUBLISH_ENABLED: "false" }).reason,
    "TELEGRAM_PUBLISH_ENABLED=false"
  );
  assert.equal(
    isPublishingEnvironmentAllowed({}).reason,
    "TELEGRAM_BOT_TOKEN_MISSING"
  );
});

test("sendMessage posts HTML with a preview-free body and a buy button", async () => {
  const calls = [];
  const messageId = await sendDigestMessage({
    token: "1:test",
    chatId: "@channel",
    text: "🇻🇳 ВЬЕТНАМ",
    managerPhone: "+7 700 777 24 14",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return jsonResponse({ ok: true, result: { message_id: 321 } });
    }
  });

  assert.equal(messageId, 321);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/sendMessage"));
  assert.equal(calls[0].body.chat_id, "@channel");
  assert.equal(calls[0].body.parse_mode, "HTML");
  assert.equal(calls[0].body.disable_web_page_preview, true);
  assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].text, "🎫 Купить билет");
  assert.ok(calls[0].body.reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/77007772414?text="));
});

test("editMessageText updates a live post in place", async () => {
  const calls = [];
  const messageId = await editDigestMessage({
    token: "1:test",
    chatId: "@channel",
    messageId: 555,
    text: "updated",
    publicAppUrl: "https://example.com",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return jsonResponse({ ok: true, result: { message_id: 555 } });
    }
  });

  assert.equal(messageId, 555);
  assert.ok(calls[0].url.endsWith("/editMessageText"));
  assert.equal(calls[0].body.message_id, 555);
  assert.equal(calls[0].body.reply_markup.inline_keyboard[0][0].text, "✈️ Посмотреть рейсы");
});

test("\"message is not modified\" counts as a successful edit", async () => {
  const messageId = await editDigestMessage({
    token: "1:test",
    chatId: "@channel",
    messageId: 555,
    text: "same",
    fetchImpl: async () => jsonResponse({
      ok: false,
      description: "Bad Request: message is not modified"
    }, 400)
  });
  assert.equal(messageId, 555);
});

test("a 4xx rejection is definitive; a timeout or 5xx leaves delivery unknown", async () => {
  await assert.rejects(
    () => telegramApi("1:test", "sendMessage", {}, {
      fetchImpl: async () => jsonResponse({ ok: false, description: "Bad Request: chat not found" }, 400)
    }),
    error => {
      assert.ok(error instanceof TelegramApiError);
      assert.equal(error.definitive, true, "Telegram rejected it, so nothing was delivered");
      assert.equal(error.fatalForChannel, true, "a missing chat must stop the channel");
      return true;
    }
  );

  await assert.rejects(
    () => telegramApi("1:test", "sendMessage", {}, {
      fetchImpl: async () => { throw new Error("network down"); }
    }),
    error => {
      assert.equal(error.definitive, false, "the call never reported back");
      return true;
    }
  );

  await assert.rejects(
    () => telegramApi("1:test", "sendMessage", {}, {
      fetchImpl: async () => jsonResponse({ ok: false, description: "Internal Server Error" }, 500)
    }),
    error => {
      assert.equal(error.definitive, false);
      return true;
    }
  );
});

test("a rate limit reports its retry delay and is not fatal for the channel", async () => {
  await assert.rejects(
    () => telegramApi("1:test", "sendMessage", {}, {
      fetchImpl: async () => jsonResponse({
        ok: false,
        description: "Too Many Requests: retry after 7",
        parameters: { retry_after: 7 }
      }, 429)
    }),
    error => {
      assert.equal(error.retryAfter, 7);
      assert.equal(error.definitive, true);
      assert.equal(error.fatalForChannel, false);
      return true;
    }
  );
});

test("an unreadable response body is treated as unknown delivery", async () => {
  await assert.rejects(
    () => telegramApi("1:test", "sendMessage", {}, {
      fetchImpl: async () => new Response("<html>502</html>", { status: 502 })
    }),
    error => {
      assert.equal(error.definitive, false);
      return true;
    }
  );
});
