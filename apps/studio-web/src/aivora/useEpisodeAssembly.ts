import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftExportGateway } from "./adapters/draftExport";
import type { AssemblyScriptGateway } from "./useAssemblyScriptSources";
import { readAssetLibrary } from "./adapters/assetLibrary";
import type { AssetLibraryGateway, MediaAsset } from "./adapters/assetLibrary";
import { assemblyEditProblem, emptyAssembly } from "./adapters/assemblyEditing";
import { parseAssemblyReceipt } from "./adapters/episodeMediaAssembly";
import type {
  AssemblyContent,
  AssemblyVersion,
  EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";

export type EpisodeAssemblyProps = {
  projectId: string;
  episodeId: string;
  assets: AssetLibraryGateway | undefined;
  assembly: EpisodeMediaAssemblyGateway | undefined;
  setNavigationGuard: (guard: (() => boolean) | null) => void;
  hasPendingInput?: boolean;
  exports?: DraftExportGateway;
  script?: AssemblyScriptGateway;
};
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
function pending(scope: string): string | null | undefined {
  try {
    return window.localStorage.getItem(`aivora:episode-media-assembly:pending:${scope}`);
  } catch {
    return undefined;
  }
}
function clear(scope: string) {
  try {
    window.localStorage.removeItem(`aivora:episode-media-assembly:pending:${scope}`);
  } catch {
    /* Keep writes locked when storage is unavailable. */
  }
}
function error(kind: string, status?: number, code?: string) {
  return kind === "DEFINITE_SERVER_ERROR"
    ? `装配请求被拒绝：${status} / ${code}`
    : "结果未知；请重新读取核对，不要重复提交。";
}

/** Saved head, pending write recovery, and bounded local edit history share one episode scope. */
export function useEpisodeAssembly({
  projectId,
  episodeId,
  assets,
  assembly,
  setNavigationGuard,
  hasPendingInput = false,
}: EpisodeAssemblyProps) {
  const scope = `${projectId}:${episodeId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const [library, setLibrary] = useState<MediaAsset[] | null>(null);
  const [version, setVersion] = useState<AssemblyVersion | null>(null);
  const [content, setContent] = useState(() => emptyAssembly(projectId, episodeId));
  const [history, setHistory] = useState<{ past: AssemblyContent[]; future: AssemblyContent[] }>({
    past: [],
    future: [],
  });
  const [busy, setBusy] = useState(false);
  const [reliable, setReliable] = useState(false);
  const [writeUnknown, setWriteUnknown] = useState(false);
  const [notice, setNotice] = useState("");
  const dirty =
    hasPendingInput ||
    canonical(content) !== canonical(version?.content ?? emptyAssembly(projectId, episodeId));
  const locked = busy || !reliable || writeUnknown;
  const leaveState = useRef({ dirty, busy, version, writeUnknown });
  leaveState.current = { dirty, busy, version, writeUnknown };
  useEffect(() => {
    setNavigationGuard(() => {
      const current = leaveState.current;
      if (current.busy || inFlight.current) {
        setNotice("正在读取或保存剪辑，请等待结果后再切换页面、作品或剧集。");
        return false;
      }
      const unresolved = current.writeUnknown || pending(scope) !== null;
      if (!current.dirty && !unresolved) return true;
      if (
        !window.confirm(
          unresolved
            ? "这次剪辑保存的结果还待核对，恢复记录会保留。离开此页吗？"
            : "当前剪辑有未保存的修改。放弃修改并离开吗？",
        )
      )
        return false;
      if (!unresolved) {
        leaveState.current.dirty = false;
        setContent(current.version?.content ?? emptyAssembly(projectId, episodeId));
        setHistory({ past: [], future: [] });
      }
      return true;
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = leaveState.current;
      if (
        !current.dirty &&
        !current.busy &&
        !inFlight.current &&
        !current.writeUnknown &&
        pending(scope) === null
      )
        return;
      event.preventDefault();
      event.returnValue = "";
      setNotice(
        current.busy || inFlight.current
          ? "正在读取或保存剪辑，已阻止关闭。请等待核对完成后再关闭软件。"
          : current.writeUnknown || pending(scope) !== null
            ? "剪辑保存结果尚未核对，已阻止关闭。请先重新读取核对，恢复记录仍保留。"
            : "剪辑有未保存修改，已阻止关闭。请先保存，或离开本页时明确放弃修改。",
      );
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      setNavigationGuard(null);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [projectId, episodeId, scope, setNavigationGuard]);
  const load = useCallback(
    async (mode: "initial" | "reload" | "readback" = "reload") => {
      if (inFlight.current && mode !== "readback") return;
      if (
        mode === "reload" &&
        leaveState.current.dirty &&
        pending(scope) === null &&
        !window.confirm("重新读取会放弃当前未保存的剪辑修改。继续吗？")
      )
        return;
      const request = ++epoch.current;
      inFlight.current = true;
      setBusy(true);
      setReliable(false);
      setWriteUnknown(pending(scope) !== null);
      const [assetState, result] = await Promise.all([
        readAssetLibrary(assets, projectId),
        assembly
          ?.readLatest(projectId, episodeId)
          .catch(() => ({ kind: "REMOTE_UNKNOWN" as const })),
      ]);
      if (currentScope.current !== scope || epoch.current !== request) return;
      inFlight.current = false;
      setBusy(false);
      setLibrary(assetState.kind === "READY" ? assetState.assets : null);
      if (!result) {
        setNotice("当前桌面版本没有集级媒体装配读写接口。");
        return;
      }
      if (result.kind === "NOT_FOUND") {
        setVersion(null);
        if (pending(scope) === null) {
          setContent(emptyAssembly(projectId, episodeId));
          setHistory({ past: [], future: [] });
        }
        setReliable(true);
        setNotice(
          pending(scope) === null
            ? "从项目素材库选择真实视频、图片或音频，开始本集剪辑草稿。"
            : "先前保存结果仍未知；已锁定再次保存。",
        );
        return;
      }
      if (result.kind !== "FOUND") {
        setNotice(
          error(
            result.kind,
            result.kind === "DEFINITE_SERVER_ERROR" ? result.status : undefined,
            result.kind === "DEFINITE_SERVER_ERROR" ? result.code : undefined,
          ),
        );
        return;
      }
      const read = parseAssemblyReceipt(result.receipt, projectId, episodeId);
      if (!read) {
        setNotice("装配身份或轨道结构不符；未启用编辑和播放。");
        return;
      }
      const intent = pending(scope);
      if (
        intent !== null &&
        intent !== undefined &&
        canonical({
          content: read.content,
          parentVersionId: read.parent_version_id,
          expectedRevision: read.parent_version_id === null ? null : read.head_revision - 1,
        }) === intent
      )
        clear(scope);
      setVersion(read);
      if (pending(scope) === null) {
        setContent(read.content);
        setHistory({ past: [], future: [] });
      }
      setReliable(true);
      setWriteUnknown(pending(scope) !== null);
      setNotice(
        pending(scope) === null
          ? "已从项目重新读回装配版本。"
          : "先前写入尚未核实；已锁定保存，请保留当前记录。",
      );
    },
    [projectId, episodeId, scope, assets, assembly],
  );
  useEffect(() => {
    setLibrary(null);
    setVersion(null);
    setContent(emptyAssembly(projectId, episodeId));
    setHistory({ past: [], future: [] });
    setNotice("");
    void load("initial");
    return () => {
      epoch.current += 1;
      inFlight.current = false;
    };
  }, [load, projectId, episodeId]);

  function edit(next: AssemblyContent) {
    if (locked || inFlight.current) return false;
    const problem = assemblyEditProblem(next);
    if (problem) {
      setNotice(problem);
      return false;
    }
    if (canonical(next) === canonical(content)) return false;
    setHistory((old) => ({ past: [...old.past.slice(-49), content], future: [] }));
    setContent(next);
    setNotice("有未保存的剪辑修改。");
    return true;
  }
  function undo(redo = false) {
    if (locked || inFlight.current) return;
    const next = redo ? history.future[0] : history.past.at(-1);
    if (!next) return;
    setHistory(
      redo
        ? { past: [...history.past, content], future: history.future.slice(1) }
        : { past: history.past.slice(0, -1), future: [content, ...history.future] },
    );
    setContent(next);
    setNotice(redo ? "已重做本地修改。" : "已撤销本地修改。");
  }
  async function save() {
    if (
      !assembly ||
      hasPendingInput ||
      locked ||
      inFlight.current ||
      !dirty ||
      !content.visual_segments.length ||
      assemblyEditProblem(content) ||
      pending(scope) !== null
    )
      return;
    const intent = canonical({
      content,
      parentVersionId: version?.version_id ?? null,
      expectedRevision: version?.head_revision ?? null,
    });
    try {
      window.localStorage.setItem(`aivora:episode-media-assembly:pending:${scope}`, intent);
    } catch {
      /* Fail closed below. */
    }
    if (pending(scope) !== intent) {
      setWriteUnknown(true);
      setNotice("无法持久保存写入记录；未提交版本。");
      return;
    }
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    const result = await assembly
      .createVersion(projectId, episodeId, {
        content,
        parent_version_id: version?.version_id ?? null,
        expected_revision: version?.head_revision ?? null,
        change_summary: "更新本地媒体集级剪辑草稿",
      })
      .catch(() => ({ kind: "REMOTE_UNKNOWN" as const }));
    if (currentScope.current !== scope || epoch.current !== request) return;
    setReliable(false);
    if (result.kind !== "CREATED") {
      inFlight.current = false;
      setBusy(false);
      if (result.kind === "DEFINITE_SERVER_ERROR" && result.status < 500) clear(scope);
      setWriteUnknown(pending(scope) !== null);
      setNotice(
        error(
          result.kind,
          result.kind === "DEFINITE_SERVER_ERROR" ? result.status : undefined,
          result.kind === "DEFINITE_SERVER_ERROR" ? result.code : undefined,
        ),
      );
      return;
    }
    const saved = parseAssemblyReceipt(result.receipt, projectId, episodeId);
    if (
      !saved ||
      canonical(saved.content) !== canonical(content) ||
      saved.parent_version_id !== (version?.version_id ?? null) ||
      saved.head_revision !== (version?.head_revision ?? 0) + 1
    ) {
      inFlight.current = false;
      setBusy(false);
      setWriteUnknown(true);
      setNotice("保存回执身份、父版本或内容不符；请只读核对。");
      return;
    }
    setWriteUnknown(true);
    setNotice("已收到保存回执；正在重新读取核对。");
    await load("readback");
  }
  return {
    library,
    version,
    content,
    busy,
    reliable,
    writeUnknown,
    notice,
    setNotice,
    dirty,
    locked,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    edit,
    undo,
    load: () => load(),
    save,
  };
}
