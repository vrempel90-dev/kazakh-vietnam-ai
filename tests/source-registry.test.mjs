import test from "node:test";
import assert from "node:assert/strict";
import { enabledSources, sourceRegistry } from "../scripts/source-registry.mjs";

test("Telegram feeds are reference-only and cannot enter production ingestion", () => {
  const telegramSources = sourceRegistry.filter(source => source.kind === "telegram_public");
  assert.ok(telegramSources.length >= 1);
  assert.ok(telegramSources.every(source => source.ingest === false));

  const enabled = enabledSources();
  assert.equal(enabled.some(source => source.kind === "telegram_public"), false);
  assert.ok(enabled.some(source => source.kind === "b2b_web"));
  assert.ok(enabled.some(source => source.kind === "google_sheet_csv"));
});
