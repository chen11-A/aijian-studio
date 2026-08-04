import { join, resolve } from "node:path";

import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";

import {
  createLocalApiClient,
  type CreateProjectInput,
  type ImportTextSourceInput,
  type LocalApiClient,
} from "./api-client";
import { startSidecar, type SidecarHandle, type StartSidecarOptions } from "./sidecar-process";

const DEVELOPMENT_RENDERER_URL = "http://127.0.0.1:5173";

let mainWindow: BrowserWindow | null = null;
let apiClient: LocalApiClient | null = null;
let sidecar: SidecarHandle | null = null;
let quitting = false;

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

async function startApplication(): Promise<void> {
  await app.whenReady();
  sidecar = await startSidecar(developmentSidecarOptions());
  apiClient = createLocalApiClient(fetch, sidecar.session);
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
