import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadPricingConfig, savePricingConfig } from "./pricing-engine.mjs";
import { createTelegramRuntime, redactTelegramError } from "./telegram-bot.mjs";
import { isTelegramAdmin, parseAdminTelegramIds, verifyTelegramInitData } from "./telegram-admin-auth.mjs";
import { readSourceStatus } from "./source-status.mjs";
import { ingestSources } from "./source-registry.mjs";
import { assertDurableStateStorage } from "./production-storage.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../dist/client/", import.meta.url));
const port = Number(process.env.PORT || 3000);
const pricingPath = process.env.PRICING_RULES_PATH || "/data/pricing-rules.json";
const adminToken = String(process.env.ADMIN_PRICING_TOKEN || "");
const adminTelegramIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS);
export function syncIntervalFromEnv(value) {
  const minutes = Number(value || 15);
  return Number.isFinite(minutes) && minutes > 0 ? Math.max(5, minutes) : 15;
}
const syncIntervalMinutes = syncIntervalFromEnv(process.env.SYNC_INTERVAL_MINUTES);
const sourceStatusPath = process.env.SOURCE_STATUS_PATH || "/tmp/charter-source-status.json";

const publicAppUrl = String(
  process.env.PUBLIC_APP_URL
  || process.env.RAILWAY_SERVICE_CHARTER_APP_URL
  || process.env.RAILWAY_PUBLIC_DOMAIN
  || ""
).trim();

const telegram = createTelegramRuntime({
  token: process.env.TELEGRAM_BOT_TOKEN,
  publicAppUrl,
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  managerPhone: process.env.VITE_MANAGER_WHATSAPP || "77007772414",
  adminTelegramIds: process.env.ADMIN_TELEGRAM_IDS
});

const syncState = {
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null
};

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

class RequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function safePath(urlPath, staticRoot) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  if (decoded.includes("\0")) throw new RequestError("invalid_path");
  const path = resolve(staticRoot, "." + decoded.replaceAll("\\", "/"));
  const inside = relative(staticRoot, path);
  if (inside === ".." || inside.startsWith(".." + sep) || isAbsolute(inside)) return null;
  return inside ? path : join(staticRoot, "index.html");
}

async function sendFile(res, path, head = false) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypes[extname(path).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", extname(path) === ".html" || extname(path) === ".json"
      ? "no-cache"
      : "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", info.size);
    if (head) {
      res.end();
      return true;
    }
    const stream = createReadStream(path);
    stream.once("error", () => {
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, { error: "static_file_unavailable" });
    });
    res.once("close", () => stream.destroy());
    stream.pipe(res);
    return true;
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.removeHeader("Content-Length");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function signAdminSession(userId, ttlSeconds = 3600) {
  if (!adminToken) return "";
  const payload = Buffer.from(JSON.stringify({
    uid: String(userId),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds
  })).toString("base64url");
  const signature = createHmac("sha256", adminToken).update(payload).digest("base64url");
  return payload + "." + signature;
}

function verifyAdminSession(token) {
  if (!adminToken || !token || !token.includes(".")) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = createHmac("sha256", adminToken).update(payload).digest("base64url");
  if (!safeEqualText(signature, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.uid || !Number.isSafeInteger(parsed.exp)) return false;
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return false;
    return isTelegramAdmin(String(parsed.uid), adminTelegramIds);
  } catch {
    return false;
  }
}

function isAuthorized(req) {
  if (!adminToken) return false;
  const header = String(req.headers.authorization || "");
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (safeEqualText(provided, adminToken)) return true;
  return verifyAdminSession(provided);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 100_000) throw new RequestError("request_body_too_large", 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new RequestError("invalid_json");
  }
}

function runFlightSync(reason = "scheduled") {
  if (syncState.running) return false;
  syncState.running = true;
  syncState.lastStartedAt = new Date().toISOString();
  syncState.lastError = null;

  const child = spawn(process.execPath, ["scripts/sync-all-sources.mjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FLIGHT_FEED_OUTPUT: join(root, "flights.json"),
      PRICING_RULES_PATH: pricingPath,
      SOURCE_STATUS_PATH: sourceStatusPath,
      SYNC_REASON: reason
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", chunk => process.stdout.write("[flight-sync] " + chunk));
  child.stderr.on("data", chunk => process.stderr.write("[flight-sync] " + chunk));

  child.on("error", error => {
    syncState.running = false;
    syncState.lastFinishedAt = new Date().toISOString();
    syncState.lastError = error.message;
  });

  child.on("close", code => {
    syncState.running = false;
    syncState.lastFinishedAt = new Date().toISOString();
    syncState.lastError = code === 0 ? null : "sync exited with code " + code;
    console.log("Flight sync finished", { reason, code });
  });

  return true;
}

export function createAppServer({ staticRoot = root, telegramRuntime = telegram, startSync = runFlightSync } = {}) {
  async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
      // Validate percent encoding for API paths as well as static paths.
      decodeURIComponent(url.pathname);
    } catch {
      throw new RequestError("invalid_path");
    }

    if (url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        sync: syncState,
        telegram: {
          enabled: telegramRuntime.status.enabled,
          configured: telegramRuntime.status.configured,
          username: telegramRuntime.status.username,
          lastConfiguredAt: telegramRuntime.status.lastConfiguredAt,
          lastError: telegramRuntime.status.lastError
        }
      });
      return;
    }

    if (url.pathname === "/ready") {
      const build = await stat(join(staticRoot, "index.html")).catch(error => {
        if (error?.code === "ENOENT") return null;
        throw error;
      });
      const ready = Boolean(build?.isFile());
      sendJson(res, ready ? 200 : 503, { ok: ready, buildAvailable: ready });
      return;
    }

    if (url.pathname === "/api/telegram/webhook" && req.method === "POST") {
      const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
      if (!telegramRuntime.isWebhookAuthorized(secretHeader)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const update = await readJsonBody(req);
      sendJson(res, 200, { ok: true });
      void telegramRuntime.handleUpdate(update).catch(error => {
        console.error("Telegram update failed:", redactTelegramError(error, [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_WEBHOOK_SECRET, adminToken]));
      });
      return;
    }

    if (url.pathname === "/api/admin/telegram-auth" && req.method === "POST") {
      const body = await readJsonBody(req);
      const verified = verifyTelegramInitData(body?.initData, process.env.TELEGRAM_BOT_TOKEN, 900);
      if (!verified.ok || !isTelegramAdmin(verified.user?.id, adminTelegramIds)) {
        sendJson(res, 403, { error: "admin_access_denied" });
        return;
      }
      const sessionToken = signAdminSession(verified.user.id);
      if (!sessionToken) {
        sendJson(res, 503, { error: "admin_session_unavailable" });
        return;
      }
      sendJson(res, 200, {
        token: sessionToken,
        expiresIn: 3600,
        admin: verified.user
      });
      return;
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (!isAuthorized(req)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      if (url.pathname === "/api/admin/pricing" && req.method === "GET") {
        const config = await loadPricingConfig(pricingPath);
        sendJson(res, 200, { config, sync: syncState });
        return;
      }

      if (url.pathname === "/api/admin/pricing" && req.method === "PUT") {
        assertDurableStateStorage(pricingPath, process.env, "Pricing rules");
        const body = await readJsonBody(req);
        let config;
        try {
          config = await savePricingConfig(pricingPath, body?.config ?? body);
        } catch (error) {
          if (error instanceof TypeError) throw new RequestError("invalid_pricing_config");
          throw error;
        }
        const syncStarted = startSync("pricing-updated");
        sendJson(res, 200, { config, syncStarted, sync: syncState });
        return;
      }

      if (url.pathname === "/api/admin/sync" && req.method === "POST") {
        const syncStarted = startSync("manual");
        sendJson(res, syncStarted ? 202 : 200, { syncStarted, sync: syncState });
        return;
      }

      if (url.pathname === "/api/admin/status" && req.method === "GET") {
        const config = await loadPricingConfig(pricingPath);
        const sourceStatus = await readSourceStatus(sourceStatusPath);
        sendJson(res, 200, {
          sync: syncState,
          pricingUpdatedAt: config.updatedAt,
          sourceSummary: sourceStatus?.summary || null,
          sourcesUpdatedAt: sourceStatus?.generatedAt || null
        });
        return;
      }

      if (url.pathname === "/api/admin/sources" && req.method === "GET") {
        const sourceStatus = await readSourceStatus(sourceStatusPath);
        sendJson(res, 200, {
          ...(sourceStatus || {
          generatedAt: null,
          sources: [],
          summary: {},
          status: "not_synced_yet"
          }),
          configuredSources: ingestSources().map(({ id, kind, label }) => ({ id, kind, label }))
        });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.setHeader("Allow", "GET, HEAD");
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const requested = safePath(url.pathname, staticRoot);
    if (!requested) throw new RequestError("invalid_path", 403);
    if (await sendFile(res, requested, req.method === "HEAD")) return;

    if (extname(url.pathname)) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
    if (await sendFile(res, join(staticRoot, "index.html"), req.method === "HEAD")) return;

    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Build output is unavailable");
  }
  return createServer((req, res) => {
    void handleRequest(req, res).catch(error => {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      if (error?.code === "PERSISTENT_STORAGE_REQUIRED") {
        sendJson(res, 503, { error: "persistent_storage_required" });
        return;
      }
      if (error instanceof RequestError || error instanceof URIError) {
        if (error.statusCode === 413) {
          res.setHeader("Connection", "close");
          req.resume();
        }
        sendJson(res, error.statusCode || 400, { error: error instanceof URIError ? "invalid_path" : error.message });
        return;
      }
      // Filesystem/configuration failures must remain server failures, not client validation errors.
      console.error("HTTP request failed", {
        code: error?.code || "internal_error",
        message: redactTelegramError(error, [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_WEBHOOK_SECRET, adminToken])
      });
      sendJson(res, 500, { error: "internal_error" });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createAppServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`Charter app listening on 0.0.0.0:${port}`);
    if (!adminToken) console.warn("ADMIN_PRICING_TOKEN is not configured; pricing admin API is disabled.");

    if (telegram.status.enabled) {
      setTimeout(() => {
        void telegram.configure()
          .then(status => console.log("Telegram configured", { username: status.username }))
          .catch(error => console.error("Telegram configuration failed:", error instanceof Error ? error.message : String(error)));
      }, 1500);
    } else {
      console.warn("Telegram bot is not configured yet; set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET.");
    }

    setTimeout(() => runFlightSync("startup"), 2500);
    setInterval(() => runFlightSync("scheduled"), syncIntervalMinutes * 60 * 1000);
  });
}
