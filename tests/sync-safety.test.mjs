import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { atomicWriteJson } from "../scripts/atomic-json.mjs";
import { dedupeFlights, legacyFlightId, stableFlightId } from "../scripts/flight-identity.mjs";
import { withSyncLock } from "../scripts/sync-lock.mjs";
import { runFlightSync } from "../scripts/sync-all-sources.mjs";
import { DEFAULT_PRICING_CONFIG } from "../scripts/pricing-engine.mjs";

const flight = overrides => ({ from: "Алматы", to: "Дубай", departureDate: "2026-10-10", trip: "OW",
  airline: "SCAT", price: 100000, offset: 9, sourcePostedAt: "2026-10-01T05:00Z", ...overrides });

test("dedupe merges three independent sources while preserving distinct known flight identities", () => {
  const merged = dedupeFlights(["a", "b", "c"].map(id => flight({ id, sourceIds: [id] })));
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sourceIds, ["a", "b", "c"]);
  assert.equal(dedupeFlights([flight(), flight({ airline: "Air Astana" }), flight({ flightNumber: "DV123" }),
    flight({ flightNumber: "DV124" }), flight({ departureTime: "10:00" }), flight({ departureTime: "20:00" })]).length, 6);
  assert.equal(stableFlightId(flight()), stableFlightId(flight({ price: 130000, seats: "2 места" })));
  assert.notEqual(stableFlightId(flight()), stableFlightId(flight({ airline: "Air Astana" })));
  assert.equal(stableFlightId(flight({ airline: undefined })), stableFlightId(flight({ airline: undefined, from: "алматы", to: "ДУБАЙ" })));
  assert.ok(legacyFlightId(flight()));
});

test("atomic JSON writes serialize concurrent writers and leave the previous JSON after serialization failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "atomic-json-"));
  const path = join(dir, "nested", "state.json");
  await atomicWriteJson(path, { initial: true });
  await Promise.all(Array.from({ length: 20 }, (_, index) => atomicWriteJson(path, { index, data: "x".repeat(10000) })));
  assert.equal(JSON.parse(await readFile(path, "utf8")).index, 19);
  const before = await readFile(path, "utf8");
  const circular = {}; circular.self = circular;
  await assert.rejects(atomicWriteJson(path, circular));
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual(await readdir(join(dir, "nested")), ["state.json"]);
});

test("exclusive sync lock prevents overlapping jobs and releases after a thrown error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-lock-"));
  const path = join(dir, "sync.lock");
  let release;
  let started;
  const entered = new Promise(r => { started = r; });
  const first = withSyncLock(path, async () => { started(); await new Promise(r => { release = r; }); });
  await entered;
  await assert.rejects(withSyncLock(path, async () => assert.fail("Overlap must not enter")), { code: "SYNC_LOCKED" });
  release(); await first;
  await assert.rejects(withSyncLock(path, async () => { throw new Error("job failure"); }), /job failure/);
  await withSyncLock(path, async () => {});
  assert.deepEqual(await readdir(dir), []);
});

test("separate processes cannot share a job and an abrupt crash requires safe lock reconciliation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sync-process-lock-"));
  const path = join(dir, "sync.lock");
  const module = pathToFileURL(resolve("scripts/sync-lock.mjs")).href;
  const code = `import {withSyncLock} from ${JSON.stringify(module)}; await withSyncLock(${JSON.stringify(path)},async()=>{process.stdout.write('locked\\n');await new Promise(resolve=>setTimeout(resolve,30000));});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.resume();
  try {
    await once(child.stdout, "data");
    assert.equal(child.exitCode, null, "The first process must remain alive while the contender tries its lock");
    await assert.rejects(withSyncLock(path, async () => {}), { code: "SYNC_LOCKED" });
  } finally {
    const closed = once(child, "close");
    child.kill("SIGKILL"); await closed;
  }
  await assert.rejects(withSyncLock(path, async () => {}), { code: "SYNC_LOCKED" });
  assert.ok(JSON.parse(await readFile(path, "utf8")).owner);
});

test("offline sync isolates a failed source, prices raw costs once, strips provenance and retains edited-flight identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "offline-flight-sync-"));
  const overrides = { FLIGHT_FEED_OUTPUT: join(dir, "custom", "flights.json"), SOURCE_STATUS_PATH: join(dir, "status.json"),
    FLIGHT_SYNC_LOCK_PATH: join(dir, "sync.lock"), FLIGHT_OBSERVATION_STATE_PATH: join(dir, "observations.json"),
    TELEGRAM_PUBLISH_ENABLED: "false", ALLOW_CACHED_FALLBACK: "false" };
  const oldEnv = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  let sourcePrice = 100000;
  try {
    const sources = ["a", "b", "c", "broken"].map(id => ({ id: "telegram:" + id, kind: "telegram_public" }));
    const options = { now: new Date("2026-10-01T05:00Z"), sources, pricingConfig: DEFAULT_PRICING_CONFIG,
      fetchSource: async ({ source }) => {
        if (source.id.endsWith("broken")) throw new Error("source unavailable");
        return { status: { id: source.id, status: "ok" }, offers: [{ ...flight(), sourcePrice, currency: "KZT", postedAt: "2026-10-01T05:00Z" }] };
      } };
    const first = await runFlightSync(options);
    const before = JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8"));
    assert.equal(first.errors, 1);
    assert.equal(before.flights.length, 1);
    assert.equal(before.flights[0].price, 110000);
    assert.equal(before.flights[0].sourceIds, undefined);
    assert.equal(before.flights[0].sourcePostedAt, undefined);
    assert.equal(before.flights[0].legacyId, undefined);
    sourcePrice = 120000;
    await runFlightSync({ ...options, now: new Date("2026-10-01T05:15Z") });
    const after = JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8"));
    assert.equal(after.flights[0].id, before.flights[0].id);
    assert.equal(after.flights[0].price, 130000);
    await assert.rejects(runFlightSync({ ...options, fetchSource: async () => { throw new Error("total outage"); } }), /All Telegram sources failed/);
    assert.deepEqual(JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8")), after, "Total outage preserves the complete previous feed");
    await writeFile(overrides.FLIGHT_FEED_OUTPUT, "{broken");
    await assert.rejects(runFlightSync(options), /Could not load flight feed/);
    assert.equal(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8"), "{broken");
  } finally {
    for (const [key, value] of Object.entries(oldEnv)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
  }
});

test("partial outage retains only its still-valid private observations without resurrecting healthy-source removals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "partial-outage-"));
  const overrides = { FLIGHT_FEED_OUTPUT: join(dir, "flights.json"), SOURCE_STATUS_PATH: join(dir, "status.json"),
    FLIGHT_SYNC_LOCK_PATH: join(dir, "sync.lock"), FLIGHT_OBSERVATION_STATE_PATH: join(dir, "observations.json"),
    TELEGRAM_PUBLISH_ENABLED: "false", ALLOW_CACHED_FALLBACK: "false" };
  const old = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    let phase = 0;
    const options = { sources: [{ id: "telegram:a" }, { id: "telegram:b" }], pricingConfig: DEFAULT_PRICING_CONFIG,
      fetchSource: async ({ source }) => {
        if (phase > 0 && source.id === "telegram:a") throw new Error("outage a");
        return { status: { id: source.id, status: "ok" }, offers: phase > 0 ? [] : [{ ...flight({ to: source.id === "telegram:a" ? "Дубай" : "Пхукет" }),
          sourcePrice: 100000, currency: "KZT", postedAt: "2026-10-01T05:00Z" }] };
      } };
    await runFlightSync({ ...options, now: new Date("2026-10-01T05:00Z") });
    phase = 1;
    await runFlightSync({ ...options, now: new Date("2026-10-01T06:00Z") });
    const during = JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8"));
    assert.equal(during.flights.length, 1);
    assert.equal(during.flights[0].to, "Дубай");
    assert.equal(during.flights[0].cachedFallback, true);
    assert.equal(during.flights[0].expiresAt, "2026-10-02T05:00:00.000Z");
    await runFlightSync({ ...options, now: new Date("2026-10-02T06:00Z") });
    assert.equal(JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8")).flights.length, 0);
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
  }
});

test("Railway ingestion continues without pretending ephemeral observations are durable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "observation-storage-"));
  const overrides = { FLIGHT_FEED_OUTPUT: join(dir, "flights.json"), SOURCE_STATUS_PATH: join(dir, "status.json"),
    FLIGHT_SYNC_LOCK_PATH: join(dir, "sync.lock"), FLIGHT_OBSERVATION_STATE_PATH: join(dir, "observations.json"),
    TELEGRAM_PUBLISH_ENABLED: "false", ALLOW_CACHED_FALLBACK: "false", RAILWAY_PROJECT_ID: "fixture-project",
    RAILWAY_VOLUME_MOUNT_PATH: "" };
  const old = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const warnings = [];
  const warn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const options = { now: new Date("2026-10-01T05:00Z"), sources: [{ id: "telegram:a" }],
      pricingConfig: DEFAULT_PRICING_CONFIG, fetchSource: async ({ source }) => ({
        status: { id: source.id, status: "ok" }, offers: [{ ...flight(), sourcePrice: 100000,
          currency: "KZT", postedAt: "2026-10-01T05:00Z" }] }) };
    await runFlightSync(options);
    assert.equal(JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8")).flights.length, 1);
    await assert.rejects(readFile(overrides.FLIGHT_OBSERVATION_STATE_PATH), { code: "ENOENT" });
    assert.ok(warnings.some(message => message.includes("source outage retention is unavailable")));
    process.env.RAILWAY_VOLUME_MOUNT_PATH = join(dir, "other-volume");
    await runFlightSync(options);
    await assert.rejects(readFile(overrides.FLIGHT_OBSERVATION_STATE_PATH), { code: "ENOENT" });
    process.env.RAILWAY_VOLUME_MOUNT_PATH = dir;
    await runFlightSync(options);
    assert.deepEqual(JSON.parse(await readFile(overrides.FLIGHT_OBSERVATION_STATE_PATH, "utf8")).flights[0].sourceIds, ["telegram:a"]);
  } finally {
    console.warn = warn;
    for (const [key, value] of Object.entries(old)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
  }
});

test("partial outage refreshes retained offsets at Almaty midnight without extending observation expiry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "partial-outage-midnight-"));
  const overrides = { FLIGHT_FEED_OUTPUT: join(dir, "flights.json"), SOURCE_STATUS_PATH: join(dir, "status.json"),
    FLIGHT_SYNC_LOCK_PATH: join(dir, "sync.lock"), FLIGHT_OBSERVATION_STATE_PATH: join(dir, "observations.json"),
    TELEGRAM_PUBLISH_ENABLED: "false", ALLOW_CACHED_FALLBACK: "false", OFFER_TTL_HOURS: "24" };
  const old = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    let phase = 0;
    const options = { sources: [{ id: "telegram:a" }, { id: "telegram:b" }], pricingConfig: DEFAULT_PRICING_CONFIG,
      fetchSource: async ({ source }) => {
        if (phase > 0 && source.id === "telegram:a") throw new Error("outage a");
        return { status: { id: source.id, status: "ok" }, offers: [{
          ...flight({ to: source.id === "telegram:a" ? "Дубай" : "Пхукет", departureDate: source.id === "telegram:a" ? "2026-10-10" : "2026-10-11" }),
          sourcePrice: source.id === "telegram:a" ? 100000 : 70000, currency: "KZT", postedAt: "2026-10-01T18:59:00Z"
        }] };
      } };
    await runFlightSync({ ...options, now: new Date("2026-10-01T18:59:00Z") });
    const before = JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8")).flights.find(f => f.to === "Дубай");
    assert.equal(before.offset, 9);
    phase = 1;
    await runFlightSync({ ...options, now: new Date("2026-10-01T19:01:00Z") });
    const after = JSON.parse(await readFile(overrides.FLIGHT_FEED_OUTPUT, "utf8")).flights;
    const retained = after.find(f => f.to === "Дубай");
    assert.equal(retained.offset, 8, "Cached source observations must follow the same current calendar as fresh flights");
    assert.equal(retained.cachedFallback, true);
    assert.equal(retained.expiresAt, before.expiresAt);
    assert.equal(retained.lastSeenAt, before.lastSeenAt);
    assert.deepEqual(after.sort((a, b) => a.offset - b.offset || a.price - b.price).map(f => f.departureDate), ["2026-10-10", "2026-10-11"], "Client date ordering cannot place a later cheaper live flight ahead of an earlier cached flight");
  } finally {
    for (const [key, value] of Object.entries(old)) { if (value == null) delete process.env[key]; else process.env[key] = value; }
  }
});
