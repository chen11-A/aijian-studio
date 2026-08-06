import { realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

import { app, BrowserWindow } from "electron";

const harnessPath = globalThis.process.env.AIJIAN_PLAYBACK_HARNESS_PATH;
const profileRoot = globalThis.process.env.AIJIAN_PLAYBACK_PROFILE_ROOT;
if (!harnessPath || !profileRoot || !isAbsolute(harnessPath) || !isAbsolute(profileRoot)) {
  throw new Error("playback harness and profile root must be absolute");
}
const [resolvedHarnessPath, resolvedProfileRoot] = await Promise.all([
  realpath(harnessPath),
  realpath(profileRoot),
]);
const harnessRelativePath = relative(resolvedProfileRoot, resolvedHarnessPath);
if (
  !harnessRelativePath ||
  harnessRelativePath.startsWith("..") ||
  isAbsolute(harnessRelativePath)
) {
  throw new Error("playback harness must be inside its isolated profile root");
}

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 640,
    height: 480,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  await window.loadFile(resolvedHarnessPath);
});

app.on("window-all-closed", () => app.quit());
