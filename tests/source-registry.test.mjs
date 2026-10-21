import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredTelegramSources,
  enabledSources,
  ingestSources,
  monitoredSources,
  sourceRegistry
} from "../scripts/source-registry.mjs";

test("production ingestion contains only public Telegram channels", () => {
  assert.ok(sourceRegistry.length >= 5);
  assert.ok(sourceRegistry.every(source => source.kind === "telegram_public"));
  assert.ok(sourceRegistry.every(source => source.adapter === "telegram_public_feed"));
  assert.ok(sourceRegistry.every(source => source.ingest === true));
  assert.ok(sourceRegistry.every(source => source.priceKind === "sale"));

  const enabled = enabledSources();
  assert.ok(enabled.length >= 5);
  assert.ok(enabled.every(source => source.kind === "telegram_public"));
  assert.ok(enabled.every(source => source.url.startsWith("https://t.me/s/")));

  const ingestion = ingestSources();
  assert.ok(ingestion.every(source => source.kind === "telegram_public"));
  assert.equal(ingestion.some(source => source.kind === "b2b_web"), false);
  assert.equal(ingestion.some(source => source.kind === "google_sheet_csv"), false);
  assert.equal(ingestion.some(source => source.kind === "telegram_session"), false);

  assert.deepEqual(monitoredSources(), []);
  const builtIns = sourceRegistry.map(source => source.handle);
  assert.equal(builtIns.includes("charter_forever_travel"), false);
  for (const handle of ["bilettu", "biletuu", "avia07", "chartersavia", "charter_antalya"]) {
    assert.ok(builtIns.includes(handle));
  }
});

test("additional public Telegram channels can be configured without duplicates", () => {
  const telegram = configuredTelegramSources({
    TELEGRAM_SOURCE_CHANNELS: "@supplier_one,https://t.me/supplier_two,supplier_one"
  });

  assert.deepEqual(
    telegram.map(source => source.id),
    ["telegram:supplier_one", "telegram:supplier_two"]
  );
  assert.ok(telegram.every(source => source.adapter === "telegram_public_feed"));
  assert.ok(telegram.every(source => source.priceKind === "sale"));

  const withTelegram = ingestSources({
    TELEGRAM_SOURCE_CHANNELS: "supplier_one,bilettu"
  });

  assert.ok(withTelegram.some(source => source.id === "telegram:supplier_one"));
  assert.equal(
    withTelegram.filter(source => source.id === "telegram:bilettu").length,
    1
  );
});

test("publication channel cannot be re-added as an ingestion source", () => {
  const ingestion = ingestSources({
    TELEGRAM_SOURCE_CHANNELS: "charter_forever_travel,charterkaz,bilettu"
  });
  assert.equal(
    ingestion.some(source => source.handle === "charter_forever_travel"),
    false
  );
  assert.equal(
    ingestion.some(source => source.handle === "charterkaz"),
    false
  );
  assert.equal(
    ingestion.filter(source => source.handle === "bilettu").length,
    1
  );
});

test("Step2Travel is a configured ingestion source, not only a discovery seed", () => {
  // @charterticketsme existed only as a seed in telegram-channel-discovery.mjs.
  // Discovery is off by default, needs MTProto credentials and rejects channels
  // under 10 000 subscribers, so the channel was never fetched and none of its
  // tickets could reach the feed.
  const handles = ingestSources({}).map(source => source.handle);
  assert.ok(handles.includes("charterticketsme"), "Step2Travel must be ingested by default");

  const source = ingestSources({}).find(item => item.handle === "charterticketsme");
  assert.equal(source.url, "https://t.me/s/charterticketsme");
  assert.equal(source.ingest, true);
  assert.equal(source.enabled, true);

  // Every previously connected source is still there.
  for (const handle of ["bilettu", "biletuu", "avia07", "chartersavia", "charter_antalya"]) {
    assert.ok(handles.includes(handle), handle + " must stay connected");
  }
});

test("listing Step2Travel in TELEGRAM_SOURCE_CHANNELS too does not duplicate it", () => {
  const sources = ingestSources({
    TELEGRAM_SOURCE_CHANNELS: "charterticketsme,bilettu,biletuu,avia07,chartersavia,charter_antalya"
  });
  const handles = sources.map(source => source.handle);
  assert.equal(new Set(handles).size, handles.length, "no duplicate source ids");
  assert.ok(handles.includes("charterticketsme"));
});

test("our own publication channels are never ingested as sources", () => {
  const handles = ingestSources({
    TELEGRAM_SOURCE_CHANNELS: "charterticketsme,charter_forever_travel,charterkaz"
  }).map(source => source.handle);
  assert.ok(!handles.includes("charter_forever_travel"));
  assert.ok(!handles.includes("charterkaz"));
  assert.ok(handles.includes("charterticketsme"));
});
