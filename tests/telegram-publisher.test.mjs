import assert from "node:assert/strict";
import {
  AUTO_MARKER,
  buildFlightPosts,
  countryForFlight,
  filterFlightsForTarget,
  parsePublishTargets,
  publishFreshFlights,
  shouldSkipParsedTelegramMessage,
  telegramPublicationWindowStatus
} from "../scripts/telegram-publisher.mjs";

const vietnamFlights = [
  {
    id: "out-v-1",
    from: "Астана",
    to: "Фукуок",
    price: 96000,
    trip: "OW",
    airline: "VietJet Air",
    airlineCode: "V",
    baggage: "багаж 20 кг + ручная кладь 5 кг",
    seats: "Наличие уточняется",
    departureDate: "2026-10-03",
    hot: true,
    notice: "❗️ Arrival Card обязательно❗️",
    sourceIds: ["telegram:charterkaz"]
  },
  {
    id: "out-star-1",
    from: "Астана",
    to: "Фукуок",
    price: 236000,
    trip: "OW",
    airline: "Sun Phu Quoc Airways",
    airlineCode: "*",
    baggage: "багаж 23 кг + ручная кладь 7 кг",
    seats: "1 место",
    departureDate: "2026-10-23",
    sourceIds: ["telegram:partner"]
  },
  {
    id: "return-v-1",
    from: "Фукуок",
    to: "Астана",
    price: 50000,
    trip: "OW",
    airline: "VietJet Air",
    airlineCode: "V",
    baggage: "багаж 20 кг + ручная кладь 5 кг",
    seats: "Наличие уточняется",
    departureDate: "2026-10-07",
    hot: true,
    sourceIds: ["telegram:partner"]
  },
  {
    id: "return-s-1",
    from: "Фукуок",
    to: "Астана",
    price: 55000,
    trip: "OW",
    airline: "Scat",
    airlineCode: "S",
    baggage: "багаж 23 кг + ручная кладь 5 кг",
    seats: "Наличие уточняется",
    departureDate: "2026-10-21",
    hot: true,
    sourceIds: ["telegram:partner"]
  },
  {
    id: "rt-v-oct",
    from: "Астана",
    to: "Фукуок",
    price: 196000,
    trip: "RT",
    airline: "VietJet Air",
    airlineCode: "V",
    baggage: "багаж 20 кг + ручная кладь 5 кг",
    seats: "1 место",
    departureDate: "2026-10-03",
    returnDate: "2026-10-10",
    hot: true,
    sourceIds: ["telegram:partner"]
  },
  {
    id: "rt-v-nov",
    from: "Астана",
    to: "Фукуок",
    price: 378000,
    trip: "RT",
    airline: "VietJet Air",
    airlineCode: "V",
    baggage: "багаж 20 кг + ручная кладь 5 кг",
    seats: "Наличие уточняется",
    departureDate: "2026-11-02",
    returnDate: "2026-11-09",
    sourceIds: ["telegram:partner"]
  },
  {
    id: "rt-s-nov",
    from: "Астана",
    to: "Фукуок",
    price: 330000,
    trip: "RT",
    airline: "Scat",
    airlineCode: "S",
    baggage: "багаж 23 кг + ручная кладь 5 кг",
    seats: "9 мест",
    departureDate: "2026-11-03",
    returnDate: "2026-11-10",
    sourceIds: ["telegram:partner"]
  },
  {
    id: "rt-s-dec",
    from: "Астана",
    to: "Фукуок",
    price: 328000,
    trip: "RT",
    airline: "Scat",
    airlineCode: "S",
    baggage: "багаж 23 кг + ручная кладь 5 кг",
    seats: "Наличие уточняется",
    departureDate: "2026-12-01",
    returnDate: "2026-12-08",
    sourceIds: ["telegram:partner"]
  }
];

assert.deepEqual(
  parsePublishTargets("charterkaz,@charter_forever_travel"),
  ["@charterkaz", "@charter_forever_travel"]
);
assert.equal(shouldSkipParsedTelegramMessage("test " + AUTO_MARKER), true);
assert.equal(shouldSkipParsedTelegramMessage("manual post"), false);

assert.deepEqual(countryForFlight(vietnamFlights[0]), { name: "Вьетнам", flag: "🇻🇳" });
assert.deepEqual(countryForFlight({ from: "Астана", to: "Аланья" }), { name: "Турция", flag: "🇹🇷" });

const posts = buildFlightPosts(vietnamFlights);
assert.equal(posts.length, 1, "Vietnam must be published as one country digest when it fits Telegram");
const post = posts[0];

assert.ok(post.startsWith("🇻🇳Vietnam\n\n❗️ Arrival Card обязательно❗️"));
assert.ok(post.includes("Astana Phu Quoc\n(Астана -> Фукуок)"));
assert.ok(post.includes("V 03.10 - 96 000 🔥"));
assert.ok(post.includes("* 23.10 - 236 000 (1)"));
assert.ok(post.includes("Phu Quoc Astana\n(Фукуок -> Астана)"));
assert.ok(post.includes("V 07.10 - 50 000 🔥"));
assert.ok(post.includes("S 21.10 - 55 000 🔥"));
assert.ok(post.includes("Astana Phu Quoc Astana\n(Астана -> Фукуок -> Астана)\n  -туда обратно 7"));
assert.ok(post.includes("V 03.10 - 10.10 = 196 000 (1) 🔥"));
assert.ok(post.includes("(ноябрь)\nV 02.11 - 09.11 = 378 000"));
assert.ok(post.includes("S 03.11 - 10.11 = 330 000 (9)"));
assert.ok(post.includes("(декабрь)\nS 01.12 - 08.12 = 328 000"));
assert.ok(post.includes("Sun Phu Quoc Airways - багаж 23 кг + ручная кладь 7 кг"));
assert.ok(post.includes("Scat - багаж 23 кг + ручная кладь 5 кг"));
assert.ok(post.includes("VietJet Air - багаж 20 кг + ручная кладь 5 кг"));
assert.ok(post.endsWith("Цены указаны в KZT\nЦены и наличие актуальны на момент публикации"));
assert.ok(!post.includes("Билеты туда"));
assert.ok(!post.includes("Обратные билеты"));
assert.ok(!post.includes(AUTO_MARKER));

const mixedCountries = buildFlightPosts([
  ...vietnamFlights,
  {
    id: "thai-1",
    from: "Алматы",
    to: "Пхукет",
    price: 99000,
    trip: "OW",
    airline: "Air Astana",
    airlineCode: "A",
    baggage: "багаж 23 кг + ручная кладь 8 кг",
    seats: "2 места",
    departureDate: "2026-10-05"
  }
]);
assert.equal(mixedCountries.length, 2, "each country must remain a separate digest");
assert.ok(mixedCountries.some(text => text.startsWith("🇻🇳Vietnam")));
assert.ok(mixedCountries.some(text => text.startsWith("🇹🇭Thailand")));

const targetFiltered = filterFlightsForTarget(vietnamFlights, "@charterkaz");
assert.ok(!targetFiltered.some(item => item.id === "out-v-1"));
assert.equal(filterFlightsForTarget(vietnamFlights, "@charter_forever_travel").length, vietnamFlights.length);

assert.equal(
  telegramPublicationWindowStatus(new Date("2026-10-01T05:00:00Z")).open,
  true,
  "10:00 Asia/Almaty should be inside the window"
);
assert.equal(
  telegramPublicationWindowStatus(new Date("2026-10-01T15:00:00Z")).open,
  false,
  "20:00 Asia/Almaty should stop publication"
);

const calls = [];
const fakeFetch = async (url, options) => {
  calls.push({ url: String(url), payload: JSON.parse(options.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const result = await publishFreshFlights({
  token: "123:test",
  targets: "@charterkaz,@charter_forever_travel",
  flights: vietnamFlights,
  publicAppUrl: "https://example.com",
  managerPhone: "+7 700 777 24 14",
  fetchImpl: fakeFetch,
  delayMs: 0
});

assert.equal(result.published, 2);
assert.equal(calls.length, 2);
assert.equal(calls[0].payload.chat_id, "@charterkaz");
assert.ok(calls[0].payload.text.startsWith("🇻🇳Vietnam"));
assert.equal(calls[1].payload.chat_id, "@charter_forever_travel");
assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].text, "🎫 Купить билет");
assert.ok(calls[1].payload.reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/77007772414?text="));

const veryLargeList = Array.from({ length: 140 }, (_, index) => ({
  id: "large-" + index,
  from: "Алматы",
  to: "Пхукет",
  price: 100000 + index * 1000,
  trip: "OW",
  airline: index % 2 ? "Air Astana" : "SCAT",
  airlineCode: index % 2 ? "A" : "S",
  baggage: index % 2
    ? "багаж 23 кг + ручная кладь 8 кг"
    : "багаж 23 кг + ручная кладь 5 кг",
  seats: "Наличие уточняется",
  departureDate: "2026-11-" + String(1 + (index % 28)).padStart(2, "0"),
  sourceIds: ["telegram:partner"]
}));

const splitPosts = buildFlightPosts(veryLargeList, 900);
assert.ok(splitPosts.length > 1, "oversized country digests must split safely");
assert.ok(splitPosts.every(text => text.length <= 900));
assert.ok(splitPosts.every(text => text.startsWith("🇹🇭Thailand")));
assert.ok(splitPosts.every(text => text.includes("Цены указаны в KZT")));

console.log("Telegram Step to Travel exact country digest formatting, splitting, targets, and CTA: passed");
