import { useState } from "react";
import type { DraftExportGateway } from "./adapters/draftExport";
import { Button } from "./Common";
import { DraftExportOutput } from "./DraftExportOutput";
import { DraftReviewNotes } from "./DraftReviewNotes";
import { DraftReviewNavigation, useDraftReviewNavigation } from "./DraftReviewNavigation";
import { useDraftReviewWorkspace } from "./useDraftReviewWorkspace";
import "./draft-export.css";
import "./episode-assembly.css";

import { Select } from "./Select";
type Props = {
  projectId: string;
  episodeId: string;
  exports?: DraftExportGateway;
  view: "review" | "changes" | "export";
  onAssembly?: () => void;
  onExport?: () => void;
  setNavigationGuard?: (guard: (() => boolean) | null) => void;
};
export function DraftReviewWorkspace(props: Props) {
  return (
    <DraftReviewNavigation
      key={`${props.projectId}/${props.episodeId}`}
      setNavigationGuard={props.setNavigationGuard}
    >
      <SelectedWorkspace {...props} />
    </DraftReviewNavigation>
  );
}
function SelectedWorkspace(props: Props) {
  const { projectId, episodeId, exports, view } = props;
  const state = useDraftReviewWorkspace(projectId, episodeId, exports);
  const navigation = useDraftReviewNavigation();
  const [enteredOperation, setEnteredOperation] = useState("");
  const choose = (operation: string) => {
    if (operation !== state.operation && navigation?.canLeave()) state.select(operation);
  };
  const job = state.job;
  return (
    <section
      className="v2-media-card episode-assembly draft-export"
      aria-label="DRAFT 审片与人工修改工作区"
    >
      <header>
        <span className="draft-export-badge">手工审片与修改</span>
        <h2>{view === "changes" ? "人工修改计划与候选复核" : "选择原版草稿并审片"}</h2>
        <p>
          批注、计划与批准固定到精确分集、装配和文件。批准不会调用模型、修改装配、编码、发布或产生费用。
        </p>
      </header>
      <p>
        当前作品：{projectId} · 当前分集：{episodeId}
      </p>
      <label>
        审片原版 DRAFT
        <Select
          aria-label="审片原版 DRAFT"
          value={state.operation}
          disabled={state.busy || !exports}
          onChange={(event) => choose(event.currentTarget.value)}
        >
          <option value="">明确选择此分集原版</option>
          {state.jobs.map((item) => (
            <option key={item.operation_id} value={item.operation_id}>
              {item.output_filename} · {item.operation_id}
              {item.error_code === "OUTPUT_CHANGED" ? " · 文件失效，仅历史记录" : ""}
            </option>
          ))}
          {state.operation && !state.jobs.some((item) => item.operation_id === state.operation) && (
            <option value={state.operation}>已保留的原版：{state.operation}</option>
          )}
        </Select>
      </label>
      <p>
        列表仅显示最近 20
        个导出中的成功草稿或失效历史。已保留的原版仍按完整任务标识读取，不自动改选新版。
      </p>
      <details>
        <summary>按完整导出任务标识读取历史原版</summary>
        <label>
          历史原版任务标识
          <input
            value={enteredOperation}
            maxLength={36}
            onChange={(event) => setEnteredOperation(event.currentTarget.value)}
          />
        </label>
        <Button
          disabled={state.busy || !exports || !/^dmp_[0-9a-f]{32}$/.test(enteredOperation)}
          onClick={() => choose(enteredOperation)}
        >
          选择此精确历史原版
        </Button>
      </details>
      <Button
        disabled={state.busy || !exports}
        onClick={() => {
          if (navigation?.canLeave()) void state.load();
        }}
      >
        重新读取原版与导出列表（只读）
      </Button>
      {state.busy && <p role="status">正在读取原版与核对导出文件…</p>}
      {state.notice && <p role="alert">{state.notice}</p>}
      {state.storageNotice && <p role="alert">{state.storageNotice}</p>}
      {!state.busy && !state.operation && (
        <p>
          先选择已校验
          DRAFT，再记录整数帧批注；在修改页保存计划并显式批准，之后手工修改、另存和另行导出候选。
        </p>
      )}
      {job && (
        <article
          key={`${job.operation_id}:${job.assembly_version_id}:${job.assembly_content_hash}:${job.output_sha256}:${job.output_bytes}`}
        >
          <h3>{job.output_filename}</h3>
          <p>
            原版导出：{job.operation_id} · 装配：{job.assembly_version_id}
          </p>
          {job.status === "SUCCEEDED" ? (
            <DraftExportOutput
              projectId={projectId}
              episodeId={episodeId}
              job={job}
              gateway={exports}
              reviewExpanded
              revisionExpanded={view === "changes"}
              onAssembly={props.onAssembly}
              onExport={props.onExport}
            />
          ) : job.error_code === "OUTPUT_CHANGED" ? (
            <DraftReviewNotes
              job={job}
              gateway={exports?.review}
              revision={exports?.revision}
              exports={exports}
              expanded
              revisionExpanded={view === "changes"}
              onAssembly={props.onAssembly}
              onExport={props.onExport}
            />
          ) : (
            <p role="alert">此任务尚无可用的已校验 DRAFT。状态：{job.status}，请在导出页核对。</p>
          )}
        </article>
      )}
      <p>
        整数帧号是批注的精确坐标；播放器定位近似。此工作区不提供正式审片签发或实时未保存剪辑预览。
      </p>
    </section>
  );
}
