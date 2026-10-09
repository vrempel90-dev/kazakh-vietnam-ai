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
assert.equal(posts.length, 3, "Outbound, return and RT are classified separately");
const post = posts.join("\n");

assert.ok(post.includes("БИЛЕТЫ ТУДА"));
assert.ok(post.includes("ОБРАТНЫЕ БИЛЕТЫ"));
assert.ok(post.includes("ТУДА И ОБРАТНО (RT)"));
assert.ok(post.includes("Астана - Фукуок"));
assert.ok(post.includes("Фукуок - Астана"));
assert.ok(post.includes("V 03.10 - 96 000 ₸"));
assert.ok(post.includes("S 21.10 - 55 000 ₸ (2)"));
assert.ok(post.includes("V 03.10–10.10 | 7 ночей - 196 000 ₸ (1)"));
assert.ok(post.includes("S - SCAT"));
assert.ok(post.includes("A - Air Astana") === false);
assert.ok(post.includes("V - VietJet Air"));
assert.ok(!post.includes("\\\\n"), "Use actual line breaks");

const mixedCountries = buildFlightPosts([
  ...vietnamFlights,
  {id:"thai-1",from:"Алматы",to:"Пхукет",price:99000,trip:"OW",airline:"Air Astana",departureDate:"2026-10-05"},
  {id:"malaysia-1",from:"Алматы",to:"Куала-Лумпур",price:159000,trip:"OW",departureDate:"2026-10-06"}
]);
assert.equal(mixedCountries.length, 5);
assert.ok(mixedCountries.some(text=>text.startsWith("🇹🇭 <b>БИЛЕТЫ ТУДА")));
assert.ok(mixedCountries.some(text=>text.startsWith("🇲🇾 <b>БИЛЕТЫ ТУДА")));

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

assert.equal(result.published, 6);
assert.equal(calls.length, 6);
assert.ok(calls.every(call => call.url.endsWith("/sendMessage")));
assert.equal(calls[0].payload.chat_id, "@charterkaz");
assert.ok(calls[0].payload.text.startsWith("🇻🇳 <b>БИЛЕТЫ ТУДА"));
assert.equal(calls[3].payload.chat_id, "@charter_forever_travel");
assert.equal(calls[3].payload.reply_markup.inline_keyboard[0][0].text, "🎫 Купить билет");
assert.ok(calls[3].payload.reply_markup.inline_keyboard[0][0].url.startsWith("https://wa.me/77007772414?text="));
assert.equal(Object.keys(result.targets[1].countryMessages).length, 3);

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
  editMessageIds: { "Вьетнам|астана|фукуок|OW": 777 },
  fetchImpl: editFetch,
  delayMs: 0,
  maxPostsPerRun: 10
});

assert.equal(editCalls.length, 3);
assert.ok(editCalls.some(call => call.url.endsWith("/editMessageText")));
assert.ok(editCalls.some(call => call.payload.message_id === 777));
assert.equal(editResult.targets[0].countryMessages["Вьетнам|астана|фукуок|OW"], 777);

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
assert.ok(splitPosts.every(text => text.startsWith("🇹🇭 <b>БИЛЕТЫ ТУДА")));
assert.ok(splitPosts.every(text => text.includes("💳 Цены в ₸")));

console.log("Telegram route digest design, country notices, airline names, editing, splitting, targets, and CTA: passed");

const separateDestinations = buildFlightPosts([
  { id: "kul", from: "Алматы", to: "Куала-Лумпур", trip: "OW", departureDate: "2026-11-10", price: 110000 },
  { id: "sel", from: "Алматы", to: "Сеул", trip: "OW", departureDate: "2026-11-11", price: 130000 }
]);
assert.equal(separateDestinations.length, 2);
assert.ok(separateDestinations.every(text => !(text.includes("Куала-Лумпур") && text.includes("Сеул"))));
assert.ok(separateDestinations.some(text => text.startsWith("🇰🇷 <b>БИЛЕТЫ ТУДА")));
