import { assertDurableStateStorage } from "./production-storage.mjs";
import { buildFlightPostBatches, filterFlightsForTarget, parsePublishTargets, publishFreshFlights,
  telegramPublicationWindowStatus } from "./telegram-publisher.mjs";
import { initializePublicationState, isDailyDigestPublished, isHotPublicationPending,
  isPublicationStateInitialized, isTargetPublishAllowed, loadPublicationState, markDailyDigestPublished,
  markFlightsPublished, markTargetBatchPublished, prunePublicationState, publicationFingerprint, savePublicationState } from "./telegram-publication-state.mjs";
import { redactTelegramError } from "./telegram-bot.mjs";

export function localPublicationClock(now, timeZone = "Asia/Almaty") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = type => parts.find(part => part.type === type)?.value || "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")), minute: Number(value("minute")) };
}

export function assertDurablePublicationStorage(path, env = process.env) {
  assertDurableStateStorage(path, env, "Telegram publication state");
}

const number = (env, key, fallback) => env[key] != null && env[key] !== "" && Number.isFinite(Number(env[key])) ? Number(env[key]) : fallback;

const pendingPosts = (flights, now) => buildFlightPostBatches(flights).map(post => ({
  ...post, status: "pending", createdAt: now.toISOString()
}));

export function pruneCompletedHotPlan(plan, { now = new Date(), retentionDays = 30 } = {}) {
  const businessDate = localPublicationClock(now).date;
  const days = Number.isFinite(Number(retentionDays)) ? Math.max(1, Number(retentionDays)) : 30;
  const cutoff = now.getTime() - days * 86400000;
  const flights = new Map(plan.flights.map(flight => [flight.id, flight]));
  plan.posts = plan.posts.filter(post => {
    if (!["sent", "expired"].includes(post.status)) return true;
    const stamp = Date.parse(post.publishedAt || post.attemptedAt || post.createdAt || plan.createdAt);
    if (!Number.isFinite(stamp) || stamp >= cutoff) return true;
    return post.flightIds.some(id => !flights.has(id) || flights.get(id).departureDate > businessDate);
  });
  const referencedIds = new Set(plan.posts.flatMap(post => post.flightIds));
  plan.flights = plan.flights.filter(flight => referencedIds.has(flight.id));
  return plan;
}

export async function runTelegramPublication({ flights, now = new Date(), env = process.env, fetchImpl = fetch, delayMs }) {
  const summary = { publishedPosts: 0, publishedFlights: 0, countries: 0, errors: 0, uncertainPosts: 0, reviewCount: 0 };
  if (env.TELEGRAM_PUBLISH_ENABLED === "false" || !env.TELEGRAM_BOT_TOKEN) return { ...summary, skipped: "disabled_or_unconfigured" };
  const timeZone = env.TELEGRAM_PUBLISH_TIMEZONE || "Asia/Almaty";
  if (!telegramPublicationWindowStatus(now, { timeZone, startHour: number(env, "TELEGRAM_PUBLISH_START_HOUR", 10),
    endHour: number(env, "TELEGRAM_PUBLISH_END_HOUR", 20) }).open) return { ...summary, skipped: "outside_window" };
  const statePath = env.TELEGRAM_PUBLISH_STATE_PATH || "/data/telegram-publications.json";
  assertDurablePublicationStorage(statePath, env);
  const state = await loadPublicationState(statePath);
  if (!isPublicationStateInitialized(state)) initializePublicationState(state, now.toISOString());
  const clock = localPublicationClock(now, timeZone);
  const inDigestWindow = clock.hour >= number(env, "TELEGRAM_DAILY_DIGEST_START_HOUR", 10)
    && clock.hour < number(env, "TELEGRAM_DAILY_DIGEST_END_HOUR", 12);
  const digestDueToday = inDigestWindow || String(env.TELEGRAM_DIGEST_CATCHUP_DATE || "") === clock.date;
  const publishedIds = new Set();
  const countries = new Set();
  for (const target of parsePublishTargets(env.TELEGRAM_PUBLISH_CHATS)) {
    const eligible = filterFlightsForTarget(flights.filter(f => !f.cachedFallback), target);
    if (!eligible.length) continue;
    for (const flight of eligible) {
      const previous = state.targets[target]?.[flight.id] || state.targets[target]?.[flight.legacyId];
      if (previous) previous.departureDate = flight.departureDate;
    }
    state.targetPlans[target] ||= {};
    const plans = state.targetPlans[target];
    const mode = digestDueToday && !isDailyDigestPublished(state, target, clock.date) ? "digest" : "hot";
    if (mode === "hot" && !isTargetPublishAllowed(state, target, { now,
      minIntervalMinutes: Math.max(0, number(env, "TELEGRAM_MIN_PUBLISH_INTERVAL_MINUTES", 15)) })) continue;
    let plan = plans[mode];
    if (mode === "digest" ? plan?.date !== clock.date : !plan || plan.posts.every(p => p.status === "sent" || p.status === "expired")) {
      const chosen = mode === "digest" ? eligible : eligible.filter(f => f.hot && isHotPublicationPending(state, target, f));
      if (!chosen.length) continue;
      plan = plans[mode] = { date: clock.date, createdAt: now.toISOString(), flights: chosen,
        posts: pendingPosts(chosen, now) };
    }
    if (!Array.isArray(plan?.posts) || !Array.isArray(plan?.flights)) throw new Error("Invalid Telegram publication plan");
    if (mode === "hot") {
      const known = new Set(plan.flights.map(f => f.id));
      const additional = eligible.filter(f => f.hot && !known.has(f.id) && isHotPublicationPending(state, target, f));
      if (additional.length) {
        plan.flights.push(...additional);
        plan.posts.push(...pendingPosts(additional, now));
      }
    }
    const live = new Map(eligible.map(f => [f.id, f]));
    const planned = new Map(plan.flights.map(f => [f.id, f]));
    for (const country of new Set(plan.posts.filter(p => p.status === "pending").map(p => p.country))) {
      const countryPosts = plan.posts.filter(p => p.country === country);
      const changed = countryPosts.filter(p => p.status === "pending").some(post => post.flightIds.some(id =>
        !live.has(id) || publicationFingerprint(live.get(id)) !== publicationFingerprint(planned.get(id))));
      if (!changed) continue;
      if (countryPosts.some(p => p.status === "sent" || p.status === "sending")) {
        for (const post of countryPosts.filter(p => p.status === "pending")) post.status = "review";
      } else {
        const ids = new Set(countryPosts.flatMap(p => p.flightIds));
        const currentFlights = eligible.filter(f => ids.has(f.id));
        plan.posts = [...plan.posts.filter(p => p.country !== country),
          ...pendingPosts(currentFlights, now)];
        plan.flights = [...plan.flights.filter(f => !ids.has(f.id)), ...currentFlights];
      }
    }
    for (const post of plan.posts) {
      if (post.status === "sending") summary.uncertainPosts++;
      if (post.status === "review") summary.reviewCount++;
      if (post.status !== "pending") continue;
      const expired = post.flightIds.map(id => live.get(id)).some(f => !f
        || (f.expiresAt && Date.parse(f.expiresAt) <= now.getTime()) || f.departureDate <= clock.date);
      if (expired) post.status = "expired";
    }
    // Freeze the full plan before any external side effect, and checkpoint every post.
    await savePublicationState(statePath, state);
    let previousEntries;
    const result = await publishFreshFlights({ token: env.TELEGRAM_BOT_TOKEN, targets: [target], flights: plan.flights,
      postBatches: plan.posts, publicAppUrl: env.PUBLIC_APP_URL || env.RAILWAY_PUBLIC_DOMAIN,
      managerPhone: env.VITE_MANAGER_WHATSAPP, fetchImpl,
      delayMs: delayMs ?? Math.max(0, number(env, "POST_DELAY_SECONDS", 2)) * 1000,
      maxPostsPerRun: mode === "digest" ? 100 : Math.max(1, number(env, "MAX_POSTS_PER_RUN", 2)),
      beforePost: async (_target, post) => {
        previousEntries = { ...(state.targets[target] || {}) };
        post.status = "sending";
        post.attemptedAt = now.toISOString();
        markFlightsPublished(state, target, plan.flights.filter(f => post.flightIds.includes(f.id)), now.toISOString());
        await savePublicationState(statePath, state);
      },
      afterPost: async (_target, post, message) => {
        post.status = "sent";
        post.messageId = message?.message_id;
        post.publishedAt = now.toISOString();
        markTargetBatchPublished(state, target, now.toISOString());
        await savePublicationState(statePath, state);
        post.flightIds.forEach(id => publishedIds.add(target + "|" + id));
        countries.add(post.country);
      },
      onPostFailure: async (_target, post, error) => {
        post.lastError = redactTelegramError(error, [env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET, env.ADMIN_PRICING_TOKEN]);
        console.error("Telegram post failed:", post.lastError);
        if (error.definitive) {
          post.status = "pending";
          state.targets[target] = previousEntries;
        } else { summary.uncertainPosts++; }
        await savePublicationState(statePath, state);
      }
    });
    summary.publishedPosts += result.published;
    summary.errors += result.targets.filter(t => t.error).length;
    if (mode === "digest" && plan.posts.every(p => p.status === "sent" || p.status === "expired")) {
      markDailyDigestPublished(state, target, clock.date, now.toISOString());
    }
    const retentionDays = number(env, "TELEGRAM_PUBLICATION_RETENTION_DAYS", 30);
    if (plans.hot) pruneCompletedHotPlan(plans.hot, { now, retentionDays });
    prunePublicationState(state, { now, retentionDays });
    await savePublicationState(statePath, state);
  }
  if (summary.uncertainPosts || summary.reviewCount) console.warn("Telegram publication requires operator reconciliation:",
    JSON.stringify({ uncertainPosts: summary.uncertainPosts, changedPartialPosts: summary.reviewCount }));
  return { ...summary, publishedFlights: publishedIds.size, countries: countries.size, localDate: clock.date };
}
