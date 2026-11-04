import { useCallback, useEffect, useRef, useState } from "react";
import { draftJobMatches } from "./adapters/draftExport";
import type { DraftExportGateway, DraftExportJob } from "./adapters/draftExport";
import { persistDraftReviewSelection, readWorkspaceSelection } from "./adapters/workspaceSelection";

export function useDraftReviewWorkspace(
  projectId: string,
  episodeId: string,
  exports?: DraftExportGateway,
) {
  const [initial] = useState(() => {
    try {
      return readWorkspaceSelection(localStorage);
    } catch {
      return { kind: "UNAVAILABLE" as const };
    }
  });
  const [operation, setOperation] = useState(
    initial.kind === "READY"
      ? (initial.snapshot.reviewOperations?.[`${projectId}/${episodeId}`] ?? "")
      : "",
  );
  const [jobs, setJobs] = useState<DraftExportJob[]>([]);
  const [job, setJob] = useState<DraftExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [storageNotice, setStorageNotice] = useState(
    initial.kind === "READY"
      ? ""
      : "本机工作位置记录不可用或损坏。原记录保留，无法恢复或更改审片选择，请先核对本机存储。",
  );
  const life = useRef({ active: true, epoch: 0 });
  const load = useCallback(async () => {
    const live = life.current;
    const ticket = ++live.epoch;
    const valid = () => live.active && live.epoch === ticket;
    setBusy(true);
    setJob(null);
    setNotice("");
    if (!exports) {
      setJobs([]);
      setNotice("当前桌面版本未提供 草稿 读取能力，请更新桌面版本。");
      setBusy(false);
      return;
    }
    try {
      const [listed, read] = await Promise.allSettled([
        exports.list(projectId, episodeId),
        operation ? exports.get(projectId, episodeId, operation) : Promise.resolve(null),
      ]);
      if (!valid()) return;
      const result = listed.status === "fulfilled" ? listed.value : null;
      const reliable =
        result?.kind === "LISTED" &&
        new Set(result.receipt.data.items.map((item) => item.operation_id)).size ===
          result.receipt.data.items.length &&
        result.receipt.data.items.every((item) => draftJobMatches(item, projectId, episodeId));
      const items = reliable && result?.kind === "LISTED" ? result.receipt.data.items : [];
      setJobs(
        items.filter((item) => item.status === "SUCCEEDED" || item.error_code === "OUTPUT_CHANGED"),
      );
      if (!reliable) setNotice("导出列表未可靠读回，请重新读取。不会替你选择其他版本。");
      if (!operation) return;
      const receipt =
        read.status === "fulfilled" && read.value?.kind === "FOUND"
          ? read.value.receipt.data
          : null;
      const listedJob = items.find((item) => item.operation_id === operation);
      if (
        !receipt ||
        !draftJobMatches(receipt, projectId, episodeId, operation) ||
        (listedJob &&
          (listedJob.assembly_version_id !== receipt.assembly_version_id ||
            listedJob.assembly_content_hash !== receipt.assembly_content_hash ||
            listedJob.total_frames !== receipt.total_frames ||
            (listedJob.status === "SUCCEEDED" &&
              receipt.status === "SUCCEEDED" &&
              (listedJob.output_sha256 !== receipt.output_sha256 ||
                listedJob.output_bytes !== receipt.output_bytes))))
      ) {
        setNotice(
          "原版回执未可靠读回或版本证据不符。选择保留；请明确重新读取核对，不会改选最新版本。",
        );
        return;
      }
      setJob(receipt);
    } catch {
      if (valid()) {
        setJobs([]);
        setNotice("原版回执未可靠读回，请明确重新读取核对。");
      }
    } finally {
      if (valid()) setBusy(false);
    }
  }, [projectId, episodeId, exports, operation]);
  useEffect(() => {
    const live = life.current;
    live.active = true;
    void load();
    return () => {
      live.active = false;
      live.epoch++;
    };
  }, [load]);
  const select = (next: string) => {
    try {
      if (!persistDraftReviewSelection(localStorage, projectId, episodeId, next)) {
        setStorageNotice(
          "无法可靠保存审片选择，原选择和输入保留。请核对本机存储（最多保留 64 个分集位置）。",
        );
        return false;
      }
    } catch {
      setStorageNotice("无法可靠保存审片选择，原选择和输入保留。请核对本机存储。");
      return false;
    }
    life.current.epoch++;
    setJob(null);
    setStorageNotice("");
    setOperation(next);
    return true;
  };
  return { operation, jobs, job, busy, notice, storageNotice, load, select };
}
