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
/** Three syncs inside the 10:00-12:00 window, as the 15-minute collector does. */
const MORNING_LATER = almaty(10, 35);
const MORNING_LAST = almaty(11, 30);
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
// Thailand shares the 10:00-12:00 Asia window with Vietnam.
const thailand = [
  { id: "th-out-1", from: "Алматы", to: "Пхукет", trip: "OW", departureDate: "2026-11-02", price: 190000, airlineCode: "A" }
];
// China also sits in the Asia window. Used wherever a test needs repeated
// syncs of one country inside its own window.
const china = [
  { id: "cn-out-1", from: "Алматы", to: "Санья", trip: "OW", departureDate: "2026-10-25", price: 120000, airlineCode: "P" }
];
// Uzbekistan and Saudi Arabia are NOT on the client's list. They used to be
// published in every window by the `all-windows` default; now they must never
// appear, in any window, under any configuration.
const forbidden = [
  { id: "uz-out-1", from: "Алматы", to: "Ташкент", trip: "OW", departureDate: "2026-10-25", price: 60000, airlineCode: "C" },
  { id: "sa-out-1", from: "Алматы", to: "Джидда", trip: "OW", departureDate: "2026-10-26", price: 180000 },
  { id: "ff-1", from: "Шарджа", to: "Ташкент", trip: "OW", departureDate: "2026-10-27", price: 70000 }
];
// Hungary owns the 17:00-18:00 Europe window.
const hungary = [
  { id: "hu-rt-1", from: "Алматы", to: "Будапешт", trip: "RT", departureDate: "2026-11-05", returnDate: "2026-11-12", price: 310000, airlineCode: "W" }
];
// The United Arab Emirates own the 14:00-15:00 Middle East window.
const emirates = [
  { id: "ae-out-1", from: "Алматы", to: "Дубай", trip: "OW", departureDate: "2026-10-23", price: 140000, airlineCode: "F" }
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
    flights: [...vietnam, ...thailand],
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

  // Unchanged content: the window is re-entered but every digest is skipped,
  // so not a single Telegram call is made.
  for (const minute of [20, 35, 50]) {
    const again = recorder();
    const report = await runTelegramPublication({
      flights: vietnam, now: almaty(10, minute), env: baseEnv(), statePath: path,
      fetchImpl: again.fetchImpl, logger: null
    });
    assert.equal(again.calls.length, 0, "no Telegram call at 10:" + minute);
    assert.equal(report.totals.skipped, 1, "the unchanged digest is skipped, not reposted");
    assert.equal(report.totals.sent, 0);
    assert.equal(report.publicationStatus, "NO_NEW_OFFERS");
  }
});

test("offers collected later in the same window still reach the channel", async () => {
  const path = await statePath("late-in-window");

  // 10:05 - the window publishes what the collector had.
  const first = recorder();
  const opening = await runTelegramPublication({
    flights: vietnam, now: almaty(10, 5), env: baseEnv(), statePath: path,
    fetchImpl: first.fetchImpl, logger: null
  });
  assert.equal(opening.totals.sent, 1);
  const liveMessageId = first.calls[0].messageId ?? 1001;

  // 10:35 - a charter leaving TODAY arrives. Before, the completed window
  // refused it and it was lost for good; now it is edited into the live post.
  const urgent = { id: "v-today", from: "Астана", to: "Фукуок", trip: "OW", departureDate: "2026-10-12", price: 88000, airlineCode: "V" };
  const second = recorder();
  const later = await runTelegramPublication({
    flights: [...vietnam, urgent], now: almaty(10, 35), env: baseEnv(), statePath: path,
    fetchImpl: second.fetchImpl, logger: null
  });

  assert.equal(later.totals.sent, 0, "no duplicate post");
  assert.equal(later.totals.edited, 1, "the live post is edited instead");
  assert.deepEqual(second.calls.map(call => call.method), ["editMessageText"]);
  assert.equal(second.calls[0].messageId, liveMessageId);
  assert.ok(second.calls[0].text.includes("88 000 ₸"), "the new offer is in the message");
  assert.ok(second.calls[0].text.includes("сегодня"), "a same-day departure is marked urgent");

  // 11:00 - a brand new country appears and gets its own first post.
  const third = recorder();
  const added = await runTelegramPublication({
    flights: [...vietnam, urgent, ...thailand], now: almaty(11, 0), env: baseEnv(),
    statePath: path, fetchImpl: third.fetchImpl, logger: null
  });
  assert.equal(added.totals.sent, 1, "the new country is posted once");
  assert.equal(added.totals.skipped, 1, "the unchanged country is left alone");
  assert.deepEqual(third.calls.map(call => call.method), ["sendMessage"]);
  assert.ok(third.calls[0].text.includes("ТАИЛАНД"));
});

test("scenario 12: an unchanged digest in a later window is skipped, a changed one is edited", async () => {
  const path = await statePath("price");
  const morning = recorder();
  await runTelegramPublication({
    flights: china, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: morning.fetchImpl, logger: null
  });
  const liveMessageId = morning.calls[0].messageId ?? 1001;

  // Nothing changed by the next sync in the window: no message at all.
  const quiet = recorder();
  const quietReport = await runTelegramPublication({
    flights: china, now: MORNING_LATER, env: baseEnv(), statePath: path,
    fetchImpl: quiet.fetchImpl, logger: null
  });
  assert.equal(quiet.calls.length, 0, "an unchanged country is not reposted");
  assert.equal(quietReport.totals.skipped, 1);

  // A price change edits the existing post instead of adding a new one.
  const changed = recorder();
  const changedReport = await runTelegramPublication({
    flights: china.map(f => (f.id === "cn-out-1" ? { ...f, price: 99000 } : f)),
    now: MORNING_LAST, env: baseEnv(), statePath: path,
    fetchImpl: changed.fetchImpl, logger: null
  });

  assert.equal(changed.calls.length, 1);
  assert.equal(changed.calls[0].method, "editMessageText", "a price change edits the live post");
  assert.ok(changed.calls[0].text.includes("99 000 ₸"));
  assert.equal(changedReport.totals.edited, 1);
  assert.equal(changedReport.totals.sent, 0);

  const stored = await loadPublicationState(path);
  assert.equal(
    stored.channels[CHAT].messages["CN#1"].messageId,
    liveMessageId,
    "the post keeps its original message id"
  );
});

test("repeated price changes add one post per publication day and edit it afterwards", async () => {
  const path = await statePath("flood");
  let price = 96000;
  const methods = [];

  const moments = [MORNING, MORNING_LATER, MORNING_LAST, almaty(10, 5, 13), almaty(10, 35, 13)];
  for (const [index, moment] of moments.entries()) {
    price += 1000;
    const run = recorder();
    await runTelegramPublication({
      flights: china.map(f => (f.id === "cn-out-1" ? { ...f, price } : f)),
      now: moment, env: baseEnv(), statePath: path,
      fetchImpl: run.fetchImpl, logger: null
    });
    methods.push(...run.calls.map(call => call.method));
    assert.ok(run.calls.length <= 1, "run " + index + " sent " + run.calls.length + " messages");
  }

  assert.deepEqual(
    methods,
    ["sendMessage", "editMessageText", "editMessageText", "sendMessage", "editMessageText"],
    "one original post on each of the two days, edited in place inside that day"
  );
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

test("scenario 10: no new post is ever created outside the three windows", async () => {
  const path = await statePath("closed");
  for (const moment of [almaty(9, 59), almaty(12, 0), almaty(13, 30), almaty(15, 0), almaty(18, 0), almaty(23, 0)]) {
    const run = recorder();
    const report = await runTelegramPublication({
      flights: vietnam, now: moment, env: baseEnv(), statePath: path,
      fetchImpl: run.fetchImpl, logger: null
    });
    // Nothing has been posted today, so an edit-only run has nothing to edit.
    assert.equal(run.calls.length, 0, "no Telegram call at " + moment.toISOString());
    assert.equal(report.editOnly, true);
    assert.equal(report.totals.sent, 0);
    assert.equal(report.totals.edited, 0);
    assert.ok(
      report.channels[0].messages.every(message => message.action !== "send"),
      "no send is ever planned outside a window"
    );
  }

  // And the window record is untouched, so the real window still publishes.
  const stored = await loadPublicationState(path);
  assert.deepEqual(Object.keys(stored.channels[CHAT]?.windows || {}), []);
});

test("a price change outside the window edits today's post instead of waiting a day", async () => {
  const path = await statePath("price-outside-window");

  // 10:05 - the Asia window publishes Vietnam.
  const morning = recorder();
  await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: morning.fetchImpl, logger: null
  });
  const liveMessageId = morning.calls[0].messageId ?? 1001;
  assert.equal(morning.calls.length, 1);

  // 15:00 - the window is long closed and the price moves. The post must
  // follow, because a wrong price in the channel is worse than a late edit.
  const cheaper = vietnam.map(flight =>
    flight.id === "v-out-1" ? { ...flight, price: 61000 } : flight
  );
  const afternoon = recorder();
  const report = await runTelegramPublication({
    flights: cheaper, now: almaty(15, 0), env: baseEnv(), statePath: path,
    fetchImpl: afternoon.fetchImpl, logger: null
  });

  assert.equal(report.editOnly, true);
  assert.equal(report.totals.sent, 0, "no new post outside the window");
  assert.equal(report.totals.edited, 1);
  assert.deepEqual(afternoon.calls.map(call => call.method), ["editMessageText"]);
  assert.equal(afternoon.calls[0].messageId, liveMessageId, "the same post is updated");
  assert.ok(afternoon.calls[0].text.includes("61 000 ₸"));

  // An unchanged run right after changes nothing at all.
  const quiet = recorder();
  const quietReport = await runTelegramPublication({
    flights: cheaper, now: almaty(15, 30), env: baseEnv(), statePath: path,
    fetchImpl: quiet.fetchImpl, logger: null
  });
  assert.equal(quiet.calls.length, 0);
  assert.equal(quietReport.totals.edited, 0);
});

test("a country with no post today is not published by an edit-only run", async () => {
  const path = await statePath("no-post-today");

  // Vietnam posts in the morning; the UAE never got its afternoon window.
  const morning = recorder();
  await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: morning.fetchImpl, logger: null
  });

  const evening = recorder();
  const report = await runTelegramPublication({
    flights: [...vietnam, ...emirates], now: almaty(22, 0), env: baseEnv(),
    statePath: path, fetchImpl: evening.fetchImpl, logger: null
  });

  assert.equal(evening.calls.length, 0, "the UAE is not posted out of hours");
  assert.equal(report.totals.sent, 0);
  const uae = report.channels[0].messages.find(message => message.key === "AE#1");
  assert.equal(uae.action, "out_of_window_no_new_post");
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
  assert.equal(report.editOnly, true, "a closed window only ever edits");
  assert.equal(report.totals.sent, 0, "the missed window is not replayed");

  // The afternoon window publishes its own region once, not a backlog.
  const afternoon = recorder();
  const afternoonReport = await runTelegramPublication({
    flights: emirates, now: AFTERNOON, env: baseEnv(), statePath: path,
    fetchImpl: afternoon.fetchImpl, logger: null
  });
  assert.equal(afternoon.calls.length, 1);
  assert.equal(afternoonReport.totals.sent, 1);
});

test("scenario 11: a partial failure keeps what Telegram accepted and retries only the gap", async () => {
  const path = await statePath("partial");
  const flights = [...vietnam, ...thailand,
    { id: "cn-out-9", from: "Алматы", to: "Санья", trip: "OW", departureDate: "2026-11-03", price: 150000, airlineCode: "S" }
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
    flights: [...vietnam, ...thailand], now: MORNING,
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
    flights: [...vietnam, ...thailand], now: MORNING, env: baseEnv(),
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
    { id: "c3", from: "Алматы", to: "Санья", trip: "OW", departureDate: "2026-10-23", price: 98000 }
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

test("regression: each publication day gets its own post instead of editing the previous day's", async () => {
  const path = await statePath("new-day");
  const shared = recorder();
  const sentIds = [];
  const editedIds = [];

  // The price moves every day, so the content hash changes and the old code
  // chose "edit" for the post that was created on the first day.
  const dayFlights = day => vietnam.map(flight => ({ ...flight, price: flight.price + day * 1000 }));

  for (const day of [12, 13, 14]) {
    const before = shared.calls.length;
    const report = await runTelegramPublication({
      flights: dayFlights(day), now: almaty(10, 5, day), env: baseEnv(), statePath: path,
      fetchImpl: shared.fetchImpl, logger: null
    });
    const calls = shared.calls.slice(before);

    assert.equal(report.localDate, "2026-10-" + day);
    assert.equal(report.totals.sent, 1, "day " + day + " posts its own digest");
    assert.equal(report.totals.edited, 0, "day " + day + " edits nothing from an earlier day");
    assert.equal(report.channels[0].messages[0].reason, day === 12 ? "NEW_DIGEST" : "NEW_PUBLICATION_DAY");
    assert.deepEqual(calls.map(call => call.method), ["sendMessage"]);
    assert.equal(calls[0].messageId, null, "a new post carries no message id");

    const stored = await loadPublicationState(path);
    sentIds.push(stored.channels[CHAT].messages["VN#1"].messageId);
  }

  assert.equal(new Set(sentIds).size, 3, "three distinct Telegram messages exist");

  assert.equal(editedIds.length, 0);
});

test("regression: repeated syncs inside one window edit that day's post, never repost", async () => {
  const path = await statePath("in-day-edit");
  const shared = recorder();

  const morning = await runTelegramPublication({
    flights: china, now: almaty(10, 5, 14), env: baseEnv(), statePath: path,
    fetchImpl: shared.fetchImpl, logger: null
  });
  assert.equal(morning.totals.sent, 1);
  const liveMessageId = shared.calls[0].messageId ?? 1001;

  // The collector runs every 15 minutes; each later sync in the same window
  // must edit the post this day created rather than add another one.
  for (const [hour, minute] of [[10, 35], [11, 15], [11, 50]]) {
    const before = shared.calls.length;
    const report = await runTelegramPublication({
      flights: china.map(flight => ({ ...flight, price: flight.price + hour * 60 + minute })),
      now: almaty(hour, minute, 14), env: baseEnv(), statePath: path,
      fetchImpl: shared.fetchImpl, logger: null
    });
    const calls = shared.calls.slice(before);
    assert.equal(report.totals.sent, 0, "no second post at " + hour + ":" + minute);
    assert.equal(report.totals.edited, 1);
    assert.deepEqual(calls.map(call => call.method), ["editMessageText"]);
    assert.equal(calls[0].messageId, liveMessageId, "the window edits the post this day created");
  }
});

test("the three windows publish their own regions and never mix them", async () => {
  const path = await statePath("regions");
  const shared = recorder();
  const feed = [...vietnam, ...emirates, ...hungary, ...thailand];

  const expected = [
    ["morning", 10, ["VN#1", "TH#1"], ["AE#1", "HU#1"]],
    ["afternoon", 14, ["AE#1"], ["VN#1", "HU#1", "TH#1"]],
    ["evening", 17, ["HU#1"], ["VN#1", "AE#1", "TH#1"]]
  ];

  for (const [windowId, hour, sentKeys, blockedKeys] of expected) {
    const before = shared.calls.length;
    const report = await runTelegramPublication({
      flights: feed, now: almaty(hour, 5, 20), env: baseEnv(), statePath: path,
      fetchImpl: shared.fetchImpl, logger: null
    });
    const calls = shared.calls.slice(before);

    assert.equal(report.window.id, windowId);
    assert.equal(report.window.region.id, { morning: "asia", afternoon: "middle-east", evening: "europe" }[windowId]);

    const acted = report.channels[0].messages
      .filter(message => ["send", "edit"].includes(message.action))
      .map(message => message.key)
      .sort();
    assert.deepEqual(acted, [...sentKeys].sort(), windowId + " acted on the wrong countries");

    for (const key of blockedKeys) {
      const blocked = report.channels[0].messages.find(message => message.key === key);
      assert.equal(blocked.action, "out_of_region_window", key + " must be out of the " + windowId + " window");
      assert.match(blocked.reason, /^REGION_WINDOW_IS_/);
    }

    // Every delivered message names exactly one country.
    for (const call of calls) {
      const names = ["ВЬЕТНАМ", "ОАЭ", "ВЕНГРИЯ", "ТАИЛАНД"].filter(name => call.text.includes(name));
      assert.equal(names.length, 1, "mixed countries in one post: " + names.join(","));
    }
  }

  // Thailand belongs to the Asia window: it posted in the morning only.
  const thaiCalls = shared.calls.filter(call => call.text.includes("ТАИЛАНД"));
  assert.equal(thaiCalls.filter(call => call.method === "sendMessage").length, 1);
});

test("an empty region sends nothing and does not burn its window", async () => {
  const path = await statePath("empty-region");
  const early = recorder();

  // 14:05 and the Middle East has nothing: no message, no window record.
  const quiet = await runTelegramPublication({
    flights: vietnam, now: almaty(14, 5, 20), env: baseEnv(), statePath: path,
    fetchImpl: early.fetchImpl, logger: null
  });
  assert.equal(early.calls.length, 0, "no empty post is created");
  assert.equal(quiet.channels[0].error, "NO_OFFERS_FOR_WINDOW_REGION");
  assert.equal(quiet.channels[0].counts.outOfWindow, 1);
  const afterQuiet = await loadPublicationState(path);
  assert.equal(afterQuiet.channels[CHAT]?.windows?.["2026-10-20:afternoon"], undefined);

  // 14:35 the collector brings a UAE offer in: the window still publishes.
  const late = recorder();
  const report = await runTelegramPublication({
    flights: [...vietnam, ...emirates], now: almaty(14, 35, 20), env: baseEnv(), statePath: path,
    fetchImpl: late.fetchImpl, logger: null
  });
  assert.equal(report.totals.sent, 1);
  assert.deepEqual(late.calls.map(call => call.method), ["sendMessage"]);
  assert.ok(late.calls[0].text.includes("ОАЭ"));
  const stored = await loadPublicationState(path);
  assert.equal(stored.channels[CHAT].windows["2026-10-20:afternoon"].status, "completed");
});

test("a country outside the allowed list never reaches the channel, in any window", async () => {
  for (const [hour, minute] of [[10, 5], [14, 10], [17, 5]]) {
    const path = await statePath("not-allowed-" + hour);
    const run = recorder();
    const report = await runTelegramPublication({
      flights: [...vietnam, ...forbidden], now: almaty(hour, minute),
      env: baseEnv(), statePath: path, fetchImpl: run.fetchImpl, logger: null
    });

    // A forbidden country never becomes a digest at all, so there is no
    // message entry to block - it is reported in diagnostics instead.
    assert.deepEqual(
      report.channels[0].diagnostics.map(item => item.id + ":" + item.reason).sort(),
      ["ff-1:FOREIGN_TO_FOREIGN_ROUTE", "sa-out-1:COUNTRY_NOT_ALLOWED", "uz-out-1:COUNTRY_NOT_ALLOWED"]
    );
    assert.ok(
      report.channels[0].messages.every(message => !["UZ#1", "SA#1"].includes(message.key)),
      "no forbidden country produces a message record"
    );
    for (const word of ["УЗБЕКИСТАН", "САУДОВСКАЯ", "Ташкент", "Джидда", "Шарджа"]) {
      assert.ok(run.calls.every(call => !call.text.includes(word)), word + " must never be sent");
    }
  }
});

test("the allowed-country list is reported on every run", async () => {
  const path = await statePath("allowed-list");
  const run = recorder();
  const report = await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(),
    statePath: path, fetchImpl: run.fetchImpl, logger: null
  });
  assert.deepEqual(report.allowedCountries, [
    "AE", "CN", "CZ", "DE", "EG", "HU", "IN", "IT",
    "LK", "MV", "MY", "OM", "RS", "TH", "VN"
  ]);
});

test("an edit is never reported as a publication", async () => {
  const path = await statePath("status");
  const first = recorder();
  const sent = await runTelegramPublication({
    flights: china, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: first.fetchImpl, logger: null
  });
  assert.equal(sent.publicationStatus, "PUBLISH_SENT");
  assert.equal(sent.channels[0].publicationStatus, "PUBLISH_SENT");

  const second = recorder();
  const edited = await runTelegramPublication({
    flights: china.map(f => ({ ...f, price: 130000 })), now: MORNING_LATER, env: baseEnv(),
    statePath: path, fetchImpl: second.fetchImpl, logger: null
  });
  assert.equal(edited.totals.sent, 0);
  assert.equal(edited.totals.edited, 1);
  assert.equal(edited.publicationStatus, "PUBLISH_EDITED", "an edit has its own status");

  const third = recorder();
  const unchanged = await runTelegramPublication({
    flights: china.map(f => ({ ...f, price: 130000 })), now: MORNING_LAST, env: baseEnv(),
    statePath: path, fetchImpl: third.fetchImpl, logger: null
  });
  assert.equal(unchanged.publicationStatus, "NO_NEW_OFFERS");

  const stored = await loadPublicationState(path);
  const telemetry = stored.channels[CHAT].telemetry;
  assert.ok(telemetry.lastNewPostAt, "a new post is stamped");
  assert.ok(telemetry.lastEditAt, "an edit is stamped separately");
  assert.notEqual(telemetry.lastNewPostAt, telemetry.lastEditAt);
  assert.equal(telemetry.lastStatus, "NO_NEW_OFFERS");
});

test("a failed delivery is reported as a failure, not as a success", async () => {
  const path = await statePath("status-fail");
  const run = recorder({ fail: () => "Bad Request: message text is too long" });
  const report = await runTelegramPublication({
    flights: vietnam, now: MORNING, env: baseEnv(), statePath: path,
    fetchImpl: run.fetchImpl, logger: null
  });

  assert.equal(report.publicationStatus, "PUBLISH_FAILED");
  assert.equal(report.totals.failed, 1);
  const stored = await loadPublicationState(path);
  assert.ok(stored.meta.monitor.lastFailureAt);
  assert.equal(stored.meta.monitor.lastNewPostAt, null, "a failure never stamps a new post");
});

test("the staleness alert fires only when a post was actually due", async () => {
  const path = await statePath("stale");

  // Day 1: Vietnam is published.
  const day1 = recorder();
  const first = await runTelegramPublication({
    flights: vietnam, now: almaty(10, 5, 12), env: baseEnv(), statePath: path,
    fetchImpl: day1.fetchImpl, logger: null
  });
  assert.equal(first.health.stale, false);
  assert.equal(first.health.reason, "UP_TO_DATE");

  // Three quiet days with no offers at all: nothing was due, so no alert.
  const quiet = recorder();
  const silent = await runTelegramPublication({
    flights: [], now: almaty(10, 5, 15), env: baseEnv(), statePath: path,
    fetchImpl: quiet.fetchImpl, logger: null
  });
  assert.equal(silent.publicationStatus, "NO_NEW_OFFERS");
  assert.equal(silent.health, null, "a gate-level skip makes no health claim");

  // Three days later a post is due and the delivery keeps failing: alert.
  const broken = recorder({ fail: () => "Bad Request: chat not found" });
  const alerted = await runTelegramPublication({
    flights: vietnam, now: almaty(10, 5, 15), env: baseEnv(), statePath: path,
    fetchImpl: broken.fetchImpl, logger: null
  });
  assert.equal(alerted.publicationStatus, "PUBLISH_FAILED");
  assert.equal(alerted.health.stale, true);
  assert.equal(alerted.health.reason, "NO_NEW_POST_DESPITE_PLANNED_SENDS");
  assert.ok(alerted.health.silentHours >= 72);
});

test("adding a second channel later delivers one package to it and nothing extra to the first", async () => {
  const path = await statePath("second-channel");
  const feed = [...vietnam, ...thailand];

  // Day 1: only the first channel is configured.
  const alone = recorder();
  await runTelegramPublication({
    flights: feed, now: almaty(10, 5, 12), env: baseEnv(), statePath: path,
    fetchImpl: alone.fetchImpl, logger: null
  });
  assert.equal(alone.calls.length, 2, "Vietnam and Thailand in the morning window");
  assert.ok(alone.calls.every(call => call.chatId === CHAT));

  // Day 2: the second channel is added to TELEGRAM_PUBLISH_CHATS.
  const both = recorder();
  const report = await runTelegramPublication({
    flights: feed, now: almaty(10, 5, 13),
    env: baseEnv({ TELEGRAM_PUBLISH_CHATS: CHAT + "," + SECOND_CHAT }),
    statePath: path, fetchImpl: both.fetchImpl, logger: null
  });

  const perChannel = new Map(report.channels.map(channel => [channel.chatId, channel]));
  assert.equal(perChannel.get(CHAT).counts.sent, 2, "the day's own posts, not a backlog");
  assert.equal(perChannel.get(SECOND_CHAT).counts.sent, 2, "the new channel gets one package");
  assert.equal(both.calls.filter(call => call.chatId === SECOND_CHAT).length, 2);
  assert.ok(
    both.calls.every(call => call.method === "sendMessage"),
    "a channel with no history has nothing to edit"
  );

  // Each channel keeps its own records, ids and offer history.
  const stored = await loadPublicationState(path);
  assert.notEqual(
    stored.channels[CHAT].messages["VN#1"].messageId,
    stored.channels[SECOND_CHAT].messages["VN#1"].messageId
  );
  assert.ok(stored.channels[CHAT].telemetry.lastNewPostAt);
  assert.ok(stored.channels[SECOND_CHAT].telemetry.lastNewPostAt);

  // A third sync in the same window adds nothing anywhere.
  const again = recorder();
  await runTelegramPublication({
    flights: feed, now: almaty(10, 35, 13),
    env: baseEnv({ TELEGRAM_PUBLISH_CHATS: CHAT + "," + SECOND_CHAT }),
    statePath: path, fetchImpl: again.fetchImpl, logger: null
  });
  assert.equal(again.calls.length, 0, "no duplicates after the window closed");
});
