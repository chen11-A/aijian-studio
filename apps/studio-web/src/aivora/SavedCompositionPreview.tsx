import { useEffect, useState } from "react";
import { Button } from "./Common";
import { DraftExportOutput } from "./DraftExportOutput";
import { draftExportProblem, isActiveDraftExport } from "./adapters/draftExport";
import type { DraftExportGateway, DraftExportJob } from "./adapters/draftExport";
import type { AssemblyVersion } from "./adapters/episodeMediaAssembly";
import { useDraftExports } from "./useDraftExports";
import { useMediaToolchain } from "./useMediaToolchain";
import "./draft-export.css";

export type SavedCompositionPreviewProps = {
  projectId: string;
  episodeId: string;
  savedVersion: AssemblyVersion | null;
  dirty: boolean;
  disabled: boolean;
  exports: DraftExportGateway | undefined;
};
const statuses: Record<DraftExportJob["status"], string> = {
  QUEUED: "预览排队中",
  RUNNING: "正在生成连续预览",
  VERIFYING: "正在校验预览 MP4",
  SUCCEEDED: "已保存版本的连续预览可播放",
  CANCELLED: "预览任务已取消",
  FAILED: "预览生成失败",
  INTERRUPTED: "预览任务已中断，不会自动重试",
};
/** On-demand encoded playback of exactly the saved snapshot, never the unsaved editor. */
export function SavedCompositionPreview(props: SavedCompositionPreviewProps) {
  const { projectId, episodeId, savedVersion, exports, disabled } = props;
  const state = useDraftExports(
    { projectId, episodeId, exports, assembly: undefined },
    { mode: "composition-preview", savedVersion },
  );
  const [rights, setRights] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setRights(false);
    setOpen(false);
  }, [projectId, episodeId, savedVersion?.version_id, savedVersion?.content_hash]);
  const ready = !!exports?.createPreview && !!exports.preview;
  const media = useMediaToolchain();
  const canEncode = ready && media.canPreview;
  const problem = draftExportProblem(savedVersion);
  const matches = (job: DraftExportJob) =>
    job.assembly_version_id === savedVersion?.version_id &&
    job.assembly_content_hash === savedVersion?.content_hash;
  const selected = state.jobs.find(matches);
  const otherActive = state.jobs.filter((job) => !matches(job) && isActiveDraftExport(job));
  return (
    <section className="draft-export draft-export-input" aria-label="已保存剪辑连续预览">
      <div className="assembly-actions">
        <h3>已保存剪辑 · 连续预览</h3>
        <Button onClick={() => setOpen((value) => !value)}>
          {open ? "收起连续预览" : "展开连续预览"}
        </Button>
      </div>
      {!open && (
        <p role="status">
          {selected
            ? statuses[selected.status]
            : media.message}
          {props.dirty ? " · 有未保存修改，预览不包含这些修改" : ""}
          {state.pending !== null ? " · 正在核对先前预览任务" : ""}
        </p>
      )}
      {open && (
        <>
          <p>
            按已保存版本生成真实 DRAFT MP4，连续播放画面剪辑和已支持的声音、字幕。使用与草稿导出相同的本地编码和文件校验。
          </p>
          <p role="status">{media.message}</p>
          <p role={props.dirty ? "status" : undefined}>
            {props.dirty
              ? "有未保存修改：此预览只使用上次保存版本，不含当前未保存的编辑。请先保存以预览新修改。"
              : "此预览绑定已保存版本；修改并保存后，需要为新版本重新生成。"}
          </p>
          {savedVersion && <p>预览输入版本：{savedVersion.version_id}</p>}
          {!ready && <p>连续预览需要支持预览缓存与 MP4 读取的桌面软件版本。</p>}
          {problem && <p role="alert">{problem}</p>}
          <label className="draft-export-rights">
            <input
              type="checkbox"
              checked={rights}
              disabled={!canEncode || disabled || state.busy}
              onChange={(event) => setRights(event.currentTarget.checked)}
            />
            我确认素材由我拥有或为合法合成素材，同意在本机生成 DRAFT
            预览；这不代表权利审核或正式发布批准。
          </label>
          <div className="assembly-actions">
            <Button
              primary
              disabled={
                !canEncode ||
                disabled ||
                !!problem ||
                !rights ||
                state.busy ||
                state.pending !== null ||
                state.active ||
                !state.reliable
              }
              onClick={() => {
                if (canEncode) void state.submit();
              }}
            >
              {selected?.status === "SUCCEEDED" ? "重新生成已保存版本预览" : "生成已保存版本预览"}
            </Button>
            <Button disabled={!exports || state.busy} onClick={() => void state.refresh()}>
              重新核对预览任务
            </Button>
          </div>
          {state.notice && <p role="status">{state.notice}</p>}
          {state.pending !== null && (
            <p role="status">
              {state.pending === undefined
                ? "预览恢复记录不可用，已暂停新任务。"
                : "正在核对先前预览提交；不会自动重复生成。"}
            </p>
          )}
          {selected && (
            <article className="draft-export-job">
              <p role="status">{statuses[selected.status]} · DRAFT</p>
              <progress
                aria-label="连续预览编码进度"
                value={selected.progress_frames}
                max={selected.total_frames}
              />
              <p>
                {selected.progress_frames} / {selected.total_frames} 帧
              </p>
              {selected.error_code && (
                <p role="alert">
                  {selected.error_code}：{selected.error_message}
                </p>
              )}
              {isActiveDraftExport(selected) && (
                <Button
                  disabled={state.busy}
                  onClick={() => void state.cancel(selected.operation_id)}
                >
                  取消连续预览生成
                </Button>
              )}
              {selected.status === "SUCCEEDED" && (
                <DraftExportOutput
                  projectId={projectId}
                  episodeId={episodeId}
                  job={selected}
                  gateway={exports}
                />
              )}
              <details>
                <summary>预览任务与版本</summary>
                <p>{selected.output_filename}</p>
                <p>{selected.operation_id}</p>
                <p>{selected.assembly_version_id}</p>
                <p>{selected.assembly_content_hash}</p>
              </details>
            </article>
          )}
          {otherActive.map((job) => (
            <div key={job.operation_id}>
              <p role="status">较早版本的草稿或预览仍在处理，新预览需等待它结束。</p>
              <Button disabled={state.busy} onClick={() => void state.cancel(job.operation_id)}>
                取消较早版本任务
              </Button>
            </div>
          ))}
          <p>
            无需选择文件名，也不会覆盖或自动删除文件。预览缓存在本机桌面数据目录中保留，并记入草稿任务历史；
            已有同版本草稿可直接播放。内嵌播放上限为 32
            MiB，较大文件可打开所在文件夹后用本地播放器查看。
          </p>
          <p>
            收起或离开此页会关闭播放，但不会取消编码；关闭软件可能中断任务。此功能不是实时编辑播放或帧精确审片。
          </p>
        </>
      )}
    </section>
  );
}
