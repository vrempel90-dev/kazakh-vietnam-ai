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
  fetchImpl: fakeFetch,
  delayMs: 0
});

assert.equal(result.published, 2);
assert.equal(calls.length, 2);
assert.equal(calls[0].payload.chat_id, "@charterkaz");
assert.ok(calls[0].payload.text.includes("Астана → Дананг"));
assert.ok(!calls[0].payload.text.includes("Алматы → Камрань"));
assert.equal(calls[1].payload.chat_id, "@charter_forever_travel");
assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].url, "https://example.com");

console.log("Telegram fresh-flight publisher batching, source-loop protection, targets, and CTA: passed");
