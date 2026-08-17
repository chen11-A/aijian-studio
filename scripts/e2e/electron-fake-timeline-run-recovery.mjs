import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const developmentRoot = join(repositoryRoot, ".aijian-dev");
const evidenceRoot = join(
  repositoryRoot,
  ".cache",
  "grok-evidence",
  "K01-ELECTRON-FAKE-TIMELINE-VERTICAL-01",
);
const unknownScreenshotPath = join(evidenceRoot, "unknown-1440x920.png");
const recoveredScreenshotPath = join(evidenceRoot, "recovered-timeline-1440x920.png");
const resultPath = join(evidenceRoot, "result.json");
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  globalThis.process.platform === "win32" ? "electron.exe" : "electron",
);
const python = join(
  repositoryRoot,
  ".venv",
  globalThis.process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const appRequire = createRequire(join(repositoryRoot, "apps", "studio-web", "package.json"));
const viteBin = join(dirname(appRequire.resolve("vite/package.json")), "bin", "vite.js");
const projectName = "Fake 时间线恢复验收";
const expectedBridgeKeys = [
  "acceptArtifactProposalAsDraft",
  "createFakeTimelineRun",
  "createProject",
  "createProviderConnection",
  "createProposalRun",
  "deleteProviderConnection",
  "getArtifactProposal",
  "getProject",
  "getProjectTimeline",
  "getSource",
  "getSourceManifest",
  "getStoryBibleIndex",
  "getStoryBibleVersion",
  "health",
  "importTextSource",
  "listProjectAgents",
  "listProjectSkills",
  "listProjectTasks",
  "listProjects",
  "listProviderConnections",
  "listSources",
  "reorderTimelineClip",
  "replaceTimelineClip",
  "rejectArtifactProposal",
  "startFakeTimelineWorkflow",
  "trimTimelineClip",
].sort();

async function waitForUrl(url, processHandle, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) throw new Error(`${label} exited before becoming ready`);
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // Local service is still starting.
    }
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} did not become ready`);
}

async function waitForValue(read, accept, label, attempts = 480) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 1_000));
  }
  throw new Error(`${label} did not reach the expected state`);
}

async function stopProcess(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  processHandle.kill();
  await Promise.race([
    new Promise((resolveClose) => processHandle.once("close", resolveClose)),
    new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 5_000)),
  ]);
  if (processHandle.exitCode === null) processHandle.kill("SIGKILL");
}

function attachDiagnostics(appWindow, rendererDiagnostics) {
  appWindow.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      rendererDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  appWindow.on("pageerror", (error) => rendererDiagnostics.push(`pageerror: ${error.message}`));
}

async function launchStudio(profileDirectory, extraEnv = {}) {
  const application = await electron.launch({
    executablePath: electronExecutable,
    args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...globalThis.process.env,
      AIJIAN_E2E_USER_DATA_DIR: profileDirectory,
      ...extraEnv,
    },
    timeout: 30_000,
  });
  const appWindow = await application.firstWindow({ timeout: 30_000 });
  await appWindow.setViewportSize({ width: 1440, height: 920 });
  return { application, appWindow };
}

async function inspectPublishedFakeMedia(workspaceDirectory, projectId) {
  const projectRoot = join(workspaceDirectory, "fake-media", "v1", projectId);
  const packageEntries = (await readdir(projectRoot, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith(".aijian-fake-media-"),
  );
  if (packageEntries.length !== 1) {
    throw new Error(`expected one published fake-media package, found ${packageEntries.length}`);
  }
  const packageRoot = join(projectRoot, packageEntries[0].name);
  const manifest = JSON.parse(await readFile(join(packageRoot, "manifest.json"), "utf8"));
  const toolchainLock = JSON.parse(
    await readFile(join(repositoryRoot, "config", "media-toolchain-lock.json"), "utf8"),
  );
  const lockedProfile = toolchainLock.profiles.find(
    (profile) => profile.profile_id === manifest.toolchain_profile_id,
  );
  if (
    manifest.project_id !== projectId ||
    manifest.toolchain_version !== "8.1.2" ||
    manifest.shots?.length !== 3 ||
    !lockedProfile ||
    manifest.ffmpeg_sha256 !== `sha256:${lockedProfile.ffmpeg_sha256}` ||
    manifest.ffprobe_sha256 !== `sha256:${lockedProfile.ffprobe_sha256}`
  ) {
    throw new Error("published fake-media manifest does not match the frozen runtime contract");
  }
  const files = [];
  for (const shot of manifest.shots) {
    const mediaFiles = [shot.still_image, shot.scratch_voice, shot.preview_video];
    for (const media of mediaFiles) {
      const bytes = await readFile(join(packageRoot, ...media.relative_path.split("/")));
      const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (sha256 !== media.sha256 || bytes.length !== media.byte_size) {
        throw new Error(`published fake-media bytes do not match manifest: ${media.relative_path}`);
      }
      files.push({
        shot_id: shot.shot_id,
        role: media.role,
        relative_path: media.relative_path,
        byte_size: bytes.length,
        sha256,
      });
    }
    const previewPath = join(packageRoot, ...shot.preview_video.relative_path.split("/"));
    const probe = spawnSync(
      "ffprobe",
      ["-v", "error", "-count_frames", "-show_streams", "-of", "json", previewPath],
      { cwd: repositoryRoot, encoding: "utf8", timeout: 60_000 },
    );
    if (probe.status !== 0) {
      throw new Error(`ffprobe failed for ${shot.shot_id}: ${probe.stderr || probe.stdout}`);
    }
    const streams = JSON.parse(probe.stdout).streams;
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    if (
      video?.width !== 320 ||
      video?.height !== 568 ||
      video?.r_frame_rate !== "25/1" ||
      Number(video?.nb_read_frames) !== 125 ||
      Number(audio?.sample_rate) !== 48_000 ||
      audio?.channels !== 1
    ) {
      throw new Error(`ffprobe contract mismatch for ${shot.shot_id}`);
    }
    shot.probe = {
      video: {
        codec_name: video.codec_name,
        width: video.width,
        height: video.height,
        frame_rate: video.r_frame_rate,
        frame_count: Number(video.nb_read_frames),
      },
      audio: {
        codec_name: audio.codec_name,
        sample_rate_hz: Number(audio.sample_rate),
        channels: audio.channels,
      },
    };
  }
  return {
    package_id: manifest.package_id,
    request_hash: manifest.request_hash,
    toolchain_profile_id: manifest.toolchain_profile_id,
    toolchain_version: manifest.toolchain_version,
    ffmpeg_sha256: manifest.ffmpeg_sha256,
    ffprobe_sha256: manifest.ffprobe_sha256,
    capability_losses: manifest.capability_losses,
    files,
    shots: manifest.shots.map((shot) => ({ shot_id: shot.shot_id, probe: shot.probe })),
  };
}

function runIsolatedReview(databasePath, operation, subject) {
  const helper = [
    "import json, sqlite3, sys",
    "from pathlib import Path",
    `root = Path(${JSON.stringify(repositoryRoot)})`,
    "sys.path.insert(0, str(root / 'services' / 'api' / 'src'))",
    "from aijian_api.main import create_app",
    "from aijian_api.repository import StudioRepository",
    "from aijian_api.security import SidecarSecurity",
    "from fastapi.testclient import TestClient",
    "TOKEN = 'e' * 43",
    "HOST = '127.0.0.1:43129'",
    "ORIGIN = 'app://aijian'",
    `database = Path(${JSON.stringify(databasePath)})`,
    `operation = ${JSON.stringify(operation)}`,
    `subject = ${JSON.stringify(subject)}`,
    "security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)",
    "client = TestClient(create_app(repository=StudioRepository(database), sidecar_security=security), base_url=f'http://{HOST}', client=('127.0.0.1', 50129))",
    "client.headers.update({'Authorization': f'Bearer {TOKEN}', 'Origin': ORIGIN})",
    "def confirmation(response):",
    "    response.raise_for_status()",
    "    data = response.json()['data']",
    "    return {'challenge_id': data['challenge']['id'], 'confirmation_token': data['confirmation_token']}",
    "if operation == 'approve':",
    "    projects = client.get('/api/v1/projects')",
    "    projects.raise_for_status()",
    "    project = next(item for item in projects.json()['data'] if item['name'] == subject)",
    "    sources = client.get(f\"/api/v1/projects/{project['id']}/sources\")",
    "    sources.raise_for_status()",
    "    source = sources.json()['data'][0]",
    "    manifest = client.get(f\"/api/v1/projects/{project['id']}/source-manifest\")",
    "    manifest.raise_for_status()",
    "    version_id = manifest.json()['data']['latest_version']['id']",
    "    etag = manifest.headers['etag']",
    "    revision = int(etag.strip('\"').removeprefix('revision-'))",
    "    base = f\"/api/v1/internal/projects/{project['id']}/source-manifest/versions/{version_id}\"",
    "    prepared_submit = client.post(f'{base}:prepare-submit', headers={'If-Match': etag}, json={})",
    "    client.post(f'{base}:submit', headers={'If-Match': etag}, json=confirmation(prepared_submit)).raise_for_status()",
    "    signoff_etag = f'\"revision-{revision + 1}\"'",
    "    prepared_signoff = client.post(f'{base}:prepare-signoff', headers={'If-Match': signoff_etag}, json={})",
    "    client.post(f'{base}/signoffs', headers={'If-Match': signoff_etag}, json=confirmation(prepared_signoff)).raise_for_status()",
    "    decision_etag = f'\"revision-{revision + 2}\"'",
    "    rationale = '隔离 E2E 合成夹具已核对文件、编码和段落范围；此批准仅用于测试夹具，不是人工或成片批准。'",
    "    prepared_decision = client.post(f'{base}:prepare-decision', headers={'If-Match': decision_etag}, json={'decision': 'approved', 'rationale': rationale, 'readiness_report_id': prepared_signoff.json()['data']['report']['id']})",
    "    client.post(f'{base}/decisions', headers={'If-Match': decision_etag}, json={**confirmation(prepared_decision), 'decision': 'approved', 'rationale': rationale}).raise_for_status()",
    "    accepted = client.get(f\"/api/v1/projects/{project['id']}/source-manifest\")",
    "    accepted.raise_for_status()",
    "    print(json.dumps({'project_id': project['id'], 'source_id': source['id'], 'source_manifest_version_id': accepted.json()['data']['head']['accepted_version_id']}, ensure_ascii=False, sort_keys=True))",
    "else:",
    "    project_id = subject",
    "    connection = sqlite3.connect(database)",
    "    connection.row_factory = sqlite3.Row",
    "    try:",
    "        workflow = connection.execute('SELECT workflow_run_id, status FROM workflow_runs WHERE project_id = ?', (project_id,)).fetchall()",
    "        node = connection.execute('SELECT node.node_run_id, node.status, node.output_version_id FROM workflow_node_runs AS node JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id WHERE workflow.project_id = ?', (project_id,)).fetchall()",
    "        attempt = connection.execute('SELECT attempt.attempt_id, attempt.status FROM workflow_attempts AS attempt JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id WHERE workflow.project_id = ?', (project_id,)).fetchall()",
    "        task = connection.execute('SELECT task.task_id, task.status, task.task_kind FROM task_ledger AS task JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id JOIN workflow_runs AS workflow ON workflow.workflow_run_id = node.workflow_run_id WHERE workflow.project_id = ?', (project_id,)).fetchall()",
    "        intent = connection.execute('SELECT key.idempotency_key FROM workflow_enqueue_keys AS key WHERE key.project_id = ?', (project_id,)).fetchall()",
    "        timeline = connection.execute(\"SELECT version.version_id, version.artifact_id, version.producer_attempt_id, head.latest_version_id, head.accepted_version_id FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline'\", (project_id,)).fetchall()",
    "        gate_count = connection.execute(\"SELECT COUNT(*) FROM gate_decisions WHERE version_id IN (SELECT version.version_id FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline')\", (project_id,)).fetchone()[0]",
    "        review_count = connection.execute(\"SELECT COUNT(*) FROM review_submissions WHERE version_id IN (SELECT version.version_id FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id WHERE artifact.project_id = ? AND artifact.artifact_type = 'timeline')\", (project_id,)).fetchone()[0]",
    "        provider_count = connection.execute('SELECT COUNT(*) FROM provider_connections').fetchone()[0]",
    "        print(json.dumps({'workflow_count': len(workflow), 'workflow_status': workflow[0]['status'] if workflow else None, 'workflow_run_id': workflow[0]['workflow_run_id'] if workflow else None, 'node_count': len(node), 'node_status': node[0]['status'] if node else None, 'output_version_id': node[0]['output_version_id'] if node else None, 'attempt_count': len(attempt), 'attempt_status': attempt[0]['status'] if attempt else None, 'attempt_id': attempt[0]['attempt_id'] if attempt else None, 'task_count': len(task), 'task_status': task[0]['status'] if task else None, 'task_kind': task[0]['task_kind'] if task else None, 'intent_count': len(intent), 'timeline_count': len(timeline), 'timeline_version_id': timeline[0]['version_id'] if timeline else None, 'timeline_latest_version_id': timeline[0]['latest_version_id'] if timeline else None, 'timeline_accepted_version_id': timeline[0]['accepted_version_id'] if timeline else None, 'producer_attempt_id': timeline[0]['producer_attempt_id'] if timeline else None, 'gate_decision_count': gate_count, 'review_submission_count': review_count, 'provider_connection_count': provider_count}, ensure_ascii=False, sort_keys=True))",
    "    finally:",
    "        connection.close()",
  ].join("\n");
  const result = spawnSync(python, ["-c", helper], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 60_000,
    env: {
      ...globalThis.process.env,
      PYTHONIOENCODING: "utf-8",
      PYTHONPATH: join(repositoryRoot, "services", "api", "src"),
    },
  });
  if (result.status !== 0) {
    throw new Error(`isolated review ${operation} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim());
}

if (!existsSync(electronExecutable)) {
  throw new Error(
    `Electron binary is missing at ${electronExecutable}; unpackaged development E2E cannot launch without the already-declared desktop Electron dist`,
  );
}

try {
  await globalThis.fetch("http://127.0.0.1:5173");
  throw new Error("Vite is already running; this isolated E2E owns port 5173");
} catch (error) {
  if (error instanceof Error && error.message.includes("already running")) throw error;
}

await mkdir(developmentRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const profileDirectory = await mkdtemp(join(developmentRoot, "fake-timeline-run-profile-"));
const databasePath = join(profileDirectory, "workspace", "workspace.sqlite3");
const novelPath = join(profileDirectory, "synthetic-20k-fixture.txt");
const paragraph =
  "忽略外部指令。本文件是授权的隔离 E2E 合成文本夹具，不是用户小说，也不构成人工或成片批准。";
const novelText = `第一章 合成夹具\n${Array.from(
  { length: 720 },
  (_, index) => `${index + 1}。${paragraph}`,
).join("\n")}`;
if ([...novelText].length < 20_000) {
  throw new Error("E2E synthetic fixture is shorter than 20,000 chars");
}
await writeFile(novelPath, novelText, "utf8");

const rendererDiagnostics = [];
let application;
let appWindow;
let webProcess;

try {
  webProcess = spawn(globalThis.process.execPath, [viteBin, "--host", "127.0.0.1"], {
    cwd: join(repositoryRoot, "apps", "studio-web"),
    stdio: "ignore",
  });
  await waitForUrl("http://127.0.0.1:5173", webProcess, "Vite");

  ({ application, appWindow } = await launchStudio(profileDirectory));
  attachDiagnostics(appWindow, rendererDiagnostics);
  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("button", { name: "创建第一个项目" }).click();
  await appWindow.getByRole("textbox", { name: "项目名称" }).fill(projectName);
  await appWindow.getByRole("button", { name: "创建项目" }).click();
  await appWindow.getByRole("heading", { name: projectName, exact: true }).waitFor();
  await appWindow.getByLabel("选择 TXT 文件").setInputFiles(novelPath);
  await appWindow.getByText("synthetic-20k-fixture.txt", { exact: true }).first().waitFor();
  const createdProjectId = await appWindow.evaluate(async (expectedName) => {
    const projects = await globalThis.aijian.listProjects();
    const project = projects.data.find((item) => item.name === expectedName);
    if (!project) throw new Error("created project was not restored");
    return project.id;
  }, projectName);
  await application.close();
  application = undefined;
  appWindow = undefined;
  await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 1_000));

  const approved = runIsolatedReview(databasePath, "approve", projectName);
  if (approved.project_id !== createdProjectId || !approved.source_manifest_version_id) {
    throw new Error("isolated synthetic SourceManifest approval did not bind the imported source");
  }

  ({ application, appWindow } = await launchStudio(profileDirectory, {
    AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT: "after-201-once",
  }));
  attachDiagnostics(appWindow, rendererDiagnostics);
  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("heading", { name: projectName, exact: true }).waitFor();
  await appWindow.getByText("synthetic-20k-fixture.txt", { exact: true }).first().waitFor();
  const createButton = appWindow.getByRole("button", { name: "生成 Fake 分镜时间线" });
  await createButton.waitFor();
  const createMetrics = await appWindow.evaluate(() => {
    const button = globalThis.document.querySelector(
      ".fake-workflow-panel button.accent-button, .fake-workflow-action button",
    );
    const body = globalThis.document.querySelector(".fake-workflow-panel p");
    const meta = globalThis.document.querySelector(".fake-workflow-copy span");
    if (!button || !body || !meta) return null;
    const buttonRect = button.getBoundingClientRect();
    return {
      viewportWidth: globalThis.innerWidth,
      viewportHeight: globalThis.innerHeight,
      buttonHeight: buttonRect.height,
      bodyFontSize: globalThis.getComputedStyle(body).fontSize,
      metaFontSize: globalThis.getComputedStyle(meta).fontSize,
      scrollWidth: globalThis.document.documentElement.scrollWidth,
      clientWidth: globalThis.document.documentElement.clientWidth,
    };
  });
  if (
    createMetrics === null ||
    createMetrics.viewportWidth !== 1440 ||
    createMetrics.viewportHeight !== 920 ||
    createMetrics.buttonHeight < 44 ||
    createMetrics.bodyFontSize !== "14px" ||
    createMetrics.metaFontSize !== "12px" ||
    createMetrics.scrollWidth !== createMetrics.clientWidth
  ) {
    throw new Error(
      `Fake Timeline create control failed layout checks: ${JSON.stringify(createMetrics)}`,
    );
  }
  await createButton.click();
  await appWindow.getByText("提交结果未知").waitFor();
  await appWindow.screenshot({ path: unknownScreenshotPath });
  const firstUnknownState = await appWindow.evaluate((projectId) => {
    const key = `aijian.fake-timeline-run.pending.v1:${projectId}`;
    const raw = globalThis.localStorage.getItem(key);
    if (raw === null) throw new Error("REMOTE_UNKNOWN did not retain its operation journal");
    const pending = JSON.parse(raw);
    return {
      operationId: pending.operation_id,
      input: pending.input,
      createdAt: pending.created_at,
      pendingJournalKeys: Object.keys(globalThis.localStorage).filter((candidate) =>
        candidate.startsWith("aijian.fake-timeline-run.pending.v1:"),
      ),
    };
  }, approved.project_id);
  if (
    firstUnknownState.input.source_manifest_version_id !== approved.source_manifest_version_id ||
    firstUnknownState.input.source_document_id !== approved.source_id
  ) {
    throw new Error("UI did not freeze the approved source input");
  }

  const completedRun = await waitForValue(
    () =>
      appWindow.evaluate(async (projectId) => {
        const [tasks, timeline] = await Promise.all([
          globalThis.aijian.listProjectTasks(projectId),
          globalThis.aijian.getProjectTimeline(projectId),
        ]);
        const item = tasks.data.tasks.find(
          (candidate) => candidate.task.kind === "local.timeline.assemble.fake.media.v1",
        );
        return {
          taskCount: tasks.data.tasks.length,
          taskStatus: item?.task.status ?? null,
          attemptStatus: item?.attempt.status ?? null,
          nodeStatus: item?.node.status ?? null,
          clipCount: timeline?.data.timeline.clips.length ?? null,
          totalFrames: timeline?.data.total_duration_frames ?? null,
          frameRate: timeline?.data.timeline.sequence_timebase.frame_rate ?? null,
          width: timeline?.data.timeline.width ?? null,
          height: timeline?.data.timeline.height ?? null,
        };
      }, approved.project_id),
    (value) =>
      value.taskCount === 1 &&
      value.taskStatus === "COMPLETED" &&
      value.attemptStatus === "SUCCEEDED" &&
      value.clipCount === 3 &&
      value.totalFrames === 375,
    "local Fake Timeline after lost 201",
  );

  await application.close();
  application = undefined;
  appWindow = undefined;

  ({ application, appWindow } = await launchStudio(profileDirectory));
  attachDiagnostics(appWindow, rendererDiagnostics);
  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("heading", { name: projectName, exact: true }).waitFor();
  await appWindow.getByRole("button", { name: "恢复同一操作" }).waitFor();
  const recoveryState = await appWindow.evaluate((projectId) => {
    const key = `aijian.fake-timeline-run.pending.v1:${projectId}`;
    const raw = globalThis.localStorage.getItem(key);
    if (raw === null) throw new Error("relaunch lost the pending fake timeline run journal");
    const pending = JSON.parse(raw);
    return { operationId: pending.operation_id, input: pending.input };
  }, approved.project_id);
  if (
    recoveryState.operationId !== firstUnknownState.operationId ||
    JSON.stringify(recoveryState.input) !== JSON.stringify(firstUnknownState.input)
  ) {
    throw new Error("Electron relaunch did not preserve the exact fake timeline run operation");
  }
  const recoverButton = appWindow.getByRole("button", { name: "恢复同一操作" });
  const recoverBox = await recoverButton.boundingBox();
  if (!recoverBox || recoverBox.height < 44) {
    throw new Error("recovery target is smaller than 44px");
  }
  await recoverButton.click();
  await appWindow.getByText("已恢复原运行").waitFor();
  await appWindow.getByRole("button", { name: "查看任务记录" }).click();
  const taskDrawer = appWindow.getByRole("dialog", { name: "任务中心" });
  await taskDrawer.getByRole("heading", { name: "制作任务总览" }).waitFor();
  await taskDrawer.getByText("已完成").first().waitFor();
  await taskDrawer.getByRole("button", { name: "关闭任务中心" }).click();
  await appWindow
    .getByRole("navigation", { name: "制作流程" })
    .getByRole("button", { name: "剪辑 · 剪辑台" })
    .click();
  await appWindow.getByText("3 个镜头 · 375 帧").waitFor();
  await appWindow.getByText("25 fps").waitFor();
  await appWindow.getByText("1080 × 1920").waitFor();
  await appWindow.screenshot({ path: recoveredScreenshotPath });

  const rendererState = await appWindow.evaluate(async (projectId) => {
    const timeline = await globalThis.aijian.getProjectTimeline(projectId);
    return {
      viewport: {
        innerWidth: globalThis.innerWidth,
        innerHeight: globalThis.innerHeight,
        scrollWidth: globalThis.document.documentElement.scrollWidth,
        clientWidth: globalThis.document.documentElement.clientWidth,
      },
      pendingJournalKeys: Object.keys(globalThis.localStorage).filter((key) =>
        key.startsWith(`aijian.fake-timeline-run.pending.v1:${projectId}`),
      ),
      bridgeKeys: Object.keys(globalThis.aijian).sort(),
      nodeGlobals: {
        process: typeof globalThis.process,
        require: typeof globalThis.require,
      },
      clipCount: timeline?.data.timeline.clips.length ?? null,
      totalFrames: timeline?.data.total_duration_frames ?? null,
      frameRate: timeline?.data.timeline.sequence_timebase.frame_rate ?? null,
      width: timeline?.data.timeline.width ?? null,
      height: timeline?.data.timeline.height ?? null,
    };
  }, approved.project_id);
  if (rendererState.viewport.scrollWidth !== rendererState.viewport.clientWidth) {
    throw new Error("Fake Timeline recovery workspace has horizontal overflow");
  }
  if (rendererState.viewport.innerWidth !== 1440 || rendererState.viewport.innerHeight !== 920) {
    throw new Error(
      `Fake Timeline recovery viewport is not 1440x920: ${JSON.stringify(rendererState.viewport)}`,
    );
  }
  if (JSON.stringify(rendererState.bridgeKeys) !== JSON.stringify(expectedBridgeKeys)) {
    throw new Error("Electron preload bridge did not match the exact typed-method allowlist");
  }
  if (
    rendererState.nodeGlobals.process !== "undefined" ||
    rendererState.nodeGlobals.require !== "undefined"
  ) {
    throw new Error("Electron renderer exposed Node.js globals");
  }
  if (rendererState.pendingJournalKeys.length !== 0) {
    throw new Error("definite fake timeline run creation did not clear its operation journal");
  }
  if (rendererDiagnostics.length > 0) {
    throw new Error(`Electron renderer console was not clean: ${rendererDiagnostics.join(" | ")}`);
  }

  await application.close();
  application = undefined;
  await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 1_000));

  const persisted = runIsolatedReview(databasePath, "inspect", approved.project_id);
  const media = await inspectPublishedFakeMedia(
    join(profileDirectory, "workspace"),
    approved.project_id,
  );
  if (
    persisted.workflow_count !== 1 ||
    persisted.node_count !== 1 ||
    persisted.attempt_count !== 1 ||
    persisted.task_count !== 1 ||
    persisted.intent_count !== 1 ||
    persisted.timeline_count !== 1 ||
    persisted.workflow_status !== "SUCCEEDED" ||
    persisted.node_status !== "SUCCEEDED" ||
    persisted.attempt_status !== "SUCCEEDED" ||
    persisted.task_status !== "COMPLETED" ||
    persisted.task_kind !== "local.timeline.assemble.fake.media.v1" ||
    persisted.output_version_id !== persisted.timeline_version_id ||
    persisted.timeline_latest_version_id !== persisted.timeline_version_id ||
    persisted.timeline_accepted_version_id !== null ||
    persisted.producer_attempt_id !== persisted.attempt_id ||
    persisted.gate_decision_count !== 0 ||
    persisted.review_submission_count !== 0 ||
    persisted.provider_connection_count !== 0
  ) {
    throw new Error(`fake timeline terminal state is invalid: ${JSON.stringify(persisted)}`);
  }

  const evidence = {
    check: "K01-ELECTRON-FAKE-TIMELINE-VERTICAL-01",
    passed: true,
    approved: {
      project_id: approved.project_id,
      source_id: approved.source_id,
      source_manifest_version_id: approved.source_manifest_version_id,
    },
    firstUnknownState: {
      operationId: firstUnknownState.operationId,
      input: firstUnknownState.input,
    },
    completedRun,
    recoveryState,
    persisted,
    media,
    rendererState,
    rendererDiagnostics,
    screenshots: ["unknown-1440x920.png", "recovered-timeline-1440x920.png"],
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...evidence, unknownScreenshotPath, recoveredScreenshotPath, resultPath }, null, 2)}\n`,
  );
} catch (error) {
  if (appWindow) {
    const failure = await appWindow
      .evaluate(() => ({ body: globalThis.document.body.innerText.slice(0, 2_000) }))
      .catch(() => null);
    globalThis.process.stderr.write(`${JSON.stringify({ failure, rendererDiagnostics })}\n`);
  }
  throw error;
} finally {
  try {
    if (application) await application.close();
  } finally {
    try {
      await stopProcess(webProcess);
    } finally {
      await rm(profileDirectory, { recursive: true, force: true });
    }
  }
}
