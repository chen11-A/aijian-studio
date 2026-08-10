import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const developmentRoot = join(repositoryRoot, ".aijian-dev");
const evidenceRoot = join(repositoryRoot, "docs", "quality", "evidence");
const screenshotPath = join(evidenceRoot, "web-e2e-skeleton-electron-1440x920.png");
const resultPath = join(evidenceRoot, "web-e2e-skeleton-electron.json");
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  globalThis.process.platform === "win32" ? "electron.exe" : "electron",
);
const appRequire = createRequire(join(repositoryRoot, "apps", "studio-web", "package.json"));
const viteBin = join(dirname(appRequire.resolve("vite/package.json")), "bin", "vite.js");

async function assertPortIsFree(url, label) {
  try {
    await globalThis.fetch(url);
  } catch {
    return;
  }
  throw new Error(`${label} is already running; the isolated E2E owns its fixed local port`);
}

async function waitForUrl(url, processHandle, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready`);
    }
    try {
      const response = await globalThis.fetch(url);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolveWait) => globalThis.setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} did not become ready`);
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

await assertPortIsFree("http://127.0.0.1:5173", "Vite");
await mkdir(developmentRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const profileDirectory = await mkdtemp(join(developmentRoot, "web-e2e-skeleton-profile-"));
const novelPath = join(profileDirectory, "golden-20000.txt");
const paragraph = "雨落在雾城旧站，林见握着没有署名的信，沿着灯影寻找失踪档案。";
const novelText = `第一章 来信\n${Array.from(
  { length: 720 },
  (_, index) => `${index + 1}。${paragraph}`,
).join("\n")}`;
if ([...novelText].length < 20_000)
  throw new Error("E2E novel fixture is shorter than 20,000 chars");
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
  appWindow = await application.firstWindow({ timeout: 30_000 });
  appWindow.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      rendererDiagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  appWindow.on("pageerror", (error) => rendererDiagnostics.push(`pageerror: ${error.message}`));

  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("button", { name: "创建第一个项目" }).click();
  await appWindow.getByRole("textbox", { name: "项目名称" }).fill("二万字统一纵切验收");
  await appWindow.getByRole("button", { name: "创建项目" }).click();
  await appWindow.getByRole("heading", { name: "二万字统一纵切验收", exact: true }).waitFor();

  await appWindow.getByLabel("选择 TXT 文件").setInputFiles(novelPath);
  await appWindow.getByText("golden-20000.txt", { exact: true }).first().waitFor();
  await appWindow.getByRole("button", { name: "生成 Fake 分镜时间线" }).click();
  await appWindow.getByText("PREVIEW READY").waitFor();
  await appWindow.getByText("3 个镜头 · REV 1").waitFor();

  await appWindow.getByRole("button", { name: "查看任务记录" }).click();
  const taskDrawer = appWindow.getByRole("dialog", { name: "任务中心" });
  await taskDrawer.getByRole("heading", { name: "制作任务总览" }).waitFor();
  await taskDrawer.getByText("timeline.assemble.fake").first().waitFor();
  await taskDrawer.getByText("已完成").first().waitFor();
  await taskDrawer.getByRole("button", { name: "关闭任务中心" }).click();

  await appWindow
    .getByRole("navigation", { name: "制作流程" })
    .getByRole("button", { name: "剪辑 · 剪辑台" })
    .click();
  await appWindow.getByRole("heading", { name: /二万字统一纵切验收 · 主时间线/ }).waitFor();
  const timelineHeader = appWindow.locator(".timeline-header");
  await timelineHeader.getByText("REV 1", { exact: true }).waitFor();
  await appWindow.getByRole("option", { name: /fake-shot-01/ }).click();
  await appWindow.getByRole("spinbutton", { name: "源入点（帧）" }).fill("4");
  await appWindow.getByRole("spinbutton", { name: "持续（帧）" }).fill("40");
  await appWindow.getByRole("button", { name: "应用裁剪" }).click();
  await timelineHeader.getByText("REV 2", { exact: true }).waitFor();

  await appWindow.reload();
  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("heading", { name: "二万字统一纵切验收", exact: true }).waitFor();
  await appWindow.getByRole("button", { name: /任务队列/ }).click();
  const reloadedTaskDrawer = appWindow.getByRole("dialog", { name: "任务中心" });
  await reloadedTaskDrawer.getByText("已完成").first().waitFor();
  await reloadedTaskDrawer.getByRole("button", { name: "关闭任务中心" }).click();
  await appWindow
    .getByRole("navigation", { name: "制作流程" })
    .getByRole("button", { name: "剪辑 · 剪辑台" })
    .click();
  await appWindow.locator(".timeline-header").getByText("REV 2", { exact: true }).waitFor();

  const persisted = await appWindow.evaluate(async () => {
    const projects = await globalThis.aijian.listProjects();
    const project = projects.data.find((item) => item.name === "二万字统一纵切验收");
    if (!project) return null;
    const [sources, tasks, timeline] = await Promise.all([
      globalThis.aijian.listSources(project.id),
      globalThis.aijian.listProjectTasks(project.id),
      globalThis.aijian.getProjectTimeline(project.id),
    ]);
    return {
      projectId: project.id,
      sourceByteSize: sources.data[0]?.byte_size ?? null,
      sourceCount: sources.data.length,
      taskSummary: tasks.data.summary,
      taskStatus: tasks.data.tasks[0]?.attempt.status ?? null,
      timelineVersionId: timeline?.data.version_id ?? null,
      timelineRevision: timeline?.data.timeline.revision ?? null,
      clipCount: timeline?.data.timeline.clips.length ?? null,
      firstClip: timeline?.data.timeline.clips[0] ?? null,
      bridgeKeys: Object.keys(globalThis.aijian).sort(),
      nodeGlobals: {
        process: typeof globalThis.process,
        require: typeof globalThis.require,
      },
    };
  });
  if (
    persisted === null ||
    persisted.sourceCount !== 1 ||
    persisted.sourceByteSize < 20_000 ||
    persisted.taskSummary.completed !== 1 ||
    persisted.taskStatus !== "SUCCEEDED" ||
    persisted.timelineRevision !== 2 ||
    persisted.clipCount !== 3 ||
    persisted.firstClip?.source_in_frame !== 4 ||
    persisted.firstClip?.duration_frames !== 40
  ) {
    throw new Error("Unified Electron workflow did not persist the expected source/task/timeline");
  }
  const expectedBridgeKeys = [
    "createProject",
    "createProviderConnection",
    "deleteProviderConnection",
    "getProject",
    "getProjectTimeline",
    "getSource",
    "getSourceManifest",
    "getStoryBibleIndex",
    "getStoryBibleVersion",
    "health",
    "importTextSource",
    "listProjectTasks",
    "listProjects",
    "listProviderConnections",
    "listSources",
    "reorderTimelineClip",
    "replaceTimelineClip",
    "startFakeTimelineWorkflow",
    "trimTimelineClip",
  ].sort();
  if (JSON.stringify(persisted.bridgeKeys) !== JSON.stringify(expectedBridgeKeys)) {
    throw new Error("Electron preload bridge did not match the exact typed-method allowlist");
  }
  if (
    persisted.nodeGlobals.process !== "undefined" ||
    persisted.nodeGlobals.require !== "undefined"
  ) {
    throw new Error("Electron renderer exposed Node.js globals");
  }

  const viewport = await appWindow.evaluate(() => ({
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
  }));
  if (viewport.scrollWidth !== viewport.clientWidth) {
    throw new Error("Unified Electron workflow has horizontal page overflow");
  }
  if (rendererDiagnostics.length > 0) {
    throw new Error(`Electron renderer console was not clean: ${rendererDiagnostics.join(" | ")}`);
  }

  await appWindow.screenshot({ path: screenshotPath });
  const evidence = {
    check: "phase0-web-e2e-skeleton-electron",
    passed: true,
    novelCharacterCount: [...novelText].length,
    persisted,
    viewport,
    rendererDiagnostics,
    screenshot: "web-e2e-skeleton-electron-1440x920.png",
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...evidence, screenshotPath, resultPath }, null, 2)}\n`,
  );
} catch (error) {
  if (appWindow) {
    const failureState = await appWindow
      .evaluate(() => ({
        bodyText: globalThis.document.body.innerText.slice(0, 2_000),
        title: globalThis.document.title,
        url: globalThis.location.href,
      }))
      .catch(() => null);
    globalThis.process.stderr.write(
      `${JSON.stringify({ failureState, rendererDiagnostics }, null, 2)}\n`,
    );
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
