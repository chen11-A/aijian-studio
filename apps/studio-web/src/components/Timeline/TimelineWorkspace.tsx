import { useCallback, useEffect, useState } from "react";

import type { ProjectData, StudioTransport, TimelineResponse } from "../../api/studio";
import { TimelineEditor } from "./TimelineEditor";
import "./timeline-workspace.css";

interface TimelineWorkspaceProps {
  project: ProjectData;
  loadTimeline: StudioTransport["getProjectTimeline"];
  trimClip: StudioTransport["trimTimelineClip"];
  reorderClip: StudioTransport["reorderTimelineClip"];
  replaceClip: StudioTransport["replaceTimelineClip"];
}

type LoadState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error" }
  | { kind: "ready"; response: TimelineResponse };

export function TimelineWorkspace({
  project,
  loadTimeline,
  trimClip,
  reorderClip,
  replaceClip,
}: TimelineWorkspaceProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await loadTimeline(project.id);
      setState(response === null ? { kind: "empty" } : { kind: "ready", response });
    } catch {
      setState({ kind: "error" });
    }
  }, [loadTimeline, project.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runCommand = async (command: () => Promise<TimelineResponse>, successMessage: string) => {
    setSaving(true);
    setNotice(null);
    try {
      const response = await command();
      setState({ kind: "ready", response });
      setNotice(successMessage);
    } catch {
      await reload();
      setNotice("修改未写入，时间线可能已更新；已重新载入最新版本。");
    } finally {
      setSaving(false);
    }
  };

  if (state.kind === "loading") {
    return (
      <section className="timeline-loading" aria-busy="true" aria-label="正在载入时间线">
        <div />
        <div />
        <div />
      </section>
    );
  }

  if (state.kind === "error") {
    return (
      <section className="timeline-state timeline-state-error" role="alert">
        <span className="timeline-state-code">TIMELINE OFFLINE</span>
        <h2>无法读取时间线</h2>
        <p>项目数据没有被修改。请确认本地创作引擎在线后重试。</p>
        <button className="secondary-button" onClick={() => void reload()}>
          重新载入
        </button>
      </section>
    );
  }

  if (state.kind === "empty") {
    return (
      <section className="timeline-state timeline-empty">
        <div className="empty-sequence" aria-hidden="true">
          <span>01</span>
          <span>02</span>
          <span>03</span>
        </div>
        <span className="timeline-state-code">EDIT DESK · WAITING FOR SHOTS</span>
        <h2>时间线尚未生成</h2>
        <p>先完成分镜与素材生成。首批可编辑镜头就绪后，会在这里建立可追溯的剪辑版本。</p>
        <div className="timeline-next-step">
          <strong>先完成分镜与素材生成</strong>
          <span>故事工坊 → 分镜导演 → 素材中心 → 剪辑台</span>
        </div>
      </section>
    );
  }

  return (
    <TimelineEditor
      project={project}
      response={state.response}
      saving={saving}
      notice={notice}
      trimClip={trimClip}
      reorderClip={reorderClip}
      replaceClip={replaceClip}
      runCommand={runCommand}
    />
  );
}
