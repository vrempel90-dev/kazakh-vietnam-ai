/**
 * End-to-end chain:
 *   Telegram source text -> parser -> normalizer -> validator -> lifecycle
 *   -> country grouping -> renderer -> scheduler -> publisher -> state
 *
 * The post fixtures below are realistic synthetic charter posts written in the
 * layout public charter channels use (country heading, carrier legend, route
 * lines, date/price/seat lines). They are not transcripts of any particular
 * channel's messages.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseTelegramPost } from "../scripts/telegram-source-adapter.mjs";
import { validateFlightsForPublication } from "../scripts/flight-validator.mjs";
import { reconcileLifecycle } from "../scripts/offer-lifecycle.mjs";
import { buildCountryDigests } from "../scripts/telegram-digest.mjs";
import { classifyFlight } from "../scripts/charter-geo.mjs";
import { runTelegramPublication } from "../scripts/telegram-publish-run.mjs";
import { loadPublicationState } from "../scripts/telegram-publication-state.mjs";

const NOW = new Date(Date.UTC(2026, 9, 12, 5, 5)); // 10:05 Asia/Almaty
const CHAT = "-1002106608923";

const VIETNAM_POST = [
  "🇻🇳 ВЬЕТНАМ",
  "",
  "VietJet Air, багаж 20 кг + ручная кладь 7 кг",
  "Астана → Фукуок",
  "V 21.10 — 96 000 ₸ (3)",
  "V 24.10 — 104 000 ₸ (2)",
  "",
  "Алматы → Камрань",
  "S 22.10 — 110 000 ₸ (5)",
  "",
  "Фукуок → Астана",
  "V 29.10 — 55 000 ₸",
  "S 30.10 — 78 000 ₸ (4)",
  "",
  "Da Nang → Астана",
  "V 25.10 — 78 000 ₸ (4)",
  "",
  "Астана → Фукуок → Астана",
  "21.10 → 28.10 — 196 000 ₸ (7)"
].join("\n");

const KOREA_POST = [
  "🇰🇷 ЮЖНАЯ КОРЕЯ",
  "",
  "Air Astana",
  "Алматы → Seoul",
  "A 02.11 — 190 000 ₸ (6)",
  "A 09.11 — 205 000 ₸",
  "",
  "Incheon → Алматы",
  "A 10.11 — 185 000 ₸ (2)"
].join("\n");

/**
 * An explicit past year stays in the past. A bare "01.09" would instead be
 * rolled into the next year by the parser, which is why the renderer prints a
 * year suffix for any departure outside the current one.
 */
const STALE_POST = [
  "🇹🇭 ТАИЛАНД",
  "",
  "Алматы → Пхукет",
  "01.09.2026 — 150 000 ₸",
  "15.10 — 165 000 ₸ (3)"
].join("\n");

/**
 * A same-day A->B and B->A pair reported by a single source: the direction is
 * ambiguous, so the validator quarantines it until a second source confirms it.
 */
const MIRRORED_POST = [
  "🇦🇪 ОАЭ",
  "",
  "Алматы → Дубай",
  "20.10 — 160 000 ₸ (2)",
  "",
  "Дубай → Алматы",
  "20.10 — 158 000 ₸ (2)"
].join("\n");

const DISPUTED_POST = [
  "🇹🇭 ТАИЛАНД",
  "",
  "SCAT",
  "Пхукет → Алматы",
  "S 18.10 — 140 000 ₸ (2)"
].join("\n");

/** Mirrors the shaping sync-all-sources applies between parsing and publishing. */
function toPublishableFlight(offer) {
  const trip = offer.returnDate ? "RT" : String(offer.trip || "OW");
  const flight = {
    from: offer.from,
    to: offer.to,
    trip,
    price: offer.sourcePrice + (trip === "RT" ? 20000 : 10000),
    seats: offer.seats,
    airline: offer.airline || undefined,
    airlineCode: offer.airlineCode || undefined,
    baggage: offer.baggage || undefined,
    departureDate: offer.departureDate,
    returnDate: offer.returnDate || undefined,
    sourceIds: [offer.sourceId],
    sourcePostedAt: offer.postedAt
  };
  flight.id = createHash("sha1")
    .update([flight.from, flight.to, flight.departureDate, flight.returnDate || "", flight.trip,
      flight.airlineCode || flight.airline || "", flight.price].join("|"))
    .digest("hex")
    .slice(0, 16);
  return flight;
}

function ingest(posts) {
  const offers = posts.flatMap(([text, sourceId, postId]) =>
    parseTelegramPost(text, { sourceId, postId, postedAt: NOW.toISOString(), now: NOW })
  );
  const flights = offers.map(toPublishableFlight);
  const validation = validateFlightsForPublication(flights, { now: NOW, mirroredRouteMinSources: 2 });
  return {
    offers,
    flights,
    validation,
    publishable: reconcileLifecycle(validation.verified, null, NOW, 24)
  };
}

const FULL_FEED = [
  [VIETNAM_POST, "telegram:partner-a", 101],
  [KOREA_POST, "telegram:partner-a", 102],
  [STALE_POST, "telegram:partner-b", 103],
  [DISPUTED_POST, "telegram:partner-b", 104],
  [MIRRORED_POST, "telegram:partner-b", 105]
];

test("the parser turns channel text into offers with carriers, seats and trip types", () => {
  const { offers } = ingest([[VIETNAM_POST, "telegram:partner-a", 101]]);
  assert.equal(offers.length, 7);

  const outbound = offers.find(o => o.from === "Астана" && o.to === "Фукуок" && o.trip === "OW");
  assert.equal(outbound.sourcePrice, 96000);
  assert.equal(outbound.airlineCode, "V");
  assert.equal(outbound.seats, "3 мест");

  const roundTrip = offers.find(o => o.trip === "RT");
  assert.equal(roundTrip.departureDate, "2026-10-21");
  assert.equal(roundTrip.returnDate, "2026-10-28");

  // "Камрань" and "Da Nang" are the same cities as Nha Trang and Da Nang.
  assert.ok(offers.some(o => o.to === "Нячанг"));
  assert.ok(offers.some(o => o.from === "Дананг"));
});

test("every parsed offer is classified into a country and a ticket category", () => {
  const { publishable } = ingest(FULL_FEED);
  for (const flight of publishable) {
    const classification = classifyFlight(flight);
    assert.notEqual(classification.category, "unknown", flight.from + " -> " + flight.to);
    assert.ok(classification.country, flight.from + " -> " + flight.to);
  }
});

test("scenario 14: stale and unconfirmed offers never reach the renderer", () => {
  const { offers, validation, publishable } = ingest(FULL_FEED);

  // Stage 1 - the parser already discards a departure that has passed.
  assert.ok(
    !offers.some(offer => offer.departureDate === "2026-09-01"),
    "the past departure never becomes an offer"
  );
  assert.ok(offers.some(offer => offer.departureDate === "2026-10-15"));

  // Stage 2 - the validator rejects a stale entry arriving by any other path,
  // such as the cached-feed fallback.
  const stale = validateFlightsForPublication([{
    id: "stale-1", from: "Алматы", to: "Пхукет", trip: "OW",
    departureDate: "2026-09-01", price: 150000, sourceIds: ["telegram:cache"]
  }], { now: NOW, mirroredRouteMinSources: 2 });
  assert.equal(stale.verified.length, 0);
  assert.equal(stale.rejected[0].reason, "DEPARTURE_DATE_OUT_OF_RANGE");

  // Stage 3 - the disputed SCAT Phuket -> Almaty pairing is held for review.
  assert.ok(
    validation.needsReview.some(item => item.reason === "DISPUTED_SCAT_PHUKET_ALMATY_ROUTE"),
    "the disputed carrier/route pairing is quarantined"
  );
  assert.ok(!publishable.some(flight => flight.from === "Пхукет" && flight.to === "Алматы"));

  // Stage 4 - an ambiguous same-day mirrored pair from one source is unconfirmed.
  assert.ok(
    validation.needsReview.some(item => item.reason === "MIRRORED_ROUTE_UNCONFIRMED"),
    "the single-source mirrored pair is quarantined"
  );
  assert.ok(!publishable.some(flight => flight.to === "Дубай" || flight.from === "Дубай"));

  // Stage 5 - none of it appears in a published message.
  const { digests } = buildCountryDigests(publishable, { now: NOW });
  const allText = digests.map(digest => digest.text).join("\n");
  assert.ok(!allText.includes("01.09"));
  assert.ok(!allText.includes("Пхукет - Алматы"));
  assert.ok(!allText.includes("ОАЭ"), "a quarantined country produces no post at all");
  assert.ok(!allText.includes("Дубай"));
});

test("the whole chain publishes one message per country in the agreed layout", async () => {
  const { publishable } = ingest(FULL_FEED);
  const { digests, summary } = buildCountryDigests(publishable, { now: NOW });

  assert.equal(summary.countries, 3, "Vietnam, South Korea and Thailand");
  assert.equal(digests.length, 3, "one message per country");
  assert.equal(summary.diagnostics, 0);

  const vietnam = digests.find(digest => digest.country === "VN");
  const text = vietnam.text.replace(/<\/?b>/g, "");

  assert.ok(text.startsWith("🇻🇳 ВЬЕТНАМ\n\n"));
  assert.equal(text.match(/ВЬЕТНАМ/g).length, 1);
  assert.ok(text.includes("БИЛЕТЫ ТУДА"));
  assert.ok(text.includes("ОБРАТНЫЕ БИЛЕТЫ"));
  assert.ok(text.includes("ТУДА И ОБРАТНО"));

  // Outbound, inbound and round-trip routes land in their own sections.
  assert.ok(text.includes("Астана - Фукуок\n"));
  assert.ok(text.includes("Фукуок - Астана\n"));
  assert.ok(text.includes("Дананг - Астана\n"));
  assert.ok(text.includes("Алматы - Нячанг\n"));
  assert.ok(text.includes("Астана - Фукуок - Астана\n"));
  assert.ok(/21\.10–28\.10 - 216 000 ₸ \(7 ночей\)/.test(text));

  assert.ok(text.includes("S - SCAT"));
  assert.ok(text.includes("V - VietJet Air"));
  assert.ok(text.endsWith("Цены и наличие уточняются при бронировании."));

  // South Korea is complete and separate.
  const korea = digests.find(digest => digest.country === "KR").text.replace(/<\/?b>/g, "");
  assert.ok(korea.includes("🇰🇷 ЮЖНАЯ КОРЕЯ"));
  assert.ok(korea.includes("Алматы - Сеул"));
  assert.ok(korea.includes("Сеул - Алматы"), "Incheon is normalised to Seoul");
  assert.ok(!korea.includes("ВЬЕТНАМ") && !korea.includes("Фукуок"));
  assert.ok(!text.includes("ЮЖНАЯ КОРЕЯ") && !text.includes("Сеул"));
});

test("the scheduler and publisher deliver the chain once and keep durable state", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "charter-pipeline-")), "state.json");
  const { publishable } = ingest(FULL_FEED);
  const calls = [];
  let nextId = 900;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ method: String(url).split("/").pop(), chatId: body.chat_id, text: body.text });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: body.message_id ?? (nextId += 1) } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  const env = {
    TELEGRAM_BOT_TOKEN: "1:test",
    TELEGRAM_PUBLISH_CHATS: CHAT,
    TELEGRAM_PUBLISH_TIMEZONE: "Asia/Almaty",
    POST_DELAY_SECONDS: "0",
    VITE_MANAGER_WHATSAPP: "77007772414"
  };

  const morning = await runTelegramPublication({
    flights: publishable, now: NOW, env, statePath: path, fetchImpl, logger: null
  });

  assert.equal(morning.window.id, "morning");
  assert.equal(morning.totals.sent, 3);
  assert.equal(morning.channels[0].coverage.complete, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.method === "sendMessage"));

  // Each delivered message names exactly one country.
  for (const call of calls) {
    const names = ["ВЬЕТНАМ", "ЮЖНАЯ КОРЕЯ", "ТАИЛАНД"].filter(name => call.text.includes(name));
    assert.equal(names.length, 1, "mixed countries in one post: " + names.join(","));
  }

  // Every rendered offer is recorded against the channel.
  const stored = await loadPublicationState(path);
  const recorded = Object.values(stored.channels[CHAT].messages).flatMap(m => m.offerIds);
  assert.equal(new Set(recorded).size, publishable.length);
  assert.equal(stored.channels[CHAT].windows["2026-10-12:morning"].status, "completed");

  // A later sync in the same window changes nothing.
  const rerun = await runTelegramPublication({
    flights: publishable, now: new Date(NOW.getTime() + 15 * 60000),
    env, statePath: path, fetchImpl, logger: null
  });
  assert.equal(calls.length, 3, "no duplicate posts from the next sync");
  assert.equal(rerun.channels[0].error, "WINDOW_ALREADY_PUBLISHED");

  // The afternoon window edits only the country whose offers changed.
  const afternoon = await runTelegramPublication({
    flights: publishable.map(flight =>
      classifyFlight(flight).country?.code === "KR" ? { ...flight, price: flight.price + 5000 } : flight
    ),
    now: new Date(Date.UTC(2026, 9, 12, 9, 10)),
    env, statePath: path, fetchImpl, logger: null
  });

  assert.equal(afternoon.totals.edited, 1);
  assert.equal(afternoon.totals.sent, 0);
  // Vietnam and Thailand belong to the morning's Asia window, so the afternoon
  // does not even consider them; South Korea has no region and travels along.
  assert.equal(afternoon.totals.skipped, 0);
  assert.equal(afternoon.totals.outOfWindow, 2);
  assert.equal(calls.length, 4);
  assert.equal(calls[3].method, "editMessageText");
  assert.ok(calls[3].text.includes("ЮЖНАЯ КОРЕЯ"));
});

test("a feed that grows past one message per country still delivers every offer", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "charter-pipeline-big-")), "state.json");
  const lines = ["🇻🇳 ВЬЕТНАМ", "", "VietJet Air", "Астана → Фукуок"];
  for (let day = 1; day <= 28; day += 1) {
    lines.push("V " + String(day).padStart(2, "0") + ".11 — " + (90000 + day * 500) + " ₸ (" + (1 + day % 9) + ")");
  }
  lines.push("", "Алматы → Нячанг");
  for (let day = 1; day <= 28; day += 1) {
    lines.push("S " + String(day).padStart(2, "0") + ".12 — " + (120000 + day * 700) + " ₸");
  }

  const { publishable } = ingest([[lines.join("\n"), "telegram:partner-c", 201]]);
  assert.ok(publishable.length >= 50);

  const calls = [];
  let nextId = 700;
  const report = await runTelegramPublication({
    flights: publishable,
    now: NOW,
    env: {
      TELEGRAM_BOT_TOKEN: "1:test",
      TELEGRAM_PUBLISH_CHATS: CHAT,
      TELEGRAM_PUBLISH_TIMEZONE: "Asia/Almaty",
      POST_DELAY_SECONDS: "0",
      TELEGRAM_MAX_MESSAGE_CHARS: "700"
    },
    statePath: path,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body.text);
      return new Response(JSON.stringify({ ok: true, result: { message_id: (nextId += 1) } }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    },
    logger: null
  });

  assert.ok(report.totals.sent > 1, "the country digest is split across parts");
  assert.equal(report.channels[0].coverage.complete, true);
  assert.equal(report.totals.deferred, 0, "no offer is dropped by a message cap");

  const stored = await loadPublicationState(path);
  const covered = new Set(
    Object.values(stored.channels[CHAT].messages).flatMap(message => message.offerIds)
  );
  assert.equal(covered.size, publishable.length, "every offer is published exactly once");
  assert.ok(calls.every(text => text.length <= 700));
  assert.ok(calls.every(text => text.includes("Часть ")));
});

test("our own published digest is not re-ingested as a new offer", async () => {
  const { publishable } = ingest([[VIETNAM_POST, "telegram:partner-a", 101]]);
  const { digests } = buildCountryDigests(publishable, { now: NOW });
  const published = digests[0].text.replace(/<\/?b>/g, "");

  const { shouldSkipParsedTelegramMessage } = await import("../scripts/telegram-publisher.mjs");
  assert.equal(
    shouldSkipParsedTelegramMessage(published),
    true,
    "a digest we produced must be skipped on ingestion"
  );
});
