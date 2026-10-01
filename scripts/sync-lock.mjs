import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function withSyncLock(path, job) {
  const lockPath = resolve(path);
  await mkdir(dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const busy = new Error("Flight sync lock exists; another job is running or a crashed owner needs reconciliation");
    busy.code = "SYNC_LOCKED";
    throw busy;
  }
  const owner = randomUUID();
  try {
    await handle.writeFile(JSON.stringify({ owner, pid: process.pid, host: hostname(), startedAt: new Date().toISOString() }));
    await handle.sync();
    return await job();
  } finally {
    await handle.close();
    // Never remove a lock that another owner/operator has replaced.
    const current = JSON.parse(await readFile(lockPath, "utf8"));
    if (current.owner !== owner) throw new Error("Flight sync lock ownership changed during execution");
    await unlink(lockPath);
  }
}
