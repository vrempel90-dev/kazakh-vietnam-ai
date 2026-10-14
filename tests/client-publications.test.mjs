import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCountryDigests, carrierCode } from "../scripts/telegram-digest.mjs";
import { classifyFlight } from "../scripts/charter-geo.mjs";
import { carrierIdentity, dedupeFlights } from "../scripts/charter-offer.mjs";
import { PUBLICATION_WINDOWS, publicationWindows, filterFlightsForWindow } from "../scripts/telegram-schedule.mjs";
import { runTelegramPublication } from "../scripts/telegram-publish-run.mjs";
import { loadPublicationState, savePublicationState, recordMessageIntent, recordMessageSent,
  recordMessageFailure, planMessageAction, prunePublicationState, runLockPath } from "../scripts/telegram-publication-state.mjs";

const NOW = new Date("2026-10-14T05:05:00Z");
const env = { TELEGRAM_BOT_TOKEN: "test", TELEGRAM_PUBLISH_CHATS: "@fixture_only", POST_DELAY_SECONDS: "0" };
const make = (id, to = "Пхукет", extra = {}) => ({ id, from: "Алматы", to, trip: "OW",
  departureDate: "2026-10-24", price: 123000, ...extra });
const statePath = async () => join(await mkdtemp(join(tmpdir(), "client-publications-")), "state.json");
const plain = text => text.replace(/<\/?b>/g, "");

// CLIENT EXAMPLE: synthetic TEST DATA ONLY. Never imported by collection or publishing.
const clientExample = [
  make("sample-1", "Пхукет", { departureDate: "2026-10-14", price: 215000, seats: "1" }),
  make("sample-2", "Пхукет", { departureDate: "2026-10-28", price: 240000, airline: "SCAT" }),
  make("sample-3", "Пхукет", { departureDate: "2026-10-30", price: 240000, airline: "SCAT" }),
  ...[[23, 64000], [24, 47000], [28, 42000]].map(([day, price]) => make("sample-in-" + day,
    "Астана", { from: "Пхукет", departureDate: "2026-10-" + day, price, airline: "SCAT" })),
  make("sample-rt-1", "Пхукет", { trip: "RT", departureDate: "2026-10-14", returnDate: "2026-10-21", price: 431000 }),
  make("sample-rt-2", "Пхукет", { trip: "RT", departureDate: "2026-10-24", returnDate: "2026-10-31", price: 461000, airline: "SCAT" })
];

test("client Thailand example matches exactly, including bold routes and blank lines", () => {
  const { digests } = buildCountryDigests([...clientExample].reverse(), { now: NOW });
  assert.equal(digests.length, 1);
  assert.equal(digests[0].text, `<b>🇹🇭 ТАИЛАНД</b>

<b>Алматы - Пхукет</b>
В одну сторону

14.10 - 215 000 ₸ (1)
S 28.10 - 240 000 ₸
S 30.10 - 240 000 ₸

<b>Пхукет - Астана</b>
Обратные билеты

S 23.10 - 64 000 ₸
S 24.10 - 47 000 ₸
S 28.10 - 42 000 ₸

<b>Алматы - Пхукет - Алматы</b>
Туда обратно

14.10–21.10 - 431 000 ₸ (7 ночей)
S 24.10–31.10 - 461 000 ₸ (7 ночей)

S - SCAT

Цены и наличие уточняются при бронировании.`);
});

test("no sample offers or fixed destinations are injected into an empty or unrelated feed", () => {
  assert.deepEqual(buildCountryDigests([], { now: NOW }).digests, []);
  const result = buildCountryDigests([make("real-input", "Милан")], { now: NOW });
  assert.equal(result.digests[0].country, "IT");
  assert.equal(result.digests[0].offers, 1);
  assert.doesNotMatch(result.digests[0].text, /Пхукет|ТАИЛАНД|215 000|240 000|431 000/);
});

test("two real dates establish RT even when a source labels it OW; inbound direction stays factual", () => {
  const flight = make("rt", "Алматы", { from: "Пхукет", trip: "OW", returnDate: "2026-10-31", nights: 99 });
  assert.equal(classifyFlight(flight).category, "roundtrip");
  const text = plain(buildCountryDigests([flight], { now: NOW }).digests[0].text);
  assert.match(text, /Пхукет - Алматы - Пхукет\nТуда обратно/);
  assert.match(text, /24.10–31.10 - 123 000 ₸ \(7 ночей\)/);
});

test("invalid calendar dates and incomplete RT are diagnostics, not invented itineraries", () => {
  for (const extra of [{ departureDate: "2026-02-30" }, { trip: "RT" }, { returnDate: "2026-11-31" },
    { returnDate: "2026-10-23" }, { departureDate: "n/a" }]) {
    const result = buildCountryDigests([make("invalid", "Пхукет", extra)], { now: NOW });
    assert.equal(result.digests.length, 0);
    assert.equal(result.diagnostics.length, 1);
  }
});

test("unknown or approximate seats are omitted for OW and RT", () => {
  for (const seats of [undefined, "Наличие уточняется", "Последние места", "от 2 мест", "до 5", "0"]) {
    const text = buildCountryDigests([make("seat", "Пхукет", { seats })], { now: NOW }).digests[0].text;
    assert.doesNotMatch(text, /₸ \(/);
  }
  const text = buildCountryDigests([make("rt-seats", "Пхукет", { trip: "RT", returnDate: "2026-10-31", seats: "2 места" })], { now: NOW }).digests[0].text;
  assert.match(text, /\(7 ночей\) \(2\)/);
});

test("carrier letters are reliable, unknown names retain their identity", () => {
  assert.equal(carrierCode({ airlineCode: "X" }), null);
  assert.equal(carrierCode({ airlineCode: "F" }), null);
  assert.equal(carrierCode({ airlineCode: "S", airline: "Unknown Air" }), null);
  assert.deepEqual(carrierIdentity({ airlineCode: "F", airline: "flydubai" }), { code: "D", name: "flydubai" });
  assert.equal(carrierCode({ airline: "СКАТ" }), "S");
  assert.equal(carrierCode({ airline: "SCAT partner unknown" }), null);
});

test("same-date fares, baggage, seats and other conditions survive collection and rendering", () => {
  const input = [make("legacy", "Пхукет", { airline: "SCAT", baggage: "20 кг" }),
    make("legacy", "Пхукет", { airline: "SCAT", baggage: "0 кг" }),
    make("p2", "Пхукет", { airline: "SCAT", price: 125000 }),
    make("seats", "Пхукет", { airline: "SCAT", seats: "2" }),
    make("fare", "Пхукет", { airline: "SCAT", conditions: { refundable: true } })];
  const collected = dedupeFlights([...input, { ...input[0], from: "ALA", to: "HKT", airline: "СКАТ", sourceIds: ["other"] }]);
  assert.equal(collected.length, 5);
  assert.equal(new Set(collected.map(f => f.id)).size, 5);
  assert.ok(collected.some(f => f.id === "legacy"));
  assert.equal(buildCountryDigests(collected, { now: NOW }).summary.offers, 5);
  assert.equal(buildCountryDigests(input, { now: NOW }).summary.offers, 5, "id collision must not hide a fare");
});

test("collection keeps more than 300 offers and large digests do not lose or repeat rows", () => {
  const input = Array.from({ length: 340 }, (_, i) => make("many-" + i, "Пхукет", { price: 100000 + i }));
  assert.equal(dedupeFlights(input).length, 340);
  const result = buildCountryDigests(input, { maxChars: 450, now: NOW });
  assert.ok(result.digests.length >= 10);
  assert.equal(result.summary.offers, 340);
  assert.equal(new Set(result.digests.flatMap(d => d.offerIds)).size, 340);
  assert.ok(result.digests.every(d => d.text.length <= 450));
});

test("intact routes stay together and the last oversized-route chunk shares a page", () => {
  const input = Array.from({ length: 40 }, (_, i) => make("r-" + i, "Пхукет", { price: 100000 + i }));
  input.push(make("next-route", "Бангкок", { departureDate: "2026-10-25" }));
  const { digests } = buildCountryDigests(input, { maxChars: 700, now: NOW });
  assert.equal(digests.length, 2);
  assert.ok(digests[1].offerIds.includes("next-route"));
  assert.ok(digests[1].offerIds.length > 1, "a sparse third page is unnecessary");
});

const countries = [
  ["VN", "Нячанг"], ["TH", "Пхукет"], ["CN", "Санья"], ["MY", "Куала-Лумпур"],
  ["MV", "Мале"], ["LK", "Коломбо"], ["IN", "Гоа"], ["AE", "Дубай"], ["OM", "Маскат"],
  ["EG", "Хургада"], ["IT", "Милан"], ["CZ", "Прага"], ["RS", "Белград"], ["HU", "Будапешт"], ["DE", "Берлин"]
];

test("all 15 client countries and both directions belong only to their configured window", () => {
  const input = countries.flatMap(([code, city]) => [make(code, city), make(code + "-in", "Алматы", { from: city })]);
  for (const window of PUBLICATION_WINDOWS) {
    const selected = filterFlightsForWindow(input, window);
    assert.deepEqual([...new Set(selected.eligible.map(f => classifyFlight(f).country.code))], window.countries);
    assert.equal(selected.eligible.length, window.countries.length * 2);
  }
  assert.equal(filterFlightsForWindow([make("kr", "Сеул"), make("tr", "Анталия")], PUBLICATION_WINDOWS[0]).eligible.length, 0);
});

test("country lists and windows accept configuration and reject overlap, typos and ambiguity", () => {
  const config = [{ id: "custom", startHour: 9, endHour: 10, kind: "full", countries: ["KR"] }];
  assert.equal(publicationWindows({ TELEGRAM_PUBLICATION_WINDOWS_JSON: JSON.stringify(config) })[0].startHour, 9);
  for (const bad of ["{", "[]", JSON.stringify([{ ...config[0], countries: ["XX"] }]),
    JSON.stringify([...config, { ...config[0], id: "overlap", countries: ["VN"] }])]) {
    assert.throws(() => publicationWindows({ TELEGRAM_PUBLICATION_WINDOWS_JSON: bad }), /INVALID_PUBLICATION_WINDOWS/);
  }
});

test("each regional window sends only its countries; default destinations stay stored", async () => {
  const path = await statePath();
  const flights = countries.map(([id, city]) => make(id, city));
  flights.push(make("KR", "Сеул"));
  const original = JSON.stringify(flights);
  for (const [i, hour] of [10, 14, 17].entries()) {
    const sent = [];
    const report = await runTelegramPublication({ flights, env, statePath: path,
      now: new Date(Date.UTC(2026, 9, 14, hour - 5, 5)), logger: null,
      fetchImpl: async (url, options) => { sent.push(JSON.parse(options.body).text);
        return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length + i * 20 } })); } });
    assert.equal(sent.length, PUBLICATION_WINDOWS[i].countries.length);
    assert.equal(report.channels[0].coverage.excludedByRegion, flights.length - sent.length);
    assert.equal(report.channels[0].coverage.complete, true);
  }
  assert.equal(JSON.stringify(flights), original);
});

test("invalid configuration, off-volume state and production window bypass never call Telegram", async () => {
  const path = await statePath();
  const common = { flights: [make("x")], now: NOW, statePath: path, logger: null,
    fetchImpl: () => assert.fail("must not send") };
  for (const options of [
    { env: { ...env, TELEGRAM_PUBLICATION_WINDOWS_JSON: "bad" } },
    { env: { ...env, TELEGRAM_PUBLISH_TIMEZONE: "UTC" } },
    { env: { ...env, RAILWAY_DEPLOYMENT_ID: "test", RAILWAY_VOLUME_MOUNT_PATH: "/data" } },
    { env, ignoreWindow: true }
  ]) assert.equal((await runTelegramPublication({ ...common, ...options })).skipped, true);
});

test("a run stops before sending the next part when its regional window closes", async () => {
  const path = await statePath();
  let moment = new Date("2026-10-14T06:59:59Z");
  let sends = 0;
  const report = await runTelegramPublication({ flights: [make("th"), make("vn", "Нячанг")], env,
    now: moment, clock: () => moment, statePath: path, logger: null,
    fetchImpl: async () => { sends++; moment = new Date("2026-10-14T07:00:00Z");
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })); } });
  assert.equal(sends, 1);
  assert.equal(report.totals.deferred, 1);
  assert.equal(report.channels[0].messages[1].reason, "PUBLICATION_WINDOW_CLOSED_DURING_RUN");
});

test("pending crash attempts remain held after reload and retention; a failed edit reuses its message", async () => {
  const path = await statePath();
  const state = await loadPublicationState(path);
  const digest = buildCountryDigests([make("th")], { now: NOW }).digests[0];
  recordMessageIntent(state, "@fixture_only", digest.key, { ...digest, now: new Date("2026-01-01") });
  await savePublicationState(path, state);
  const restored = await loadPublicationState(path);
  prunePublicationState(restored, { now: NOW });
  assert.equal(planMessageAction(restored, "@fixture_only", digest).action, "hold");
  recordMessageSent(restored, "@fixture_only", digest.key, { messageId: 42 });
  recordMessageIntent(restored, "@fixture_only", digest.key, { ...digest, action: "edit", messageId: 42 });
  recordMessageFailure(restored, "@fixture_only", digest.key, { definitive: true });
  assert.equal(planMessageAction(restored, "@fixture_only", digest).action, "edit");
});

test("corrupt state stops delivery, preserves bytes and releases this run's lock", async () => {
  const path = await statePath();
  for (const bytes of ["{broken", '{"version":999,"channels":{}}', '{"version":2,"channels":{"x":null}}',
    '{"version":2,"channels":{"x":{"windows":{},"messages":{"TH#1":{"status":"broken"}}}}}']) {
    await writeFile(path, bytes);
    const report = await runTelegramPublication({ flights: [make("x")], now: NOW, env, statePath: path,
      logger: null, fetchImpl: () => assert.fail("must not send") });
    assert.equal(report.reason, "PUBLICATION_STATE_UNREADABLE");
    assert.equal(await readFile(path, "utf8"), bytes);
    await assert.rejects(() => readFile(runLockPath(path)), { code: "ENOENT" });
  }
});

test("separate processes compete on the durable mutex and a new process cannot repeat a completed window", async () => {
  const path = await statePath();
  const execute = promisify(execFile);
  const worker = `import {runTelegramPublication} from ${JSON.stringify(new URL("../scripts/telegram-publish-run.mjs", import.meta.url).href)};
    let calls=0; const result=await runTelegramPublication({flights:${JSON.stringify([make("process")])},
    now:new Date(${JSON.stringify(NOW.toISOString())}),env:${JSON.stringify(env)},statePath:process.argv[1],logger:null,
    fetchImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,100));return new Response(JSON.stringify({ok:true,result:{message_id:9}}));}});
    console.log(JSON.stringify({calls,reason:result.reason}));`;
  const run = async () => JSON.parse((await execute(process.execPath, ["--input-type=module", "-e", worker, path])).stdout);
  const results = await Promise.all([run(), run()]);
  assert.equal(results.reduce((sum, r) => sum + r.calls, 0), 1);
  assert.equal((await run()).calls, 0);
});
