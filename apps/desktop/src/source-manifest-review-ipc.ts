import type {
  BrowserWindow,
  IpcMainInvokeEvent,
  MessageBoxOptions,
  MessageBoxReturnValue,
  WebContentsDidStartNavigationEventParams,
} from "electron";
import { hasOnlyKeys, isRecord } from "./api-contract-guards";
import type {
  createSourceManifestReviewController,
  SourceManifestReviewInput,
} from "./source-manifest-review";

type Controller = ReturnType<typeof createSourceManifestReviewController>;
export type SourceManifestReviewIpcDependencies = {
  getMainWindow: () => BrowserWindow | null;
  getController: () => Controller | null;
  showMessageBox: (
    window: BrowserWindow,
    options: MessageBoxOptions,
  ) => Promise<MessageBoxReturnValue>;
};

function snapshotInput(
  intent: SourceManifestReviewInput["intent"],
  args: unknown[],
): SourceManifestReviewInput {
  const value = args[0];
  const keys = ["project_id", "version_id", "content_hash", "expected_revision"];
  if (intent === "confirm_baseline") keys.push("rationale");
  if (
    args.length !== 1 ||
    !isRecord(value) ||
    !hasOnlyKeys(value, keys) ||
    !keys.every((key) => Object.hasOwn(value, key)) ||
    typeof value.project_id !== "string" ||
    !/^prj_[0-9a-f]{32}$/.test(value.project_id) ||
    typeof value.version_id !== "string" ||
    !/^ver_[0-9a-f]{32}$/.test(value.version_id) ||
    typeof value.content_hash !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(value.content_hash) ||
    typeof value.expected_revision !== "number" ||
    !Number.isSafeInteger(value.expected_revision) ||
    value.expected_revision < 1 ||
    value.expected_revision >= Number.MAX_SAFE_INTEGER ||
    (intent === "confirm_baseline" &&
      (typeof value.rationale !== "string" ||
        value.rationale !== value.rationale.trim() ||
        value.rationale.length === 0 ||
        [...value.rationale].length > 1000))
  ) {
    throw new Error("Source manifest IPC requires exact canonical arguments");
  }
  const identity = {
    project_id: value.project_id,
    version_id: value.version_id,
    content_hash: value.content_hash,
    expected_revision: value.expected_revision,
  };
  return intent === "confirm_baseline"
    ? { ...identity, intent, rationale: value.rationale as string }
    : { ...identity, intent };
}

export function registerSourceManifestReviewHandlers(
  handle: (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  dependencies: SourceManifestReviewIpcDependencies,
): void {
  const register = (channel: string, intent: SourceManifestReviewInput["intent"]) => {
    handle(channel, async (event, ...args) => {
      const origin = dependencies.getMainWindow();
      const frame = event.senderFrame;
      const isCurrent = () =>
        origin !== null &&
        dependencies.getMainWindow() === origin &&
        !origin.isDestroyed() &&
        !origin.webContents.isDestroyed() &&
        event.sender === origin.webContents &&
        frame !== null &&
        frame !== undefined &&
        !frame.isDestroyed() &&
        !frame.detached &&
        frame === origin.webContents.mainFrame;
      if (!isCurrent() || origin === null || !frame) {
        throw new Error("Local API is not available");
      }
      const input = snapshotInput(intent, args);
      const controller = dependencies.getController();
      if (controller === null) throw new Error("Local API is not available");

      const documentUrl = frame.url;
      const operation = new AbortController();
      const cancel = () => operation.abort();
      const navigate = (details: WebContentsDidStartNavigationEventParams) => {
        if (details.isMainFrame && !details.isSameDocument) cancel();
      };
      const stillValid = () =>
        isCurrent() && frame.url === documentUrl && !operation.signal.aborted;
      origin.on("closed", cancel);
      origin.webContents.on("destroyed", cancel);
      origin.webContents.on("render-process-gone", cancel);
      origin.webContents.on("did-start-navigation", navigate);
      try {
        if (!stillValid()) cancel();
        return await controller.run(input, {
          signal: operation.signal,
          confirm: async (data, signal) => {
            if (signal.aborted || !stillValid()) return false;
            try {
              const answer = await dependencies.showMessageBox(origin, {
                type: "warning",
                title: data.title,
                message: data.description,
                detail: [
                  `项目：${data.project_id}`,
                  `版本：${data.version_id}`,
                  `来源内容 hash：${data.content_hash}`,
                  `Gate：${data.gate}；动作：${data.action}`,
                  `当前修订：${data.head_revision}；评审证据修订：${data.review_evidence_revision}`,
                  `报告 ID：${data.report_id ?? "无"}`,
                  `报告 hash：${data.report_hash ?? "无"}`,
                  `理由：${data.rationale ?? "无"}`,
                  data.account_notice,
                ].join("\n"),
                buttons: ["取消", `确认${data.title}`],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
                signal,
              });
              return answer?.response === 1 && !signal.aborted && stillValid();
            } catch {
              return false;
            }
          },
        });
      } catch {
        throw new Error("Local API is not available");
      } finally {
        operation.abort();
        origin.removeListener("closed", cancel);
        origin.webContents.removeListener("destroyed", cancel);
        origin.webContents.removeListener("render-process-gone", cancel);
        origin.webContents.removeListener("did-start-navigation", navigate);
      }
    });
  };
  register("source-manifest:submit", "submit");
  register("source-manifest:confirm-baseline", "confirm_baseline");
  register("source-manifest:copy-draft", "copy_draft");
}
