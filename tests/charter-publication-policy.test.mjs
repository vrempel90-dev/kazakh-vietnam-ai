/**
 * The client's acceptance list, as executable checks.
 *
 * Two failures are covered here. Offers that should have been published were
 * being lost - Astana -> Phu Quoc above all - and offers that must never be
 * published were reaching the channel: Uzbekistan, Saudi Arabia and routes
 * between two foreign countries such as Sharjah -> Tashkent.
 *
 * Each test names the specific mechanism that used to break, so a regression
 * reports which one came back rather than just "a count changed".
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  extractPublicTelegramPosts,
  parseRouteLine,
  parseTelegramPost
} from "../scripts/telegram-source-adapter.mjs";
import { classifyFlight, resolveCity } from "../scripts/charter-geo.mjs";
import {
  evaluateOfferForPublication,
  partitionOffersByPolicy
} from "../scripts/charter-publication-policy.mjs";
import { validateFlightsForPublication } from "../scripts/flight-validator.mjs";
import { buildCountryDigests } from "../scripts/telegram-digest.mjs";
import { allowedCountryCodes, localDayOffset } from "../scripts/telegram-schedule.mjs";
import { runTelegramPublication } from "../scripts/telegram-publish-run.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 10:30 Asia/Almaty on 21 October 2026, inside the Asia window. */
const NOW = new Date("2026-10-21T05:30:00Z");
const TODAY = "2026-10-21";
const TOMORROW = "2026-10-22";

const offer = (overrides = {}) => ({
  id: "f-" + Math.random().toString(36).slice(2),
  from: "Астана",
  to: "Фукуок",
  trip: "OW",
  departureDate: "2026-10-28",
  price: 250000,
  seats: "3 мест",
  airline: "VietJet Air",
  airlineCode: "V",
  sourceIds: ["telegram:source-a"],
  ...overrides
});

const plain = text => text.replace(/<\/?b>/g, "");

async function statePath(name) {
  return join(await mkdtemp(join(tmpdir(), "charter-policy-" + name + "-")), "state.json");
}

function recorder() {
  const calls = [];
  let messageId = 5000;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ method: String(url).split("/").pop(), text: body.text, messageId: body.message_id ?? null });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: body.message_id ?? (messageId += 1) } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };
  return { calls, fetchImpl };
}

const publishEnv = {
  TELEGRAM_BOT_TOKEN: "1:test",
  TELEGRAM_PUBLISH_CHATS: "-1002106608923",
  TELEGRAM_PUBLISH_TIMEZONE: "Asia/Almaty",
  POST_DELAY_SECONDS: "0"
};

/* ---------------------------------------------- problem 1: offers were lost */

test("Astana -> Phu Quoc survives an HTML-escaped route arrow", () => {
  // t.me serves a channel's "Астана -> Фукуок" as "Астана -&gt; Фукуок". The
  // entity was never decoded, the route split at the dash, and the city became
  // the literal string "&gt; Фукуок" - unresolvable, so the offer was dropped
  // at the very last step. This single gap cost about a third of the feed.
  assert.deepEqual(
    parseRouteLine("Астана -&gt; Фукуок"),
    { from: "Астана", to: "Фукуок", trip: "OW" }
  );
  assert.deepEqual(
    parseRouteLine("Фукуок -&gt; Астана"),
    { from: "Фукуок", to: "Астана", trip: "OW" }
  );
  // A bare ">" is a separator too, which it never got the chance to be before.
  assert.deepEqual(
    parseRouteLine("Алматы &gt; Пхукет"),
    { from: "Алматы", to: "Пхукет", trip: "OW" }
  );
  // The resolver itself is hardened as a second line of defence.
  assert.equal(resolveCity("&gt; Фукуок")?.name, "Фукуок");
});

test("Astana -> Phu Quoc reaches a published digest from raw channel HTML", () => {
  const html = '<div class="tgme_widget_message_wrap">'
    + '<div class="tgme_widget_message" data-post="step2/4821"></div>'
    + '<time datetime="2026-10-21T04:00:00+00:00"></time>'
    + '<div class="tgme_widget_message_text js-message_text">'
    + 'VietJet Air, багаж 20 кг<br>Астана -&gt; Фукуок<br>V 28.10 - 250 000 ₸ (3)<br>'
    + 'Фукуок -&gt; Астана<br>V 29.10 - 240 000 ₸ (2)'
    + '</div></div>';

  const posts = extractPublicTelegramPosts(html);
  assert.equal(posts.length, 1);
  assert.ok(!posts[0].text.includes("&gt;"), "entities are decoded before parsing");

  const parsed = parseTelegramPost(posts[0].text, {
    sourceId: "telegram:step2",
    postId: 4821,
    postedAt: "2026-10-21T04:00:00Z",
    now: NOW
  });
  assert.equal(parsed.length, 2);
  assert.deepEqual(
    parsed.map(item => item.from + ">" + item.to).sort(),
    ["Астана>Фукуок", "Фукуок>Астана"]
  );

  const flights = parsed.map((item, index) => ({
    ...offer({ id: "pq-" + index }),
    from: item.from,
    to: item.to,
    departureDate: item.departureDate,
    price: item.sourcePrice
  }));

  const { verified } = validateFlightsForPublication(flights, { now: NOW });
  assert.equal(verified.length, 2, "neither direction is quarantined");

  const { digests, diagnostics } = buildCountryDigests(verified, { now: NOW });
  assert.equal(diagnostics.length, 0);
  assert.equal(digests.length, 1, "one country, one message");
  const text = plain(digests[0].text);
  assert.ok(text.includes("Астана - Фукуок"), "the outbound route is published");
  assert.ok(text.includes("Фукуок - Астана"), "the inbound route is published");
  assert.ok(text.includes("БИЛЕТЫ ТУДА"));
  assert.ok(text.includes("ОБРАТНЫЕ БИЛЕТЫ"));
});

test("Almaty -> Phuket is processed correctly", () => {
  const verdict = evaluateOfferForPublication(offer({ from: "Алматы", to: "Пхукет" }));
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.countryCode, "TH");
  assert.equal(verdict.classification.category, "outbound");
});

test("Phu Quoc -> Astana is allowed as an inbound ticket", () => {
  const verdict = evaluateOfferForPublication(offer({ from: "Фукуок", to: "Астана" }));
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.countryCode, "VN");
  assert.equal(verdict.classification.category, "inbound");
});

test("a departure today is kept and marked urgent", () => {
  assert.equal(localDayOffset(TODAY, NOW), 0);

  const today = offer({ id: "today", departureDate: TODAY, price: 199000 });
  assert.equal(evaluateOfferForPublication(today).allowed, true);

  const { verified, rejected } = validateFlightsForPublication([today], { now: NOW });
  assert.equal(rejected.length, 0, "a same-day departure is not 'out of range'");
  assert.equal(verified.length, 1);

  const text = plain(buildCountryDigests(verified, { now: NOW }).digests[0].text);
  assert.ok(text.includes("21.10"));
  assert.ok(text.includes("сегодня"), "a same-day departure is flagged for the customer");
});

test("a departure tomorrow is kept and marked", () => {
  assert.equal(localDayOffset(TOMORROW, NOW), 1);

  const tomorrow = offer({ id: "tomorrow", departureDate: TOMORROW, price: 205000 });
  const { verified, rejected } = validateFlightsForPublication([tomorrow], { now: NOW });
  assert.equal(rejected.length, 0);
  assert.equal(verified.length, 1);

  const text = plain(buildCountryDigests(verified, { now: NOW }).digests[0].text);
  assert.ok(text.includes("завтра"));
});

test("the parser keeps a flight leaving today instead of discarding it", () => {
  const post = [
    "Астана -&gt; Фукуок",
    "V 21.10 - 199 000 ₸ (2)",
    "V 22.10 - 205 000 ₸ (3)",
    "V 20.10 - 180 000 ₸ (1)"
  ].join("\n");

  const dropped = [];
  const parsed = parseTelegramPost(post, {
    sourceId: "telegram:step2", postId: 1, postedAt: NOW.toISOString(), now: NOW, dropped
  });

  assert.deepEqual(parsed.map(item => item.departureDate), [TODAY, TOMORROW]);
  assert.equal(parsed[0].hot, true, "today's departure is urgent");
  assert.equal(parsed[0].departureOffset, 0);
  assert.equal(parsed[1].departureOffset, 1);

  // The past departure is refused with a reason rather than vanishing.
  assert.deepEqual(dropped.map(item => item.reason), ["DEPARTURE_IN_THE_PAST"]);
});

test("a stale offer is rejected with a named reason, never published", () => {
  const stale = offer({ id: "stale", departureDate: "2026-09-01" });
  const { verified, rejected } = validateFlightsForPublication([stale], { now: NOW });

  assert.equal(verified.length, 0);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, "DEPARTURE_IN_THE_PAST");
  assert.equal(buildCountryDigests(verified, { now: NOW }).digests.length, 0);
});

test("duplicates collapse to one line and never produce a second post", () => {
  const base = offer({ id: "dup-1" });
  const { digests, duplicates, summary } = buildCountryDigests([
    base,
    { ...base },
    { ...base, id: "dup-2" },
    { ...base, id: "dup-3" }
  ], { now: NOW });

  assert.equal(digests.length, 1);
  assert.ok(duplicates >= 1);
  assert.equal(summary.offers, 1, "one distinct offer");
  const lines = plain(digests[0].text).split("\n").filter(line => line.includes("250 000 ₸"));
  assert.equal(lines.length, 1);
});

test("more than 300 eligible offers all survive, with no artificial cap", () => {
  // `dedupeFlights` used to end with `.slice(0, 300)`. Because the list is
  // sorted by departure date, that silently cut the far end of the season -
  // and reported nothing anywhere.
  const many = Array.from({ length: 420 }, (_, index) => offer({
    id: "bulk-" + index,
    from: index % 2 ? "Алматы" : "Астана",
    to: ["Фукуок", "Пхукет", "Санья", "Мале", "Гоа", "Коломбо", "Куала-Лумпур"][index % 7],
    departureDate: "2026-11-" + String(1 + (index % 28)).padStart(2, "0"),
    price: 100000 + index * 211,
    airlineCode: ["V", "S", "A"][index % 3]
  }));

  const { allowed, refused } = partitionOffersByPolicy(many);
  assert.equal(allowed.length, 420, "the route gate drops none of them");
  assert.equal(refused.length, 0);

  const { verified } = validateFlightsForPublication(allowed, { now: NOW });
  assert.equal(verified.length, 420, "validation drops none of them");

  const { digests, summary } = buildCountryDigests(verified, { now: NOW });
  assert.equal(summary.offers, 420, "every offer is rendered");

  const rendered = digests.flatMap(digest => digest.offerIds);
  assert.equal(rendered.length, 420, "no offer appears twice");
  assert.equal(new Set(rendered).size, 420);
  assert.equal(summary.oversized, 0, "every part fits a Telegram message");
});

/* ------------------------------------- problem 2: forbidden routes were sent */

test("Sharjah -> Tashkent is refused: a route between two foreign countries", () => {
  const verdict = evaluateOfferForPublication(offer({ from: "Шарджа", to: "Ташкент" }));
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "FOREIGN_TO_FOREIGN_ROUTE");
  // The classifier still recognises it; it is the policy that refuses it.
  assert.equal(verdict.classification.category, "foreign");
});

test("a foreign-to-foreign route is refused even when one end is an allowed country", () => {
  for (const [from, to] of [
    ["Шарджа", "Ташкент"],
    ["Дубай", "Бангкок"],
    ["Стамбул", "Фукуок"],
    ["Ташкент", "Дубай"]
  ]) {
    const verdict = evaluateOfferForPublication(offer({ from, to }));
    assert.equal(verdict.allowed, false, from + " -> " + to + " must be refused");
    assert.equal(verdict.reason, "FOREIGN_TO_FOREIGN_ROUTE");
  }
});

test("Uzbekistan never reaches a publication", () => {
  for (const [from, to] of [["Алматы", "Ташкент"], ["Ташкент", "Алматы"], ["Астана", "Самарканд"]]) {
    const verdict = evaluateOfferForPublication(offer({ from, to }));
    assert.equal(verdict.allowed, false, from + " -> " + to);
    assert.equal(verdict.reason, "COUNTRY_NOT_ALLOWED");
    assert.equal(verdict.countryCode, "UZ");
  }

  const { digests, diagnostics } = buildCountryDigests([
    offer({ id: "uz", from: "Алматы", to: "Ташкент" })
  ], { now: NOW });
  assert.equal(digests.length, 0);
  assert.equal(diagnostics[0].reason, "COUNTRY_NOT_ALLOWED");
});

test("Saudi Arabia never reaches a publication", () => {
  for (const city of ["Джидда", "Медина", "Рияд"]) {
    const verdict = evaluateOfferForPublication(offer({ from: "Алматы", to: city }));
    assert.equal(verdict.allowed, false, city);
    assert.equal(verdict.reason, "COUNTRY_NOT_ALLOWED");
    assert.equal(verdict.countryCode, "SA");
  }
  assert.equal(
    buildCountryDigests([offer({ id: "sa", from: "Алматы", to: "Джидда" })], { now: NOW }).digests.length,
    0
  );
});

test("an unknown country is never published", () => {
  const verdict = evaluateOfferForPublication(offer({ to: "Нигдеград" }));
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "UNRESOLVED_DESTINATION");
  assert.equal(verdict.countryCode, null);

  // Parser noise that used to look like a route must not become a country.
  for (const to of ["&gt; Нигдеград", "Business от 194 000", "НОЯБРЬ", "бронируйте сейчас!"]) {
    assert.equal(evaluateOfferForPublication(offer({ to })).allowed, false, to);
  }
});

test("every country outside the agreed list is refused", () => {
  const forbidden = {
    UZ: "Ташкент", SA: "Джидда", TR: "Анталия", KR: "Сеул", RU: "Москва",
    GE: "Тбилиси", AZ: "Баку", KG: "Бишкек", QA: "Доха", JP: "Токио",
    ES: "Барселона", FR: "Париж", GB: "Лондон", AT: "Вена", PL: "Варшава"
  };
  for (const [code, city] of Object.entries(forbidden)) {
    const verdict = evaluateOfferForPublication(offer({ from: "Алматы", to: city }));
    assert.equal(verdict.allowed, false, code + " (" + city + ") must be refused");
    assert.equal(verdict.reason, "COUNTRY_NOT_ALLOWED");
  }
});

test("all fifteen agreed countries are publishable in both directions", () => {
  const cities = {
    VN: "Фукуок", TH: "Пхукет", CN: "Санья", MY: "Куала-Лумпур", MV: "Мале",
    LK: "Коломбо", IN: "Гоа", AE: "Дубай", OM: "Маскат", EG: "Хургада",
    IT: "Милан", CZ: "Прага", RS: "Белград", HU: "Будапешт", DE: "Мюнхен"
  };
  assert.deepEqual(Object.keys(cities).sort(), allowedCountryCodes());

  for (const [code, city] of Object.entries(cities)) {
    const out = evaluateOfferForPublication(offer({ from: "Алматы", to: city }));
    assert.equal(out.allowed, true, "Алматы -> " + city);
    assert.equal(out.countryCode, code);
    assert.equal(out.classification.category, "outbound");

    const back = evaluateOfferForPublication(offer({ from: city, to: "Алматы" }));
    assert.equal(back.allowed, true, city + " -> Алматы");
    assert.equal(back.countryCode, code);
    assert.equal(back.classification.category, "inbound");
  }
});

test("a domestic Kazakhstan hop is not published as an international offer", () => {
  const verdict = evaluateOfferForPublication(offer({ from: "Алматы", to: "Астана" }));
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "DOMESTIC_ROUTE");
});

test("nothing forbidden is delivered to Telegram, and every refusal is reported", async () => {
  const feed = [
    offer({ id: "ok-vn", from: "Астана", to: "Фукуок" }),
    offer({ id: "ok-th", from: "Алматы", to: "Пхукет" }),
    offer({ id: "bad-uz", from: "Алматы", to: "Ташкент" }),
    offer({ id: "bad-sa", from: "Алматы", to: "Джидда" }),
    offer({ id: "bad-ff", from: "Шарджа", to: "Ташкент" }),
    offer({ id: "bad-tr", from: "Алматы", to: "Анталия" }),
    offer({ id: "bad-unknown", from: "Алматы", to: "Нигдеград" })
  ];

  const run = recorder();
  const report = await runTelegramPublication({
    flights: feed, now: NOW, env: publishEnv,
    statePath: await statePath("forbidden"), fetchImpl: run.fetchImpl, logger: null
  });

  assert.equal(report.totals.sent, 2, "only Vietnam and Thailand are published");
  assert.deepEqual(
    report.channels[0].diagnostics.map(item => item.id + ":" + item.reason).sort(),
    [
      "bad-ff:FOREIGN_TO_FOREIGN_ROUTE",
      "bad-sa:COUNTRY_NOT_ALLOWED",
      "bad-tr:COUNTRY_NOT_ALLOWED",
      "bad-unknown:UNRESOLVED_DESTINATION",
      "bad-uz:COUNTRY_NOT_ALLOWED"
    ]
  );
  assert.equal(report.channels[0].coverage.complete, true, "every offer is accounted for");

  for (const word of ["Ташкент", "Джидда", "Шарджа", "Анталия", "Нигдеград", "УЗБЕКИСТАН", "ТУРЦИЯ"]) {
    assert.ok(run.calls.every(call => !call.text.includes(word)), word + " must never be sent");
  }
});

test("a live message is never rewritten, only reported", () => {
  // This replaces a test that asserted the opposite. An earlier build edited
  // any same-day post whose country had left the allowed list into a
  // withdrawal notice, and on 22.10.2026 it did that to real customer-facing
  // digests: the deploy landed at 11:43 Almaty, inside the morning window, and
  // the next sync rewrote the Turkiye and South Korea posts published at 10:06
  // that morning into a notice carrying a "Купить билет" button and no
  // tickets. Removing a published message is a human decision.
  const source = readFileSync(
    new URL("../scripts/telegram-publish-run.mjs", import.meta.url),
    "utf8"
  );
  assert.ok(!source.includes("RETRACTION_TEXT"), "the notice text is gone");
  assert.ok(!source.includes("Подборка снята с публикации"), "the notice body is gone");
  assert.ok(!source.includes("recordMessageRetracted"), "the state writer is gone");

  const state = readFileSync(
    new URL("../scripts/telegram-publication-state.mjs", import.meta.url),
    "utf8"
  );
  assert.ok(!state.includes("recordMessageRetracted"), "no retraction writer survives");
});

test("a forbidden country already live is reported without any Telegram call", async () => {
  const path = await statePath("report-forbidden");

  const first = recorder();
  await runTelegramPublication({
    flights: [offer({ id: "vn", from: "Астана", to: "Фукуок" })],
    now: NOW, env: publishEnv, statePath: path, fetchImpl: first.fetchImpl, logger: null
  });
  const liveMessageId = first.calls[0].messageId ?? 5001;

  // Rewrite the stored record into a country the list no longer allows, as a
  // record left behind by an earlier build looks.
  const { loadPublicationState, savePublicationState } =
    await import("../scripts/telegram-publication-state.mjs");
  const state = await loadPublicationState(path);
  const channel = state.channels[publishEnv.TELEGRAM_PUBLISH_CHATS];
  const FORBIDDEN_MESSAGE_ID = liveMessageId + 7;
  channel.messages["TR#1"] = {
    ...channel.messages["VN#1"],
    messageId: FORBIDDEN_MESSAGE_ID,
    country: "TR",
    countryName: "Турция"
  };
  await savePublicationState(path, state);

  const second = recorder();
  const report = await runTelegramPublication({
    flights: [offer({ id: "vn2", from: "Астана", to: "Фукуок", price: 260000 })],
    now: NOW, env: publishEnv, statePath: path, fetchImpl: second.fetchImpl, logger: null
  });

  // Reported, and nothing was done to it.
  assert.deepEqual(
    report.channels[0].forbiddenLiveMessages.map(item => item.key + ":" + item.reason),
    ["TR#1:COUNTRY_NOT_ALLOWED"]
  );
  assert.equal(report.channels[0].forbiddenLiveMessages[0].messageId, FORBIDDEN_MESSAGE_ID);
  assert.ok(
    second.calls.every(call => call.messageId !== FORBIDDEN_MESSAGE_ID),
    "the live forbidden message is not touched"
  );
  assert.ok(
    second.calls.every(call => !call.text.includes("снята с публикации")),
    "no withdrawal notice is ever sent"
  );

  const stored = await loadPublicationState(path);
  const kept = stored.channels[publishEnv.TELEGRAM_PUBLISH_CHATS].messages["TR#1"];
  assert.equal(kept.messageId, FORBIDDEN_MESSAGE_ID, "its record is left exactly as it was");
  assert.equal(kept.contentHash, channel.messages["TR#1"].contentHash);
});

test("the customer feed is filtered by the same gate as the channel", () => {
  const { allowed, refused, allowedCountries } = partitionOffersByPolicy([
    offer({ id: "ok-1", from: "Астана", to: "Фукуок" }),
    offer({ id: "ok-2", from: "Нячанг", to: "Алматы" }),
    offer({ id: "no-1", from: "Алматы", to: "Ташкент" }),
    offer({ id: "no-2", from: "Шарджа", to: "Ташкент" }),
    offer({ id: "no-3", from: "Алматы", to: "Джидда" })
  ]);

  assert.deepEqual(allowed.map(item => item.id), ["ok-1", "ok-2"]);
  assert.deepEqual(
    refused.map(item => item.id + ":" + item.reason),
    ["no-1:COUNTRY_NOT_ALLOWED", "no-2:FOREIGN_TO_FOREIGN_ROUTE", "no-3:COUNTRY_NOT_ALLOWED"]
  );
  assert.equal(allowedCountries.length, 15);
});

test("one country still produces exactly one publication", () => {
  const feed = [
    offer({ id: "a", from: "Астана", to: "Фукуок", departureDate: "2026-10-28" }),
    offer({ id: "b", from: "Алматы", to: "Нячанг", departureDate: "2026-10-29" }),
    offer({ id: "c", from: "Фукуок", to: "Астана", departureDate: "2026-10-30" }),
    offer({ id: "d", from: "Астана", to: "Фукуок", trip: "RT", departureDate: "2026-10-28", returnDate: "2026-11-04" })
  ];
  const { digests } = buildCountryDigests(feed, { now: NOW });

  assert.equal(digests.length, 1, "one country, one message");
  const text = plain(digests[0].text);
  assert.equal(text.match(/ВЬЕТНАМ/g).length, 1);
  assert.ok(text.includes("БИЛЕТЫ ТУДА"));
  assert.ok(text.includes("ОБРАТНЫЕ БИЛЕТЫ"));
  assert.ok(text.includes("ТУДА И ОБРАТНО"));
  assert.ok(!text.includes("МЕЖДУ СТРАНАМИ"), "the third-country section is gone");
});

test("classifyFlight marks a foreign-to-foreign route with its own reason", () => {
  const classification = classifyFlight({ from: "Шарджа", to: "Ташкент", trip: "OW" });
  assert.equal(classification.category, "foreign");
  assert.equal(classification.reason, "FOREIGN_TO_FOREIGN_ROUTE");
});

/* ------------------- the four unresolved forms found in live channel data */

test("a route heading with a trailing month marker still resolves", () => {
  // biletuu appends the month to the heading: "Antalya Shymkent
  // (Анталья -> Шымкент) (ноябрь". An end-anchored search for the bracketed
  // form picked up "(ноябрь" and the route in the first group was never seen,
  // so six real offers were reported as an unreadable origin instead of as
  // Turkiye, which is simply not on the list.
  assert.deepEqual(
    parseRouteLine("Antalya Shymkent (Анталья -> Шымкент) (ноябрь"),
    { from: "Анталия", to: "Шымкент", trip: "OW" }
  );
  assert.deepEqual(
    parseRouteLine("Astana Phu Quoc (Астана -> Фукуок) (декабрь)"),
    { from: "Астана", to: "Фукуок", trip: "OW" }
  );

  // The refusal now names the real reason.
  const verdict = evaluateOfferForPublication(offer({ from: "Анталия", to: "Шымкент" }));
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reason, "COUNTRY_NOT_ALLOWED");
  assert.equal(verdict.countryCode, "TR");
});

test("a \"Country, City\" destination resolves to the city", () => {
  // "Астана -> Таиланд, Патонг" is a real Thailand ticket - an allowed
  // country - that was refused as an unresolvable destination.
  assert.equal(resolveCity("Таиланд, Патонг")?.name, "Пхукет");
  assert.equal(resolveCity("Патонг")?.name, "Пхукет", "Patong flies through HKT");

  const verdict = evaluateOfferForPublication(offer({ from: "Астана", to: "Таиланд, Патонг" }));
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.countryCode, "TH");
  assert.equal(verdict.classification.category, "outbound");
});

test("a comma form naming two cities is refused, never guessed", () => {
  assert.equal(resolveCity("Алматы, Астана"), null);
  assert.equal(resolveCity("Фукуок, Нячанг"), null);
});

test("a Russian city resolves so its refusal names the country, not a parse failure", () => {
  // Krasnoyarsk was absent from the table, so twelve real offers were reported
  // as unreadable routes. Russia is not on the allowed list; the refusal must
  // say that.
  assert.equal(resolveCity("Красноярск")?.name, "Красноярск");
  assert.equal(resolveCity("Красноярска")?.name, "Красноярск");

  for (const [from, to] of [["Шымкент", "Красноярск"], ["Красноярск", "Шымкент"]]) {
    const verdict = evaluateOfferForPublication(offer({ from, to }));
    assert.equal(verdict.allowed, false, from + " -> " + to);
    assert.equal(verdict.reason, "COUNTRY_NOT_ALLOWED");
    assert.equal(verdict.countryCode, "RU");
  }
});

test("the Phuket to Almaty hold is intact and scoped to that one direction", () => {
  // Four independent channels carry this route with matching dates and prices,
  // but charter channels repost each other, so that is corroboration and not
  // verification. The hold stays until the carrier and the direction are
  // confirmed from a source that is not the channels themselves.
  const held = [
    { id: "scat", from: "Пхукет", to: "Алматы", airlineCode: "S", airline: "Scat" },
    { id: "named-scat", from: "Пхукет", to: "Алматы", airline: "SCAT" },
    { id: "no-carrier", from: "Пхукет", to: "Алматы" },
    { id: "star-no-name", from: "Пхукет", to: "Алматы", airlineCode: "*" }
  ].map(item => offer({ ...item, airlineCode: item.airlineCode, airline: item.airline }));

  const result = validateFlightsForPublication(held, { now: NOW });
  assert.equal(result.verified.length, 0, "nothing on this route is published");
  assert.deepEqual(
    result.needsReview.map(item => item.flight.id + ":" + item.reason).sort(),
    [
      "named-scat:DISPUTED_SCAT_PHUKET_ALMATY_ROUTE",
      "no-carrier:UNVERIFIED_CARRIER_PHUKET_ALMATY_ROUTE",
      "scat:DISPUTED_SCAT_PHUKET_ALMATY_ROUTE",
      "star-no-name:UNVERIFIED_CARRIER_PHUKET_ALMATY_ROUTE"
    ]
  );

  // The hold is for Phuket -> Almaty one-way only: the outbound direction and
  // other Kazakhstan cities are unaffected.
  const unaffected = [
    offer({ id: "outbound", from: "Алматы", to: "Пхукет", airlineCode: "S", airline: "Scat" }),
    offer({ id: "astana", from: "Пхукет", to: "Астана", airlineCode: "S", airline: "Scat" })
  ];
  const clean = validateFlightsForPublication(unaffected, { now: NOW });
  assert.deepEqual(clean.verified.map(item => item.id).sort(), ["astana", "outbound"]);
  assert.equal(clean.needsReview.length, 0);
});
