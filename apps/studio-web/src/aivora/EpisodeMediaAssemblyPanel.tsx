import { AssemblyReadinessPanel } from "./AssemblyReadinessPanel";
import { LocalMediaReviewPanel, type LocalReviewFormState } from "./LocalMediaReviewPanel";
import { AssemblyManualCandidates } from "./AssemblyManualCandidates";
import { ScriptConfirmationImpactHistory } from "./ScriptConfirmationImpactHistory";
import { createStudioTransport } from "../api/studio";
import { AudioAssetProbe } from "./AudioAssetProbe";
import { AssemblyProjectTimebase } from "./AssemblyProjectTimebase";
import { useMediaToolchain } from "./useMediaToolchain";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./Common";
import { AssemblyMediaPreview } from "./AssemblyMediaPreview";
import { SavedCompositionPreview } from "./SavedCompositionPreview";
import { NativeAssemblyPreview } from "./NativeAssemblyPreview";
import { AssemblySubtitleEditor } from "./AssemblySubtitleEditor";
import { AssemblyTrackEditor } from "./AssemblyTrackEditor";
import { AssemblyStoryboardReferences } from "./AssemblyStoryboardReferences";
import { AssemblyDialogueAudioEditor } from "./AssemblyDialogueAudioEditor";
import { AssemblyScriptProvenance } from "./AssemblyScriptProvenance";
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
import { Select } from "./Select";

const playbackLabels = {
  DRAFT_STATIC_ANIMATIC: "图片剪辑草稿",
  DRAFT_VIDEO_PREVIEW: "视频探测通过的剪辑草稿",
  BLOCKED_MEDIA_PROBE: "媒体技术探测未完成或不匹配",
  BLOCKED_MEDIA_BYTES: "原素材不可用",
  BLOCKED_RIGHTS: "素材权利受限",
};

// UI positions only; verified assembly content and UNKNOWN journals retain their existing truth.
export const ASSEMBLY_VIEW_POSITIONS = new Map<
  string,
  { versionId: string; hash: string; segmentId: string; frame: number }
>();

/** Edits immutable local media references. No placeholder shots or simulated sequence playback. */
/** UI-only monitor preference; never part of an assembly or write journal. */
export const ASSEMBLY_MONITOR_SIZES = new Map<string, "compact" | "large">();
export function EpisodeMediaAssemblyPanel(props: EpisodeAssemblyProps & { audioOnly?: boolean }) {
  const audioOnly = props.audioOnly ?? false;
  const audioProbe = useMemo(() => createStudioTransport().audioAssetProbe, []);
  const nativePreview = useMemo(() => createStudioTransport(), []);
  const mediaTools = useMediaToolchain();
  const [subtitlePending, setSubtitlePending] = useState(false);
  const [trimPending, setTrimPending] = useState(false);
  const [scriptSaveBlocked, setScriptSaveBlocked] = useState(false);
  const [reviewState, setReviewState] = useState<LocalReviewFormState>({
    input: false,
    busy: false,
    unknown: false,
    activeTarget: false,
  });
  const reviewPreservation = useRef<(() => boolean) | null>(null);
  const setReviewPreservation = useCallback((guard: (() => boolean) | null) => {
    reviewPreservation.current = guard;
  }, []);
  const preserveReview = useCallback(() => reviewPreservation.current?.() ?? true, []);
  const state = useEpisodeAssembly({
    ...props,
    hasPendingInput: subtitlePending || trimPending || reviewState.input,
    externalWritePending: reviewState.unknown,
    externalWriteBusy: reviewState.busy,
    externalWritePreserved: preserveReview,
    saveBlocked: scriptSaveBlocked,
  });
  const { content, library, version } = state;
  const locked = state.locked || subtitlePending || trimPending || reviewState.input;
  const [assetChoice, setAssetChoice] = useState("");
  const [selected, setSelected] = useState("");
  const [frame, setFrame] = useState(0);
  // Voice hides visual tracks, so it must not overwrite the assembly view's position.
  const viewScope = `${props.projectId}/${props.episodeId}/${audioOnly ? "voice" : "assembly"}`;
  const [monitorPreference, setMonitorPreference] = useState({
    scope: viewScope,
    size: ASSEMBLY_MONITOR_SIZES.get(viewScope) ?? "compact",
  });
  const monitorSize =
    monitorPreference.scope === viewScope
      ? monitorPreference.size
      : (ASSEMBLY_MONITOR_SIZES.get(viewScope) ?? "compact");
  function chooseMonitorSize(size: "compact" | "large") {
    ASSEMBLY_MONITOR_SIZES.set(viewScope, size);
    setMonitorPreference({ scope: viewScope, size });
  }
  const restorePosition = useRef(ASSEMBLY_VIEW_POSITIONS.get(viewScope));
  const [trackKind, setTrackKind] = useState<"BGM" | "SFX">("BGM");
  const [sampleRates, setSampleRates] = useState<Record<string, number>>({});
  const choices = (library ?? []).flatMap((asset) =>
    asset.versions
      .filter(
        (item) =>
          (item.availability === "VERIFIED" || item.availability === "PRESENT_UNVERIFIED") &&
          item.rights_status !== "RESTRICTED" &&
          (!audioOnly || item.kind === "audio"),
      )
      .map((item) => ({ asset, version: item, value: `${asset.id}/${item.id}` })),
  );
  const choice = choices.find((item) => item.value === assetChoice);
  const current = [...content.visual_segments, ...content.audio_segments].find(
    (item) => item.segment_id === selected,
  );
  const currentAsset = current
    ? library?.find((asset) => asset.id === current.media.asset_id)
    : undefined;
  const currentVersion = current ? findAssemblyAsset(library, current.media) : undefined;
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
    restorePosition.current = ASSEMBLY_VIEW_POSITIONS.get(viewScope);
    setSelected("");
    setSubtitlePending(false);
    setTrimPending(false);
    setAssetChoice("");
    setFrame(0);
    setSampleRates({});
  }, [viewScope]);
  useEffect(() => {
    if (
      !state.reliable ||
      state.dirty ||
      !version ||
      version.content.project_id !== props.projectId ||
      version.content.episode_id !== props.episodeId
    )
      return;
    const previous = restorePosition.current;
    if (previous) {
      restorePosition.current = undefined;
      const segments = audioOnly
        ? content.audio_segments
        : [...content.visual_segments, ...content.audio_segments];
      if (
        version.version_id === previous.versionId &&
        version.content_hash === previous.hash &&
        (!previous.segmentId || segments.some((s) => s.segment_id === previous.segmentId)) &&
        Number.isSafeInteger(previous.frame) &&
        previous.frame >= 0 &&
        previous.frame < Math.max(1, content.total_frames)
      ) {
        setSelected(previous.segmentId);
        setFrame(previous.frame);
        return;
      }
      state.setNotice("已保存装配版本或片段范围已变化；未套用原片段与帧定位，请重新选择。");
    }
    ASSEMBLY_VIEW_POSITIONS.set(viewScope, {
      versionId: version.version_id,
      hash: version.content_hash,
      segmentId: selected,
      frame: position,
    });
  }, [
    viewScope,
    props.projectId,
    props.episodeId,
    audioOnly,
    version,
    content,
    selected,
    position,
    state.reliable,
    state.dirty,
    state.setNotice,
  ]);
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
  const overview = (
    <>
      {" "}
      <header>
        <h2>{audioOnly ? "本集声音 · 本地录音 DRAFT" : "本集剪辑 · 本地媒体"}</h2>
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
    </>
  );
  const setup = (
    <>
      {" "}
      {!audioOnly && (
        <div className="assembly-canvas">
          <label>
            保存画幅与分辨率
            <Select
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
            </Select>
          </label>
          <p>
            原素材等比适应画布，空余部分留黑边。保存后导出使用此画幅；修改不会覆盖已保存版本或已导出文件。
          </p>
        </div>
      )}
      {!audioOnly && (
        <AssemblyManualCandidates
          content={content}
          selectedId={selected}
          locked={locked || !props.assembly?.saveExact || !props.assembly.getOriginal}
          gateway={props.candidates}
          onEdit={edit}
          onSelect={select}
        />
      )}
      <div className="assembly-add">
        {!audioOnly && (
          <AssemblyProjectTimebase
            projectId={props.projectId}
            episodeId={props.episodeId}
            content={content}
            locked={locked}
            gateway={
              nativePreview.getProjectSettings
                ? { getProjectSettings: nativePreview.getProjectSettings }
                : undefined
            }
            edit={edit}
          />
        )}
        {!audioOnly && (
          <label>
            序列帧率
            <Select
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
            </Select>
          </label>
        )}
        <label>
          选择已导入素材版本
          <Select
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
          </Select>
        </label>
        {choice?.version.kind === "audio" && (
          <label>
            声音轨道
            <Select
              value={trackKind}
              disabled={locked}
              onChange={(event) => setTrackKind(event.target.value === "SFX" ? "SFX" : "BGM")}
            >
              <option value="BGM">BGM 背景音乐</option>
              <option value="SFX">SFX 音效</option>
            </Select>
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
      <AssemblyReadinessPanel
        projectId={props.projectId}
        episodeId={props.episodeId}
        gateway={nativePreview}
        target={
          version ? { version_id: version.version_id, content_hash: version.content_hash } : null
        }
        dirty={state.dirty || trimPending || subtitlePending}
        pending={state.locked || !state.reliable}
      />
    </>
  );
  const originalMonitor =
    current && state.reliable && !reviewState.activeTarget ? (
      <AssemblyMediaPreview
        key={currentKey}
        projectId={props.projectId}
        media={current.media}
        version={findAssemblyAsset(library, current.media)}
        gateway={props.assets}
        onSampleRate={rateReady}
        compactNotice={!audioOnly}
      />
    ) : null;
  const trackEditor = (
    <AssemblyTrackEditor
      monitor={
        !audioOnly ? (
          <div className="assembly-monitor-cell">
            <div className="assembly-monitor-controls" role="group" aria-label="原件监看尺寸">
              <span>原件监看</span>
              <button
                type="button"
                className="button"
                aria-pressed={monitorSize === "compact"}
                onClick={() => chooseMonitorSize("compact")}
              >
                紧凑监看
              </button>
              <button
                type="button"
                className="button"
                aria-pressed={monitorSize === "large"}
                onClick={() => chooseMonitorSize("large")}
              >
                较大监看
              </button>
            </div>
            {originalMonitor ?? (
              <section
                className="assembly-preview assembly-monitor-empty"
                aria-label="所选原素材预览"
              >
                <p>在时间线选择片段，独立监看核验后的原件。</p>
                <p>裁剪、字幕与混音不在此监看中应用。</p>
              </section>
            )}
          </div>
        ) : undefined
      }
      content={content}
      library={library}
      selected={selected}
      frame={position}
      locked={state.locked || subtitlePending || reviewState.input}
      sampleRate={sampleRate}
      onSelect={select}
      onFrame={setFrame}
      onEdit={edit}
      onNotice={state.setNotice}
      newId={newAssemblySegmentId}
      audioOnly={audioOnly}
      onPendingInput={setTrimPending}
      viewKey={`${viewScope}/${version?.version_id ?? "unsaved"}/${version?.content_hash ?? ""}/${JSON.stringify(content.sequence_timebase)}`}
      canUndo={state.canUndo}
      canRedo={state.canRedo}
      onUndo={(redo) => {
        if (!locked) state.undo(redo);
      }}
    />
  );
  return (
    <section
      className={`v2-media-card episode-assembly ${audioOnly ? "" : "assembly-edit-workbench"}`}
      data-monitor-size={monitorSize}
      aria-label="集级媒体装配"
    >
      {audioOnly && overview}
      {audioOnly && !content.total_frames && (
        <p>
          本集尚无保存的画面范围。先在成片组装中建立并保存画面，再放置录音；现有素材与对白保留。
        </p>
      )}
      {state.notice && (
        <p role="status" className="assembly-notice">
          {state.notice}
        </p>
      )}
      {!library && <p role="status">项目素材尚未可靠读回，不能加入新素材。请重新读取。</p>}
      {state.writeUnknown && <p role="alert">先前写入结果未知；保存已锁定，请准确核对原保存。</p>}
      {state.journalKind === "LEGACY_BLOCKED" && (
        <p role="alert">
          旧版保存日志缺少原UUID，已保留。不能从最新装配内容推断已保存，也不能覆盖或重发。
        </p>
      )}
      <div className="assembly-actions assembly-save-actions" aria-label="装配保存与核对">
        <Button
          primary
          disabled={locked || scriptSaveBlocked || !state.dirty || !content.visual_segments.length}
          onClick={() => void state.save()}
        >
          保存集级媒体装配版本
        </Button>
        <Button disabled={locked || !state.canUndo} onClick={() => state.undo()}>
          撤销
        </Button>
        <Button disabled={locked || !state.canRedo} onClick={() => state.undo(true)}>
          重做
        </Button>

        <Button disabled={state.busy || !state.writeUnknown} onClick={() => void state.recover()}>
          只读准确核对原装配保存
        </Button>
        <Button
          disabled={
            state.busy ||
            subtitlePending ||
            trimPending ||
            reviewState.input ||
            reviewState.busy ||
            reviewState.unknown
          }
          onClick={() => void state.load()}
        >
          重新读取装配与素材
        </Button>
      </div>
      {!audioOnly && trackEditor}
      {audioOnly ? (
        setup
      ) : (
        <details className="assembly-setup" open>
          <summary>装配概况、画布与素材准备</summary>
          <div className="assembly-setup-body">
            {overview}
            {setup}
          </div>
        </details>
      )}
      {audioOnly && trackEditor}
      {!audioOnly && (
        <NativeAssemblyPreview
          projectId={props.projectId}
          episodeId={props.episodeId}
          savedVersion={version}
          eligible={state.reliable && !state.dirty && !locked && !!version}
          planGateway={nativePreview.nativePreviewPlan}
          sessionGateway={nativePreview.mediaPreviewSession}
        />
      )}
      {!audioOnly && (
        <SavedCompositionPreview
          projectId={props.projectId}
          episodeId={props.episodeId}
          savedVersion={version}
          dirty={state.dirty}
          disabled={locked}
          exports={props.exports}
        />
      )}
      {!audioOnly && (
        <AssemblySubtitleEditor
          key={`${props.projectId}:${props.episodeId}`}
          content={content}
          frame={position}
          locked={state.locked || trimPending || reviewState.input}
          onEdit={edit}
          onPendingInput={setSubtitlePending}
          gateway={props.script}
        />
      )}
      {!audioOnly && (
        <AssemblyStoryboardReferences
          content={content}
          selectedId={selected}
          locked={locked}
          onEdit={edit}
        />
      )}
      <AssemblyScriptProvenance
        content={content}
        savedVersion={version}
        locked={locked}
        onEdit={edit}
        onSaveBlocked={setScriptSaveBlocked}
        gateway={props.script}
      />
      <ScriptConfirmationImpactHistory
        projectId={props.projectId}
        assemblyTarget={
          version
            ? {
                episode_id: props.episodeId,
                version_id: version.version_id,
                content_hash: version.content_hash,
              }
            : undefined
        }
        gateway={nativePreview}
      />
      <AssemblyDialogueAudioEditor
        content={content}
        selectedId={selected}
        locked={locked}
        onEdit={edit}
        gateway={props.script}
      />
      {current &&
        currentAsset &&
        currentVersion?.kind === "audio" &&
        state.reliable &&
        !reviewState.activeTarget && (
          <AudioAssetProbe
            projectId={props.projectId}
            asset={currentAsset}
            version={currentVersion}
            gateway={audioProbe}
            canProbe={mediaTools.canProbe}
            disabled={locked}
            onSampleRate={rateReady}
          />
        )}
      {audioOnly && originalMonitor}
      <LocalMediaReviewPanel
        projectId={props.projectId}
        episodeId={props.episodeId}
        savedVersion={version}
        dirty={state.contentDirty || trimPending || subtitlePending}
        disabled={state.busy || !state.reliable || state.writeUnknown}
        audioOnly={audioOnly}
        library={library}
        assets={props.assets}
        gateway={nativePreview}
        onState={setReviewState}
        onPreservationGuard={setReviewPreservation}
      />
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
