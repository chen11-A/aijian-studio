import type {
  BrowserWindow,
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue,
  WebContentsDidStartNavigationEventParams,
} from "electron";
import {
  MEDIA_TOOLCHAIN_CHANNELS,
  type MediaToolchainCancelResult,
  type MediaToolchainSelectionResult,
} from "./media-toolchain-contract";
import {
  isNativeMediaToolchainDirectory,
  type MediaToolchainClient,
} from "./media-toolchain-client";

export const MEDIA_TOOLCHAIN_PICKER_TIMEOUT_MS = 120_000;
export type MediaToolchainIpcDependencies = {
  getMainWindow(): BrowserWindow | null;
  getClient(): MediaToolchainClient | null;
  showOpenDialog(window: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
};

/** All paths originate in main. A dialog never grants a later renderer/document authority. */
export function registerMediaToolchainHandlers(
  handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  dependencies: MediaToolchainIpcDependencies,
): void {
  let mutationBusy = false;
  let mutationGeneration = 0;
  let pendingSelection: {
    window: BrowserWindow;
    frame: IpcMainInvokeEvent["senderFrame"];
    client: MediaToolchainClient;
    cancelled: boolean;
    submitted: boolean;
  } | null = null;
  handle(MEDIA_TOOLCHAIN_CHANNELS.cancelSelection, async (event, ...args): Promise<MediaToolchainCancelResult> => {
    const window = dependencies.getMainWindow();
    const client = dependencies.getClient();
    const frame = event.senderFrame;
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() ||
        event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame ||
        frame.isDestroyed() || frame.detached || !client)
      throw new Error("Media toolchain cancel sender is not authorized");
    if (args.length !== 0) throw new Error("Media toolchain cancellation accepts no arguments");
    if (!pendingSelection || pendingSelection.window !== window ||
        pendingSelection.frame !== frame || pendingSelection.client !== client)
      return { kind: "NO_PENDING_SELECTION" };
    if (pendingSelection.submitted) return { kind: "ALREADY_SUBMITTED" };
    pendingSelection.cancelled = true;
    return { kind: "CANCELLED" };
  });
  for (const action of ["status", "select", "clear"] as const) {
    handle(
      MEDIA_TOOLCHAIN_CHANNELS[action],
      async (event, ...args): Promise<MediaToolchainSelectionResult> => {
        const window = dependencies.getMainWindow();
        const client = dependencies.getClient();
        const frame = event.senderFrame;
        const current = () =>
          window !== null &&
          dependencies.getMainWindow() === window &&
          !window.isDestroyed() &&
          !window.webContents.isDestroyed() &&
          event.sender === window.webContents &&
          frame !== null &&
          frame !== undefined &&
          event.senderFrame === frame &&
          frame === window.webContents.mainFrame &&
          !frame.isDestroyed() &&
          !frame.detached &&
          client !== null &&
          dependencies.getClient() === client;
        if (!current() || window === null || client === null || !frame)
          throw new Error("Media toolchain IPC sender is not authorized");
        if (args.length !== 0) throw new Error("Media toolchain IPC accepts no arguments");
        if (mutationBusy) return { kind: action === "select" ? "PICKER_BUSY" : "REMOTE_UNKNOWN" };

        const observedGeneration = mutationGeneration;
        let invalidated = false;
        const documentUrl = frame.url;
        const invalidate = () => {
          invalidated = true;
        };
        const navigate = (details: WebContentsDidStartNavigationEventParams) => {
          if (details.isMainFrame && !details.isSameDocument) invalidate();
        };
        const assertCurrent = () => {
          if (invalidated || !current() || frame.url !== documentUrl)
            throw new Error("Media toolchain IPC sender changed during operation");
        };
        window.on("closed", invalidate);
        window.webContents.on("destroyed", invalidate);
        window.webContents.on("render-process-gone", invalidate);
        window.webContents.on("did-start-navigation", navigate);
        let pickerSettled = true;
        let operationExited = false;
        let pickerTimer: ReturnType<typeof setTimeout> | undefined;
        if (action !== "status") {
          mutationBusy = true;
          mutationGeneration += 1;
        }
        try {
          if (action === "select") {
            const selection = { window, frame, client, cancelled: false, submitted: false };
            pendingSelection = selection;
            pickerSettled = false;
            const picker = Promise.resolve()
              .then(() => {
                assertCurrent();
                return dependencies.showOpenDialog(window, {
                  title: "选择已验证的 FFmpeg 工具目录（包含 ffmpeg.exe 和 ffprobe.exe）",
                  buttonLabel: "验证并使用此目录",
                  properties: ["openDirectory", "dontAddToRecent"],
                });
              })
              .finally(() => {
                pickerSettled = true;
                // A timeout must not allow a second native dialog while the first is still open.
                if (operationExited) {
                  mutationBusy = false;
                  if (pendingSelection === selection) pendingSelection = null;
                }
              });
            const timeout = new Promise<null>((resolve) => {
              pickerTimer = setTimeout(() => resolve(null), MEDIA_TOOLCHAIN_PICKER_TIMEOUT_MS);
            });
            let selected: OpenDialogReturnValue | null;
            try {
              selected = await Promise.race([picker, timeout]);
            } catch {
              assertCurrent();
              return { kind: "REMOTE_UNKNOWN" };
            }
            assertCurrent();
            if (selection.cancelled) return { kind: "PICKER_CANCELLED" };
            if (selected === null) return { kind: "REMOTE_UNKNOWN" };
            if (selected.canceled) return { kind: "PICKER_CANCELLED" };
            if (
              selected.filePaths.length !== 1 ||
              !isNativeMediaToolchainDirectory(selected.filePaths[0])
            )
              return { kind: "REMOTE_UNKNOWN" };
            selection.submitted = true;
            const result = await client.selectMediaToolchainDirectory(selected.filePaths[0]);
            assertCurrent();
            return result;
          }
          const result = await (action === "status"
            ? client.getMediaToolchainStatus()
            : client.clearMediaToolchain());
          assertCurrent();
          if (action === "status" && observedGeneration !== mutationGeneration)
            return { kind: "REMOTE_UNKNOWN" };
          return result;
        } finally {
          operationExited = true;
          if (pickerTimer !== undefined) clearTimeout(pickerTimer);
          if (action !== "status" && pickerSettled) mutationBusy = false;
          if (action === "select" && pickerSettled) pendingSelection = null;
          window.removeListener("closed", invalidate);
          window.webContents.removeListener("destroyed", invalidate);
          window.webContents.removeListener("render-process-gone", invalidate);
          window.webContents.removeListener("did-start-navigation", navigate);
        }
      },
    );
  }
}
