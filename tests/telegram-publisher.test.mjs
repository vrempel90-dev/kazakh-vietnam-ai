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

const plain = value => String(value).replace(/\u00a0/g, " ");

const flights = [
  {
    id: "a",
    from: "Алматы",
    to: "Нячанг",
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

const posts = buildFlightPosts(flights);
assert.equal(posts.length, 2, "outbound and round-trip offers should be separate compact lists");
const outbound = plain(posts.find(text => text.startsWith("Билеты туда")));
assert.ok(outbound.includes("Астана - Дананг"));
assert.ok(outbound.includes("V 2.10 - 120 000"));
assert.ok(!outbound.includes("Vietnam"));
assert.ok(!outbound.includes("багаж"));
assert.ok(!outbound.includes("Цены указаны"));
const roundtrip = plain(posts.find(text => text.startsWith("Туда-обратно")));
assert.ok(roundtrip.includes("Алматы - Нячанг - Алматы"));
assert.ok(roundtrip.includes("S 3.10 - 8.10 - 218 000 (3)"));

const returnPosts = buildFlightPosts([
  {
    id: "r1",
    from: "Дананг",
    to: "Астана",
    price: 78000,
    trip: "OW",
    airline: "VietJet Air",
    seats: "4 места",
    departureDate: "2026-10-03"
  },
  {
    id: "r2",
    from: "Нячанг",
    to: "Алматы",
    price: 110000,
    trip: "OW",
    airline: "Air Astana",
    seats: "1 место",
    departureDate: "2026-09-30"
  },
  {
    id: "r3",
    from: "Нячанг",
    to: "Алматы",
    price: 122000,
    trip: "OW",
    airline: "SCAT",
    seats: "Наличие уточняется",
    departureDate: "2026-09-30"
  },
  {
    id: "r4",
    from: "Нячанг",
    to: "Алматы",
    price: 144000,
    trip: "OW",
    airline: "Sunday Airlines",
    seats: "1 место",
    departureDate: "2026-10-04"
  },
  {
    id: "r5",
    from: "Фукуок",
    to: "Астана",
    price: 55000,
    trip: "OW",
    airline: "VietJet Air",
    departureDate: "2026-10-07"
  }
]);

assert.equal(returnPosts.length, 1);
const returnList = plain(returnPosts[0]);
assert.ok(returnList.startsWith("Обратные билеты\n\n"));
assert.ok(returnList.includes("Дананг - Астана\nV 3.10 - 78 000 (4)"));
assert.ok(returnList.includes("Нячанг - Алматы"));
assert.ok(returnList.includes("A 30.09 - 110 000 (1)"));
assert.ok(returnList.includes("S 30.09 - 122 000"));
assert.ok(returnList.includes("S 4.10 - 144 000 (1)"));
assert.ok(returnList.includes("Фукуок - Астана\nV 7.10 - 55 000"));
assert.ok(!returnList.includes("🇻🇳"));
assert.ok(!returnList.includes("<b>"));

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
  flights,
  publicAppUrl: "https://example.com",
  managerPhone: "+7 700 777 24 14",
  fetchImpl: fakeFetch,
  delayMs: 0
});

assert.equal(result.published, 3);
assert.deepEqual(result.targets[0].sentFlightIds, ["b"]);
assert.deepEqual(result.targets[1].sentFlightIds.sort(), ["a", "b"]);
assert.equal(calls.length, 3);
assert.equal(calls[0].payload.chat_id, "@charterkaz");
assert.ok(calls[0].payload.text.includes("Билеты туда"));
assert.ok(calls[0].payload.text.includes("Астана - Дананг"));
assert.equal(calls[1].payload.chat_id, "@charter_forever_travel");
assert.equal(calls[1].payload.reply_markup.inline_keyboard[0][0].text, "🎫 Купить билет");
assert.ok(calls[1].payload.reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/77007772414?text="));

const veryLargeList = Array.from({ length: 140 }, (_, index) => ({
  id: "large-" + index,
  from: index % 2 ? "Алматы" : "Астана",
  to: index % 3 ? "Пхукет" : "Бангкок",
  price: 100000 + index * 1000,
  trip: "OW",
  airline: index % 2 ? "Air Astana" : "SCAT",
  seats: "Наличие уточняется",
  departureDate: "2026-11-" + String(1 + (index % 28)).padStart(2, "0"),
  sourceIds: ["telegram:neos"]
}));

const splitPosts = buildFlightPosts(veryLargeList, 900);
assert.ok(splitPosts.length > 1, "oversized lists must be split safely");
assert.ok(splitPosts.every(text => text.length <= 900));
assert.ok(splitPosts.every(text => text.startsWith("Билеты туда")));
assert.ok(splitPosts.every(text => !text.includes("Thailand")));

console.log("Telegram compact charter list formatting, splitting, targets, and CTA: passed");
