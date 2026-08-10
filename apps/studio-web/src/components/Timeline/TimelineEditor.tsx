import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import type {
  ProjectData,
  ReorderTimelineClipInput,
  ReplaceTimelineClipInput,
  StudioTransport,
  TimelineResponse,
  TrimTimelineClipInput,
} from "../../api/studio";
import { TimelineHeader, TimelineMonitor, TimelineSequence } from "./TimelinePresentation";

interface TimelineEditorProps {
  project: ProjectData;
  response: TimelineResponse;
  saving: boolean;
  notice: string | null;
  trimClip: StudioTransport["trimTimelineClip"];
  reorderClip: StudioTransport["reorderTimelineClip"];
  replaceClip: StudioTransport["replaceTimelineClip"];
  runCommand(command: () => Promise<TimelineResponse>, successMessage: string): Promise<void>;
}

export function TimelineEditor({
  project,
  response,
  saving,
  notice,
  trimClip,
  reorderClip,
  replaceClip,
  runCommand,
}: TimelineEditorProps) {
  const { timeline } = response.data;
  const [selectedClipId, setSelectedClipId] = useState(timeline.clips[0]?.clip_id ?? null);
  const [sourceIn, setSourceIn] = useState(0);
  const [duration, setDuration] = useState(1);
  const [replacementAssetId, setReplacementAssetId] = useState("");
  const selected = useMemo(
    () => timeline.clips.find((clip) => clip.clip_id === selectedClipId) ?? timeline.clips[0],
    [selectedClipId, timeline.clips],
  );

  useEffect(() => {
    if (!selected) return;
    setSelectedClipId(selected.clip_id);
    setSourceIn(selected.source_in_frame);
    setDuration(selected.duration_frames);
    setReplacementAssetId(selected.asset_id);
  }, [selected]);

  const selectedIndex = timeline.clips.findIndex((clip) => clip.clip_id === selected?.clip_id);
  const selectedAsset = timeline.assets.find((asset) => asset.asset_id === selected?.asset_id);

  const submitTrim = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    const input: TrimTimelineClipInput = {
      clip_id: selected.clip_id,
      new_source_in_frame: sourceIn,
      new_duration_frames: duration,
      expected_revision: timeline.revision,
    };
    void runCommand(() => trimClip(project.id, input), "裁剪已保存为新的不可变版本。");
  };

  const move = (offset: -1 | 1) => {
    if (!selected) return;
    const input: ReorderTimelineClipInput = {
      clip_id: selected.clip_id,
      new_index: selectedIndex + offset,
      expected_revision: timeline.revision,
    };
    void runCommand(() => reorderClip(project.id, input), "镜头顺序已更新。");
  };

  const replace = () => {
    if (!selected) return;
    const input: ReplaceTimelineClipInput = {
      clip_id: selected.clip_id,
      replacement_asset_id: replacementAssetId,
      replacement_source_in_frame: sourceIn,
      expected_revision: timeline.revision,
    };
    void runCommand(() => replaceClip(project.id, input), "素材替换已保存。");
  };

  return (
    <section className="timeline-workspace" aria-labelledby="timeline-heading">
      <TimelineHeader project={project} response={response} />

      {notice && (
        <p className="timeline-notice" role="alert">
          {notice}
        </p>
      )}

      <div className="timeline-edit-grid">
        <TimelineMonitor
          response={response}
          clipId={selected?.clip_id}
          assetId={selectedAsset?.asset_id}
        />

        <aside className="clip-inspector" aria-label="镜头检查器">
          <div className="inspector-title">
            <div>
              <span>CLIP INSPECTOR</span>
              <h3>{selected?.clip_id ?? "选择镜头"}</h3>
            </div>
            <div className="reorder-actions">
              <button
                aria-label="镜头前移"
                disabled={saving || selectedIndex <= 0}
                onClick={() => move(-1)}
              >
                ←
              </button>
              <button
                aria-label="镜头后移"
                disabled={saving || selectedIndex < 0 || selectedIndex >= timeline.clips.length - 1}
                onClick={() => move(1)}
              >
                →
              </button>
            </div>
          </div>
          <form onSubmit={submitTrim}>
            <label>
              源入点（帧）
              <input
                aria-label="源入点（帧）"
                type="number"
                min={0}
                value={sourceIn}
                onChange={(event) => setSourceIn(Number(event.target.value))}
              />
            </label>
            <label>
              持续（帧）
              <input
                aria-label="持续（帧）"
                type="number"
                min={1}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </label>
            <button className="accent-button" disabled={saving || !selected} type="submit">
              {saving ? "保存中…" : "应用裁剪"}
            </button>
          </form>
          <div className="replace-control">
            <label htmlFor="replacement-asset">替换素材</label>
            <select
              id="replacement-asset"
              value={replacementAssetId}
              onChange={(event) => setReplacementAssetId(event.target.value)}
            >
              {timeline.assets.map((asset) => (
                <option key={asset.asset_id} value={asset.asset_id}>
                  {asset.asset_id}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              disabled={saving || !selected || replacementAssetId === selected?.asset_id}
              onClick={replace}
            >
              替换当前素材
            </button>
          </div>
        </aside>
      </div>

      <TimelineSequence
        response={response}
        selectedClipId={selected?.clip_id}
        onSelect={setSelectedClipId}
      />
    </section>
  );
}
