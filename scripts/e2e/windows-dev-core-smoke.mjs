// Actual installed Electron smoke on a fresh authorized GitHub Windows runner.
// It never reads existing profiles, requests AI authorization or contacts a provider.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { _electron as electron } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    exe: { type: "string" },
    manifest: { type: "string" },
    report: { type: "string" },
  },
});
if (
  process.platform !== "win32" ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "chen11-A/aijian-studio" ||
  process.env.GITHUB_REF !== "refs/heads/codex/windows-installer-dev-20261008"
) {
  throw new Error("This smoke is restricted to the authorized fresh Windows CI branch");
}
if (
  !values.exe ||
  !values.manifest ||
  !values.report ||
  !process.env.RUNNER_TEMP ||
  !process.env.APPDATA
) {
  throw new Error("Expected explicit executable, manifest, report and runner temporary paths");
}
const executable = resolve(values.exe);
const inside = relative(resolve(process.env.RUNNER_TEMP), executable);
if (isAbsolute(inside) || inside.startsWith(".."))
  throw new Error("Use an isolated CI install directory");
const userData = join(process.env.APPDATA, "AIVORA Dev Core");
if (existsSync(userData)) throw new Error("Smoke refuses an existing AIVORA Dev Core profile");
const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
assert.equal(manifest.profile, "DEVELOPMENT_CORE");
assert.equal(manifest.candidate_head, process.env.GITHUB_SHA);
assert.equal(manifest.media_cli_bundled, false);
const requireBuilder = createRequire(join(root, "packaging/windows/build-toolchain/package.json"));
const { extractFile } = requireBuilder("@electron/asar");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|SYSTEMDRIVE|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(
      key,
    ),
  ),
);
let application;
let firstIdentity;
let saved;
const rendererErrors = [];

function sidecars() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "@(Get-CimInstance Win32_Process -Filter \"Name='aijian-sidecar.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath) | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return (Array.isArray(rows) ? rows : [rows]).filter((row) =>
    String(row.ExecutablePath).toLowerCase().startsWith(dirname(executable).toLowerCase()),
  );
}

async function launch() {
  application = await electron.launch({
    executablePath: executable,
    env: environment,
    chromiumSandbox: true,
    timeout: 45_000,
  });
  const page = await application.firstWindow({ timeout: 45_000 });
  page.on("pageerror", (error) => rendererErrors.push(error.message));
  await page.waitForFunction(() => !!globalThis.aijian?.health, null, { timeout: 30_000 });
  await page.waitForFunction(() => globalThis.document.body?.innerText.includes("AIVORA"), null, {
    timeout: 30_000,
  });
  const identity = await application.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    name: app.getName(),
    appPath: app.getAppPath(),
    userData: app.getPath("userData"),
    resources: globalThis.process.resourcesPath,
    electron: globalThis.process.versions.electron,
    preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  assert.equal(identity.packaged, true);
  assert.equal(identity.name, "AIVORA Dev Core");
  assert.equal(identity.electron, "43.2.0");
  assert.equal(resolve(identity.userData).toLowerCase(), resolve(userData).toLowerCase());
  assert.equal(identity.preferences.sandbox, true);
  assert.equal(identity.preferences.contextIsolation, true);
  assert.equal(identity.preferences.nodeIntegration, false);
  assert.equal(identity.preferences.webSecurity, true);
  assert.ok(page.url().startsWith("file:"));
  assert.equal(existsSync(join(identity.resources, "media/ffmpeg.exe")), false);
  assert.equal(existsSync(join(identity.resources, "media/ffprobe.exe")), false);
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (name.startsWith("app/")) {
      assert.equal(hash(extractFile(identity.appPath, name.slice(4))), expected, name);
    } else if (name.startsWith("resources/")) {
      assert.equal(hash(readFileSync(join(identity.resources, name.slice(10)))), expected, name);
    }
  }
  const health = await page.evaluate(() => globalThis.aijian.health());
  assert.equal(health.data.status, "ok");
  assert.equal(sidecars().length, 1);
  return { page, identity };
}

async function close() {
  if (application) {
    await application.close();
    application = undefined;
  }
  assert.equal(sidecars().length, 0, "The installed app left a sidecar behind");
}

try {
  const { page, identity } = await launch();
  firstIdentity = identity;
  const offline = page.getByRole("button", { name: "暂时离线创作", exact: true });
  if (await offline.isVisible()) await offline.click();
  saved = await page.evaluate(async () => {
    const project = await globalThis.aijian.createProject({
      name: "Windows 开发核心版验收",
      aspect_ratio: "9:16",
      target_duration_seconds: 30,
      source_language: "zh-CN",
    });
    const text = "第一章\n只用于开发版安装、保存和重新打开的合成内容。";
    const bytes = new globalThis.TextEncoder().encode(text);
    const source = await globalThis.aijian.importTextSource(project.data.id, {
      filename: "合成来源.txt",
      media_type: "text/plain",
      content_base64: globalThis.btoa(
        Array.from(bytes, (value) => String.fromCharCode(value)).join(""),
      ),
    });
    const episode = await globalThis.aijian.createEpisode(project.data.id, {
      title: "第二集",
      target_duration_seconds: "15",
    });
    if (episode.kind !== "SUCCEEDED") {
      throw new Error(`Synthetic episode save did not succeed: ${episode.kind}`);
    }
    return {
      project: (await globalThis.aijian.getProject(project.data.id)).data,
      source: source.data,
      episode: episode.receipt.data,
    };
  });
  await page.screenshot({ path: values.report.replace(/\.json$/, ".png") });
  await close();
  const second = await launch();
  const readback = await second.page.evaluate(
    async ({ project, source, episode }) => ({
      project: (await globalThis.aijian.getProject(project.id)).data,
      source: (await globalThis.aijian.getSource(project.id, source.id)).data,
      episode: (await globalThis.aijian.getEpisode(project.id, episode.id)).data,
    }),
    saved,
  );
  assert.deepEqual(readback, saved);
  await close();
  assert.deepEqual(rendererErrors, []);
  writeFileSync(
    values.report,
    JSON.stringify(
      {
        schema_version: 1,
        result: "PASS",
        scope: "installed-development-core-native-smoke",
        candidate_head: manifest.candidate_head,
        packaged: firstIdentity.packaged,
        electron: firstIdentity.electron,
        user_data_directory: userData,
        resource_directory: firstIdentity.resources,
        verified: [
          "installed package bytes",
          "native Electron window",
          "sandboxed preload IPC",
          "managed frozen sidecar",
          "synthetic project/source/episode save",
          "full process shutdown",
          "fresh process exact readback",
          "no orphan sidecar",
          "media CLI absent",
        ],
        renderer_errors: rendererErrors,
        external_provider_requests: 0,
        standard_user_acceptance: "NOT_ESTABLISHED_BY_HOSTED_RUNNER",
        upgrade_recovery: "NOT_VERIFIED",
        media_export: "UNAVAILABLE_IN_THIS_BUILD",
        release_approved: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} finally {
  if (application) await application.close();
}
