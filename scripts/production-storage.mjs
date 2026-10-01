import { isAbsolute, relative, resolve, sep } from "node:path";

export function assertDurableStateStorage(path, env = process.env, label = "Runtime state") {
  if (!env.RAILWAY_PROJECT_ID && !env.RAILWAY_ENVIRONMENT_ID) return;
  const error = reason => Object.assign(new Error(label + " " + reason), { code: "PERSISTENT_STORAGE_REQUIRED" });
  if (!env.RAILWAY_VOLUME_MOUNT_PATH) throw error("requires an attached Railway persistent volume; /data alone is ephemeral");
  const within = relative(resolve(env.RAILWAY_VOLUME_MOUNT_PATH), resolve(path));
  if (!within || within === ".." || within.startsWith(".." + sep) || isAbsolute(within))
    throw error("must be a file inside the Railway persistent volume");
}
