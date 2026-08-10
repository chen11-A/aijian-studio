import type { ProjectData, TimelineResponse } from "../../api/studio";

function frameRateLabel(response: TimelineResponse): string {
  const { num, den } = response.data.timeline.sequence_timebase.frame_rate;
  return den === 1 ? `${num} fps` : `${num}/${den} fps`;
}

function durationLabel(response: TimelineResponse): string {
  const { num, den } = response.data.timeline.sequence_timebase.frame_rate;
  const seconds = (response.data.total_duration_frames * den) / num;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

export function TimelineHeader({
  project,
  response,
}: {
  project: ProjectData;
  response: TimelineResponse;
}) {
  const { timeline } = response.data;
  return (
    <header className="timeline-header">
      <div>
        <span className="timeline-state-code">EDIT DESK · {timeline.timeline_id}</span>
        <h2 id="timeline-heading">{project.name} · 主时间线</h2>
      </div>
      <dl>
        <div>
          <dt>版本</dt>
          <dd>REV {timeline.revision}</dd>
        </div>
        <div>
          <dt>画幅</dt>
          <dd>
            {timeline.width} × {timeline.height}
          </dd>
        </div>
        <div>
          <dt>帧率</dt>
          <dd>{frameRateLabel(response)}</dd>
        </div>
        <div>
          <dt>时长</dt>
          <dd>{durationLabel(response)}</dd>
        </div>
      </dl>
    </header>
  );
}

export function TimelineMonitor({
  response,
  clipId,
  assetId,
}: {
  response: TimelineResponse;
  clipId: string | undefined;
  assetId: string | undefined;
}) {
  return (
    <section className="timeline-monitor" aria-label="镜头监视器">
      <div className="monitor-frame">
        <span>PROGRAM</span>
        <strong>{clipId ?? "未选择镜头"}</strong>
        <small>{assetId ?? "—"}</small>
      </div>
      <div className="monitor-meta">
        <span>TC {durationLabel(response)}</span>
        <span>{response.data.total_duration_frames} FRAMES</span>
      </div>
    </section>
  );
}

export function TimelineSequence({
  response,
  selectedClipId,
  onSelect,
}: {
  response: TimelineResponse;
  selectedClipId: string | undefined;
  onSelect(clipId: string): void;
}) {
  const { timeline } = response.data;
  const maxFrames = Math.max(...timeline.clips.map((clip) => clip.duration_frames));
  return (
    <section className="sequence-panel" aria-label="视频时间线">
      <header>
        <div>
          <span>V1</span>
          <strong>主画面</strong>
        </div>
        <small>
          {timeline.clips.length} 个镜头 · {response.data.total_duration_frames} 帧
        </small>
      </header>
      <div className="sequence-track" role="listbox" aria-label="镜头顺序">
        {timeline.clips.map((clip, index) => (
          <button
            key={clip.clip_id}
            type="button"
            role="option"
            aria-selected={clip.clip_id === selectedClipId}
            aria-label={`${clip.clip_id}，第 ${index + 1} 镜，${clip.duration_frames} 帧`}
            className={clip.clip_id === selectedClipId ? "selected" : ""}
            style={{ flexGrow: Math.max(0.45, clip.duration_frames / maxFrames) }}
            onClick={() => onSelect(clip.clip_id)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{clip.clip_id}</strong>
            <small>
              {clip.duration_frames}f · {clip.asset_id}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}
