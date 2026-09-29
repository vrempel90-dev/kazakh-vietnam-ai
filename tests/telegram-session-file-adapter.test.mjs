import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchTelegramSessionFileOffers } from "../scripts/telegram-session-file-adapter.mjs";

test("parses fresh posts produced by Telegram user-session collector", async () => {
  const dir = await mkdtemp(join(tmpdir(), "telegram-session-"));
  const filePath = join(dir, "posts.json");
  await writeFile(filePath, JSON.stringify({
    generatedAt: "2026-09-29T06:00:00Z",
    posts: [
      {
        sourceId: "telegram-session:step-to-travel",
        sourceLabel: "Step to Travel",
        postId: 501,
        postedAt: "2026-09-29T05:30:00Z",
        text: "SCAT\nАлматы → Шарм-эль-Шейх\n30.09 — 100 000 ₸ (4)"
      },
      {
        sourceId: "telegram-session:step-to-travel",
        sourceLabel: "Step to Travel",
        postId: 500,
        postedAt: "2026-09-27T01:00:00Z",
        text: "Алматы → Дубай\n30.09 — 90 000 ₸"
      }
    ]
  }), "utf8");

  const result = await fetchTelegramSessionFileOffers({
    source: {
      id: "telegram-session",
      kind: "telegram_session",
      filePath
    },
    now: new Date("2026-09-29T06:00:00Z"),
    ttlHours: 24
  });

  assert.equal(result.status.status, "ok");
  assert.equal(result.status.skippedOld, 1);
  assert.equal(result.offers.length, 1);
  assert.equal(result.offers[0].sourceId, "telegram-session:step-to-travel");
  assert.equal(result.offers[0].sourcePrice, 100000);
  assert.equal(result.offers[0].seats, "4 мест");
});
