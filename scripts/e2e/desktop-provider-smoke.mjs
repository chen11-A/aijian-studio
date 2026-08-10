import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright-core";

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
const profileDirectory = join(repositoryRoot, ".aijian-dev", "electron-e2e-profile");
const screenshotPath = join(
  repositoryRoot,
  "docs",
  "quality",
  "evidence",
  "provider-settings-electron-1424x881.png",
);
const resultPath = join(
  repositoryRoot,
  "docs",
  "quality",
  "evidence",
  "provider-settings-electron-smoke.json",
);
await mkdir(profileDirectory, { recursive: true });

const application = await electron.launch({
  executablePath: electronExecutable,
  args: [join(repositoryRoot, "apps", "desktop"), `--user-data-dir=${profileDirectory}`],
  cwd: repositoryRoot,
  env: {
    ...globalThis.process.env,
    AIJIAN_E2E_USER_DATA_DIR: profileDirectory,
  },
  timeout: 30_000,
});

const rendererErrors = [];
let createdConnectionId;
try {
  const appWindow = await application.firstWindow({ timeout: 30_000 });
  appWindow.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      rendererErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("button", { name: "模型与 API" }).click();
  await appWindow.getByRole("heading", { level: 2, name: "统一模型连接" }).waitFor();

  const bridgeResult = await appWindow.evaluate(async () => {
    const projects = await globalThis.aijian.listProjects();
    const project =
      projects.data[0] ??
      (
        await globalThis.aijian.createProject({
          name: "Electron IPC 验收项目",
          aspect_ratio: "9:16",
          target_duration_seconds: 30,
          source_language: "zh-CN",
        })
      ).data;
    const taskQueue = await globalThis.aijian.listProjectTasks(project.id);
    const before = await globalThis.aijian.listProviderConnections();
    for (const connection of before.data) {
      if (connection.display_name === "Electron IPC 验收连接") {
        await globalThis.aijian.deleteProviderConnection(connection.id);
      }
    }
    const created = await globalThis.aijian.createProviderConnection({
      provider_kind: "OLLAMA",
      display_name: "Electron IPC 验收连接",
      base_url: "http://127.0.0.1:11434/v1",
      enabled: true,
      models: [{ model_id: "qwen-e2e", capabilities: ["TEXT"] }],
    });
    const afterCreate = await globalThis.aijian.listProviderConnections();
    return {
      beforeCount: before.data.length,
      createdId: created.data.id,
      credentialStatus: created.data.credential_status,
      listed: afterCreate.data.some((item) => item.id === created.data.id),
      bridgeKeys: Object.keys(globalThis.aijian).sort(),
      taskQueueProjectIdMatched: taskQueue.data.project_id === project.id,
      taskQueueCount: taskQueue.data.summary.total,
      nodeGlobals: {
        process: typeof globalThis.process,
        require: typeof globalThis.require,
      },
    };
  });
  createdConnectionId = bridgeResult.createdId;

  if (
    !bridgeResult.listed ||
    bridgeResult.credentialStatus !== "MISSING" ||
    !bridgeResult.taskQueueProjectIdMatched
  ) {
    throw new Error("Electron IPC did not round-trip the provider connection contract");
  }
  const expectedBridgeKeys = [
    "createProviderConnection",
    "createProject",
    "deleteProviderConnection",
    "getProject",
    "getProjectTimeline",
    "getSource",
    "getSourceManifest",
    "getStoryBibleVersion",
    "getStoryBibleIndex",
    "health",
    "importTextSource",
    "listProjectTasks",
    "listProjects",
    "listProviderConnections",
    "listSources",
    "reorderTimelineClip",
    "replaceTimelineClip",
    "trimTimelineClip",
  ].sort();
  if (JSON.stringify(bridgeResult.bridgeKeys) !== JSON.stringify(expectedBridgeKeys)) {
    throw new Error("Electron preload bridge did not match the exact typed-method allowlist");
  }
  if (
    bridgeResult.nodeGlobals.process !== "undefined" ||
    bridgeResult.nodeGlobals.require !== "undefined"
  ) {
    throw new Error("Electron renderer exposed Node.js globals");
  }

  await appWindow.reload();
  await appWindow.getByText("本地工作区服务已连接").waitFor({ timeout: 30_000 });
  await appWindow.getByRole("button", { name: "模型与 API" }).click();
  await appWindow.getByText("Electron IPC 验收连接").waitFor();
  await appWindow.screenshot({ path: screenshotPath });

  await appWindow.evaluate(async (connectionId) => {
    await globalThis.aijian.deleteProviderConnection(connectionId);
  }, createdConnectionId);
  createdConnectionId = undefined;
  const viewport = await appWindow.evaluate(() => ({
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
    clientWidth: globalThis.document.documentElement.clientWidth,
  }));
  if (viewport.scrollWidth !== viewport.clientWidth) {
    throw new Error("Electron renderer has horizontal overflow");
  }
  if (rendererErrors.length > 0) {
    throw new Error(`Electron renderer console was not clean: ${rendererErrors.join(" | ")}`);
  }
  const evidence = {
    check: "desktop-provider-smoke",
    passed: true,
    createdIdMatchedContract: /^pcn_[0-9a-f]{32}$/.test(bridgeResult.createdId),
    credentialStatus: bridgeResult.credentialStatus,
    listed: bridgeResult.listed,
    taskQueueProjectIdMatched: bridgeResult.taskQueueProjectIdMatched,
    taskQueueCount: bridgeResult.taskQueueCount,
    bridgeKeys: bridgeResult.bridgeKeys,
    nodeGlobals: bridgeResult.nodeGlobals,
    viewport,
    horizontalOverflow: false,
    rendererConsoleErrors: rendererErrors,
    screenshot: "provider-settings-electron-1424x881.png",
  };
  await writeFile(resultPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  globalThis.process.stdout.write(
    `${JSON.stringify({ ...evidence, screenshotPath, resultPath }, null, 2)}\n`,
  );
} finally {
  if (createdConnectionId) {
    const windows = application.windows();
    if (windows[0]) {
      await windows[0]
        .evaluate(async (connectionId) => {
          await globalThis.aijian.deleteProviderConnection(connectionId);
        }, createdConnectionId)
        .catch(() => undefined);
    }
  }
  await application.close();
}
