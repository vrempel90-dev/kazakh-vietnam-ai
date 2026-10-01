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
    baggage: "багаж 23кг + ручная кладь 5кг",
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
    airline: "VietJet Air",
    baggage: "багаж 20кг + ручная кладь 5кг",
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
assert.ok(posts[0].includes("<b>🇻🇳 Vietnam</b>"));
assert.ok(posts[0].includes("<b>Astana Da Nang</b>"));
assert.ok(posts[0].includes("02.10 - 120"));
assert.ok(posts[0].includes("<b>Almaty Cam Ranh Almaty</b>"));
assert.ok(posts[0].includes("-туда обратно-"));
assert.ok(posts[0].includes("03.10 - 08.10 = 218"));
assert.ok(posts[0].includes("(3)"));
assert.ok(posts[0].includes("SCAT - багаж 23кг + ручная кладь 5кг"));
assert.ok(posts[0].includes("Цены указаны в KZT"));
assert.ok(posts[0].includes("Цены и наличие актуальны на момент публикации"));
assert.ok(!posts[0].includes("все актуальные чартеры"));
assert.ok(!posts[0].includes("Из Казахстана"));
assert.ok(!posts[0].includes(AUTO_MARKER), "visible post should match reference style without bot marker");

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
    hot: true,
    seats: "3 места",
    departureDate: "2026-10-30",
    sourceIds: ["telegram:partner"]
  }
]);

assert.equal(mixedCountries.length, 2, "each country remains a separate post group");
const thailandPost = mixedCountries.find(text => text.includes("Thailand"));
assert.ok(thailandPost);
assert.ok(thailandPost.includes("<b>Almaty Phuket</b>"));
assert.ok(thailandPost.includes("29.10 - 78"));
assert.ok(thailandPost.includes("<b>Phuket Almaty</b>"));
assert.ok(thailandPost.includes("30.10 - 79"));
assert.ok(thailandPost.includes("(3) 🔥"));
assert.ok(!thailandPost.includes("Da Nang"), "Vietnam flights must not leak into Thailand post");

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
assert.ok(calls[0].payload.text.includes("Astana Da Nang"));
assert.ok(!calls[0].payload.text.includes("Almaty Cam Ranh"));
assert.equal(calls[1].payload.chat_id, "@charter_forever_travel");
assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].text, "🎫 Купить билет");
assert.ok(calls[1].payload.reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/77007772414?text="));

const cachedPosts = buildFlightPosts([{ ...flights[1], cachedFallback: true }]);
assert.ok(cachedPosts[0].includes("Цены указаны в KZT"));
assert.ok(cachedPosts[0].includes("Цены и наличие указаны по последним полученным данным."));

const uaeFlights = Array.from({ length: 18 }, (_, index) => ({
  id: "uae-" + index,
  from: index % 2 === 0 ? "Алматы" : "Астана",
  to: index % 3 === 0 ? "Шарджа" : "Дубай",
  price: 90000 + index * 1000,
  trip: "OW",
  airline: "FlyDubai",
  baggage: "багаж 20кг + ручная кладь 7кг",
  seats: index === 0 ? "2 места" : "Наличие уточняется",
  departureDate: "2026-10-" + String(2 + index).padStart(2, "0"),
  sourceIds: ["telegram:neos"]
}));

const uaePosts = buildFlightPosts(uaeFlights);
assert.equal(uaePosts.length, 1, "Dubai and Sharjah should stay in one UAE post while it fits");
assert.ok(uaePosts[0].includes("<b>🇦🇪 UAE</b>"));
assert.ok(uaePosts[0].includes("Almaty Sharjah"));
assert.ok(uaePosts[0].includes("Astana Dubai"));
assert.ok(uaePosts[0].includes("FlyDubai - багаж 20кг + ручная кладь 7кг"));
assert.ok(uaePosts[0].length <= 4050);

const veryLargeCountry = Array.from({ length: 140 }, (_, index) => ({
  id: "large-" + index,
  from: index % 2 ? "Алматы" : "Астана",
  to: index % 3 ? "Пхукет" : "Бангкок",
  price: 100000 + index * 1000,
  trip: "OW",
  seats: "Наличие уточняется",
  departureDate: "2026-11-" + String(1 + (index % 28)).padStart(2, "0"),
  sourceIds: ["telegram:neos"]
}));

const splitPosts = buildFlightPosts(veryLargeCountry, 900);
assert.ok(splitPosts.length > 1, "oversized country must be split safely instead of failing");
assert.ok(splitPosts.every(text => text.length <= 900));
assert.ok(splitPosts.every(text => text.includes("🇹🇭 Thailand")));
assert.equal(
  splitPosts.join("\n").match(/Цены указаны в KZT/g)?.length,
  splitPosts.length,
  "each split part must keep the reference footer"
);

console.log("Telegram Step-to-Travel-style formatting, grouping, splitting, targets, and CTA: passed");
