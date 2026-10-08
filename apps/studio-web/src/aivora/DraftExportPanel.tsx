import { useEffect, useState } from "react";
import { Button } from "./Common";
import { DraftReviewNotes } from "./DraftReviewNotes";
import { DraftExportOutput } from "./DraftExportOutput";
import {
  draftExportProblem,
  isActiveDraftExport,
  type DraftExportJob,
} from "./adapters/draftExport";
import { useDraftExports, type DraftExportProps } from "./useDraftExports";
import { useMediaToolchain } from "./useMediaToolchain";
import "./episode-assembly.css";
import "./draft-export.css";

const statusLabels: Record<DraftExportJob["status"], string> = {
  QUEUED: "排队中",
  RUNNING: "正在编码",
  VERIFYING: "正在校验 MP4 文件",
  SUCCEEDED: "草稿文件已验证并保存",
  FAILED: "导出失败",
  CANCELLED: "已取消",
  INTERRUPTED: "运行中断",
};
export function DraftExportPanel(props: DraftExportProps) {
  const state = useDraftExports(props);
  const [rights, setRights] = useState(false);
  useEffect(() => setRights(false), [props.projectId, props.episodeId, state.version?.version_id]);
  const problem = draftExportProblem(state.version);
  const nativeReady = !!props.exports && !!props.assembly;
  const media = useMediaToolchain();
  const canEncode = nativeReady && media.canDraftExport;
  return (
    <section className="v2-media-card episode-assembly draft-export" aria-label="草稿 MP4 导出">
      <header>
        <span className="draft-export-badge">DRAFT · 本地草稿</span>
        <h2>导出草稿 MP4</h2>
        <p>
          把本集已保存的真实媒体剪辑编码为本地 MP4。适合预览与内部核对，不能替代版权审核或正式发布批准。
        </p>
      </header>
      <p role="status">{media.message}</p>
      {!nativeReady && (
        <p role="alert">
          此功能需要桌面软件的原生保存窗口和本地编码服务；当前浏览器无法导出草稿 MP4。
        </p>
      )}
      <div className="assembly-actions">
        <Button disabled={state.busy || !nativeReady} onClick={() => void state.load()}>
          重新读取保存版本与任务
        </Button>
      </div>
      {state.notice && <p role="status">{state.notice}</p>}
      {state.version && (
        <div className="draft-export-input">
          <h3>本次输入 · 已保存版本</h3>
          <p>
            {state.version.content.canvas_width} × {state.version.content.canvas_height} ·{" "}
            {state.version.content.total_frames} 帧 · {state.version.content.visual_segments.length}{" "}
            个画面 / {state.version.content.audio_segments.length} 个音频 /{" "}
            {state.version.content.subtitle_segments.length} 条字幕
          </p>
          <p>版本：{state.version.version_id}</p>
          <details>
            <summary>查看内容校验值</summary>
            <p>{state.version.content_hash}</p>
          </details>
          {media.canDraftExport && (
            <p>本机 FFmpeg 编码 · 无云端上传 · 文件名默认含 DRAFT · 不覆盖已存在的文件</p>
          )}
          {state.version.media_checks.some(
            (check) => check.availability === "UNVERIFIED_SIZE_LIMIT",
          ) && <p>存在超过快速校验上限的素材；本地编码服务将完整读取并校验，失败会停止导出。</p>}
        </div>
      )}
      {!state.busy && problem && <p role="alert">{problem}</p>}
      <label className="draft-export-rights">
        <input
          type="checkbox"
          checked={rights}
          disabled={state.busy || !canEncode}
          onChange={(event) => setRights(event.currentTarget.checked)}
        />
        我确认本集素材由我拥有或为合法合成素材，且理解此文件仅为本地 DRAFT
        草稿，不代表权利审核通过或获得正式发布批准。
      </label>
      <Button
        primary
        disabled={
          !canEncode ||
          !rights ||
          !!problem ||
          state.busy ||
          state.pending !== null ||
          state.active ||
          !state.reliable
        }
        onClick={() => {
          if (canEncode) void state.submit();
        }}
      >
        {state.busy ? "正在处理…" : "选择保存位置并导出草稿 MP4"}
      </Button>
      {state.pending !== null && (
        <p role="status">
          {state.pending === undefined
            ? "任务恢复记录不可用，已暂停新导出。"
            : "正在核对先前提交；请勿重复导出。"}
        </p>
      )}
      <section className="draft-export-history" aria-label="草稿导出历史">
        <h3>本集导出任务</h3>
        <p>任务由本地服务保存；离开页面后可重新打开查看进度。关闭桌面软件可能中断编码。</p>
        {state.reliable && !state.jobs.length && <p>尚无草稿导出记录。</p>}
        {state.jobs.map((job) => (
          <article key={job.operation_id} className="draft-export-job">
            <h4>{job.output_filename}</h4>
            {job.output_filename === `Aivora-PREVIEW-DRAFT-${job.operation_id}.mp4` && (
              <p>编辑器连续预览缓存 · 在本机保留，不会自动删除</p>
            )}
            <p role="status">{statusLabels[job.status]} · DRAFT</p>
            <progress
              aria-label={`${job.output_filename} 编码进度`}
              value={job.progress_frames}
              max={job.total_frames}
            />
            <p>
              {job.progress_frames} / {job.total_frames} 帧
              {job.status === "VERIFYING" ? " · 编码完成，仍需校验" : ""}
            </p>
            <p>装配版本：{job.assembly_version_id}</p>
            {state.version && job.assembly_version_id !== state.version.version_id && (
              <p>此任务使用较早保存的装配版本。</p>
            )}
            <details>
              <summary>任务与版本证据</summary>
              <p>任务：{job.operation_id}</p>
              <p>装配校验值：{job.assembly_content_hash}</p>
              <p>编码工具配置：{job.toolchain_profile_id}</p>
              <p>更新时间：{job.updated_at}</p>
            </details>
            {job.status === "SUCCEEDED" && (
              <>
                <p>保存位置：{job.output_path}</p>
                <p>已验证大小：{job.output_bytes} 字节</p>
                <details>
                  <summary>文件校验值</summary>
                  <p>{job.output_sha256}</p>
                </details>
                <DraftExportOutput
                  projectId={props.projectId}
                  episodeId={props.episodeId}
                  job={job}
                  gateway={props.exports}
                />
              </>
            )}
            {job.error_code === "OUTPUT_CHANGED" && (
              <DraftReviewNotes job={job} gateway={props.exports?.review} />
            )}
            {job.error_code && (
              <p role="alert">
                {job.error_code}
                {job.error_message ? `：${job.error_message}` : ""}
              </p>
            )}
            {(job.status === "FAILED" || job.status === "INTERRUPTED") && (
              <p>请核对错误和素材，重新读取后选择一个新的保存文件。旧任务记录会保留。</p>
            )}
            {isActiveDraftExport(job) && (
              <Button disabled={state.busy} onClick={() => void state.cancel(job.operation_id)}>
                取消此草稿任务
              </Button>
            )}
          </article>
        ))}
      </section>
    </section>
  );
}
