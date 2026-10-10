import { useCallback, useEffect, useState } from "react";
import { Button } from "./Common";
import { AssemblyMediaPreview } from "./AssemblyMediaPreview";
import { SavedCompositionPreview } from "./SavedCompositionPreview";
import { AssemblySubtitleEditor } from "./AssemblySubtitleEditor";
import { AssemblyTrackEditor } from "./AssemblyTrackEditor";
import { AssemblyStoryboardReferences } from "./AssemblyStoryboardReferences";
import { AssemblyDialogueAudioEditor } from "./AssemblyDialogueAudioEditor";
import { useEpisodeAssembly } from "./useEpisodeAssembly";
import type { EpisodeAssemblyProps } from "./useEpisodeAssembly";
import {
  ASSEMBLY_TIMEBASES,
  assemblyMediaKey,
  assemblySeconds,
  findAssemblyAsset,
  newAssemblySegmentId,
} from "./adapters/assemblyEditing";
import type {
  AssemblyAudioSegment,
  AssemblyContent,
  AssemblyVisualSegment,
} from "./adapters/episodeMediaAssembly";
import "./episode-assembly.css";
import { ASSEMBLY_CANVASES, canvasKey } from "./adapters/assemblyCanvas";

const playbackLabels = {
  DRAFT_STATIC_ANIMATIC: "图片剪辑草稿",
  DRAFT_VIDEO_PREVIEW: "视频探测通过的剪辑草稿",
  BLOCKED_MEDIA_PROBE: "媒体技术探测未完成或不匹配",
  BLOCKED_MEDIA_BYTES: "原素材不可用",
  BLOCKED_RIGHTS: "素材权利受限",
};

/** Edits immutable local media references. No placeholder shots or simulated sequence playback. */
export function EpisodeMediaAssemblyPanel(props: EpisodeAssemblyProps) {
  const [subtitlePending, setSubtitlePending] = useState(false);
  const state = useEpisodeAssembly({ ...props, hasPendingInput: subtitlePending });
  const { content, library, version } = state;
  const locked = state.locked || subtitlePending;
  const [assetChoice, setAssetChoice] = useState("");
  const [selected, setSelected] = useState("");
  const [frame, setFrame] = useState(0);
  const [trackKind, setTrackKind] = useState<"BGM" | "SFX">("BGM");
  const [sampleRates, setSampleRates] = useState<Record<string, number>>({});
  const choices = (library ?? []).flatMap((asset) =>
    asset.versions
      .filter(
        (item) =>
          (item.availability === "VERIFIED" || item.availability === "PRESENT_UNVERIFIED") &&
          item.rights_status !== "RESTRICTED",
      )
      .map((item) => ({ asset, version: item, value: `${asset.id}/${item.id}` })),
  );
  const choice = choices.find((item) => item.value === assetChoice);
  const current = [...content.visual_segments, ...content.audio_segments].find(
    (item) => item.segment_id === selected,
  );
  const currentKey = current ? assemblyMediaKey(current.media) : "";
  const sampleRate = currentKey ? sampleRates[currentKey] : undefined;
  const rateReady = useCallback(
    (rate: number) => {
      if (currentKey)
        setSampleRates((old) => (old[currentKey] === rate ? old : { ...old, [currentKey]: rate }));
    },
    [currentKey],
  );
  const position = Math.max(0, Math.min(frame, content.total_frames - 1));
  const timebaseChoice = ASSEMBLY_TIMEBASES.findIndex(
    (item) =>
      item.value.frame_rate.num === content.sequence_timebase.frame_rate.num &&
      item.value.frame_rate.den === content.sequence_timebase.frame_rate.den &&
      item.value.timecode_mode === content.sequence_timebase.timecode_mode,
  );
  useEffect(() => {
    setSelected("");
    setSubtitlePending(false);
    setAssetChoice("");
    setFrame(0);
    setSampleRates({});
  }, [props.projectId, props.episodeId]);
  function select(id: string, at: number) {
    setSelected(id);
    setFrame(at);
  }
  function edit(next: AssemblyContent) {
    return state.edit(next);
  }
  function add() {
    if (!choice || locked) return;
    const { asset, version: item } = choice;
    const media = { asset_id: asset.id, asset_version_id: item.id, sha256: item.sha256 };
    const segment_id = newAssemblySegmentId();
    const duration = Math.max(
      1,
      Math.round(
        (2 * content.sequence_timebase.frame_rate.num) / content.sequence_timebase.frame_rate.den,
      ),
    );
    if (item.kind === "audio") {
      if (!content.total_frames) {
        state.setNotice("请先加入画面，再放置声音。");
        return;
      }
      const segment: AssemblyAudioSegment = {
        segment_id,
        media,
        track_kind: trackKind,
        start_frame: position,
        end_frame: Math.min(content.total_frames, position + duration),
        source_in_sample: 0,
        script_version_id: null,
        script_block_id: null,
        speaker_id: null,
        delivery: null,
      };
      if (edit({ ...content, audio_segments: [...content.audio_segments, segment] }))
        select(segment_id, segment.start_frame);
    } else {
      const segment: AssemblyVisualSegment = {
        segment_id,
        media,
        media_kind: item.kind,
        start_frame: content.total_frames,
        end_frame: content.total_frames + duration,
        source_in_frame: 0,
        embedded_audio: "MUTE",
      };
      if (
        edit({
          ...content,
          total_frames: segment.end_frame,
          visual_segments: [...content.visual_segments, segment],
        })
      )
        select(segment_id, segment.start_frame);
    }
  }
  return (
    <section className="v2-media-card episode-assembly" aria-label="集级媒体装配">
      <header>
        <h2>本集剪辑 · 本地媒体</h2>
        <p>真实导入素材的剪辑草稿，可保存、重新打开和继续修改。</p>
      </header>
      <div className="assembly-summary">
        <span>
          {content.visual_segments.length} 个画面 · {content.audio_segments.length} 个声音 ·{" "}
          {content.subtitle_segments.length} 条字幕
        </span>
        <span>
          {content.total_frames} 帧 · {assemblySeconds(content.total_frames, content).toFixed(3)} 秒
        </span>
        <span>{state.dirty ? "有未保存修改" : version ? "已读回保存版本" : "尚未保存"}</span>
      </div>
      <div className="assembly-canvas">
        <label>
          保存画幅与分辨率
          <select
            value={canvasKey(content.canvas_width, content.canvas_height)}
            disabled={locked}
            onChange={(event) => {
              const choice = ASSEMBLY_CANVASES.find(
                (item) => canvasKey(item.width, item.height) === event.currentTarget.value,
              );
              if (choice)
                edit({ ...content, canvas_width: choice.width, canvas_height: choice.height });
            }}
          >
            {!ASSEMBLY_CANVASES.some(
              (item) =>
                item.width === content.canvas_width && item.height === content.canvas_height,
            ) && (
              <option value={canvasKey(content.canvas_width, content.canvas_height)}>
                已保存画布 · {content.canvas_width} × {content.canvas_height}
              </option>
            )}
            {ASSEMBLY_CANVASES.map((item) => (
              <option
                key={canvasKey(item.width, item.height)}
                value={canvasKey(item.width, item.height)}
              >
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <p>
          原素材等比适应画布，空余部分留黑边。保存后导出使用此画幅；修改不会覆盖已保存版本或已导出文件。
        </p>
      </div>
      {state.notice && (
        <p role="status" className="assembly-notice">
          {state.notice}
        </p>
      )}
      {!library && <p role="status">项目素材尚未可靠读回，不能加入新素材。请重新读取。</p>}
      {state.writeUnknown && <p role="alert">先前写入结果未知；保存已锁定，只能重新读取核对。</p>}
      <div className="assembly-actions">
        <Button disabled={state.busy || subtitlePending} onClick={() => void state.load()}>
          重新读取装配与素材
        </Button>
        <Button disabled={locked || !state.canUndo} onClick={() => state.undo()}>
          撤销
        </Button>
        <Button disabled={locked || !state.canRedo} onClick={() => state.undo(true)}>
          重做
        </Button>
        <Button
          primary
          disabled={locked || !state.dirty || !content.visual_segments.length}
          onClick={() => void state.save()}
        >
          保存集级媒体装配版本
        </Button>
      </div>
      <div className="assembly-add">
        <label>
          序列帧率
          <select
            value={timebaseChoice}
            disabled={locked || !!content.visual_segments.length}
            onChange={(event) => {
              const option = ASSEMBLY_TIMEBASES[Number(event.target.value)];
              if (option) edit({ ...content, sequence_timebase: option.value });
            }}
          >
            {ASSEMBLY_TIMEBASES.map((item, index) => (
              <option key={item.label} value={index}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          选择已导入素材版本
          <select
            value={assetChoice}
            disabled={locked}
            onChange={(event) => setAssetChoice(event.target.value)}
          >
            <option value="">从项目素材库选择</option>
            {choices.map((item) => (
              <option key={item.value} value={item.value}>
                {item.version.filename} · {item.version.kind} · v{item.version.ordinal}
                {item.version.availability === "PRESENT_UNVERIFIED" ? " · 保存时核验原件" : ""}
              </option>
            ))}
          </select>
        </label>
        {choice?.version.kind === "audio" && (
          <label>
            声音轨道
            <select
              value={trackKind}
              disabled={locked}
              onChange={(event) => setTrackKind(event.target.value === "SFX" ? "SFX" : "BGM")}
            >
              <option value="BGM">BGM 背景音乐</option>
              <option value="SFX">SFX 音效</option>
            </select>
          </label>
        )}
        <Button
          disabled={locked || !choice || (choice.version.kind === "audio" && !content.total_frames)}
          onClick={add}
        >
          加入{choice?.version.kind === "audio" ? "音频片段" : "画面轨"}
        </Button>
      </div>
      <p>
        新片段初始为约 2
        秒的剪辑范围，请按原件长度裁剪。序列帧率在加入画面后锁定；已有版本会保留原有理帧率。素材导入在「素材库」完成。
      </p>
      <AssemblyTrackEditor
        content={content}
        library={library}
        selected={selected}
        frame={position}
        locked={locked}
        sampleRate={sampleRate}
        onSelect={select}
        onFrame={setFrame}
        onEdit={edit}
        onNotice={state.setNotice}
        newId={newAssemblySegmentId}
      />
      <SavedCompositionPreview
        projectId={props.projectId}
        episodeId={props.episodeId}
        savedVersion={version}
        dirty={state.dirty}
        disabled={locked}
        exports={props.exports}
      />
      <AssemblySubtitleEditor
        key={`${props.projectId}:${props.episodeId}`}
        content={content}
        frame={position}
        locked={state.locked}
        onEdit={edit}
        onPendingInput={setSubtitlePending}
      />
      <AssemblyStoryboardReferences
        content={content}
        selectedId={selected}
        locked={locked}
        onEdit={edit}
      />
      <AssemblyDialogueAudioEditor
        content={content}
        selectedId={selected}
        locked={locked}
        onEdit={edit}
        gateway={props.script}
      />
      {current && state.reliable && (
        <AssemblyMediaPreview
          key={currentKey}
          projectId={props.projectId}
          media={current.media}
          version={findAssemblyAsset(library, current.media)}
          gateway={props.assets}
          onSampleRate={rateReady}
        />
      )}
      <p className="assembly-limit">
        当前支持所选原素材独立预览。保存并核对版本后，可导出本地 DRAFT MP4
        草稿；导出时会核验原件并检查支持的轨道。连续预览需基于已保存版本单独生成；正式审片尚未接通，草稿不代表正式发布批准。
      </p>
      {version && (
        <details>
          <summary>版本与技术状态</summary>
          <p>{playbackLabels[version.playback_status]} · 正式导出未批准</p>
          <p>
            版本 {version.version_id} · 修订 {version.head_revision}
          </p>
          <p>
            {props.projectId} / {props.episodeId}
          </p>
          <ul>
            {version.media_checks.map((check) => (
              <li key={assemblyMediaKey(check.media)}>
                {findAssemblyAsset(library, check.media)?.filename ?? check.media.asset_version_id}{" "}
                · {check.availability} · {check.technical_status} · {check.rights_status}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
