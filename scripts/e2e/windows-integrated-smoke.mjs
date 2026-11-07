// Installed Electron smoke for the integrated Windows build.
// Playwright drives the real shell: health, first-run, screenshot, local save.
// It does not redirect OAuth. A packaged build must not accept a fake auth server.
import assert from "node:assert/strict";
import { readReinstallProof } from "./windows-integrated-reinstall-proof.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { _electron as electron } from "playwright-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { values } = parseArgs({
  options: {
    exe: { type: "string" },
    report: { type: "string" },
    checkpoint: { type: "string" },
    "installer-sha256": { type: "string" },
    "verify-checkpoint-sha256": { type: "string" },
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
assert.match(process.env.GITHUB_SHA ?? "", /^[0-9a-f]{40}$/);
const executable = resolve(values.exe);
const inside = relative(resolve(process.env.RUNNER_TEMP), executable);
if (isAbsolute(inside) || inside.startsWith("..")) {
  throw new Error("Use an isolated CI install directory");
}
const userData = join(process.env.APPDATA, "AIVORA");
const legacyUserData = join(process.env.APPDATA, "AIVORA Dev Core");
const checkpoint = join(process.env.RUNNER_TEMP, "AivoraIntegratedReinstall", "checkpoint.json");
assert.equal(resolve(values.checkpoint ?? ""), resolve(checkpoint));
assert.match(values["installer-sha256"] ?? "", /^[0-9a-f]{64}$/);
const verifying = !!values["verify-checkpoint-sha256"];
if ((!verifying && existsSync(userData)) || existsSync(legacyUserData)) {
  throw new Error("Smoke refuses an existing AIVORA profile");
}
const ffmpegSha = "ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e";
const ffprobeSha = "9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015";
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const proof = verifying
  ? readReinstallProof(checkpoint, values["verify-checkpoint-sha256"], {
      candidateHead: process.env.GITHUB_SHA,
      executable,
      userData,
      installerSha256: values["installer-sha256"],
      executableSha256: hash(executable),
    })
  : null;
if (!verifying)
  assert.equal(existsSync(checkpoint), false, "Fresh smoke refuses an existing proof");
else assert.equal(existsSync(userData), true, "Resume requires the original profile");
const environment = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|SYSTEMDRIVE|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(
        key,
      ),
    ),
  ),
  AIJIAN_FORBID_LIVE_MEDIA: "1",
};

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
  assert.equal(identity.version, "0.3.0");
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
  page.setDefaultTimeout(120_000);
  const saved =
    proof?.saved ??
    (await page.evaluate(async () => {
      const project = await globalThis.aijian.createProject({
        name: "集成安装验收",
        aspect_ratio: "9:16",
        target_duration_seconds: 30,
        source_language: "zh-CN",
      });
      const film = await globalThis.aijian.createStoryFilm(project.data.id, {
        scene_label: "雾城码头",
        narration: "信从雾里来",
        subtitle: "雾城来信",
        provider: "stub",
        confirmed: false,
      });
      const text = "安装器原位重装保留合成来源。";
      const bytes = new globalThis.TextEncoder().encode(text);
      const source = await globalThis.aijian.importTextSource(project.data.id, {
        filename: "原位重装样本.txt",
        media_type: "text/plain",
        content_base64: globalThis.btoa(Array.from(bytes, (v) => String.fromCharCode(v)).join("")),
      });
      const episode = await globalThis.aijian.createEpisode(project.data.id, {
        title: "重装保留样本集",
        target_duration_seconds: "15",
      });
      if (episode.kind !== "SUCCEEDED") throw new Error("Synthetic episode save failed");
      const before = await globalThis.aijian.getAppPreferences();
      if (before.kind !== "FOUND") throw new Error("Native settings read failed");
      const preferences = await globalThis.aijian.saveAppPreferences({
        expected_revision: before.receipt.data.revision,
        user_name: "原位重装保留用户",
        display_bio: "安装前已保存的设置，不得重建。",
        ui_language: "zh-CN",
        ui_theme: "dark-cinematic",
      });
      if (preferences.kind !== "SAVED") throw new Error("Native settings save failed");
      return {
        projectId: project.data.id,
        film: film.data,
        project: (await globalThis.aijian.getProject(project.data.id)).data,
        source: source.data,
        episode: episode.receipt.data,
        preferences: preferences.receipt.data,
      };
    }));
  if (proof) {
    const readback = await page.evaluate(
      async (saved) => ({
        project: (await globalThis.aijian.getProject(saved.projectId)).data,
        source: (await globalThis.aijian.getSource(saved.projectId, saved.source.id)).data,
        episode: (await globalThis.aijian.getEpisode(saved.projectId, saved.episode.id)).data,
        preferences: await globalThis.aijian.getAppPreferences(),
      }),
      saved,
    );
    assert.equal(readback.preferences.kind, "FOUND");
    assert(
      isDeepStrictEqual(
        { ...readback, preferences: readback.preferences.receipt.data },
        {
          project: saved.project,
          source: saved.source,
          episode: saved.episode,
          preferences: saved.preferences,
        },
      ),
      "Fresh installed process must read all original raw data",
    );
    assert.equal(hash(saved.film.output_path), proof.outputSha256);
  }
  assert.match(saved.projectId, /^prj_[0-9a-f]{32}$/);
  assert.equal(saved.film.status, "SUCCEEDED");
  assert.equal(saved.film.live_call, false);
  assert.equal(saved.film.has_video, true);
  assert.equal(saved.film.has_audio, true);
  assert.equal(typeof saved.film.output_path, "string");
  const probed = spawnSync(
    join(resources, "media", "ffprobe.exe"),
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      saved.film.output_path,
    ],
    { encoding: "utf8" },
  );
  assert.equal(probed.status, 0, probed.stderr);
  const media = JSON.parse(probed.stdout);
  const kinds = media.streams.map((stream) => stream.codec_type);
  assert.ok(kinds.includes("video") && kinds.includes("audio"));
  const duration = Number(media.format.duration);
  assert.ok(duration >= 1.5 && duration <= 3, String(duration));
  await application.close();
  application = undefined;
  assert.equal(sidecars().length, 0);
  if (!proof)
    writeFileSync(
      checkpoint,
      JSON.stringify({
        schemaVersion: 1,
        candidateHead: process.env.GITHUB_SHA,
        executable,
        userData,
        installerSha256: values["installer-sha256"],
        executableSha256: hash(executable),
        outputSha256: hash(saved.film.output_path),
        saved,
      }) + "\n",
      { flag: "wx" },
    );
  writeFileSync(
    values.report,
    JSON.stringify(
      {
        schema_version: 1,
        result: "PASS",
        mode: verifying ? "SAME_CANDIDATE_REINSTALL_READBACK" : "FRESH_INSTALL",
        original_raw_readback: verifying ? "PASS" : "CHECKPOINT_SAVED_PRIVATELY",
        original_settings_readback: verifying ? "PASS" : "SAVED_NATIVE",
        original_sample_media_sha256: hash(saved.film.output_path),
        health: "ok",
        sidecar: "one-child-then-stopped",
        media_cli_bundled: true,
        login_choice_visible: loginVisible,
        oauth_redirect: "not-used-packaged-shell-keeps-official-endpoints",
        project_id_prefix: "prj_",
        story_film: "stub-mp4",
        story_film_duration_seconds: duration,
        screenshots: [
          basename(values.report.replace(/\.json$/, ".png")),
          ...(loginVisible ? [basename(values.report.replace(/\.json$/, "-login.png"))] : []),
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
