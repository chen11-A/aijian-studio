import { lstatSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";

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
      AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME: "1",
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
  const root = packagedResourceRoot();
  const sidecarDirectory = join(root, "sidecar");
  if (!plainResource(sidecarDirectory, "directory") ||
      !plainResource(join(root, "config"), "directory") ||
      !plainResource(join(root, "config", "media-toolchain-lock.json"), "file") ||
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
      AIJIAN_RESOURCE_ROOT: root,
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
  sidecar = await startSidecar(app.isPackaged
    ? packagedSidecarOptions()
    : developmentSidecarOptions());
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
