import assert from "node:assert/strict";
import {
  AUTO_MARKER,
  buildFlightPosts,
  filterFlightsForTarget,
  parsePublishTargets,
  publishFreshFlights,
  shouldSkipParsedTelegramMessage
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
    departureDate: "2026-09-30",
    returnDate: "2026-10-08",
    sourceIds: ["charterkaz"]
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
    sourceIds: ["neos"]
  }
];

assert.deepEqual(parsePublishTargets("charterkaz,@charter_forever_travel"), ["@charterkaz", "@charter_forever_travel"]);
assert.equal(shouldSkipParsedTelegramMessage("test " + AUTO_MARKER), true);
assert.equal(shouldSkipParsedTelegramMessage("manual post"), false);

const charterKazFlights = filterFlightsForTarget(flights, "@charterkaz");
assert.deepEqual(charterKazFlights.map(item => item.id), ["b"]);
const foreverFlights = filterFlightsForTarget(flights, "@charter_forever_travel");
assert.deepEqual(foreverFlights.map(item => item.id), ["a", "b"]);

const posts = buildFlightPosts(flights);
assert.equal(posts.length, 1);
assert.ok(posts[0].includes("Свежие чартерные рейсы"));
assert.ok(posts[0].includes("Алматы → Камрань → Алматы"));
assert.ok(posts[0].includes("218"));
assert.ok(posts[0].includes(AUTO_MARKER));

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

const manyFlights = Array.from({ length: 20 }, (_, index) => ({
  id: "bulk-" + index,
  from: "Алматы",
  to: "Камрань",
  price: 200000 + index * 1000,
  trip: "OW",
  airline: "SCAT",
  seats: "Наличие уточняется",
  departureDate: "2026-10-" + String(1 + (index % 20)).padStart(2, "0"),
  sourceIds: ["neos"]
}));

const cappedCalls = [];
const cappedResult = await publishFreshFlights({
  token: "123:test",
  targets: "@test_channel",
  flights: manyFlights,
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
assert.ok(cappedResult.targets[0].postsAvailable > 1);
assert.equal(
  cappedResult.targets[0].postsSkipped,
  cappedResult.targets[0].postsAvailable - 1
);

console.log("Telegram fresh-flight publisher batching, source-loop protection, targets, and CTA: passed");
