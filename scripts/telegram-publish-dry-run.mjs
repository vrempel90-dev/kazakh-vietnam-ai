/**
 * Inspection tool for the Telegram publisher.
 *
 *   node scripts/telegram-publish-dry-run.mjs                 plan + render only
 *   node scripts/telegram-publish-dry-run.mjs --print         also print every digest
 *   node scripts/telegram-publish-dry-run.mjs --send-test     deliver to TELEGRAM_TEST_CHAT_ID
 *
 * The default mode never contacts Telegram and never writes publication state.
 * `--send-test` only ever targets the dedicated test chat, so it cannot post
 * into a production channel, and it uses a separate state file.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildCountryDigests } from "./telegram-digest.mjs";
import { describeSchedule, resolvePublicationWindow } from "./telegram-schedule.mjs";
import { runTelegramPublication } from "./telegram-publish-run.mjs";
import { parsePublishTargets } from "./telegram-publisher.mjs";

const args = process.argv.slice(2);
const printDigests = args.includes("--print");
const sendTest = args.includes("--send-test");
const feedPath = resolve(
  args.find(arg => !arg.startsWith("--")) || process.env.FLIGHT_FEED_OUTPUT || "public/flights.json"
);

const feed = JSON.parse(await readFile(feedPath, "utf8"));
const flights = Array.isArray(feed?.flights) ? feed.flights : [];
const now = new Date();

console.log("Feed:", feedPath);
console.log("Generated at:", feed?.generatedAt || "unknown", "| mode:", feed?.mode || "unknown");
console.log("Offers in feed:", flights.length);
console.log("Schedule:", describeSchedule(process.env.TELEGRAM_PUBLISH_TIMEZONE || "Asia/Almaty"));

const schedule = resolvePublicationWindow(now, {
  timeZone: process.env.TELEGRAM_PUBLISH_TIMEZONE || "Asia/Almaty"
});
console.log(
  "Local time:",
  schedule.localDate,
  String(schedule.localHour).padStart(2, "0") + ":" + String(schedule.localMinute).padStart(2, "0"),
  "| window:",
  schedule.window?.id || "CLOSED"
);

const { digests, diagnostics, duplicateIds, summary } = buildCountryDigests(flights, { now });

console.log("\nRendered digests:", JSON.stringify(summary));
for (const digest of digests) {
  console.log(
    "  " + digest.key.padEnd(8)
    + digest.countryName.padEnd(18)
    + ("part " + digest.part + "/" + digest.parts).padEnd(10)
    + String(digest.offers).padStart(4) + " offers "
    + String(digest.text.length).padStart(5) + " chars  "
    + digest.categories.join(",")
  );
}

const covered = new Set(digests.flatMap(digest => digest.offerIds));
const reported = new Set(diagnostics.map(item => item.id).filter(Boolean));
// A diagnostic is an accounted-for offer, not a missing one. Counting it as
// both "held for review" and "neither rendered nor reported" made the dry run
// warn about offers it had already explained.
const collapsed = new Set(duplicateIds);
const unaccounted = flights.filter(flight =>
  flight.id && !covered.has(flight.id) && !reported.has(flight.id) && !collapsed.has(flight.id)
);

console.log(
  "\nCompleteness: " + covered.size + " rendered + " + diagnostics.length
  + " refused with a reason + " + summary.duplicates + " duplicates = "
  + (covered.size + diagnostics.length + summary.duplicates) + " of " + flights.length
);
if (unaccounted.length) {
  console.warn("Offers neither rendered nor reported:", unaccounted.length);
  console.warn(JSON.stringify(unaccounted.slice(0, 10), null, 2));
} else {
  console.log("Every offer in the feed is either published or refused with a named reason.");
}

if (diagnostics.length) {
  const byReason = {};
  for (const item of diagnostics) byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  console.log("\nRefusals by reason:", JSON.stringify(byReason, null, 2));

  const forbidden = diagnostics.filter(item =>
    item.reason === "COUNTRY_NOT_ALLOWED" || item.reason === "FOREIGN_TO_FOREIGN_ROUTE"
  );
  if (forbidden.length) {
    console.log("\nRefused as not on the allowed list (" + forbidden.length + "):");
    for (const item of forbidden.slice(0, 20)) {
      console.log("  " + item.reason + " [" + (item.country || "?") + "] "
        + item.from + " -> " + item.to);
    }
  }

  const unparsed = diagnostics.filter(item =>
    item.reason !== "COUNTRY_NOT_ALLOWED" && item.reason !== "FOREIGN_TO_FOREIGN_ROUTE"
  );
  if (unparsed.length) {
    console.log("\nCould not be resolved (" + unparsed.length + "):");
    for (const item of unparsed.slice(0, 20)) {
      console.log("  " + item.reason + ": " + item.from + " -> " + item.to + " [" + item.trip + "]");
    }
  }
}

if (printDigests) {
  for (const digest of digests) {
    console.log("\n================ " + digest.key + " " + digest.countryName + " ================");
    console.log(digest.text.replace(/<\/?b>/g, ""));
  }
}

if (!sendTest) {
  const plan = await runTelegramPublication({
    flights,
    now,
    env: process.env,
    reason: "dry-run",
    dryRun: true,
    logger: null
  });
  console.log("\nPublication plan (no Telegram call, no state write):");
  console.log(JSON.stringify({
    skipped: plan.skipped,
    reason: plan.reason,
    window: plan.window?.id || null,
    localTime: plan.localTime,
    totals: plan.totals,
    channels: plan.channels.map(channel => ({
      chatId: channel.chatId,
      status: channel.status,
      counts: channel.counts,
      coverage: channel.coverage,
      messages: channel.messages.map(message => message.key + ":" + message.action)
    }))
  }, null, 2));
  process.exit(0);
}

const testChat = String(process.env.TELEGRAM_TEST_CHAT_ID || "").trim();
if (!testChat) {
  console.error("TELEGRAM_TEST_CHAT_ID is required for --send-test.");
  process.exit(1);
}
// Compared against the targets that would ACTUALLY be used, not against the
// raw environment variable. `parsePublishTargets` falls back to the hardcoded
// DEFAULT_PUBLISH_CHATS, so when TELEGRAM_PUBLISH_CHATS is unset the old check
// compared against an empty list and a test chat id equal to a production
// channel passed straight through.
const productionTargets = parsePublishTargets(process.env.TELEGRAM_PUBLISH_CHATS);
const normalizedTestChat = parsePublishTargets(testChat)[0];
if (productionTargets.includes(normalizedTestChat)) {
  console.error(
    "TELEGRAM_TEST_CHAT_ID (" + testChat + ") is one of the production channels: "
    + productionTargets.join(", ")
  );
  process.exit(1);
}
if (!String(process.env.TELEGRAM_BOT_TOKEN || "").trim()) {
  console.error("TELEGRAM_BOT_TOKEN is required for --send-test.");
  process.exit(1);
}

const result = await runTelegramPublication({
  flights,
  now,
  env: { ...process.env, TELEGRAM_PUBLISH_ENABLED: "true" },
  statePath: process.env.TELEGRAM_TEST_STATE_PATH || "/tmp/telegram-test-publications.json",
  reason: "test-chat",
  targets: [testChat],
  ignoreWindow: true,
  logger: console
});

console.log("\nTest delivery result:");
console.log(JSON.stringify(result.channels, null, 2));

