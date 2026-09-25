import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { loadPricingConfig, savePricingConfig } from "./pricing-engine.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const root = fileURLToPath(new URL("../dist/client/", import.meta.url));
const port = Number(process.env.PORT || 3000);
const pricingPath = process.env.PRICING_RULES_PATH || "/data/pricing-rules.json";
const adminToken = String(process.env.ADMIN_PRICING_TOKEN || "");
const syncIntervalMinutes = Math.max(5, Number(process.env.SYNC_INTERVAL_MINUTES || 15));

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

function isAuthorized(req) {
  if (!adminToken) return false;
  const header = String(req.headers.authorization || "");
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBuffer = Buffer.from(adminToken);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
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
      PRICING_RULES_PATH: pricingPath
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
    sendJson(res, 200, { ok: true, sync: syncState });
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
  setTimeout(() => runFlightSync("startup"), 2500);
  setInterval(() => runFlightSync("scheduled"), syncIntervalMinutes * 60 * 1000);
});
