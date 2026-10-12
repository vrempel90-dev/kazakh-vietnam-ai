import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  channelPassesLargeSourceGate,
  channelSummaries,
  discoverLargeTelegramSources,
  discoveryConfig,
  messageLooksLikeCharter,
  normalizeTelegramSessionString,
  summarizeRecentCharterMessages
} from "../scripts/telegram-channel-discovery.mjs";

test("large-channel discovery defaults to a strict 10k subscriber gate", () => {
  const config = discoveryConfig({});
  assert.equal(config.enabled, false);
  assert.equal(config.minSubscribers, 10000);
  assert.equal(config.maxChannels, 12);
  assert.equal(config.minOfferPosts, 3);
  assert.equal(config.minParsedOffers, 3);
});

test("charter message signal requires date, price, route and ticket context", () => {
  assert.equal(
    messageLooksLikeCharter("Астана -> Фукуок\nV 03.10 - 96 000 🔥\nбагаж 20 кг"),
    true
  );
  assert.equal(
    messageLooksLikeCharter("Отель 5* на 7 ночей — 350 000 ₸"),
    false
  );
  assert.equal(
    messageLooksLikeCharter("Астана -> Фукуок\n03.10\nместа есть"),
    false,
    "a route without a numeric fare is not a publishable charter signal"
  );
});

test("recent Telegram posts are summarized with the existing charter parser", () => {
  const now = new Date("2026-10-02T06:00:00Z");
  const messages = [
    {
      id: 1,
      date: Math.floor(new Date("2026-10-02T05:00:00Z").getTime() / 1000),
      message: [
        "Астана -> Фукуок",
        "V 03.10 - 96 000 🔥",
        "V 10.10 - 175 000"
      ].join("\n")
    },
    {
      id: 2,
      date: Math.floor(new Date("2026-10-01T05:00:00Z").getTime() / 1000),
      message: [
        "Фукуок -> Астана",
        "S 04.10 - 55 000 (2)"
      ].join("\n")
    },
    {
      id: 3,
      date: Math.floor(new Date("2026-09-30T05:00:00Z").getTime() / 1000),
      message: [
        "Алматы -> Нячанг",
        "05.10 - 120 000 ₸",
        "багаж 23 кг"
      ].join("\n")
    }
  ];

  const summary = summarizeRecentCharterMessages(messages, {
    sourceId: "telegram:test",
    now,
    maxPostAgeDays: 7
  });

  assert.equal(summary.offerPosts, 3);
  assert.equal(summary.parsedOffers, 4);
  assert.equal(summary.lastPostAt, "2026-10-02T05:00:00.000Z");
});

test("only public broadcast channels with enough subscribers and charter activity pass", () => {
  const config = discoveryConfig({
    TELEGRAM_DISCOVERY_MIN_SUBSCRIBERS: "10000",
    TELEGRAM_DISCOVERY_MIN_OFFER_POSTS: "3",
    TELEGRAM_DISCOVERY_MIN_PARSED_OFFERS: "3"
  });

  assert.equal(channelPassesLargeSourceGate({
    handle: "big_charter",
    public: true,
    broadcast: true,
    subscribers: 150000,
    offerPosts: 8,
    parsedOffers: 24
  }, config), true);

  assert.equal(channelPassesLargeSourceGate({
    handle: "small_charter",
    public: true,
    broadcast: true,
    subscribers: 9999,
    offerPosts: 20,
    parsedOffers: 50
  }, config), false);

  assert.equal(channelPassesLargeSourceGate({
    handle: "big_tour_channel",
    public: true,
    broadcast: true,
    subscribers: 100000,
    offerPosts: 1,
    parsedOffers: 1
  }, config), false);
});


test("normalizes Telegram session values pasted from terminals or env files", () => {
  assert.equal(normalizeTelegramSessionString("  TG_SESSION=1abcDEF  "), "1abcDEF");
  assert.equal(normalizeTelegramSessionString("'1abc\nDEF'"), "1abcDEF");
  assert.equal(normalizeTelegramSessionString('"1abcDEF"'), "1abcDEF");
});


test("extracts an embedded Telethon session token from pasted terminal output", () => {
  const token = "1" + "A".repeat(352);
  assert.equal(
    normalizeTelegramSessionString("TG_SESSION:\n" + token + "\nPS C:\\\\Users\\\\user>"),
    token
  );
});

test("preserves Telethon base64 padding when normalizing TG_SESSION", () => {
  const token = "1" + "A".repeat(351) + "=";
  assert.equal(normalizeTelegramSessionString(token), token);
  assert.equal(
    normalizeTelegramSessionString("TG_SESSION:\n" + token + "\nPS C:\\\\Users\\\\user>"),
    token
  );
});
test("channel diagnostics report an offer count, never the offers themselves", () => {
  const summaries = channelSummaries([
    {
      handle: "partner",
      subscribers: 42000,
      offers: [
        { externalId: "a", sourcePrice: 96000, from: "Астана", to: "Фукуок" },
        { externalId: "b", sourcePrice: 55000, from: "Фукуок", to: "Астана" }
      ]
    },
    { handle: "other", subscribers: 11000 }
  ]);

  assert.deepEqual(summaries, [
    { handle: "partner", subscribers: 42000, offers: 2 },
    { handle: "other", subscribers: 11000, offers: 0 }
  ]);
  assert.ok(!JSON.stringify(summaries).includes("sourcePrice"));
});

test("a cached discovery run keeps parsed offers out of the run log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "charter-discovery-"));
  const cachePath = join(dir, "discovered.json");
  const offers = Array.from({ length: 400 }, (_, index) => ({
    externalId: "telegram:partner:" + index,
    from: "Алматы",
    to: "Анталия",
    departureDate: "2026-11-01",
    sourcePrice: 100000 + index,
    currency: "KZT",
    postedAt: "2026-10-12T04:00:00.000Z"
  }));

  await writeFile(cachePath, JSON.stringify({
    updatedAt: "2026-10-12T04:00:00.000Z",
    sources: [{ handle: "partner", subscribers: 42000, offerPosts: 9, parsedOffers: 400, offers }]
  }), "utf8");

  const result = await discoverLargeTelegramSources({
    env: {
      TELEGRAM_DISCOVERY_ENABLED: "true",
      TELEGRAM_DISCOVERY_CACHE_PATH: cachePath,
      TELEGRAM_DISCOVERY_REFRESH_HOURS: "12"
    },
    now: new Date("2026-10-12T06:00:00.000Z")
  });

  assert.equal(result.status.status, "cache");
  // The sources themselves still carry the offers for the sync to ingest.
  assert.equal(result.sources[0].prefetchedOffers.length, 400);

  // The status is what gets printed and persisted as diagnostics.
  const printed = JSON.stringify(result.status);
  assert.ok(!printed.includes("sourcePrice"), "offers must not reach the run log");
  assert.ok(!printed.includes("externalId"));
  assert.deepEqual(result.status.channels, [
    { handle: "partner", subscribers: 42000, offerPosts: 9, parsedOffers: 400, offers: 400 }
  ]);
  assert.ok(printed.length < 1000, "diagnostics stay small, got " + printed.length);
});
