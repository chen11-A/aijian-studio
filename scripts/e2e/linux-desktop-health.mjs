// Headless health check for the unpacked Linux desktop package.
// xvfb supplies DISPLAY. This does not sign in or call a paid API.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { _electron as electron } from "playwright-core";

const { values } = parseArgs({ options: { root: { type: "string" } } });
if (process.platform !== "linux") throw new Error("Linux desktop health runs on Linux");
if (!values.root) throw new Error("Expected --root");
const root = resolve(values.root);
const configHome = mkdtempSync(join(tmpdir(), "aivora-linux-config-"));
const home = mkdtempSync(join(tmpdir(), "aivora-linux-home-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
delete env.AIJIAN_E2E_USER_DATA_DIR;
env.HOME = home;
env.XDG_CONFIG_HOME = configHome;
env.AIJIAN_FORBID_LIVE_MEDIA = "1";
env.AIJIAN_DRAFT_MEDIA_TOOL_ROOT = join(root, "runtime/ffmpeg/bin");
env.AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK = join(root, "config/linux-desktop-media-lock.json");
const check = spawnSync(join(root, "launch-aivora.sh"), ["--check"], {
  encoding: "utf8",
  env,
  timeout: 60_000,
});
assert.equal(check.status, 0, `${check.stdout}\n${check.stderr}`);
const ci = process.env.GITHUB_ACTIONS === "true";
let application;
try {
  application = await electron.launch({
    executablePath: join(root, "runtime/electron/electron"),
    args: [...(ci ? ["--no-sandbox", "--disable-dev-shm-usage"] : []), join(root, "apps/desktop")],
    env,
    timeout: 90_000,
  });
  const page = await application.firstWindow({ timeout: 90_000 });
  await page.waitForFunction(() => !!globalThis.aijian?.health, null, { timeout: 60_000 });
  const health = await page.evaluate(() => globalThis.aijian.health());
  assert.equal(health.data.status, "ok");
  const identity = await application.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath("userData"),
  }));
  assert.equal(identity.name, "AIVORA");
  assert.equal(identity.version, "0.3.0");
  assert.equal(identity.userData, join(configHome, "AIVORA"));
  const backend = readFileSync(
    join(identity.userData, "grok-official/storage-backend.txt"),
    "utf8",
  ).trim();
  const systemBackend = await application.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable() ? safeStorage.getSelectedStorageBackend() : "",
  );
  const expected = !systemBackend || systemBackend === "basic_text" ? "file_key" : systemBackend;
  assert.equal(backend, expected);
  globalThis.console.log(
    JSON.stringify({
      health: "ok",
      name: identity.name,
      version: identity.version,
      userData: identity.userData,
      storageBackend: backend,
      systemBackend: systemBackend || "unavailable",
    }),
  );
} finally {
  if (application) await application.close();
  rmSync(configHome, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
