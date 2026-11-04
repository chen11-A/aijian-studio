import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseAssemblyReceipt,
  type AssemblyVersion,
  type EpisodeMediaAssemblyGateway,
} from "./adapters/episodeMediaAssembly";
import {
  draftExportFailure,
  draftJobMatches,
  isActiveDraftExport,
  type DraftExportCommand,
  type DraftExportGateway,
  type DraftExportJob,
  type DraftExportSubmitResult,
} from "./adapters/draftExport";

export type DraftExportProps = {
  projectId: string;
  episodeId: string;
  assembly: EpisodeMediaAssemblyGateway | undefined;
  exports: DraftExportGateway | undefined;
};
function readPending(key: string): DraftExportCommand | null | undefined {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    const raw: unknown = JSON.parse(value);
    if (!raw || typeof raw !== "object") return undefined;
    const item = raw as Record<string, unknown>;
    return Object.keys(item).length === 4 &&
      typeof item.operation_id === "string" &&
      /^dmp_[0-9a-f]{32}$/.test(item.operation_id) &&
      typeof item.assembly_version_id === "string" &&
      /^ver_[0-9a-f]{32}$/.test(item.assembly_version_id) &&
      typeof item.assembly_content_hash === "string" &&
      /^sha256:[0-9a-f]{64}$/.test(item.assembly_content_hash) &&
      item.rights_declaration === "OWNED_OR_SYNTHETIC"
      ? (item as DraftExportCommand)
      : undefined;
  } catch {
    return undefined;
  }
}
function matchesPending(job: DraftExportJob, pending: DraftExportCommand) {
  return (
    job.operation_id === pending.operation_id &&
    job.assembly_version_id === pending.assembly_version_id &&
    job.assembly_content_hash === pending.assembly_content_hash
  );
}
export function useDraftExports(
  { projectId, episodeId, assembly, exports }: DraftExportProps,
  options?: { mode: "composition-preview"; savedVersion: AssemblyVersion | null },
) {
  const composition = options?.mode === "composition-preview";
  const savedVersion = options?.savedVersion;
  const key = `aivora:${composition ? "composition-preview" : "draft-mp4"}:pending:${projectId}:${episodeId}`;
  const alive = useRef(true);
  const currentKey = useRef(key);
  currentKey.current = key;
  const epoch = useRef(0);
  const submitting = useRef(false);
  const refreshing = useRef(false);
  const mutation = useRef(0);
  const [version, setVersion] = useState<AssemblyVersion | null>(null);
  const [jobs, setJobs] = useState<DraftExportJob[]>([]);
  const [pending, setPending] = useState(() => readPending(key));
  const [busy, setBusy] = useState(false);
  const [reliable, setReliable] = useState(false);
  const [notice, setNotice] = useState("");
  const valid = useCallback(() => alive.current && currentKey.current === key, [key]);
  const clearPending = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setPending(null);
    } catch {
      setPending(undefined);
      setNotice("无法保存任务恢复记录，已暂停新导出。请恢复本地存储后重新打开。");
    }
  }, [key]);
  const accept = useCallback((job: DraftExportJob) => {
    setJobs((previous) => [
      job,
      ...previous.filter((item) => item.operation_id !== job.operation_id),
    ]);
  }, []);
  const refresh = useCallback(async () => {
    if (!exports || refreshing.current || submitting.current) return;
    refreshing.current = true;
    const revision = mutation.current;
    try {
      const result = await exports.list(projectId, episodeId);
      if (!valid() || revision !== mutation.current) return;
      if (
        result.kind !== "LISTED" ||
        !result.receipt.data.items.every((job) => draftJobMatches(job, projectId, episodeId))
      ) {
        setReliable(false);
        setNotice(draftExportFailure(result));
        return;
      }
      const intent = readPending(key);
      if (
        intent &&
        result.receipt.data.items.some(
          (job) => job.operation_id === intent.operation_id && !matchesPending(job, intent),
        )
      ) {
        setReliable(false);
        setNotice("任务身份与先前保存的提交记录不符，已暂停新导出。请保留记录并核对。");
        return;
      }
      setJobs(result.receipt.data.items);
      setReliable(true);
      setPending(intent);
      if (intent) {
        const operationId = intent.operation_id;
        const known = result.receipt.data.items.find((job) => job.operation_id === operationId);
        if (known && matchesPending(known, intent)) {
          clearPending();
          return;
        }
        const read = await exports.get(projectId, episodeId, operationId);
        if (!valid()) return;
        if (
          read.kind === "FOUND" &&
          draftJobMatches(read.receipt.data, projectId, episodeId, operationId) &&
          matchesPending(read.receipt.data, intent)
        ) {
          accept(read.receipt.data);
          clearPending();
        } else if (read.kind === "NOT_FOUND") {
          clearPending();
          setNotice(
            composition
              ? "已核实先前预览任务未被接收，可以重新生成。"
              : "已核实先前任务未被接收，可重新选择保存位置。",
          );
        } else setNotice("先前草稿提交结果仍未知，正在核对原任务；新导出已暂停。");
      }
    } catch {
      if (valid()) {
        setReliable(false);
        setNotice("暂时无法读取草稿任务，正在等待恢复。");
      }
    } finally {
      refreshing.current = false;
    }
  }, [exports, projectId, episodeId, key, valid, accept, clearPending, composition]);
  const load = useCallback(async () => {
    const request = ++epoch.current;
    setBusy(true);
    setVersion(null);
    setReliable(false);
    try {
      const result = composition ? undefined : await assembly?.readLatest(projectId, episodeId);
      if (!valid() || request !== epoch.current) return;
      const saved = composition
        ? (savedVersion ?? null)
        : result?.kind === "FOUND"
          ? parseAssemblyReceipt(result.receipt, projectId, episodeId)
          : null;
      setVersion(saved);
      setNotice(
        saved
          ? "已读回保存版本；未保存的编辑不会进入此次草稿。"
          : composition || result?.kind === "NOT_FOUND"
            ? "尚无保存的媒体装配，请先完成并保存剪辑。"
            : "无法可靠读取本集装配，请重新读取。",
      );
      await refresh();
    } catch {
      if (valid()) setNotice("读取本集装配失败，请重新读取。");
    } finally {
      if (valid() && request === epoch.current) setBusy(false);
    }
  }, [assembly, projectId, episodeId, refresh, valid, composition, savedVersion]);
  useEffect(() => {
    alive.current = true;
    setJobs([]);
    setPending(readPending(key));
    void load();
    return () => {
      alive.current = false;
      epoch.current += 1;
    };
  }, [load, key]);
  const active = jobs.some(isActiveDraftExport);
  useEffect(() => {
    if (!exports || !(active || pending || !reliable)) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [exports, active, pending, reliable, refresh]);
  async function submit() {
    if (
      !exports ||
      (composition && !exports.createPreview) ||
      !version ||
      busy ||
      submitting.current ||
      pending !== null ||
      active ||
      !reliable
    )
      return;
    const command = {
      operation_id: `dmp_${crypto.randomUUID().replaceAll("-", "")}`,
      assembly_version_id: version.version_id,
      assembly_content_hash: version.content_hash,
      rights_declaration: "OWNED_OR_SYNTHETIC" as const,
    };
    try {
      localStorage.setItem(key, JSON.stringify(command));
    } catch {
      setPending(undefined);
      setNotice("无法保存任务恢复记录，导出尚未提交。");
      return;
    }
    mutation.current += 1;
    submitting.current = true;
    setPending(command);
    setBusy(true);
    let result: DraftExportSubmitResult;
    try {
      result = composition
        ? await exports.createPreview!(projectId, episodeId, command)
        : await exports.createFromPicker(projectId, episodeId, command);
    } catch {
      result = { kind: "REMOTE_UNKNOWN" };
    } finally {
      submitting.current = false;
    }
    if (!valid()) return;
    setBusy(false);
    if (
      result.kind === "FOUND" &&
      draftJobMatches(result.receipt.data, projectId, episodeId, command.operation_id) &&
      result.receipt.data.assembly_version_id === command.assembly_version_id &&
      result.receipt.data.assembly_content_hash === command.assembly_content_hash
    ) {
      accept(result.receipt.data);
      clearPending();
      setNotice("已读取草稿任务记录。编码与文件校验完成后才会显示成功。");
    } else if (
      [
        "PICKER_CANCELLED",
        "PICKER_BUSY",
        "INVALID_DESTINATION",
        "CACHE_UNAVAILABLE",
        "DEFINITE_SERVER_ERROR",
      ].includes(result.kind)
    ) {
      clearPending();
      setNotice(
        result.kind === "PICKER_CANCELLED"
          ? "已取消保存位置选择，未创建导出任务。"
          : result.kind === "CACHE_UNAVAILABLE"
            ? "本机预览缓存目录不可用或不安全，未提交任务。请检查桌面数据目录后重试。"
            : result.kind === "PICKER_BUSY"
              ? "另一个草稿保存或预览请求仍在处理，请稍后再试。"
              : result.kind === "INVALID_DESTINATION"
                ? "保存位置无效，请选择新的 .mp4 文件。"
                : draftExportFailure(result),
      );
    } else setNotice("提交结果未知，正在核对原任务；不会重复创建导出。");
  }
  async function cancel(operationId: string) {
    if (!exports || submitting.current || busy) return;
    mutation.current += 1;
    setBusy(true);
    try {
      const result = await exports.cancel(projectId, episodeId, operationId);
      if (!valid()) return;
      if (
        result.kind === "FOUND" &&
        draftJobMatches(result.receipt.data, projectId, episodeId, operationId)
      ) {
        accept(result.receipt.data);
        setNotice(
          result.receipt.data.status === "CANCELLED"
            ? "草稿任务已取消。"
            : result.receipt.data.status === "SUCCEEDED"
              ? "任务已在取消前完成，请查看已验证的输出记录。"
              : isActiveDraftExport(result.receipt.data)
                ? "已读回任务状态；正在核对取消结果。"
                : "任务已结束，请查看记录中的原因。",
        );
      } else setNotice(draftExportFailure(result));
    } catch {
      if (valid()) setNotice("取消结果未知；请刷新核对，任务可能仍在运行。");
    } finally {
      if (valid()) setBusy(false);
    }
  }
  return { version, jobs, busy, reliable, notice, pending, active, load, refresh, submit, cancel };
}
