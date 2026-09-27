import test from "node:test";
import assert from "node:assert/strict";
import { enabledSources, ingestSources, monitoredSources, sourceRegistry } from "../scripts/source-registry.mjs";

test("Telegram feeds are reference-only and cannot enter production ingestion", () => {
  const telegramSources = sourceRegistry.filter(source => source.kind === "telegram_public");
  assert.ok(telegramSources.length >= 1);
  assert.ok(telegramSources.every(source => source.ingest === false));

  const enabled = enabledSources();
  assert.equal(enabled.some(source => source.kind === "telegram_public"), false);
  assert.ok(enabled.some(source => source.kind === "google_sheet_csv"));
  assert.ok(enabled.some(source => source.adapter === "samo_ticket_api"));

  const ingestion = ingestSources();
  assert.ok(ingestion.every(source => source.ingest === true));
  assert.equal(ingestion.some(source => source.kind === "telegram_public"), false);

  const samo = ingestion.filter(source => source.adapter === "samo_ticket_api");
  assert.deepEqual(samo.map(source => source.id).sort(), ["abk", "crystal_bay", "kazunion"]);
  assert.ok(samo.every(source => source.apiBaseUrl?.endsWith("/export/default.php")));
  assert.ok(samo.every(source => source.apiTokenEnv?.endsWith("_SAMO_API_TOKEN")));

  const monitored = monitoredSources();
  assert.ok(monitored.length >= 1);
  assert.ok(monitored.every(source => source.kind === "b2b_web"));
  assert.ok(monitored.every(source => source.ingest !== true));
});
