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

test("preserves explicit OW/RT directions and rejects incomplete multi-leg routes", () => {
  assert.deepEqual(parseRouteLine("**RT: 🇰🇿 Алматы → Пхукет 🇹🇭**"), { from: "Алматы", to: "Пхукет", trip: "RT" });
  assert.deepEqual(parseRouteLine("OW Пхукет → Алматы"), { from: "Пхукет", to: "Алматы", trip: "OW" });
  assert.deepEqual(parseRouteLine("Алматы ↔ Пхукет"), { from: "Алматы", to: "Пхукет", trip: "RT" });
  assert.deepEqual(parseRouteLine("ala-hkt"), { from: "Алматы", to: "Пхукет", trip: "OW" });
  assert.equal(parseRouteLine("Алматы → Пхукет → Дубай"), null);
  assert.equal(parseRouteLine("Алматы → 🇰🇿 Алматы"), null);
  const offers = parseTelegramPost("Алматы → Пхукет\n02.10 — 90 000 ₸\nАлматы → Пхукет → Дубай\n03.10 — 95 000 ₸", {
    sourceId: "telegram:partner", now: new Date("2026-10-01T00:00:00Z")
  });
  assert.equal(offers.length, 1, "unsupported headers must not assign a price to the preceding route");
});

test("keeps KZT offers alongside foreign-currency adverts without guessing conversion", () => {
  const offers = parseTelegramPost([
    "Алматы → Дубай", "02.10 — 90 000 ₸", "03.10 — 30 000 руб",
    "04.10 — 150 тыс USD", "Экскурсии от $50", "05.10 — 99,5 тыс тг"
  ].join("\n"), { sourceId: "telegram:partner", now: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual(offers.map(offer => [offer.departureDate, offer.sourcePrice]), [
    ["2026-10-02", 90000], ["2026-10-05", 99500]
  ]);
  assert.equal(parseOfferLine("02.10 — 90 000 рублей", new Date("2026-10-01T00:00:00Z")), null);
});

test("does not revive stale yearless dates and supports exact calendar rollover", () => {
  assert.deepEqual(parseTelegramPost("Алматы → Пхукет\n01.08 — 90 000 ₸", {
    sourceId: "telegram:partner", now: new Date("2026-10-01T00:00:00Z")
  }), []);
  const now = new Date("2026-12-28T00:00:00Z");
  assert.equal(parseOfferLine("29.12 → 05.01 — 190 000 ₸", now).returnDate, "2027-01-05");
  assert.equal(parseOfferLine("03.01 — 90 000 ₸", now).departureDate, "2027-01-03");
  assert.equal(parseOfferLine("17 сентября 2027 — 90 000 ₸", now).departureDate, "2027-09-17");
  assert.equal(parseOfferLine("2027-01-03 — 90 000 ₸", now).departureDate, "2027-01-03");
});

test("rejects invalid or ambiguous RT dates instead of degrading to OW", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  for (const line of ["28.09 → 31.11 — 90 000 ₸", "31-05.09 — 90 000 ₸", "28.09 → 27.09 — 90 000 ₸", "28.09 на 8-10 ночей — 90 000 ₸"]) {
    assert.equal(parseOfferLine(line, now), null, line);
  }
  const offers = parseTelegramPost("Алматы → Пхукет\nВылет: 28.09\n31.11 — 90 000 ₸\nЦена: 95 000", { sourceId: "telegram:partner", now });
  assert.deepEqual(offers, [], "invalid dates clear pending split-line state");
});

test("supports inline routes, multiple departure dates and split return dates", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const inline = parseTelegramPost("🇰🇿 Алматы → Dubai 🇦🇪 02.10 — 90 000 ₸\n03.10, 05.10 — 95 000 ₸", { sourceId: "telegram:partner", now });
  assert.deepEqual(inline.map(offer => [offer.to, offer.departureDate]), [
    ["Дубай", "2026-10-02"], ["Дубай", "2026-10-03"], ["Дубай", "2026-10-05"]
  ]);
  const split = parseTelegramPost("Алматы → Пхукет\nТуда и обратно\nВылет: 02.10\nВозврат: 09.10\nЦена: 190 000", { sourceId: "telegram:partner", now });
  assert.equal(split[0].trip, "RT");
  assert.equal(split[0].returnDate, "2026-10-09");
});

test("scopes airline, baggage and explicit physical flight metadata to their route block", () => {
  const offers = parseTelegramPost([
    "SCAT", "Алматы → Пхукет", "Вылет: 02.10 09:30", "Цена: 90 000 ₸",
    "Рейс: DV 1234", "багаж 23+5 кг", "Air Astana",
    "Пхукет → Алматы", "03.10 — 95 000 ₸", "09:30 23+5 кг"
  ].join("\n"), { sourceId: "telegram:partner", now: new Date("2026-10-01T00:00:00Z") });
  assert.equal(offers[0].airline, "Air Astana");
  assert.equal(offers[0].baggage, "23 + 5 кг");
  assert.equal(offers[0].departureTime, "09:30");
  assert.equal(offers[0].flightNumber, "DV1234");
  assert.equal(offers[1].airline, "SCAT", "route-local override must not leak into following route");
  assert.equal(offers[1].departureTime, undefined, "unlabelled time is not guessed");
  assert.equal(offers[1].flightNumber, undefined);
});

test("decodes supplementary Unicode entities without corrupting route flags", () => {
  const posts = extractPublicTelegramPosts('<div class="tgme_widget_message_text">&#x1F1F0;&#x1F1FF; Алматы → Пхукет &lt;info&gt;<br>02.10 — 90 000 ₸</div>');
  assert.ok(posts[0].text.startsWith("🇰🇿 Алматы"));
  assert.ok(posts[0].text.includes("<info>"));
});

test("extracts complete nested message text with reordered classes and quoted attributes", () => {
  const html = `<div id='wrap' class='js-widget_message_wrap tgme_widget_message_wrap'>
    <div data-post='partner/123'><div class='js-message_text tgme_widget_message_text'>
    Алматы → Пхукет<div><b>02.10 — 90 000 ₸</b></div><br>03.10 — 95 000 ₸</div>
    <time datetime='2026-10-01T05:00:00Z'></time></div></div>`;
  const posts = extractPublicTelegramPosts(html);
  assert.equal(posts[0].id, 123);
  assert.equal(posts[0].postedAt, "2026-10-01T05:00:00Z");
  assert.ok(posts[0].text.includes("03.10 — 95 000 ₸"));
  assert.equal(parseTelegramPost(posts[0].text, { sourceId: "telegram:partner", now: new Date("2026-10-01T06:00:00Z") }).length, 2);
});

test("skips undated, stale and invalid-timestamp public posts", async () => {
  const dated = stamp => `<div class="tgme_widget_message_wrap"><div data-post="partner/${stamp ? stamp.length : 0}"><div class="tgme_widget_message_text">Алматы → Пхукет<br>02.10 — 90 000 ₸</div>${stamp ? `<time datetime="${stamp}"></time>` : ""}</div></div>`;
  const result = await fetchTelegramSourceOffers({
    source: sourceFromHandle("partner"), now: new Date("2026-10-01T06:00:00Z"), ttlHours: 24, maxPages: 1,
    fetchImpl: async () => new Response(dated(null) + dated("invalid") + dated("2026-09-20T05:00:00Z"), { status: 200 })
  });
  assert.deepEqual(result.offers, []);
  assert.equal(result.status.skippedUndated, 2);
  assert.equal(result.status.skippedOld, 3);
});

test("filters departed calendar days using Almaty midnight, including year rollover", () => {
  const offers = parseTelegramPost("Алматы → Пхукет\n01.10 — 90 000 ₸\n02.10 — 95 000 ₸", {
    sourceId: "telegram:partner", now: new Date("2026-09-30T19:01:00Z")
  });
  assert.deepEqual(offers.map(offer => offer.departureDate), ["2026-10-02"]);
  const january = parseTelegramPost("Алматы → Пхукет\n01.01 — 90 000 ₸\n02.01 — 95 000 ₸", {
    sourceId: "telegram:partner", now: new Date("2026-12-31T19:01:00Z")
  });
  assert.deepEqual(january.map(offer => offer.departureDate), ["2027-01-02"]);
});

test("does not import explicit zero-seat and sold-out offers", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  for (const text of ["02.10 — 90 000 ₸ (0)", "02.10 — 90 000 ₸ мест нет", "02.10 — 90 000 ₸ sold out"]) {
    assert.equal(parseOfferLine(text, now), null);
  }
  const offers = parseTelegramPost("Алматы → Пхукет\nВылет: 02.10\nЦена: 90 000 ₸ мест нет\n03.10 — 95 000 ₸", { sourceId: "telegram:partner", now });
  assert.deepEqual(offers.map(offer => offer.departureDate), ["2026-10-03"]);
});

test("continues pagination through image-only posts and stops repeated cursors", async () => {
  const image = `<div class="tgme_widget_message_wrap"><div data-post="partner/200"><div class="tgme_widget_message_photo"></div><time datetime="2026-10-01T05:00:00Z"></time></div></div>`;
  const offer = `<div class="tgme_widget_message_wrap"><div data-post="partner/199"><div class="tgme_widget_message_text">Алматы → Пхукет<br>02.10 — 90 000 ₸</div><time datetime="2026-10-01T04:00:00Z"></time></div></div>`;
  const urls = [];
  const result = await fetchTelegramSourceOffers({
    source: sourceFromHandle("partner"), now: new Date("2026-10-01T06:00:00Z"), maxPages: 6,
    fetchImpl: async url => {
      urls.push(url);
      return new Response(url.includes("before=") ? offer : image, { status: 200 });
    }
  });
  assert.equal(result.offers.length, 1);
  assert.deepEqual(urls, ["https://t.me/s/partner", "https://t.me/s/partner?before=200", "https://t.me/s/partner?before=199"]);
  assert.equal(result.status.pages, 3);
});

test("fresh snapshots reflect edited prices and source message deletion", async () => {
  const html = price => `<div class="tgme_widget_message_wrap"><div data-post="partner/200"><div class="tgme_widget_message_text">Алматы → Пхукет<br>02.10 — ${price} ₸</div><time datetime="2026-10-01T05:00:00Z"></time></div></div>`;
  const snapshot = value => fetchTelegramSourceOffers({
    source: sourceFromHandle("partner"), now: new Date("2026-10-01T06:00:00Z"), maxPages: 1,
    fetchImpl: async () => new Response(value, { status: 200 })
  });
  const before = await snapshot(html(90000));
  const edited = await snapshot(html(95000));
  assert.equal(edited.offers[0].sourcePrice, 95000);
  assert.equal(before.offers[0].externalId, edited.offers[0].externalId);
  assert.deepEqual((await snapshot("<html><body></body></html>")).offers, []);
});

test("canonicalizes explicit carrier aliases for cross-source physical flight identity", () => {
  for (const [carrier, expected] of [["Эйр Астана", "Air Astana"], ["Вьетжет Эйр", "VietJet Air"], ["а/к: СКАТ", "SCAT"]]) {
    const offers = parseTelegramPost(`${carrier}\nАлматы → Пхукет\n02.10 — 90 000 ₸`, {
      sourceId: "telegram:partner", now: new Date("2026-10-01T00:00:00Z")
    });
    assert.equal(offers[0].airline, expected);
  }
});

test("does not rewrite previously parsed flight identity from a subsequent dated row", () => {
  const offers = parseTelegramPost("Алматы → Пхукет\nВылет: 02.10 09:30 рейс DV1234\nЦена: 90 000 ₸\nВылет: 02.10 16:30 рейс KC5678\nЦена: 95 000 ₸\n03.10 — 99 000 ₸", {
    sourceId: "telegram:partner", now: new Date("2026-10-01T00:00:00Z")
  });
  assert.deepEqual(offers.map(offer => [offer.departureTime, offer.flightNumber]), [["09:30", "DV1234"], ["16:30", "KC5678"], [undefined, undefined]]);
});
