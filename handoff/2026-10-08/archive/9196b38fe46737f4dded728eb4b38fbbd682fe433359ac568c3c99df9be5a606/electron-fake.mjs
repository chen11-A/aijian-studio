export const app = {
  isPackaged: false,
  whenReady: async () => undefined,
  getPath: () => "C:/qa-userdata",
  on: () => undefined,
  quit: () => undefined,
};
export function BrowserWindow() { return globalThis.__qaIpcFixture.mainWindow; }
export const dialog = { showMessageBox: async () => undefined, showSaveDialog: async () => undefined };
export const ipcMain = {
  handle: (channel, listener) => globalThis.__qaIpcFixture.handlers.set(channel, listener),
};
