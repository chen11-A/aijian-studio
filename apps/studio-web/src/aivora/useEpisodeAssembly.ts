import type { ManualMediaCandidateGateway } from "@aijian/contracts/manual-media-candidate";
import type { MediaPreparationGateway } from "@aijian/contracts/media-preparation";
import type { AssemblyExactGateway } from "@aijian/contracts/assembly-exact";
import {
  ASSEMBLY_SESSION_INTENTS,
  preserveAssemblyExactJournal,
  readAssemblyExactJournal,
  submitAssemblyExact,
} from "./adapters/assemblyExact";
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
  externalWritePending?: boolean;
  externalWriteBusy?: boolean;
  externalWritePreserved?: () => boolean;
  saveBlocked?: boolean;
  exports?: DraftExportGateway;
  script?: AssemblyScriptGateway;
  candidates?: Partial<ManualMediaCandidateGateway & MediaPreparationGateway>;
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
function error(kind: string, status?: number, code?: string) {
  return kind === "DEFINITE_SERVER_ERROR"
    ? `装配请求被拒绝：${status} / ${code}`
    : "结果未知；请准确核对原保存，不要重复提交。";
}
type HeadProof = { revision: number; versionId?: string; hash?: string };
export const ASSEMBLY_SESSION_HEADS = new Map<string, HeadProof>();
function rememberHead(scope: string, proof: HeadProof) {
  const old = ASSEMBLY_SESSION_HEADS.get(scope);
  if (
    !old ||
    proof.revision > old.revision ||
    (proof.revision === old.revision && !old.versionId && proof.versionId)
  )
    ASSEMBLY_SESSION_HEADS.set(scope, proof);
}
/** Saved head, pending write recovery, and bounded local edit history share one episode scope. */
export function useEpisodeAssembly({
  projectId,
  episodeId,
  assets,
  assembly,
  setNavigationGuard,
  hasPendingInput = false,
  externalWritePending = false,
  externalWriteBusy = false,
  externalWritePreserved,
  saveBlocked = false,
}: EpisodeAssemblyProps) {
  const scope = `${projectId}:${episodeId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const epoch = useRef(0);
  const inFlight = useRef(false);
  const owned = useRef(ASSEMBLY_SESSION_INTENTS);
  let storage: Storage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    /* Keep writes blocked. */
  }
  const journal = () =>
    storage
      ? readAssemblyExactJournal(storage, projectId, episodeId)
      : { kind: "BLOCKED" as const };
  const preserve = () => {
    const c = owned.current.get(scope);
    return !c || (!!storage && preserveAssemblyExactJournal(storage, c));
  };
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
  const contentDirty =
    canonical(content) !== canonical(version?.content ?? emptyAssembly(projectId, episodeId));
  const dirty = hasPendingInput || contentDirty;
  const locked = busy || !reliable || writeUnknown || externalWriteBusy || externalWritePending;
  const leaveState = useRef({
    dirty,
    busy,
    version,
    writeUnknown,
    externalWritePending,
    externalWriteBusy,
    externalWritePreserved,
  });
  leaveState.current = {
    dirty,
    busy,
    version,
    writeUnknown,
    externalWritePending,
    externalWriteBusy,
    externalWritePreserved,
  };
  useEffect(() => {
    setNavigationGuard(() => {
      const current = leaveState.current;
      if (current.busy || inFlight.current || current.externalWriteBusy) {
        setNotice(
          current.externalWriteBusy
            ? "正在读取或保存自审记录，请等待核对后再切换页面、作品或剧集。"
            : "正在读取或保存剪辑，请等待结果后再切换页面、作品或剧集。",
        );
        return false;
      }
      const unresolved =
        current.writeUnknown || journal().kind !== "EMPTY" || current.externalWritePending;
      if (
        !preserve() ||
        (current.externalWritePreserved && !current.externalWritePreserved()) ||
        ["BLOCKED", "LEGACY_BLOCKED"].includes(journal().kind)
      ) {
        setNotice("原保存日志无法精确保留或属于旧未归因日志；请保留，不要覆盖或重发。");
        return false;
      }
      if (!current.dirty && !unresolved) return true;
      if (
        !window.confirm(
          unresolved
            ? current.externalWritePending
              ? "这次自审保存的结果还待核对，原操作恢复记录会保留。离开此页吗？"
              : "这次剪辑保存的结果还待核对，恢复记录会保留。离开此页吗？"
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
        !current.externalWritePending &&
        !current.externalWriteBusy &&
        journal().kind === "EMPTY"
      )
        return;
      event.preventDefault();
      event.returnValue = "";
      setNotice(
        current.externalWriteBusy
          ? "正在读取或保存自审记录，已阻止关闭。请等待核对后再关闭软件。"
          : current.externalWritePending
            ? "自审保存结果尚未核对，原操作恢复记录仍保留；已阻止关闭。"
            : current.busy || inFlight.current
              ? "正在读取或保存剪辑，已阻止关闭。请等待核对完成后再关闭软件。"
              : current.writeUnknown || journal().kind !== "EMPTY"
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
      if (leaveState.current.externalWriteBusy || leaveState.current.externalWritePending) {
        setNotice("自审记录正在保存或结果待核对；请先核对原操作，保留当前装配和输入。");
        return;
      }
      if (
        mode === "reload" &&
        leaveState.current.dirty &&
        journal().kind === "EMPTY" &&
        !window.confirm("重新读取会放弃当前未保存的剪辑修改。继续吗？")
      )
        return;
      const request = ++epoch.current;
      const original = owned.current.get(scope);
      const retained = preserve();
      inFlight.current = true;
      setBusy(true);
      setReliable(false);
      setWriteUnknown(journal().kind !== "EMPTY" || !!original || !retained);
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
        setNotice("这一版还不能读取或保存成片。");
        return;
      }
      if (result.kind === "NOT_FOUND") {
        if (ASSEMBLY_SESSION_HEADS.has(scope)) {
          setNotice("当前头回执缺失，先前已核对版本仍保留；未授权新保存。");
          return;
        }
        setVersion(null);
        if (journal().kind === "EMPTY" && !original) {
          setContent(emptyAssembly(projectId, episodeId));
          setHistory({ past: [], future: [] });
        }
        setReliable(true);
        setNotice(
          journal().kind === "EMPTY" && !original
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
      const known = ASSEMBLY_SESSION_HEADS.get(scope);
      if (
        known &&
        (read.head_revision < known.revision ||
          (known.versionId &&
            read.head_revision === known.revision &&
            (read.version_id !== known.versionId || read.content_hash !== known.hash)))
      ) {
        setNotice("当前头落后于已核对保存或同修订身份矛盾；保留输入，请另行准确读取。");
        return;
      }
      rememberHead(scope, {
        revision: read.head_revision,
        versionId: read.version_id,
        hash: read.content_hash,
      });
      setVersion(read);
      const unresolved = owned.current.has(scope);
      if (journal().kind === "EMPTY" && !unresolved) {
        setContent(read.content);
        setHistory({ past: [], future: [] });
      }
      setReliable(true);
      setWriteUnknown(journal().kind !== "EMPTY" || unresolved);
      setNotice(
        journal().kind === "EMPTY" && !unresolved
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
    const original = owned.current.get(scope);
    const j = journal();
    if (original) {
      preserve();
      setContent(original.payload.content);
    } else if (j.kind === "PENDING") {
      owned.current.set(scope, j.command);
      setContent(j.command.payload.content);
    }
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
  async function mutate(recover: boolean) {
    if (leaveState.current.externalWriteBusy) {
      setNotice("正在读取或保存本地自审，请等待结果后再核对原装配操作。");
      return;
    }
    if (inFlight.current || !storage || !assembly?.saveExact || !assembly.getOriginal) {
      setNotice("当前桌面缺少原操作精确核对接口或日志；保留输入，不能保存。");
      return;
    }
    let command = owned.current.get(scope);
    const j = journal();
    if (recover) {
      if (!command && j.kind === "PENDING") {
        command = j.command;
        owned.current.set(scope, command);
      }
      if (!command) {
        setNotice(
          j.kind === "LEGACY_BLOCKED"
            ? "旧版保存日志缺少原UUID与完整输入，必须保留，不能从最新版本推断成功。"
            : "缺少完整原保存记录，不能重新发送。",
        );
        return;
      }
    } else {
      if (
        hasPendingInput ||
        saveBlocked ||
        locked ||
        !dirty ||
        !content.visual_segments.length ||
        assemblyEditProblem(content) ||
        j.kind !== "EMPTY" ||
        command
      )
        return;
      command = {
        operation_id: crypto.randomUUID(),
        payload: {
          content,
          parent_version_id: version?.version_id ?? null,
          expected_revision: version?.head_revision ?? null,
          change_summary: "更新本地媒体集级剪辑草稿",
        },
      };
      owned.current.set(scope, command);
    }
    const request = ++epoch.current;
    inFlight.current = true;
    setBusy(true);
    const result = await submitAssemblyExact(
      assembly as AssemblyExactGateway,
      storage,
      command,
      () => currentScope.current === scope && epoch.current === request,
      recover,
    );
    if (currentScope.current !== scope || epoch.current !== request) return;
    inFlight.current = false;
    setBusy(false);
    if (result.kind === "UNKNOWN") {
      setWriteUnknown(true);
      setNotice("原保存结果UNKNOWN；只允许准确核对原保存，不会重复POST。");
      return;
    }
    owned.current.delete(scope);
    setWriteUnknown(false);
    if (result.kind === "REJECTED") {
      setReliable(false);
      setNotice(`原保存明确拒绝：${result.code}。输入保留，请先重新读取当前头。`);
      return;
    }
    const exact = result.operation;
    rememberHead(
      scope,
      exact.version.head_revision === exact.result_revision
        ? {
            revision: exact.result_revision,
            versionId: exact.version.version_id,
            hash: exact.version.content_hash,
          }
        : { revision: exact.version.head_revision },
    );
    // An attributed historical operation may precede a newer head. Its immutable
    // result_revision ends this UNKNOWN; only a new head read permits another CAS.
    setReliable(false);
    setNotice("原保存已准确核对；正在另读当前装配头。");
    await load("readback");
  }
  const save = () => mutate(false);
  const recover = () => mutate(true);
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
    contentDirty,
    locked,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    edit,
    undo,
    load: () => load(),
    save,
    recover,
    journalKind: journal().kind,
  };
}
