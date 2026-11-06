/** Own a Vite server, invoke the actual --url CLI in a child Node process, close both. */
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const script = fileURLToPath(new URL("./pro-layout-audit.mjs", import.meta.url));
const args = process.argv.slice(2);
// The server URL is owned here; all other values still pass through the audit CLI's validation.
if (args.includes("--url")) throw new Error("The URL harness owns --url");
let vite;
let server;
let cache;
let child;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
  child?.kill("SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
try {
  cache = await mkdtemp(path.join(tmpdir(), "aivora-pro-url-vite-"));
  vite = await createServer({
    root: appRoot,
    configFile: path.join(appRoot, "vite.config.ts"),
    cacheDir: cache,
    logLevel: "warn",
    server: { host: "127.0.0.1", middlewareMode: true, open: false, hmr: false },
  });
  server = createHttpServer(vite.middlewares);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  if (interrupted) process.exitCode = 2;
  else
    process.exitCode = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [script, ...args, "--url", url], { stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 2));
    });
} catch (error) {
  if (process.env.GITHUB_ACTIONS === "true")
    console.error("::error title=Pro layout URL audit::PRO_LAYOUT_URL_HARNESS");
  else console.error(error.message);
  process.exitCode = 2;
} finally {
  const cleanup = await Promise.allSettled([
    vite?.close(),
    server
      ? new Promise((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        })
      : Promise.resolve(),
  ]);
  // This path was created exclusively by mkdtemp above; never recursively delete --out.
  if (cache) await rm(cache, { recursive: true, force: true });
  if (cleanup.some((result) => result.status === "rejected")) process.exitCode = 2;
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
