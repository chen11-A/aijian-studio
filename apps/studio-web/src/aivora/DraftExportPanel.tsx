import { useEffect, useState } from "react";
import { Button } from "./Common";
import { DraftExportHistory } from "./DraftExportHistory";
import { draftExportProblem } from "./adapters/draftExport";
import { useDraftExports, type DraftExportProps } from "./useDraftExports";
import { useMediaToolchain } from "./useMediaToolchain";
import "./episode-assembly.css";
import "./draft-export.css";

export function DraftExportPanel(props: DraftExportProps & { showReview?: boolean }) {
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
        <span className="draft-export-badge">本地草稿</span>
        <h2>导出草稿 MP4</h2>
        <p>
          把本集已保存的真实媒体剪辑编码为本地
          MP4。适合预览与内部核对，不能替代版权审核或正式发布批准。
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
      <DraftExportHistory
        projectId={props.projectId}
        episodeId={props.episodeId}
        exports={props.exports}
        showReview={props.showReview ?? true}
        state={state}
      />
    </section>
  );
}
