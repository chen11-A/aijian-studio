import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const developmentRoot = join(repositoryRoot, ".aijian-dev");
const evidenceRoot = join(repositoryRoot, "docs", "quality", "evidence");
const screenshotPath = join(evidenceRoot, "timeline-electron-1440x920.png");
const resultPath = join(evidenceRoot, "timeline-electron-smoke.json");
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  globalThis.process.platform === "win32" ? "electron.exe" : "electron",
);

await mkdir(developmentRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const profileDirectory = await mkdtemp(join(developmentRoot, "electron-timeline-profile-"));
const workspaceDirectory = join(profileDirectory, "workspace");
const seed = spawnSync(
  "uv",
  ["run", "python", join(scriptDirectory, "seed_timeline_workspace.py"), workspaceDirectory],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...globalThis.process.env,
      PYTHONPATH: join(repositoryRoot, "services", "api", "src"),
    },
  },
);
if (seed.status !== 0) {
  await rm(profileDirectory, { recursive: true, force: true });
  throw new Error(`Timeline workspace seed failed: ${seed.stderr}`);
}
const seeded = JSON.parse(seed.stdout.trim());
const rendererDiagnostics = [];
let application;

try {
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
    cwd: repositoryRoot,
    env: {
      ...globalThis.process.env,
      AIJIAN_E2E_USER_DATA_DIR: profileDirectory,
    },
    timeout: 30_000,
  });
  const appWindow = await application.firstWindow({ timeout: 30_000 });
  appWindow.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      rendererDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  appWindow.on("pageerror", (error) => rendererDiagnostics.push(`pageerror: ${error.message}`));

  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("button", { name: "剪辑台" }).click();
  await appWindow.getByRole("heading", { name: /Electron 时间线验收 · 主时间线/ }).waitFor();
  await appWindow.getByText("REV 1").waitFor();

  const bridgeState = await appWindow.evaluate(async (projectId) => {
    const timeline = await globalThis.aijian.getProjectTimeline(projectId);
    return {
      found: timeline !== null,
      revision: timeline?.data.timeline.revision ?? null,
      bridgeKeys: Object.keys(globalThis.aijian).sort(),
      nodeGlobals: {
        process: typeof globalThis.process,
        require: typeof globalThis.require,
      },
    };
  }, seeded.project_id);
  if (!bridgeState.found || bridgeState.revision !== 1) {
    throw new Error("Electron timeline bridge did not read the seeded immutable version");
  }
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
  if (JSON.stringify(bridgeState.bridgeKeys) !== JSON.stringify(expectedBridgeKeys)) {
    throw new Error("Electron preload bridge did not match the exact typed-method allowlist");
  }

  await appWindow.getByRole("option", { name: /clip-letter/ }).click();
  await appWindow.getByRole("spinbutton", { name: "源入点（帧）" }).fill("16");
  await appWindow.getByRole("spinbutton", { name: "持续（帧）" }).fill("30");
  await appWindow.getByRole("button", { name: "应用裁剪" }).click();
  await appWindow.getByText("REV 2").waitFor();
  await appWindow.getByRole("alert").getByText("裁剪已保存为新的不可变版本。").waitFor();

  const persisted = await appWindow.evaluate(async (projectId) => {
    const timeline = await globalThis.aijian.getProjectTimeline(projectId);
    const clip = timeline?.data.timeline.clips.find((item) => item.clip_id === "clip-letter");
    return {
      revision: timeline?.data.timeline.revision ?? null,
      sourceInFrame: clip?.source_in_frame ?? null,
      durationFrames: clip?.duration_frames ?? null,
    };
  }, seeded.project_id);
  if (
    persisted.revision !== 2 ||
    persisted.sourceInFrame !== 16 ||
    persisted.durationFrames !== 30
  ) {
    throw new Error("Electron timeline edit did not persist through the local API");
  }

  const viewport = await appWindow.evaluate(() => ({
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
  }));
  if (viewport.scrollWidth !== viewport.clientWidth) {
    throw new Error("Electron timeline workspace has horizontal page overflow");
  }
  if (
    bridgeState.nodeGlobals.process !== "undefined" ||
    bridgeState.nodeGlobals.require !== "undefined"
  ) {
    throw new Error("Electron renderer exposed Node.js globals");
  }
  if (rendererDiagnostics.length > 0) {
    throw new Error(`Electron renderer console was not clean: ${rendererDiagnostics.join(" | ")}`);
  }

  await appWindow.screenshot({ path: screenshotPath });
  const evidence = {
    check: "phase0-electron-timeline-smoke",
    passed: true,
    projectIdMatched: seeded.project_id === persistedProjectId(seeded.project_id),
    initialRevision: bridgeState.revision,
    persisted,
    nodeGlobals: bridgeState.nodeGlobals,
    bridgeKeys: bridgeState.bridgeKeys,
    viewport,
    rendererDiagnostics,
    screenshot: "timeline-electron-1440x920.png",
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...evidence, screenshotPath, resultPath }, null, 2)}\n`,
  );
} finally {
  try {
    if (application) await application.close();
  } finally {
    await rm(profileDirectory, { recursive: true, force: true });
  }
}

function persistedProjectId(projectId) {
  return /^prj_[0-9a-f]{32}$/.test(projectId) ? projectId : null;
}
