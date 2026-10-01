import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// The temporary file lives beside the destination so rename stays on one filesystem.
const writes = new Map();

export async function atomicWriteJson(path, value) {
  const filePath = resolve(path);
  const write = (writes.get(filePath) || Promise.resolve()).catch(() => {}).then(() => writeJson(filePath, value));
  writes.set(filePath, write);
  try { return await write; }
  finally { if (writes.get(filePath) === write) writes.delete(filePath); }
}

async function writeJson(path, value) {
  const filePath = resolve(path);
  const contents = JSON.stringify(value, null, 2) + "\n";
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = filePath + ".tmp-" + randomUUID();
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tempPath, filePath);
    // Persist the directory entry on platforms that support directory fsync.
    let directory;
    try {
      directory = await open(dirname(filePath), "r");
      await directory.sync();
    } catch (error) {
      if (!["EINVAL", "ENOTSUP", "EPERM", "EISDIR", "EBADF"].includes(error.code)) throw error;
    } finally {
      await directory?.close();
    }
  } finally {
    await handle?.close();
    await unlink(tempPath).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
}
