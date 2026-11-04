import { Button } from "./Common";
import { DraftExportOutput } from "./DraftExportOutput";
import { DraftReviewNotes } from "./DraftReviewNotes";
import { isActiveDraftExport } from "./adapters/draftExport";
import type { DraftExportGateway, DraftExportJob } from "./adapters/draftExport";
import type { AssemblyVersion } from "./adapters/episodeMediaAssembly";

const statusLabels: Record<DraftExportJob["status"], string> = {
  QUEUED: "排队中",
  RUNNING: "正在编码",
  VERIFYING: "正在校验 MP4 文件",
  SUCCEEDED: "草稿文件已验证并保存",
  FAILED: "导出失败",
  CANCELLED: "已取消",
  INTERRUPTED: "运行中断",
};
export function DraftExportHistory({
  projectId,
  episodeId,
  exports,
  showReview,
  state,
}: {
  projectId: string;
  episodeId: string;
  exports?: DraftExportGateway;
  showReview: boolean;
  state: {
    reliable: boolean;
    jobs: DraftExportJob[];
    version: AssemblyVersion | null;
    busy: boolean;
    cancel: (operationId: string) => Promise<void>;
  };
}) {
  return (
    <section className="draft-export-history" aria-label="草稿导出历史">
      <h3>本集导出任务</h3>
      <p>任务由本地服务保存；离开页面后可重新打开查看进度。关闭桌面软件可能中断编码。</p>
      {state.reliable && !state.jobs.length && <p>尚无草稿导出记录。</p>}
      {state.jobs.map((job) => (
        <article key={job.operation_id} className="draft-export-job">
          <h4>草稿视频</h4>
          {job.output_filename.includes("PREVIEW") && (
            <p>编辑器连续预览缓存 · 在本机保留，不会自动删除</p>
          )}
          <p role="status">{statusLabels[job.status]}</p>
          <progress
            aria-label="草稿视频编码进度"
            value={job.progress_frames}
            max={job.total_frames}
          />
          <p>
            {job.progress_frames} / {job.total_frames} 帧
            {job.status === "VERIFYING" ? " · 编码完成，仍需校验" : ""}
          </p>
          <p>已绑定当时保存的剪辑。</p>
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
                projectId={projectId}
                episodeId={episodeId}
                job={job}
                gateway={exports}
                showReview={showReview}
              />
            </>
          )}
          {showReview && job.error_code === "OUTPUT_CHANGED" && (
            <DraftReviewNotes
              job={job}
              gateway={exports?.review}
              revision={exports?.revision}
              exports={exports}
            />
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
  );
}
