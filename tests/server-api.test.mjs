import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

const temporaryRoot = await mkdtemp(join(tmpdir(), "charter-server-test-"));
process.env.ADMIN_PRICING_TOKEN = "test-only-admin-secret";
process.env.ADMIN_TELEGRAM_IDS = "42";
process.env.TELEGRAM_BOT_TOKEN = "123456:TEST_TOKEN";
process.env.PRICING_RULES_PATH = join(temporaryRoot, "pricing.json");
const { createAppServer, syncIntervalFromEnv } = await import("../scripts/serve-dist.mjs");
const updates = [];
const server = createAppServer({
  staticRoot: temporaryRoot,
  startSync: () => false,
  telegramRuntime: {
    status: { enabled: true, configured: true },
    isWebhookAuthorized: value => value === "test-only-webhook-secret",
    handleUpdate: async update => { updates.push(update); }
  }
});
let port;

before(async () => {
  await writeFile(join(temporaryRoot, "index.html"), "<h1>Charter app</h1>");
  await writeFile(join(temporaryRoot, "flights.json"), '{"flights":[]}');
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = server.address().port;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await rm(temporaryRoot, { recursive: true, force: true });
});

function call(path, { method = "GET", body, headers = {}, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method, headers }, res => {
      const received = [];
      res.on("data", chunk => received.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(received).toString("utf8") }));
    });
    req.on("error", reject);
    if (chunks) {
      // Let the server consume each network chunk, including a partial UTF-8 code point.
      void (async () => {
        for (const chunk of chunks) {
          req.write(chunk);
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        req.end();
      })().catch(reject);
    } else req.end(body);
  });
}

test("malformed URI never rejects the HTTP callback or stops subsequent requests", async () => {
  for (const path of ["/%", "/%E0%A4%A", "//[", "/%00"]) {
    const response = await call(path);
    assert.equal(response.status, 400, path);
    assert.equal(JSON.parse(response.body).error, "invalid_path");
    assert.equal((await call("/health")).status, 200);
  }
});

test("encoded traversal is refused without serving a file outside the static root", async () => {
  for (const path of ["/..%2f..%2fpackage.json", "/..%5c..%5cpackage.json"]) {
    assert.equal((await call(path)).status, 403, path);
  }
});

test("GET/HEAD static behavior and HTML navigation fallback stay available", async () => {
  const head = await call("/flights.json", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], "14");
  const navigation = await call("/profile");
  assert.equal(navigation.status, 200);
  assert.equal(navigation.body, "<h1>Charter app</h1>");
});

test("missing files and API routes do not masquerade as a successful HTML response", async () => {
  for (const path of ["/missing.json", "/missing.js", "/api", "/api/missing", "/api/telegram/webhook"]) {
    assert.equal((await call(path)).status, 404, path);
  }
  assert.equal((await call("/profile", { method: "POST" })).status, 405);
});

test("admin routes and webhook keep their independent authorization gates", async () => {
  assert.equal((await call("/api/admin/pricing")).status, 401);
  assert.equal((await call("/api/admin/pricing", { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await call("/api/admin/pricing", { headers: { authorization: "Bearer test-only-admin-secret" } })).status, 200);
  assert.equal((await call("/api/telegram/webhook", { method: "POST", body: "{}" })).status, 401);
  assert.equal((await call("/api/admin/telegram-auth", { method: "POST", body: "{}" })).status, 403);
});

test("malformed JSON returns 400 and oversized Unicode JSON returns 413", async () => {
  const headers = { "x-telegram-bot-api-secret-token": "test-only-webhook-secret" };
  const invalid = await call("/api/telegram/webhook", { method: "POST", headers, body: "{" });
  assert.equal(invalid.status, 400);
  assert.equal(JSON.parse(invalid.body).error, "invalid_json");
  const oversized = await call("/api/telegram/webhook", { method: "POST", headers, body: JSON.stringify({ value: "Я".repeat(50_001) }) });
  assert.equal(oversized.status, 413);
  assert.equal(JSON.parse(oversized.body).error, "request_body_too_large");
  assert.equal((await call("/health")).status, 200);
});

test("request body decoding preserves Unicode split between chunks", async () => {
  const body = Buffer.from(JSON.stringify({ message: { text: "Привет" } }));
  const firstCharacter = body.indexOf(Buffer.from("П"));
  const response = await call("/api/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "test-only-webhook-secret" },
    chunks: [body.subarray(0, firstCharacter + 1), body.subarray(firstCharacter + 1)]
  });
  assert.equal(response.status, 200);
  assert.equal(updates.at(-1).message.text, "Привет");
});

test("unreadable or corrupt pricing state is a 500 and is preserved", async () => {
  await writeFile(process.env.PRICING_RULES_PATH, "{broken");
  const response = await call("/api/admin/pricing", { headers: { authorization: "Bearer test-only-admin-secret" } });
  assert.equal(response.status, 500);
  assert.equal(JSON.parse(response.body).error, "internal_error");
  assert.equal(await readFile(process.env.PRICING_RULES_PATH, "utf8"), "{broken");
});

test("invalid synchronization interval cannot create a one millisecond schedule", () => {
  for (const value of ["NaN", "Infinity", "oops", "-1", "0", "40000", "1e100"]) assert.equal(syncIntervalFromEnv(value), 15);
  assert.equal(syncIntervalFromEnv("2"), 5);
  assert.equal(syncIntervalFromEnv("20"), 20);
});

test("invalid pricing update is a 400 and cannot overwrite the existing configuration", async () => {
  await writeFile(process.env.PRICING_RULES_PATH, '{"rules":[]}');
  const response = await call("/api/admin/pricing", {
    method: "PUT",
    headers: { authorization: "Bearer test-only-admin-secret" },
    body: '{"rules":[{"enabled":true,"calculation":{"type":"percent","value":"NaN"}}]}'
  });
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(response.body).error, "invalid_pricing_config");
  assert.equal(await readFile(process.env.PRICING_RULES_PATH, "utf8"), '{"rules":[]}');
});

test("readiness requires the built application while health stays live", async () => {
  assert.equal((await call("/ready")).status, 200);
  await rm(join(temporaryRoot, "index.html"));
  try {
    assert.equal((await call("/ready")).status, 503);
    assert.equal((await call("/health")).status, 200);
  } finally {
    await writeFile(join(temporaryRoot, "index.html"), "<h1>Charter app</h1>");
  }
});

test("admin source choices reflect configured Telegram ingestion before the first sync", async () => {
  const prior = process.env.TELEGRAM_SOURCE_CHANNELS;
  process.env.TELEGRAM_SOURCE_CHANNELS = "test_custom_charter";
  try {
    const response = await call("/api/admin/sources", { headers: { authorization: "Bearer test-only-admin-secret" } });
    assert.equal(response.status, 200);
    const configured = JSON.parse(response.body).configuredSources;
    assert.ok(configured.some(source => source.id === "telegram:test_custom_charter" && source.kind === "telegram_public"));
    assert.ok(configured.every(source => Object.keys(source).every(key => ["id", "kind", "label"].includes(key))));
  } finally {
    if (prior === undefined) delete process.env.TELEGRAM_SOURCE_CHANNELS;
    else process.env.TELEGRAM_SOURCE_CHANNELS = prior;
  }
});

test("signed admin sessions enforce signature, expiry and the current Telegram allowlist", async () => {
  const now = Math.floor(Date.now() / 1000);
  const sign = (uid, exp) => {
    const payload = Buffer.from(JSON.stringify({ uid, exp })).toString("base64url");
    return payload + "." + createHmac("sha256", "test-only-admin-secret").update(payload).digest("base64url");
  };
  const valid = sign("42", now + 300);
  assert.equal((await call("/api/admin/status", { headers: { authorization: "Bearer " + valid } })).status, 200);
  for (const token of [sign("42", now), sign("42", now - 1), sign("99", now + 300), valid + ".junk", sign("42", "invalid"), valid.replace(/^./, "x")]) {
    assert.equal((await call("/api/admin/status", { headers: { authorization: "Bearer " + token } })).status, 401);
  }
});

test("Telegram admin login issues a usable session only for verified allowlisted identity", async () => {
  const initDataFor = uid => {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: uid }) });
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + "=" + value).join("\n");
    const signingKey = createHmac("sha256", "WebAppData").update("123456:TEST_TOKEN").digest();
    params.set("hash", createHmac("sha256", signingKey).update(check).digest("hex"));
    return params.toString();
  };
  const denied = await call("/api/admin/telegram-auth", { method: "POST", body: JSON.stringify({ initData: initDataFor(99) }) });
  assert.equal(denied.status, 403);
  const login = await call("/api/admin/telegram-auth", { method: "POST", body: JSON.stringify({ initData: initDataFor(42) }) });
  assert.equal(login.status, 200);
  const session = JSON.parse(login.body);
  assert.equal(session.admin.id, "42");
  assert.equal(session.expiresIn, 3600);
  assert.equal((await call("/api/admin/status", { headers: { authorization: "Bearer " + session.token } })).status, 200);
});

test("Railway pricing writes require a persistent mount containing the configured state file", async () => {
  const keys = ["RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_VOLUME_MOUNT_PATH"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const requestOptions = { method: "PUT", headers: { authorization: "Bearer test-only-admin-secret" }, body: '{"rules":[]}' };
  await writeFile(process.env.PRICING_RULES_PATH, '{"rules":[]}');
  try {
    process.env.RAILWAY_PROJECT_ID = "offline-test-project";
    delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
    const missing = await call("/api/admin/pricing", requestOptions);
    assert.equal(missing.status, 503);
    assert.equal(JSON.parse(missing.body).error, "persistent_storage_required");
    assert.equal(await readFile(process.env.PRICING_RULES_PATH, "utf8"), '{"rules":[]}');
    assert.equal((await call("/api/admin/pricing", { headers: { authorization: "Bearer test-only-admin-secret" } })).status, 200);
    process.env.RAILWAY_VOLUME_MOUNT_PATH = join(temporaryRoot, "outside-state-path");
    assert.equal((await call("/api/admin/pricing", requestOptions)).status, 503);
    process.env.RAILWAY_VOLUME_MOUNT_PATH = temporaryRoot;
    assert.equal((await call("/api/admin/pricing", requestOptions)).status, 200);
  } finally {
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
