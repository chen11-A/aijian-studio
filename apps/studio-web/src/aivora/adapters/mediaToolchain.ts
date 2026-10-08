import {
  EXTERNAL_MEDIA_PROFILE,
  EXTERNAL_MEDIA_VERSION,
  type MediaToolchainGateway,
  type MediaToolchainStatus,
} from "../mediaToolchainContract";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  );
}
const statusKeys = [
  "schema_version",
  "state",
  "source",
  "profile_id",
  "version",
  "directory",
  "diagnostic",
  "can_probe",
  "can_preview",
  "can_draft_export",
  "formal_release_approved",
];
export function parseMediaToolchainStatus(result: unknown): MediaToolchainStatus | null {
  if (!record(result) || result.kind !== "STATUS" || !record(result.status)) return null;
  if (Object.keys(result).some((key) => key !== "kind" && key !== "status")) return null;
  const value = result.status;
  if (
    Object.keys(value).some((key) => !statusKeys.includes(key)) ||
    !statusKeys.every((key) => Object.hasOwn(value, key)) ||
    value.schema_version !== 1 ||
    value.formal_release_approved !== false ||
    typeof value.state !== "string" ||
    !["AVAILABLE", "NOT_CONFIGURED", "INVALID", "UNSUPPORTED"].includes(value.state) ||
    typeof value.source !== "string" ||
    !["EXTERNAL", "BUNDLED", "DEVELOPMENT_OVERRIDE", "DEVELOPMENT_LOCAL", "NONE"].includes(
      value.source,
    ) ||
    typeof value.diagnostic !== "string" ||
    value.diagnostic.length > 2048 ||
    [...value.diagnostic].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    ![value.profile_id, value.version].every((item) => item === null || text(item, 128)) ||
    (value.directory !== null && !text(value.directory, 32768)) ||
    ![value.can_probe, value.can_preview, value.can_draft_export].every(
      (item) => typeof item === "boolean",
    )
  )
    return null;
  if (
    value.source === "NONE" &&
    (value.profile_id !== null || value.version !== null || value.directory !== null)
  )
    return null;
  if (
    value.can_probe !== (value.state === "AVAILABLE") ||
    value.can_preview !== (value.state === "AVAILABLE") ||
    value.can_draft_export !== (value.state === "AVAILABLE") ||
    (value.state === "NOT_CONFIGURED" && value.source !== "NONE")
  )
    return null;
  if (
    value.state === "AVAILABLE" &&
    (value.source === "NONE" || !value.profile_id || !value.version || !value.directory)
  )
    return null;
  if (
    value.state === "AVAILABLE" &&
    value.source === "EXTERNAL" &&
    (value.profile_id !== EXTERNAL_MEDIA_PROFILE || value.version !== EXTERNAL_MEDIA_VERSION)
  )
    return null;
  return { ...value } as MediaToolchainStatus;
}

const gateways = new WeakMap<object, MediaToolchainGateway>();
/** Presence permits only a status request. It never implies usable media tools. */
export function desktopMediaToolchain(
  bridge: Partial<MediaToolchainGateway>,
): MediaToolchainGateway | undefined {
  if (
    typeof bridge.getMediaToolchainStatus !== "function" ||
    typeof bridge.selectMediaToolchain !== "function" ||
    typeof bridge.clearMediaToolchain !== "function"
  )
    return undefined;
  let gateway = gateways.get(bridge);
  if (!gateway) {
    gateway = {
      getMediaToolchainStatus: () => bridge.getMediaToolchainStatus!(),
      selectMediaToolchain: () => bridge.selectMediaToolchain!(),
      clearMediaToolchain: () => bridge.clearMediaToolchain!(),
      cancelMediaToolchainSelection:
        typeof bridge.cancelMediaToolchainSelection === "function"
          ? () => bridge.cancelMediaToolchainSelection!()
          : undefined,
    };
    gateways.set(bridge, gateway);
  }
  return gateway;
}

export type MediaToolchainSnapshot = {
  status: MediaToolchainStatus | null;
  phase: "LOADING" | "READY" | "UNKNOWN" | "UNAVAILABLE";
  busy: boolean;
  notice: string;
};
export function createMediaToolchainStore(gateway?: MediaToolchainGateway) {
  let snapshot: MediaToolchainSnapshot = {
    status: null,
    phase: gateway ? "LOADING" : "UNAVAILABLE",
    busy: false,
    notice: "",
  };
  const listeners = new Set<() => void>();
  let operation: Promise<void> | undefined;
  type Selection = {
    owner: symbol;
    abandoned: boolean;
    started: boolean;
    cancellation?: Promise<void>;
    notice: string;
  };
  let selection: Selection | undefined;

  function publish(next: MediaToolchainSnapshot) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  async function readback(notice = "") {
    const result = await Promise.resolve()
      .then(() => gateway!.getMediaToolchainStatus())
      .catch(() => null);
    const status = parseMediaToolchainStatus(result);
    publish({
      status,
      phase: status ? "READY" : "UNKNOWN",
      busy: false,
      notice: status ? notice : "媒体工具状态未核实；请重新读取，暂不开始新的探测或编码。",
    });
  }
  function refresh() {
    if (!gateway) return Promise.resolve();
    if (operation) return operation;
    publish({ ...snapshot, status: null, phase: "LOADING", busy: true });
    operation = readback().finally(() => {
      operation = undefined;
    });
    return operation;
  }
  function change(action: "select" | "clear", owner?: symbol) {
    if (!gateway || operation || snapshot.phase !== "READY") return Promise.resolve();
    const intent: Selection | undefined =
      action === "select"
        ? {
            owner: owner ?? Symbol("media-selection"),
            abandoned: false,
            started: false,
            notice: "已离开工具选择界面，正在重新读取当前配置。",
          }
        : undefined;
    selection = intent;
    publish({ ...snapshot, busy: true, notice: "正在核对本地媒体工具…" });
    operation = (async () => {
      const result = await Promise.resolve()
        .then(() => {
          if (intent?.abandoned) return { kind: "PICKER_CANCELLED" as const };
          if (intent) intent.started = true;
          return action === "select"
            ? gateway.selectMediaToolchain()
            : gateway.clearMediaToolchain();
        })
        .catch(() => null);
      if (intent?.abandoned) {
        await intent.cancellation;
        await readback(intent.notice);
        return;
      }
      const status = parseMediaToolchainStatus(result);
      if (status) {
        publish({
          status,
          phase: "READY",
          busy: false,
          notice:
            status.state === "INVALID"
              ? "工具未通过校验；请查看原因。原配置以重新读取结果为准。"
              : action === "clear"
                ? "已读取移除配置后的状态。工具文件不会被删除。"
                : "已取得本机校验结果。仅可用于本地 DRAFT。",
        });
        return;
      }
      const cancelled = result?.kind === "PICKER_CANCELLED";
      const busy = result?.kind === "PICKER_BUSY";
      publish({
        status: null,
        phase: "LOADING",
        busy: true,
        notice: cancelled
          ? "已取消选择，正在读取现有配置。"
          : busy
            ? "文件夹窗口已打开，正在读取现有配置。"
            : "操作结果未知，正在只读核对；不会重复提交。",
      });
      await readback(
        cancelled
          ? "已取消选择，现有配置已重新读取。"
          : busy
            ? "文件夹窗口已打开，请完成选择后重新读取。"
            : "已重新读取当前配置；先前操作结果无法单独确认，未重复提交。",
      );
    })().finally(() => {
      if (selection === intent) selection = undefined;
      operation = undefined;
    });
    return operation;
  }
  function cancelSelection(owner: symbol) {
    const intent = selection;
    if (!intent || intent.owner !== owner || intent.abandoned) return Promise.resolve();
    intent.abandoned = true;
    if (!intent.started) return Promise.resolve();
    intent.cancellation = Promise.resolve()
      .then(async () => {
        if (selection !== intent) return;
        const result = await gateway?.cancelMediaToolchainSelection?.().catch(() => null);
        intent.notice =
          result?.kind === "CANCELLED"
            ? "已取消尚未提交的工具选择；系统文件夹窗口需自行关闭。现有配置已重新读取。"
            : result?.kind === "ALREADY_SUBMITTED"
              ? "工具配置已进入提交阶段，无法撤回；已重新读取当前配置。"
              : "选择结果无法确认已取消；已重新读取当前配置，不会重复提交。";
      })
      .catch(() => {
        intent.notice = "取消结果尚未确认；已重新读取当前配置，不会重复提交。";
      });
    return intent.cancellation;
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    select: (owner?: symbol) => change("select", owner),
    cancelSelection,
    clear: () => change("clear"),
  };
}
export type MediaToolchainStore = ReturnType<typeof createMediaToolchainStore>;
export const MEDIA_TOOLCHAIN_SOURCE_LABELS: Record<MediaToolchainStatus["source"], string> = {
  EXTERNAL: "外部工具",
  BUNDLED: "随包工具",
  DEVELOPMENT_OVERRIDE: "开发环境指定工具",
  DEVELOPMENT_LOCAL: "开发环境本地工具",
  NONE: "未配置",
};
export function mediaToolchainMessage(snapshot: MediaToolchainSnapshot): string {
  if (snapshot.phase === "UNAVAILABLE")
    return "当前环境无法读取本机媒体工具能力，请使用支持此功能的桌面版本。";
  if (snapshot.phase === "LOADING" || snapshot.busy)
    return "正在核对本地媒体工具，新的探测与编码暂不可用。";
  if (snapshot.phase === "UNKNOWN" || !snapshot.status)
    return "媒体工具状态未核实，请在用户设置中重新读取。";
  const labels = {
    AVAILABLE:
      snapshot.status.source === "EXTERNAL"
        ? "已验证外部媒体工具 · 仅供本地 DRAFT"
        : `${MEDIA_TOOLCHAIN_SOURCE_LABELS[snapshot.status.source]}已核验 · 仅供 DRAFT`,
    NOT_CONFIGURED: "尚未配置媒体工具。可在用户设置中选择已下载的受支持工具。",
    INVALID: "媒体工具未通过校验，请在用户设置中核对或重新选择。",
    UNSUPPORTED: "此环境不支持选择外部媒体工具，新的探测与编码不可用。",
  };
  return labels[snapshot.status.state];
}
