import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";
import { runDesktopProviderResult } from "./desktop-provider-result.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const electronExecutable = join(
  repositoryRoot,
  "apps",
  "desktop",
  "node_modules",
  "electron",
  "dist",
  globalThis.process.platform === "win32" ? "electron.exe" : "electron",
);
const resultDirectory = join(repositoryRoot, ".aijian-dev", "e2e-results");
const profileRoot = resolve(repositoryRoot, ".aijian-dev");
const resultPath = join(resultDirectory, "desktop-provider-smoke.current.json");
const expectedBridgeKeys = [
  "acceptArtifactProposalAsDraft",
  "confirmSourceManifestBaseline",
  "copySourceManifestDraft",
  "createFakeTimelineRun",
  "createProject",
  "createProposalRun",
  "createProviderConnection",
  "deleteProviderConnection",
  "getArtifactProposal",
  "getInvalidationOperation",
  "getProject",
  "getProjectTimeline",
  "getSource",
  "getSourceManifest",
  "getStoryBibleIndex",
  "getStoryBibleVersion",
  "health",
  "importTextSource",
  "listInvalidationOperations",
  "listProjectAgents",
  "listProjectSkills",
  "listProjectTasks",
  "listProjects",
  "listProviderConnections",
  "listSources",
  "rejectArtifactProposal",
  "reorderTimelineClip",
  "replaceTimelineClip",
  "startFakeTimelineWorkflow",
  "submitSourceManifest",
  "trimTimelineClip",
].sort();

function ownsProfile(root, candidate) {
  const path = relative(root, candidate);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

const runId = globalThis.crypto.randomUUID();
const rendererErrors = [];
let createdConnectionId;
let application;
let electronProcess;
let profileDirectory;
const passed = await runDesktopProviderResult({
  writePath: resultPath,
  runId,
  body: async () => {
    await mkdir(profileRoot, { recursive: true });
    profileDirectory = await mkdtemp(join(profileRoot, "desktop-provider-smoke-"));
    application = await electron.launch({
      executablePath: electronExecutable,
      args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
      cwd: repositoryRoot,
      env: { ...globalThis.process.env, AIJIAN_E2E_USER_DATA_DIR: profileDirectory },
      timeout: 30_000,
    });
    electronProcess = application.process();
    const appWindow = await application.firstWindow({ timeout: 30_000 });
    appWindow.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning")
        rendererErrors.push(`${message.type()}: ${message.text()}`);
    });
    await appWindow.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    await appWindow.getByRole("button", { name: "AI 服务", exact: true }).first().click();
    await appWindow.getByRole("button", { name: "项目中心", exact: true }).click();
    await appWindow.getByRole("heading", { level: 1, name: "项目中心" }).waitFor();
    const connectWorkspace = appWindow.getByRole("button", {
      name: "连接本地工作区",
      exact: true,
    });
    if (await connectWorkspace.count()) {
      await connectWorkspace.click();
    }
    await appWindow.getByRole("button", { name: "本地工作区已连接", exact: true }).waitFor();
    await appWindow.getByRole("button", { name: "新建项目", exact: true }).click();
    await appWindow.getByLabel("作品名称").fill("Electron UI 验收项目");
    await appWindow.getByRole("button", { name: "保存演示修改", exact: true }).click();
    await appWindow.waitForFunction(
      (projectName) =>
        globalThis.document.querySelector("select[aria-label='作品选择']")?.selectedOptions[0]
          ?.textContent === projectName,
      "Electron UI 验收项目",
    );
    await appWindow.getByRole("heading", { level: 1, name: "来源输入" }).waitFor();
    await appWindow.getByRole("button", { name: "AI 服务", exact: true }).first().click();
    await appWindow.getByRole("heading", { level: 1, name: "AI 服务" }).waitFor();
    const currentPageText = await appWindow.locator("body").innerText();
    if (!currentPageText.includes("添加模型供应商")) {
      throw new Error(
        `Current AI services page did not render the provider form: ${currentPageText}`,
      );
    }
    await appWindow
      .getByRole("button", { name: /^Ollama 本地\s+无需把小说正文发送到云端$/ })
      .click();
    await appWindow.getByLabel("连接名称").fill("Electron IPC 验收连接");
    await appWindow.getByLabel("剧本 / 提示词").fill("qwen-e2e");
    await appWindow.getByRole("button", { name: "保存连接", exact: true }).click();
    await appWindow.getByText("Electron IPC 验收连接", { exact: true }).waitFor();
    const bridgeResult = await appWindow.evaluate(async () => {
      const health = await globalThis.aijian.health();
      const projects = await globalThis.aijian.listProjects();
      const project = projects.data.find((item) => item.name === "Electron UI 验收项目");
      if (!project)
        throw new Error("Current UI project was not persisted through the desktop bridge");
      const taskQueue = await globalThis.aijian.listProjectTasks(project.id);
      const connections = await globalThis.aijian.listProviderConnections();
      const created = connections.data.find(
        (item) => item.display_name === "Electron IPC 验收连接",
      );
      return {
        health: health.data.status,
        createdId: created?.id,
        credentialStatus: created?.credential_status,
        listed: created !== undefined,
        bridgeKeys: Object.keys(globalThis.aijian).sort(),
        taskQueueProjectIdMatched: taskQueue.data.project_id === project.id,
        taskQueueCount: taskQueue.data.summary.total,
        nodeGlobals: { process: typeof globalThis.process, require: typeof globalThis.require },
        viewport: {
          innerWidth: globalThis.innerWidth,
          innerHeight: globalThis.innerHeight,
          scrollWidth: globalThis.document.documentElement.scrollWidth,
          clientWidth: globalThis.document.documentElement.clientWidth,
        },
      };
    });
    createdConnectionId = bridgeResult.createdId;
    if (
      bridgeResult.health !== "ok" ||
      !bridgeResult.createdId ||
      !/^pcn_[0-9a-f]{32}$/.test(bridgeResult.createdId) ||
      !bridgeResult.listed ||
      bridgeResult.credentialStatus !== "MISSING" ||
      !bridgeResult.taskQueueProjectIdMatched
    )
      throw new Error(
        "Electron UI and IPC did not round-trip the local provider connection contract",
      );
    if (JSON.stringify(bridgeResult.bridgeKeys) !== JSON.stringify(expectedBridgeKeys))
      throw new Error("Electron preload bridge did not match the exact typed-method allowlist");
    if (
      bridgeResult.nodeGlobals.process !== "undefined" ||
      bridgeResult.nodeGlobals.require !== "undefined"
    )
      throw new Error("Electron renderer exposed Node.js globals");
    if (bridgeResult.viewport.scrollWidth !== bridgeResult.viewport.clientWidth)
      throw new Error("Electron renderer has horizontal overflow");
    const rendererUrl = new globalThis.URL(appWindow.url());
    if (
      rendererUrl.protocol !== "file:" ||
      !rendererUrl.pathname.endsWith("/studio-web/dist/index.html")
    )
      throw new Error(`Electron did not load the built studio-web artifact: ${appWindow.url()}`);

    await appWindow.reload();
    await appWindow.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    await appWindow.getByRole("button", { name: "AI 服务", exact: true }).first().click();
    await appWindow.getByText("Electron IPC 验收连接", { exact: true }).waitFor();
    const readBack = await appWindow.evaluate(
      async (connectionId) =>
        (await globalThis.aijian.listProviderConnections()).data.some(
          (item) => item.id === connectionId,
        ),
      createdConnectionId,
    );
    if (!readBack)
      throw new Error("Electron IPC provider connection was not available after renderer reload");
    await appWindow.getByRole("button", { name: "移除连接", exact: true }).click();
    await appWindow.getByRole("button", { name: "确认移除", exact: true }).click();
    await appWindow
      .getByText("Electron IPC 验收连接", { exact: true })
      .waitFor({ state: "hidden" });
    createdConnectionId = undefined;
    if (rendererErrors.length > 0)
      throw new Error(`Electron renderer console was not clean: ${rendererErrors.join(" | ")}`);
    const evidence = {
      check: "desktop-provider-smoke-current",
      passed: true,
      loadedBuiltRenderer: true,
      createdIdMatchedContract: true,
      credentialStatus: bridgeResult.credentialStatus,
      listed: bridgeResult.listed,
      readBackAfterReload: readBack,
      taskQueueProjectIdMatched: bridgeResult.taskQueueProjectIdMatched,
      taskQueueCount: bridgeResult.taskQueueCount,
      bridgeKeys: bridgeResult.bridgeKeys,
      nodeGlobals: bridgeResult.nodeGlobals,
      viewport: bridgeResult.viewport,
      horizontalOverflow: false,
      rendererConsoleErrors: rendererErrors,
    };
    return evidence;
  },
  cleanup: async () => {
    if (createdConnectionId) {
      const window = application.windows()[0];
      if (window)
        await window
          .evaluate(
            async (connectionId) => globalThis.aijian.deleteProviderConnection(connectionId),
            createdConnectionId,
          )
          .catch(() => undefined);
    }
    if (application) {
      await application.close();
      if (!electronProcess || electronProcess.exitCode !== 0)
        throw new Error(`Owned Electron did not exit normally: ${electronProcess?.exitCode}`);
    }
    if (!profileDirectory) return;
    if (!ownsProfile(profileRoot, resolve(profileDirectory)))
      throw new Error("Owned profile escaped the controlled root");
    await rm(profileDirectory, { recursive: true, force: true });
  },
});
globalThis.process.stdout.write(
  `${JSON.stringify({ ...passed, profileRemoved: true, resultPath }, null, 2)}\n`,
);
