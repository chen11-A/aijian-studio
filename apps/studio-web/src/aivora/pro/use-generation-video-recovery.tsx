import { useEffect, useRef, useState } from "react";
import type {
  GenerationVideoRecoveryFailure,
  RecoveredGenerationVideoFile,
} from "@aijian/contracts/generation-video-recovery";
import type { FilmProject } from "../film/project";
import {
  GenerationVideoRecoveryView,
  type RecoveryViewState,
  type RecoveryRowView,
} from "./GenerationVideoRecoveryView";

function safeFile(
  file: RecoveredGenerationVideoFile | undefined,
): file is RecoveredGenerationVideoFile {
  return (
    !!file &&
    typeof file.fileName === "string" &&
    file.fileName.length > 0 &&
    file.fileName.length <= 255 &&
    !/[\\/]/.test(file.fileName) &&
    !Array.from(file.fileName).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) &&
    /^[a-f0-9]{64}$/.test(file.sha256) &&
    Number.isSafeInteger(file.bytes) &&
    file.bytes > 0
  );
}
const sameFile = (a: RecoveredGenerationVideoFile, b: RecoveredGenerationVideoFile) =>
  a.fileName === b.fileName && a.sha256 === b.sha256 && a.bytes === b.bytes;
function failure(code: GenerationVideoRecoveryFailure["code"], saving = false): string {
  switch (code) {
    case "ACCOUNT_UNAVAILABLE":
      return "当前登录身份无法核对这些记录，请先核对登录状态。";
    case "NOT_FOUND":
      return "这条记录没有找到，请重新读取列表。";
    case "BUSY":
      return "这条记录正在处理，请稍后手动重新核对。";
    case "WRITE_UNCONFIRMED":
      return saving
        ? "保存结果尚未确认，请先核对已选择的保存位置，不要重复另存。"
        : "原素材的找回结果尚未确认，请重新读取列表后核对，不要重新提交生成。";
    default:
      return "当前暂时无法核对，请重新读取列表。";
  }
}
const unknownCopy = {
  WAITING: "原任务仍未确认完成，可以稍后手动核对。",
  UNREACHABLE: "暂时无法联系原任务，是否完成仍未确认。",
  NO_VALID_VIDEO: "尚未读到可核验的视频素材。",
  PROVIDER_FAILED: "原任务返回失败，本次没有找回视频素材。",
} as const;

export function useGenerationVideoRecovery(
  film: FilmProject | null,
  current: () => FilmProject | null,
  account: { state: string; label: string },
) {
  const live = useRef({ current, account });
  live.current = { current, account };
  const epoch = useRef(0),
    mounted = useRef(true),
    working = useRef(false);
  const target = useRef<{ filmId: string; projectId: string; account: string } | null>(null);
  const rows = useRef<RecoveryRowView[]>([]);
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [state, setState] = useState<RecoveryViewState>({ kind: "loading" });
  const accountKey = () => JSON.stringify([live.current.account.state, live.current.account.label]);
  function close() {
    epoch.current++;
    target.current = null;
    working.current = false;
    rows.current = [];
    setOpened(false);
    setBusy(false);
  }
  useEffect(() => {
    mounted.current = true;
    // Invalidate immediately, even before the asynchronous account status hooks receive the new identity.
    const changed = () => close();
    window.addEventListener("aivora-grok-changed", changed);
    return () => {
      mounted.current = false;
      epoch.current++;
      window.removeEventListener("aivora-grok-changed", changed);
    };
  }, []);
  useEffect(() => {
    const captured = target.current;
    if (
      captured &&
      (film?.id !== captured.filmId ||
        film?.backendProjectId !== captured.projectId ||
        accountKey() !== captured.account)
    )
      close();
  }, [film?.id, film?.backendProjectId, account.state, account.label]);
  function valid(version: number) {
    const captured = target.current,
      actual = live.current.current();
    return (
      mounted.current &&
      epoch.current === version &&
      !!captured &&
      actual?.id === captured.filmId &&
      actual.backendProjectId === captured.projectId &&
      accountKey() === captured.account
    );
  }
  async function read() {
    const captured = target.current,
      version = ++epoch.current;
    if (!captured) return;
    working.current = true;
    setBusy(true);
    rows.current = [];
    setState({ kind: "loading" });
    try {
      const result = await window.aijian!.listGenerationVideoRecoveries!(captured.projectId);
      if (!valid(version)) return;
      if (result.kind === "FAILED") {
        setState({ kind: "error", message: failure(result.code) });
        return;
      }
      if (
        result.kind !== "ATTEMPTS" ||
        !Array.isArray(result.items) ||
        result.items.length > 100 ||
        typeof result.hasMore !== "boolean" ||
        result.items.some(
          (item) =>
            !item ||
            typeof item.attemptId !== "string" ||
            item.attemptId.length === 0 ||
            item.attemptId.length > 256 ||
            (item.state !== "UNKNOWN" && item.state !== "RECOVERED") ||
            (item.state === "RECOVERED" ? !safeFile(item.file) : item.file !== undefined),
        ) ||
        new Set(result.items.map((item) => item.attemptId)).size !== result.items.length
      ) {
        setState({ kind: "error", message: "记录暂时无法核验，请重新读取列表。" });
        return;
      }
      rows.current = result.items.map((item) => ({ key: item.attemptId, file: item.file }));
      setState({ kind: "ready", rows: rows.current, hasMore: result.hasMore });
    } catch {
      if (valid(version))
        setState({ kind: "error", message: "记录暂时没有读到，请重新读取列表。" });
    } finally {
      if (valid(version)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  function open() {
    close();
    setOpened(true);
    const actual = live.current.current();
    if (
      !window.aijian?.listGenerationVideoRecoveries ||
      !window.aijian.recoverGenerationVideo ||
      !window.aijian.saveRecoveredGenerationVideo
    ) {
      setState({ kind: "unsupported" });
      return;
    }
    if (!actual || !/^prj_[0-9a-f]{32}$/.test(actual.backendProjectId)) {
      setState({ kind: "error", message: "本集尚未关联可核对的作品，不能读取原任务。" });
      return;
    }
    target.current = {
      filmId: actual.id,
      projectId: actual.backendProjectId,
      account: accountKey(),
    };
    void read();
  }
  async function run(key: string, save: boolean, version: number) {
    const captured = target.current,
      row = rows.current.find((item) => item.key === key);
    if (
      !captured ||
      !row ||
      working.current ||
      !valid(version) ||
      save !== !!row.file ||
      row.needsRefresh
    )
      return;
    working.current = true;
    setBusy(true);
    let message: string | undefined,
      file = row.file,
      saved = false,
      needsRefresh = false;
    try {
      if (save) {
        const result = await window.aijian!.saveRecoveredGenerationVideo!(captured.projectId, key);
        if (!valid(version)) return;
        if (result.kind === "SAVED" && safeFile(result.file) && file && sameFile(result.file, file))
          saved = true;
        else if (result.kind === "CANCELLED") message = "已取消另存，当前镜头没有修改。";
        else {
          needsRefresh = result.kind !== "FAILED" || result.code === "WRITE_UNCONFIRMED";
          message =
            result.kind === "FAILED"
              ? failure(result.code, true)
              : "保存结果尚未确认，请先核对保存位置，不要重复另存。";
        }
      } else {
        const result = await window.aijian!.recoverGenerationVideo!(captured.projectId, key);
        if (!valid(version)) return;
        if (result.kind === "RECOVERED" && result.attemptId === key && safeFile(result.file))
          file = result.file;
        else if (
          result.kind === "UNKNOWN" &&
          result.attemptId === key &&
          Object.hasOwn(unknownCopy, result.reason)
        )
          message = unknownCopy[result.reason];
        else {
          needsRefresh = result.kind !== "FAILED" || result.code === "WRITE_UNCONFIRMED";
          message =
            result.kind === "FAILED"
              ? failure(result.code)
              : "原素材暂时无法核验，请重新读取列表。";
        }
      }
      if (!valid(version)) return;
      rows.current = rows.current.map((item) =>
        item === row ? { ...item, file, saved, message, needsRefresh } : item,
      );
      setState((previous) =>
        previous.kind === "ready" ? { ...previous, rows: rows.current } : previous,
      );
    } catch {
      if (valid(version)) {
        rows.current = rows.current.map((item) =>
          item === row
            ? {
                ...item,
                needsRefresh: true,
                message: save
                  ? "保存结果尚未确认，请先核对保存位置，不要重复另存。"
                  : "原任务暂时没有读到，是否完成仍未确认。",
              }
            : item,
        );
        setState((previous) =>
          previous.kind === "ready" ? { ...previous, rows: rows.current } : previous,
        );
      }
    } finally {
      if (valid(version)) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  const version = epoch.current;
  return {
    open,
    view: opened ? (
      <GenerationVideoRecoveryView
        state={state}
        busy={busy}
        canRefresh={!!target.current && !!window.aijian?.listGenerationVideoRecoveries}
        onClose={() => {
          if (version === epoch.current) close();
        }}
        onRefresh={() => {
          if (valid(version) && !working.current) void read();
        }}
        onRecover={(key) => void run(key, false, version)}
        onSave={(key) => void run(key, true, version)}
      />
    ) : null,
  };
}
