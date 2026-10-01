import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFlightPostBatches, countryForFlight, parsePublishTargets, telegramTextLength, telegramPublicationWindowStatus } from "../scripts/telegram-publisher.mjs";
import { loadPublicationState, markFlightsPublished, prunePublicationState, isHotPublicationPending } from "../scripts/telegram-publication-state.mjs";
import { assertDurablePublicationStorage, localPublicationClock, pruneCompletedHotPlan, runTelegramPublication } from "../scripts/telegram-publication-job.mjs";

const offer = (i, fields = {}) => ({ id: "flight-" + i, from: "Алматы", to: "Дубай",
  departureDate: "2026-10-" + String(2 + i % 28).padStart(2, "0"), price: 90000 + i * 1000,
  trip: "OW", airline: "SCAT", ...fields });

test("large country digests split into numbered posts without dropping offers or details", () => {
  const flights = Array.from({ length: 200 }, (_, i) => offer(i));
  const posts = buildFlightPostBatches(flights);
  assert.ok(posts.length > 1);
  assert.deepEqual(posts.flatMap(post => post.flightIds).sort(), flights.map(f => f.id).sort());
  for (const [i, post] of posts.entries()) {
    assert.ok(post.text.includes(`часть ${i + 1}/${posts.length}`));
    assert.ok(post.text.includes("SCAT"));
    assert.ok(telegramTextLength(post.text) <= 4096);
  }
});

test("24 UAE flights remain in one post when the full text fits", () => {
  const posts = buildFlightPostBatches(Array.from({ length: 24 }, (_, i) => offer(i)));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].flightIds.length, 24);
});

test("HTML entities count after parsing and extreme individual fields continue without truncation", () => {
  const airline = "<operator & partner>".repeat(300);
  const posts = buildFlightPostBatches([offer(0, { airline })]);
  assert.ok(posts.length > 1);
  assert.ok(posts.every(p => telegramTextLength(p.text) <= 4096 && !p.text.includes("<operator")));
  for (const entity of ["&lt;", "&amp;", "&gt;"])
    assert.equal(posts.map(p => p.text).join("").split(entity).length - 1, 300);
});

test("publication and daily digest use the Almaty calendar at every specified boundary", () => {
  for (const [utc, local, open, digest] of [
    ["2026-10-01T18:59Z", "23:59", false, false], ["2026-10-01T19:01Z", "00:01", false, false],
    ["2026-10-02T04:59Z", "09:59", false, false], ["2026-10-02T05:00Z", "10:00", true, true],
    ["2026-10-02T06:59Z", "11:59", true, true], ["2026-10-02T07:00Z", "12:00", true, false],
    ["2026-10-02T14:59Z", "19:59", true, false], ["2026-10-02T15:00Z", "20:00", false, false]
  ]) {
    const clock = localPublicationClock(new Date(utc));
    assert.equal(`${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`, local);
    assert.equal(telegramPublicationWindowStatus(new Date(utc)).open, open);
    assert.equal(clock.hour >= 10 && clock.hour < 12, digest);
  }
  assert.equal(localPublicationClock(new Date("2026-10-01T19:01Z")).date, "2026-10-02");
});

test("Railway publication requires the state path inside an attached volume", () => {
  assert.throws(() => assertDurablePublicationStorage("/data/state.json", { RAILWAY_PROJECT_ID: "project" }), /persistent volume/);
  assert.throws(() => assertDurablePublicationStorage("/tmp/state.json", { RAILWAY_PROJECT_ID: "project", RAILWAY_VOLUME_MOUNT_PATH: "/data" }), /inside/);
  assert.doesNotThrow(() => assertDurablePublicationStorage("/data/state.json", { RAILWAY_PROJECT_ID: "project", RAILWAY_VOLUME_MOUNT_PATH: "/data" }));
});

const success = id => new Response(JSON.stringify({ ok: true, result: { message_id: id } }), { status: 200 });
async function publicationFixture() {
  const dir = await mkdtemp(join(tmpdir(), "publication-job-"));
  const env = { TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_PUBLISH_CHATS: "@test", TELEGRAM_PUBLISH_STATE_PATH: join(dir, "state.json") };
  return { env, path: env.TELEGRAM_PUBLISH_STATE_PATH };
}

test("partial digest retries only rejected posts and refreshes unsent countries after source edits", async () => {
  const { env, path } = await publicationFixture();
  const flights = [offer(0), offer(1, { to: "Пхукет" })];
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return calls.length === 2 ? new Response(JSON.stringify({ ok: false, description: "Too Many Requests" }), { status: 429 }) : success(calls.length);
  };
  const first = await runTelegramPublication({ flights, env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T05:00Z") });
  assert.equal(first.publishedPosts, 1);
  assert.equal(first.errors, 1);
  assert.equal((await loadPublicationState(path)).targetDigests["@test"], undefined);
  await runTelegramPublication({ flights: flights.map(f => ({ ...f, price: f.price + 20000 })), env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T05:15Z") });
  assert.equal(calls.length, 3);
  assert.notEqual(calls[0].text, calls[2].text);
  assert.ok(calls[2].text.includes("111"), "Retry uses the current price for the still-unsent country");
  const reloaded = await loadPublicationState(path);
  assert.equal(reloaded.targetDigests["@test"].date, "2026-10-01");
  assert.ok(reloaded.targetPlans["@test"].digest.posts.every(p => p.status === "sent"));
  await runTelegramPublication({ flights, env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T05:30Z") });
  assert.equal(calls.length, 3, "Completed digest must survive a fresh state reload");
});

test("uncertain older hot posts do not block other new hot flights", async () => {
  const { env } = await publicationFixture();
  const original = offer(1, { hot: true });
  await runTelegramPublication({ flights: [original], env, delayMs: 0, now: new Date("2026-10-01T08:00Z"), fetchImpl: async () => { throw new Error("uncertain"); } });
  let calls = 0;
  await runTelegramPublication({ flights: [original, offer(2, { hot: true, to: "Пхукет" })], env,
    delayMs: 0, now: new Date("2026-10-01T08:15Z"), fetchImpl: async () => success(++calls) });
  assert.equal(calls, 1);
});

test("pending digest retries use the current live observation expiry for unchanged offers", async () => {
  const { env, path } = await publicationFixture();
  const original = offer(1, { expiresAt: "2026-10-01T06:00:00Z" });
  let attempts = 0;
  await runTelegramPublication({ flights: [original], env, delayMs: 0, now: new Date("2026-10-01T05:00Z"),
    fetchImpl: async () => {
      attempts++;
      return new Response(JSON.stringify({ ok: false, description: "Rejected" }), { status: 429 });
    } });
  const reObserved = { ...original, expiresAt: "2026-10-01T07:15:00Z" };
  const retried = await runTelegramPublication({ flights: [reObserved], env, delayMs: 0, now: new Date("2026-10-01T06:15Z"),
    fetchImpl: async () => success(++attempts) });
  assert.equal(attempts, 2, "A genuinely live offer must not be dropped because the pending plan's old TTL elapsed");
  assert.equal(retried.publishedPosts, 1);
  const state = await loadPublicationState(path);
  assert.equal(state.targetPlans["@test"].digest.posts[0].status, "sent");
  assert.equal(state.targetDigests["@test"].date, "2026-10-01");
  await runTelegramPublication({ flights: [reObserved], env, delayMs: 0, now: new Date("2026-10-01T06:30Z"),
    fetchImpl: async () => success(++attempts) });
  assert.equal(attempts, 2, "Successful retry remains protected against duplicate digest sends");
});

test("a persistent uncertain hot post does not retain obsolete completed posts beyond retention", async () => {
  const { env, path } = await publicationFixture();
  const uncertain = offer(1, { hot: true, departureDate: "2026-10-10" });
  await runTelegramPublication({ flights: [uncertain], env, delayMs: 0, now: new Date("2026-10-01T08:00Z"),
    fetchImpl: async () => { throw new Error("Lost response"); } });
  for (const [index, flight] of [offer(2, { hot: true, departureDate: "2026-10-10" }),
    offer(3, { hot: true, departureDate: "2027-06-01" })].entries()) {
    await runTelegramPublication({ flights: [uncertain, flight], env, delayMs: 0,
      now: new Date(Date.parse("2026-10-01T08:15Z") + index * 900000), fetchImpl: async () => success(index + 1) });
  }
  assert.equal((await loadPublicationState(path)).targetPlans["@test"].hot.posts.length, 3);
  let attempts = 0;
  await runTelegramPublication({ flights: [offer(4, { hot: true, departureDate: "2026-11-10" })], env, delayMs: 0,
    now: new Date("2026-11-02T08:00Z"), fetchImpl: async () => success(++attempts) });
  const state = await loadPublicationState(path);
  const plan = state.targetPlans["@test"].hot;
  assert.equal(plan.posts.length, 3, "An old completed departed flight is removed while unresolved, future and new posts remain");
  assert.deepEqual(plan.flights.map(f => f.id), [uncertain.id, "flight-3", "flight-4"]);
  assert.equal(plan.posts.find(p => p.flightIds.includes(uncertain.id)).status, "sending", "Operator uncertainty evidence must survive cleanup");
  assert.equal(isHotPublicationPending(state, "@test", offer(3, { hot: true, departureDate: "2027-06-01" })), false, "Future duplicate-protection tombstones remain even beyond retention");
  assert.equal(attempts, 1);

  const statuses = ["pending", "sending", "review", "sent", "expired"];
  const fixtureFlights = statuses.map((status, index) => offer(20 + index, { departureDate: "2026-10-10" }));
  const fixturePlan = { createdAt: "2026-10-01T08:00Z", flights: fixtureFlights,
    posts: fixtureFlights.flatMap((flight, index) => buildFlightPostBatches([flight]).map(post => ({ ...post, status: statuses[index], createdAt: "2026-10-01T08:00Z" }))) };
  pruneCompletedHotPlan(fixturePlan, { now: new Date("2026-11-02T08:00Z"), retentionDays: 30 });
  assert.deepEqual(fixturePlan.posts.map(p => p.status), ["pending", "sending", "review"]);
  assert.deepEqual(fixturePlan.flights.map(f => f.id), fixtureFlights.slice(0, 3).map(f => f.id), "Only flight rows no longer referenced by protected posts are removed");
});

test("daily digest state advances at the next Almaty morning without overnight or same-day repeats", async () => {
  const { env, path } = await publicationFixture();
  const flights = [offer(1, { departureDate: "2026-10-10" })];
  let attempts = 0;
  const fetchImpl = async () => success(++attempts);
  const run = now => runTelegramPublication({ flights, env, delayMs: 0, now: new Date(now), fetchImpl });
  await run("2026-10-01T05:00Z");
  assert.equal(attempts, 1);
  await run("2026-10-01T18:59Z");
  await run("2026-10-01T19:01Z");
  assert.equal(attempts, 1, "23:59 and 00:01 Almaty do not send an overnight digest");
  assert.equal((await loadPublicationState(path)).targetDigests["@test"].date, "2026-10-01");
  await run("2026-10-02T05:00Z");
  assert.equal(attempts, 2, "Next day's 10:00 Almaty sends the complete daily collection once");
  assert.equal((await loadPublicationState(path)).targetDigests["@test"].date, "2026-10-02");
  await run("2026-10-02T06:59Z");
  assert.equal(attempts, 2, "11:59 with a fresh state read cannot duplicate today's digest");
});

test("corrupt nested journal content fails closed and future-flight tombstones survive retention limits", async () => {
  const { env, path } = await publicationFixture();
  await runTelegramPublication({ flights: [offer(1, { hot: true })], env, delayMs: 0,
    now: new Date("2026-10-01T08:00Z"), fetchImpl: async () => success(1) });
  const state = await loadPublicationState(path);
  state.targetPlans["@test"].hot.posts[0].text = "tampered post";
  await writeFile(path, JSON.stringify(state));
  await assert.rejects(loadPublicationState(path), /publication state/);
  const clean = await loadPublicationState(path + ".missing");
  const future = offer(1, { departureDate: "2027-06-01", hot: true });
  markFlightsPublished(clean, "@test", [future], "2026-08-01T05:00Z");
  prunePublicationState(clean, { now: new Date("2026-10-01T05:00Z"), retentionDays: 30, maxEntriesPerTarget: 100 });
  assert.equal(isHotPublicationPending(clean, "@test", { ...future, price: 123000 }), false);
});

test("queued flights removed from the live source are never sent on retry", async () => {
  const { env } = await publicationFixture();
  const flights = [offer(1, { hot: true }), offer(2, { hot: true })];
  await runTelegramPublication({ flights, env, delayMs: 0, now: new Date("2026-10-01T08:00Z"),
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, description: "Rejected" }), { status: 400 }) });
  let text = "";
  await runTelegramPublication({ flights: [flights[1]], env, delayMs: 0, now: new Date("2026-10-01T08:15Z"),
    fetchImpl: async (_url, options) => { text = JSON.parse(options.body).text; return success(1); } });
  assert.ok(text.includes("92"));
  assert.ok(!text.includes("91"), "Removed source offer's old price must not be sent");
});

test("price and availability edits never repeat a hot flight and target throttle is honored", async () => {
  const { env } = await publicationFixture();
  let calls = 0;
  const fetchImpl = async () => success(++calls);
  const hot = offer(1, { hot: true });
  await runTelegramPublication({ flights: [hot], env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T08:00Z") });
  await runTelegramPublication({ flights: [{ ...hot, price: 123000, seats: "2 места" }, offer(2, { hot: true })], env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T08:01Z") });
  assert.equal(calls, 1);
  await runTelegramPublication({ flights: [{ ...hot, price: 150000 }, offer(2, { hot: true })], env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T08:15Z") });
  assert.equal(calls, 2);
  await runTelegramPublication({ flights: [{ ...hot, price: 160000 }, offer(2, { hot: true, price: 120000 })], env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T08:30Z") });
  assert.equal(calls, 2);
});

test("uncertain Telegram responses stay reserved across restart without automatic resend", async () => {
  const { env, path } = await publicationFixture();
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Response lost after send"); };
  const flights = [offer(1, { hot: true })];
  const result = await runTelegramPublication({ flights, env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T08:00Z") });
  assert.equal(result.uncertainPosts, 1);
  assert.equal((await loadPublicationState(path)).targetPlans["@test"].hot.posts[0].status, "sending");
  await runTelegramPublication({ flights, env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T08:15Z") });
  assert.equal(calls, 1);
});

test("cached fallback offers and corrupt state never reach sendMessage", async () => {
  const { env, path } = await publicationFixture();
  let calls = 0;
  const fetchImpl = async () => success(++calls);
  await runTelegramPublication({ flights: [offer(1, { hot: true, cachedFallback: true })], env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T05:00Z") });
  await writeFile(path, "{broken");
  await assert.rejects(runTelegramPublication({ flights: [offer(1)], env, fetchImpl, delayMs: 0, now: new Date("2026-10-01T05:00Z") }), /publication state/);
  assert.equal(calls, 0);
});

test("country aliases and outbound/inbound UAE routes stay in one country post", () => {
  const routes = [offer(1), offer(2, { to: "Sharjah" }), offer(3, { from: "Астана" }),
    offer(4, { from: "Шарджа", to: "Алматы" }), offer(5, { to: "Abu Dhabi" })];
  const posts = buildFlightPostBatches(routes);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].country, "ОАЭ");
  assert.ok(posts[0].text.indexOf("Из Казахстана") < posts[0].text.indexOf("В Казахстан"));
  for (const city of ["Dubai", "Дубай", "DXB", "Sharjah", "Шарджа", "Abu-Dhabi", "Абу-Даби"])
    assert.equal(countryForFlight(offer(0, { to: city })).name, "ОАЭ");
});

test("country detection accepts common charter cities and targets use one canonical identity", () => {
  for (const [country, cities] of Object.entries({
    "Таиланд": ["Phuket", "Пхукет", "Bangkok", "Бангкок"],
    "Турция": ["Antalya", "Анталия", "Istanbul", "Стамбул"],
    "Египет": ["Sharm el-Sheikh", "Шарм-эль-Шейх", "Hurghada", "Хургада"],
    "Вьетнам": ["Nha Trang", "Нячанг", "Cam Ranh", "Камрань", "Da Nang", "Дананг", "Phu Quoc", "Фукуок"]
  })) for (const city of cities) assert.equal(countryForFlight(offer(0, { to: city })).name, country);
  assert.deepEqual(parsePublishTargets("@BiLeTtU,bilettu,-100123,-100123"), ["@bilettu", "-100123"]);
});

test("corrupt publication state fails closed instead of resetting duplicate protection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "publication-corruption-"));
  const path = join(dir, "state.json");
  await writeFile(path, "{broken");
  await assert.rejects(loadPublicationState(path), /publication state/i);
  await writeFile(path, JSON.stringify({ version: 2, targets: {} }));
  await assert.rejects(loadPublicationState(path), /publication state/i);
});
