import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { loadPricingConfig, savePricingConfig } from "./pricing-engine.mjs";
import { createTelegramRuntime } from "./telegram-bot.mjs";
import { isTelegramAdmin, parseAdminTelegramIds, verifyTelegramInitData } from "./telegram-admin-auth.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../dist/client/", import.meta.url));
const port = Number(process.env.PORT || 3000);
const pricingPath = process.env.PRICING_RULES_PATH || "/data/pricing-rules.json";
const adminToken = String(process.env.ADMIN_PRICING_TOKEN || "");
const adminTelegramIds = parseAdminTelegramIds(process.env.ADMIN_TELEGRAM_IDS);
const syncIntervalMinutes = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES || 15));

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

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const clean = normalize(decoded).replace(/^([/\\])+/, "");
  if (clean.startsWith("..")) return null;
  return join(root, clean || "index.html");
}

async function sendFile(res, path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    res.statusCode = 200;
    res.setHeader("Content-Type", contentTypes[extname(path).toLowerCase()] || "application/octet-stream");
    res.setHeader("Cache-Control", extname(path) === ".html" || extname(path) === ".json"
      ? "no-cache"
      : "public, max-age=31536000, immutable");
    createReadStream(path).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
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
  const [payload, signature] = token.split(".", 2);
  const expected = createHmac("sha256", adminToken).update(payload).digest("base64url");
  if (!safeEqualText(signature, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed?.uid || !parsed?.exp) return false;
    if (Number(parsed.exp) < Math.floor(Date.now() / 1000)) return false;
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
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("Request body is too large");
  }
  return raw ? JSON.parse(raw) : {};
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      sync: syncState,
      telegram: {
        enabled: telegram.status.enabled,
        configured: telegram.status.configured,
        username: telegram.status.username,
        lastConfiguredAt: telegram.status.lastConfiguredAt,
        lastError: telegram.status.lastError
      }
    });
    return;
  }

  if (url.pathname === "/api/telegram/webhook" && req.method === "POST") {
    const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
    if (!telegram.isWebhookAuthorized(secretHeader)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    try {
      const update = await readJsonBody(req);
      sendJson(res, 200, { ok: true });
      void telegram.handleUpdate(update).catch(error => {
        console.error("Telegram update failed:", error instanceof Error ? error.message : String(error));
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (url.pathname === "/api/admin/telegram-auth" && req.method === "POST") {
    try {
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
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }

    try {
      if (url.pathname === "/api/admin/pricing" && req.method === "GET") {
        const config = await loadPricingConfig(pricingPath);
        sendJson(res, 200, { config, sync: syncState });
        return;
      }

      if (url.pathname === "/api/admin/pricing" && req.method === "PUT") {
        const body = await readJsonBody(req);
        const config = await savePricingConfig(pricingPath, body?.config ?? body);
        const syncStarted = runFlightSync("pricing-updated");
        sendJson(res, 200, { config, syncStarted, sync: syncState });
        return;
      }

      if (url.pathname === "/api/admin/sync" && req.method === "POST") {
        const syncStarted = runFlightSync("manual");
        sendJson(res, syncStarted ? 202 : 200, { syncStarted, sync: syncState });
        return;
      }

      if (url.pathname === "/api/admin/status" && req.method === "GET") {
        const config = await loadPricingConfig(pricingPath);
        sendJson(res, 200, { sync: syncState, pricingUpdatedAt: config.updatedAt });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
      return;
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  const requested = safePath(url.pathname);
  if (requested && await sendFile(res, requested)) return;

  if (await sendFile(res, join(root, "index.html"))) return;

  res.statusCode = 503;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Build output is unavailable");
});

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
