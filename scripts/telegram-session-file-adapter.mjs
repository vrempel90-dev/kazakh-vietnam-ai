import { readFile } from "node:fs/promises";
import { parseTelegramPost } from "./telegram-source-adapter.mjs";

function withinTtl(postedAt, now, ttlHours) {
  if (!postedAt) return true;
  const timestamp = new Date(postedAt);
  if (Number.isNaN(timestamp.getTime())) return false;
  const age = now.getTime() - timestamp.getTime();
  return age >= -60 * 60 * 1000 && age <= ttlHours * 60 * 60 * 1000;
}

export async function fetchTelegramSessionFileOffers({
  source,
  now = new Date(),
  ttlHours = 24,
  shouldSkipText = () => false
}) {
  const filePath = source.filePath;
  if (!filePath) {
    return {
      offers: [],
      status: {
        id: source.id,
        kind: source.kind,
        status: "configuration_required",
        reason: "TELEGRAM_SESSION_POSTS_PATH is not configured"
      }
    };
  }

  let payload;
  try {
    payload = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    return {
      offers: [],
      status: {
        id: source.id,
        kind: source.kind,
        status: "configuration_required",
        reason: "Telegram session collector output is unavailable: " + (error instanceof Error ? error.message : String(error))
      }
    };
  }

  const posts = Array.isArray(payload?.posts) ? payload.posts : [];
  const offers = [];
  let skippedOld = 0;
  let skippedAuto = 0;

  for (const post of posts) {
    if (!withinTtl(post.postedAt, now, ttlHours)) {
      skippedOld += 1;
      continue;
    }
    if (shouldSkipText(post.text || "")) {
      skippedAuto += 1;
      continue;
    }

    offers.push(...parseTelegramPost(post.text || "", {
      sourceId: post.sourceId || source.id,
      postId: Number.isInteger(post.postId) ? post.postId : null,
      postedAt: post.postedAt || null,
      now
    }));
  }

  return {
    offers,
    status: {
      id: source.id,
      kind: source.kind,
      status: "ok",
      posts: posts.length,
      offers: offers.length,
      skippedOld,
      skippedAuto,
      collectorStatuses: Array.isArray(payload?.statuses) ? payload.statuses : []
    }
  };
}
