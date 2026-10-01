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

const flights = [
  {
    id: "a",
    from: "Алматы",
    to: "Камрань",
    price: 218000,
    trip: "RT",
    airline: "SCAT",
    seats: "3 места",
    departureDate: "2026-10-03",
    returnDate: "2026-10-08",
    sourceIds: ["telegram:charterkaz"]
  },
  {
    id: "b",
    from: "Астана",
    to: "Дананг",
    price: 120000,
    trip: "OW",
    airline: "VietJet",
    seats: "Наличие уточняется",
    departureDate: "2026-10-02",
    sourceIds: ["telegram:neos"]
  }
];

assert.deepEqual(
  parsePublishTargets("charterkaz,@charter_forever_travel"),
  ["@charterkaz", "@charter_forever_travel"]
);
assert.equal(shouldSkipParsedTelegramMessage("test " + AUTO_MARKER), true);
assert.equal(shouldSkipParsedTelegramMessage("manual post"), false);

const charterKazFlights = filterFlightsForTarget(flights, "@charterkaz");
assert.deepEqual(charterKazFlights.map(item => item.id), ["b"]);
const foreverFlights = filterFlightsForTarget(flights, "@charter_forever_travel");
assert.deepEqual(foreverFlights.map(item => item.id), ["a", "b"]);

assert.deepEqual(countryForFlight(flights[0]), { name: "Вьетнам", flag: "🇻🇳" });
assert.deepEqual(countryForFlight({ from: "Астана", to: "Аланья" }), { name: "Турция", flag: "🇹🇷" });
assert.deepEqual(countryForFlight({ from: "Алматы", to: "Газипаша (Аланья" }), { name: "Турция", flag: "🇹🇷" });
assert.deepEqual(countryForFlight({ from: "Шымкент", to: "Мюнхен" }), { name: "Германия", flag: "🇩🇪" });

const posts = buildFlightPosts(flights);
assert.equal(posts.length, 1);
assert.ok(posts[0].includes("🇻🇳 <b>Вьетнам — все актуальные чартеры</b>"));
assert.ok(posts[0].includes("🇰🇿 → 🇻🇳 <b>Из Казахстана</b>"));
assert.ok(posts[0].includes("Алматы → Камрань → Алматы"));
assert.ok(posts[0].includes("218"));
assert.ok(posts[0].includes(AUTO_MARKER));

const mixedCountries = buildFlightPosts([
  ...flights,
  {
    id: "th-out",
    from: "Алматы",
    to: "Пхукет",
    price: 78000,
    trip: "OW",
    departureDate: "2026-10-29",
    sourceIds: ["telegram:partner"]
  },
  {
    id: "th-in",
    from: "Пхукет",
    to: "Алматы",
    price: 79000,
    trip: "OW",
    departureDate: "2026-10-30",
    sourceIds: ["telegram:partner"]
  }
]);

assert.equal(mixedCountries.length, 2, "each country must be published in its own post group");
const thailandPost = mixedCountries.find(text => text.includes("Таиланд"));
assert.ok(thailandPost);
assert.ok(thailandPost.includes("🇰🇿 → 🇹🇭 <b>Из Казахстана</b>"));
assert.ok(thailandPost.includes("🇹🇭 → 🇰🇿 <b>В Казахстан</b>"));
assert.ok(!thailandPost.includes("Дананг"), "Vietnam flights must not leak into Thailand post");

assert.equal(
  telegramPublicationWindowStatus(new Date("2026-10-01T05:00:00Z")).open,
  true,
  "10:00 Asia/Almaty should be inside the window"
);
assert.equal(
  telegramPublicationWindowStatus(new Date("2026-10-01T14:59:00Z")).open,
  true,
  "19:59 Asia/Almaty should be inside the window"
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
  flights,
  publicAppUrl: "https://example.com",
  managerPhone: "+7 700 777 24 14",
  fetchImpl: fakeFetch,
  delayMs: 0
});

assert.equal(result.published, 2);
assert.deepEqual(result.targets[0].sentFlightIds, ["b"]);
assert.deepEqual(result.targets[1].sentFlightIds.sort(), ["a", "b"]);
assert.equal(calls.length, 2);
assert.equal(calls[0].payload.chat_id, "@charterkaz");
assert.ok(calls[0].payload.text.includes("Астана → Дананг"));
assert.ok(!calls[0].payload.text.includes("Алматы → Камрань"));
assert.equal(calls[1].payload.chat_id, "@charter_forever_travel");
assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].text, "🎫 Купить билет");
assert.ok(calls[1].payload.reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/77007772414?text="));
assert.ok(!calls[1].payload.text.includes("Цена и наличие требуют подтверждения"));

const cachedPosts = buildFlightPosts([{ ...flights[1], cachedFallback: true }]);
assert.ok(cachedPosts[0].includes("Цены и наличие указаны по последним полученным данным."));
assert.ok(!cachedPosts[0].includes("Цена и наличие требуют подтверждения"));

const uaeFlights = Array.from({ length: 18 }, (_, index) => ({
  id: "uae-" + index,
  from: index % 2 === 0 ? "Алматы" : "Астана",
  to: index % 3 === 0 ? "Шарджа" : "Дубай",
  price: 90000 + index * 1000,
  trip: "OW",
  airline: "SCAT",
  seats: "Наличие уточняется",
  departureDate: "2026-10-" + String(2 + index).padStart(2, "0"),
  sourceIds: ["telegram:neos"]
}));

const uaePosts = buildFlightPosts(uaeFlights);
assert.equal(uaePosts.length, 1, "Dubai and Sharjah must stay in one UAE post");
assert.ok(uaePosts[0].includes("ОАЭ — все актуальные чартеры"));
assert.ok(uaePosts[0].includes("Дубай"));
assert.ok(uaePosts[0].includes("Шарджа"));
for (const flight of uaeFlights) {
  assert.ok(uaePosts[0].includes(String(flight.price).slice(0, 2)), "all UAE flights must be represented");
}
assert.ok(uaePosts[0].length <= 4050, "single-country post must fit Telegram limit");

const cappedCalls = [];
const cappedResult = await publishFreshFlights({
  token: "123:test",
  targets: "@test_channel",
  flights: uaeFlights,
  publicAppUrl: "https://example.com",
  managerPhone: "77007772414",
  fetchImpl: async (url, options) => {
    cappedCalls.push({ url: String(url), payload: JSON.parse(options.body) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: cappedCalls.length } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  },
  delayMs: 0,
  maxPostsPerRun: 1
});

assert.equal(cappedCalls.length, 1);
assert.equal(cappedResult.targets[0].posts, 1);
assert.equal(cappedResult.targets[0].postsAvailable, 1);
assert.equal(cappedResult.targets[0].postsSkipped, 0);
assert.equal(cappedResult.targets[0].sentFlightIds.length, uaeFlights.length);

console.log("Telegram one-country-per-post grouping, daytime window, source-loop protection, targets, and CTA: passed");
