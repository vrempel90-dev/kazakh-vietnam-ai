import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function emptyState() {
  return { version: 1, targets: {} };
}

export function publicationFingerprint(flight) {
  const payload = {
    id: String(flight?.id || ""),
    from: String(flight?.from || ""),
    to: String(flight?.to || ""),
    trip: String(flight?.trip || ""),
    price: Number(flight?.price || 0),
    airline: String(flight?.airline || ""),
    seats: String(flight?.seats || ""),
    departureDate: String(flight?.departureDate || ""),
    returnDate: String(flight?.returnDate || ""),
    hot: Boolean(flight?.hot)
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
}

export async function loadPublicationState(path) {
  const filePath = resolve(path);
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (!parsed || parsed.version !== 1 || typeof parsed.targets !== "object" || Array.isArray(parsed.targets)) {
      return emptyState();
    }
    return parsed;
  } catch {
    return emptyState();
  }
}

export function isPublicationPending(state, target, flight) {
  const previous = state?.targets?.[target]?.[flight?.id];
  return !previous || previous.fingerprint !== publicationFingerprint(flight);
}

export function markFlightsPublished(state, target, flights, publishedAt = new Date().toISOString()) {
  if (!state || state.version !== 1 || typeof state.targets !== "object") {
    throw new Error("Invalid Telegram publication state");
  }
  if (!state.targets[target]) state.targets[target] = {};

  for (const flight of flights) {
    if (!flight?.id) continue;
    state.targets[target][flight.id] = {
      fingerprint: publicationFingerprint(flight),
      publishedAt
    };
  }
  return state;
}

export function prunePublicationState(state, {
  now = new Date(),
  retentionDays = 30,
  maxEntriesPerTarget = 2000
} = {}) {
  if (!state?.targets || typeof state.targets !== "object") return state;
  const retentionMs = Math.max(1, Number(retentionDays) || 30) * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - retentionMs;
  const limit = Math.max(100, Math.floor(Number(maxEntriesPerTarget) || 2000));

  for (const [target, entries] of Object.entries(state.targets)) {
    const kept = Object.entries(entries || {})
      .filter(([, value]) => {
        const time = new Date(value?.publishedAt || 0).getTime();
        return Number.isFinite(time) && time >= cutoff;
      })
      .sort((a, b) => new Date(b[1]?.publishedAt || 0).getTime() - new Date(a[1]?.publishedAt || 0).getTime())
      .slice(0, limit);

    state.targets[target] = Object.fromEntries(kept);
  }
  return state;
}

export async function savePublicationState(path, state) {
  const filePath = resolve(path);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp-" + process.pid + "-" + Date.now();
  await writeFile(tempPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tempPath, filePath);
}
