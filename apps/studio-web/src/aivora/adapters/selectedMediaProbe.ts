import {
  validProbeScope,
  probeScopeKey,
  definite,
  type MediaProbeScope,
} from "./selectedMediaProbeScope";

export type SelectedProbeSnapshot<E> = {
  phase: "LOADING" | "FOUND" | "NOT_FOUND" | "ERROR" | "UNKNOWN" | "UNAVAILABLE";
  evidence: E | null;
  busy: boolean;
  uncertain: boolean;
  notFound: boolean;
  notice: string;
};
type ProbeResult = { kind: string; receipt?: unknown };
export type SelectedProbePorts = {
  read(p: string, a: string, v: string): Promise<ProbeResult>;
  write(p: string, a: string, v: string): Promise<ProbeResult>;
};
/** Shared recovery mechanism; evidence remains in the existing immutable backend table. */
export function createSelectedProbeStore<E extends { id: string; probe_sha256: string }>(
  input: MediaProbeScope,
  gateway: SelectedProbePorts | undefined,
  storage: Storage | undefined,
  parseReceipt: (value: unknown, scope: MediaProbeScope) => E | null | Promise<E | null>,
  namespace: "media-probe" | "audio-probe",
  label: "视频" | "音频",
) {
  const scope = Object.freeze({ ...input });
  const key = `aivora:${namespace}:pending:${probeScopeKey(scope)}`;
  const usable = !!gateway && validProbeScope(scope);
  let uncertain = true;
  try {
    uncertain = !storage || storage.getItem(key) !== null;
  } catch {
    /* fail closed */
  }
  let snapshot: SelectedProbeSnapshot<E> = {
    phase: usable ? "LOADING" : "UNAVAILABLE",
    evidence: null,
    busy: false,
    uncertain,
    notFound: false,
    notice: "",
  };
  let operation: Promise<void> | undefined;
  let expected: E | null = null;
  const listeners = new Set<() => void>();
  function publish(next: SelectedProbeSnapshot<E>) {
    snapshot = next;
    listeners.forEach((listener) => listener());
  }
  function markPending() {
    try {
      if (!storage || storage.getItem(key) !== null) return false;
      storage.setItem(key, "pending");
      return storage.getItem(key) === "pending";
    } catch {
      return false;
    }
  }
  function clearPending() {
    try {
      if (!storage) return false;
      storage.removeItem(key);
      return storage.getItem(key) === null;
    } catch {
      return false;
    }
  }
  async function readback() {
    const result = await Promise.resolve()
      .then(() => gateway!.read(scope.projectId, scope.assetId, scope.versionId))
      .catch(() => null);
    const evidence = result?.kind === "FOUND" ? await parseReceipt(result.receipt, scope) : null;
    if (
      evidence &&
      (!expected ||
        (evidence.id === expected.id && evidence.probe_sha256 === expected.probe_sha256))
    ) {
      uncertain = !clearPending();
      expected = null;
      publish({
        phase: "FOUND",
        evidence,
        uncertain,
        busy: false,
        notFound: false,
        notice: `已读回此${label}版本的真实探测记录；不代表权利或正式发布审核通过。`,
      });
      return;
    }
    const notFound = definite(result) && result.status === 404 && result.code === "PROBE_NOT_FOUND";
    publish({
      phase: uncertain ? "UNKNOWN" : notFound ? "NOT_FOUND" : "ERROR",
      evidence: null,
      busy: false,
      uncertain,
      notFound,
      notice: uncertain
        ? "上次探测结果仍待核对，暂不能重复开始。未查到记录不代表旧请求已结束。"
        : notFound
          ? `此${label}版本尚无探测记录。`
          : result?.kind === "FOUND"
            ? "探测记录的版本、哈希或结构不匹配，未采纳。"
            : definite(result)
              ? `探测记录读取被拒绝：${result.status} / ${result.code}`
              : "探测记录尚未可靠读回，请重新读取。",
    });
  }
  function refresh() {
    if (!usable) return Promise.resolve();
    if (operation) return operation;
    publish({ ...snapshot, phase: "LOADING", busy: true, evidence: null });
    operation = readback().finally(() => {
      operation = undefined;
    });
    return operation;
  }
  function probe() {
    if (!usable || operation || uncertain || snapshot.phase !== "NOT_FOUND")
      return Promise.resolve();
    if (!markPending()) {
      uncertain = true;
      publish({
        ...snapshot,
        phase: "UNKNOWN",
        uncertain: true,
        notice: "无法保存探测恢复记录，未开始探测。",
      });
      return Promise.resolve();
    }
    uncertain = true;
    publish({
      ...snapshot,
      busy: true,
      uncertain: true,
      notFound: false,
      notice: `正在探测选中${label}版本，请勿重复提交…`,
    });
    operation = (async () => {
      const result = await Promise.resolve()
        .then(() => gateway!.write(scope.projectId, scope.assetId, scope.versionId))
        .catch(() => null);
      if (definite(result)) {
        uncertain = !clearPending();
        publish({
          phase: uncertain ? "UNKNOWN" : "ERROR",
          evidence: null,
          busy: false,
          uncertain,
          notFound: false,
          notice: `探测被拒绝：${result.status} / ${result.code}。请核对后重新读取记录。`,
        });
        return;
      }
      expected = result?.kind === "PROBED" ? await parseReceipt(result.receipt, scope) : null;
      publish({
        ...snapshot,
        phase: "LOADING",
        busy: true,
        notice: expected
          ? "探测已返回，正在读取持久记录…"
          : "探测结果未知，正在只读核对同一版本；不会重复探测。",
      });
      await readback();
    })().finally(() => {
      operation = undefined;
    });
    return operation;
  }
  function acknowledgeFinished() {
    if (operation || !uncertain || !snapshot.notFound || !clearPending()) return;
    uncertain = false;
    expected = null;
    publish({
      ...snapshot,
      phase: "NOT_FOUND",
      uncertain: false,
      notice: "已按你的确认解除重试锁定；仍需再次明确点击开始探测。",
    });
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
    probe,
    acknowledgeFinished,
  };
}
