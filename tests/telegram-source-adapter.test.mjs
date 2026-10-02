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


test("supports KatokPass-style IATA, word dates, thousand prices and baggage", () => {
  const now = new Date("2026-09-16T08:00:00Z");
  assert.deepEqual(parseRouteLine("ALA-AYT"), { from: "Алматы", to: "Анталия", trip: "OW" });
  assert.deepEqual(parseRouteLine("Из Астаны в Хургаду"), { from: "Астана", to: "Хургада", trip: "OW" });

  const offers = parseTelegramPost([
    "SCAT",
    "ALA-AYT",
    "17 сентября — 150 тыс тг",
    "багаж 23+5 кг"
  ].join("\n"), {
    sourceId: "telegram-session:step-to-travel",
    postId: 700,
    postedAt: "2026-09-16T07:00:00Z",
    now
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].departureDate, "2026-09-17");
  assert.equal(offers[0].sourcePrice, 150000);
  assert.equal(offers[0].airline, "SCAT");
});

test("supports split departure and price lines", () => {
  const offers = parseTelegramPost([
    "Шымкент — Шарджа",
    "Вылет: 25.09",
    "Цена: 55 000",
    "без багажа"
  ].join("\n"), {
    sourceId: "telegram-session:step-to-travel",
    postId: 701,
    postedAt: "2026-09-16T07:00:00Z",
    now: new Date("2026-09-16T08:00:00Z")
  });

  assert.equal(offers.length, 1);
  assert.equal(offers[0].departureDate, "2026-09-25");
  assert.equal(offers[0].sourcePrice, 55000);
});


test("normalizes route formats used by NURADEL and AviaTravel", () => {
  assert.deepEqual(parseRouteLine("Almaty - Sharjah"), { from: "Алматы", to: "Шарджа", trip: "OW" });
  assert.deepEqual(parseRouteLine("(Астана -> Нячанг)"), { from: "Астана", to: "Нячанг", trip: "OW" });
  assert.deepEqual(
    parseRouteLine("🇻🇳 Камрань/Нячанг (Вьетнам) ➔ Алматы 🇰🇿 (Econom)"),
    { from: "Нячанг", to: "Алматы", trip: "OW" }
  );
  assert.deepEqual(
    parseRouteLine("*✈️ШЫМКЕНТ → АНТАЛИЯ*"),
    { from: "ШЫМКЕНТ", to: "АНТАЛИЯ", trip: "OW" }
  );
  assert.deepEqual(
    parseRouteLine("АНТАЛИЯ → АСТАНА🔥"),
    { from: "АНТАЛИЯ", to: "АСТАНА", trip: "OW" }
  );
});

test("does not leak an airline from one route into another country", () => {
  const offers = parseTelegramPost([
    "VietJet Air - багаж 20кг + ручная кладь 5кг",
    "Астана -> Нячанг",
    "02.10 - 120 000 ₸",
    "Астана -> Санья",
    "03.10 - 130 000 ₸"
  ].join("\n"), {
    sourceId: "telegram:partner",
    postId: 900,
    postedAt: "2026-10-01T06:00:00Z",
    now: new Date("2026-10-01T07:00:00Z")
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].airline, "VietJet Air");
  assert.equal(offers[1].airline, undefined);
});

test("airline legend after offers does not contaminate the next route", () => {
  const offers = parseTelegramPost([
    "Астана -> Санья",
    "02.10 - 50 000 ₸ (2)",
    "VietJet Air - багаж 20кг + ручная кладь 5кг",
    "Астана -> Шарм-эль-Шейх",
    "03.10 - 91 000 ₸ (1)"
  ].join("\n"), {
    sourceId: "telegram:partner",
    postId: 901,
    postedAt: "2026-10-01T06:00:00Z",
    now: new Date("2026-10-01T07:00:00Z")
  });

  assert.equal(offers.length, 2);
  assert.equal(offers[0].airline, undefined);
  assert.equal(offers[1].airline, undefined);
  assert.equal(offers[0].from, "Астана");
  assert.equal(offers[0].to, "Санья");
  assert.equal(offers[1].to, "Шарм-эль-Шейх");
});


test("parses Step to Travel style carrier codes, notices and baggage legend", () => {
  const now = new Date("2026-10-02T06:00:00Z");
  const text = [
    "🇻🇳Vietnam",
    "",
    "❗️ Arrival Card обязательно❗️",
    "",
    "Astana Phu Quoc",
    "(Астана -> Фукуок)",
    "V 03.10 - 96 000 🔥",
    "* 23.10 - 236 000 (1)",
    "",
    "Phu Quoc Astana",
    "(Фукуок -> Астана)",
    "S 21.10 - 55 000 🔥",
    "",
    "Astana Phu Quoc Astana",
    "(Астана -> Фукуок -> Астана)",
    "-туда обратно 7",
    "V 03.10 - 10.10 = 196 000 (1)🔥",
    "",
    "Sun Phu Quoc Airways - багаж 23 кг + ручная кладь 7 кг",
    "Scat - багаж 23 кг + ручная кладь 5 кг",
    "VietJet Air - багаж 20кг + ручная кладь 5кг",
    "",
    "Цены указаны в KZT",
    "Цены и наличие актуальны на момент публикации"
  ].join("\n");

  const offers = parseTelegramPost(text, {
    sourceId: "telegram:charterticketsme",
    postId: 1001,
    postedAt: "2026-10-02T05:00:00Z",
    now
  });

  assert.equal(offers.length, 4);

  assert.equal(offers[0].from, "Астана");
  assert.equal(offers[0].to, "Фукуок");
  assert.equal(offers[0].airlineCode, "V");
  assert.equal(offers[0].airline, "VietJet Air");
  assert.equal(offers[0].baggage, "багаж 20 кг + ручная кладь 5 кг");
  assert.equal(offers[0].notice, "❗️ Arrival Card обязательно❗️");
  assert.equal(offers[0].hot, true);

  assert.equal(offers[1].airlineCode, "*");
  assert.equal(offers[1].airline, "Sun Phu Quoc Airways");
  assert.equal(offers[1].baggage, "багаж 23 кг + ручная кладь 7 кг");
  assert.equal(offers[1].seats, "1 мест");

  assert.equal(offers[2].from, "Фукуок");
  assert.equal(offers[2].to, "Астана");
  assert.equal(offers[2].airlineCode, "S");
  assert.equal(offers[2].airline, "Scat");
  assert.equal(offers[2].sourcePrice, 55000);

  assert.equal(offers[3].trip, "RT");
  assert.equal(offers[3].airlineCode, "V");
  assert.equal(offers[3].departureDate, "2026-10-03");
  assert.equal(offers[3].returnDate, "2026-10-10");
  assert.equal(offers[3].sourcePrice, 196000);
});
