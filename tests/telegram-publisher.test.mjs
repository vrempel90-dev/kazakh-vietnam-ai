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
    id: "return-s-1",
    from: "Фукуок",
    to: "Астана",
    price: 55000,
    trip: "OW",
    airline: "Scat",
    airlineCode: "S",
    baggage: "багаж 23 кг + ручная кладь 5 кг",
    seats: "2 места",
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
assert.deepEqual(countryForFlight({ from: "Алматы", to: "Куала-Лумпур" }), { name: "Малайзия", flag: "🇲🇾" });

const posts = buildFlightPosts(vietnamFlights);
assert.equal(posts.length, 1, "Vietnam must remain one country digest when it fits Telegram");
const post = posts[0];

assert.ok(post.startsWith("🇻🇳 <b>ВЬЕТНАМ · ЧАРТЕРЫ</b>\n\n⚠️ Arrival Card обязательно"));
assert.ok(post.includes("✈️ Астана → Фукуок"));
assert.ok(post.includes("• 03.10 · 96 000 ₸ · VietJet Air · 🔥"));
assert.ok(post.includes("• 23.10 · 236 000 ₸ · Sun Phu Quoc Airways · 1 место"));
assert.ok(post.includes("✈️ Фукуок → Астана"));
assert.ok(post.includes("• 21.10 · 55 000 ₸ · Scat · 2 места · 🔥"));
assert.ok(post.includes("🔁 Астана ⇄ Фукуок"));
assert.ok(post.includes("• 03.10–10.10 · 196 000 ₸ · VietJet Air · 1 место · 🔥"));
assert.ok(post.includes("— ноябрь —"));
assert.ok(post.includes("• 02.11–09.11 · 378 000 ₸ · VietJet Air"));
assert.ok(post.includes("🧳 Sun Phu Quoc Airways: багаж 23 кг + ручная кладь 7 кг"));
assert.ok(post.includes("🧳 Scat: багаж 23 кг + ручная кладь 5 кг"));
assert.ok(post.includes("🧳 VietJet Air: багаж 20 кг + ручная кладь 5 кг"));
assert.ok(post.endsWith("💳 Цены в KZT\n🕒 Цена и наличие актуальны на момент публикации"));
assert.ok(!post.includes("Astana Phu Quoc"));
assert.ok(!post.includes("\nV 03.10"));
assert.ok(!post.includes("\nS 21.10"));
assert.ok(!post.includes("\n* 23.10"));
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
    baggage: "багаж 23 кг + ручная кладь 8 кг",
    seats: "2 места",
    departureDate: "2026-10-05"
  },
  {
    id: "malaysia-1",
    from: "Алматы",
    to: "Куала-Лумпур",
    price: 159000,
    trip: "OW",
    airline: "Air Astana",
    seats: "Наличие уточняется",
    departureDate: "2026-10-06"
  }
]);
assert.equal(mixedCountries.length, 3, "each country must remain a separate digest");
assert.ok(mixedCountries.some(text => text.startsWith("🇻🇳 <b>ВЬЕТНАМ · ЧАРТЕРЫ</b>")));
assert.ok(mixedCountries.some(text => text.startsWith("🇹🇭 <b>ТАИЛАНД · ЧАРТЕРЫ</b>\n\n⚠️ TDAC обязательно")));
assert.ok(mixedCountries.some(text => text.startsWith("🇲🇾 <b>МАЛАЙЗИЯ · ЧАРТЕРЫ</b>\n\n⚠️ MDAC обязательно")));

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
assert.ok(calls.every(call => call.url.endsWith("/sendMessage")));
assert.equal(calls[0].payload.chat_id, "@charterkaz");
assert.ok(calls[0].payload.text.startsWith("🇻🇳 <b>ВЬЕТНАМ · ЧАРТЕРЫ</b>"));
assert.equal(calls[1].payload.chat_id, "@charter_forever_travel");
assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].text, "🎫 Купить билет");
assert.ok(calls[1].payload.reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/77007772414?text="));
assert.equal(result.targets[1].countryMessages["Вьетнам"], 2);

const editCalls = [];
const editFetch = async (url, options) => {
  editCalls.push({ url: String(url), payload: JSON.parse(options.body) });
  return new Response(JSON.stringify({ ok: true, result: { message_id: 777 } }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

const editResult = await publishFreshFlights({
  token: "123:test",
  targets: "@updates",
  flights: vietnamFlights,
  managerPhone: "+7 700 777 24 14",
  editMessageIds: { "Вьетнам": 777 },
  fetchImpl: editFetch,
  delayMs: 0,
  maxPostsPerRun: 10
});

assert.equal(editCalls.length, 1);
assert.ok(editCalls[0].url.endsWith("/editMessageText"));
assert.equal(editCalls[0].payload.message_id, 777);
assert.equal(editResult.targets[0].countryMessages["Вьетнам"], 777);

const veryLargeList = Array.from({ length: 140 }, (_, index) => ({
  id: "large-" + index,
  from: "Алматы",
  to: "Пхукет",
  price: 100000 + index * 1000,
  trip: "OW",
  airline: index % 2 ? "Air Astana" : "SCAT",
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
assert.ok(splitPosts.every(text => text.startsWith("🇹🇭 <b>ТАИЛАНД · ЧАРТЕРЫ</b>")));
assert.ok(splitPosts.every(text => text.includes("💳 Цены в KZT")));

console.log("Telegram country digest design, country notices, airline names, editing, splitting, targets, and CTA: passed");
