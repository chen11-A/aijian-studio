import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStudioTransport } from "../api/studio";
import { Button } from "./Common";
import type { DevelopmentTimelineSnapshotResult } from "./adapters/developmentTimeline";
import {
  accessDevelopmentExport,
  clearSucceededDevelopmentExportOperation,
  closeRejectedDevelopmentExportOperation,
  createDevelopmentExportOperation,
  getDevelopmentExportOperation,
  readDevelopmentExportJournalState,
} from "./adapters/developmentExport";
import type {
  DevelopmentExportOperation,
  DevelopmentTimelineIdentity,
} from "./adapters/developmentExport";

function journalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sameIdentity(
  operation: DevelopmentExportOperation,
  identity: DevelopmentTimelineIdentity,
) {
  return (
    operation.projectId === identity.projectId &&
    operation.timelineVersionId === identity.timelineVersionId &&
    operation.contentHash === identity.contentHash &&
    operation.revision === identity.revision
  );
}

export function DevelopmentExportPanel({
  projectId,
  timeline,
}: {
  projectId: string | null;
  timeline: DevelopmentTimelineSnapshotResult;
}) {
  const transport = useMemo(createStudioTransport, []);
  const requestEpoch = useRef(0);
  const observedProject = useRef(projectId);
  if (observedProject.current !== projectId) {
    observedProject.current = projectId;
    requestEpoch.current += 1;
  }
  const activeProject = useRef(projectId);
  activeProject.current = projectId;
  const [operation, setOperation] = useState<DevelopmentExportOperation | null>(null);
  const [blockedJournal, setBlockedJournal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [preview, setPreview] = useState<{ binding: string; url: string } | null>(null);
  const releasePreview = useCallback((updateState: boolean) => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    if (updateState) setPreview(null);
  }, []);
  useEffect(() => {
    requestEpoch.current += 1;
    activeProject.current = projectId;
    setBusy(false);
    setNotice("");
    const storage = journalStorage();
    if (!storage || !projectId) {
      setOperation(null);
      setBlockedJournal(!!projectId);
      return;
    }
    const journal = readDevelopmentExportJournalState(storage, projectId);
    setBlockedJournal(journal.kind === "BLOCKED");
    setOperation(journal.kind === "VALID" ? journal.operation : null);
    return () => {
      activeProject.current = null;
      requestEpoch.current += 1;
    };
  }, [projectId]);

  const snapshot = timeline.kind === "ready" ? timeline.snapshot : null;
  const identity: DevelopmentTimelineIdentity | null = snapshot
    ? {
        projectId: snapshot.projectId,
        timelineVersionId: snapshot.versionId,
        contentHash: snapshot.contentHash,
        revision: snapshot.revision,
      }
    : null;
  const fixedRate = !!snapshot && snapshot.frameRate.num === 25 && snapshot.frameRate.den === 1;
  const isCurrent = !!operation && !!identity && sameIdentity(operation, identity);
  const receipt = operation?.receipt;
  const output = receipt?.data.status === "SUCCEEDED" ? receipt.data.output : null;
  const previewBinding =
    operation && output && isCurrent
      ? `${operation.projectId}:${operation.operationId}:${operation.timelineVersionId}:${operation.revision}:${output.sha256}`
      : null;
  const observedPreviewBinding = useRef(previewBinding);
  if (observedPreviewBinding.current !== previewBinding) {
    observedPreviewBinding.current = previewBinding;
    requestEpoch.current += 1;
  }
  useEffect(() => {
    releasePreview(true);
    setBusy(false);
    return () => releasePreview(false);
  }, [previewBinding, releasePreview]);
  const visiblePreviewUrl = preview?.binding === previewBinding ? preview.url : null;

  async function createExport() {
    const storage = journalStorage();
    if (!identity || !fixedRate || !storage || busy || blockedJournal) return;
    const requestedProject = identity.projectId;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    const result = await createDevelopmentExportOperation(transport, storage, identity);
    if (requestEpoch.current !== epoch || activeProject.current !== requestedProject) return;
    setBusy(false);
    if (result.kind === "UNAVAILABLE") {
      setNotice(result.message);
      setBlockedJournal(
        readDevelopmentExportJournalState(storage, requestedProject).kind === "BLOCKED",
      );
      return;
    }
    setOperation(result.operation);
    setNotice(
      result.kind === "SUCCEEDED"
        ? "开发导出回执已保存。"
        : result.kind === "REJECTED"
          ? "首次提交被明确拒绝，且服务端确认未创建导出声明。请先核对拒绝原因，再显式结束此操作。"
          : result.kind === "TRACKED"
            ? "已有导出操作；请查询原操作，未重复提交。"
            : result.operation.rejection
              ? "收到拒绝信息，但不足以证明原操作未创建导出；结果仍未知，只能查询原操作。"
              : "导出结果未知；只能使用原操作查询，不能自动重新提交。",
    );
  }

  async function readExport() {
    const storage = journalStorage();
    if (
      !operation ||
      !storage ||
      busy ||
      operation.status === "REJECTED" ||
      operation.status === "CLOSED_REJECTED"
    )
      return;
    const requestedProject = operation.projectId;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    const result = await getDevelopmentExportOperation(transport, storage, operation);
    if (requestEpoch.current !== epoch || activeProject.current !== requestedProject) return;
    setBusy(false);
    if (result.kind === "UNAVAILABLE") {
      setNotice(result.message);
      return;
    }
    setOperation(result.operation);
    setNotice(
      result.kind === "SUCCEEDED"
        ? "已读取原操作的开发导出回执。"
        : "原操作仍为未知；未重新提交导出。",
    );
  }

  async function accessExport(action: "open" | "save") {
    if (!operation || busy || !isCurrent) return;
    const requestedProject = operation.projectId;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    const result = await accessDevelopmentExport(transport, operation, action);
    if (requestEpoch.current !== epoch || activeProject.current !== requestedProject) return;
    setBusy(false);
    setNotice(
      result === "OPENED"
        ? "已交给系统播放器打开；请在播放器中核对结果。"
        : result === "SAVED"
          ? "已保存开发 MP4 副本。"
          : result === "CANCELLED"
            ? "已取消另存。"
            : result === "UNKNOWN"
              ? "打开或另存结果未知，请核对后再操作。"
              : "当前桌面版本无法打开或另存该导出。",
    );
  }

  async function readPreview() {
    if (
      !operation ||
      !output ||
      !isCurrent ||
      !previewBinding ||
      busy ||
      !transport.readDevelopmentExportPreview
    )
      return;
    const requestedProject = operation.projectId;
    const requestedBinding = previewBinding;
    const epoch = ++requestEpoch.current;
    setBusy(true);
    try {
      const result = await transport.readDevelopmentExportPreview(
        operation.projectId,
        operation.operationId,
        operation.timelineVersionId,
        operation.revision,
        output.sha256,
      );
      if (
        requestEpoch.current !== epoch ||
        activeProject.current !== requestedProject ||
        observedPreviewBinding.current !== requestedBinding
      )
        return;
      setBusy(false);
      if (result.kind !== "READY") {
        releasePreview(true);
        setNotice(
          result.operation_id !== operation.operationId
            ? "预览响应身份不一致，已丢弃。"
            : result.kind === "PREVIEW_TOO_LARGE"
              ? "文件超过 64 MiB 内嵌预览上限，可用系统播放器查看。"
              : result.kind === "REMOTE_UNKNOWN"
                ? "预览读取结果未知；保留原导出操作，可再次查询回执。"
                : "预览文件不可读；未创建页面播放地址。",
        );
        return;
      }
      if (
        result.export_id !== operation.exportId ||
        result.sha256 !== output.sha256 ||
        result.mime_type !== "video/mp4" ||
        !(result.bytes instanceof ArrayBuffer) ||
        result.bytes.byteLength !== output.byte_length ||
        result.bytes.byteLength === 0 ||
        result.bytes.byteLength > 64 * 1024 * 1024
      ) {
        releasePreview(true);
        setNotice("预览回包与当前导出回执不一致，已丢弃视频数据。");
        return;
      }
      const url = URL.createObjectURL(new Blob([result.bytes], { type: "video/mp4" }));
      releasePreview(false);
      previewUrlRef.current = url;
      setPreview({ binding: requestedBinding, url });
      setNotice("已加载当前开发 MP4 的页面预览；播放结果仍需独立核验。");
    } catch {
      if (
        requestEpoch.current !== epoch ||
        activeProject.current !== requestedProject ||
        observedPreviewBinding.current !== requestedBinding
      )
        return;
      releasePreview(true);
      setBusy(false);
      setNotice("预览读取失败；未保留视频播放地址。");
    }
  }

  function newAttempt() {
    const storage = journalStorage();
    if (!storage || !operation || busy || operation.status !== "SUCCEEDED") return;
    requestEpoch.current += 1;
    if (!clearSucceededDevelopmentExportOperation(storage, operation)) {
      setNotice("无法清除已完成操作的本地记录，未开始新导出。");
      return;
    }
    setOperation(null);
    setNotice("已结束上一项已完成导出；可对当前时间线明确发起新操作。");
  }

  function closeRejected() {
    const storage = journalStorage();
    if (
      !storage ||
      !operation ||
      busy ||
      operation.status !== "REJECTED" ||
      activeProject.current !== operation.projectId
    )
      return;
    requestEpoch.current += 1;
    const closed = closeRejectedDevelopmentExportOperation(storage, operation);
    if (!closed) {
      setNotice("拒绝操作未能完成审计回读与结案，已阻止新提交；请保留本地记录供排查。");
      return;
    }
    setOperation(closed);
    setNotice("拒绝操作已审计并结案。核对当前时间线后，可单独点击“生成开发 MP4”发起新操作。");
  }

  return (
    <section className="v2-media-card" aria-label="开发 MP4 导出">
      <h2>开发 MP4 导出</h2>
      <p>仅用于本地 Fake 素材的开发证据，固定 1080 × 1920、25 fps；不代表正式影片或真实生成。</p>
      <p>成功回执可尝试内嵌预览（上限 64 MiB）；系统播放器打开是独立操作。</p>
      {!projectId ? (
        <p role="status">请先选择本地项目。</p>
      ) : timeline.kind === "unavailable" ? (
        <p role="status">真实时间线未就绪（{timeline.reason}）；请在组装页读取并保存时间线。</p>
      ) : !fixedRate ? (
        <p role="alert">真实时间线不是 25 fps，不能按开发规格导出。</p>
      ) : (
        <p>
          当前时间线：修订 {snapshot?.revision} · {snapshot?.durationFrames} 帧 ·{" "}
          {snapshot?.clips.length} 镜
        </p>
      )}
      {blockedJournal && (
        <p role="alert">本地导出记录不可读取，已阻止再次提交。请保留记录供排查。</p>
      )}
      {operation && (
        <div>
          <p>
            操作 ID：<code>{operation.operationId}</code>
          </p>
          <p>
            原时间线：{operation.timelineVersionId} · 修订 {operation.revision}
          </p>
          <p role="status">
            {operation.status === "UNKNOWN"
              ? "结果未知，只可查询原操作。"
              : operation.status === "REJECTED"
                ? "首次提交已被明确拒绝，服务端确认没有导出声明；可显式结束原操作。"
                : operation.status === "CLOSED_REJECTED"
                  ? "拒绝操作已审计结案；可对当前时间线明确发起新操作。"
                  : isCurrent
                    ? "原操作已完成；可读取回执并打开或另存。"
                    : "这是先前时间线的已完成导出；当前时间线需要新操作。"}
          </p>
          {operation.rejection && (
            <p>
              拒绝记录：{operation.rejection.code} · HTTP {operation.rejection.status ?? "未知"} ·
              处置 {operation.rejection.disposition} · 请求 ID{" "}
              {operation.rejection.requestId ?? "缺失"}
            </p>
          )}
          {output && isCurrent && (
            <p>
              文件：{output.relative_path} · {output.width} × {output.height} ·
              {output.frame_rate_num / output.frame_rate_den} fps · {output.duration_frames} 帧 ·
              {output.has_audio ? "含音频" : "无音频"}
            </p>
          )}
        </div>
      )}
      <div className="v2-export-actions">
        <Button
          disabled={
            !identity ||
            !fixedRate ||
            (!!operation && operation.status !== "CLOSED_REJECTED") ||
            blockedJournal ||
            busy
          }
          onClick={() => void createExport()}
        >
          生成开发 MP4
        </Button>
        <Button
          disabled={
            !operation ||
            busy ||
            operation.status === "REJECTED" ||
            operation.status === "CLOSED_REJECTED"
          }
          onClick={() => void readExport()}
        >
          查询原操作
        </Button>
        <Button
          disabled={!output || !isCurrent || busy || !transport.readDevelopmentExportPreview}
          onClick={() => void readPreview()}
        >
          读取页面预览
        </Button>
        <Button disabled={!output || !isCurrent || busy} onClick={() => void accessExport("open")}>
          用系统播放器打开
        </Button>
        <Button disabled={!output || !isCurrent || busy} onClick={() => void accessExport("save")}>
          另存 MP4
        </Button>
        {operation?.status === "SUCCEEDED" && (
          <Button disabled={busy} onClick={newAttempt}>
            结束已完成操作并新建
          </Button>
        )}
        {operation?.status === "REJECTED" && (
          <Button disabled={busy} onClick={closeRejected}>
            审计并结束已拒绝操作
          </Button>
        )}
      </div>
      {visiblePreviewUrl && (
        <video
          key={visiblePreviewUrl}
          ref={videoRef}
          src={visiblePreviewUrl}
          controls
          preload="metadata"
          aria-label="当前开发 MP4 页面预览"
          style={{ maxWidth: "100%" }}
          onError={() => {
            if (
              observedPreviewBinding.current !== previewBinding ||
              previewUrlRef.current !== visiblePreviewUrl
            )
              return;
            releasePreview(true);
            setNotice("视频无法在页面播放；已释放预览地址，可改用系统播放器核对。");
          }}
        />
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
