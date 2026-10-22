// Installed Electron smoke for the integrated Windows build.
// Playwright drives the real shell: health, first-run, screenshot, local save.
// It does not redirect OAuth. A packaged build must not accept a fake auth server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { _electron as electron } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    exe: { type: "string" },
    report: { type: "string" },
  },
});
if (
  process.platform !== "win32" ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.GITHUB_REPOSITORY !== "chen11-A/aijian-studio"
) {
  throw new Error("Integrated smoke runs only on this repository's Windows runner");
}
if (!values.exe || !values.report || !process.env.RUNNER_TEMP || !process.env.APPDATA) {
  throw new Error("Expected the installed executable, report path, and runner directories");
}
const executable = resolve(values.exe);
const inside = relative(resolve(process.env.RUNNER_TEMP), executable);
if (isAbsolute(inside) || inside.startsWith("..")) {
  throw new Error("Use an isolated CI install directory");
}
const userData = join(process.env.APPDATA, "AIVORA Dev Core");
if (existsSync(userData)) throw new Error("Smoke refuses an existing AIVORA Dev Core profile");
const ffmpegSha = "ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e";
const ffprobeSha = "9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015";
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|SYSTEMDRIVE|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(
      key,
    ),
  ),
);

function sidecars() {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "@(Get-CimInstance Win32_Process -Filter \"Name='aijian-sidecar.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return (Array.isArray(rows) ? rows : [rows]).filter((row) =>
    String(row.ExecutablePath ?? "")
      .toLowerCase()
      .startsWith(dirname(executable).toLowerCase()),
  );
}

let application;
try {
  application = await electron.launch({
    executablePath: executable,
    env: environment,
    chromiumSandbox: true,
    timeout: 60_000,
  });
  const page = await application.firstWindow({ timeout: 60_000 });
  await page.waitForFunction(() => !!globalThis.aijian?.health, null, { timeout: 45_000 });
  const health = await page.evaluate(() => globalThis.aijian.health());
  assert.equal(health.data.status, "ok");
  const identity = await application.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath("userData"),
  }));
  assert.equal(identity.name, "AIVORA");
  assert.equal(identity.version, "0.1.4");
  assert.equal(resolve(identity.userData).toLowerCase(), resolve(userData).toLowerCase());
  assert.equal(sidecars().length, 1);
  const resources = await application.evaluate(() => globalThis.process.resourcesPath);
  assert.equal(hash(join(resources, "media/ffmpeg.exe")), ffmpegSha);
  assert.equal(hash(join(resources, "media/ffprobe.exe")), ffprobeSha);
  const login = page.getByRole("button", { name: "用 Grok 账号登录" });
  const loginVisible = await login.isVisible().catch(() => false);
  if (loginVisible) {
    await page.screenshot({ path: values.report.replace(/\.json$/, "-login.png") });
  }
  const offline = page.getByRole("button", { name: "暂时离线创作", exact: true });
  if (await offline.isVisible().catch(() => false)) await offline.click();
  await page.screenshot({ path: values.report.replace(/\.json$/, ".png") });
  const saved = await page.evaluate(async () => {
    const project = await globalThis.aijian.createProject({
      name: "集成安装验收",
      aspect_ratio: "9:16",
      target_duration_seconds: 30,
      source_language: "zh-CN",
    });
    return project.data.id;
  });
  assert.match(saved, /^prj_[0-9a-f]{32}$/);
  await application.close();
  application = undefined;
  assert.equal(sidecars().length, 0);
  writeFileSync(
    values.report,
    JSON.stringify(
      {
        schema_version: 1,
        result: "PASS",
        health: "ok",
        sidecar: "one-child-then-stopped",
        media_cli_bundled: true,
        login_choice_visible: loginVisible,
        oauth_redirect: "not-used-packaged-shell-keeps-official-endpoints",
        project_id_prefix: "prj_",
        screenshots: [
          values.report.replace(/\.json$/, ".png"),
          ...(loginVisible ? [values.report.replace(/\.json$/, "-login.png")] : []),
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
} finally {
  if (application) await application.close();
}

void root;
