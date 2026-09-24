import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "vite";

const port = Number(process.env.MOBILE_RUNTIME_TEST_PORT ?? 4174);
const server = await createServer({ server: { host: "127.0.0.1", port, strictPort: true } });
await server.listen();

try {
  const code = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [resolve("node_modules/@playwright/test/cli.js"), "test", "--config", "playwright.chrome.config.ts"], {
      stdio: "inherit",
      env: { ...process.env, MOBILE_RUNTIME_TEST_PORT: String(port) },
    });
    child.once("error", reject);
    child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
  });
  process.exitCode = code;
} finally {
  await server.close();
}
