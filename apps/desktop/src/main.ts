import { registerOfficialTextHandlers } from "./official-text-ipc";
import { createChatGPTRuntime } from "./chatgpt-auth-runtime";
import { createProtectedStore } from "./chatgpt-auth-storage";
import { registerChatGPTHandlers } from "./chatgpt-auth-ipc";
import { registerDraftExportOutputHandlers } from "./draft-export-output-ipc";
import { registerDraftReviewHandlers } from "./draft-review-ipc";
import { registerDraftExportHandlers } from "./draft-export-ipc";
import { prepareCompositionPreviewPath } from "./composition-preview-cache";
import { registerEpisodeMediaAssemblyHandlers } from "./episode-media-assembly-ipc";
import { lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from "electron";

import {
  createLocalApiClient,
  type CreateProjectInput,
  type CreateProviderConnectionInput,
  type ImportTextSourceInput,
  type LocalApiClient,
  type SourceManifestReviewClient,
  type ReorderTimelineClipInput,
  type ReplaceTimelineClipInput,
  type TrimTimelineClipInput,
} from "./api-client";
import { registerAgentSkillCatalogHandlers } from "./agent-skill-catalog-ipc";
import { registerAppPreferencesHandlers } from "./app-preferences-ipc";
import { registerMediaAssetHandlers } from "./media-asset-ipc";
import { registerEpisodeScriptHandlers } from "./episode-script-ipc";
import { registerProjectCreativeLibraryHandlers } from "./project-creative-library-ipc";
import { registerEpisodeStoryboardHandlers } from "./episode-storyboard-ipc";
import { registerEpisodeScriptConfirmationHandlers } from "./episode-script-confirmation-ipc";
import { registerSourceProposalAcceptanceHandler } from "./source-proposal-acceptance-ipc";
import { registerSub2APIConfiguredReadinessHandler } from "./sub2api-configured-readiness-ipc";
import { registerSub2APIConnectionMutationHandlers } from "./sub2api-connection-mutation-ipc";
import { registerArtifactProposalHandlers } from "./artifact-proposal-contract";
import { createTopLevelEpisodeClientFor, registerEpisodeHandlers } from "./episode-ipc";
import {
  createE2EFakeTimelineRunResponseFault,
  shouldEnableE2EFakeTimelineRunResponseFault,
} from "./e2e-fake-timeline-run-response-fault";
import {
  createE2EProposalRunResponseFault,
  shouldEnableE2EProposalRunResponseFault,
} from "./e2e-proposal-run-response-fault";
import { registerFakeTimelineRunHandlers } from "./fake-timeline-run-contract";
import { registerDevelopmentExportHandlers } from "./development-export-ipc";
import { registerInvalidationOperationHandlers } from "./invalidation-operation-ipc";
import { registerProposalRunHandlers } from "./proposal-run-contract";
import { isProjectUpdateId, normalizeProjectUpdateCommand } from "./project-update-contract";
import {
  registerRemoteSourceExtractHandlers,
  resolveRemoteSourceExtractTopFrameClient,
} from "./remote-source-extract-ipc";
import {
  registerSub2APISourceExtractHandlers,
  registerVersionedSourceExtractionProposalHandler,
} from "./remote-source-extract-v2-ipc";
import {
  registerProductionBriefHandlers,
  resolveProductionBriefTopFrameClient,
} from "./production-brief-ipc";
import { resolveE2EUserDataDirectory } from "./e2e-user-data";
import {
  createSidecarExtractionTemp, type SidecarExtractionTemp,
} from "./sidecar-extraction-temp";
import {
  SidecarStartupError, startSidecar, type SidecarHandle, type StartSidecarOptions,
} from "./sidecar-process";
import { createSourceManifestReviewController } from "./source-manifest-review";
import { registerSourceManifestReviewHandlers } from "./source-manifest-review-ipc";

let mainWindow: BrowserWindow | null = null;
let apiClient: (LocalApiClient & SourceManifestReviewClient) | null = null;
let sourceManifestReviewController: ReturnType<typeof createSourceManifestReviewController> | null =
  null;
let sidecar: SidecarHandle | null = null;
let quitting = false;

function configureDevelopmentUserData(): boolean {
  const requested = process.env.AIJIAN_E2E_USER_DATA_DIR;
  if (requested === undefined) return false;
  if (app.isPackaged) {
    throw new Error("E2E user data override is only available to local development");
  }
  const allowedRoot = resolve(__dirname, "../../../.aijian-dev");
  const requestedPath = resolveE2EUserDataDirectory(requested, allowedRoot);
  if (requestedPath === null) return false;
  app.setPath("userData", requestedPath);
  return true;
}

function developmentSidecarOptions(): StartSidecarOptions {
  if (app.isPackaged) {
    throw new Error("Packaged sidecar runtime is not available");
  }
  const repositoryRoot = resolve(__dirname, "../../..");
  const command =
    process.platform === "win32"
      ? join(repositoryRoot, ".venv", "Scripts", "python.exe")
      : join(repositoryRoot, ".venv", "bin", "python");
  return {
    command,
    args: ["-m", "aijian_api.sidecar"],
    cwd: repositoryRoot,
    env: {
      AIJIAN_DATA_DIR: join(app.getPath("userData"), "workspace"),
      AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME: "0",
      ...(process.env.AIJIAN_DRAFT_MEDIA_TOOL_ROOT && process.env.AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK
        ? { AIJIAN_DRAFT_MEDIA_TOOL_ROOT: process.env.AIJIAN_DRAFT_MEDIA_TOOL_ROOT,
            AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK: process.env.AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK }
        : {}),
      PYTHONPATH: join(repositoryRoot, "services", "api", "src"),
    },
  };
}

function plainResource(path: string, kind: "directory" | "file"): boolean {
  try {
    const info = lstatSync(path);
    return !info.isSymbolicLink() &&
      (kind === "directory" ? info.isDirectory() : info.isFile());
  } catch {
    return false;
  }
}

function packagedResourceRoot(): string {
  if (!app.isPackaged || process.platform !== "win32") {
    throw new Error("Packaged resources require a Windows installation");
  }
  const rawRoot = process.resourcesPath;
  if (typeof rawRoot !== "string" || rawRoot.length === 0 ||
      !isAbsolute(rawRoot) || rawRoot.startsWith("\\\\") ||
      rawRoot.split(/[\\/]/).includes("..")) {
    throw new Error("Packaged resource root is invalid");
  }
  const root = resolve(rawRoot);
  if (!plainResource(root, "directory")) {
    throw new Error("Packaged resource root is unavailable");
  }
  return root;
}

function packagedSidecarOptions(): StartSidecarOptions {
  const resourceRoot = packagedResourceRoot();
  const sidecarDirectory = join(resourceRoot, "sidecar");
  if (!plainResource(sidecarDirectory, "directory") ||
      !plainResource(join(resourceRoot, "config"), "directory") ||
      !plainResource(join(resourceRoot, "config", "media-toolchain-lock.json"), "file") ||
      !plainResource(join(sidecarDirectory, "aijian-sidecar.exe"), "file")) {
    throw new Error("Packaged sidecar resources are unavailable");
  }
  const workspaceDirectory = join(app.getPath("userData"), "workspace");
  let extraction: SidecarExtractionTemp;
  try {
    extraction = createSidecarExtractionTemp(
      process.env.LOCALAPPDATA, process.env.USERPROFILE,
    );
  } catch {
    throw new SidecarStartupError("STARTUP_UNKNOWN");
  }
  return {
    command: join(sidecarDirectory, "aijian-sidecar.exe"),
    args: [],
    cwd: sidecarDirectory,
    env: {
      AIJIAN_DATA_DIR: workspaceDirectory,
      AIJIAN_RESOURCE_ROOT: resourceRoot,
      TEMP: extraction.directory,
      TMP: extraction.directory,
    },
    cleanupAfterClose: extraction.cleanupAfterClose,
  };
}

function packagedRendererIndex(): string {
  const rendererDirectory = join(packagedResourceRoot(), "renderer");
  const index = join(rendererDirectory, "index.html");
  if (!plainResource(rendererDirectory, "directory") ||
      !plainResource(index, "file")) {
    throw new Error("Packaged renderer is unavailable");
  }
  return index;
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#0d0e0c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });

  void window.loadFile(app.isPackaged
    ? packagedRendererIndex()
    : join(__dirname, "../../studio-web/dist/index.html"));
  return window;
}

function clientFor(event: IpcMainInvokeEvent): LocalApiClient {
  if (mainWindow === null || event.sender !== mainWindow.webContents || apiClient === null) {
    throw new Error("Local API is not available");
  }
  return apiClient;
}

let chatgptRuntime: ReturnType<typeof createChatGPTRuntime> | null = null;
function getChatGPTRuntime() {
    chatgptRuntime ??= createChatGPTRuntime({
      store: createProtectedStore(join(app.getPath("userData"), "chatgpt-official"), safeStorage),
      fetch: globalThis.fetch,
      openBrowser: (url) => shell.openExternal(url),
      confirmText: async (request) => {
        const window = mainWindow;
        if (!window) return false;
        const result = await dialog.showMessageBox(window, {
          type: "question", title: "确认一次 ChatGPT 文本请求", defaultId: 1, cancelId: 1,
          buttons: ["批准这一次请求", "取消"],
          message: `向 OpenAI 发送文本并使用 ${request.modelLabel} 生成一次草稿？`,
          detail: `账号：${request.profileLabel}\n${request.approvalContext ?? ""}\n操作：${request.operationId}\n\n将发送完整输入（${request.text.length} 字符）和指令（${request.instructions?.length ?? 0} 字符）。本次仅允许一次请求，消耗 ChatGPT 套餐或现有积分；不自动重试。实际消耗由 OpenAI 决定，请先确认账号用量限制。结果需在 AIVORA 审阅后采用。\n\n输入：\n${request.text}\n\n指令：\n${request.instructions ?? "无"}`,
        });
        return result.response === 0;
      },
      confirmSignIn: async (scope, signal) => {
        const window = mainWindow;
        if (!window) return false;
        const scopes = { LOCAL_PERSONAL: "个人本机项目", OPEN_SOURCE: "开源项目", APPROVED_PRIVATE: "已获 OpenAI 批准的私有应用" };
        const result = await dialog.showMessageBox(window, {
          type: "question", title: "ChatGPT 官方账号授权", defaultId: 1, cancelId: 1, signal,
          buttons: ["继续并打开系统浏览器", "取消"],
          message: "允许 AIVORA 注册或重新连接 ChatGPT，并在本机加密保存登录凭据？",
          detail: `你确认此次软件用于：${scopes[scope]}。这是软件接入资格，不是账号套餐；具体权限将在 OpenAI 页面另行确认。这不会代替 OpenAI 对商业/托管应用的资格批准。\n\n浏览器中由你登录 OpenAI 并审阅权限。AIVORA 将获取经验证的账号标识和邮箱，申请使用 ChatGPT 套餐及后续刷新权限，并由系统保护本机保存的凭据。凭据不会进入项目文件或 Sub2API。你可随时退出并在 ChatGPT 用量设置撤销访问。\n\n本次只进行登录，不发送剧本或执行模型推理。`,
        });
        return result.response === 0;
      },
    });
    return chatgptRuntime;
}
registerChatGPTHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  (event) => mainWindow !== null && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame,
  getChatGPTRuntime,
  (url) => shell.openExternal(url),
);

registerOfficialTextHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
  getChatGPTRuntime,
);

const episodeClientFor = createTopLevelEpisodeClientFor(
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);

registerAppPreferencesHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerMediaAssetHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
  async () => {
    const window = mainWindow;
    if (window === null) throw new Error("Media asset file picker is unavailable");
    const selected = await dialog.showOpenDialog(window, { properties: ["openFile"] });
    return selected.canceled ? null : selected.filePaths[0] ?? null;
  },
);
registerSub2APIConfiguredReadinessHandler<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerSub2APIConnectionMutationHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerProjectCreativeLibraryHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerEpisodeScriptHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerDraftExportOutputHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
  (trustedPath) => shell.showItemInFolder(trustedPath),
);
registerDraftReviewHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerDraftExportHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
  async (suggestedName) => {
    const window = mainWindow;
    if (window === null) throw new Error("Draft export Save dialog is unavailable");
    const selected = await dialog.showSaveDialog(window, {
      title: "保存草稿 MP4 · DRAFT",
      defaultPath: suggestedName,
      filters: [{ name: "草稿 MP4", extensions: ["mp4"] }],
      buttonLabel: "保存草稿",
    });
    return selected.canceled ? null : selected.filePath ?? null;
  },
  (operationId) => prepareCompositionPreviewPath(app.getPath("userData"), operationId),
);
registerEpisodeMediaAssemblyHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerEpisodeStoryboardHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerEpisodeScriptConfirmationHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerSourceProposalAcceptanceHandler<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);

ipcMain.handle("health:get", (event) => clientFor(event).getHealth());
ipcMain.handle("projects:list", (event) => clientFor(event).listProjects());
ipcMain.handle("projects:create", (event, input: CreateProjectInput) =>
  clientFor(event).createProject(input),
);
ipcMain.handle("projects:get", (event, projectId: string) =>
  clientFor(event).getProject(projectId),
);
ipcMain.handle("projects:update", (event, ...args: unknown[]) => {
  const client = clientFor(event);
  if (mainWindow === null || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error("Project update IPC sender frame is not authorized");
  }
  if (args.length !== 2 || !isProjectUpdateId(args[0])) return { kind: "INVALID_INPUT" };
  const command = normalizeProjectUpdateCommand(args[1]);
  if (command === null) return { kind: "INVALID_INPUT" };
  return client.updateProject(args[0], command);
});
registerEpisodeHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  episodeClientFor,
);
ipcMain.handle("sources:list", (event, projectId: string) =>
  clientFor(event).listSources(projectId),
);
ipcMain.handle("sources:get", (event, projectId: string, sourceId: string) =>
  clientFor(event).getSource(projectId, sourceId),
);
ipcMain.handle("sources:get-text", (event, projectId: string, sourceId: string) =>
  clientFor(event).getSourceText(projectId, sourceId),
);
ipcMain.handle("sources:import-text", (event, projectId: string, input: ImportTextSourceInput) =>
  clientFor(event).importTextSource(projectId, input),
);
ipcMain.handle("artifacts:get-source-manifest", (event, projectId: string) =>
  clientFor(event).getSourceManifest(projectId),
);
registerSourceManifestReviewHandlers((channel, listener) => ipcMain.handle(channel, listener), {
  getMainWindow: () => mainWindow,
  getController: () => sourceManifestReviewController,
  showMessageBox: (origin, options) => dialog.showMessageBox(origin, options),
});
ipcMain.handle("artifacts:get-story-bible-index", (event, projectId: string) =>
  clientFor(event).getStoryBibleIndex(projectId),
);
ipcMain.handle("artifacts:get-story-bible-version", (event, projectId: string, versionId: string) =>
  clientFor(event).getStoryBibleVersion(projectId, versionId),
);
ipcMain.handle("tasks:list", (event, projectId: string) =>
  clientFor(event).listProjectTasks(projectId),
);
registerArtifactProposalHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
);
registerInvalidationOperationHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
);
registerProposalRunHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
);
registerRemoteSourceExtractHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  (event) => resolveRemoteSourceExtractTopFrameClient(
    event,
    mainWindow?.webContents.mainFrame,
    clientFor,
  ),
);
registerVersionedSourceExtractionProposalHandler<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerSub2APISourceExtractHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
  (event) => mainWindow !== null && event.senderFrame === mainWindow.webContents.mainFrame,
);
registerProductionBriefHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  (event) => {
    return resolveProductionBriefTopFrameClient(
      event,
      mainWindow?.webContents.mainFrame,
      clientFor,
    );
  },
);
registerFakeTimelineRunHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
);
registerDevelopmentExportHandlers(
  (channel, listener) => ipcMain.handle(channel, listener),
  (event) => {
    if (mainWindow === null || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error("Development export is not available");
    }
    return clientFor(event);
  },
  () => join(app.getPath("userData"), "workspace"),
  async (suggestedName) => {
    if (mainWindow === null) return null;
    const selection = await dialog.showSaveDialog(mainWindow, {
      title: "Save development MP4 export",
      defaultPath: suggestedName,
      filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    });
    return selection.canceled ? null : selection.filePath;
  },
);
registerAgentSkillCatalogHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
);
ipcMain.handle("workflows:start-fake-timeline", (event, projectId: string) =>
  clientFor(event).startFakeTimelineWorkflow(projectId),
);
ipcMain.handle("timeline:get", (event, projectId: string) =>
  clientFor(event).getProjectTimeline(projectId),
);
ipcMain.handle("timeline:trim", (event, projectId: string, input: TrimTimelineClipInput) =>
  clientFor(event).trimTimelineClip(projectId, input),
);
ipcMain.handle("timeline:reorder", (event, projectId: string, input: ReorderTimelineClipInput) =>
  clientFor(event).reorderTimelineClip(projectId, input),
);
ipcMain.handle("timeline:replace", (event, projectId: string, input: ReplaceTimelineClipInput) =>
  clientFor(event).replaceTimelineClip(projectId, input),
);
ipcMain.handle("providers:list", (event) => clientFor(event).listProviderConnections());
ipcMain.handle("providers:create", (event, input: CreateProviderConnectionInput) =>
  clientFor(event).createProviderConnection(input),
);
ipcMain.handle("providers:delete", (event, connectionId: string) =>
  clientFor(event).deleteProviderConnection(connectionId),
);

async function startApplication(): Promise<void> {
  const hasIsolatedE2EUserDataProfile = configureDevelopmentUserData();
  await app.whenReady();
  if (app.isPackaged) packagedRendererIndex();
  sidecar = await startSidecar(
    app.isPackaged ? packagedSidecarOptions() : developmentSidecarOptions(),
  );
  const proposalRunResponseFault = shouldEnableE2EProposalRunResponseFault({
    isPackaged: app.isPackaged,
    hasIsolatedUserDataProfile: hasIsolatedE2EUserDataProfile,
    mode: process.env.AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT,
  });
  const fakeTimelineRunResponseFault = shouldEnableE2EFakeTimelineRunResponseFault({
    isPackaged: app.isPackaged,
    hasIsolatedUserDataProfile: hasIsolatedE2EUserDataProfile,
    mode: process.env.AIJIAN_E2E_FAKE_TIMELINE_RUN_RESPONSE_FAULT,
  });
  apiClient = createLocalApiClient(
    createE2EFakeTimelineRunResponseFault(
      createE2EProposalRunResponseFault(fetch, proposalRunResponseFault),
      fakeTimelineRunResponseFault,
    ),
    sidecar.session,
  );
  sourceManifestReviewController = createSourceManifestReviewController(apiClient);
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (mainWindow === null) {
      mainWindow = createMainWindow();
    }
  });
}

void startApplication().catch((error: unknown) => {
  console.error(error instanceof SidecarStartupError
    ? error.classification : "STARTUP_UNKNOWN");
  app.quit();
});

app.on("before-quit", (event) => {
  void chatgptRuntime?.cancel();
  if (quitting || sidecar === null) return;
  event.preventDefault();
  quitting = true;
  void sidecar
    .stop()
    .catch(() => undefined)
    .finally(() => {
      sidecar = null;
      apiClient = null;
      sourceManifestReviewController = null;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
