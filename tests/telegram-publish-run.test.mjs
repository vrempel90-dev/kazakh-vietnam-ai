import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTelegramPublication } from "../scripts/telegram-publish-run.mjs";
import { loadPublicationState } from "../scripts/telegram-publication-state.mjs";

const CHAT = "-1002106608923";
const SECOND_CHAT = "-1002285584868";

/** Asia/Almaty is UTC+5. */
const almaty = (hour, minute = 0, day = 12) =>
  new Date(Date.UTC(2026, 9, day, hour - 5, minute, 0));

const MORNING = almaty(10, 5);
const AFTERNOON = almaty(14, 10);
const EVENING = almaty(17, 5);

function baseEnv(overrides = {}) {
  return {
    TELEGRAM_BOT_TOKEN: "1:test",
    TELEGRAM_PUBLISH_CHATS: CHAT,
    TELEGRAM_PUBLISH_TIMEZONE: "Asia/Almaty",
    POST_DELAY_SECONDS: "0",
    VITE_MANAGER_WHATSAPP: "77007772414",
    ...overrides
  };
}

const vietnam = [
  { id: "v-out-1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000, airlineCode: "V", seats: "3 мест" },
  { id: "v-in-1", from: "Фукуок", to: "Астана", trip: "OW", departureDate: "2026-10-29", price: 55000, airlineCode: "S" }
];
const korea = [
  { id: "k-out-1", from: "Алматы", to: "Seoul", trip: "OW", departureDate: "2026-11-02", price: 190000, airlineCode: "A" }
];

function recorder({ fail = () => null } = {}) {
  const calls = [];
  let messageId = 1000;
  const fetchImpl = async (url, options) => {
    const method = String(url).split("/").pop();
    const body = JSON.parse(options.body);
    calls.push({ method, chatId: body.chat_id, messageId: body.message_id ?? null, text: body.text });
    const failure = fail({ method, body, index: calls.length });
    if (failure === "throw") throw new Error("socket hang up");
    if (failure) {
      return new Response(JSON.stringify({ ok: false, description: failure }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }
    const id = body.message_id ?? (messageId += 1);
    return new Response(JSON.stringify({ ok: true, result: { message_id: id } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  return { calls, fetchImpl };
}

async function statePath(name) {
  return join(await mkdtemp(join(tmpdir(), "charter-run-" + name + "-")), "state.json");
}

test("a morning run publishes one message per country and records every field", async () => {
  const path = await statePath("morning");
  const { calls, fetchImpl } = recorder();

  const report = await runTelegramPublication({
    flights: [...vietnam, ...korea],
    now: MORNING,
    env: baseEnv(),
    statePath: path,
    fetchImpl,
    logger: null
  });

  assert.equal(report.skipped, false);
  assert.equal(report.window.id, "morning");
  assert.equal(report.totals.sent, 2, "Vietnam and South Korea, one message each");
  assert.equal(report.totals.edited, 0);
  assert.ok(calls.every(call => call.method === "sendMessage"));
  assert.equal(new Set(calls.map(call => call.chatId)).size, 1);

  const stored = JSON.parse(await readFile(path, "utf8"));
  const record = stored.channels[CHAT].messages["VN#1"];
  assert.equal(record.status, "sent");
  assert.equal(record.country, "VN");
  assert.equal(record.countryName, "Вьетнам");
  assert.equal(record.localDate, "2026-10-12");
  assert.equal(record.window, "morning");
  assert.ok(record.messageId > 0);
  assert.ok(record.contentHash);
  assert.deepEqual(record.offerIds.sort(), ["v-in-1", "v-out-1"]);
  assert.ok(record.sentAt);
  assert.equal(stored.channels[CHAT].windows["2026-10-12:morning"].status, "completed");
  assert.equal(stored.lease, null, "the lease is released after the run");
});

test("scenario 7: the next 15-minute sync inside the same window sends nothing", async () => {
  const path = await statePath("rerun");
  const first = recorder();
  await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: first.fetchImpl, logger: null
  });
  assert.equal(first.calls.length, 1);

  for (const minute of [20, 35, 50]) {
    const again = recorder();
    const report = await runTelegramPublication({
      flights: vietnam, now: almaty(10, minute), env: baseEnv(), statePath: path,
      fetchImpl: again.fetchImpl, logger: null
    });
    assert.equal(again.calls.length, 0, "no Telegram call at 10:" + minute);
    assert.equal(report.channels[0].error, "WINDOW_ALREADY_PUBLISHED");
  }
});

test("scenario 12: an unchanged digest in a later window is skipped, a changed one is edited", async () => {
  const path = await statePath("price");
  const morning = recorder();
  await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: morning.fetchImpl, logger: null
  });
  const liveMessageId = morning.calls[0].messageId ?? 1001;

  // Nothing changed by the afternoon: no message at all.
  const quiet = recorder();
  const quietReport = await runTelegramPublication({
    flights: vietnam, now: AFTERNOON, env: baseEnv(), statePath: path,
    fetchImpl: quiet.fetchImpl, logger: null
  });
  assert.equal(quiet.calls.length, 0, "an unchanged country is not reposted");
  assert.equal(quietReport.totals.skipped, 1);

  // A price change edits the existing post instead of adding a new one.
  const changed = recorder();
  const changedReport = await runTelegramPublication({
    flights: vietnam.map(f => (f.id === "v-out-1" ? { ...f, price: 99000 } : f)),
    now: EVENING, env: baseEnv(), statePath: path,
    fetchImpl: changed.fetchImpl, logger: null
  });

  assert.equal(changed.calls.length, 1);
  assert.equal(changed.calls[0].method, "editMessageText", "a price change edits the live post");
  assert.ok(changed.calls[0].text.includes("99 000 ₸"));
  assert.equal(changedReport.totals.edited, 1);
  assert.equal(changedReport.totals.sent, 0);

  const stored = await loadPublicationState(path);
  assert.equal(
    stored.channels[CHAT].messages["VN#1"].messageId,
    liveMessageId,
    "the post keeps its original message id"
  );
});

test("repeated price changes across windows never add a second post for a country", async () => {
  const path = await statePath("flood");
  let price = 96000;
  const methods = [];

  for (const [index, moment] of [MORNING, AFTERNOON, EVENING, almaty(10, 5, 13), almaty(14, 5, 13)].entries()) {
    price += 1000;
    const run = recorder();
    await runTelegramPublication({
      flights: vietnam.map(f => (f.id === "v-out-1" ? { ...f, price } : f)),
      now: moment, env: baseEnv(), statePath: path,
      fetchImpl: run.fetchImpl, logger: null
    });
    methods.push(...run.calls.map(call => call.method));
    assert.ok(run.calls.length <= 1, "run " + index + " sent " + run.calls.length + " messages");
  }

  assert.equal(methods.filter(method => method === "sendMessage").length, 1, "exactly one original post");
  assert.equal(methods.filter(method => method === "editMessageText").length, 4);
});

test("scenario 8: a restart mid-schedule neither repeats nor loses the window", async () => {
  const path = await statePath("restart");
  const morning = recorder();
  await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: morning.fetchImpl, logger: null
  });

  // Railway restarts: a fresh process reads the volume and runs startup sync.
  const startup = recorder();
  const startupReport = await runTelegramPublication({
    flights: vietnam, now: almaty(10, 40), env: baseEnv(), statePath: path,
    reason: "startup", fetchImpl: startup.fetchImpl, logger: null
  });
  assert.equal(startup.calls.length, 0);
  assert.equal(startupReport.reason, "STARTUP_RUN_DOES_NOT_PUBLISH");

  // A restart inside a window that has not published yet still does not post.
  const freshPath = await statePath("restart-fresh");
  const coldStart = recorder();
  const coldReport = await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: freshPath,
    reason: "startup", fetchImpl: coldStart.fetchImpl, logger: null
  });
  assert.equal(coldStart.calls.length, 0, "a redeploy never fires an unscheduled package");
  assert.equal(coldReport.reason, "STARTUP_RUN_DOES_NOT_PUBLISH");

  // The following scheduled sync publishes normally.
  const scheduled = recorder();
  await runTelegramPublication({
    flights: vietnam, now: almaty(10, 50), env: baseEnv(), statePath: freshPath,
    fetchImpl: scheduled.fetchImpl, logger: null
  });
  assert.equal(scheduled.calls.length, 1);
});

test("scenario 10: nothing is sent outside the three windows", async () => {
  const path = await statePath("closed");
  for (const moment of [almaty(9, 59), almaty(12, 0), almaty(13, 30), almaty(15, 0), almaty(18, 0), almaty(23, 0)]) {
    const run = recorder();
    const report = await runTelegramPublication({
      flights: vietnam, now: moment, env: baseEnv(), statePath: path,
      fetchImpl: run.fetchImpl, logger: null
    });
    assert.equal(run.calls.length, 0);
    assert.equal(report.skipped, true);
    assert.equal(report.reason, "OUTSIDE_PUBLICATION_WINDOW");
  }
});

test("a missed window is not replayed once it has closed", async () => {
  const path = await statePath("missed");
  // The morning window passes with the service down. At 13:00 nothing is sent.
  const afterMorning = recorder();
  const report = await runTelegramPublication({
    flights: vietnam, now: almaty(13, 0), env: baseEnv(), statePath: path,
    fetchImpl: afterMorning.fetchImpl, logger: null
  });
  assert.equal(afterMorning.calls.length, 0);
  assert.equal(report.reason, "OUTSIDE_PUBLICATION_WINDOW");

  // The afternoon window publishes the current picture once, not a backlog.
  const afternoon = recorder();
  const afternoonReport = await runTelegramPublication({
    flights: vietnam, now: AFTERNOON, env: baseEnv(), statePath: path,
    fetchImpl: afternoon.fetchImpl, logger: null
  });
  assert.equal(afternoon.calls.length, 1);
  assert.equal(afternoonReport.totals.sent, 1);
});

test("scenario 11: a partial failure keeps what Telegram accepted and retries only the gap", async () => {
  const path = await statePath("partial");
  const flights = [...vietnam, ...korea,
    { id: "t-out-1", from: "Алматы", to: "Пхукет", trip: "OW", departureDate: "2026-11-03", price: 150000, airlineCode: "S" }
  ];

  // The second of three messages is rejected by Telegram.
  const first = recorder({ fail: ({ index }) => (index === 2 ? "Bad Request: message is too long" : null) });
  const firstReport = await runTelegramPublication({
    flights, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: first.fetchImpl, logger: null
  });

  assert.equal(first.calls.length, 3, "a single failure does not abort the remaining countries");
  assert.equal(firstReport.totals.sent, 2);
  assert.equal(firstReport.totals.failed, 1);
  assert.equal(firstReport.channels[0].status, "partial");

  const stored = await loadPublicationState(path);
  assert.equal(
    stored.channels[CHAT].windows["2026-10-12:morning"].status,
    "partial",
    "the window stays open so the gap can be retried"
  );
  const delivered = Object.values(stored.channels[CHAT].messages).filter(m => m.status === "sent");
  const failed = Object.values(stored.channels[CHAT].messages).filter(m => m.status === "failed");
  assert.equal(delivered.length, 2);
  assert.equal(failed.length, 1);

  // The next sync inside the same window retries only the failed country.
  const retry = recorder();
  const retryReport = await runTelegramPublication({
    flights, now: almaty(10, 25), env: baseEnv(), statePath: path,
    fetchImpl: retry.fetchImpl, logger: null
  });
  assert.equal(retry.calls.length, 1, "only the missing message is re-sent");
  assert.equal(retryReport.totals.sent, 1);
  assert.equal(retryReport.totals.skipped, 2, "the delivered messages are left alone");

  const settled = await loadPublicationState(path);
  assert.equal(settled.channels[CHAT].windows["2026-10-12:morning"].status, "completed");
});

test("an unconfirmed send is held for review instead of being repeated blindly", async () => {
  const path = await statePath("unconfirmed");
  const dropped = recorder({ fail: ({ index }) => (index === 1 ? "throw" : null) });
  const report = await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: dropped.fetchImpl, logger: null
  });
  assert.equal(report.totals.failed, 1);
  assert.equal(report.channels[0].messages[0].action, "unconfirmed");

  const stored = await loadPublicationState(path);
  assert.equal(stored.channels[CHAT].messages["VN#1"].status, "unconfirmed");
  assert.ok(stored.channels[CHAT].messages["VN#1"].error);

  // The next run must not risk a duplicate for a message that may be live.
  const retry = recorder();
  const retryReport = await runTelegramPublication({
    flights: vietnam, now: almaty(10, 30), env: baseEnv(), statePath: path,
    fetchImpl: retry.fetchImpl, logger: null
  });
  assert.equal(retry.calls.length, 0);
  assert.equal(retryReport.totals.held, 1);
  assert.equal(retryReport.channels[0].messages[0].reason, "PREVIOUS_ATTEMPT_UNCONFIRMED");

  // An operator can opt into the retry once they have checked the channel.
  const forced = recorder();
  await runTelegramPublication({
    flights: vietnam, now: almaty(10, 45),
    env: baseEnv({ TELEGRAM_RETRY_UNCONFIRMED: "true" }),
    statePath: path, fetchImpl: forced.fetchImpl, logger: null
  });
  assert.equal(forced.calls.length, 1);
});

test("a channel the bot cannot post to stops that channel without harming the other", async () => {
  const path = await statePath("fatal");
  const run = recorder({
    fail: ({ body }) => (body.chat_id === CHAT ? "Bad Request: chat not found" : null)
  });
  const report = await runTelegramPublication({
    flights: [...vietnam, ...korea], now: MORNING,
    env: baseEnv({ TELEGRAM_PUBLISH_CHATS: CHAT + "," + SECOND_CHAT }),
    statePath: path, fetchImpl: run.fetchImpl, logger: null
  });

  const broken = report.channels.find(channel => channel.chatId === CHAT);
  const healthy = report.channels.find(channel => channel.chatId === SECOND_CHAT);
  assert.equal(broken.status, "error");
  assert.match(broken.error, /chat not found/);
  assert.equal(broken.counts.sent, 0);
  assert.equal(healthy.status, "ok");
  assert.equal(healthy.counts.sent, 2);
});

test("two overlapping runs cannot publish at the same time", async () => {
  const path = await statePath("lease");
  const slow = recorder();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let firstRunReachedTelegram;
  const reachedTelegram = new Promise(resolve => { firstRunReachedTelegram = resolve; });

  const firstRun = runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: async (url, options) => {
      firstRunReachedTelegram();
      await gate;
      return slow.fetchImpl(url, options);
    },
    logger: null
  });

  // The first run now holds the lock and is waiting on Telegram.
  await reachedTelegram;

  const overlapping = recorder();
  const blocked = await runTelegramPublication({
    flights: vietnam, now: almaty(10, 6), env: baseEnv(), statePath: path,
    fetchImpl: overlapping.fetchImpl, logger: null
  });
  assert.equal(blocked.skipped, true);
  assert.equal(blocked.reason, "ANOTHER_RUN_IN_PROGRESS");
  assert.equal(overlapping.calls.length, 0);

  release();
  await firstRun;
  assert.equal(slow.calls.length, 1);

  // Once the first run finishes the lock is gone and the next run may proceed.
  const after = recorder();
  const afterReport = await runTelegramPublication({
    flights: vietnam, now: almaty(14, 5), env: baseEnv(), statePath: path,
    fetchImpl: after.fetchImpl, logger: null
  });
  assert.notEqual(afterReport.reason, "ANOTHER_RUN_IN_PROGRESS");
});

test("a lock left behind by a killed run is taken over once it goes stale", async () => {
  const path = await statePath("stale-lock");
  const { acquireRunLock, runLockPath } = await import("../scripts/telegram-publication-state.mjs");

  const dead = await acquireRunLock(path, {
    owner: "killed-run",
    now: new Date(MORNING.getTime() - 30 * 60000)
  });
  assert.equal(dead.acquired, true);

  const blocked = await acquireRunLock(path, { owner: "fresh", now: MORNING, ttlMinutes: 60 });
  assert.equal(blocked.acquired, false, "a recent lock still blocks");
  assert.equal(blocked.heldBy, "killed-run");

  const run = recorder();
  const report = await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: run.fetchImpl, logger: null
  });
  assert.equal(report.skipped, false, "a 30-minute-old lock is stale and is taken over");
  assert.equal(run.calls.length, 1);
  assert.ok(runLockPath(path).endsWith(".lock"));
});

test("each configured channel gets its own independent package", async () => {
  const path = await statePath("channels");
  const run = recorder();
  const report = await runTelegramPublication({
    flights: vietnam, now: MORNING,
    env: baseEnv({ TELEGRAM_PUBLISH_CHATS: CHAT + "," + SECOND_CHAT }),
    statePath: path, fetchImpl: run.fetchImpl, logger: null
  });

  assert.equal(report.channels.length, 2);
  assert.equal(run.calls.length, 2);
  assert.deepEqual(run.calls.map(call => call.chatId), [CHAT, SECOND_CHAT]);

  const stored = await loadPublicationState(path);
  assert.ok(stored.channels[CHAT].messages["VN#1"].messageId);
  assert.ok(stored.channels[SECOND_CHAT].messages["VN#1"].messageId);
  assert.notEqual(
    stored.channels[CHAT].messages["VN#1"].messageId,
    stored.channels[SECOND_CHAT].messages["VN#1"].messageId
  );
});

test("a dry run plans everything and touches neither Telegram nor the state file", async () => {
  const path = await statePath("dry");
  const run = recorder();
  const report = await runTelegramPublication({
    flights: [...vietnam, ...korea], now: MORNING, env: baseEnv(),
    statePath: path, fetchImpl: run.fetchImpl, dryRun: true, logger: null
  });

  assert.equal(run.calls.length, 0);
  assert.equal(report.skipped, false);
  assert.deepEqual(report.channels[0].messages.map(m => m.action), ["would_send", "would_send"]);
  await assert.rejects(() => readFile(path, "utf8"), "no state file is written");
});

test("an empty or unpublishable feed is reported, never sent as an empty post", async () => {
  const path = await statePath("empty");
  const run = recorder();
  const report = await runTelegramPublication({
    flights: [], now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: run.fetchImpl, logger: null
  });
  assert.equal(run.calls.length, 0);
  assert.equal(report.reason, "NO_PUBLISHABLE_OFFERS");

  const onlyUnknown = recorder();
  const unknownReport = await runTelegramPublication({
    flights: [{ id: "u", from: "Алматы", to: "Нигдеград", trip: "OW", departureDate: "2026-11-01", price: 1 }],
    now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: onlyUnknown.fetchImpl, logger: null
  });
  assert.equal(onlyUnknown.calls.length, 0, "an unclassifiable offer is never posted");
  assert.equal(unknownReport.diagnostics.length, 1);
});

test("CI cannot publish even when a window is open", async () => {
  const path = await statePath("ci");
  const run = recorder();
  const report = await runTelegramPublication({
    flights: vietnam, now: MORNING,
    env: baseEnv({ GITHUB_ACTIONS: "true" }),
    statePath: path, fetchImpl: run.fetchImpl, logger: null
  });
  assert.equal(run.calls.length, 0);
  assert.equal(report.reason, "GITHUB_ACTIONS_CANNOT_PUBLISH");
});

test("the per-window message budget defers rather than silently dropping offers", async () => {
  const path = await statePath("budget");
  const manyCountries = [
    { id: "c1", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-21", price: 96000 },
    { id: "c2", from: "Алматы", to: "Пхукет", trip: "OW", departureDate: "2026-10-22", price: 97000 },
    { id: "c3", from: "Алматы", to: "Seoul", trip: "OW", departureDate: "2026-10-23", price: 98000 }
  ];
  const run = recorder();
  const report = await runTelegramPublication({
    flights: manyCountries, now: MORNING,
    env: baseEnv({ TELEGRAM_MAX_MESSAGES_PER_WINDOW: "2" }),
    statePath: path, fetchImpl: run.fetchImpl, logger: null
  });

  assert.equal(run.calls.length, 2);
  assert.equal(report.totals.sent, 2);
  assert.equal(report.totals.deferred, 1, "the third country is reported, not hidden");
  assert.equal(report.channels[0].status, "partial");
  assert.equal(report.channels[0].coverage.complete, true, "every offer is still accounted for");

  // The deferred country goes out on the next run inside the window.
  const next = recorder();
  const nextReport = await runTelegramPublication({
    flights: manyCountries, now: almaty(10, 30), env: baseEnv(),
    statePath: path, fetchImpl: next.fetchImpl, logger: null
  });
  assert.equal(next.calls.length, 1);
  assert.equal(nextReport.totals.sent, 1);
});

test("the report accounts for every eligible offer", async () => {
  const path = await statePath("coverage");
  const run = recorder();
  const flights = [
    ...vietnam,
    { id: "dom", from: "Алматы", to: "Астана", trip: "OW", departureDate: "2026-10-21", price: 30000 },
    { id: "bad", from: "Алматы", to: "Нигдеград", trip: "OW", departureDate: "2026-10-21", price: 30000 }
  ];
  const report = await runTelegramPublication({
    flights, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: run.fetchImpl, logger: null
  });

  const coverage = report.channels[0].coverage;
  assert.equal(coverage.eligible, 4);
  assert.equal(coverage.rendered, 2);
  assert.equal(coverage.unclassified, 2);
  assert.equal(coverage.complete, true);
});
