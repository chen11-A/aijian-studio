import { useState } from "react";

import type { ProjectData, TimelineResponse } from "../../api/studio";
import "./fake-workflow.css";

interface FakeWorkflowPanelProps {
  project: ProjectData;
  sourceFilename: string;
  startWorkflow(projectId: string): Promise<TimelineResponse>;
  onOpenQueue(): void;
  onOpenTimeline(): void;
}

type LaunchState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "success"; response: TimelineResponse }
  | { kind: "error" };

export function FakeWorkflowPanel({
  project,
  sourceFilename,
  startWorkflow,
  onOpenQueue,
  onOpenTimeline,
}: FakeWorkflowPanelProps) {
  const [state, setState] = useState<LaunchState>({ kind: "idle" });

  const start = async () => {
    setState({ kind: "running" });
    try {
      setState({ kind: "success", response: await startWorkflow(project.id) });
    } catch {
      setState({ kind: "error" });
    }
  };

  return (
    <section className="fake-workflow-panel" aria-labelledby="fake-workflow-title">
      <div className="fake-workflow-copy">
        <span className="eyebrow">LOCAL PREVIEW · NO COST</span>
        <h3 id="fake-workflow-title">把来源送入确定性制作演练</h3>
        <p>
          使用 <strong>{sourceFilename}</strong> 建立三镜头竖屏预览、任务记录和可编辑时间线。
          不调用付费 API，也不会把 Fake 素材标记为正式成片素材。
        </p>
      </div>

      {(state.kind === "idle" || state.kind === "running" || state.kind === "error") && (
        <div className="fake-workflow-action">
          {state.kind === "error" && (
            <p role="alert">生成未完成；原文和已有时间线都没有被覆盖，可以安全重试。</p>
          )}
          <button
            className="accent-button"
            disabled={state.kind === "running"}
            onClick={() => void start()}
          >
            {state.kind === "running"
              ? "正在建立任务与时间线…"
              : state.kind === "error"
                ? "重新生成 Fake 分镜时间线"
                : "生成 Fake 分镜时间线"}
          </button>
        </div>
      )}

      {state.kind === "success" && (
        <div className="fake-workflow-result" role="status">
          <div>
            <span>PREVIEW READY</span>
            <strong>
              {state.response.data.timeline.clips.length} 个镜头 · REV{" "}
              {state.response.data.timeline.revision}
            </strong>
            <small>输出已绑定任务 Attempt，并保存为不可变 Artifact 版本。</small>
          </div>
          <div className="fake-workflow-links">
            <button className="secondary-button" onClick={onOpenQueue}>
              查看任务记录
            </button>
            <button className="accent-button" onClick={onOpenTimeline}>
              进入剪辑台
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
