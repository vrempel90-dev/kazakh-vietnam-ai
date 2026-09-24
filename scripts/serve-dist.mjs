import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));
const port = Number(process.env.PORT || 3000);

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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");

  if (url.pathname === "/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true }));
    return;
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
});
