import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPublicTelegramPosts,
  parseOfferLine,
  parseRouteLine,
  parseTelegramPost,
  parseTelegramSourceList,
  sourceFromHandle,
  fetchTelegramSourceOffers
} from "../scripts/telegram-source-adapter.mjs";

test("parses configured Telegram source handles", () => {
  assert.deepEqual(
    parseTelegramSourceList("@foo, https://t.me/bar,foo"),
    ["foo", "bar"]
  );
  assert.equal(sourceFromHandle("@foo").url, "https://t.me/s/foo");
});

test("parses common route formats", () => {
  assert.deepEqual(parseRouteLine("✈️ Алматы — Нячанг"), { from: "Алматы", to: "Нячанг", trip: "OW" });
  assert.deepEqual(parseRouteLine("Алматы → Нячанг → Алматы"), { from: "Алматы", to: "Нячанг", trip: "RT" });
  assert.deepEqual(parseRouteLine("Астана -> Шарм-эль-Шейх"), { from: "Астана", to: "Шарм-эль-Шейх", trip: "OW" });
});

test("parses single, ranged and nights price lines", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  assert.deepEqual(
    parseOfferLine("28.09 — 99 000 ₸ (4) 🔥", now),
    { departureDate: "2026-09-28", returnDate: null, price: 99000, hot: true, seats: "4 мест" }
  );
  assert.deepEqual(
    parseOfferLine("29.09 - 06.10 = 284 000 (1)", now),
    { departureDate: "2026-09-29", returnDate: "2026-10-06", price: 284000, hot: false, seats: "1 мест" }
  );
  assert.deepEqual(
    parseOfferLine("28.09 на 8 ночей = 164 000 ₸", now),
    { departureDate: "2026-09-28", returnDate: "2026-10-06", price: 164000, hot: false, seats: "Наличие уточняется" }
  );
});

test("parses a multi-route supplier post", () => {
  const offers = parseTelegramPost([
    "Вьетнам 🇻🇳",
    "SCAT",
    "Астана → Нячанг",
    "28.09 — 62 000 тенге 🔥",
    "Астана → Нячанг → Астана",
    "28.09 → 05.10 — 192 000 тенге (6)",
    "Алматы → Нячанг",
    "29.09 — 90 000 тенге (3)"
  ].join("\n"), {
    sourceId: "telegram:partner",
    postId: 123,
    postedAt: "2026-09-27T05:00:00Z",
    now: new Date("2026-09-27T06:00:00Z")
  });

  assert.equal(offers.length, 3);
  assert.equal(offers[0].sourcePrice, 62000);
  assert.equal(offers[0].airline, "SCAT");
  assert.equal(offers[1].trip, "RT");
  assert.equal(offers[1].returnDate, "2026-10-05");
  assert.equal(offers[2].seats, "3 мест");
});

test("extracts public Telegram post metadata and obeys TTL/auto marker", async () => {
  const html = `
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message" data-post="partner/101">
      <div class="tgme_widget_message_text js-message_text">Алматы → Нячанг<br>28.09 — 90 000 ₸</div>
      <time datetime="2026-09-27T05:00:00+00:00"></time>
    </div>
  </div>
  <div class="tgme_widget_message_wrap js-widget_message_wrap">
    <div class="tgme_widget_message" data-post="partner/100">
      <div class="tgme_widget_message_text js-message_text">🤖 Автообновление<br>Алматы → Нячанг<br>29.09 — 91 000 ₸</div>
      <time datetime="2026-09-27T04:00:00+00:00"></time>
    </div>
  </div>`;

  const extracted = extractPublicTelegramPosts(html);
  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].id, 101);

  const result = await fetchTelegramSourceOffers({
    source: sourceFromHandle("partner"),
    now: new Date("2026-09-27T06:00:00Z"),
    ttlHours: 24,
    maxPages: 1,
    fetchImpl: async () => new Response(html, { status: 200 }),
    shouldSkipText: text => text.includes("🤖 Автообновление")
  });

  assert.equal(result.offers.length, 1);
  assert.equal(result.status.skippedAuto, 1);
  assert.equal(result.offers[0].sourcePrice, 90000);
});
