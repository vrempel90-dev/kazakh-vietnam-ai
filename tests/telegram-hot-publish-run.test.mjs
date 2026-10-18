import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HOT_HEADER, buildHotDigests, runHotPublication, selectNearTermOffers
} from "../scripts/telegram-hot-publish-run.mjs";

const CHAT = "-1002106608923";
// 08:00 in Asia/Almaty, intentionally outside all regular publication windows.
const NOW = new Date("2026-10-12T03:00:00Z");
const env = {
  TELEGRAM_BOT_TOKEN: "1:test",
  TELEGRAM_PUBLISH_CHATS: CHAT,
  TELEGRAM_PUBLISH_TIMEZONE: "Asia/Almaty",
  POST_DELAY_SECONDS: "0",
  VITE_MANAGER_WHATSAPP: "77007772414"
};
const vn = { id: "v-hot", from: "Алматы", to: "Нячанг", trip: "OW",
  departureDate: "2026-10-12", price: 100000, airlineCode: "V", seats: "2 места" };
const th = { id: "th-hot", from: "Алматы", to: "Пхукет", trip: "OW",
  departureDate: "2026-10-13", price: 130000, airlineCode: "A" };
const future = { ...vn, id: "future", departureDate: "2026-10-14" };
async function pathForState() {
  return join(await mkdtemp(join(tmpdir(), "charter-hot-")), "state.json");
}
function capture({ timeout = false } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      if (timeout) throw new Error("unconfirmed network outcome");
      return new Response(JSON.stringify({ ok: true, result: { message_id: 500 + calls.length } }),
        { status: 200, headers: { "Content-Type": "application/json" } });
    }
  };
}

test("only today and tomorrow are urgent in Astana time; cached and stale fares are excluded", () => {
  const flights = [
    { ...vn, departureDate: "2026-10-11" },
    vn, th, future, { ...vn, id: "cached", cachedFallback: true }
  ];
  assert.deepEqual(selectNearTermOffers(flights, { now: NOW }).map(flight => flight.id),
    ["v-hot", "th-hot"]);
  assert.deepEqual(selectNearTermOffers(flights, {
    now: new Date("2026-10-12T20:30:00Z")
  }).map(flight => flight.id), ["th-hot", "future"]);
});

test("urgent format groups two countries under the required first line", () => {
  const digests = buildHotDigests([vn, th], { now: NOW });
  assert.equal(digests.length, 1);
  const text = digests[0].text.replace(/<\/?b>/g, "");
  assert.ok(text.startsWith(HOT_HEADER));
  assert.ok(text.includes("ВЬЕТНАМ"));
  assert.ok(text.includes("ТАИЛАНД"));
  assert.ok(text.includes("V 12.10 - 100 000 ₸ (2)"));
  assert.ok(text.includes("A 13.10 - 130 000 ₸"));
  assert.deepEqual(digests[0].offerIds.sort(), ["th-hot", "v-hot"]);
});

test("urgent alerts send outside regional windows, but never repeat a confirmed offer", async () => {
  const statePath = await pathForState();
  const sender = capture();
  const first = await runHotPublication({
    flights: [vn, th, future], now: NOW, env, statePath, fetchImpl: sender.fetchImpl, logger: null
  });
  assert.equal(first.sent, 1);
  assert.equal(sender.calls.length, 1);
  assert.ok(sender.calls[0].text.startsWith(HOT_HEADER));
  const second = await runHotPublication({
    flights: [vn, th], now: new Date(NOW.getTime() + 15 * 60000),
    env, statePath, fetchImpl: sender.fetchImpl, logger: null
  });
  assert.equal(second.sent, 0);
  assert.equal(sender.calls.length, 1);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(Object.keys(state.channels[CHAT].messages).some(key => key.startsWith("HOT#")));
});

test("new offers trigger a new alert without replaying earlier rows", async () => {
  const statePath = await pathForState();
  const sender = capture();
  await runHotPublication({ flights: [vn], now: NOW, env, statePath,
    fetchImpl: sender.fetchImpl, logger: null });
  const second = await runHotPublication({ flights: [vn, th], now: NOW, env, statePath,
    fetchImpl: sender.fetchImpl, logger: null });
  assert.equal(second.sent, 1);
  assert.equal(sender.calls.length, 2);
  assert.ok(sender.calls[1].text.includes("ТАИЛАНД"));
  assert.ok(!sender.calls[1].text.includes("ВЬЕТНАМ"));
});

test("an unconfirmed Telegram send is quarantined and never retried blindly", async () => {
  const statePath = await pathForState();
  const failed = capture({ timeout: true });
  const first = await runHotPublication({ flights: [vn], now: NOW, env, statePath,
    fetchImpl: failed.fetchImpl, logger: null });
  assert.equal(first.failed, 1);
  const next = capture();
  const retry = await runHotPublication({ flights: [vn], now: NOW, env, statePath,
    fetchImpl: next.fetchImpl, logger: null });
  assert.equal(retry.sent, 0);
  assert.equal(next.calls.length, 0);
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(Object.values(state.channels[CHAT].messages).some(record => record.status === "unconfirmed"));
});

test("a dry-run never sends or changes the publication state", async () => {
  const statePath = await pathForState();
  const sender = capture();
  const report = await runHotPublication({ flights: [vn], now: NOW, env, statePath,
    dryRun: true, fetchImpl: sender.fetchImpl, logger: null });
  assert.equal(report.planned, 1);
  assert.equal(sender.calls.length, 0);
  await assert.rejects(readFile(statePath, "utf8"), { code: "ENOENT" });
});

test("startup and GitHub Actions cannot send urgent messages", async () => {
  const sender = capture();
  const a = await runHotPublication({ flights: [vn], now: NOW, env,
    reason: "startup", fetchImpl: sender.fetchImpl, logger: null });
  const b = await runHotPublication({ flights: [vn], now: NOW,
    env: { ...env, GITHUB_ACTIONS: "true" }, fetchImpl: sender.fetchImpl, logger: null });
  assert.equal(a.reason, "STARTUP_RUN_DOES_NOT_PUBLISH");
  assert.equal(b.reason, "GITHUB_ACTIONS_CANNOT_PUBLISH");
  assert.equal(sender.calls.length, 0);
});

test("large urgent batches split without exceeding Telegram or dropping offers", () => {
  const flights = Array.from({ length: 140 }, (_, index) => ({
    ...vn, id: "long-" + index,
    from: index % 2 ? "Астана" : "Алматы",
    price: 80000 + index, airlineCode: ["V", "S", "A"][index % 3],
    // All departures are urgent, but distinct airlines/routes/prices alone are
    // not sufficient to make 140 identical flights unique.
    to: index % 2 ? "Фукуок" : "Нячанг",
    departureDate: index % 2 ? "2026-10-13" : "2026-10-12"
  }));
  // Only 6 flight identities exist (two routes x three airlines).
  const result = buildHotDigests(flights, { now: NOW, maxChars: 700 });
  assert.equal(result.reduce((total, d) => total + d.offers, 0), 6);
  assert.ok(result.every(d => d.text.length <= 700));
  assert.ok(result.every(d => d.text.startsWith(HOT_HEADER)));
});
