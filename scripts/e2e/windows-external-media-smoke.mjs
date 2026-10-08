// Installed DEVELOPMENT_CORE acceptance. Only native dialog return values are simulated.
// Backend, media tools, probes, encoding, saved receipts and Electron playback are real.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { release } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { asarManifestPath } from "./asar-manifest-path.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PROFILE = "windows-x86_64-gyan-full-8.1.2-dev";
const HASHES = {
  ffmpeg: "ad8f211bc894755e0061c55ab280ae00e8d3d4f15a8cc4372b24cfa247b5942e",
  ffprobe: "9df3b0b5275e830961df6d94e1f7a71121a7abd5ff708e9fec8a0b6084a55015",
};
const PROJECT_NAME = "Windows 外部媒体合成验收";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (path) => hash(readFileSync(path));
const operation = () => `dmp_${randomBytes(16).toString("hex")}`;
const sleep = (ms) => new Promise((done) => globalThis.setTimeout(done, ms));

export function assertAuthorizedHost(platform, env) {
  assert.equal(platform, "win32", "Windows acceptance must not execute on another host");
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_REPOSITORY, "chen11-A/aijian-studio");
  assert.equal(env.GITHUB_REF, "refs/heads/codex/windows-installer-dev-20261008");
  assert.equal(
    env.AIVORA_ARTIFACT_UPLOAD_ALLOWED,
    "false",
    "Requires the zero-upload test workflow",
  );
  assert.match(env.GITHUB_SHA ?? "", /^[0-9a-f]{40}$/);
  for (const name of ["RUNNER_TEMP", "APPDATA", "SystemRoot"])
    assert.ok(env[name], `Missing fresh runner environment: ${name}`);
}

export function assertCoreReceipt(core, candidate, userData, resources) {
  assert.equal(core.schema_version, 1);
  assert.equal(core.result, "PASS");
  assert.equal(core.scope, "installed-development-core-native-smoke");
  assert.equal(core.candidate_head, candidate);
  assert.equal(core.packaged, true);
  assert.equal(core.electron, "43.2.0");
  assert.equal(resolve(core.user_data_directory).toLowerCase(), resolve(userData).toLowerCase());
  assert.equal(resolve(core.resource_directory).toLowerCase(), resolve(resources).toLowerCase());
  assert.deepEqual(core.renderer_errors, []);
  for (const check of [
    "fresh process exact readback",
    "full process shutdown",
    "no orphan sidecar",
  ])
    assert.ok(core.verified.includes(check), `Missing prerequisite core check: ${check}`);
}

export function assemblyContent(project, episode, assets) {
  const ref = (name) => ({
    asset_id: assets[name].id,
    asset_version_id: assets[name].latest_version.id,
    sha256: assets[name].latest_version.sha256,
  });
  return {
    schema_version: "1.0.0",
    project_id: project,
    episode_id: episode,
    sequence_timebase: { frame_rate: { num: 24, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    canvas_width: 1280,
    canvas_height: 720,
    total_frames: 96,
    visual_segments: [
      {
        segment_id: "seg_clip-b",
        media_kind: "video",
        media: ref("clip_b"),
        start_frame: 0,
        end_frame: 48,
        source_in_frame: 12,
        embedded_audio: "MUTE",
      },
      {
        segment_id: "seg_clip-a",
        media_kind: "video",
        media: ref("clip_a"),
        start_frame: 48,
        end_frame: 96,
        source_in_frame: 24,
        embedded_audio: "MUTE",
      },
    ],
    audio_segments: [
      {
        segment_id: "seg_bgm",
        track_kind: "BGM",
        media: ref("bgm"),
        start_frame: 0,
        end_frame: 96,
        source_in_sample: 0,
        script_version_id: null,
        script_block_id: null,
        speaker_id: null,
        delivery: null,
      },
    ],
    subtitle_segments: [
      {
        segment_id: "seg_literal-subtitle",
        start_frame: 24,
        end_frame: 48,
        text: "第二段草稿 100% [测试]",
        render_profile: "noto-cjk-sc-bottom-v1",
      },
    ],
  };
}

export function syntheticProjectInput() {
  // Project metadata is constrained to 9:16 and >=30 seconds; the saved sequence
  // independently specifies the actual landscape, four-second acceptance media.
  return {
    name: PROJECT_NAME,
    aspect_ratio: "9:16",
    target_duration_seconds: 30,
    source_language: "zh-CN",
  };
}

export function publicJob(job) {
  return Object.fromEntries(
    [
      "operation_id",
      "project_id",
      "episode_id",
      "assembly_version_id",
      "assembly_content_hash",
      "status",
      "progress_frames",
      "total_frames",
      "output_filename",
      "output_sha256",
      "output_bytes",
      "error_code",
      "toolchain_profile_id",
      "draft",
      "rights_declaration",
    ].map((key) => [key, job[key]]),
  );
}

function inside(parent, child) {
  const part = relative(resolve(parent), resolve(child));
  return (
    part !== "" &&
    !isAbsolute(part) &&
    part !== ".." &&
    !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  );
}
function plain(path, kind = "file") {
  const info = lstatSync(path);
  assert.equal(info.isSymbolicLink(), false, "No symlinks or junction inputs");
  assert.ok(kind === "directory" ? info.isDirectory() : info.isFile());
  assert.equal(realpathSync(path).toLowerCase(), resolve(path).toLowerCase());
  return path;
}
function boundedJson(path) {
  plain(path);
  assert.ok(statSync(path).size < 4 * 1024 * 1024, "Receipt exceeds bounded size");
  return JSON.parse(readFileSync(path, "utf8"));
}
function statusData(result, available) {
  assert.equal(result.kind, "STATUS");
  const value = result.status;
  assert.equal(value.formal_release_approved, false);
  for (const key of ["can_probe", "can_preview", "can_draft_export"])
    assert.equal(value[key], available);
  if (available) {
    assert.equal(value.state, "AVAILABLE");
    assert.equal(value.source, "EXTERNAL");
    assert.equal(value.profile_id, PROFILE);
    assert.equal(value.version, "8.1.2");
  } else assert.notEqual(value.state, "AVAILABLE");
  return value;
}
function data(result, kind) {
  assert.equal(result.kind, kind, `Unexpected native result: ${result.kind} ${result.code ?? ""}`);
  return result.receipt.data;
}

export async function runWindowsSmoke(values) {
  assertAuthorizedHost(process.platform, process.env);
  for (const key of ["exe", "manifest", "report", "media-root", "inputs", "core-report"])
    assert.ok(values[key] && isAbsolute(values[key]), `Expected explicit absolute --${key}`);
  const executable = plain(resolve(values.exe));
  const resources = plain(join(dirname(executable), "resources"), "directory");
  const mediaRoot = plain(resolve(values["media-root"]), "directory");
  const userData = plain(join(process.env.APPDATA, "AIVORA Dev Core"), "directory");
  const reportPath = resolve(values.report);
  const workRoot = plain(join(process.env.RUNNER_TEMP, "aivora-external-media-test"), "directory");
  const outputRoot = join(workRoot, "native-outputs");
  assert.equal(basename(executable), "AIVORA Dev Core.exe");
  for (const path of [executable, mediaRoot, reportPath, values.inputs, values["core-report"]])
    assert.ok(inside(process.env.RUNNER_TEMP, path), "Require isolated fresh runner paths");
  assert.equal(existsSync(reportPath), false, "Never overwrite earlier evidence");
  assert.equal(existsSync(outputRoot), false, "Never reuse an earlier acceptance output directory");
  for (const parent of [root, dirname(executable), userData])
    assert.equal(
      inside(parent, mediaRoot) || parent.toLowerCase() === mediaRoot.toLowerCase(),
      false,
    );
  const manifest = boundedJson(values.manifest);
  assert.equal(manifest.profile, "DEVELOPMENT_CORE");
  assert.equal(manifest.candidate_head, process.env.GITHUB_SHA);
  assert.equal(manifest.media_cli_bundled, false);
  assertCoreReceipt(
    boundedJson(values["core-report"]),
    manifest.candidate_head,
    userData,
    resources,
  );
  const inputs = boundedJson(values.inputs);
  assert.equal(inputs.schema_version, 1);
  assert.equal(inputs.kind, "windows-external-media-synthetic-inputs");
  assert.equal(inputs.candidate_head, manifest.candidate_head);
  assert.equal(resolve(inputs.toolchain_root).toLowerCase(), mediaRoot.toLowerCase());
  assert.equal(inputs.profile_id, PROFILE);
  assert.equal(inputs.process_boundary.result, "PASS");
  assert.equal(inputs.frozen_policy_refusal.result, "PASS");
  assert.equal(resolve(inputs.work_directory).toLowerCase(), workRoot.toLowerCase());
  const python = plain(join(process.env.RUNNER_TEMP, "aivora-frozen/build-env/Scripts/python.exe"));
  assert.equal(resolve(inputs.python_executable).toLowerCase(), python.toLowerCase());
  for (const [name, expected] of Object.entries(HASHES)) {
    assert.equal(inputs[`${name}_sha256`], expected);
    assert.equal(digest(plain(join(mediaRoot, `${name}.exe`))), expected);
  }
  for (const name of ["clip_a", "clip_b", "bgm", "cancel_still"]) {
    const item = inputs.files[name];
    assert.ok(item && inside(process.env.RUNNER_TEMP, item.path));
    for (const parent of [root, resources, userData, mediaRoot])
      assert.equal(inside(parent, item.path), false);
    plain(item.path);
    assert.ok(item.bytes > 0 && item.bytes < 32 * 1024 * 1024);
    assert.equal(statSync(item.path).size, item.bytes);
    assert.equal(digest(item.path), item.sha256);
  }
  mkdirSync(outputRoot);
  const requireBuilder = createRequire(
    join(root, "packaging/windows/build-toolchain/package.json"),
  );
  const { extractFile } = requireBuilder("@electron/asar");
  const { _electron: electron } = await import("playwright-core");
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|COMSPEC|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|SYSTEMDRIVE|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(
        key,
      ),
    ),
  );
  const executableHash = digest(executable);
  const evidence = {
    schema_version: 1,
    scope: "installed-development-core-external-media-smoke",
    result: "FAIL",
    candidate_head: manifest.candidate_head,
    harness_sha256: digest(fileURLToPath(import.meta.url)),
    executable_sha256: executableHash,
    inputs_manifest_sha256: digest(values.inputs),
    process_boundary: Object.fromEntries(
      [
        "result",
        "actual_windows_execution",
        "held_handle_mutations_denied",
        "preexisting_write_handle_refused",
        "actual_protected_dacl_readback",
        "private_session_removed",
        "minimal_launch_environment_keys",
        "actual_job_cancellation_no_descendants",
        "mitigation_flags",
        "private_job_membership",
        "loaded_module_names",
        "loaded_dependencies_under_windows",
      ].map((key) => [key, inputs.process_boundary[key]]),
    ),
    frozen_policy_refusal: Object.fromEntries(
      ["result", "frozen_override_variables_rejected", "formal_export", "formal_ledger_rows"].map(
        (key) => [key, inputs.frozen_policy_refusal[key]],
      ),
    ),
    core_report_sha256: digest(values["core-report"]),
    windows_version: release(),
    interaction_boundary:
      "Actual installed UI and sandbox preload IPC; native file/folder/save picker selections simulated at Electron dialog return only",
    backend_probe_encoder_mocks: false,
    environment_media_override: false,
    manual_native_picker_acceptance: "NOT_ESTABLISHED",
    manual_subtitle_legibility: "REVIEW_CROPPED_STILLS",
    release_approved: false,
    verified: [],
    jobs: [],
    playback: [],
  };
  let application, page;
  let missingTool;
  const rendererErrors = [];
  const ps = (command) => {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf8", timeout: 20_000, windowsHide: true },
    );
    assert.equal(result.status, 0, "Process observation failed");
    const rows = result.stdout.trim() ? JSON.parse(result.stdout) : [];
    return Array.isArray(rows) ? rows : [rows];
  };
  const processes = () =>
    ps(
      "@(Get-CimInstance Win32_Process -Filter \"Name='aijian-sidecar.exe' OR Name='ffmpeg.exe' OR Name='ffprobe.exe'\" | Select-Object ProcessId,ParentProcessId,ExecutablePath) | ConvertTo-Json -Compress",
    );
  const owned = () =>
    processes().filter(
      (row) =>
        row.ExecutablePath &&
        (inside(dirname(executable), row.ExecutablePath) || inside(mediaRoot, row.ExecutablePath)),
    );
  const ipc = (method, ...args) =>
    page.evaluate(async ({ method, args }) => globalThis.aijian[method](...args), { method, args });
  async function until(read, accept, label, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    do {
      const value = await read();
      if (accept(value)) return value;
      await sleep(150);
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${label}`);
  }
  async function launch() {
    assert.deepEqual(owned(), [], "No previous acceptance process may still be alive");
    assert.equal(digest(executable), executableHash);
    application = await electron.launch({
      executablePath: executable,
      env: environment,
      chromiumSandbox: true,
      timeout: 45_000,
    });
    page = await application.firstWindow({ timeout: 45_000 });
    page.on("pageerror", () => rendererErrors.push("renderer-pageerror"));
    await page.waitForFunction(() => !!globalThis.aijian?.getMediaToolchainStatus, null, {
      timeout: 45_000,
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
    assert.equal(resolve(identity.userData).toLowerCase(), userData.toLowerCase());
    assert.equal(resolve(identity.resources).toLowerCase(), resources.toLowerCase());
    assert.equal(
      resolve(identity.appPath).toLowerCase(),
      join(resources, "app.asar").toLowerCase(),
    );
    for (const [key, expected] of Object.entries({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    }))
      assert.equal(identity.preferences[key], expected);
    assert.ok(page.url().startsWith("file:"));
    for (const name of ["ffmpeg", "ffprobe"])
      assert.equal(existsSync(join(resources, "media", `${name}.exe`)), false);
    for (const [name, expected] of Object.entries(manifest.files)) {
      if (name.startsWith("app/"))
        assert.equal(
          hash(extractFile(identity.appPath, asarManifestPath(name.slice(4)))),
          expected,
        );
      else if (name.startsWith("resources/"))
        assert.equal(digest(join(resources, name.slice(10))), expected);
    }
    assert.equal((await ipc("health")).data.status, "ok");
    const children = owned().filter((p) =>
      p.ExecutablePath.toLowerCase().endsWith("\\aijian-sidecar.exe"),
    );
    assert.equal(
      children.length,
      1,
      "Expected the same single managed frozen sidecar as core smoke",
    );
    assert.ok(Number.isSafeInteger(children[0].ProcessId) && children[0].ProcessId > 0);
    const modules = ps(
      `@((Get-Process -Id ${children[0].ProcessId} -ErrorAction Stop).Modules | Where-Object { $_.ModuleName -ieq 'ucrtbase.dll' } | Select-Object FileName) | ConvertTo-Json -Compress`,
    );
    assert.equal(modules.length, 1);
    assert.equal(
      realpathSync(modules[0].FileName).toLowerCase(),
      realpathSync(join(process.env.SystemRoot, "System32/ucrtbase.dll")).toLowerCase(),
    );
    const offline = page.getByRole("button", { name: "暂时离线创作", exact: true });
    if (await offline.isVisible()) await offline.click();
  }
  async function close() {
    if (application) {
      await application.close();
      application = undefined;
    }
    await until(
      async () => owned(),
      (rows) => rows.length === 0,
      "clean process shutdown",
      20_000,
    );
  }
  async function route(name) {
    await page.evaluate((name) => {
      globalThis.history.pushState({}, "", `#${name}`);
      globalThis.dispatchEvent(new globalThis.PopStateEvent("popstate"));
    }, name);
    await page.locator(`.production-workbench[data-page="${name}"]`).waitFor();
  }
  async function armDialog(kind, path, deferred = false) {
    await application.evaluate(
      ({ dialog }, { kind, path, deferred }) => {
        if (globalThis.__nativeAcceptanceDialog) throw new Error("Dialog simulation already armed");
        const method = kind === "save" ? "showSaveDialog" : "showOpenDialog";
        const state = { method, original: dialog[method], calls: 0, resolve: null };
        globalThis.__nativeAcceptanceDialog = state;
        dialog[method] = async (_window, options) => {
          state.calls += 1;
          if (state.calls !== 1) throw new Error("Unexpected repeated native dialog");
          if (
            kind !== "save" &&
            !options.properties.includes(kind === "directory" ? "openDirectory" : "openFile")
          )
            throw new Error("Unexpected native picker purpose");
          const result =
            kind === "save"
              ? { canceled: path === null, filePath: path ?? undefined }
              : { canceled: path === null, filePaths: path === null ? [] : [path] };
          if (deferred)
            return new Promise((done) => {
              state.resolve = () => done(result);
            });
          return result;
        };
      },
      { kind, path, deferred },
    );
  }
  async function finishDialog() {
    const calls = await application.evaluate(({ dialog }) => {
      const state = globalThis.__nativeAcceptanceDialog;
      if (!state) throw new Error("Dialog simulation was not armed");
      dialog[state.method] = state.original;
      delete globalThis.__nativeAcceptanceDialog;
      return state.calls;
    });
    assert.equal(calls, 1);
  }
  async function settings() {
    await route("settings");
    await page.getByRole("button", { name: "本地媒体工具 · DRAFT", exact: true }).click();
  }
  async function selectTools() {
    await settings();
    await armDialog("directory", mediaRoot);
    await page.getByRole("button", { name: "选择媒体工具文件夹", exact: true }).click();
    await until(
      () => ipc("getMediaToolchainStatus"),
      (r) => r.kind === "STATUS" && r.status.state === "AVAILABLE",
      "verified external tools",
      90_000,
    );
    await finishDialog();
    const selected = statusData(await ipc("getMediaToolchainStatus"), true);
    assert.equal(resolve(selected.directory).toLowerCase(), mediaRoot.toLowerCase());
    await page.getByRole("button", { name: "关闭媒体工具设置", exact: true }).click();
  }
  async function chooseProject(project, episode) {
    await page.reload();
    // Global pages intentionally hide the compact project selector. Enter the
    // real project through its visible management row rather than forcing an
    // action on a hidden legacy control.
    await route("projects");
    const row = page.locator(".v2-project-row").filter({
      has: page.getByRole("button", { name: project.name, exact: true }),
    });
    await row.getByRole("button", { name: "打开项目", exact: true }).click();
    await page.locator('.production-workbench[data-page="project"]').waitFor();
    await page.getByLabel("剧集选择", { exact: true }).selectOption(episode.id);
  }
  async function checkAssetSelectionLayout(filename, width, height) {
    await application.evaluate(
      ({ BrowserWindow }, size) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length !== 1) throw new Error("Expected the single installed main window");
        windows[0].setContentSize(size.width, size.height);
      },
      { width, height },
    );
    await page.waitForFunction(
      (size) => globalThis.innerWidth === size.width && globalThis.innerHeight === size.height,
      { width, height },
    );
    const select = page.getByRole("button", { name: `选择 ${filename}`, exact: true });
    await select.click();
    const card = page.locator(".v2-assets-card").filter({ has: select });
    const [previewBox, selectBox, infoBox] = await Promise.all([
      card.locator(".v2-assets-card-image").boundingBox(),
      select.boundingBox(),
      card.locator(".v2-assets-card-info").boundingBox(),
    ]);
    assert.ok(previewBox && selectBox && infoBox, "Asset actions need visible geometry");
    assert.ok(previewBox.y + previewBox.height <= selectBox.y + 1);
    assert.ok(selectBox.y + selectBox.height <= infoBox.y + 1);
    const clearHit = await select.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      const hit = globalThis.document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return hit === button || button.contains(hit);
    });
    assert.equal(clearHit, true, "The normal selection target must not be covered");
    evidence.asset_selection_layout ??= [];
    evidence.asset_selection_layout.push({ width, height, normal_click: true, clear_hit: true });
  }
  async function importAsset(project, name) {
    const item = inputs.files[name];
    await route("assets");
    await armDialog("file", item.path);
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    const result = await until(
      () => ipc("listProjectMediaAssets", project),
      (r) =>
        r.kind === "LISTED" && r.receipt.data.some((a) => a.latest_version.sha256 === item.sha256),
      "native asset import",
    );
    await finishDialog();
    const matches = result.receipt.data.filter((a) => a.latest_version.sha256 === item.sha256);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].latest_version.byte_size, item.bytes);
    assert.equal(matches[0].latest_version.rights_status, "PENDING_REVIEW");
    return matches[0];
  }
  async function terminal(project, episode, id) {
    const result = await until(
      () => ipc("getDraftExport", project, episode, id),
      (r) =>
        r.kind === "FOUND" && !["QUEUED", "RUNNING", "VERIFYING"].includes(r.receipt.data.status),
      "real terminal DRAFT receipt",
      180_000,
    );
    return data(result, "FOUND");
  }
  function command(version) {
    return {
      operation_id: operation(),
      assembly_version_id: version.version_id,
      assembly_content_hash: version.content_hash,
      rights_declaration: "OWNED_OR_SYNTHETIC",
    };
  }
  async function verifyOutput(job, kind) {
    assert.equal(job.status, "SUCCEEDED", `DRAFT ${job.status}: ${job.error_code}`);
    assert.equal(job.total_frames, 96);
    assert.equal(job.progress_frames, 96);
    assert.equal(job.toolchain_profile_id, PROFILE);
    assert.equal(job.draft, true);
    assert.equal(job.rights_declaration, "OWNED_OR_SYNTHETIC");
    assert.ok(
      inside(
        kind === "draft" ? outputRoot : join(userData, "composition-previews"),
        job.output_path,
      ),
    );
    assert.equal(digest(plain(job.output_path)), job.output_sha256);
    assert.equal(statSync(job.output_path).size, job.output_bytes);
    const verifyPath = join(workRoot, `${kind}-verification.json`);
    const checked = spawnSync(
      python,
      [
        join(root, "scripts/e2e/windows_external_media_checks.py"),
        "verify",
        "--tool-root",
        mediaRoot,
        "--input",
        job.output_path,
        "--report",
        verifyPath,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 120_000,
        windowsHide: true,
        env: { ...process.env, PYTHONPATH: join(root, "services/api/src") },
      },
    );
    assert.equal(checked.status, 0, "Guarded output media verification failed");
    const verification = boundedJson(verifyPath);
    assert.equal(verification.result, "PASS");
    assert.equal(verification.sha256, job.output_sha256);
    assert.equal(verification.bytes, job.output_bytes);
    assert.equal(verification.frames, 96);
    evidence.jobs.push({ ...publicJob(job), verification });
  }
  async function playback(job, name) {
    await route("export");
    await page.getByRole("button", { name: "重新读取保存版本与任务", exact: true }).click();
    const output = page.getByRole("region", {
      name: `${job.output_filename} 已验证草稿操作`,
      exact: true,
    });
    await output.getByRole("button", { name: "播放已验证草稿", exact: true }).click();
    const video = output.getByLabel("已验证 DRAFT 草稿视频", { exact: true });
    await video.waitFor();
    await until(
      () => video.evaluate((v) => ({ ready: v.readyState, error: v.error?.code ?? null })),
      (r) => r.ready >= 2 || r.error !== null,
      "actual Electron video decode",
    );
    const decoded = await video.evaluate(async (v) => {
      if (v.error) throw new Error("Native video decode failed");
      const start = v.currentTime;
      v.muted = true;
      await v.play();
      await new Promise((done, reject) => {
        const timer = globalThis.setTimeout(
          () => reject(new Error("Playback did not advance")),
          10_000,
        );
        const check = () => {
          if (v.currentTime > start + 0.25) {
            globalThis.clearTimeout(timer);
            v.removeEventListener("timeupdate", check);
            done();
          }
        };
        v.addEventListener("timeupdate", check);
      });
      v.pause();
      return {
        width: v.videoWidth,
        height: v.videoHeight,
        duration: v.duration,
        advanced_seconds: v.currentTime - start,
        error: v.error?.code ?? null,
      };
    });
    assert.equal(decoded.width, 1280);
    assert.equal(decoded.height, 720);
    assert.ok(Math.abs(decoded.duration - 4) < 0.1);
    assert.equal(decoded.error, null);
    await video.evaluate(async (v) => {
      await new Promise((done, reject) => {
        let timer;
        const cleanup = () => {
          globalThis.clearTimeout(timer);
          v.removeEventListener("seeked", seeked);
          v.removeEventListener("error", failed);
        };
        const seeked = () => {
          cleanup();
          done();
        };
        const failed = () => {
          cleanup();
          reject(new Error("Native video seek failed"));
        };
        v.addEventListener("seeked", seeked, { once: true });
        v.addEventListener("error", failed, { once: true });
        timer = globalThis.setTimeout(() => {
          cleanup();
          reject(new Error("Native video seek timed out"));
        }, 10_000);
        if (v.error) {
          failed();
          return;
        }
        try {
          v.currentTime = 1.5;
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    });
    const screenshot = join(dirname(reportPath), `external-media-${name}.png`);
    assert.equal(existsSync(screenshot), false, "Never overwrite earlier screenshot evidence");
    await video.screenshot({ path: screenshot });
    evidence.playback.push({
      operation_id: job.operation_id,
      ...decoded,
      screenshot: basename(screenshot),
      screenshot_sha256: digest(screenshot),
      audio_output: "MUTED_FOR_CI; PCM_VERIFIED_BY_GUARDED_HELPER",
    });
    await output.getByRole("button", { name: "关闭草稿预览", exact: true }).click();
  }

  try {
    await launch();
    const prior = (await ipc("listProjects")).data;
    assert.equal(
      prior.length,
      1,
      "Refuse any profile except the immediately preceding synthetic core smoke",
    );
    assert.equal(prior[0].name, "Windows 开发核心版验收");
    const sources = (await ipc("listSources", prior[0].id)).data;
    assert.equal(sources.length, 1);
    assert.equal(sources[0].filename, "合成来源.txt");
    assert.equal(
      sources[0].raw_sha256,
      hash("第一章\n只用于开发版安装、保存和重新打开的合成内容。"),
    );
    assert.deepEqual(
      (await ipc("listProviderConnections")).data,
      [],
      "Refuse any configured provider profile",
    );
    assert.deepEqual(
      data(await ipc("listProjectMediaAssets", prior[0].id), "LISTED"),
      [],
      "Refuse preexisting non-core media",
    );
    statusData(await ipc("getMediaToolchainStatus"), false);
    assert.equal(owned().filter((p) => inside(mediaRoot, p.ExecutablePath)).length, 0);
    evidence.verified.push(
      "exact installed package and sandbox identity",
      "fresh synthetic core profile prerequisite",
      "unconfigured media capabilities unavailable",
    );

    await armDialog("directory", mediaRoot, true);
    const pendingSelection = ipc("selectMediaToolchain");
    await until(
      () => application.evaluate(() => globalThis.__nativeAcceptanceDialog?.calls),
      (n) => n === 1,
      "pending native picker",
    );
    assert.equal((await ipc("selectMediaToolchain")).kind, "PICKER_BUSY");
    assert.equal((await ipc("cancelMediaToolchainSelection")).kind, "CANCELLED");
    await application.evaluate(() => globalThis.__nativeAcceptanceDialog.resolve());
    assert.equal((await pendingSelection).kind, "PICKER_CANCELLED");
    await finishDialog();
    statusData(await ipc("getMediaToolchainStatus"), false);
    evidence.verified.push("simulated delayed native picker cancellation and repeat protection");

    const project = (await ipc("createProject", syntheticProjectInput())).data;
    const episode = data(
      await ipc("createEpisode", project.id, {
        title: "合成剪辑验收",
        target_duration_seconds: "4",
      }),
      "SUCCEEDED",
    );
    await chooseProject(project, episode);
    const assets = {};
    // Raw import is allowed before tools exist; it is not itself probe evidence.
    assets.clip_a = await importAsset(project.id, "clip_a");
    statusData(await ipc("getMediaToolchainStatus"), false);
    await selectTools();
    evidence.verified.push("native exact external tool selection and authoritative readback");
    assets.clip_b = await importAsset(project.id, "clip_b");
    assets.bgm = await importAsset(project.id, "bgm");
    evidence.verified.push(
      "native import and authoritative readback of two videos and synthetic BGM",
    );
    await route("assets");
    for (const [width, height] of [
      [1178, 814],
      [980, 680],
      [1178, 814],
    ])
      await checkAssetSelectionLayout(assets.clip_a.latest_version.filename, width, height);
    evidence.verified.push(
      "unobstructed asset selection at normal and minimum native window sizes",
    );
    const probes = {};
    for (const name of ["clip_a", "clip_b"]) {
      const asset = assets[name];
      await route("assets");
      await page
        .getByRole("button", { name: `选择 ${asset.latest_version.filename}`, exact: true })
        .click();
      await page.getByRole("button", { name: "探测选中视频版本", exact: true }).click();
      const probe = data(
        await until(
          () => ipc("getMediaAssetProbeEvidence", project.id, asset.id, asset.latest_version.id),
          (r) => r.kind === "FOUND",
          "persisted exact-version video probe",
          90_000,
        ),
        "FOUND",
      );
      assert.equal(probe.asset_sha256, inputs.files[name].sha256);
      assert.equal(probe.version_id, asset.latest_version.id);
      assert.equal(probe.probe.video.frames.length, 72);
      assert.equal(probe.probe.video.width, 1280);
      assert.equal(probe.probe.video.height, 720);
      assert.deepEqual(probe.probe.video.average_frame_rate, { num: 24, den: 1 });
      assert.equal(probe.toolchain_profile_id, PROFILE);
      for (const tool of ["ffmpeg", "ffprobe"]) assert.equal(probe[`${tool}_sha256`], HASHES[tool]);
      probes[name] = probe;
    }
    const content = assemblyContent(project.id, episode.id, assets);
    const version = data(
      await ipc("createEpisodeMediaAssemblyVersion", project.id, episode.id, {
        content,
        parent_version_id: null,
        expected_revision: null,
        change_summary: "合成 B→A 剪辑，非零入点、统一 BGM 与字面中文字幕",
      }),
      "CREATED",
    );
    assert.deepEqual(version.content, content);
    // Static assembly playback intentionally blocks audio. DRAFT and continuous
    // preview independently probe and validate BGM using the real encoder.
    assert.equal(version.playback_status, "BLOCKED_MEDIA_PROBE");
    assert.deepEqual(
      data(
        await ipc("getEpisodeMediaAssemblyVersion", project.id, episode.id, version.version_id),
        "FOUND",
      ),
      version,
    );
    evidence.assembly = {
      artifact_id: version.artifact_id,
      version_id: version.version_id,
      content_hash: version.content_hash,
      static_playback_status: version.playback_status,
      content,
    };
    evidence.probes = Object.fromEntries(
      Object.entries(probes).map(([name, p]) => [
        name,
        {
          id: p.id,
          asset_id: p.asset_id,
          version_id: p.version_id,
          asset_sha256: p.asset_sha256,
          probe_sha256: p.probe_sha256,
          frames: p.probe.video.frames.length,
          toolchain_profile_id: p.toolchain_profile_id,
        },
      ]),
    );
    evidence.verified.push(
      "native UI raw import before tools",
      "native settings external selection",
      "native UI imports and exact-version probes",
      "real saved B then A trimmed assembly with unity BGM and literal subtitle",
    );

    await route("export");
    const exportPanel = page.getByRole("region", { name: "草稿 MP4 导出", exact: true });
    await exportPanel.getByRole("checkbox").check();
    const draftPath = join(outputRoot, "中文 DRAFT 合成验收.mp4");
    await armDialog("save", draftPath);
    await exportPanel
      .getByRole("button", { name: "选择保存位置并导出草稿 MP4", exact: true })
      .click();
    const submitted = await until(
      () => ipc("listDraftExports", project.id, episode.id),
      (r) => r.kind === "LISTED" && r.receipt.data.items.length === 1,
      "native UI DRAFT submit",
    );
    await finishDialog();
    const draft = await terminal(
      project.id,
      episode.id,
      submitted.receipt.data.items[0].operation_id,
    );
    assert.equal(draft.assembly_version_id, version.version_id);
    assert.equal(draft.assembly_content_hash, version.content_hash);
    await verifyOutput(draft, "draft");
    await playback(draft, "draft-subtitle");

    await route("assembly");
    const panel = page.getByRole("region", { name: "集级媒体装配", exact: true });
    await panel.getByLabel("保存画幅与分辨率").selectOption("1920x1080");
    await panel.getByText("有未保存修改", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "展开连续预览", exact: true }).click();
    const previewPanel = page.getByRole("region", { name: "已保存剪辑连续预览", exact: true });
    await previewPanel.getByRole("checkbox").check();
    await previewPanel
      .getByRole("button", { name: /^(生成已保存版本预览|重新生成已保存版本预览)$/ })
      .click();
    const previewSubmitted = await until(
      () => ipc("listDraftExports", project.id, episode.id),
      (r) =>
        r.kind === "LISTED" &&
        r.receipt.data.items.some((j) => j.operation_id !== draft.operation_id),
      "native continuous preview submit",
    );
    const previewId = previewSubmitted.receipt.data.items.find(
      (j) => j.operation_id !== draft.operation_id,
    ).operation_id;
    const preview = await terminal(project.id, episode.id, previewId);
    assert.equal(preview.assembly_version_id, version.version_id);
    assert.equal(preview.assembly_content_hash, version.content_hash);
    await verifyOutput(preview, "preview");
    await panel.getByRole("button", { name: "撤销", exact: true }).click();
    await playback(preview, "preview-subtitle");
    evidence.verified.push(
      "native UI DRAFT save and real terminal receipt",
      "guarded output media/frame/audio checks",
      "actual Electron playback",
      "continuous preview excludes unsaved canvas change",
    );

    await armDialog("save", draftPath);
    const noOverwrite = await ipc(
      "createDraftExportFromPicker",
      project.id,
      episode.id,
      command(version),
    );
    await finishDialog();
    assert.equal(noOverwrite.kind, "DEFINITE_SERVER_ERROR");
    assert.equal(noOverwrite.code, "OUTPUT_EXISTS");
    assert.equal(digest(draftPath), draft.output_sha256);
    evidence.verified.push("existing DRAFT destination is refused without overwrite");

    await close();
    await launch();
    statusData(await ipc("getMediaToolchainStatus"), true);
    assert.deepEqual(
      data(
        await ipc("getEpisodeMediaAssemblyVersion", project.id, episode.id, version.version_id),
        "FOUND",
      ),
      version,
    );
    for (const name of ["clip_a", "clip_b"])
      assert.deepEqual(
        data(
          await ipc(
            "getMediaAssetProbeEvidence",
            project.id,
            assets[name].id,
            assets[name].latest_version.id,
          ),
          "FOUND",
        ),
        probes[name],
      );
    for (const job of [draft, preview])
      assert.deepEqual(
        data(await ipc("getDraftExport", project.id, episode.id, job.operation_id), "FOUND"),
        job,
      );
    await chooseProject(project, episode);
    await playback(draft, "reopened-draft");
    evidence.verified.push(
      "restart preserves external selection and exact assembly/probe/export/preview readback",
    );

    // A separate bounded still composition makes actual in-flight observation practical.
    // Never call a cancellation a pass unless a live real encoder was observed first.
    const still = await importAsset(project.id, "cancel_still");
    const cancelEpisode = data(
      await ipc("createEpisode", project.id, {
        title: "合成中断验收",
        target_duration_seconds: "120",
      }),
      "SUCCEEDED",
    );
    const cancelContent = {
      ...content,
      episode_id: cancelEpisode.id,
      canvas_width: 1920,
      canvas_height: 1080,
      total_frames: 2880,
      visual_segments: [
        {
          segment_id: "seg_cancel-still",
          media_kind: "image",
          media: {
            asset_id: still.id,
            asset_version_id: still.latest_version.id,
            sha256: still.latest_version.sha256,
          },
          start_frame: 0,
          end_frame: 2880,
          source_in_frame: 0,
          embedded_audio: "MUTE",
        },
      ],
      audio_segments: [],
      subtitle_segments: [],
    };
    const cancelVersion = data(
      await ipc("createEpisodeMediaAssemblyVersion", project.id, cancelEpisode.id, {
        content: cancelContent,
        parent_version_id: null,
        expected_revision: null,
        change_summary: "仅用于实际取消与关闭进程验收的 120 秒合成静帧",
      }),
      "CREATED",
    );
    async function startObservedRender(label) {
      const request = command(cancelVersion);
      const target = join(outputRoot, `${label}.mp4`);
      await armDialog("save", target);
      data(
        await ipc("createDraftExportFromPicker", project.id, cancelEpisode.id, request),
        "FOUND",
      );
      await finishDialog();
      const observed = await until(
        async () => {
          const job = data(
            await ipc("getDraftExport", project.id, cancelEpisode.id, request.operation_id),
            "FOUND",
          );
          if (!["QUEUED", "RUNNING", "VERIFYING"].includes(job.status)) {
            evidence[label] = { result: "NOT_OBSERVED", job: publicJob(job) };
            throw new Error("Actual encoder ended before interruption could be observed");
          }
          const live = owned().filter(
            (p) => p.ExecutablePath.toLowerCase() === join(mediaRoot, "ffmpeg.exe").toLowerCase(),
          );
          return { job, live };
        },
        (r) =>
          r.job.status === "RUNNING" &&
          r.job.progress_frames > 0 &&
          r.job.progress_frames < r.job.total_frames &&
          r.live.length > 0,
        "live admitted encoder",
        45_000,
      );
      return {
        request,
        target,
        progress_frames: observed.job.progress_frames,
        encoder_pids: observed.live.map((p) => p.ProcessId),
      };
    }
    const cancelled = await startObservedRender("mid-render-cancellation");
    data(
      await ipc("cancelDraftExport", project.id, cancelEpisode.id, cancelled.request.operation_id),
      "FOUND",
    );
    const cancellation = await terminal(
      project.id,
      cancelEpisode.id,
      cancelled.request.operation_id,
    );
    assert.equal(cancellation.status, "CANCELLED");
    await until(
      async () => owned().filter((p) => inside(mediaRoot, p.ExecutablePath)),
      (r) => r.length === 0,
      "cancelled encoder shutdown",
    );
    for (const path of [
      cancelled.target,
      join(outputRoot, `.${cancelled.request.operation_id}.partial.mp4`),
    ])
      assert.equal(
        existsSync(path),
        false,
        "Cancellation must not publish or retain an unverified MP4",
      );
    evidence.cancellation = {
      result: "PASS",
      observed_encoder_pids: cancelled.encoder_pids,
      observed_progress_frames: cancelled.progress_frames,
      receipt: publicJob(cancellation),
      final_file_absent: true,
      encoder_exited: true,
    };

    const interrupted = await startObservedRender("application-shutdown");
    await close();
    await launch();
    const interruptedJob = await terminal(
      project.id,
      cancelEpisode.id,
      interrupted.request.operation_id,
    );
    assert.ok(["INTERRUPTED", "CANCELLED"].includes(interruptedJob.status));
    for (const path of [
      interrupted.target,
      join(outputRoot, `.${interrupted.request.operation_id}.partial.mp4`),
    ])
      assert.equal(
        existsSync(path),
        false,
        "Shutdown must not publish or retain an unverified MP4",
      );
    evidence.application_shutdown = {
      result: "PASS",
      observed_encoder_pids: interrupted.encoder_pids,
      observed_progress_frames: interrupted.progress_frames,
      receipt: publicJob(interruptedJob),
      final_file_absent: true,
      encoder_exited: true,
    };
    evidence.verified.push(
      "actual mid-render cancellation after observing admitted encoder",
      "actual application shutdown interrupts render without final output or orphan encoder",
    );
    await chooseProject(project, episode);

    // Mutate only the explicitly supplied disposable runner pair, with all work settled.
    assert.equal(owned().filter((p) => inside(mediaRoot, p.ExecutablePath)).length, 0);
    missingTool = join(mediaRoot, "ffprobe.exe.acceptance-missing");
    assert.equal(existsSync(missingTool), false);
    renameSync(join(mediaRoot, "ffprobe.exe"), missingTool);
    try {
      assert.equal(statusData(await ipc("getMediaToolchainStatus"), false).state, "INVALID");
      const failedProbe = await ipc(
        "probeSelectedMediaAssetVersion",
        project.id,
        assets.clip_a.id,
        assets.clip_a.latest_version.id,
      );
      assert.equal(failedProbe.kind, "DEFINITE_SERVER_ERROR");
      assert.equal(failedProbe.status, 503);
      for (const method of ["createDraftCompositionPreview", "createDraftExportFromPicker"]) {
        if (method.endsWith("FromPicker"))
          await armDialog("save", join(outputRoot, "missing-tool.mp4"));
        const rejected = await ipc(method, project.id, episode.id, command(version));
        if (method.endsWith("FromPicker")) await finishDialog();
        assert.equal(rejected.kind, "DEFINITE_SERVER_ERROR");
        assert.equal(rejected.code, "DRAFT_TOOLCHAIN_UNAVAILABLE");
      }
    } finally {
      renameSync(missingTool, join(mediaRoot, "ffprobe.exe"));
      missingTool = undefined;
      assert.equal(digest(join(mediaRoot, "ffprobe.exe")), HASHES.ffprobe);
    }
    statusData(await ipc("getMediaToolchainStatus"), true);
    evidence.verified.push(
      "missing selected executable blocks status, probe, preview and export; exact bytes restored",
    );

    await settings();
    await page.getByRole("button", { name: "移除外部工具配置", exact: true }).click();
    await until(
      () => ipc("getMediaToolchainStatus"),
      (r) => r.kind === "STATUS" && r.status.state === "NOT_CONFIGURED",
      "native clear selection",
    );
    await page.getByRole("button", { name: "关闭媒体工具设置", exact: true }).click();
    await close();
    await launch();
    assert.equal(statusData(await ipc("getMediaToolchainStatus"), false).state, "NOT_CONFIGURED");
    await chooseProject(project, episode);
    await playback(preview, "historical-preview-after-clear");
    await close();
    for (const [name, expected] of Object.entries(HASHES))
      assert.equal(digest(join(mediaRoot, `${name}.exe`)), expected);
    assert.deepEqual(rendererErrors, []);
    evidence.verified.push(
      "clear survives restart without rediscovery",
      "historical verified preview works without tools",
      "clean shutdown and external pair preserved",
    );
    evidence.result = "PASS";
  } catch (error) {
    evidence.failure = {
      code: error instanceof assert.AssertionError ? "ASSERTION_FAILED" : "EXECUTION_FAILED",
      last_completed_check: evidence.verified.at(-1) ?? "NO_NATIVE_CHECK_COMPLETED",
    };
    throw error;
  } finally {
    if (missingTool && existsSync(missingTool)) {
      try {
        renameSync(missingTool, join(mediaRoot, "ffprobe.exe"));
      } catch {
        evidence.cleanup_tool_restore = "UNCONFIRMED";
        evidence.result = "FAIL";
      }
    }
    if (application) {
      // Do not leave this explicitly selected test pair configured even if an assertion failed.
      try {
        await ipc("clearMediaToolchain");
      } catch {
        evidence.cleanup_selection = "UNCONFIRMED";
      }
      try {
        await close();
      } catch {
        evidence.cleanup_processes = "UNCONFIRMED";
      }
    }
    evidence.renderer_error_count = rendererErrors.length;
    const bytes = JSON.stringify(evidence, null, 2) + "\n";
    assert.ok(Buffer.byteLength(bytes) < 2 * 1024 * 1024);
    writeFileSync(reportPath, bytes, { flag: "wx" });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: Object.fromEntries(
      ["exe", "manifest", "report", "media-root", "inputs", "core-report"].map((name) => [
        name,
        { type: "string" },
      ]),
    ),
  });
  try {
    await runWindowsSmoke(values);
  } catch (error) {
    // Emit precondition failure evidence only to a separately checked runner path.
    if (
      process.platform === "win32" &&
      process.env.GITHUB_ACTIONS === "true" &&
      process.env.GITHUB_REPOSITORY === "chen11-A/aijian-studio" &&
      process.env.GITHUB_REF === "refs/heads/codex/windows-installer-dev-20261008" &&
      process.env.AIVORA_ARTIFACT_UPLOAD_ALLOWED === "false" &&
      process.env.RUNNER_TEMP &&
      values.report &&
      isAbsolute(values.report) &&
      inside(process.env.RUNNER_TEMP, values.report) &&
      !existsSync(values.report)
    ) {
      plain(dirname(values.report), "directory");
      writeFileSync(
        values.report,
        JSON.stringify(
          {
            schema_version: 1,
            scope: "installed-development-core-external-media-smoke",
            result: "FAIL",
            candidate_head: process.env.GITHUB_SHA,
            failure: { code: "PRECONDITION_OR_STARTUP_FAILED" },
            release_approved: false,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
    }
    throw error;
  }
}
