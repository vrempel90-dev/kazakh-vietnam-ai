import test from "node:test";
import assert from "node:assert/strict";
import { buildDailyIndexDigest, telegramMessageLink } from "../scripts/telegram-daily-index.mjs";

const chatId = "-1002106608923";
const date = "2026-10-29";

test("index links to confirmed posts from exactly the current day", () => {
  const index = buildDailyIndexDigest([
    { country: "TH", countryName: "Таиланд", part: 2, parts: 2, status: "sent", localDate: date, messageId: 102 },
    { country: "VN", countryName: "Вьетнам", part: 1, parts: 1, status: "sent", localDate: date, messageId: 201 },
    { country: "TH", countryName: "Таиланд", part: 1, parts: 2, status: "sent", localDate: date, messageId: 101 },
    { country: "AE", countryName: "ОАЭ", part: 1, status: "pending", localDate: date, messageId: 302 },
    { country: "CN", countryName: "Китай", part: 1, status: "sent", localDate: "2026-10-28", messageId: 401 },
    { country: null, countryName: null, status: "sent", localDate: date, messageId: 501 }
  ], { chatId, localDate: date });
  assert.match(index.text, /ПОДБОРКИ ЧАРТЕРОВ ЗА 29\.10\.2026/);
  assert.match(index.text, /t\.me\/c\/2106608923\/101/);
  assert.match(index.text, /t\.me\/c\/2106608923\/201/);
  assert.doesNotMatch(index.text, /\/102|\/302|\/401|\/501/);
  assert.match(index.text, /дата публикации подборки, не дата вылета/);
  assert.equal((index.text.match(/Таиланд/g) || []).length, 1);
});

test("cannot link without a valid chat, message or confirmed country post", () => {
  assert.equal(telegramMessageLink("@charterforever", 42), "https://t.me/charterforever/42");
  assert.equal(telegramMessageLink("-1002106608923", 42), "https://t.me/c/2106608923/42");
  assert.equal(telegramMessageLink("77000000000", 42), null);
  assert.equal(telegramMessageLink(chatId, -1), null);
  assert.equal(buildDailyIndexDigest([], { chatId, localDate: date }), null);
  assert.equal(buildDailyIndexDigest([
    { country: "TH", status: "unconfirmed", localDate: date, messageId: 55 }
  ], { chatId, localDate: date }), null);
});

test("index is deterministic and changes only when a country link changes", () => {
  const records = [{
    country: "TH", countryName: "Таиланд", status: "sent",
    localDate: date, messageId: 123, part: 1
  }];
  const a = buildDailyIndexDigest(records, { chatId, localDate: date });
  const b = buildDailyIndexDigest([...records], { chatId, localDate: date });
  assert.equal(a.contentHash, b.contentHash);
  const c = buildDailyIndexDigest([{ ...records[0], messageId: 124 }], { chatId, localDate: date });
  assert.notEqual(a.contentHash, c.contentHash);
});

test("traveler can jump straight to a confirmed Almaty departure tomorrow", () => {
  const index = buildDailyIndexDigest([
    {
      country: "TH", countryName: "Таиланд", part: 1, status: "sent",
      localDate: date, messageId: 700, offerIds: ["almaty-phuket"]
    }
  ], {
    chatId, localDate: date,
    flights: [
      { id: "almaty-phuket", from: "Алматы", to: "Пхукет", departureDate: "2026-10-30" },
      { id: "unpublished", from: "Алматы", to: "Пхукет", departureDate: "2026-10-29" },
      { id: "phuket-almaty", from: "Пхукет", to: "Алматы", departureDate: "2026-10-30" }
    ]
  });
  assert.match(index.text, /30\.10: Алматы → Пхукет/);
  assert.match(index.text, /t\.me\/c\/2106608923\/700/);
  assert.doesNotMatch(index.text, /29\.10: Алматы → Пхукет/);
  assert.doesNotMatch(index.text, /Пхукет → Алматы/);
});
