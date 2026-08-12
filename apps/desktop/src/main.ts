import { join, resolve } from "node:path";

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

import {
  createLocalApiClient,
  type CreateProjectInput,
  type CreateProviderConnectionInput,
  type ImportTextSourceInput,
  type LocalApiClient,
  type ReorderTimelineClipInput,
  type ReplaceTimelineClipInput,
  type TrimTimelineClipInput,
} from "./api-client";
import { registerAgentSkillCatalogHandlers } from "./agent-skill-catalog-ipc";
import { registerArtifactProposalHandlers } from "./artifact-proposal-contract";
import {
  createE2EProposalRunResponseFault,
  shouldEnableE2EProposalRunResponseFault,
} from "./e2e-proposal-run-response-fault";
import { registerProposalRunHandlers } from "./proposal-run-contract";
import { resolveE2EUserDataDirectory } from "./e2e-user-data";
import { startSidecar, type SidecarHandle, type StartSidecarOptions } from "./sidecar-process";

const DEVELOPMENT_RENDERER_URL = "http://127.0.0.1:5173";

let mainWindow: BrowserWindow | null = null;
let apiClient: LocalApiClient | null = null;
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
      PYTHONPATH: join(repositoryRoot, "services", "api", "src"),
    },
  };
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

  if (app.isPackaged) {
    void window.loadFile(join(__dirname, "../../studio-web/dist/index.html"));
  } else {
    void window.loadURL(DEVELOPMENT_RENDERER_URL);
  }
  return window;
}

function clientFor(event: IpcMainInvokeEvent): LocalApiClient {
  if (mainWindow === null || event.sender !== mainWindow.webContents || apiClient === null) {
    throw new Error("Local API is not available");
  }
  return apiClient;
}

ipcMain.handle("health:get", (event) => clientFor(event).getHealth());
ipcMain.handle("projects:list", (event) => clientFor(event).listProjects());
ipcMain.handle("projects:create", (event, input: CreateProjectInput) =>
  clientFor(event).createProject(input),
);
ipcMain.handle("projects:get", (event, projectId: string) =>
  clientFor(event).getProject(projectId),
);
ipcMain.handle("sources:list", (event, projectId: string) =>
  clientFor(event).listSources(projectId),
);
ipcMain.handle("sources:get", (event, projectId: string, sourceId: string) =>
  clientFor(event).getSource(projectId, sourceId),
);
ipcMain.handle("sources:import-text", (event, projectId: string, input: ImportTextSourceInput) =>
  clientFor(event).importTextSource(projectId, input),
);
ipcMain.handle("artifacts:get-source-manifest", (event, projectId: string) =>
  clientFor(event).getSourceManifest(projectId),
);
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
registerProposalRunHandlers<IpcMainInvokeEvent>(
  (channel, listener) => ipcMain.handle(channel, listener),
  clientFor,
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
  sidecar = await startSidecar(developmentSidecarOptions());
  const proposalRunResponseFault = shouldEnableE2EProposalRunResponseFault({
    isPackaged: app.isPackaged,
    hasIsolatedUserDataProfile: hasIsolatedE2EUserDataProfile,
    mode: process.env.AIJIAN_E2E_PROPOSAL_RUN_RESPONSE_FAULT,
  });
  apiClient = createLocalApiClient(
    createE2EProposalRunResponseFault(fetch, proposalRunResponseFault),
    sidecar.session,
  );
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (mainWindow === null) {
      mainWindow = createMainWindow();
    }
  });
}

void startApplication().catch(() => {
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
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
