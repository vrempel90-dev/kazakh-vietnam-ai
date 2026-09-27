import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

function cleanOptionalNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : undefined;
}

export function sanitizeSourceStatus(status) {
  return {
    id: String(status?.id || "unknown"),
    kind: String(status?.kind || "unknown"),
    status: String(status?.status || "unknown"),
    reason: status?.reason ? String(status.reason).slice(0, 500) : undefined,
    finalUrl: status?.finalUrl ? String(status.finalUrl).slice(0, 1000) : undefined,
    rows: cleanOptionalNumber(status?.rows),
    usableRows: cleanOptionalNumber(status?.usableRows),
    messages: cleanOptionalNumber(status?.messages),
    offers: cleanOptionalNumber(status?.offers),
    ignoredAutoPosts: cleanOptionalNumber(status?.ignoredAutoPosts),
    currencySource: status?.currencySource ? String(status.currencySource) : undefined
  };
}

export async function writeSourceStatus(path, { statuses, summary }) {
  const payload = {
    generatedAt: new Date().toISOString(),
    sources: Array.isArray(statuses) ? statuses.map(sanitizeSourceStatus) : [],
    summary: summary && typeof summary === "object" ? summary : {}
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

export async function readSourceStatus(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}
