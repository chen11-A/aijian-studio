import { join } from "node:path";

import { app, BrowserWindow, ipcMain } from "electron";

import { createLocalApiClient } from "./api-client";

const DEVELOPMENT_RENDERER_URL = "http://127.0.0.1:5173";
const DEVELOPMENT_API_URL = "http://127.0.0.1:8000";
const apiClient = createLocalApiClient(fetch, process.env.AIJIAN_API_URL ?? DEVELOPMENT_API_URL);

let mainWindow: BrowserWindow | null = null;

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

ipcMain.handle("health:get", async () => apiClient.getHealth());

void app.whenReady().then(() => {
  mainWindow = createMainWindow();

  app.on("activate", () => {
    if (mainWindow === null) {
      mainWindow = createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
