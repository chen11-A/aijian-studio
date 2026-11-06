import { bindPreparedVoice, isPreparedVoice, preparedVoiceBinding } from "./actions/prepared-voice";
import { audioTimelineBox } from "./audio-mix-timeline";
import { AUDIO_LANE_GAIN_DB, AUDIO_LANE_LABEL } from "../film/audio";
import { AudioMixPreview } from "./AudioMixPreview";
import { AudioLaneControls } from "./AudioLaneControls";
import { useAudioMixPreview, type AudioPreviewView } from "./use-audio-mix-preview";
import { audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import type { AudioMixPreviewResult, MixLane } from "@aijian/contracts/film-audio-mix";
import { SevenPartVideoReview } from "../next/SevenPartVideoReview";
import {
  compileSevenPartVideo,
  reviewedVideoText,
  VIDEO_FACTS_STALE,
} from "../film/seven-part-video";
import { rangeVideoBody } from "./actions/video-prompt-review";
import { ProjectArchiveDialog } from "./ProjectArchiveDialog";
import { useBundledAudioLibrary } from "./use-bundled-audio-library";
import { exportProjectArchive } from "./actions/project-archive";
import { executeRangeRedo, type RangeReady } from "./actions/range-redo";
import {
  prepareHistoryInput,
  historyRecordHash,
  historyEntryView,
} from "./actions/persistent-history";
import type { FilmHistoryEntry } from "@aijian/contracts/film-history";
import { audioWaveformToken } from "../film/audio-waveform-data";
import { invalidateAudioWaveforms } from "./actions/audio-waveforms";
import { useAudioWaveforms } from "./use-audio-waveforms";
import { legacyCleanCopyTargets, cleanCopySelectionHash } from "./actions/clean-copy-recovery";
import { ExportProgress } from "../next/ExportProgress";
import { acceptExportProgress, type ExportProgressScope } from "./actions/export-progress";
import type { FilmExportProgressEvent } from "@aijian/contracts/film-export-qc";
import type { FilmExportQcInput, FilmExportQcPrepared } from "@aijian/contracts/film-export-qc";
import { ExportCheck } from "../next/ExportCheck";
import { readQcReport, type QcIssue } from "../next/qcReport";
import { filmQcInput, filmQcKey, qcFailureText } from "./actions/export-qc";
import { prepareShotSceneReferences } from "./actions/scene-references";
import { projectArtStyleFields } from "./actions/art-style-field-rows";
import {
  generationPreflight,
  prepareGeneration,
  prepareGenerationRetry,
} from "./actions/generation-prepare";
import { editorCompletionCurrent } from "./actions/editor-completion";
import {
  prepareDirectorConfirmation,
  applyStoryConfirmation,
  type StoryConfirmation,
} from "./actions/story-confirmation";
import {
  prepareExplicitShotSplitTransaction,
  prepareWriterTransaction,
} from "./actions/story-structure-transaction";
import {
  prepareShotDirection,
  applyShotDirection,
  type ShotDirectionTransaction,
} from "./actions/shot-direction-transaction";
import { retryDirectorDraft } from "./actions/director-retry";
import { historyCheckpoint } from "./actions/history-checkpoint";
import {
  captureBookImportInput,
  prepareBookImport,
  applyBookImportSource,
  bookImportInputUnchanged,
} from "./actions/book-import";
import { isBillingProjectId, resolveBillingProject } from "./actions/billing-project";
import { prepareVoicePreview, type VoicePreview } from "./actions/voice-preview";
import { PreviewFullscreen } from "./PreviewFullscreen";
import { ReplyCaptureSettings } from "./ReplyCaptureSettings";
import { CleanCopyRepair } from "./CleanCopyRepair";
import { planShotDuration, durationInputUnchanged } from "./actions/shot-duration";
import {
  prepareArtTransaction,
  applyArtTransaction,
  type ArtTransaction,
} from "./actions/art-transaction";
import { generateShotStill } from "./actions/shot-still";
import { reviewShotText } from "./actions/text-review";
import { createEditorPageHistory } from "./actions/page-history";
import { createEditorHost } from "./actions/editor-host";
import type { EditorSuggestion } from "./actions/editor-changes";
import type { EditorSelection } from "./actions/editor-context";
import { runPreparedGeneration } from "./actions/generation-run";
import { preparePortraitIdentity } from "./actions/portrait-identity";
import { castExtractionStory, extractAndMergeCast } from "./actions/cast";
import { planDirectorDraft, type DirectorDraftResult } from "./actions/director-draft";
import { planWriterDraft, writerDraftInput, type WriterDraftResult } from "./actions/writer";
import { planActionDraft } from "./actions/action";
import { planPerformanceDraft } from "./actions/performance";
import { planPrompterDraft } from "./actions/prompter";
import { projectShotPromptFields } from "./actions/shot-prompt-field-rows";
import type { SuggestionFieldRow } from "../next/SuggestionFieldDiff";
import { planArtDraft } from "./actions/art";
import { globalEditorRequest } from "./actions/editor-request-context";
import { applyContinuityChecks } from "../film/continuity-rules";
import { continuityFailureNotice } from "./continuity-frame";
import { setFilmStyle, styleFailureNotice } from "../film/style-bible";
import { createPipelineControls } from "./pipeline-controls";
import { createPipelineWorkspaceHost, type PipelineVideoHost } from "./pipeline-workspace-host";
import { createFilmPersistence } from "./film-persistence";
import { stillFailureNotice } from "./workflow";
import { coverageNotice } from "../film/coverage-notice";
import { useProductionActions } from "./use-production-actions";
import { BatchProgressView } from "../next/wiring/BatchProgressView";
import { useWorkOwners } from "./use-work-owners";
import { remakeCleanCopies, shotsNeedingCleanCopy } from "./actions/clean-copy";
import { revoiceFilmShot } from "./media-tasks";
import { deleteCurrentFilm } from "./delete-workflow";
import { makeFourStills } from "./still-workflow";
import {
  cutPosition,
  cutSegments,
  cutTimeAt,
  editClipLayout,
  fitZoom,
  playheadX,
  pointAt,
  PX_PER_SECOND,
  rulerStep,
  shotReady,
  spacedTicks,
  stepZoom,
  ticksOutsideFolds,
  timelineSeconds,
  xAtSeconds,
} from "./edit-timeline";
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  addShot,
  clock,
  continuityPrompt,
  CONTINUITY_REASON,
  DESKTOP_REASON,
  ensureLocations,
  chosenExport,
  confirmEstimate,
  storyFilmBatches,
  filmFileName,
  LOUDNESS_NOTE,
  assignActionBeats,
  moveShot,
  portraitPrompts,
  shotProgress,
  voiceLabel,
  removeShot,
  generationEstimate,
  spokenLine,
  draftFaceWarning,
  dialogueTracks,
  fitShotToLine,
  subtitleCues,
  updateShot,
} from "../film/operations";
import { type AudioClip } from "../film/audio";
import {
  activeFilmId,
  BROWSER_DIRECTORY,
  filmDiskReady,
  listEpisodes,
  listFilms,
  readSaved,
  renameFilm,
  saveFilm as writeFilm,
  type EpisodeEntry,
  type FilmIndexEntry,
} from "../film/library";
import {
  blankFilm,
  upgradeFilm,
  keyframePrompt,
  interruptStaleWork,
  newEpisode,
  sampleFilm,
  textModel,
  STYLE_PRESETS,
  type FilmProject,
  type FilmScene,
  type FilmShot,
} from "../film/project";
import {
  appearanceMark,
  classifyShotSize,
  DIFFICULTY_LEGEND,
  FILM_TEMPLATES,
  missingIdentityLocks,
  SHOT_SIZES,
  shotPerson,
} from "../film/phase2";
import { grokBridge } from "../grok-auth/transport";
import { useGrokAccount, useGrokConnected, useGrokDenied } from "../grok-auth/useGrokConnected";
import { videoActions, GENERATE_MODEL, type VideoAction } from "./capabilities";
import { Ic } from "./icons";
import "./pro.css";
import {
  failRunningVideoTasks,
  failQueuedVideoPrerequisites,
  pruneCancelledJobs,
  canResumeTake,
  retryableVideoTask,
  cancelVideoTask,
} from "../film/generation-queue";
import { useScopedSuggestions } from "./use-scoped-suggestions";
import { presentNotice, NOTICE_TEXT } from "../film/notices";
import type { CoverInput, SubtitleStyleId, UiNotice } from "../film/contracts3j";
import { enrichDirectorPlan } from "./enrichment-workflow";
import { makeAllPortraits } from "./portrait-workflow";
import { RequestSequences } from "./director-workflow";
import { sceneShotBudget, formatShotBudget, sceneDisplayTitle } from "../film/director-continuity";
import { completeMembershipAgent } from "./agent-workflow";
import { publishFilmJobs } from "../film/task-progress";
import { TaskCenter } from "../next/TaskCenter";
import { feedProgress, namedTasks, useTaskFeed } from "../next/wiring/taskFeed";
import { useCoverageRepair } from "../next/wiring/useCoverageRepair";
import { useStatusNotice } from "../next/wiring/statusNotice";
import { useDismiss } from "../next/wiring/dismiss";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "../next/ContextMenu";
import { SHOT_DRAG_TYPE, movedNotice, moveShotBy, readShotDrag } from "./shot-order";
import { portraitFeed, type PortraitFeed } from "../next/wiring/portraitFeed";
import { NoticeLog } from "../next/NoticeLog";
import { BEAT_DRAG_TYPE, SceneAlerts } from "../next/SceneAlerts";
import { HomeStart, type Aspect } from "../next/HomeStart";
import { PipelineSteps } from "../next/PipelineSteps";
import { TakePicker } from "../next/TakePicker";
import { takePickerData } from "../next/adapters/takePicker";
import { needsRestyle } from "../next/adapters/restyle";
import { lipSyncTag } from "../next/adapters/lipSync";
import { selection, takeBadge } from "../next/adapters/takeBadge";
import { continuityNotes } from "../next/adapters/continuity";
import { pipelineSceneName, pipelineTargetName } from "../next/adapters/pipelineNames";
import { stageProgress, stageTabs } from "../next/adapters/stageProgress";
import { exportLead } from "../next/adapters/primaryAction";
import type { SuggestionItem } from "../next/adapters/suggestionDiff";
import { SuggestionCard } from "../next/SuggestionCard";
import { useAssistantKey } from "../next/wiring/assistantKey";
import { videoLine } from "../next/shot";
import { SoundPanel, type Mood } from "../next/SoundPanel";
import { soundPanelData } from "../next/adapters/soundPanel";
import { SubtitleStyle } from "../next/SubtitleStyle";
import { subtitleStyleData } from "../next/adapters/subtitleStyle";
import { CoverEditor } from "../next/CoverEditor";
import { coverEditorData } from "../next/adapters/coverEditor";
import { HistoryList } from "../next/HistoryList";
import { readGroupOpen, readPrefs, writeGroupOpen, writePrefs, type AppPrefs } from "./prefs";
import {
  AGE_BANDS,
  GENDERS,
  voiceGroups,
  type AgeBand,
  type Gender,
} from "../next/adapters/voices";
import {
  dialogueMuted,
  isVoiceFile,
  assistantInputVersion,
  fileMediaUrl,
  requestFilmStill,
  shotFrame,
  hydrateFilm,
  filmSignature,
  assembleCurrentFilm,
  retryDirectorTimeout,
  type AgentReply,
  type AgentRequestControl,
} from "./workflow";

type Stage = "script" | "cast" | "board" | "edit";
type Role = "writer" | "director" | "action" | "performance" | "art" | "prompter" | "qc";

type StoryDraft = { transaction: StoryConfirmation; origin: EditorSelection };
type RoleCard = {
  storyDraft?: StoryDraft;
  directionDiff?: ShotDirectionTransaction;
  artDiff?: ArtTransaction;
  editorDiff?: EditorSuggestion;
  editorRequestId?: number;
  editorTurnId?: string;
  fieldRows?: SuggestionFieldRow[];
  title: string;
  rows: { id: string; mark: string; text: string; tail: string }[];
  notes: string[];
  applied: boolean;
  mode: "scenes" | "shots" | "art" | "qc";
  scenes?: FilmScene[];
  shots?: FilmShot[];
  actionState?: FilmScene["actionState"];
  performanceState?: FilmScene["performanceState"];
};
type FixAction = VideoAction;

type PipelineGenerationHost = PipelineVideoHost;

/** 4C-U04: the keys the workspace answers to, as 设置 lists them. */
const SHORTCUTS: readonly (readonly [string, string])[] = [
  ["1 – 4", "换到剧本、角色与场景、分镜、剪辑"],
  ["Ctrl+Z", "撤销"],
  ["Ctrl+Shift+Z", "重做"],
  ["Ctrl+J", "打开或收起 AI 助手"],
  ["空格", "剪辑页播放 / 暂停"],
  ["J / K / L", "剪辑页倒放 / 停 / 播放，再按 J 或 L 更快"],
  ["← / →", "剪辑页退一帧 / 进一帧，按住 Shift 一次一秒"],
  ["↑ / ↓", "剪辑页跳到上一个 / 下一个镜头的开头"],
  ["I / O", "剪辑页设入点 / 出点"],
  ["Delete", "剪辑页剪掉选中的片段"],
  ["Ctrl+滚轮", "剪辑页时间线放大 / 缩小"],
  ["F", "剪辑页预览全屏 / 退出全屏"],
  ["M", "预览静音 / 有声"],
  ["Esc", "退出预览全屏，或关掉菜单和对话框"],
];

/** 5-3-09: ← / → move the playhead one frame at 30 frames a second. */
const FRAME_SECONDS = 1 / 30;

/** 4A-U11: notices after an assistant's suggestion was put in; the status bar offers 撤销. */
const APPLIED_CODES = new Set(["SCRIPT_APPLIED", "ART_APPLIED", "SHOT_APPLIED", "SHOTS_APPLIED"]);

const STAGES: { id: Stage; label: string }[] = [
  { id: "script", label: "剧本" },
  { id: "cast", label: "角色与场景" },
  { id: "board", label: "分镜" },
  { id: "edit", label: "剪辑" },
];

const SIGN_IN_NOTE = "网页版不能登录，请在电脑上装好的 AIVORA 里登录。";
const ROUGH_CUT_REASON = "几个镜头没能接成一段，所以没有导出。可以再试一次。";

const ROLE_COPY: Record<Role, string> = {
  writer: "编剧：把想法或小说收成一场一场的剧本。确认前不会改你写过的字。",
  director: "导演：把剧本拆成镜头，定好景别、时长和节奏。",
  action: "动作指导：把打斗拆成一拍一拍的动作，标出力度、方向和慢镜。",
  performance: "表演指导：给每个镜头写情绪、眼神和语气。两人以上要写视线交接。",
  art: "美术：定画风，给每个角色一句固定外貌，并写下场景和道具。",
  prompter: "画面说明：把这一镜写成给 AI 看的画面说明。",
  qc: "审片：只看文字，不看画面。挑哪一版由你定。",
};

function fieldHost(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function insideField(target: EventTarget | null): boolean {
  const element = fieldHost(target);
  if (!element) return false;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(element.closest("input, textarea, select, [contenteditable='true']"));
}

function typingInField(event: KeyboardEvent): boolean {
  if (event.isComposing || event.keyCode === 229) return true;
  if (insideField(event.target) || insideField(document.activeElement)) return true;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed && insideField(selection.anchorNode)) return true;
  return false;
}

function togglePlayback(setPlaying: (value: boolean | ((value: boolean) => boolean)) => void) {
  const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("video.frame"));
  const live = videos.find((video) => !video.paused && !video.ended);
  if (live) {
    live.pause();
    setPlaying(false);
    return;
  }
  setPlaying((value) => !value);
}

function BedAudio({ src, playing, rate = 1 }: { src: string; playing: boolean; rate?: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, src]);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    if (!src || !playing) {
      audio.pause();
      return;
    }
    if (audio.src !== src) audio.src = src;
    const played = audio.play?.();
    if (played && typeof played.catch === "function") void played.catch(() => undefined);
    return () => audio.pause();
  }, [src, playing]);
  return src ? <audio ref={ref} data-testid="bed-audio" src={src} /> : null;
}

function PreviewVideo({
  src,
  voice = "",
  music = "",
  mixPreview,
  mixTimeOffset = 0,
  soloLane = "",
  playing,
  audible,
  sound = true,
  onPlaying,
  onTime,
  seek = null,
  onDuration,
  rate = 1,
}: {
  src: string;
  voice?: string;
  music?: string;
  mixPreview?: Extract<AudioMixPreviewResult, { kind: "READY" }> | null;
  mixTimeOffset?: number;
  soloLane?: MixLane | "";
  playing: boolean;
  audible: boolean;
  sound?: boolean;
  onPlaying: (value: boolean) => void;
  onTime: (seconds: number) => void;
  /** 3JR-U01: jump here; a new object each time, even for the same second. */
  seek?: { seconds: number } | null;
  /** The real length of the video, once the player knows it. */
  onDuration?: (seconds: number) => void;
  /** 5-3-09: 1, 2 or 4 times as fast (L pressed again). */
  rate?: number;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const mixEnabled = mixPreview !== undefined;
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, src]);
  const onPlayingRef = useRef(onPlaying);
  const onTimeRef = useRef(onTime);
  const onDurationRef = useRef(onDuration);
  onPlayingRef.current = onPlaying;
  onTimeRef.current = onTime;
  onDurationRef.current = onDuration;
  useEffect(() => {
    const video = ref.current;
    if (!video || !seek) return;
    const apply = () => {
      const end = Number.isFinite(video.duration) ? video.duration : seek.seconds;
      video.currentTime = Math.min(Math.max(0, seek.seconds), end);
      onTimeRef.current(video.currentTime || 0);
    };
    if (video.readyState >= 1) {
      apply();
      return;
    }
    video.addEventListener("loadedmetadata", apply, { once: true });
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [seek]);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let frame = 0;
    let cancelled = false;
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = () => {
      onTimeRef.current(video.currentTime || 0);
      frame = requestAnimationFrame(tick);
    };
    if (!playing) {
      video.pause();
      stop();
      return () => {
        cancelled = true;
        stop();
      };
    }
    const start = async () => {
      if (typeof video.play !== "function") return;
      document.querySelectorAll<HTMLVideoElement>("video.frame").forEach((other) => {
        if (other !== video) other.pause();
      });
      video.muted = mixPreview !== undefined || !audible;
      if (!audible) {
        try {
          await video.play();
        } catch (error) {
          if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
          if (!video.paused) return;
          onPlayingRef.current(false);
        }
        if (!cancelled && !video.paused) frame = requestAnimationFrame(tick);
        return;
      }
      try {
        await video.play();
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        video.muted = true;
        try {
          await video.play();
        } catch (again) {
          if (cancelled || (again instanceof DOMException && again.name === "AbortError")) return;
          if (!video.paused) return;
          onPlayingRef.current(false);
          return;
        }
      }
      if (!cancelled && !video.paused) tick();
    };
    void start();
    return () => {
      cancelled = true;
      video.pause();
      stop();
    };
  }, [audible, playing, src, mixEnabled]);
  return (
    <>
      <video
        ref={ref}
        className="frame"
        src={src}
        playsInline
        muted={mixPreview !== undefined || !audible}
        preload="auto"
        onTimeUpdate={() => onTimeRef.current(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => {
          const length = ref.current?.duration ?? 0;
          if (Number.isFinite(length) && length > 0) onDurationRef.current?.(length);
        }}
        onEnded={() => {
          onTimeRef.current(ref.current?.currentTime ?? 0);
          onPlayingRef.current(false);
        }}
        onError={() => onPlayingRef.current(false)}
      />
      {mixPreview !== undefined ? (
        <AudioMixPreview
          result={mixPreview}
          clock={() => mixTimeOffset + (ref.current?.currentTime ?? 0)}
          playing={playing}
          rate={rate}
          audible={sound}
          solo={soloLane}
        />
      ) : (
        <>
          <BedAudio src={voice} playing={playing && sound} rate={rate} />
          <BedAudio src={music} playing={playing && sound} rate={rate} />
        </>
      )}
    </>
  );
}

function Thumb({
  src,
  position,
  rain = false,
}: {
  src?: string;
  position?: string;
  rain?: boolean;
}) {
  const shown = fileMediaUrl(src);
  const style = shown
    ? { backgroundImage: `url(${shown})`, backgroundPosition: position ?? "50% 50%" }
    : undefined;
  return <div className={rain || !src ? "thumb rain" : "thumb"} style={style} />;
}

function takeVideo(shot: FilmShot | undefined): string {
  if (!shot) return "";
  const take =
    shot.takes.find((item) => item.id === shot.selectedTakeId && item.videoUrl) ??
    shot.takes.find((item) => item.status === "done" && item.videoUrl);
  return fileMediaUrl(take?.videoUrl || take?.videoPath);
}

function FrameThumb({ shot }: { shot?: FilmShot }) {
  const frame = shotFrame(shot);
  const video = frame ? "" : takeVideo(shot);
  if (video) {
    return (
      <div className="thumb">
        <video src={video} muted playsInline preload="metadata" />
      </div>
    );
  }
  return <Thumb src={frame || undefined} position={shot?.posterPosition} rain={!frame} />;
}

export function ProWorkspace({ projectId = null }: { projectId?: string | null }) {
  const connected = useGrokConnected();
  const membershipDenied = useGrokDenied();
  const account = useGrokAccount();
  const [film, setFilmState] = useState<FilmProject | null>(null);
  const [stage, setStage] = useState<Stage>("script");
  const [archiveMode, setArchiveMode] = useState<"export" | "import" | null>(null);
  const archiveOrigin = useRef<string | null>(null);
  const [pickedScene, setScene] = useState("02");
  // 3JR-B01: when a new set of scenes arrives (一键成片 writes them), the page already shows the
  // first scene before the effect below stores it. Actions use the scene the page shows, so a
  // click in between does not go to a scene that no longer exists.
  const scene =
    film && !film.scenes.some((item) => item.id === pickedScene)
      ? (film.scenes[0]?.id ?? pickedScene)
      : pickedScene;
  const [role, setRole] = useState<Role>("director");
  const [shot, setShot] = useState(0);
  const [pending, setPending] = useState<FilmShot[] | null>(null);
  const [pendingRole, setPendingRole] = useState<Role | null>(null);
  const [pendingScenes, setPendingScenes] = useState<FilmScene[] | null>(null);
  const [menu, setMenu] = useState<"project" | "account" | "queue" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const workOwners = useWorkOwners(film?.id ?? "");
  const exporting = workOwners.busy("export");
  const cleanCopyBusy = workOwners.busy("clean-copy");
  const cleanCopySaveVersions = useRef(new Map<string, FilmProject>());
  const [asking, setAsking] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<{
    role: Role;
    context: string;
    instruction: string;
    origin?: EditorSelection;
  } | null>(null);
  const [confirmSignIn, setConfirmSignIn] = useState(false);
  const [range, setRange] = useState(false);
  const [rangeSeconds, setRangeSeconds] = useState<{
    shotId: string;
    takeId: string;
    start: number;
    end: number;
  } | null>(null);
  const [rangeDialog, setRangeDialog] = useState(false);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [rangeMessage, setRangeMessage] = useState("");
  const [rangeReady, setRangeReady] = useState<RangeReady | null>(null);
  const rangeReadyRef = useRef<RangeReady | null>(null);
  const rangeWorking = useRef(false);
  const rangeCancelled = useRef(false);
  const rangeExecuting = useRef(false);
  const rangeAccepted = useRef<FilmProject | null>(null);
  useEffect(() => {
    if (
      rangeWorking.current &&
      rangeAccepted.current &&
      filmRef.current !== rangeAccepted.current
    ) {
      rangeCancelled.current = true;
      const pending = rangeReadyRef.current;
      if (pending)
        void window.aijian
          ?.discardFilmRange?.(pending.project.id, pending.planId)
          .catch(() => undefined);
    }
  }, [film]);
  const [span, setSpan] = useState<{ from: number; to: number } | null>(null);
  const [comparing, setComparing] = useState(false);
  // 4A-U10: only runAction still sets it; the 修改这一段 tiles that read it are gone.
  const [, setFixAction] = useState<FixAction>("rewrite");
  const [rightTab, setRightTab] = useState<"props" | "fix" | "ai">("props");
  const [notice, setNoticeState] = useState("");
  const noticeEpoch = useRef(0);
  const noticeRef = useRef("");
  const setNotice = (next: string | UiNotice | ((current: string) => string)) => {
    noticeEpoch.current += 1;
    const value = typeof next === "function" ? next(noticeRef.current) : next;
    const { notice: structured, text: rendered } = presentNotice(value);
    window.dispatchEvent(new CustomEvent("aivora-notice", { detail: structured }));
    noticeRef.current = rendered;
    setNoticeState(rendered);
  };
  const emitNotice = (message: UiNotice) => setNotice(message);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [voiceChoices, setVoiceChoices] = useState<{ id: string; label: string }[]>([]);
  const [soundOn, setSoundOn] = useState(
    () => window.localStorage.getItem("aivora.sound") !== "off",
  );
  const [showRoles, setShowRoles] = useState(true);
  const castEpoch = useRef(0);
  const requestSequences = useRef(new RequestSequences());
  const activeTurn = useRef("");
  const unassignedDraft = useRef<NonNullable<FilmProject["unassignedBeats"]>>([]);
  const supplementWarnings = useRef<string[]>([]);
  const stillProgress = workOwners.progress("still:");
  const portraitBusy = workOwners.busy("portraits");
  const [structured, setStructured] = useState<string[]>([]);
  const [turns, setTurns] = useState<
    { id: string; role: Role; who: "user" | "agent"; text: string }[]
  >([]);
  const [assistPulse, setAssistPulse] = useState(0);
  const [hearing, setHearing] = useState(false);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const previewSession = useRef<VoicePreview | null>(null);
  const previewEpoch = useRef(0);
  useEffect(
    () => () => {
      previewEpoch.current += 1;
      setHearing(false);
      previewSession.current?.dispose();
      previewSession.current = null;
      previewAudio.current = null;
    },
    [film?.id, soundOn],
  );
  const [roleCards, setRoleCards] = useState<Partial<Record<Role, RoleCard>>>({});
  const [stillArmed, setStillArmed] = useState("");
  const selectedEditorShot =
    stage === "board" || stage === "edit"
      ? film?.shots
          .filter(
            (item) => item.sceneId === scene || !film.scenes.some((row) => row.id === item.sceneId),
          )
          .slice()
          .sort((a, b) => a.no - b.no)[shot]
      : undefined;
  const editorSelection = useRef<EditorSelection>({ projectId: "", page: stage });
  editorSelection.current = {
    projectId: film?.id ?? "",
    page: stage,
    sceneId: scene,
    ...(selectedEditorShot ? { shotId: selectedEditorShot.id } : {}),
  };
  const assistantScope = `${film?.id ?? ""}:${stage}:${scene}:${selectedEditorShot?.id ?? ""}:${assistantInputVersion(film, scene)}`;
  const scopeRef = useRef(assistantScope);
  scopeRef.current = assistantScope;
  const [versions, setVersions] = useState(1);
  const [signingIn, setSigningIn] = useState(false);
  const [savingDisk, setSavingDisk] = useState(false);
  const [hearLane, setHearLane] = useState<MixLane | "">("");
  const scoreGain = useRef(-14);
  const writing = useRef(false);
  const signingRef = useRef(false);
  const [duration, setDuration] = useState(3);
  const [playing, setPlaying] = useState(false);
  const [chat, setChat] = useState("");
  const [bench, setBench] = useState(false);
  const [paused, setPaused] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeEntry[]>([]);
  const [seriesList, setSeriesList] = useState<FilmIndexEntry[]>([]);
  const [diskPath, setDiskPath] = useState("");
  const [diskFilmId, setDiskFilmId] = useState("");
  const [diskError, setDiskError] = useState<{ projectId: string; message: string } | null>(null);
  const [pendingBatch, setPendingBatchState] = useState<FilmShot[] | null>(null);
  const batchConfirmation = useRef<{ projectId: string; rows: FilmShot[] } | null>(null);
  function setPendingBatch(rows: FilmShot[] | null) {
    batchConfirmation.current = rows ? { projectId: filmRef.current?.id ?? "", rows } : null;
    setPendingBatchState(rows);
  }
  const [exportFile, setExportFile] = useState("");
  const [rename, setRename] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const filmRef = useRef<FilmProject | null>(null);
  function setFilm(update: SetStateAction<FilmProject | null>) {
    const previous = filmRef.current;
    let next = typeof update === "function" ? update(previous) : update;
    if (previous && next && previous.id === next.id && previous.styleZh !== next.styleZh) {
      next = setFilmStyle(
        { ...next, styleZh: previous.styleZh, styleRevision: previous.styleRevision },
        next.styleZh,
      );
    }
    if (batchConfirmation.current && batchConfirmation.current.projectId !== next?.id)
      setPendingBatch(null);
    if (next) next = applyContinuityChecks(invalidateAudioWaveforms(next));
    filmRef.current = next;
    if (next && cleanCopySaveVersions.current.has(next.id))
      cleanCopySaveVersions.current.set(next.id, next);
    setFilmState(next);
  }
  const persistence = useMemo(
    () => createFilmPersistence({ current: () => filmRef.current, write: writeFilm }),
    [],
  );
  const saveFilm = (next: FilmProject) => persistence.save(next);
  const audioMixPreview = useAudioMixPreview(film, stage === "edit", {
    current: () => filmRef.current,
    save: (snapshot, guard) => persistence.save(snapshot, guard),
  });
  const audioWaveforms = useAudioWaveforms(film, stage === "edit", {
    current: () => filmRef.current,
    apply: applyLive,
    save: (snapshot) => persistence.save(snapshot),
  });
  const editorHost = useMemo(
    () =>
      createEditorHost({
        current: () => filmRef.current,
        selection: () => editorSelection.current,
        applyLive: (next) => {
          const live = filmRef.current;
          if (live && committed.current?.id === live.id)
            pageHistory.record(committed.current, live, historyScope.current);
          applyLive(next);
        },
        applied: (receipt) => {
          pageHistory.recordReceipt(receipt);
          skipHistory.current = true;
          committed.current = filmRef.current;
          setHistoryTick((value) => value + 1);
        },
        save: (next) => {
          // setFilm applies continuity normalization; save that exact live result through the existing queue.
          const live = filmRef.current;
          return live?.id === next.id ? persistence.save(live) : Promise.resolve(null);
        },
      }),
    [persistence],
  );
  const pipelineLive = useRef({ connected, modelIds, ensureBillingProject, submitGeneration });
  pipelineLive.current = { connected, modelIds, ensureBillingProject, submitGeneration };
  const pipelineWorkspace = useMemo(() => {
    const workspace = createPipelineWorkspaceHost({
      current: () => filmRef.current,
      apply: applyLive,
      ensureBillingProject: () => pipelineLive.current.ensureBillingProject(),
      acquireSaveOwnership: persistence.acquire,
      beforeRun: (lease) => captureBeforePipeline(lease),
      bridge: () => (pipelineLive.current.connected ? (grokBridge() ?? null) : null),
      modelIds: () => pipelineLive.current.modelIds,
      modelsChanged: setModelIds,
      submitGeneration: (shots, control) =>
        pipelineLive.current.submitGeneration(shots, false, undefined, undefined, control),
      notify: emitNotice,
    });
    return createPipelineControls({
      current: () => filmRef.current,
      workspace,
      notify: emitNotice,
    });
  }, [persistence]);
  const productionActions = useProductionActions({
    current: () => filmRef.current,
    apply: async (next) => {
      applyLive(next);
      await saveFilm(next);
    },
    notify: emitNotice,
    requestDirector: (context, instruction, control) =>
      retryDirectorTimeout(
        (control) => completeAgent("director", context, instruction, control),
        setNotice,
        emitNotice,
        {
          signal: control?.signal,
          totalMs: Math.min(240_000, (control?.deadlineAt ?? Date.now() + 240_000) - Date.now()),
        },
      ),
  });
  const pageHistory = useMemo(() => createEditorPageHistory(), []);
  const historyScope = useRef(editorSelection.current);
  const committed = useRef<FilmProject | null>(null);
  const skipHistory = useRef(false);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const runToken = useRef(0);
  const generationRuns = useRef(new Set<string>());
  const resumeGenerationRef = useRef<() => void>(() => undefined);
  const wasPaused = useRef(paused);
  useEffect(() => {
    const resume = wasPaused.current && !paused;
    wasPaused.current = paused;
    if (resume) resumeGenerationRef.current();
  }, [paused]);
  const cancelledJobs = useRef(new Set<string>());
  const deleteTarget = useRef<"episode" | "series">("episode");
  const assembledKey = useRef("");
  const openShotRef = useRef("");
  const storyDraft = useRef<StoryDraft | null>(null);
  const applyingStory = useRef(false);
  const artDraft = useRef<ArtTransaction | null>(null);
  const applyingArt = useRef(false);
  const suggestionSnapshot = {
    origin: { projectId: film?.id ?? "", page: stage, sceneId: scene },
    roleCards,
    pending,
    pendingRole,
    pendingScenes,
    pendingRetry,
    structured,
    turns,
    art: artDraft.current,
    story: storyDraft.current,
  };

  const [historyTick, setHistoryTick] = useState(0);
  const audioLibrary = useBundledAudioLibrary(film, stage === "edit", {
    current: () => filmRef.current,
    selection: () => {
      const scope = editorSelection.current;
      const live = filmRef.current;
      const target = live?.shots.find((row) => row.id === scope.shotId);
      const take = target?.takes.find(
        (row) => row.id === target.selectedTakeId && row.status === "done" && row.videoPath,
      );
      return live && target && take && scope.page === "edit"
        ? { projectId: live.id, page: scope.page, shotId: target.id, takeId: take.id }
        : null;
    },
    apply: (next) => {
      const live = filmRef.current;
      // Keep prior field undo, while the new clip has its own explicit remove control.
      // Recording its media structure as a generic field edit would block that history.
      if (live && committed.current?.id === live.id && committed.current !== live)
        pageHistory.record(committed.current, live, historyScope.current);
      applyLive(next);
      const adopted = filmRef.current!;
      committed.current = adopted;
      skipHistory.current = true;
      setHistoryTick((value) => value + 1);
      return adopted;
    },
    persistence,
  });
  const actions = videoActions(modelIds);

  useEffect(() => {
    const bridge = grokBridge();
    if (!connected || !bridge) return;
    let live = true;
    void bridge.models().then((listed) => {
      if (!live || listed.kind !== "OK") return;
      setModelIds(listed.models.map((model) => model.id));
      setVoiceChoices(
        listed.models
          .filter((model) => model.outputModalities?.includes("audio"))
          .map((model) => ({ id: model.id, label: voiceLabel(model.id, model.label) })),
      );
    });
    return () => {
      live = false;
    };
  }, [connected]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const rows = await listFilms();
      const id = activeFilmId() || rows[0]?.id || "";
      const stored = id ? await readSaved(id) : null;
      if (!live || !stored || filmRef.current) return;
      const settled = settleOpenedFilm(await hydrateFilm(stored));
      filmRef.current = settled.film;
      committed.current = settled.film;
      setFilm(settled.film);
      if (settled.interrupted)
        setNotice({ code: "WORK_INTERRUPTED", text: NOTICE_TEXT.WORK_INTERRUPTED });
      const first = stored.scenes[0]?.id;
      if (first) setScene(first);
    })();
    return () => {
      live = false;
    };
  }, []);

  function settleOpenedFilm(value: FilmProject) {
    // Pipeline recovery validates its saved input before changing interrupted media.
    return value.productionPipeline
      ? { film: value, interrupted: false }
      : interruptStaleWork(value);
  }

  const saveGeneration = useRef(0);
  useEffect(() => {
    // setFilm updates the live ref synchronously; an older render must not roll it back.
    if (!film) {
      saveGeneration.current += 1;
      setDiskError(null);
      setSavingDisk(false);
      return;
    }
    if (historyScope.current.page !== stage && committed.current?.id === film.id) {
      pageHistory.record(committed.current, film, historyScope.current);
      committed.current = film;
    }
    historyScope.current = editorSelection.current;
    const generation = ++saveGeneration.current;
    const savingId = film.id;
    const isCurrentSave = () => generation === saveGeneration.current && filmRef.current === film;
    setDiskError((previous) => (previous?.projectId === savingId ? previous : null));
    const flush = () => {
      void persistence.flush().catch(() => undefined);
    };
    window.addEventListener("beforeunload", flush);
    setSavingDisk(true);
    const handle = window.setTimeout(() => {
      if (!isCurrentSave()) return;
      void saveFilm(film)
        .then((stored) => {
          if (!isCurrentSave()) return;
          if (!stored) {
            setSavingDisk(false);
            return;
          }
          if (stored.directory && stored.directory !== BROWSER_DIRECTORY) {
            setDiskFilmId(savingId);
            setDiskPath(stored.directory);
          }
          setDiskError(null);
          setSavingDisk(false);
        })
        .catch(() => {
          if (isCurrentSave()) {
            setDiskError({ projectId: savingId, message: "没有写到应用数据目录，可以重试。" });
            setSavingDisk(false);
          }
        });
    }, 400);
    let timer = 0;
    if (committed.current?.id !== film.id) {
      resetHistory(film);
    } else if (skipHistory.current) {
      skipHistory.current = false;
      committed.current = film;
    } else {
      timer = window.setTimeout(
        historyCheckpoint(film, editorSelection.current, {
          current: () => filmRef.current,
          selection: () => editorSelection.current,
          commit: (snapshot, scope) => {
            if (committed.current?.id !== snapshot.id) return;
            const previous = committed.current;
            if (filmSignature(previous) !== filmSignature(snapshot)) {
              pageHistory.record(previous, snapshot, scope);
              setHistoryTick((value) => value + 1);
            }
            committed.current = snapshot;
          },
        }),
        500,
      );
    }
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.clearTimeout(handle);
      if (timer) window.clearTimeout(timer);
    };
  }, [film, stage]);

  const queueProject = film?.id ?? "";
  useEffect(() => {
    const current = filmRef.current;
    const queued =
      current?.id === queueProject && current.shots.some((row) => row.takes.some(canResumeTake));
    pauseRef.current = Boolean(queued);
    setPaused(Boolean(queued));
  }, [queueProject]);

  useEffect(() => {
    pipelineWorkspace.projectChanged();
    if (filmRef.current?.productionPipeline) {
      void pipelineWorkspace.recover().catch(() => {
        emitNotice({ code: "PIPELINE_RECOVERY_FAILED", text: "进度未能恢复，请重试。" });
      });
    }
    return () => pipelineWorkspace.cancel();
  }, [film?.id, pipelineWorkspace]);

  useEffect(() => {
    const bridge = window.aijian;
    let live = true;
    const unsubscribe = bridge?.onFlush?.((request) => {
      const generation = ++saveGeneration.current;
      if (filmRef.current) setSavingDisk(true);
      void persistence.flushAll().then(
        (result) => {
          if (!live) return;
          const snapshot = result.snapshot;
          if (snapshot && filmRef.current === snapshot && generation === saveGeneration.current) {
            if (result.status === "saved") {
              if (result.stored?.directory && result.stored.directory !== BROWSER_DIRECTORY) {
                setDiskFilmId(snapshot.id);
                setDiskPath(result.stored.directory);
              }
              setDiskError(null);
            } else if (result.status === "failed" && result.failedProjectId === snapshot.id) {
              setDiskError({ projectId: snapshot.id, message: "没有写到应用数据目录，可以重试。" });
            }
            setSavingDisk(false);
          }
          void bridge
            ?.flushed?.({ requestId: request.requestId, status: result.status })
            .catch(() => undefined);
        },
        () => {
          if (!live) return;
          const snapshot = filmRef.current;
          if (snapshot && generation === saveGeneration.current) {
            setDiskError({ projectId: snapshot.id, message: "没有写到应用数据目录，可以重试。" });
            setSavingDisk(false);
          }
          void bridge
            ?.flushed?.({ requestId: request.requestId, status: "failed" })
            .catch(() => undefined);
        },
      );
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    setPending(null);
  }, [role]);

  useEffect(() => {
    const bridge = window.aijianGrok as
      | (NonNullable<Window["aijianGrok"]> & {
          onTextProgress?: (cb: (update: { chars: number; shots: number }) => void) => () => void;
        })
      | undefined;
    return bridge?.onTextProgress?.((update) => {
      if (!writing.current) return;
      if (update.shots > 0) setNotice(`正在写第 ${update.shots} 个镜头…`);
      else if (update.chars > 0) setNotice("正在写…");
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem("aivora.sound", soundOn ? "on" : "off");
  }, [soundOn]);

  useEffect(() => {
    const saved = film?.audioClips.find((clip) => clip.lane === "score" && clip.gainDb > -40);
    if (saved) scoreGain.current = saved.gainDb;
  }, [film]);

  useEffect(() => {
    if (!film) return;
    if (film.scenes.some((item) => item.id === pickedScene)) return;
    setScene(film.scenes[0]?.id ?? "scene-1");
  }, [film, pickedScene]);

  function rememberFilm(next: FilmProject) {
    filmRef.current = next;
    setFilm(next);
  }

  function resetHistory(current: FilmProject) {
    pageHistory.clear();
    historyScope.current = editorSelection.current;
    skipHistory.current = false;
    committed.current = current;
    setHistoryTick((value) => value + 1);
  }

  function movePageHistory(inverse: boolean) {
    const current = filmRef.current;
    const baseline = committed.current;
    if (!current) return;
    if (baseline?.id !== current.id) {
      resetHistory(current);
      return;
    }
    if (filmSignature(current) !== filmSignature(baseline)) {
      const conflicts = pageHistory.record(baseline, current, historyScope.current);
      if (conflicts.length) {
        setNotice("这次改动不能安全撤销，已保留当前内容。");
        committed.current = current;
        return;
      }
      committed.current = current;
    }
    const result = inverse
      ? pageHistory.undo(current, editorSelection.current)
      : pageHistory.redo(current, editorSelection.current);
    if (result.film === current) {
      if (result.conflicts[0] !== "NOTHING_TO_UNDO") setNotice("内容后来改过，这次没有覆盖。");
      return;
    }
    skipHistory.current = true;
    committed.current = result.film;
    setHistoryTick((value) => value + 1);
    rememberFilm(result.film);
    const action = inverse ? "已撤销" : "已重做";
    const detail = result.label ? `：${result.label}` : "";
    setNotice(
      result.conflicts.length
        ? `${action}部分改动${detail}。其余内容后来改过，已保留。`
        : `${action}${detail}`,
    );
  }
  function undoEdit() {
    movePageHistory(true);
  }
  function redoEdit() {
    movePageHistory(false);
  }

  const open = film !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typingInField(event)) return;
      if (event.key >= "1" && event.key <= String(STAGES.length)) {
        const next = STAGES[Number(event.key) - 1];
        if (next) setStage(next.id);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoEdit();
        else undoEdit();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoEdit();
      }
      if (event.key === "i" || event.key === "I") {
        setRange(true);
        setStage("edit");
        setRightTab("fix");
      }
      if (event.key === "o" || event.key === "O") {
        setRange(true);
        setStage("edit");
        setRightTab("fix");
      }
      if (event.key === " " && stage === "edit") {
        event.preventDefault();
        togglePlayback(setPlaying);
      }
      if (event.key === "Escape") {
        setMenu(null);
        setExportOpen(false);
        setRange(false);
        setComparing(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, historyTick]);

  async function revoiceShot(current: FilmShot) {
    const line = spokenLine(current);
    if (!line) {
      setNotice("这一镜没有台词，不用配音。");
      return;
    }
    const live = filmRef.current;
    if (!live) return;
    const valid = requestSequences.current.begin(
      live.id,
      `voice:${current.id}`,
      () => filmRef.current?.id ?? "",
    );
    setNotice("正在重配这一句，画面不动。");
    try {
      await revoiceFilmShot(live, current, {
        current: () => filmRef.current,
        valid,
        apply: applyLive,
        billing: ensureBillingProject,
      });
      if (valid()) setNotice("这一句已重配，画面没有重新生成。");
    } catch (error) {
      if (valid())
        emitNotice({
          code:
            error instanceof Error && error.message === "VOICE_TRAITS_REQUIRED"
              ? "VOICE_TRAITS_REQUIRED"
              : "VOICE_FAILED",
          text: "配音未完成，请确认角色声音后重试。",
          detail: error instanceof Error ? error.message : undefined,
        });
    } finally {
      if (valid()) setHearing(false);
    }
  }

  const runAction = (action: FixAction) => {
    setFixAction(action);
    setRightTab("fix");
    const gate = actions[action];
    if (!gate.enabled) {
      setNotice(gate.reason);
      return;
    }
    if (action === "cut") {
      const current = shownShots[shot];
      if (film && current) setFilm(removeShot(film, current.id));
      setRange(false);
      setComparing(false);
      setShot(0);
      setNotice("已剪掉这一段。画面和声音都往前接上。");
      return;
    }
    const current = shownShots[shot];
    if (current && action === "voice") {
      void revoiceShot(current);
      return;
    }
    if (current && (action === "regenerate" || action === "rewrite")) {
      setPendingBatch([current]);
      setNotice(`只重做镜头 ${current.no}。确认表里点开始生成才会出视频。`);
      return;
    }
    setComparing(true);
    setNotice(
      action === "extend"
        ? "延长会从最后一帧往后接，每个版本各算一次。"
        : "每个版本各算一次生成。视频自带的声音已关掉。",
    );
  };

  function signInGrok() {
    const bridge = window.aijianGrok;
    if (!bridge?.signIn) {
      setNotice(SIGN_IN_NOTE);
      return;
    }
    setMenu(null);
    setConfirmSignIn(true);
  }

  async function beginSignIn() {
    const bridge = window.aijianGrok;
    if (!bridge?.signIn || signingRef.current) return;
    signingRef.current = true;
    setConfirmSignIn(false);
    setSigningIn(true);
    setNotice({
      code: "AUTH_BROWSER_OPENING",
      text: NOTICE_TEXT.AUTH_BROWSER_OPENING,
      detail: "授权页显示 Grok Build；确认后点 Allow（允许），再回到软件。",
    });
    try {
      const result = await bridge.signIn();
      window.dispatchEvent(new Event("aivora-grok-changed"));
      const status = await bridge.status?.();
      if (status?.state === "ENTITLEMENT_DENIED" || status?.lastError === "ENTITLEMENT_DENIED") {
        setNotice("这个会员不能用生成功能。");
      } else if (result.kind === "OK") {
        setNotice("已登录，浏览器那页可以关掉，不用输入代码");
      } else if (result.kind === "CANCELLED") setNotice("登录已取消。");
      else setNotice("登录没有完成。可以再试一次。");
    } catch {
      setNotice("登录没有完成。可以再试一次。");
    } finally {
      signingRef.current = false;
      setSigningIn(false);
    }
  }

  async function signOutAccount() {
    setMenu(null);
    try {
      await window.aijianGrok?.signOut?.();
      window.dispatchEvent(new Event("aivora-grok-changed"));
      setNotice("已退出登录。");
    } catch {
      setNotice("退出没有完成。可以再试一次。");
    }
  }

  const storedTitle =
    film && film.seriesTitle && film.seriesTitle !== "未命名作品"
      ? film.seriesTitle
      : (film?.title ?? "未命名作品");
  const title = menu === "project" && rename.trim() ? rename.trim() : storedTitle;
  const savedDirectory =
    diskFilmId === film?.id && diskPath && diskPath !== BROWSER_DIRECTORY
      ? diskPath
      : film?.directory && film.directory !== BROWSER_DIRECTORY
        ? film.directory
        : "";
  const sceneIds = new Set(film?.scenes.map((item) => item.id) ?? []);
  const shownShots = (
    film?.shots.filter((item) => item.sceneId === scene || !sceneIds.has(item.sceneId)) ?? []
  )
    .slice()
    .sort((a, b) => a.no - b.no);
  openShotRef.current = shownShots[shot]?.id ?? "";

  async function completeDirectorPlan(
    base: FilmProject,
    sceneId: string,
    shots: FilmShot[],
    valid: () => boolean,
    control?: AgentRequestControl,
  ) {
    return enrichDirectorPlan(base, sceneId, shots, {
      valid,
      control,
      progress: (message) => {
        if (valid()) setNotice(message);
      },
      request: completeAgent,
      warning: (text) => {
        if (valid()) supplementWarnings.current.push(text);
      },
      unassigned: (id, beats) => {
        if (valid())
          unassignedDraft.current = [
            ...unassignedDraft.current.filter((item) => item.sceneId !== id),
            ...beats,
          ];
      },
    });
  }

  async function planDirector(asked = "") {
    if (!film) return;
    const base = structuredClone(filmRef.current ?? film);
    const origin = structuredClone(editorSelection.current);
    storyDraft.current = null;
    const scope = scopeRef.current;
    supplementWarnings.current = [];
    unassignedDraft.current = [];
    const turn = pushTurn("director", asked.trim() || "把这一场拆成镜头");
    let result: DirectorDraftResult;
    try {
      result = await planDirectorDraft(base, scene, asked, {
        connected: connected && Boolean(grokBridge()),
        request: completeAgent,
        progress: setNotice,
        notify: emitNotice,
        current: () =>
          scope === scopeRef.current && isTurnCurrent(turn) && filmRef.current?.id === base.id,
        enrich: completeDirectorPlan,
        warnings: () => supplementWarnings.current,
      });
    } finally {
      if (activeTurn.current === turn) {
        writing.current = false;
        setAsking(false);
      }
    }
    if (scope !== scopeRef.current || !isTurnCurrent(turn) || result.status === "stale") return;
    const next = result.shots;
    const text = result.notice;
    if (result.retry) setPendingRetry({ ...result.retry, origin });
    if (result.event === "rejected") noteAgent("director", "rejected", text);
    if (result.coverageNotice) emitNotice(result.coverageNotice);
    if (!next) {
      setPending(null);
      setPendingRole(null);
      finishTurn(turn, text);
      return;
    }
    const draft: StoryDraft = {
      transaction: prepareDirectorConfirmation(base, next, unassignedDraft.current),
      origin,
    };
    storyDraft.current = draft;
    setPending(next);
    setPendingRole("director");
    publishCard("director", {
      storyDraft: draft,
      title: `建议拆成 ${next.length} 个镜头`,
      rows: next.map((shot) => ({
        id: shot.id,
        mark: shot.size,
        text: shot.picture,
        tail: `${shot.seconds}s`,
      })),
      notes: [],
      applied: false,
      mode: "shots",
      shots: next,
    });
    finishTurn(turn, text);
    noteAgent("director", result.event ?? "offline", text);
  }

  async function retryPending() {
    supplementWarnings.current = [];
    const job = pendingRetry;
    if (!job) return;
    setPendingRetry(null);
    const turn = pushTurn(job.role, "再问一次");
    const base = filmRef.current ? structuredClone(filmRef.current) : null;
    const origin = structuredClone(editorSelection.current);
    storyDraft.current = null;
    const scope = scopeRef.current;
    const valid = () =>
      isTurnCurrent(turn) && filmRef.current?.id === base?.id && scopeRef.current === scope;
    try {
      if (job.role === "director" && base) {
        const sceneId = origin.sceneId;
        if (
          !sceneId ||
          !base.scenes.some((row) => row.id === sceneId) ||
          (job.origin && JSON.stringify(job.origin) !== JSON.stringify(origin))
        ) {
          finishTurn(turn, "镜头已变更，请重新生成建议。");
          return;
        }
        const result = await retryDirectorDraft(base, sceneId, job, {
          request: completeAgent,
          progress: setNotice,
          notify: emitNotice,
          current: valid,
          enrich: completeDirectorPlan,
        });
        if (!valid() || result.kind === "stale") return;
        if (result.kind === "ready") {
          const draft: StoryDraft = {
            transaction: prepareDirectorConfirmation(base, result.shots, unassignedDraft.current),
            origin,
          };
          storyDraft.current = draft;
          publishCard("director", {
            storyDraft: draft,
            title: `建议拆成 ${result.shots.length} 个镜头`,
            rows: result.shots.map((row) => ({
              id: row.id,
              mark: row.size,
              text: row.picture,
              tail: `${row.seconds}s`,
            })),
            notes: [],
            applied: false,
            mode: "shots",
            shots: result.shots,
          });
          setPending(result.shots);
          setPendingRole("director");
          finishTurn(
            turn,
            result.partial
              ? `${NOTICE_TEXT.TEXT_TIMEOUT} 已保留导演初稿，补充尚未完成。`
              : `导演拆好了。点「放进分镜」才会放进去。${supplementWarnings.current.join(" ")}`,
          );
        } else finishTurn(turn, `${result.detail} 这次没有修改分镜。`);
        return;
      }
      const reply = await completeAgent(job.role, job.context, job.instruction);
      if (valid()) finishTurn(turn, `${reply.detail || "这次回复用不了。"} 这次没有修改分镜。`);
    } catch {
      if (valid()) finishTurn(turn, "这次没有写完，没有修改分镜。");
    } finally {
      if (activeTurn.current === turn) {
        writing.current = false;
        setAsking(false);
      }
    }
  }

  function applyPending() {
    const card = roleCards[role];
    if (role === "prompter" && card?.fieldRows !== undefined) {
      void applyPendingPrompt();
      return;
    }
    if (card?.applied) {
      setNotice("这一步已经放入。");
      return;
    }
    if (card?.mode === "scenes" && card.scenes && film) {
      void applyPendingStory(card.storyDraft);
      return;
    }
    if (artDraft.current && (role === "art" || card?.mode === "art")) {
      void applyPendingArt();
      return;
    }
    const incoming = card?.shots ?? (pendingRole === role ? pending : null);
    if (!film || !incoming) {
      setNotice("还没有可放入的镜头。");
      return;
    }
    const only = incoming.length === 1 ? incoming[0] : undefined;
    if (
      only &&
      (role === "performance" ||
        only.source === "agent:action" ||
        only.source === "agent:performance")
    ) {
      void applyPendingDirection(card?.directionDiff);
      return;
    }
    void applyPendingStory(
      card?.storyDraft ??
        (pendingRole === "director" ? (storyDraft.current ?? undefined) : undefined),
    );
  }

  async function applyPendingStory(draft: StoryDraft | undefined) {
    const live = filmRef.current;
    if (!draft || !live || applyingStory.current) {
      if (!draft) setNotice("镜头已变更，请重新生成建议。");
      return;
    }
    const current = editorSelection.current,
      origin = draft.origin;
    if (
      storyDraft.current !== draft ||
      current.projectId !== origin.projectId ||
      current.page !== origin.page ||
      current.sceneId !== origin.sceneId ||
      current.shotId !== origin.shotId
    ) {
      setNotice("镜头已变更，请重新生成建议。");
      return;
    }
    const result = applyStoryConfirmation(live, draft.transaction);
    if (result.code === "NO_CHANGES") {
      storyDraft.current = null;
      markApplied(draft.transaction.kind);
      setNotice("这一步已经放入。");
      return;
    }
    if (!result.receipt) {
      const code = result.conflicts.some((item) =>
        /DEPENDENT|DEPENDENCIES|TASKS_CHANGED/.test(item),
      )
        ? "DEPENDENT_WORK_EXISTS"
        : "STRUCTURE_STALE";
      emitNotice({ code, text: NOTICE_TEXT[code] });
      return;
    }
    let appliedVersion: FilmProject | null = null;
    let completionOrigin = origin;
    applyingStory.current = true;
    try {
      if (committed.current?.id === live.id)
        pageHistory.record(committed.current, live, historyScope.current);
      applyLive(result.film);
      const applied = filmRef.current!;
      appliedVersion = applied;
      const expectedScene = applied.scenes.some((row) => row.id === origin.sceneId)
        ? origin.sceneId
        : applied.scenes[0]?.id;
      const expectedShot =
        origin.page === "board" || origin.page === "edit"
          ? applied.shots
              .filter((row) => row.sceneId === expectedScene)
              .slice()
              .sort((a, b) => a.no - b.no)[draft.transaction.kind === "director" ? 0 : shot]?.id
          : undefined;
      completionOrigin = { ...origin, sceneId: expectedScene, shotId: expectedShot };
      pageHistory.recordStory(result.receipt, origin);
      committed.current = applied;
      skipHistory.current = true;
      setHistoryTick((value) => value + 1);
      storyDraft.current = null;
      markApplied(draft.transaction.kind);
      if (draft.transaction.kind === "director") setShot(0);
      else if (!applied.scenes.some((row) => row.id === scene))
        setScene(applied.scenes[0]?.id ?? "");
      const stored = await persistence.save(applied);
      if (
        !editorCompletionCurrent(
          applied,
          completionOrigin,
          filmRef.current,
          editorSelection.current,
        )
      ) {
        return;
      }
      if (!stored) {
        setNotice({
          code: "SAVE_FAILED",
          text: NOTICE_TEXT.SAVE_FAILED,
          detail: "修改已经应用，但还没保存上。请重试保存。",
        });
        return;
      }
      const latest = filmRef.current;
      if (!latest) return;
      void fillCast(latest);
      setNotice(
        draft.transaction.kind === "writer"
          ? "已放进剧本。你改过的场没有被盖掉。"
          : "已放进分镜。你改过的镜头没有被盖掉。",
      );
      const placed = turnsRef.current.map((item) =>
        item.who === "agent" && (item.text.includes("才会放进去") || item.text.includes("才会写入"))
          ? {
              ...item,
              text:
                draft.transaction.kind === "writer" ? "剧本已经放进去了。" : "镜头已经放进分镜。",
            }
          : item,
      );
      turnsRef.current = placed;
      setTurns(placed);
    } catch {
      if (
        appliedVersion &&
        editorCompletionCurrent(
          appliedVersion,
          completionOrigin,
          filmRef.current,
          editorSelection.current,
        )
      )
        setNotice({
          code: "SAVE_FAILED",
          text: NOTICE_TEXT.SAVE_FAILED,
          detail: "修改已经应用，但还没保存上。请重试保存。",
        });
    } finally {
      applyingStory.current = false;
    }
  }

  const billingPromises = useRef(new Map<string, Promise<string>>());
  const propFilmId = useRef("");

  async function ensureBillingProject(): Promise<string> {
    const live = filmRef.current;
    const filmId = live?.id ?? "";
    const stored = live?.backendProjectId ?? "";
    if (isBillingProjectId(stored)) return stored;
    if (
      isBillingProjectId(projectId) &&
      filmId &&
      (!propFilmId.current || propFilmId.current === filmId)
    ) {
      propFilmId.current = filmId;
      if (live) applyLive({ ...live, backendProjectId: projectId });
      return projectId;
    }
    const api = window.aijian;
    if (!api?.createProject || !filmId) return "";
    const id = await resolveBillingProject({
      filmId,
      name: live?.seriesTitle || live?.title || "未命名作品",
      aspectRatio: live?.aspectRatio,
      pending: billingPromises.current,
      isCurrent: () => filmRef.current?.id === filmId,
      create: (input) => api.createProject!(input),
    });
    const current = filmRef.current;
    if (!id || current?.id !== filmId) return "";
    // Another caller may already have bound this project while creation was pending.
    if (isBillingProjectId(current.backendProjectId)) return current.backendProjectId;
    applyLive({ ...current, backendProjectId: id });
    return id;
  }

  async function completeAgent(
    agent: Role,
    context: string,
    user: string,
    control?: AgentRequestControl,
  ): Promise<AgentReply> {
    const bridge = grokBridge();
    if (!connected || !bridge || !film) return { text: null, detail: "没有登录。" };
    const requestProjectId = film.id;
    const requestTurn = activeTurn.current;
    return completeMembershipAgent(agent, context, user, {
      bridge,
      modelIds,
      billingProject: ensureBillingProject,
      captureFilm: () => filmRef.current,
      current: () => filmRef.current?.id === requestProjectId && activeTurn.current === requestTurn,
      modelsChanged: setModelIds,
      control,
    });
  }

  const turnsRef = useRef<{ id: string; role: Role; who: "user" | "agent"; text: string }[]>([]);

  function pushTurn(nextRole: Role, userText: string): string {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const asked = userText.trim() || "请按你的职责处理当前内容。";
    activeTurn.current = id;
    const next = [
      ...turnsRef.current.slice(-16),
      { id: `${id}-u`, role: nextRole, who: "user" as const, text: asked },
      { id: `${id}-a`, role: nextRole, who: "agent" as const, text: "正在写。" },
    ];
    turnsRef.current = next;
    setTurns(next);
    setStructured([]);
    writing.current = true;
    setAsking(true);
    setAssistPulse((value) => value + 1);
    return id;
  }

  function isTurnCurrent(id: string) {
    return activeTurn.current === id && assistantScope === scopeRef.current;
  }

  function finishTurn(id: string, value: string | UiNotice) {
    if (!isTurnCurrent(id)) return;
    const { notice, text } = presentNotice(value);
    window.dispatchEvent(new CustomEvent("aivora-notice", { detail: notice }));
    writing.current = false;
    const next = turnsRef.current.map((item) => (item.id === `${id}-a` ? { ...item, text } : item));
    turnsRef.current = next;
    setTurns(next);
    setAsking(false);
    setNoticeState((current) => (current.startsWith("正在写") ? "" : current));
  }

  function noteAgent(agent: Role, parsed: string, detail: string) {
    void grokBridge()?.recordAgent?.({
      agent,
      model: textModel(modelIds),
      status: parsed === "rejected" || parsed === "error" ? "error" : "ok",
      parsed,
      detail,
    });
  }

  function chooseRole(next: Role) {
    if (next !== role) {
      setPending(null);
      setPendingRole(null);
    }
    setRole(next);
    setStructured([]);
  }

  const { clear: clearSuggestion } = useScopedSuggestions(
    assistantScope,
    suggestionSnapshot,
    (cached) => {
      setRoleCards(cached?.roleCards ?? {});
      setAsking(false);
      writing.current = false;
      artDraft.current = cached?.art ?? null;
      storyDraft.current = cached?.story ?? null;
      setPending(cached?.pending ?? null);
      setPendingRole(cached?.pendingRole ?? null);
      setPendingScenes(cached?.pendingScenes ?? null);
      setPendingRetry(cached?.pendingRetry ?? null);
      setStructured(cached?.structured ?? []);
      setTurns(cached?.turns ?? []);
      turnsRef.current = cached?.turns ?? [];
    },
  );

  function publishCard(nextRole: Role, card: RoleCard) {
    if (assistantScope !== scopeRef.current) return;
    setRoleCards((prev) => ({ ...prev, [nextRole]: card }));
  }

  function markApplied(nextRole: Role) {
    clearSuggestion();
    setRoleCards((prev) => ({ ...prev, [nextRole]: undefined }));
    setPending(null);
    setPendingRole(null);
    setPendingScenes(null);
    setStructured([]);
  }

  async function fillCast(base: FilmProject) {
    const story = castExtractionStory(base);
    if (story === null) return;
    const epoch = noticeEpoch.current;
    const requestVersion = ++castEpoch.current;
    return extractAndMergeCast(base, story, {
      connected,
      request: completeAgent,
      current: () => filmRef.current,
      valid: () => filmRef.current?.id === base.id && requestVersion === castEpoch.current,
      noticeCurrent: () => noticeEpoch.current === epoch,
      apply: applyLive,
      notice: setNotice,
    });
  }

  async function makePortraits(characterId: string) {
    const current = filmRef.current;
    const character = current?.characters.find((item) => item.id === characterId);
    if (!current || !character) return;
    const valid = requestSequences.current.begin(
      current.id,
      `portrait-identity:${characterId}`,
      () => filmRef.current?.id ?? "",
    );
    await preparePortraitIdentity(current, character.id, {
      current: () => filmRef.current,
      valid,
      request: completeAgent,
      apply: applyLive,
      confirm: confirmPortraits,
      notice: setNotice,
      failed: () => emitNotice({ code: "PORTRAIT_FAILED", text: "定妆照未完成，可以重试。" }),
    });
  }

  async function confirmPortraits(selection?: string | string[]) {
    const characterId = typeof selection === "string" ? selection : undefined;
    const current = filmRef.current;
    const character = current?.characters.find((item) => item.id === characterId);
    if (!current || (characterId && !character)) return;
    if (character && !character.identity.trim()) {
      setNotice("先写下外貌，再出定妆照。");
      return;
    }
    if (!window.aijian?.generateFilmStill) {
      setNotice("请打开安装好的 AIVORA 再出图。");
      return;
    }
    if (workOwners.has(current.id, "portraits")) return;
    const release = workOwners.begin(current.id, "portraits");
    try {
      const valid = requestSequences.current.begin(
        current.id,
        "portraits",
        () => filmRef.current?.id ?? "",
      );
      let baseline: FilmProject;
      try {
        baseline = await captureBeforeGeneration(current, valid);
      } catch (error) {
        const stale = historyInputStale(error);
        if (valid())
          setNotice({
            code: stale ? "REQUEST_STALE" : "HISTORY_BACKUP_FAILED",
            text: stale ? NOTICE_TEXT.REQUEST_STALE : NOTICE_TEXT.HISTORY_BACKUP_FAILED,
            detail: stale
              ? "作品内容已变化，定妆照批次尚未开始生成。"
              : "定妆照批次尚未开始生成，请先保存历史再试。",
          });
        return;
      }
      await makeAllPortraits({
        base: baseline,
        characterIds: Array.isArray(selection)
          ? selection
          : characterId
            ? [characterId]
            : undefined,
        current: () => filmRef.current,
        isCurrent: valid,
        apply: async (next) => {
          if (!valid()) return;
          applyLive(next);
          await saveFilm(next);
        },
        generate: (prompt, references) => requestFilmStill(baseline, prompt, references),
        progress: (batch) => {
          if (valid())
            emitNotice({
              code: batch.failed
                ? "PORTRAIT_FAILED"
                : batch.done === batch.total
                  ? "PORTRAIT_DONE"
                  : "PORTRAIT_PROGRESS",
              text: `定妆照 ${batch.done}/${batch.total}，失败 ${batch.failed}。`,
              detail: batch.failures.map((item) => `${item.view}：${item.reason}`).join("；"),
            });
        },
      });
    } finally {
      release();
    }
  }

  async function planWriter(kind: "write" | "adapt") {
    if (!film) return;
    const base = structuredClone(filmRef.current ?? film);
    const origin = structuredClone(editorSelection.current);
    const scoped = globalEditorRequest(base, origin, completeAgent);
    if (!scoped.ok) {
      emitNotice({ code: scoped.code, text: "选中内容已失效，请重新选择。" });
      return;
    }
    storyDraft.current = null;
    const input = writerDraftInput(base, kind, chat);
    const scope = scopeRef.current;
    const turn = pushTurn("writer", input.asked);
    setPendingScenes(null);
    let result: WriterDraftResult;
    try {
      result = await planWriterDraft(input, { connected, request: scoped.request });
    } finally {
      if (activeTurn.current === turn) {
        writing.current = false;
        setAsking(false);
      }
    }
    if (scope !== scopeRef.current || !isTurnCurrent(turn)) return;
    const { scenes, notice: text } = result;
    setPendingScenes(scenes);
    if (scenes) {
      const draft: StoryDraft = {
        transaction: prepareWriterTransaction(base, scenes, result.writerPlan),
        origin,
      };
      storyDraft.current = draft;
      publishCard("writer", {
        storyDraft: draft,
        title: `建议写成 ${scenes.length} 场`,
        rows: scenes.map((item) => ({
          id: item.id,
          mark: "场",
          text: item.where || item.title,
          tail: "",
        })),
        notes: [],
        applied: false,
        mode: "scenes",
        scenes,
      });
    }
    finishTurn(turn, text);
    noteAgent("writer", result.event, text);
  }

  function applyPendingScenes() {
    if (!film || !pendingScenes) {
      setNotice("还没有可放入的场次。");
      return;
    }
    void applyPendingStory(
      storyDraft.current?.transaction.kind === "writer" ? storyDraft.current : undefined,
    );
  }

  async function importBook(file: File) {
    const input = captureBookImportInput(filmRef.current);
    const turn = activeTurn.current;
    const valid = requestSequences.current.begin(
      filmRef.current?.id ?? "",
      "import",
      () => filmRef.current?.id ?? "",
    );
    const current = () =>
      valid() && activeTurn.current === turn && bookImportInputUnchanged(input, filmRef.current);
    try {
      const result = await prepareBookImport(file);
      if (!current()) return;
      if (result.kind === "notice") {
        setNotice(result.notice);
        return;
      }
      const applied = applyBookImportSource(input, result, filmRef.current);
      if (applied.kind === "stale") return;
      setPendingScenes(result.scenes);
      if (applied.film) {
        filmRef.current = applied.film;
        setFilm(applied.film);
        const draft: StoryDraft = {
          transaction: prepareWriterTransaction(structuredClone(filmRef.current!), result.scenes),
          origin: structuredClone(editorSelection.current),
        };
        storyDraft.current = draft;
        publishCard("writer", {
          storyDraft: draft,
          title: `建议写成 ${result.scenes.length} 场`,
          rows: result.scenes.map((row) => ({
            id: row.id,
            mark: "场",
            text: row.where || row.title,
            tail: "",
          })),
          notes: [],
          applied: false,
          mode: "scenes",
          scenes: result.scenes,
        });
      }
      setRole("writer");
      setNotice(result.notice);
    } catch {
      if (current()) emitNotice({ code: "IMPORT_FAILED", text: "没有读到文件，请重试。" });
    }
  }

  function planAction() {
    return withForeground(planActionWork, "PLANACTION_FAILED");
  }

  async function withForeground(work: () => Promise<void>, code: string) {
    const running = work();
    const turn = activeTurn.current;
    try {
      await running;
    } catch {
      if (activeTurn.current === turn) {
        finishTurn(turn, "这一阶段未完成，可以重试。");
        emitNotice({ code, text: "这一阶段未完成，可以重试。" });
      }
    } finally {
      if (activeTurn.current === turn) {
        writing.current = false;
        setAsking(false);
      }
    }
  }

  async function planActionWork() {
    if (!film) return;
    const turn = pushTurn("action", chat.trim() || "请给这一镜设计动作，标出难度。");
    const current = shownShots[shot];
    const base = structuredClone(filmRef.current ?? film);
    const selection = {
      ...editorSelection.current,
      sceneId: current?.sceneId,
      shotId: current?.id,
    };
    if (
      !current ||
      !base.shots.some((row) => row.id === current.id && row.sceneId === current.sceneId)
    ) {
      finishTurn(turn, "先拆出镜头，再请动作指导。");
      return;
    }
    const result = await planActionDraft(
      base,
      current ? base.shots.find((row) => row.id === current.id) : undefined,
      {
        request: completeAgent,
        current: () => isTurnCurrent(turn),
        connected,
      },
    );
    if (!isTurnCurrent(turn) || result.status === "stale") return;
    if (result.status === "rejected") {
      finishTurn(turn, result.notice);
      if (result.logRejection) noteAgent("action", "rejected", result.notice);
      return;
    }
    if (result.unassigned) unassignedDraft.current = result.unassigned;
    const actionShot = result.shot;
    setStructured([]);
    setPending([actionShot]);
    setPendingRole("action");
    publishCard("action", {
      directionDiff: prepareShotDirection(
        base,
        actionShot,
        selection,
        "action",
        result.actionState,
        result.unassigned,
      ),
      title: `动作设计 · 镜头 ${actionShot.no}`,
      rows: result.notes.map((line, index) => ({
        id: `${actionShot.id}-beat-${index}`,
        mark: "难度",
        text: line,
        tail: "",
      })),
      notes: [DIFFICULTY_LEGEND],
      applied: false,
      mode: "shots",
      shots: [actionShot],
      actionState: result.actionState,
    });
    finishTurn(turn, result.structuredNotice ?? result.notice);
    noteAgent("action", result.event, result.notice);
  }

  function planPerformance() {
    return withForeground(planPerformanceWork, "PLANPERFORMANCE_FAILED");
  }

  async function planPerformanceWork() {
    if (!film) return;
    const turn = pushTurn("performance", chat.trim() || "请写这一镜的表演，两人以上要写视线。");
    const current = shownShots[shot];
    if (!current) {
      finishTurn(turn, "先拆出镜头，再请表演指导。");
      noteAgent("performance", "rejected", "先拆出镜头，再请表演指导。");
      return;
    }
    const base = structuredClone(filmRef.current ?? film);
    const selection = { ...editorSelection.current, sceneId: current.sceneId, shotId: current.id };
    const capturedShot = base.shots.find(
      (row) => row.id === current.id && row.sceneId === current.sceneId,
    );
    if (!capturedShot) {
      finishTurn(turn, "镜头已变更，请重新生成建议。");
      return;
    }
    const result = await planPerformanceDraft(capturedShot, {
      request: completeAgent,
      current: () => isTurnCurrent(turn),
      connected,
    });
    if (!isTurnCurrent(turn) || result.status === "stale") return;
    if (result.status === "rejected") {
      finishTurn(turn, result.notice);
      return;
    }
    const performanceShot = result.shot;
    const line = result.line;
    setStructured(line ? [line] : []);
    setPending([performanceShot]);
    setPendingRole("performance");
    publishCard("performance", {
      directionDiff: prepareShotDirection(
        base,
        performanceShot,
        selection,
        "performance",
        result.performanceState,
      ),
      title: `表演 · 镜头 ${current.no}`,
      performanceState: result.performanceState,
      rows: line ? [{ id: current.id, mark: "表演", text: line, tail: "" }] : [],
      notes: [],
      applied: false,
      mode: "shots",
      shots: [performanceShot],
    });
    finishTurn(turn, result.notice);
    noteAgent("performance", result.event, result.notice);
  }

  const applyingDirection = useRef(false);
  async function applyPendingDirection(transaction: ShotDirectionTransaction | undefined) {
    const live = filmRef.current;
    if (!transaction || !live || applyingDirection.current) return;
    const expected = transaction.selection,
      selected = editorSelection.current;
    if (
      selected.projectId !== expected.projectId ||
      selected.page !== expected.page ||
      selected.sceneId !== expected.sceneId ||
      shownShots[shot]?.id !== expected.shotId
    ) {
      setNotice("镜头已变更，请重新生成建议。");
      return;
    }
    const result = applyShotDirection(live, transaction);
    if (!result.receipt) {
      setNotice(
        result.conflicts.includes("FIELD_LOCKED")
          ? "这一镜是你改过的，没有盖掉。"
          : "镜头已变更，请重新生成建议。",
      );
      return;
    }
    const completionOrigin = structuredClone(editorSelection.current);
    let appliedVersion: FilmProject | null = null;
    applyingDirection.current = true;
    try {
      if (committed.current?.id === live.id)
        pageHistory.record(committed.current, live, historyScope.current);
      applyLive(result.film);
      const applied = filmRef.current!;
      appliedVersion = applied;
      pageHistory.recordDirection(result.receipt);
      committed.current = applied;
      skipHistory.current = true;
      setHistoryTick((value) => value + 1);
      markApplied(transaction.role);
      const stored = await persistence.save(applied);
      if (
        appliedVersion &&
        editorCompletionCurrent(
          appliedVersion,
          completionOrigin,
          filmRef.current,
          editorSelection.current,
        )
      )
        setNotice(
          stored
            ? "已放进这一镜。你改过的字没有被盖掉。"
            : {
                code: "SAVE_FAILED",
                text: NOTICE_TEXT.SAVE_FAILED,
                detail: "修改已经应用，但还没保存上。请重试保存。",
              },
        );
    } catch {
      if (
        appliedVersion &&
        editorCompletionCurrent(
          appliedVersion,
          completionOrigin,
          filmRef.current,
          editorSelection.current,
        )
      )
        setNotice({
          code: "SAVE_FAILED",
          text: NOTICE_TEXT.SAVE_FAILED,
          detail: "修改已经应用，但还没保存上。请重试保存。",
        });
    } finally {
      applyingDirection.current = false;
    }
  }

  async function applyPendingArt() {
    const transaction = artDraft.current;
    const live = filmRef.current;
    if (!transaction || !live || applyingArt.current) return;
    const selection = editorSelection.current;
    const expected = transaction.selection;
    if (
      selection.projectId !== expected.projectId ||
      selection.page !== expected.page ||
      selection.sceneId !== expected.sceneId ||
      selection.shotId !== expected.shotId
    ) {
      setNotice("当前选择已改变，请回到美术建议所在页面再应用。");
      return;
    }
    const styleOnly = projectArtStyleFields(transaction, expected) !== null;
    const result = applyArtTransaction(live, transaction);
    if (!result.receipt) {
      setNotice("内容后来改过，这次美术建议没有覆盖。请重新生成建议。");
      return;
    }
    const completionOrigin = structuredClone(editorSelection.current);
    let appliedVersion: FilmProject | null = null;
    applyingArt.current = true;
    try {
      if (committed.current?.id === live.id)
        pageHistory.record(committed.current, live, historyScope.current);
      applyLive(result.film);
      const applied = filmRef.current!;
      appliedVersion = applied;
      pageHistory.recordArt(result.receipt);
      committed.current = applied;
      skipHistory.current = true;
      setHistoryTick((value) => value + 1);
      artDraft.current = null;
      markApplied("art");
      const stored = await persistence.save(applied);
      if (
        appliedVersion &&
        editorCompletionCurrent(
          appliedVersion,
          completionOrigin,
          filmRef.current,
          editorSelection.current,
        )
      )
        setNotice(
          stored
            ? styleOnly
              ? {
                  code: "STEP_COMPLETE",
                  text: NOTICE_TEXT.STEP_COMPLETE,
                  detail: "画风说明已修改。",
                }
              : "画风、外貌、场景和道具已放进去。你改过的外貌没有被盖掉。"
            : "美术建议已应用，但还没有保存。",
        );
    } catch {
      if (
        appliedVersion &&
        editorCompletionCurrent(
          appliedVersion,
          completionOrigin,
          filmRef.current,
          editorSelection.current,
        )
      )
        setNotice("美术建议已应用，但还没有保存。");
    } finally {
      applyingArt.current = false;
    }
  }

  function rejectPendingSuggestion() {
    if (role === "art" && roleCards.art?.fieldRows !== undefined) {
      if (applyingArt.current) return;
      artDraft.current = null;
    }
    markApplied(role);
  }

  function planArt() {
    return withForeground(planArtWork, "PLANART_FAILED");
  }

  async function planArtWork() {
    if (!film) return;
    const base = structuredClone(filmRef.current ?? film);
    const selection = structuredClone(editorSelection.current);
    const scoped = globalEditorRequest(base, selection, completeAgent);
    if (!scoped.ok) {
      emitNotice({ code: scoped.code, text: "选中内容已失效，请重新选择。" });
      return;
    }
    const turn = pushTurn("art", chat.trim() || "请定画风，并给每个人一句固定外貌。");
    const result = await planArtDraft(base, {
      request: scoped.request,
      current: () => isTurnCurrent(turn),
    });
    if (!isTurnCurrent(turn) || result.status === "stale") return;
    if (result.status === "rejected") {
      setStructured([]);
      finishTurn(turn, result.notice);
      noteAgent("art", "rejected", result.notice);
      return;
    }
    const transaction = prepareArtTransaction(base, result.draft, selection);
    const fieldRows = projectArtStyleFields(transaction, selection);
    artDraft.current = transaction;
    setStructured(result.lines);
    publishCard("art", {
      artDiff: transaction,
      ...(fieldRows !== null ? { fieldRows } : {}),
      title: "美术 · 画风和外貌",
      rows: result.lines.map((line, index) => ({
        id: `art-${index}`,
        mark: "",
        text: line,
        tail: "",
      })),
      notes: [],
      applied: false,
      mode: "art",
    });
    finishTurn(
      turn,
      fieldRows !== null
        ? {
            code: "STEP_COMPLETE",
            text: NOTICE_TEXT.STEP_COMPLETE,
            detail: "画风说明已准备好，确认后才修改。",
          }
        : "美术写好了。点「放进分镜」，外貌、场景和道具才会改。",
    );
    noteAgent("art", "art", "美术写好了。点「放进分镜」，外貌、场景和道具才会改。");

    setPending(null);
    setPendingRole(null);
  }

  const [videoReview, setVideoReview] = useState<{
    request: NonNullable<ReturnType<typeof editorHost.capture>>;
    facts: ReturnType<typeof compileSevenPartVideo>;
    before: string | null;
    modelText: string;
    changed: boolean;
    result: "saved" | "unsaved" | "rejected" | null;
  } | null>(null);
  const [videoReviewBusy, setVideoReviewBusy] = useState(false);
  const videoReviewWorking = useRef(false);
  function videoReviewMatches(review: NonNullable<typeof videoReview>) {
    const live = filmRef.current,
      selected = editorSelection.current;
    const origin = review.request.selection;
    const target = live?.shots.find((item) => item.id === origin.shotId);
    const compiled = live && target ? compileSevenPartVideo(live, target) : null;
    return !!(
      live &&
      target &&
      live.id === origin.projectId &&
      selected.page === origin.page &&
      selected.shotId === origin.shotId &&
      selected.sceneId === origin.sceneId &&
      compiled &&
      compiled.issues.length === 0 &&
      compiled.draft.factsKey === review.facts.draft.factsKey
    );
  }
  function organizeVideoFacts() {
    if (videoReviewWorking.current) return;
    const request = editorHost.capture();
    const target = request?.base.shots.find((item) => item.id === request.selection.shotId);
    if (!request || !target) return;
    const facts = compileSevenPartVideo(request.base, target);
    const proposed = {
      ...request.base,
      shots: request.base.shots.map((item) =>
        item.id === target.id ? { ...item, reviewedVideoPrompt: facts.draft } : item,
      ),
    };
    let modelText = "";
    if (!facts.issues.length) {
      try {
        modelText =
          storyFilmBatches(
            proposed,
            [proposed.shots.find((item) => item.id === target.id)!],
            proposed.draft,
          )[0]?.shots?.[0]?.prompt ?? "";
      } catch (error) {
        facts.issues.push(
          error instanceof Error &&
            /VOICE_.*REQUIRED/.test(String((error as { code?: string }).code))
            ? "台词的声音选择尚未完成，请先核对说话人和声音。"
            : "完整提交文本无法使用；请精简过长的说明，或调整时长、拆分镜头后重新整理。",
        );
      }
    }
    const diff = editorHost.preview(request, proposed);
    if (!diff || diff.unsupported.length) return;
    let before: string | null =
      target.reviewedVideoPrompt === undefined
        ? null
        : "原保存说明已过期或无法核对，暂不展示其内容。";
    try {
      const checked = reviewedVideoText(request.base, target);
      if (checked !== undefined) before = checked;
    } catch {
      /* No raw unverified body reaches the display. */
    }
    setVideoReview({
      request,
      facts,
      before,
      modelText,
      changed: diff.changes.length > 0,
      result: null,
    });
  }
  async function confirmVideoFacts() {
    const review = videoReview;
    if (
      !review ||
      !review.changed ||
      videoReviewWorking.current ||
      review.result ||
      review.facts.issues.length
    )
      return;
    if (!videoReviewMatches(review)) {
      setVideoReview((current) =>
        current?.request.id === review.request.id ? { ...current, result: "rejected" } : current,
      );
      return;
    }
    videoReviewWorking.current = true;
    setVideoReviewBusy(true);
    try {
      const result = await editorHost.apply(review.request.id);
      if (result.completionCurrent === false) return;
      setVideoReview((current) =>
        current?.request.id === review.request.id
          ? {
              ...current,
              result:
                result.status === "saved"
                  ? "saved"
                  : result.status === "applied_unsaved"
                    ? "unsaved"
                    : "rejected",
            }
          : current,
      );
    } finally {
      videoReviewWorking.current = false;
      setVideoReviewBusy(false);
    }
  }

  function planPrompter() {
    return withForeground(planPrompterWork, "PLANPROMPTER_FAILED");
  }

  const [promptApplying, setPromptApplying] = useState(false);
  const promptApplyBusy = useRef(false);
  const readyPromptRequests = useRef(new Set<number>());
  useEffect(() => {
    readyPromptRequests.current.clear();
  }, [film?.id]);
  function rejectPendingPrompt() {
    const card = roleCards.prompter;
    if (
      !card ||
      card.editorRequestId === undefined ||
      card.applied ||
      promptApplyBusy.current ||
      !readyPromptRequests.current.has(card.editorRequestId)
    )
      return;
    readyPromptRequests.current.delete(card.editorRequestId);
    setRoleCards((previous) =>
      previous.prompter?.editorRequestId === card.editorRequestId
        ? { ...previous, prompter: undefined }
        : previous,
    );
    if (card.editorTurnId)
      finishTurn(card.editorTurnId, {
        code: "OPERATION_CANCELLED",
        text: NOTICE_TEXT.OPERATION_CANCELLED,
      });
    setNotice({ code: "OPERATION_CANCELLED", text: NOTICE_TEXT.OPERATION_CANCELLED });
  }
  async function applyPendingPrompt() {
    const card = roleCards.prompter;
    if (
      !card ||
      card.applied ||
      card.editorRequestId === undefined ||
      !card.fieldRows?.length ||
      !readyPromptRequests.current.has(card.editorRequestId) ||
      promptApplyBusy.current
    )
      return;
    promptApplyBusy.current = true;
    setPromptApplying(true);
    try {
      const result = await editorHost.apply(card.editorRequestId);
      if (result.completionCurrent === false) return;
      if (result.status === "rejected") {
        const code = result.conflicts.includes("SELECTION_MISMATCH")
          ? "SELECTION_MISMATCH"
          : result.conflicts.includes("BUSY")
            ? "BUSY"
            : "EDITOR_EDIT_CONFLICT";
        setNotice({ code, text: NOTICE_TEXT[code] });
        return;
      }
      readyPromptRequests.current.delete(card.editorRequestId);
      setRoleCards((previous) => {
        const current = previous.prompter;
        return current && current.editorRequestId === card.editorRequestId
          ? { ...previous, prompter: { ...current, applied: true } }
          : previous;
      });
      const completion =
        result.status === "applied_unsaved"
          ? { code: "PROMPTER_APPLIED_UNSAVED", text: NOTICE_TEXT.PROMPTER_APPLIED_UNSAVED }
          : { code: "PROMPTER_FIELDS_APPLIED", text: NOTICE_TEXT.PROMPTER_FIELDS_APPLIED };
      if (card.editorTurnId) finishTurn(card.editorTurnId, completion);
      setNotice(completion);
    } finally {
      promptApplyBusy.current = false;
      setPromptApplying(false);
    }
  }

  async function planPrompterWork() {
    if (!film) return;
    const current = shownShots[shot];
    const request = editorHost.capture();
    const turn = pushTurn("prompter", chat.trim() || `写镜头 ${current?.no ?? shot + 1} 的提示词`);
    if (!current || !request || request.selection.shotId !== current.id) {
      finishTurn(turn, "先拆出镜头，再请提示词工程师。");
      noteAgent("prompter", "rejected", "先拆出镜头，再请提示词工程师。");
      return;
    }
    const result = await planPrompterDraft(request.base, current, {
      request: completeAgent,
      current: () => isTurnCurrent(turn),
    });
    if (!isTurnCurrent(turn) || result.status === "stale") return;
    if (result.status === "rejected") {
      finishTurn(turn, result.notice);
      noteAgent("prompter", "rejected", result.notice);
      return;
    }
    const editorDiff = editorHost.preview(request, result.film);
    const fieldRows = projectShotPromptFields(editorDiff ?? undefined, request.selection);
    if (fieldRows !== null) {
      readyPromptRequests.current.clear();
      readyPromptRequests.current.add(request.id);
      publishCard("prompter", {
        editorDiff: editorDiff ?? undefined,
        editorRequestId: request.id,
        editorTurnId: turn,
        fieldRows,
        title: `画面说明 · 镜头 ${current.no}`,
        rows: [],
        notes: [],
        applied: false,
        mode: "shots",
      });
      const ready = {
        code: "PROMPTER_SUGGESTION_READY",
        text: NOTICE_TEXT.PROMPTER_SUGGESTION_READY,
      };
      finishTurn(turn, ready);
      setNotice(ready);
      noteAgent("prompter", "prompt", `镜头 ${current.no}`);
      return;
    }
    const applied = await editorHost.apply(request.id);
    if (!isTurnCurrent(turn) || applied.completionCurrent === false) return;
    if (applied.status !== "saved") {
      finishTurn(
        turn,
        applied.status === "applied_unsaved"
          ? "提示词已应用，但还没有保存。"
          : "镜头已变更，这次建议没有写入。",
      );
      return;
    }
    setStructured([result.zh, result.en ? `英文：${result.en}` : "英文还没写。"].filter(Boolean));
    const missed =
      result.missing.length > 0 ? `已补上${result.missing.join("、")}的外貌描述。` : "";
    publishCard("prompter", {
      editorDiff: editorDiff ?? undefined,
      title: `提示词 · 镜头 ${current.no}`,
      rows: [{ id: current.id, mark: "中文", text: result.zh, tail: "" }],
      notes: result.en ? [`英文：${result.en}`] : [],
      applied: true,
      mode: "shots",
    });
    finishTurn(turn, `已写到镜头 ${current.no}。提示词写好了。${missed}`);
    noteAgent("prompter", "prompt", `镜头 ${current.no}`);
  }

  function planQc() {
    return withForeground(planQcWork, "PLANQC_FAILED");
  }

  async function planQcWork() {
    if (!film) return;
    const turn = pushTurn("qc", chat.trim() || "请审这一镜的文字。你看不到画面。");
    const current = shownShots[shot];
    const result = await reviewShotText(film, current, {
      request: completeAgent,
      valid: () => isTurnCurrent(turn),
      current: () => filmRef.current,
      apply: rememberFilm,
    });
    if (!isTurnCurrent(turn) || result.status === "stale") return;
    if (result.status === "rejected") {
      setStructured([]);
      finishTurn(turn, result.notice);
      noteAgent("qc", "rejected", result.notice);
      return;
    }
    if (result.status === "blocked") {
      finishTurn(turn, NOTICE_TEXT.REQUEST_STALE);
      return;
    }
    setStructured(result.lines);
    publishCard("qc", {
      title: `审片意见 · 镜头 ${current!.no}`,
      rows: result.lines.map((line, index) => ({
        id: `qc-${index}`,
        mark: "意见",
        text: line,
        tail: "",
      })),
      notes: ["这是对文字的意见，没有看画面，版本仍由你选。"],
      applied: false,
      mode: "qc",
    });
    finishTurn(turn, "这是对文字的意见，没有看画面，版本仍由你选。");
    noteAgent("qc", "qc", "文字意见");
  }

  function oneClickFilm() {
    return pipelineWorkspace.start();
  }

  function applyTemplate(name: string) {
    if (!film) return;
    const template = FILM_TEMPLATES.find((item) => item.name === name);
    if (!template) return;
    const scene = {
      ...film.scenes[0]!,
      id: film.scenes[0]?.id ?? "scene-1",
      text: template.text,
      title: template.name,
      source: "template",
      userFields: [],
    };
    const unnamed = !film.seriesTitle.trim() || film.seriesTitle === "未命名作品";
    setFilm({
      ...film,
      title: unnamed ? template.name : film.title,
      seriesTitle: unnamed ? template.name : film.seriesTitle,
      scenes: [scene, ...film.scenes.slice(1)],
    });
    setNotice(`已放入模板「${template.name}」。这是模板原文，还没让模型改。`);
  }

  async function previewVoice(voiceId: string, line: string) {
    const epoch = ++previewEpoch.current;
    previewSession.current?.dispose();
    previewSession.current = null;
    previewAudio.current = null;
    if (!soundOn || hearing) {
      setHearing(false);
      if (hearing) void window.aijianGrok?.cancelSpeech?.();
      setNotice(!soundOn ? "声音关着。按 M 打开声音再试听。" : "已停止试听。");
      return;
    }
    const spoken = line.trim();
    if (!spoken) {
      setNotice("先在剧本里给 TA 写一句台词。");
      return;
    }
    const project = filmRef.current?.id;
    const valid = () =>
      Boolean(project && filmRef.current?.id === project && previewEpoch.current === epoch);
    const bridge = grokBridge();
    if (!bridge?.speak) {
      setNotice(
        connected
          ? {
              code: "VOICE_PREVIEW_UNAVAILABLE",
              text: NOTICE_TEXT.VOICE_PREVIEW_UNAVAILABLE,
              detail: "当前连接不支持单独试听；这次没有生成试听配音。",
            }
          : { code: "GROK_MEMBERSHIP_REQUIRED", text: NOTICE_TEXT.GROK_MEMBERSHIP_REQUIRED },
      );
      return;
    }
    setHearing(true);
    let preview: VoicePreview | undefined;
    try {
      preview = await prepareVoicePreview(voiceId, spoken, {
        speak: bridge.speak.bind(bridge),
        billing: ensureBillingProject,
        valid,
      });
      if (!valid()) {
        preview.dispose();
        return;
      }
      previewSession.current = preview;
      previewAudio.current = preview.audio;
      await preview.audio.play();
      if (!valid()) {
        preview.dispose();
        return;
      }
      const playing = preview;
      preview.audio.onended = () => {
        playing.dispose();
        if (valid()) {
          previewSession.current = null;
          previewAudio.current = null;
          setHearing(false);
        }
      };
      preview.audio.onerror = () => {
        playing.dispose();
        if (valid()) {
          previewSession.current = null;
          previewAudio.current = null;
          setHearing(false);
          setNotice("配音文件到了，这一页没有播出来。");
        }
      };
      const timing = preview.timestamps ? "带回了每个字的时间。" : "这一次没有返回每个字的时间。";
      setNotice(
        `正在试听。${timing}${preview.seconds ? `大约 ${preview.seconds.toFixed(1)} 秒。` : ""}`,
      );
      return preview.seconds;
    } catch (error) {
      preview?.dispose();
      if (!valid()) return;
      previewSession.current = null;
      previewAudio.current = null;
      setHearing(false);
      setNotice(
        error instanceof Error && error.message === "VOICE_METADATA_TIMEOUT"
          ? "配音已生成，但加载超时，还没有播放。可以重试。"
          : preview || (error instanceof Error && error.message === "VOICE_AUDIO_FAILED")
            ? "配音文件到了，这一页没有播出来。"
            : "配音没有成功，可以重试。",
      );
    }
  }

  async function timeShotFromLine(shotId: string) {
    const current = filmRef.current;
    const shot = current?.shots.find((item) => item.id === shotId);
    if (!current || !shot) return;
    if (shot.userFields.includes("seconds")) {
      setNotice("这一镜的时长是你改过的，没有覆盖。");
      return;
    }
    const line = shot.line.trim();
    if (!line) {
      setNotice("这一镜没有台词。时长保持导演的选择。");
      return;
    }
    const valid = requestSequences.current.begin(
      current.id,
      `duration:${shotId}`,
      () => filmRef.current?.id ?? "",
    );
    const requestBase = structuredClone(current);
    const origin = structuredClone(editorSelection.current);
    const measurementEpoch = previewEpoch.current + 1;
    const measured = await previewVoice(
      shot.characters.length > 0
        ? current.characters.find((item) => item.name === shot.characters[0])?.voiceId ||
            current.narrationVoiceId
        : current.narrationVoiceId,
      line,
    );
    if (!valid() || previewEpoch.current !== measurementEpoch) return;
    const latest = filmRef.current?.shots.find((item) => item.id === shotId);
    if (!latest || !durationInputUnchanged(shot, latest)) {
      setNotice("台词或时长已修改，保留了你的修改。");
      return;
    }
    const plan = planShotDuration(latest, measured);
    if (plan.kind === "notice") {
      setNotice(plan.notice);
      return;
    }
    if (plan.kind === "split") {
      const splitShots = plan.shots;
      const draft: StoryDraft = {
        transaction: prepareExplicitShotSplitTransaction(requestBase, shotId, splitShots),
        origin,
      };
      storyDraft.current = draft;
      setPending(splitShots);
      setPendingRole("director");
      publishCard("director", {
        storyDraft: draft,
        title: `建议拆成 ${splitShots.length} 个镜头`,
        rows: splitShots.map((item) => ({
          id: item.id,
          mark: item.size,
          text: item.line,
          tail: `${item.seconds}s`,
        })),
        notes: [],
        applied: false,
        mode: "shots",
        shots: splitShots,
      });
      setNotice("这句话超过 15 秒，拆成两镜。点「放进分镜」才会放进去。");
      return;
    }
    setFilm(
      updateShot(filmRef.current ?? current, shot.id, {
        seconds: plan.seconds,
        sound: { ...latest.sound, source: "dub" },
      }),
    );
    setNotice(plan.notice);
  }

  function sendChat() {
    const asked = chat.trim();
    if (role === "writer") void planWriter("write");
    else if (role === "action") void planAction();
    else if (role === "performance") void planPerformance();
    else if (role === "art") void planArt();
    else if (role === "prompter") void planPrompter();
    else if (role === "qc") void planQc();
    else void planDirector(asked);
    setChat("");
  }

  function applyLive(next: FilmProject) {
    const current = filmRef.current;
    const kept =
      current &&
      current.id === next.id &&
      /^prj_[0-9a-f]{32}$/.test(current.backendProjectId) &&
      !/^prj_[0-9a-f]{32}$/.test(next.backendProjectId)
        ? { ...next, backendProjectId: current.backendProjectId }
        : next;
    filmRef.current = kept;
    setFilm(kept);
  }

  useEffect(() => {
    if (film) publishFilmJobs(film);
  }, [film]);

  async function prepareSceneMedia(
    base: FilmProject,
    shots: FilmShot[],
    valid: () => boolean,
    pipeline?: PipelineGenerationHost,
  ) {
    if (!window.aijian?.generateFilmStill) throw new Error(NOTICE_TEXT.DESKTOP_REQUIRED);
    return prepareShotSceneReferences(base, shots, {
      current: () => filmRef.current,
      valid,
      apply: async (next) => {
        if (!valid()) throw new Error("WORK_STALE");
        if (pipeline) await pipeline.apply(next);
        else {
          applyLive(next);
          const live = filmRef.current;
          if (!live || !(await saveFilm(live)))
            throw Object.assign(new Error(NOTICE_TEXT.LOCATION_IMAGE_INCOMPLETE), {
              code: "LOCATION_SAVE_FAILED",
            });
        }
      },
    });
  }

  async function generateFourStills() {
    const current = shownShots[shot];
    const base = filmRef.current;
    if (!base || !current || !window.aijian?.generateFilmStill) {
      setNotice("请打开安装好的 AIVORA 再出图。");
      return;
    }
    if (workOwners.has(base.id, `still:${current.id}`)) return;
    if (stillArmed !== current.id) {
      setStillArmed(current.id);
      setNotice("将出 4 张候选起始画面。点「确认这 4 张」才出图。");
      return;
    }
    setStillArmed("");
    const valid = requestSequences.current.begin(
      base.id,
      `still:${current.id}`,
      () => filmRef.current?.id ?? "",
    );
    const release = workOwners.begin(base.id, `still:${current.id}`, "正在生成候选画面");
    try {
      let baseline: FilmProject;
      try {
        baseline = await captureBeforeGeneration(base, valid);
      } catch (error) {
        const stale = historyInputStale(error);
        if (valid())
          setNotice({
            code: stale ? "GENERATION_SELECTION_STALE" : "HISTORY_BACKUP_FAILED",
            text: stale
              ? NOTICE_TEXT.GENERATION_SELECTION_STALE
              : NOTICE_TEXT.HISTORY_BACKUP_FAILED,
            detail: stale
              ? "作品内容已变化，四张候选画面尚未开始生成。"
              : "四张候选画面尚未开始生成，请先保存历史再试。",
          });
        return;
      }
      const target = baseline.shots.find((row) => row.id === current.id);
      if (!target) return;
      const ready = await prepareSceneMedia(baseline, [target], valid);
      const result = await makeFourStills(
        ready,
        ready.shots.find((row) => row.id === current.id) ?? current,
        {
          current: () => filmRef.current,
          valid,
          apply: applyLive,
        },
      );
      if (valid()) setNotice(result.notice);
    } catch (error) {
      if (valid()) emitNotice(stillFailureNotice(error));
    } finally {
      release();
    }
  }

  async function confirmDeleteFilm() {
    const base = filmRef.current;
    if (!base) return;
    const valid = requestSequences.current.begin(
      base.id,
      "delete",
      () => filmRef.current?.id ?? "",
    );
    await deleteCurrentFilm(base, deleteTarget.current === "series", {
      valid,
      notice: setNotice,
      close: () => setPendingDelete(false),
      apply: (next) => {
        if (next) applyLive(next);
        else {
          filmRef.current = null;
          setFilm(null);
        }
      },
    });
  }

  async function makeShotStill() {
    const current = shownShots[shot];
    const base = filmRef.current;
    if (!base || !current || workOwners.has(base.id, `still:${current.id}`)) return;
    const release = workOwners.begin(base.id, `still:${current.id}`, "正在生成画面");
    setNotice("正在生成这一镜的画面。");
    const valid = requestSequences.current.begin(
      base.id,
      `still:${current.id}`,
      () => filmRef.current?.id ?? "",
    );
    try {
      const ready = await prepareSceneMedia(base, [current], valid);
      const result = await generateShotStill(
        ready,
        ready.shots.find((row) => row.id === current.id) ?? current,
        {
          current: () => filmRef.current,
          valid,
          apply: applyLive,
        },
      );
      if (valid()) setNotice(result.notice);
    } catch (error) {
      if (valid()) {
        if (error instanceof Error && "code" in error && error.code === "SHOT_STILL_INPUT_CHANGED")
          emitNotice({ code: "SHOT_STILL_INPUT_CHANGED", text: error.message });
        else emitNotice(stillFailureNotice(error));
      }
    } finally {
      release();
    }
  }

  async function retryGenerationTasks(ids: string[]) {
    const current = filmRef.current;
    if (!current || generationRuns.current.has(current.id)) return;
    const plan = prepareGenerationRetry(current, ids);
    if (plan.kind === "empty") return;
    if (plan.kind === "blocked") {
      await submitGeneration(plan.targets, false, undefined, plan.blockedIds);
      return;
    }
    applyLive(plan.film);
    pauseRef.current = false;
    const retry = submitGeneration(plan.targets, true, plan.takeIds);
    setPaused(false);
    await retry;
    if (
      filmRef.current?.id === current.id &&
      filmRef.current.shots.some((row) => row.takes.some(canResumeTake))
    ) {
      pauseRef.current = true;
      setPaused(true);
    }
  }

  async function submitGeneration(
    targets?: FilmShot[],
    resume = false,
    takeIds?: string[],
    blockedIds?: string[],
    pipeline?: PipelineGenerationHost,
  ) {
    const id = filmRef.current?.id;
    if (!id || generationRuns.current.has(id) || persistentHistoryBusyRef.current) return;
    generationRuns.current.add(id);
    try {
      await runGeneration(targets, resume, takeIds, blockedIds, pipeline);
    } finally {
      generationRuns.current.delete(id);
    }
  }
  resumeGenerationRef.current = () => {
    if (filmRef.current?.shots.some((row) => row.takes.some(canResumeTake)))
      void submitGeneration(undefined, true);
  };

  async function runGeneration(
    targets?: FilmShot[],
    resume = false,
    takeIds?: string[],
    blockedIds?: string[],
    pipeline?: PipelineGenerationHost,
  ) {
    const mine = ++runToken.current;
    const requestedVersions = pipeline?.versions ?? versions;
    const applyGeneration = async (next: FilmProject) => {
      if (pipeline) await pipeline.apply(next);
      else applyLive(next);
    };
    stopRef.current = false;
    let live = filmRef.current ?? film;
    if (!live) return;
    pruneCancelledJobs(live, cancelledJobs.current);
    const generationProject = live.id;
    const valid = () =>
      filmRef.current?.id === generationProject &&
      runToken.current === mine &&
      (pipeline?.current() ?? true);
    const preflight = generationPreflight(live, {
      targets,
      resume,
      fallback: shownShots[shot],
      modelIds,
    });
    let selected = preflight.selected;
    if (selected.length === 0) {
      setNotice("先在剧本里拆镜头。");
      return;
    }
    setNotice(generationEstimate(selected.length, requestedVersions, duration));
    if (preflight.kind === "stopped") {
      setNotice(preflight.notice);
      return;
    }
    const gate = actions.regenerate;
    const bridge = window.aijian;
    const billingProject = pipeline?.billingProjectId ?? (await ensureBillingProject());
    if (!valid()) return;
    live = filmRef.current ?? live;
    // Billing preparation may yield while shots are edited or removed. Resolve only the
    // originally requested IDs against the live work; never revive a removed snapshot.
    const latestGeneration = live;
    if (!latestGeneration) return;
    const latestTargets = selected.map((target) =>
      latestGeneration.shots.find((row) => row.id === target.id),
    );
    if (latestTargets.some((target) => !target)) {
      setNotice("所选镜头已经变化，请重新选择后生成。");
      return;
    }
    selected = latestTargets.filter((target): target is FilmShot => Boolean(target));
    const canSubmit = gate.enabled && Boolean(billingProject && bridge?.createStoryFilm);
    const blocked = !gate.enabled ? gate.reason : DESKTOP_REASON;
    if (canSubmit) {
      try {
        live = await captureBeforeGeneration(live, valid, pipeline);
        if (!valid()) return;
        const ids = selected.map((row) => row.id);
        selected = ids
          .map((id) => live!.shots.find((row) => row.id === id))
          .filter((row): row is FilmShot => Boolean(row));
        if (selected.length !== ids.length) throw new Error("HISTORY_STALE");
      } catch (error) {
        const stale = historyInputStale(error);
        if (valid())
          setNotice({
            code: stale ? "GENERATION_SELECTION_STALE" : "HISTORY_BACKUP_FAILED",
            text: stale
              ? NOTICE_TEXT.GENERATION_SELECTION_STALE
              : NOTICE_TEXT.HISTORY_BACKUP_FAILED,
            detail: stale
              ? "作品内容已变化，本批尚未开始生成。"
              : "本批尚未开始生成，未自动重试。请先保存历史再试。",
          });
        if (pipeline) {
          const code = stale ? "PIPELINE_REQUEST_STALE" : "HISTORY_BACKUP_FAILED";
          throw Object.assign(new Error(code), { code });
        }
        return;
      }
    }
    const preparation = prepareGeneration(live, selected, {
      versions: requestedVersions,
      resume,
      takeIds,
      blockedIds,
      canSubmit,
      blockedReason: blocked,
    });
    if (preparation.kind === "blocked") {
      if (preparation.apply) await applyGeneration(preparation.film);
      setNotice(preparation.notice);
      return;
    }
    const prepared = preparation.prepared;
    const next = prepared.film;
    const groups = prepared.groups;
    await applyGeneration(next);
    try {
      try {
        await prepareSceneMedia(next, selected, valid, pipeline);
      } catch (error) {
        if (!valid()) return;
        if (
          error instanceof Error &&
          ["WORK_STALE", "VIDEO_CANCELLED", "REQUEST_CANCELLED"].includes(error.message)
        )
          throw error;
        const notice = stillFailureNotice(error);
        const failed = failQueuedVideoPrerequisites(filmRef.current ?? next, groups, notice.text);
        await applyGeneration(failed);
        if (!pipeline && valid() && filmRef.current) await saveFilm(filmRef.current);
        if (valid()) emitNotice(notice);
        return;
      }
      await runPreparedGeneration(prepared, {
        current: () => filmRef.current,
        valid,
        apply: applyGeneration,
        persist: async (snapshot) => {
          if (!pipeline) await saveFilm(snapshot);
        },
        stopped: () => stopRef.current,
        paused: () => pauseRef.current,
        cancelled: (jobId) => cancelledJobs.current.has(jobId),
        request: (body) => bridge!.createStoryFilm!(billingProject, body),
        notice: emitNotice,
        completed: ({ shotId, done, message }) => {
          if (done && shotId === openShotRef.current) setPlaying(true);
          setNotice((current) =>
            current.startsWith("已暂停")
              ? current
              : done
                ? "这一版已经生成。"
                : message || "没有生成成功，可以重试。",
          );
        },
      });
    } catch (error) {
      if (!valid()) return;
      const reviewFailure =
        error instanceof Error && error.message === VIDEO_FACTS_STALE.text
          ? VIDEO_FACTS_STALE
          : null;
      const styleFailure =
        reviewFailure ?? styleFailureNotice(error) ?? continuityFailureNotice(error);
      const reason =
        styleFailure?.text ??
        (error instanceof Error && error.message === "TASK_TIMEOUT"
          ? "等待结果超时，请先核对会员端结果。"
          : error instanceof Error && error.message === "VIDEO_CANCELLED"
            ? "已取消"
            : error instanceof Error &&
                (error.message.includes("首帧未完成") || /VOICE_.*REQUIRED/.test(error.message))
              ? error.message
              : "没有生成成功，可以重试。");
      const latest = filmRef.current ?? next;
      await applyGeneration(failRunningVideoTasks(latest, groups, reason));
      if (latest.shots.some((row) => row.takes.some(canResumeTake))) {
        pauseRef.current = true;
        setPaused(true);
      }
      if (styleFailure) emitNotice(styleFailure);
      else if (error instanceof Error && error.message === "TASK_TIMEOUT")
        emitNotice({ code: "TASK_TIMEOUT", text: NOTICE_TEXT.TASK_TIMEOUT, detail: reason });
      else setNotice(reason);
    }
  }

  function confirmBatchGeneration() {
    const confirmation = batchConfirmation.current;
    // Consume synchronously: a retained/double-clicked button cannot dispatch twice.
    setPendingBatch(null);
    const live = filmRef.current;
    if (!confirmation || !live || confirmation.projectId !== live.id) return;
    if (generationRuns.current.has(live.id)) {
      setNotice("这一批还在生成，请等完成后再试。");
      return;
    }
    const ids = [...new Set(confirmation.rows.map((row) => row.id))];
    const latest = ids.map((id) => live.shots.find((row) => row.id === id));
    if (!ids.length || latest.some((row) => !row)) {
      setNotice("所选镜头已经变化，请重新选择后生成。");
      return;
    }
    // The table owns a selection, not a copy of mutable media/version state.
    const rows = latest.map((row) => fitShotToLine(row!).shot);
    const seconds = new Map(rows.map((row) => [row.id, row.seconds]));
    if (rows.some((row) => live.shots.find((shot) => shot.id === row.id)?.seconds !== row.seconds))
      applyLive({
        ...live,
        shots: live.shots.map((row) =>
          seconds.has(row.id) ? { ...row, seconds: seconds.get(row.id)! } : row,
        ),
      });
    void submitGeneration(rows);
  }

  function queueBatch(rows: FilmShot[]) {
    const fitted = rows.map((item) => fitShotToLine(item));
    const warnings = fitted.map((item) => item.warning).filter(Boolean);
    setPendingBatch(fitted.map((item) => item.shot));
    setNotice(
      warnings.length > 0
        ? warnings.join("")
        : generationEstimate(fitted.length, versions, duration),
    );
  }

  function askBatch() {
    const rows = shownShots.length > 0 ? shownShots : (film?.shots ?? []);
    if (rows.length === 0) {
      setNotice("先在剧本里拆镜头。");
      return;
    }
    queueBatch(rows);
  }

  async function joinedCut(paths: string[]) {
    const current = filmRef.current;
    if (!current) return;
    const valid = requestSequences.current.begin(
      current.id,
      "assembly",
      () => filmRef.current?.id ?? "",
    );
    await assembleCurrentFilm(current, paths, () => filmRef.current, applyLive, setNotice, valid);
  }

  const recoveryBusyRef = useRef(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  async function recoverLegacyCleanCopy(shotId: string) {
    const base = filmRef.current,
      bridge = window.aijian;
    if (!base || !bridge?.recoverFilmCleanCopy || recoveryBusyRef.current) return;
    recoveryBusyRef.current = true;
    setRecoveryBusy(true);
    let lease: Awaited<ReturnType<typeof persistence.acquire>> | undefined;
    try {
      lease = await persistence.acquire(base.id);
      if (filmRef.current !== base) return;
      await lease.save(base, () => filmRef.current === base);
      const saved = await bridge.readFilmProject?.(base.id);
      if (filmRef.current !== base) return;
      const canonical = saved && upgradeFilm(saved);
      if (!canonical || canonical.id !== base.id) throw new Error("SAVE_FAILED");
      applyLive(canonical);
      const accepted = filmRef.current;
      if (!accepted || accepted.id !== base.id) return;
      const target = legacyCleanCopyTargets(accepted).find((target) => target.shotId === shotId);
      if (!target) return;
      const selectionHash = await cleanCopySelectionHash(target.videoPath, target.cleanVideoPath);
      if (filmRef.current !== accepted) return;
      setNotice({
        code: "CLEAN_COPY_PROGRESS",
        text: NOTICE_TEXT.CLEAN_COPY_PROGRESS,
        detail: "正在本机重建可核验的无字幕副本，不会生成新视频或调用付费服务。",
      });
      const result = await bridge.recoverFilmCleanCopy({
        projectId: accepted.id,
        shotId: target.shotId,
        takeId: target.takeId,
        selectionHash,
      });
      if (filmRef.current !== accepted) {
        if (filmRef.current?.id === base.id)
          setNotice({ code: "CLEAN_COPY_STALE", text: NOTICE_TEXT.CLEAN_COPY_STALE });
        return;
      }
      if (result.kind === "RECOVERED" || result.kind === "REUSED_ORIGINAL") {
        if (!result.project || typeof result.project !== "object" || Array.isArray(result.project))
          throw new Error("SAVE_FAILED");
        const recovered = upgradeFilm(result.project as Partial<FilmProject>);
        if (!recovered || recovered.id !== accepted.id) throw new Error("SAVE_FAILED");
        applyLive(recovered);
        const applied = filmRef.current;
        await lease.release();
        lease = undefined;
        if (filmRef.current !== applied) return;
        setNotice({
          code: result.kind === "REUSED_ORIGINAL" ? "CLEAN_COPY_NOT_REQUIRED" : "CLEAN_COPY_DONE",
          text:
            result.kind === "REUSED_ORIGINAL"
              ? NOTICE_TEXT.CLEAN_COPY_NOT_REQUIRED
              : NOTICE_TEXT.CLEAN_COPY_DONE,
          detail:
            result.kind === "REUSED_ORIGINAL"
              ? "合成记录确认原片没有烧录字幕，已保存为无字幕来源；没有生成新副本，旧副本仍保留。请重新检查成片。"
              : "已保存可核验的新副本；原片和旧副本均保留。请重新检查成片。",
        });
      } else if (result.kind === "UNCHANGED") {
        setNotice({
          code: "CLEAN_COPY_NOT_REQUIRED",
          text: NOTICE_TEXT.CLEAN_COPY_NOT_REQUIRED,
          detail:
            result.reason === "ALREADY_VERIFIED"
              ? "现有副本已有可核验记录，没有执行重建。"
              : "原片没有烧录字幕，没有生成新的副本。",
        });
      } else {
        const detail =
          result.code === "SOURCE_UNVERIFIED"
            ? "这份素材的归属暂无法核验，原片和已有副本会保留。"
            : result.code === "EVIDENCE_FAILED"
              ? "新副本尚未取得最终归属记录，没有替换已有副本。"
              : result.code === "PROJECT_CHANGED"
                ? "作品或版本已经变化，没有替换已有副本。"
                : result.code === "SAVE_FAILED"
                  ? "恢复结果未能保存，没有确认本次修改。"
                  : "本机重建没有完成，原片和已有副本会保留。";
        setNotice({
          code: result.code === "PROJECT_CHANGED" ? "CLEAN_COPY_STALE" : "CLEAN_COPY_FAILED",
          text:
            result.code === "PROJECT_CHANGED"
              ? NOTICE_TEXT.CLEAN_COPY_STALE
              : NOTICE_TEXT.CLEAN_COPY_FAILED,
          detail,
        });
      }
    } catch {
      if (filmRef.current?.id === base.id)
        setNotice({
          code: "SAVE_FAILED",
          text: NOTICE_TEXT.SAVE_FAILED,
          detail: "当前工程尚未确认保存，请先核对；原片和已有副本均保留。",
        });
    } finally {
      try {
        await lease?.release();
      } catch {
        if (filmRef.current?.id === base.id)
          setNotice({ code: "SAVE_FAILED", text: NOTICE_TEXT.SAVE_FAILED });
      }
      recoveryBusyRef.current = false;
      setRecoveryBusy(false);
    }
  }

  async function repairCleanCopies(shotIds: readonly string[] | null): Promise<void> {
    const live = filmRef.current;
    if (!live || workOwners.has(live.id, "clean-copy")) return;
    if (!window.aijian?.remakeStoryFilmCleanCopy) {
      setNotice("补做不带字幕的版本需要桌面版。");
      return;
    }
    const base = structuredClone(live);
    const ids = shotIds === null ? shotsNeedingCleanCopy(base) : [...shotIds];
    if (!ids.length) {
      setNotice("没有需要补做的镜头。");
      return;
    }
    const release = workOwners.begin(base.id, "clean-copy");
    cleanCopySaveVersions.current.set(base.id, live);
    setNotice("正在补做不带字幕的版本。");
    try {
      const billingProject = await ensureBillingProject();
      if (filmRef.current?.id !== base.id) return;
      if (!billingProject) {
        setNotice("这一次没有记到作品上，请稍后再试。");
        return;
      }
      const result = await remakeCleanCopies(base, ids, billingProject, {
        current: () => filmRef.current,
        apply: applyLive,
        persist: async (snapshot) => {
          // This result was committed before a possible work switch. Save that work's
          // snapshot through its queue even when it is no longer the visible work.
          const saved = await persistence.save(
            snapshot,
            () => cleanCopySaveVersions.current.get(snapshot.id) === snapshot,
          );
          if (!saved) throw new Error("CLEAN_COPY_SAVE_DEFERRED");
          const visible = filmRef.current;
          // The browser library remembers every write as active; a delayed save of
          // the old work must not change which work is reopened next time.
          if (visible && visible.id !== snapshot.id && !filmDiskReady())
            window.localStorage.setItem("aivora.film.activeId", visible.id);
        },
      });
      const latest = filmRef.current;
      if (latest?.id !== base.id) return;
      if (!shotsNeedingCleanCopy(filmRef.current).length) setCleanCopyBlockedAt(null);
      setNotice(result.notice);
    } catch {
      if (filmRef.current?.id === base.id)
        setNotice("补做中断，已经保存的版本会保留。请查看剩余镜头后重试。");
    } finally {
      cleanCopySaveVersions.current.delete(base.id);
      release();
    }
  }

  async function startExport() {
    if (!window.aijian?.prepareFilmExport) {
      setNotice({
        code: "EXPORT_QC_FAILED",
        text: NOTICE_TEXT.EXPORT_QC_FAILED,
        detail: "当前环境不能执行导出前检查，请使用支持检查的桌面版本。",
      });
      return;
    }
    await prepareCheckedExport();
  }

  const wsClass =
    stage === "edit" && (range || comparing)
      ? "ws fix"
      : bench && stage === "board"
        ? "ws gen"
        : `ws ${stage === "board" ? "board" : stage}`;

  useEffect(() => {
    if (stage !== "edit" || !film) return;
    const paths = film.shots
      .map(
        (item) =>
          item.takes.find((take) => take.id === item.selectedTakeId && take.videoPath)?.videoPath ||
          item.takes.find((take) => take.status === "done" && take.videoPath)?.videoPath ||
          "",
      )
      .filter((item) => item);
    if (paths.length < 2) return;
    const music = film.audioClips.find((clip) => clip.lane === "score" && clip.path);
    const key = [
      paths.join("|"),
      dialogueTracks(film).join("|"),
      music?.path ?? "",
      music?.gainDb ?? "",
    ].join("\n");
    if (assembledKey.current === key) return;
    assembledKey.current = key;
    void joinedCut(paths);
  }, [stage, film]);

  const liveSignature = useMemo(() => (film ? filmSignature(film) : ""), [film]);
  const dirty =
    film !== null &&
    committed.current !== null &&
    liveSignature !== filmSignature(committed.current);
  const canUndo =
    historyTick >= 0 &&
    (pageHistory.canUndo(editorSelection.current) ||
      (dirty && historyScope.current.page === stage));
  const canRedo = pageHistory.canRedo(editorSelection.current);
  const tracked =
    film?.jobs.filter(
      (job) =>
        job.status === "queued" ||
        job.status === "running" ||
        job.status === "done" ||
        job.status === "failed",
    ) ?? [];
  const finished = tracked.filter((job) => job.status === "done" || job.status === "failed").length;
  const progress = tracked.length === 0 ? 0 : Math.round((finished / tracked.length) * 100);

  // UI wiring (4A-U04): the live task list for 后台生成 and the task center.
  const feed = useTaskFeed();
  const feedNow = feedProgress(feed);
  // 4A-U07: the export dialog's 比例. Shown only by a desktop that can crop to the other
  // aspect (it brings cancelFilmExport with it); each export reads one fixed selection.
  const [exportAspects, setExportAspects] = useState<"work" | "other" | "both">("work");
  // 4B-U06: how the export is made. GPT's export reads these (next/INTEGRATION.md, 导出对话框).
  const [exportQuality, setExportQuality] = useState<"1080p" | "720p">("1080p");
  const [exportSubs, setExportSubs] = useState<"burn" | "srt" | "none">("burn");
  const [cleanCopyBlockedAt, setCleanCopyBlockedAt] = useState<{
    projectId: string;
    subtitles: string;
  } | null>(null);
  const [prefs, setPrefs] = useState(readPrefs);
  const [exportQc, setExportQc] = useState<{
    ready: FilmExportQcPrepared | null;
    key: string;
    input: FilmExportQcInput | null;
    error: string | null;
    checking: boolean;
  } | null>(null);
  const [exportQcBusy, setExportQcBusy] = useState(false);
  const [exportQcAspect, setExportQcAspect] = useState(0);
  const exportQcBusyRef = useRef(false);
  const [exportExecution, setExportExecution] = useState<FilmExportProgressEvent | null>(null);
  const exportExecutionRef = useRef<FilmExportProgressEvent | null>(null);
  const exportExecutionScope = useRef<ExportProgressScope | null>(null);

  const exportQcEpoch = useRef(0);
  const exportQcInput = film
    ? filmQcInput(film, exportAspects, {
        quality: exportQuality,
        subtitles: exportSubs,
        style: film.subtitleStyle ?? "white",
        aiMark: prefs.aiMark,
      })
    : null;
  const exportQcKey = filmQcKey(film, exportQcInput);
  const exportQcCurrent = useRef({ key: exportQcKey, input: exportQcInput });
  exportQcCurrent.current = { key: exportQcKey, input: exportQcInput };
  const exportQcStale = Boolean(exportQc && exportQc.key !== exportQcKey);
  function qcContextCurrent(key: string) {
    const context = exportQcCurrent.current;
    return context.key === key && filmQcKey(filmRef.current, context.input) === key;
  }

  function consumeExportEvent(value: unknown) {
    const scope = exportExecutionScope.current;
    if (!scope) return;
    const key = filmQcKey(filmRef.current, exportQcCurrent.current.input);
    const admitted = acceptExportProgress(value, exportExecutionRef.current, scope, key);
    if (admitted) {
      exportExecutionRef.current = admitted;
      setExportExecution(admitted);
    }
  }
  function beginExportExecution(input: FilmExportQcInput, key: string) {
    const operationId = crypto.randomUUID();
    exportExecutionScope.current = { operationId, projectId: input.projectId, key };
    exportExecutionRef.current = null;
    setExportExecution(null);
    return operationId;
  }
  async function requestExportStop(operationId: string): Promise<boolean> {
    const scope = exportExecutionScope.current,
      bridge = window.aijian;
    if (
      !scope ||
      scope.operationId !== operationId ||
      !qcContextCurrent(scope.key) ||
      !bridge?.cancelFilmExportOperation
    )
      throw new Error("停止状态待确认");
    const ack = await bridge.cancelFilmExportOperation(operationId);
    if (exportExecutionScope.current?.operationId !== operationId) return true;
    if (ack.snapshot) consumeExportEvent(ack.snapshot);
    if (ack.kind === "UNAVAILABLE") return false;
    if (ack.kind === "REQUESTED" || ack.kind === "STOPPED") return true;
    const previous = exportExecutionRef.current;
    if (previous) {
      const unknown = {
        ...previous,
        phase: "unknown" as const,
        cancelState: "unavailable" as const,
        progress: undefined,
      };
      exportExecutionRef.current = unknown;
      setExportExecution(unknown);
    }
    throw new Error("停止状态待确认");
  }
  useEffect(() => window.aijian?.onFilmExportProgress?.(consumeExportEvent), []);
  useEffect(() => {
    const scope = exportExecutionScope.current;
    if (scope && !qcContextCurrent(scope.key)) {
      exportExecutionScope.current = null;
      exportExecutionRef.current = null;
      setExportExecution(null);
      void window.aijian?.cancelFilmExportOperation?.(scope.operationId).catch(() => undefined);
    }
  }, [exportQcKey]);
  useEffect(
    () => () => {
      const scope = exportExecutionScope.current;
      if (scope)
        void window.aijian?.cancelFilmExportOperation?.(scope.operationId).catch(() => undefined);
      exportExecutionScope.current = null;
    },
    [],
  );
  useEffect(() => {
    if (exportQc?.ready && exportQcStale)
      void window.aijian?.discardFilmExport?.(exportQc.ready.qcReceipt).catch(() => undefined);
  }, [exportQc?.ready, exportQcStale]);
  useEffect(
    () => () => {
      exportQcEpoch.current += 1;
    },
    [],
  );
  useEffect(
    () => () => {
      if (exportQc?.ready)
        void window.aijian?.discardFilmExport?.(exportQc.ready.qcReceipt).catch(() => undefined);
    },
    [exportQc?.ready],
  );
  async function prepareCheckedExport() {
    const bridge = window.aijian,
      current = filmRef.current;
    if (
      !current ||
      !bridge?.prepareFilmExport ||
      exportQcBusyRef.current ||
      workOwners.has(current.id, "export")
    )
      return;
    let captured = exportQcCurrent.current;
    if (!captured.input) return;
    const epoch = ++exportQcEpoch.current;
    exportQcBusyRef.current = true;
    setExportQcBusy(true);
    setExportFile("");
    setExportQcAspect(0);
    const old = exportQc?.ready;
    if (old) void bridge.discardFilmExport?.(old.qcReceipt).catch(() => undefined);
    setExportQc({
      ready: null,
      key: captured.key,
      input: captured.input,
      error: null,
      checking: true,
    });
    setNotice({ code: "EXPORT_QC_RUNNING", text: NOTICE_TEXT.EXPORT_QC_RUNNING });
    const release = workOwners.begin(current.id, "export");
    try {
      let saved;
      try {
        saved = await saveFilm(current);
      } catch {
        throw new Error("not saved");
      }
      if (!saved) throw new Error("not saved");
      if (
        epoch !== exportQcEpoch.current ||
        !qcContextCurrent(captured.key) ||
        filmRef.current !== current
      )
        return;
      const canonical = bridge.readFilmProject ? await bridge.readFilmProject(current.id) : saved;
      if (!canonical || canonical.id !== current.id) throw new Error("not saved");
      if (
        epoch !== exportQcEpoch.current ||
        !qcContextCurrent(captured.key) ||
        filmRef.current !== current
      )
        return;
      const normalized = upgradeFilm(canonical);
      if (!normalized || normalized.id !== current.id) throw new Error("not saved");
      applyLive(normalized);
      const written = filmRef.current;
      if (!written || written.id !== current.id) throw new Error("not saved");
      captured = { key: filmQcKey(written, captured.input), input: captured.input };
      exportQcCurrent.current = captured;
      setExportQc({
        ready: null,
        key: captured.key,
        input: captured.input,
        error: null,
        checking: true,
      });
      const operationId = beginExportExecution(captured.input!, captured.key);
      const result = await bridge.prepareFilmExport(captured.input!, operationId);
      if (epoch !== exportQcEpoch.current || !qcContextCurrent(captured.key)) {
        if (result.kind === "READY")
          void bridge.discardFilmExport?.(result.qcReceipt).catch(() => undefined);
        return;
      }
      if (result.kind === "FAILED" && result.code === "OPERATION_STOPPED") {
        setExportQc(null);
        setNotice({
          code: "OPERATION_CANCELLED",
          text: NOTICE_TEXT.OPERATION_CANCELLED,
          detail: "处理已经停止，未发布新文件。",
        });
        return;
      }
      if (result.kind !== "READY") {
        const error = qcFailureText[result.code];
        setExportQc({
          ready: null,
          key: captured.key,
          input: captured.input,
          error,
          checking: false,
        });
        if (result.code === "CLEAN_COPY_REQUIRED")
          setCleanCopyBlockedAt({ projectId: current.id, subtitles: exportSubs });
        setNotice({ code: "EXPORT_QC_FAILED", text: NOTICE_TEXT.EXPORT_QC_FAILED, detail: error });
        return;
      }
      if (
        !result.outputs.length ||
        result.outputs.some((output) => !readQcReport(output.report).ok)
      )
        throw new Error("invalid QC report");
      setExportQc({
        ready: result,
        key: captured.key,
        input: captured.input,
        error: null,
        checking: false,
      });
      setNotice({ code: "EXPORT_QC_READY", text: NOTICE_TEXT.EXPORT_QC_READY });
    } catch (error) {
      const reason =
        error instanceof Error && error.message === "not saved"
          ? "工程还没保存，尚未检查，请先保存后重试。"
          : qcFailureText.CHECK_FAILED;
      if (epoch === exportQcEpoch.current && qcContextCurrent(captured.key)) {
        setExportQc({
          ready: null,
          key: captured.key,
          input: captured.input,
          error: reason,
          checking: false,
        });
        setNotice({ code: "EXPORT_QC_FAILED", text: NOTICE_TEXT.EXPORT_QC_FAILED });
      }
    } finally {
      exportQcBusyRef.current = false;
      setExportQcBusy(false);
      release();
      setExportQc((previous) => (previous?.checking ? { ...previous, checking: false } : previous));
    }
  }
  async function publishCheckedExport() {
    const check = exportQc,
      bridge = window.aijian;
    if (!check?.ready || !check.input || !bridge?.publishFilmExport || exportQcBusyRef.current)
      return;
    if (!qcContextCurrent(check.key)) {
      setNotice({ code: "EXPORT_QC_STALE", text: NOTICE_TEXT.EXPORT_QC_STALE });
      return;
    }
    if (
      check.ready.outputs.some((output) => {
        const read = readQcReport(output.report);
        return !read.ok || read.report.issues.some((issue) => issue.severity === "block");
      })
    ) {
      setNotice({ code: "EXPORT_QC_BLOCKED", text: NOTICE_TEXT.EXPORT_QC_BLOCKED });
      return;
    }
    exportQcBusyRef.current = true;
    setExportQcBusy(true);
    try {
      // The reviewed snapshot is already persisted. Any edit invalidates its key;
      // rewriting it here could rematerialize data URLs into different files.
      if (!qcContextCurrent(check.key)) return;
      const operationId = beginExportExecution(check.input, check.key);
      const result = await bridge.publishFilmExport(
        {
          ...check.input,
          qcReceipt: check.ready.qcReceipt,
        },
        operationId,
      );
      if (!qcContextCurrent(check.key)) return;
      if (result.kind === "CANCELLED") return;
      if (result.kind === "FAILED") {
        if (result.code === "OPERATION_STOPPED") {
          setExportQc(null);
          setNotice({
            code: "OPERATION_CANCELLED",
            text: NOTICE_TEXT.OPERATION_CANCELLED,
            detail: "处理已经停止，未发布新文件。",
          });
          return;
        }
        setExportQc({ ...check, error: qcFailureText[result.code] });
        setNotice({
          code: "EXPORT_QC_FAILED",
          text: NOTICE_TEXT.EXPORT_QC_FAILED,
          detail: qcFailureText[result.code],
        });
        return;
      }
      const path = result.outputs[0]?.path;
      let recorded = true;
      setExportQc(null);
      if (path && filmRef.current) {
        const updated = { ...filmRef.current, exportPath: path };
        applyLive(updated);
        // Internal output bookkeeping is not a new execution or a new receipt input.
        const execution = exportExecutionScope.current;
        if (execution?.operationId === operationId)
          execution.key = filmQcKey(filmRef.current, exportQcCurrent.current.input);
        setExportFile(path);
        try {
          recorded = Boolean(await saveFilm(filmRef.current!));
        } catch {
          recorded = false;
        }
      }
      if (filmRef.current?.id !== check.input.projectId) return;
      setNotice({
        code: result.kind === "PARTIAL" ? "EXPORT_FAILED" : "EXPORT_DONE",
        text: result.kind === "PARTIAL" ? NOTICE_TEXT.EXPORT_FAILED : NOTICE_TEXT.EXPORT_DONE,
        detail:
          result.kind === "PARTIAL"
            ? "已有文件保留，其余没有发布，请核对后重新检查。"
            : !recorded
              ? "文件已发布，工程中的导出记录尚未保存。"
              : undefined,
      });
    } catch {
      setNotice({ code: "EXPORT_QC_FAILED", text: NOTICE_TEXT.EXPORT_QC_FAILED });
    } finally {
      exportQcBusyRef.current = false;
      setExportQcBusy(false);
    }
  }
  function cancelCheckedExport() {
    if (exportQcBusyRef.current) return;
    exportExecutionScope.current = null;
    exportExecutionRef.current = null;
    setExportExecution(null);
    exportQcEpoch.current += 1;
    if (exportQc?.ready)
      void window.aijian?.discardFilmExport?.(exportQc.ready.qcReceipt).catch(() => undefined);
    setExportQc(null);
    setNotice({
      code: "OPERATION_CANCELLED",
      text: NOTICE_TEXT.OPERATION_CANCELLED,
      detail: "已取消审核，未发布成片。",
    });
  }
  function fixExportIssue(issue: QcIssue) {
    if (exportQcStale || exportQcBusyRef.current) return;
    const span = exportQc?.ready?.shots.find(
      (shot) => issue.time >= shot.start && issue.time < shot.end,
    );
    const target = span && filmRef.current?.shots.find((shot) => shot.id === span.id);
    if (target) {
      setScene(target.sceneId);
      setShot(
        filmRef
          .current!.shots.filter((shot) => shot.sceneId === target.sceneId)
          .findIndex((shot) => shot.id === target.id),
      );
    }
    setExportOpen(false);
    setStage("edit");
  }
  const exportSettingsRef = useRef({ projectId: film?.id ?? "", subtitles: exportSubs });
  exportSettingsRef.current = { projectId: film?.id ?? "", subtitles: exportSubs };
  const cleanCopyBlocked =
    cleanCopyBlockedAt?.projectId === film?.id && cleanCopyBlockedAt?.subtitles === exportSubs;
  useEffect(() => {
    setCleanCopyBlockedAt(null);
  }, [film?.id, exportSubs]);
  const canCropAspect =
    typeof window !== "undefined" && "prepareFilmExport" in (window.aijian ?? {});
  // 4A-U04: the task drawer closes on Esc or a press outside it and its status-bar button.
  useDismiss(menu === "queue", () => setMenu(null), '[data-menu="queue"]');
  // UI wiring (3J-U04): one status message at a time, worded by its code, gone after 5 seconds;
  // past messages are listed in the task center.
  const status = useStatusNotice(notice);
  // 3J-U18: the 作品 and 账号 menus close on Esc or a press outside them.
  useDismiss(menu === "project", () => setMenu(null), '[data-menu="project"]');
  useDismiss(menu === "account", () => setMenu(null), '[data-menu="account"]');
  // UI wiring (3J-U13): the home page. Opening a saved work is the same as from the 作品 menu;
  // 一键成片 from home makes the work first and starts GPT's oneClickFilm once it is shown.
  const openSaved = (id: string) => {
    void readSaved(id).then((saved) => {
      if (!saved) {
        setNotice("没有打开这部作品。");
        return;
      }
      const settled = settleOpenedFilm(saved);
      applyLive(settled.film);
      setScene(settled.film.scenes[0]?.id ?? "scene-1");
      setShot(0);
      setPlaying(false);
      setMenu(null);
      setNotice(
        settled.interrupted
          ? { code: "WORK_INTERRUPTED", text: NOTICE_TEXT.WORK_INTERRUPTED }
          : `已打开${saved.seriesTitle || saved.title}。`,
      );
    });
  };
  const startWork = (aspect: Aspect, idea = "") => {
    const next = blankFilm();
    next.aspectRatio = aspect;
    if (idea)
      next.scenes = next.scenes.map((item, index) =>
        index === 0 ? { ...item, text: idea } : item,
      );
    setFilm(next);
    setScene(next.scenes[0]?.id ?? "scene-1");
    setStage("script");
    return next;
  };
  const oneClickFromHome = useRef("");
  // 4A-U01: a story template is chosen with the new work; it goes in once the work is shown.
  const templateFromHome = useRef({ id: "", name: "" });
  useEffect(() => {
    if (!film) return;
    if (templateFromHome.current.id === film.id) {
      const name = templateFromHome.current.name;
      templateFromHome.current = { id: "", name: "" };
      applyTemplate(name);
    }
    if (oneClickFromHome.current !== film.id) return;
    oneClickFromHome.current = "";
    void oneClickFilm();
  }, [film]);
  const pipelineProps = pipelineWorkspace.props();
  const showPipeline = open && pipelineProps.steps.length > 0;
  useEffect(() => {
    if (!open) void listFilms().then(setSeriesList);
  }, [open]);
  // UI wiring (3J-U02): each page opens with its own helper in the assistant. Only a page
  // change picks it; chooseRole is a new function on every render.
  useEffect(() => {
    const helper = PAGE_ROLE[stage];
    if (helper) chooseRole(helper);
  }, [stage]);
  // 4C-U08: something is being made, so the status bar shows it in the middle.
  const busy = asking || feedNow.active > 0 || portraitBusy || finished < tracked.length;
  // 4A-U09: one primary button per screen. 导出成片 leads on 剪辑 and once every shot has its
  // video; then each page's own primary button steps back (quiet).
  const exportView = exportLead(
    open ? film : null,
    stage,
    stage === "edit" && (range || comparing),
  );
  // 4A-U10: the membership state, on the avatar's dot and at the top of its menu.
  const waiting = signingIn || account.state === "AWAITING_BROWSER";
  const accountState = membershipDenied
    ? "denied"
    : connected
      ? "ok"
      : waiting || account.state === "REAUTH_REQUIRED"
        ? "wait"
        : "off";
  const accountLine = membershipDenied
    ? "这个会员用不了生成"
    : connected
      ? "Grok 会员 · 已连接"
      : waiting
        ? "正在等浏览器"
        : account.state === "REAUTH_REQUIRED"
          ? "需要重新登录"
          : "未登录";
  // 4B-U04: the cover step inside the export dialog.
  const [coverOpen, setCoverOpen] = useState(false);
  // 4C-U02: 作品设置, with the work's history.
  const [workSettings, setWorkSettings] = useState(false);
  const persistentHistoryBusyRef = useRef(false);
  const [persistentHistoryBusy, setPersistentHistoryBusy] = useState(false);
  const [persistentHistory, setPersistentHistory] = useState<FilmHistoryEntry[] | null>(null);
  const [persistentHistoryLoading, setPersistentHistoryLoading] = useState(false);
  const [persistentHistoryError, setPersistentHistoryError] = useState<string | null>(null);
  const [persistentHistoryUnreadable, setPersistentHistoryUnreadable] = useState(0);
  const [persistentHistoryRestoring, setPersistentHistoryRestoring] = useState("");
  const [persistentHistoryRefresh, refreshPersistentHistory] = useState(0);
  const historyHost = {
    current: () => filmRef.current,
    apply: applyLive,
    acquire: persistence.acquire,
  };
  useEffect(() => {
    let active = true;
    const bridge = window.aijian,
      id = film?.id;
    setPersistentHistoryError(null);
    setPersistentHistoryLoading(false);
    setPersistentHistoryUnreadable(0);
    setPersistentHistory(null);
    if (
      !workSettings ||
      !id ||
      !bridge?.listFilmHistory ||
      !bridge.captureFilmHistory ||
      !bridge.restoreFilmHistory
    )
      return;
    setPersistentHistoryLoading(true);
    void bridge
      .listFilmHistory(id)
      .then((result) => {
        if (!active || filmRef.current?.id !== id) return;
        if (result.kind !== "LIST") throw new Error("HISTORY_READ_FAILED");
        setPersistentHistory(result.entries);
        setPersistentHistoryUnreadable(result.unreadable);
        if (result.unreadable && !result.entries.length)
          setPersistentHistoryError("已找到历史文件，但暂时无法核验，原文件已保留。");
      })
      .catch(() => {
        if (active && filmRef.current?.id === id) {
          setPersistentHistoryError(NOTICE_TEXT.HISTORY_READ_FAILED);
          setNotice({ code: "HISTORY_READ_FAILED", text: NOTICE_TEXT.HISTORY_READ_FAILED });
        }
      })
      .finally(() => {
        if (active) setPersistentHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workSettings, film?.id, persistentHistoryRefresh]);
  function historyInputStale(error: unknown) {
    return error instanceof Error && error.message === "HISTORY_STALE";
  }
  async function captureBeforePipeline(lease: Awaited<ReturnType<typeof persistence.acquire>>) {
    try {
      const base = filmRef.current;
      if (!base) throw new Error("HISTORY_STALE");
      const input = await prepareHistoryInput(base, historyHost, lease);
      const result = await window.aijian!.captureFilmHistory!({
        projectId: base.id,
        expectedHash: input.expectedHash,
        reason: "before-pipeline",
      });
      if (result.kind !== "CAPTURED") throw new Error("HISTORY_BACKUP_FAILED");
      refreshPersistentHistory((value) => value + 1);
      if (!input.current()) throw new Error("HISTORY_STALE");
    } catch (error) {
      const code = historyInputStale(error) ? "PIPELINE_REQUEST_STALE" : "HISTORY_BACKUP_FAILED";
      throw Object.assign(new Error(code), { code });
    }
  }
  async function captureBeforeGeneration(
    base: FilmProject,
    valid: () => boolean,
    pipeline?: PipelineGenerationHost,
  ) {
    const bridge = window.aijian;
    if (!bridge?.captureFilmHistory || !bridge.readFilmProject)
      throw new Error("HISTORY_UNSUPPORTED");
    if (pipeline) {
      await pipeline.apply(base);
      const accepted = filmRef.current;
      if (!accepted || !valid()) throw new Error("HISTORY_STALE");
      const stored = await bridge.readFilmProject(base.id);
      if (!stored || stored.id !== base.id || filmRef.current !== accepted || !valid())
        throw new Error("HISTORY_STALE");
      const expectedHash = await historyRecordHash(stored);
      const result = await bridge.captureFilmHistory({
        projectId: base.id,
        expectedHash,
        reason: "before-batch-generation",
      });
      if (result.kind !== "CAPTURED") throw new Error("HISTORY_BACKUP_FAILED");
      refreshPersistentHistory((value) => value + 1);
      if (filmRef.current !== accepted || !valid()) throw new Error("HISTORY_STALE");
      return accepted;
    }
    const input = await prepareHistoryInput(base, historyHost);
    try {
      const result = await bridge.captureFilmHistory({
        projectId: base.id,
        expectedHash: input.expectedHash,
        reason: "before-batch-generation",
      });
      if (result.kind !== "CAPTURED") throw new Error("HISTORY_BACKUP_FAILED");
      if (!input.current() || !valid()) throw new Error("HISTORY_STALE");
    } finally {
      await input.release();
    }
    if (!input.current() || !valid()) throw new Error("HISTORY_STALE");
    refreshPersistentHistory((value) => value + 1);
    return input.film;
  }
  function openSecondsRange() {
    if (rangeWorking.current) return;
    const target = shownShots[shot];
    const take =
      target?.takes.find((row) => row.id === target.selectedTakeId) ??
      target?.takes.find((row) => row.status === "done" && row.videoPath);
    setRangeReady(null);
    rangeReadyRef.current = null;
    setRangeMessage("");
    if (!target || !take?.videoPath) {
      // No source exists to splice. This remains the existing full-shot creation panel,
      // with its explicit ordinary confirmation, never a claimed range replacement.
      setRange(false);
      setComparing(false);
      setBench(true);
      setStage("board");
      return;
    }
    if (span && span.from !== span.to) {
      setNotice({
        code: "GENERATION_SELECTION_STALE",
        text: NOTICE_TEXT.GENERATION_SELECTION_STALE,
        detail: "秒级局部重做每次只处理一个镜头；请先选择其中一镜。",
      });
      return;
    }
    if (!rangeSeconds || rangeSeconds.shotId !== target.id || rangeSeconds.takeId !== take.id)
      setRangeSeconds({
        shotId: target.id,
        takeId: take.id,
        start: 0,
        end: Math.min(2, take.durationSeconds ?? target.seconds),
      });
    setRangeDialog(true);
  }
  async function inspectSecondsRange() {
    const bridge = window.aijian,
      selected = rangeSeconds;
    if (rangeWorking.current || !selected) return;
    if (
      !bridge?.prepareFilmRange ||
      !bridge.generateFilmRange ||
      !bridge.finishFilmRange ||
      !bridge.discardFilmRange
    ) {
      setRangeMessage("秒级局部重做需要支持此功能的桌面版；本次没有生成。");
      return;
    }
    rangeWorking.current = true;
    rangeCancelled.current = false;
    rangeExecuting.current = false;
    setRangeBusy(true);
    setRangeMessage("");
    let input: Awaited<ReturnType<typeof prepareHistoryInput>> | undefined;
    try {
      const id = filmRef.current?.id;
      await ensureBillingProject();
      const base = filmRef.current;
      if (!base || base.id !== id) return;
      input = await prepareHistoryInput(base, historyHost);
      rangeAccepted.current = input.film;
      const result = await bridge.prepareFilmRange({
        projectId: base.id,
        shotId: selected.shotId,
        takeId: selected.takeId,
        start: selected.start,
        end: selected.end,
        expectedHash: input.expectedHash,
      });
      if (rangeCancelled.current) {
        if (result.kind === "READY")
          void bridge.discardFilmRange(base.id, result.planId).catch(() => undefined);
        setRangeDialog(false);
        return;
      }
      if (!input.current()) {
        if (result.kind === "READY")
          void bridge.discardFilmRange(base.id, result.planId).catch(() => undefined);
        setRangeMessage("作品或版本已变化，请重新检查范围；本次没有生成。");
        return;
      }
      if (result.kind !== "READY") {
        setRangeMessage(
          result.code === "CLEAN_SOURCE_REQUIRED"
            ? "这份原片还没有可核验的无字幕来源。可先尝试本机恢复无字幕副本；仍无法核验时暂不支持本次局部重做。本次没有派发，不需要重新付费生成。"
            : result.code === "INVALID_RANGE"
              ? "请选择单镜内至少1秒、最多10秒且保留原片前段或后段的范围；不把整镜重做称为局部重做。"
              : result.code === "SOURCE_UNVERIFIED"
                ? "这份原片的归属暂无法核验，本次没有生成。"
                : result.code === "PROJECT_CHANGED"
                  ? "作品或版本已变化，请重新检查范围；本次没有生成。"
                  : "原片规格或本机媒体工具暂不支持此范围，本次没有生成。",
        );
        return;
      }
      const ready = {
        project: input.film,
        shotId: selected.shotId,
        takeId: selected.takeId,
        planId: result.planId,
        plan: result.plan,
      };
      rangeReadyRef.current = ready;
      setRangeReady(ready);
    } catch {
      setRangeMessage("范围尚未检查，本次没有生成。请先保存作品后重试。");
    } finally {
      try {
        if (input) await input.release();
      } catch {
        const pending = rangeReadyRef.current;
        if (pending)
          void bridge.discardFilmRange(pending.project.id, pending.planId).catch(() => undefined);
        rangeReadyRef.current = null;
        setRangeReady(null);
        setRangeMessage("保存状态尚未确认，本次没有派发生成；请先核对保存状态。");
      } finally {
        rangeWorking.current = false;
        rangeAccepted.current = null;
        setRangeBusy(false);
      }
    }
  }

  async function confirmSecondsRange() {
    const ready = rangeReadyRef.current,
      bridge = window.aijian;
    if (
      !ready ||
      rangeWorking.current ||
      !bridge?.generateFilmRange ||
      !bridge.prepareFilmRange ||
      !bridge.finishFilmRange ||
      !bridge.discardFilmRange
    )
      return;
    if (
      filmRef.current !== ready.project ||
      !actions.regenerate.enabled ||
      generationRuns.current.has(ready.project.id)
    ) {
      setRangeMessage("作品、选版或会员能力已变化，请重新检查；本次没有生成。");
      return;
    }
    rangeWorking.current = true;
    rangeCancelled.current = false;
    rangeExecuting.current = true;
    rangeAccepted.current = ready.project;
    generationRuns.current.add(ready.project.id);
    setRangeBusy(true);
    setRangeReady(null);
    setRangeMessage("正在生成所选画面段；生成结果会先保留，再检查是否能够接回原片。");
    try {
      const target = ready.project.shots.find((row) => row.id === ready.shotId)!;
      const body = rangeVideoBody(
        ready.project,
        target,
        ready.plan.generationSeconds,
        ready.project.draft,
      );
      const prompt = body?.shots?.[0]?.prompt;
      if (!prompt) throw new Error("RANGE_PROMPT_REQUIRED");
      const result = await executeRangeRedo(ready, prompt, {
        ...historyHost,
        gateway: {
          prepareFilmRange: bridge.prepareFilmRange,
          generateFilmRange: bridge.generateFilmRange,
          finishFilmRange: bridge.finishFilmRange,
          discardFilmRange: bridge.discardFilmRange,
        },
        cancelled: () => rangeCancelled.current,
        apply: (next) => {
          applyLive(next);
          rangeAccepted.current = filmRef.current;
        },
        accept: (next) => {
          applyLive(next);
          rangeAccepted.current = filmRef.current;
        },
      });
      if (filmRef.current?.id === ready.project.id)
        setRangeMessage(
          result === "applied"
            ? "局部画面已接成一个新版本，原片和生成段均保留。原完整音轨未改，未验证口型。"
            : result === "backup-failed"
              ? "历史快照没有保存，本次没有派发生成。"
              : result === "stale"
                ? "作品或选版已变化，本次没有派发生成。"
                : result === "not-started"
                  ? "本机准备未完成，本次没有派发生成；请核对原片、媒体工具与账号。"
                  : result === "unconfirmed"
                    ? "生成结果尚未确认，请核对会员端与版本；未自动重试。"
                    : "生成段已保留，尚未接回原片；请查看版本，不要重复派发。",
        );
    } catch {
      if (filmRef.current?.id === ready.project.id)
        setRangeMessage("本次结果尚未确认或尚未落盘，请核对版本与保存状态；未自动重试。");
    } finally {
      rangeReadyRef.current = null;
      rangeWorking.current = false;
      rangeAccepted.current = null;
      generationRuns.current.delete(ready.project.id);
      setRangeBusy(false);
    }
  }
  function cancelSecondsRange() {
    rangeCancelled.current = true;
    const ready = rangeReadyRef.current;
    if (ready)
      void window.aijian?.discardFilmRange?.(ready.project.id, ready.planId).catch(() => undefined);
    if (rangeWorking.current && !rangeExecuting.current) {
      setRangeDialog(false);
      return;
    }
    if (rangeWorking.current) {
      setRangeMessage("已取消接回请求，正在等本次生成结果保留；不会自动重试，尚未确认进程停止。");
      return;
    }
    rangeReadyRef.current = null;
    setRangeReady(null);
    setRangeDialog(false);
  }
  async function keepCurrentHistory() {
    const base = filmRef.current;
    if (!base || persistentHistoryBusyRef.current) return;
    persistentHistoryBusyRef.current = true;
    setPersistentHistoryBusy(true);
    let input: Awaited<ReturnType<typeof prepareHistoryInput>> | undefined;
    try {
      input = await prepareHistoryInput(base, historyHost);
      const result = await window.aijian!.captureFilmHistory!({
        projectId: base.id,
        expectedHash: input.expectedHash,
        reason: "manual",
      });
      if (!input.current()) return;
      if (result.kind !== "CAPTURED") throw new Error("HISTORY_BACKUP_FAILED");
      setNotice({ code: "HISTORY_SAVED", text: NOTICE_TEXT.HISTORY_SAVED });
      refreshPersistentHistory((value) => value + 1);
    } catch {
      if (filmRef.current?.id === base.id)
        setNotice({ code: "HISTORY_BACKUP_FAILED", text: NOTICE_TEXT.HISTORY_BACKUP_FAILED });
    } finally {
      try {
        await input?.release();
      } catch {
        if (filmRef.current?.id === base.id)
          setNotice({ code: "SAVE_FAILED", text: NOTICE_TEXT.SAVE_FAILED });
      }
      persistentHistoryBusyRef.current = false;
      setPersistentHistoryBusy(false);
    }
  }
  async function restoreKeptHistory(historyId: string) {
    const base = filmRef.current;
    if (!base || persistentHistoryBusyRef.current) return;
    if (
      generationRuns.current.has(base.id) ||
      Object.keys(workOwners.progress("")).length ||
      asking
    ) {
      setNotice({
        code: "HISTORY_RESTORE_FAILED",
        text: NOTICE_TEXT.HISTORY_RESTORE_FAILED,
        detail: "当前生成或编辑任务还在进行，请等完成后再恢复。",
      });
      return;
    }
    persistentHistoryBusyRef.current = true;
    setPersistentHistoryBusy(true);
    setPersistentHistoryRestoring(historyId);
    let input: Awaited<ReturnType<typeof prepareHistoryInput>> | undefined;
    try {
      input = await prepareHistoryInput(base, historyHost);
      const result = await window.aijian!.restoreFilmHistory!({
        projectId: base.id,
        historyId,
        expectedHash: input.expectedHash,
      });
      if (!input.current()) {
        if (filmRef.current?.id === base.id)
          setNotice({ code: "HISTORY_STALE", text: NOTICE_TEXT.HISTORY_STALE });
        return;
      }
      if (result.kind === "RESTORED" || result.kind === "PARTIAL") {
        if (
          result.project &&
          typeof result.project === "object" &&
          !Array.isArray(result.project)
        ) {
          const restored = upgradeFilm(result.project as Partial<FilmProject>);
          if (!restored || restored.id !== base.id) throw new Error("HISTORY_STALE");
          applyLive(restored);
          resetHistory(filmRef.current!);
          setScene(restored.scenes[0]?.id ?? scene);
          setShot(0);
          setPlaying(false);
          setPending(null);
          setPendingRole(null);
        }
        if (result.kind === "RESTORED")
          setNotice({ code: "HISTORY_RESTORED", text: NOTICE_TEXT.HISTORY_RESTORED });
        else
          setNotice({
            code: "HISTORY_RESTORE_FAILED",
            text: NOTICE_TEXT.HISTORY_RESTORE_FAILED,
            detail: "内容可能已写入，但保存尚未完整确认。恢复前版本已保留，请先核对再操作。",
          });
        refreshPersistentHistory((value) => value + 1);
      } else
        setNotice({
          code: result.code === "PROJECT_CHANGED" ? "HISTORY_STALE" : "HISTORY_RESTORE_FAILED",
          text:
            result.code === "PROJECT_CHANGED"
              ? NOTICE_TEXT.HISTORY_STALE
              : NOTICE_TEXT.HISTORY_RESTORE_FAILED,
          detail: result.unchanged
            ? "当前作品没有改动，历史文件仍保留。"
            : "当前保存状态尚未确认，请先核对。",
        });
    } catch {
      if (filmRef.current?.id === base.id)
        setNotice({ code: "HISTORY_RESTORE_FAILED", text: NOTICE_TEXT.HISTORY_RESTORE_FAILED });
    } finally {
      try {
        await input?.release();
      } catch {
        if (filmRef.current?.id === base.id)
          setNotice({ code: "SAVE_FAILED", text: NOTICE_TEXT.SAVE_FAILED });
      }
      persistentHistoryBusyRef.current = false;
      setPersistentHistoryBusy(false);
      setPersistentHistoryRestoring("");
    }
  }
  // 4C-U03: 设置, the person's own defaults on this computer.
  const [appSettings, setAppSettings] = useState(false);
  const changePrefs = (next: Partial<AppPrefs>) => {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    writePrefs(merged);
  };
  useEffect(() => {
    if (!appSettings) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAppSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [appSettings]);
  useEffect(() => {
    if (!workSettings) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkSettings(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workSettings]);
  useEffect(() => {
    if (!exportOpen) setCoverOpen(false);
  }, [exportOpen]);
  // 4A-U11: 分镜, 单镜 and 剪辑 show the same assistant, with the same card for this scene.
  const sceneCard =
    roleCards[role]?.shots && roleCards[role]?.shots.every((item) => item.sceneId !== scene)
      ? null
      : (roleCards[role] ?? null);
  const redoFromReview = () => {
    setStage("edit");
    setRange(true);
    setNotice("已选中这一镜。在时间线上点「重新生成」。");
  };
  const keepReview = () => {
    markApplied("qc");
    setNotice("已记下审片意见。版本仍由你选。");
  };
  const promptCard = roleCards.prompter;
  const videoFactsSuggestion = (
    <>
      <button className="btn" disabled={videoReviewBusy} onClick={organizeVideoFacts}>
        整理视频说明
      </button>
      {videoReview &&
      videoReview.request.selection.projectId === film?.id &&
      videoReview.request.selection.shotId === shownShots[shot]?.id ? (
        <SevenPartVideoReview
          facts={{
            sections: videoReview.facts.sections,
            issues: videoReview.facts.issues,
            draft: { text: videoReview.facts.draft.text },
          }}
          changed={videoReview.changed}
          before={videoReview.before}
          modelText={videoReview.modelText}
          busy={videoReviewBusy}
          stale={!videoReviewMatches(videoReview)}
          result={
            videoReview.result &&
            videoReview.result !== "rejected" &&
            shownShots[shot]?.reviewedVideoPrompt?.factsKey !== videoReview.facts.draft.factsKey
              ? "undone"
              : videoReview.result
          }
          onConfirm={() => void confirmVideoFacts()}
          onDismiss={() => {
            if (!videoReviewWorking.current) setVideoReview(null);
          }}
        />
      ) : null}
    </>
  );
  const promptSuggestion =
    promptCard?.fieldRows !== undefined &&
    promptCard.editorDiff?.selection.projectId === film?.id &&
    promptCard.editorDiff?.selection.shotId === shownShots[shot]?.id &&
    promptCard.editorDiff?.selection.sceneId === scene ? (
      <SuggestionCard
        unit="shot"
        current={[]}
        proposed={[]}
        fieldRows={promptCard.fieldRows}
        applied={promptCard.applied}
        busy={asking || promptApplying}
        onApply={() => void applyPendingPrompt()}
        onAnother={() => void planPrompter()}
        onReject={rejectPendingPrompt}
      />
    ) : null;
  const shotPromptSuggestions = (
    <>
      {videoFactsSuggestion}
      {promptSuggestion}
    </>
  );
  const shotAssistant = (
    <div className="shot-assistant-scroll">
      <Assistant
        role={role}
        onRole={chooseRole}
        pending={pendingRole === role ? pending : null}
        onApply={applyPending}
        onReject={rejectPendingSuggestion}
        shots={shownShots}
        chat={chat}
        onChat={setChat}
        onSend={sendChat}
        onQuick={(label) => {
          if (label.includes("动作")) {
            chooseRole("action");
            void planAction();
          } else if (label.includes("表演")) {
            chooseRole("performance");
            void planPerformance();
          } else if (label.includes("美术")) {
            chooseRole("art");
            void planArt();
          } else sendChat();
        }}
        turns={turns}
        structured={structured}
        card={sceneCard}
        onRetry={pendingRetry ? () => void retryPending() : undefined}
        onRedoRange={redoFromReview}
        onDismiss={keepReview}
        scope={film ? scopeOf(film, scene, shownShots[shot] ?? null) : ""}
        mentions={film ? mentionsOf(film, shownShots) : []}
      />
      {shotPromptSuggestions}
    </div>
  );
  // 4A-U10: M mutes and unmutes the previews; the switch moved from the top bar to the player.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typingInField(event) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "m" || event.key === "M") setSoundOn((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // 5-3-04: double-click the work's name in the top bar to rename it in place; Enter or leaving
  // the field keeps it, Esc lets it go. The same rename as 作品设置.
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const dropTitle = useRef(false);
  const keepTitle = (value: string) => {
    setTitleEdit(null);
    const name = value.trim();
    if (!film || !name || name === (film.seriesTitle || film.title)) return;
    void renameFilm(film.seriesId, name);
    applyLive({ ...film, title: name, seriesTitle: name });
    setNotice("已改作品名。");
  };

  return (
    <div
      className="pro-root"
      style={{ overflow: "hidden", maxWidth: "100vw", width: "100%" }}
      data-stage={stage}
      data-aspect={film ? (film.aspectRatio === "16:9" ? "16:9" : "9:16") : undefined}
      data-sample={open ? "open" : "empty"}
      data-generate={actions.regenerate.enabled ? "on" : "off"}
    >
      <div className={showPipeline ? "app with-pipeline" : "app"}>
        <header className="topbar">
          <div className="tb-left">
            <div className="logo">
              <div className="logo-mark">A</div>
              AIVORA
            </div>
            <span className="vsep" />
            {titleEdit !== null && film ? (
              <input
                className="input proj-edit"
                aria-label="改作品名"
                value={titleEdit}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setTitleEdit(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  // Enter leaves the field, which keeps the name once; Esc leaves it unchanged.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    dropTitle.current = true;
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => {
                  if (dropTitle.current) {
                    dropTitle.current = false;
                    setTitleEdit(null);
                    return;
                  }
                  keepTitle(event.currentTarget.value);
                }}
              />
            ) : null}
            <button
              className="proj"
              data-menu="project"
              aria-label="作品"
              title={film ? "点开作品菜单；双击作品名可以改名" : undefined}
              hidden={titleEdit !== null && Boolean(film)}
              onDoubleClick={() => {
                if (!film) return;
                setMenu(null);
                dropTitle.current = false;
                setTitleEdit(film.seriesTitle || film.title);
              }}
              onClick={() => {
                const opening = menu !== "project";
                setMenu(opening ? "project" : null);
                if (opening && film) {
                  setRename(film.seriesTitle || film.title);
                  void listFilms().then(setSeriesList);
                  void listEpisodes(film.seriesId).then(setEpisodes);
                }
              }}
            >
              {title}
              {film ? (
                <span className="ep">/ {film.episodeTitle || `第 ${film.episodeNo} 集`}</span>
              ) : null}
              <Ic name="chev" size={14} />
            </button>
            {/* 5-3-01: before a work is open the bar holds only the logo, 作品 and the avatar. */}
            {open ? (
              <>
                <button
                  className="icon-btn"
                  aria-label="撤销"
                  title="撤销 (Ctrl+Z)"
                  disabled={!canUndo}
                  onClick={undoEdit}
                >
                  <Ic name="undo" />
                </button>
                <button
                  className="icon-btn"
                  aria-label="重做"
                  title="重做 (Ctrl+Shift+Z)"
                  disabled={!canRedo}
                  onClick={redoEdit}
                >
                  <Ic name="redo" />
                </button>
              </>
            ) : null}
            {menu === "project" && (
              <div className="menu" role="menu" aria-label="作品菜单" data-menu="project">
                {/* 4C-U06: three groups: the works, this one, and deleting it last. */}
                <p className="menu-group">作品</p>
                <button
                  onClick={() => {
                    const next = blankFilm();
                    applyLive(next);
                    setPending(null);
                    setPendingRole(null);
                    setShot(0);
                    setRange(false);
                    setComparing(false);
                    setBench(false);
                    setStage("script");
                    setMenu(null);
                    setNotice("已新建作品。写下故事，或打开示例。");
                  }}
                >
                  新建作品
                </button>
                <button
                  onClick={() => {
                    const next = blankFilm();
                    next.aspectRatio = "16:9";
                    applyLive(next);
                    setPending(null);
                    setPendingRole(null);
                    setShot(0);
                    setRange(false);
                    setComparing(false);
                    setBench(false);
                    setStage("script");
                    setMenu(null);
                    setNotice("已新建横屏作品。写下故事，或打开示例。");
                  }}
                >
                  新建横屏
                </button>
                <button
                  onClick={() => {
                    applyLive(sampleFilm());
                    setScene("02");
                    setBench(false);
                    setStage("script");
                    setMenu(null);
                    setNotice("已打开示例「雨夜巷战」。");
                  }}
                >
                  打开示例
                </button>
                {/* 4A-U11: 导入小说 moved here from the assistant's quick suggestions. */}
                <button
                  onClick={() => {
                    setMenu(null);
                    setBench(false);
                    setStage("script");
                    fileRef.current?.click();
                  }}
                >
                  导入小说
                </button>
                {seriesList.map((item) => (
                  <button key={item.id} onClick={() => openSaved(item.id)}>
                    {item.title}
                  </button>
                ))}
                <button
                  onClick={() => {
                    archiveOrigin.current = filmRef.current?.id ?? null;
                    setArchiveMode("import");
                    setMenu(null);
                  }}
                >
                  打开工程包
                </button>
                <button
                  disabled={!film}
                  onClick={() => {
                    archiveOrigin.current = filmRef.current?.id ?? null;
                    setArchiveMode("export");
                    setMenu(null);
                  }}
                >
                  导出工程包
                </button>
                <p className="menu-group">这一部</p>
                {episodes.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      void readSaved(item.id).then((saved) => {
                        if (!saved) return;
                        const settled = settleOpenedFilm(saved);
                        applyLive(settled.film);
                        setScene(settled.film.scenes[0]?.id ?? scene);
                        setPlaying(false);
                        setMenu(null);
                        setNotice(
                          settled.interrupted
                            ? "上次关软件时还有镜头没做完，已经停下了。可以重新生成。"
                            : `已打开${saved.episodeTitle}。`,
                        );
                      });
                    }}
                  >
                    {item.title}
                  </button>
                ))}
                <button
                  onClick={() => {
                    if (!film) return;
                    const next = newEpisode(film);
                    applyLive(next);
                    setScene(next.scenes[0]?.id ?? "scene-1");
                    setBench(false);
                    setStage("script");
                    setMenu(null);
                    setNotice(`已新建${next.episodeTitle}。`);
                  }}
                >
                  新建一集
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    setWorkSettings(true);
                  }}
                >
                  作品设置
                </button>
                <div className="menu-sep" role="separator" />
                <button
                  className="danger"
                  onClick={() => {
                    deleteTarget.current = "episode";
                    setMenu(null);
                    setPendingDelete(true);
                  }}
                >
                  删除这一集
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    deleteTarget.current = "series";
                    setMenu(null);
                    setPendingDelete(true);
                  }}
                >
                  删除这部作品
                </button>
              </div>
            )}
          </div>
          {open ? (
            <nav className="tabs" aria-label="创作阶段">
              {STAGES.map((item, index) => {
                // UIR-06: ticked only when that part is done; otherwise how far it got.
                const progress =
                  open && film && item.id !== "edit" ? stageTabs(film)[item.id] : null;
                const done = Boolean(progress?.done);
                const on = item.id === stage;
                return (
                  <button
                    key={item.id}
                    className={`tab${done ? " done" : ""}${on ? " on" : ""}`}
                    aria-current={on ? "page" : undefined}
                    title={`${item.label}（按 ${index + 1}）`}
                    onClick={() => {
                      setStage(item.id);
                      setMenu(null);
                      if (item.id === "board") {
                        const current = filmRef.current;
                        const rows =
                          current?.shots.filter((shotItem) => shotItem.sceneId === scene) ?? [];
                        const list = rows.length > 0 ? rows : (current?.shots ?? []);
                        const next = list.findIndex(
                          (shotItem) => !shotItem.takes.some((take) => take.status === "done"),
                        );
                        setShot(next >= 0 ? next : 0);
                      }
                      if (item.id !== "cast") return;
                      const current = filmRef.current;
                      if (
                        current &&
                        current.characters.length === 0 &&
                        current.locations.length === 0 &&
                        current.scenes.some((sceneItem) => sceneItem.text.trim())
                      ) {
                        void fillCast(current);
                      }
                    }}
                  >
                    <span className="n">
                      {done && !on ? <Ic name="check" size={10} /> : index + 1}
                    </span>
                    {item.label}
                    {progress && !done && progress.total > 0 ? (
                      <small className="tab-count">
                        {progress.have}/{progress.total}
                      </small>
                    ) : null}
                  </button>
                );
              })}
            </nav>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="tb-right">
            {!open || exportView.ready ? null : (
              <span className="export-why" id="export-why">
                {exportView.why}
              </span>
            )}
            {open ? (
              <button
                className={exportView.lead ? "btn primary" : exportView.ready ? "btn" : "btn off"}
                aria-describedby={exportView.ready ? undefined : "export-why"}
                onClick={() => {
                  setExportOpen(true);
                }}
              >
                <Ic name="upload" size={15} />
                导出成片
              </button>
            ) : null}
            {/* 4A-U10: signing in has one place, the avatar; its dot says how the membership is. */}
            <button
              className="avatar"
              data-menu="account"
              aria-label="账号"
              title={accountLine}
              onClick={() => setMenu(menu === "account" ? null : "account")}
            >
              {connected && account.label ? (
                account.label.slice(0, 1)
              ) : (
                <Ic name="user" size={14} />
              )}
              <span className="avatar-dot" data-state={accountState} aria-hidden="true" />
            </button>
            {menu === "account" && (
              <div className="menu" role="menu" aria-label="账号菜单" data-menu="account">
                <p className="menu-note">{accountLine}</p>
                {signingIn && (
                  <button
                    onClick={() => {
                      void window.aijianGrok?.cancel?.();
                      setSigningIn(false);
                      setNotice("登录已取消。");
                    }}
                  >
                    取消登录
                  </button>
                )}
                {!connected && <button onClick={() => void signInGrok()}>用 Grok 会员登录</button>}
                <button
                  onClick={() => {
                    setMenu(null);
                    setAppSettings(true);
                  }}
                >
                  设置
                </button>
                <button onClick={() => void signOutAccount()}>退出登录</button>
              </div>
            )}
          </div>
        </header>
        {showPipeline && film ? (
          <PipelineSteps
            {...pipelineProps}
            targetName={(_, id) => pipelineTargetName(film, id)}
            sceneName={(id) => pipelineSceneName(film, id)}
          />
        ) : null}
        <main className={wsClass}>
          {!open || !film ? (
            <section className="pane home-pane" style={{ gridColumn: "1 / -1" }}>
              <HomeStart
                connected={connected}
                recent={seriesList}
                onOneClick={(idea, aspect) => {
                  oneClickFromHome.current = startWork(aspect, idea).id;
                }}
                onImport={(aspect) => {
                  startWork(aspect);
                  setNotice({
                    code: "EDITOR_GUIDANCE",
                    text: "选一个小说文件。读好以后点「放进剧本」，再点「一键成片」。",
                  });
                  fileRef.current?.click();
                }}
                templates={FILM_TEMPLATES.map((item) => item.name)}
                onBlank={(aspect, template) => {
                  const next = startWork(aspect);
                  if (template) templateFromHome.current = { id: next.id, name: template };
                  if (aspect === "16:9") setNotice("已新建横屏作品。");
                  else setNotice("已新建作品（竖屏）。");
                }}
                onOpen={openSaved}
                onSignIn={() => void signInGrok()}
                onSample={() => {
                  setFilm(sampleFilm());
                  setScene("02");
                  setNotice("已打开示例「雨夜巷战」。");
                }}
              />
            </section>
          ) : (
            <>
              {stage === "script" && (
                <ScriptPage
                  quiet={exportView.lead}
                  onNext={() => setStage("cast")}
                  onReject={rejectPendingSuggestion}
                  film={film}
                  scene={scene}
                  onScene={(id) => {
                    setScene(id);
                    setPending((current) =>
                      current && current.every((item) => item.sceneId !== id) ? null : current,
                    );
                  }}
                  onFilm={setFilm}
                  asking={asking}
                  onPlan={() => {
                    chooseRole("director");
                    void planDirector();
                  }}
                  onWrite={() => void planWriter("write")}
                  onAdapt={() => void planWriter("adapt")}
                  onImport={() => fileRef.current?.click()}
                  onAction={() => void planAction()}
                  onPerformance={() => void planPerformance()}
                  onArt={() => void planArt()}
                  onPrompter={() => void planPrompter()}
                  onQc={() => void planQc()}
                  pending={pendingRole === role ? pending : null}
                  pendingScenes={pendingScenes}
                  onApply={applyPending}
                  onApplyScenes={applyPendingScenes}
                  role={role}
                  onRole={chooseRole}
                  chat={chat}
                  onChat={setChat}
                  onSend={sendChat}
                  showRoles={showRoles}
                  onToggleRoles={() => setShowRoles((value) => !value)}
                  structured={structured}
                  turns={turns}
                  onRetry={pendingRetry ? () => void retryPending() : undefined}
                  card={
                    roleCards[role]?.shots &&
                    roleCards[role]?.shots.every((item) => item.sceneId !== scene)
                      ? null
                      : (roleCards[role] ?? null)
                  }
                  onRedoRange={() => {
                    setStage("edit");
                    setRange(true);
                    setNotice("已选中这一镜。在时间线上点「只重做这一段」。");
                  }}
                  onDismiss={() => {
                    markApplied("qc");
                    setNotice("已记下审片意见。版本仍由你选。");
                  }}
                  onOneClick={() => void oneClickFilm()}
                />
              )}
              {stage === "cast" && (
                <CastPage
                  quiet={exportView.lead}
                  onNext={() => setStage("board")}
                  film={film}
                  onFilm={setFilm}
                  role={role}
                  onRole={chooseRole}
                  card={roleCards[role] ?? null}
                  turns={turns}
                  busy={asking}
                  onApply={applyPending}
                  onReject={rejectPendingSuggestion}
                  onQuick={(label) => {
                    if (label.includes("美术")) void planArt();
                    else sendChat();
                  }}
                  onPortraits={makePortraits}
                  onTraits={(id, traits) =>
                    void productionActions.updateCharacterTraits(id, traits)
                  }
                  onAllPortraits={(ids) => void confirmPortraits(ids)}
                  portraits={portraitFeed(feed, film.id)}
                  portraitBusy={portraitBusy}
                  voices={voiceChoices}
                  onPreview={(voiceId, line) => void previewVoice(voiceId, line)}
                  hearing={hearing}
                  chat={chat}
                  onChat={setChat}
                  onSend={sendChat}
                />
              )}
              {stage === "board" && !bench && (
                <BoardPage
                  onCleanCopy={(ids) => void repairCleanCopies(ids)}
                  cleanCopyBusy={cleanCopyBusy}
                  quiet={exportView.lead}
                  onNext={() => setStage("edit")}
                  film={film}
                  shots={shownShots}
                  shot={shownShots.length === 0 ? 0 : Math.min(shot, shownShots.length - 1)}
                  onShot={setShot}
                  onScene={(id) => {
                    setScene(id);
                    setShot(0);
                  }}
                  onFilm={setFilm}
                  onNotice={setNotice}
                  onGenerate={() => setBench(true)}
                  onBatch={askBatch}
                  onBatchShots={queueBatch}
                  activeSceneId={scene}
                  stills={[]}
                  fourArmed={stillArmed}
                  onFour={generateFourStills}
                  onStills={() => void makeShotStill()}
                  stillProgress={stillProgress}
                  onPickStill={(picture) => {
                    const current = shownShots[shot];
                    if (!current) return;
                    setFilm(
                      updateShot(film, current.id, {
                        picture,
                        action: picture,
                        source: "user",
                        userFields: [...new Set([...current.userFields, "picture"])],
                      }),
                    );
                    setNotice({ code: "COMPOSITION_SELECTED", text: "已换成这张画面。" });
                  }}
                  role={role}
                  onRole={chooseRole}
                  pending={pendingRole === role ? pending : null}
                  onApply={applyPending}
                  onAction={() => void planAction()}
                  onPerformance={() => void planPerformance()}
                  onArt={() => void planArt()}
                  onPrompter={() => void planPrompter()}
                  onQc={() => void planQc()}
                  onTimeLine={(id) => void timeShotFromLine(id)}
                  chat={chat}
                  onChat={setChat}
                  onSend={sendChat}
                  turns={turns}
                  onRetry={pendingRetry ? () => void retryPending() : undefined}
                  assistPulse={assistPulse}
                  onFixCoverage={productionActions.fixCoverage}
                  structured={structured}
                  card={sceneCard}
                  qcCard={roleCards.qc ?? null}
                  promptSuggestion={shotPromptSuggestions}
                  onRedoRange={redoFromReview}
                  onDismiss={keepReview}
                  onReject={rejectPendingSuggestion}
                />
              )}
              {stage === "board" && bench && (
                <GeneratePage
                  onCleanCopy={(ids) => void repairCleanCopies(ids)}
                  cleanCopyBusy={cleanCopyBusy}
                  beginner={prefs.beginner}
                  quiet={exportView.lead}
                  onMute={() => setSoundOn((value) => !value)}
                  assistant={shotAssistant}
                  onBack={() => setBench(false)}
                  film={film}
                  shots={shownShots}
                  shot={shot}
                  onShot={setShot}
                  onFilm={setFilm}
                  versions={versions}
                  onVersions={(count) => {
                    setVersions(count);
                    setFilm({ ...film, takesPerShot: count });
                  }}
                  duration={duration}
                  onDuration={(seconds) => {
                    setDuration(seconds);
                    const current = shownShots[shot];
                    if (!current) return;
                    setFilm({
                      ...film,
                      shots: film.shots.map((item) =>
                        item.id === current.id
                          ? {
                              ...item,
                              seconds,
                              userFields: [...new Set([...item.userFields, "seconds"])],
                            }
                          : item,
                      ),
                    });
                  }}
                  onCreate={() => {
                    const current = shownShots[shot];
                    if (!current) return;
                    setPendingBatch([current]);
                  }}
                  playing={playing}
                  onPlaying={setPlaying}
                  audible={soundOn}
                />
              )}
              {stage === "edit" && (
                <EditPage
                  waveformKeys={audioWaveforms.verified}
                  waveformBusy={audioWaveforms.busy}
                  onRefreshWaveforms={audioWaveforms.refresh}
                  onMute={() => setSoundOn((value) => !value)}
                  assistant={shotAssistant}
                  libraryTools={audioLibrary.tools}
                  onSceneMood={(sceneId, mood) => {
                    const ids = new Set(
                      film.shots.filter((item) => item.sceneId === sceneId).map((item) => item.id),
                    );
                    setFilm({
                      ...film,
                      shots: film.shots.map((item) =>
                        ids.has(item.id)
                          ? { ...item, sound: { ...item.sound, musicMood: mood } }
                          : item,
                      ),
                    });
                  }}
                  onSubtitleStyle={(styleId) => {
                    // GPT's C5 adds the field to FilmProject and burns it in on export
                    // (next/INTEGRATION.md, 字幕样式). Loading a work keeps it already.
                    setFilm({ ...film, subtitleStyle: styleId } as FilmProject);
                    setNotice({ code: "SUBTITLE_STYLE_SAVED", text: "已记下字幕样式。" });
                  }}
                  onSceneVoice={(sceneId, db) => {
                    const live = filmRef.current;
                    if (!live) return;
                    const sceneShots = live.shots.filter((item) => item.sceneId === sceneId);
                    const ids = new Set(sceneShots.map((item) => item.id));
                    const audioClips = live.audioClips.map((clip) =>
                      clip.lane === "dialogue" && ids.has(clip.shotId)
                        ? { ...clip, gainDb: db }
                        : clip,
                    );
                    for (const target of sceneShots) {
                      const take = target.selectedTakeId
                        ? target.takes.find((take) => take.id === target.selectedTakeId)
                        : target.takes.find((take) => take.status === "done" && take.videoPath);
                      if (
                        !take?.videoPath ||
                        take.status !== "done" ||
                        audioClips.some(
                          (clip) =>
                            clip.lane === "dialogue" &&
                            clip.shotId === target.id &&
                            clip.takeId === take.id &&
                            clip.path,
                        )
                      )
                        continue;
                      audioClips.push({
                        id: `native-volume:${target.id}:${take.id}`,
                        lane: "dialogue",
                        shotId: target.id,
                        takeId: take.id,
                        label: "原声",
                        path: take.videoPath,
                        startSeconds: 0,
                        durationSeconds: take.durationSeconds ?? target.seconds,
                        offsetSeconds: 0,
                        gainDb: db,
                      });
                    }
                    applyLive({ ...live, audioClips });
                    setNotice("音量已记下，导出时用这个音量。");
                  }}
                  film={film}
                  shot={shot}
                  onShot={setShot}
                  shots={shownShots}
                  range={range}
                  comparing={comparing}
                  rightTab={rightTab}
                  playing={playing}
                  actions={actions}
                  onTogglePlay={() => togglePlayback(setPlaying)}
                  onSelectRange={() => {
                    setSpan({ from: shot, to: shot });
                    setRange(true);
                    setComparing(true);
                    setRightTab("fix");
                  }}
                  onMarkIn={(seconds) => {
                    const target = shownShots[shot];
                    const take =
                      target?.takes.find((row) => row.id === target.selectedTakeId) ??
                      target?.takes.find((row) => row.status === "done");
                    if (target && take)
                      setRangeSeconds({
                        shotId: target.id,
                        takeId: take.id,
                        start: seconds,
                        end:
                          rangeSeconds?.shotId === target.id && rangeSeconds.takeId === take.id
                            ? rangeSeconds.end
                            : (take.durationSeconds ?? target.seconds),
                      });
                    setSpan({ from: shot, to: span?.to ?? shot });
                    setRange(true);
                    setComparing(true);
                    setRightTab("fix");
                  }}
                  onMarkOut={(seconds) => {
                    const target = shownShots[shot];
                    const take =
                      target?.takes.find((row) => row.id === target.selectedTakeId) ??
                      target?.takes.find((row) => row.status === "done");
                    if (target && take)
                      setRangeSeconds({
                        shotId: target.id,
                        takeId: take.id,
                        start:
                          rangeSeconds?.shotId === target.id && rangeSeconds.takeId === take.id
                            ? rangeSeconds.start
                            : 0,
                        end: seconds,
                      });
                    const from = span?.from ?? shot;
                    setSpan({ from: Math.min(from, shot), to: Math.max(from, shot) });
                    setRange(true);
                    setComparing(true);
                    setRightTab("fix");
                  }}
                  span={span}
                  onLane={(lane, gainDb) => {
                    const live = filmRef.current;
                    if (!live) return;
                    const settings = audioMixSettings(live.audioMix);
                    const previous = settings.lanes[lane];
                    settings.lanes[lane] = {
                      gainDb: gainDb <= -40 ? previous.gainDb : gainDb,
                      muted: gainDb <= -40,
                    };
                    applyLive({ ...live, audioMix: settings });
                    setNotice(gainDb <= -40 ? "这一轨已静音。" : "音量已记下，导出时用这个音量。");
                  }}
                  audioPreview={audioMixPreview}
                  onBindPreparedVoice={(clipId, shotId, takeId) => {
                    const live = filmRef.current;
                    if (!live || live !== film) return;
                    const next = bindPreparedVoice(live, {
                      projectId: film.id,
                      clipId,
                      shotId,
                      takeId,
                    });
                    if (next) applyLive(next);
                  }}
                  onRestoreAudioClip={(id) => {
                    const live = filmRef.current;
                    if (!live) return;
                    applyLive({
                      ...live,
                      audioClips: live.audioClips.map((clip) =>
                        clip.id === id ? { ...clip, gainDb: AUDIO_LANE_GAIN_DB[clip.lane] } : clip,
                      ),
                    });
                  }}
                  onSolo={(lane) => {
                    setHearLane((current) => {
                      const next = current === lane ? "" : lane;
                      setNotice(
                        next === "score"
                          ? "只听配乐。音量没有改。"
                          : next === "dialogue"
                            ? "只听对白。音量没有改。"
                            : next
                              ? ""
                              : "所有声音一起听。",
                      );
                      return next;
                    });
                  }}
                  hearLane={hearLane}
                  onRewrite={(picture) => {
                    const current = shownShots[shot];
                    if (!film || !current) return;
                    setFilm(
                      updateShot(film, current.id, {
                        picture,
                        promptZh: "",
                        source: "user",
                        userFields: [...new Set([...current.userFields, "picture"])],
                      }),
                    );
                  }}
                  onPickClip={() => {
                    setRange(true);
                    setRightTab("fix");
                  }}
                  onRangeGenerate={openSecondsRange}
                  onClearRange={() => {
                    setRange(false);
                    setComparing(false);
                    setRightTab("props");
                  }}
                  onAction={runAction}
                  onChooseTake={(shotId, takeId) => {
                    if (!film) return;
                    setFilm({
                      ...film,
                      shots: film.shots.map((item) =>
                        item.id === shotId ? { ...item, selectedTakeId: takeId } : item,
                      ),
                    });
                    setNotice({
                      code: "TAKE_REPLACED",
                      text: "已换成这一版。旧版留在历史版本里。",
                    });
                  }}
                  onKeep={() => setComparing(false)}
                  onTab={setRightTab}
                  onNotice={setNotice}
                  onPlaying={setPlaying}
                  audible={soundOn}
                  onImportMusic={(file) => {
                    const path = window.aijian?.filePath?.(file) || "";
                    const bridge = window.aijian;
                    if (!film || !path || !bridge?.importMusic) {
                      setNotice("请在桌面版里选择一个 mp3 或 wav 音乐文件。");
                      return;
                    }
                    void bridge.importMusic(film.seriesId, path).then((stored) => {
                      const latest = filmRef.current;
                      if (!latest || latest.id !== film.id || latest.seriesId !== film.seriesId)
                        return;
                      applyLive({
                        ...latest,
                        audioClips: [
                          ...latest.audioClips,
                          {
                            id: `music-${Date.now()}`,
                            lane: "score",
                            shotId: "",
                            takeId: "",
                            label: "",
                            startSeconds: 0,
                            durationSeconds: 0,
                            offsetSeconds: 0,
                            gainDb: -22,
                            loop: true,
                            path: stored.path,
                          },
                        ],
                      });
                      setNotice("已导入音乐。有台词时，导出会把配乐压低。");
                    });
                  }}
                />
              )}
            </>
          )}
        </main>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.docx,.epub,text/plain"
          aria-label="导入小说"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importBook(file);
          }}
        />
        {/* 4C-U08: the latest message on the left, work in progress in the middle (only a
            small button when there is none), and where the work is kept on the right. */}
        <footer className="statusbar">
          <div className="sb-left">
            {asking && (
              <button
                type="button"
                onClick={() => {
                  void (
                    window.aijianGrok as { cancelText?: () => Promise<unknown> } | undefined
                  )?.cancelText?.();
                  setAsking(false);
                  setNotice("已取消。");
                }}
              >
                取消
              </button>
            )}
            <span
              className={status.fading ? "status-note fading" : "status-note"}
              role="status"
              title={
                status.line
                  ? [status.line.text, status.line.detail].filter(Boolean).join("\n")
                  : undefined
              }
              style={{
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {status.line?.text ?? ""}
            </span>
            {/* 4A-U11: what the assistant put in can be taken back from the status bar. */}
            {status.line && !status.fading && APPLIED_CODES.has(status.line.code) ? (
              <button
                type="button"
                className="status-undo"
                aria-label="撤销刚才放进去的"
                onClick={undoEdit}
              >
                撤销
              </button>
            ) : null}
          </div>
          <div className="sb-mid">
            {audioLibrary.pendingButton}
            <button
              className={busy ? "task" : "task idle"}
              data-menu="queue"
              aria-label={busy ? undefined : "后台生成：没有在做的"}
              title={busy ? undefined : "任务和提示记录"}
              onClick={() => setMenu(menu === "queue" ? null : "queue")}
            >
              <Ic name="loader" size={12} />
              {busy ? "后台生成：" : null}
              {!busy
                ? null
                : asking
                  ? "AI 在写"
                  : feedNow.active > 0
                    ? `正在做 ${feedNow.active} 个`
                    : portraitBusy
                      ? "正在出定妆照"
                      : "没有在做的"}
              {/* UIR-04: no bar when nothing is being made; it used to stay full after a failure. */}
              {feedNow.active > 0 || finished < tracked.length ? (
                <span className="bar">
                  <i style={{ width: `${feedNow.active > 0 ? feedNow.percent : progress}%` }} />
                </span>
              ) : null}
            </button>
          </div>
          <div className="sb-right">
            <span className="where">
              {savingDisk
                ? "正在保存…"
                : (diskError?.projectId === film?.id ? diskError?.message : "") ||
                  (savedDirectory
                    ? "作品保存在"
                    : filmDiskReady()
                      ? "已保存在这台电脑上"
                      : import.meta.env.DEV
                        ? BROWSER_DIRECTORY
                        : "")}{" "}
              <b>{savedDirectory || film?.title || ""}</b>
            </span>
          </div>
        </footer>
        {confirmSignIn && (
          <div className="dialog-back">
            <div className="dialog" role="dialog" aria-label="登录 Grok">
              <h2>登录 Grok</h2>
              <p>会打开浏览器让你登录 Grok。在网页上点「允许」，再回到这里。</p>
              <div className="acts">
                <button
                  className="btn primary"
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    void beginSignIn();
                  }}
                  onClick={() => void beginSignIn()}
                >
                  去浏览器授权
                </button>
                <button className="btn" type="button" onClick={() => setConfirmSignIn(false)}>
                  先不登录
                </button>
              </div>
            </div>
          </div>
        )}
        {rangeDialog && rangeSeconds && (
          <div className="dialog-back">
            <div
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-label="秒级局部重做"
              style={{ maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}
            >
              <h2>秒级局部重做 · 仅画面</h2>
              {film &&
                film.shots
                  .filter((item) => item.id === rangeSeconds.shotId)
                  .map((item) => (
                    <p key={item.id}>{scopeOf(film, item.sceneId, item)} · 当前所选版本</p>
                  ))}
              <p>
                每次处理单镜内1–10秒。保留原完整音轨，不重做对白，不验证口型。只使用可核验的无字幕画面，保留原字幕布局供导出；预览不烧入字幕，请在导出时重新检查。
              </p>
              <p>
                当前没有可靠的逐句语音时间；无法精确扩展整句。需要修改台词时请取消，保守重做整镜。
              </p>
              <p>目前请从保留的原版开始；本机拼接版暂不支持再次局部重做，原版不会删除。</p>
              <label>
                入点（秒）
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label="局部重做入点"
                  disabled={rangeBusy}
                  value={rangeSeconds.start}
                  onChange={(event) => {
                    setRangeSeconds({ ...rangeSeconds, start: Number(event.target.value) });
                    setRangeReady(null);
                    rangeReadyRef.current = null;
                  }}
                />
              </label>
              <label>
                出点（秒）
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  aria-label="局部重做出点"
                  disabled={rangeBusy}
                  value={rangeSeconds.end}
                  onChange={(event) => {
                    setRangeSeconds({ ...rangeSeconds, end: Number(event.target.value) });
                    setRangeReady(null);
                    rangeReadyRef.current = null;
                  }}
                />
              </label>
              {rangeReady && (
                <div role="status">
                  <p>
                    请求范围 {rangeReady.plan.requested.start.toFixed(3)}–
                    {rangeReady.plan.requested.end.toFixed(3)} 秒
                  </p>
                  <p>
                    按原片 {rangeReady.plan.frameRate} 帧/秒对齐后：
                    {rangeReady.plan.effective.start.toFixed(3)}–
                    {rangeReady.plan.effective.end.toFixed(3)} 秒
                  </p>
                  <details>
                    <summary>本次局部画面提交文本</summary>
                    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                      {(() => {
                        try {
                          const target = rangeReady.project.shots.find(
                            (item) => item.id === rangeReady.shotId,
                          )!;
                          return (
                            rangeVideoBody(
                              rangeReady.project,
                              target,
                              rangeReady.plan.generationSeconds,
                              rangeReady.project.draft,
                            )?.shots?.[0]?.prompt ?? "尚未得到局部说明。"
                          );
                        } catch {
                          return "全镜说明或当前事实已变化，请重新整理后检查局部范围。本次尚未派发。";
                        }
                      })()}
                    </p>
                    <p>
                      这是局部画面请求，另编本次时长；原完整音轨保留，未验证口型，不重新绑定存档中的全镜说明。
                    </p>
                  </details>
                  <p>
                    {confirmEstimate([{ seconds: rangeReady.plan.generationSeconds }], 1)}
                    ；需要的首帧从原片本机提取。只派发一次，接回失败不自动重试。
                  </p>
                </div>
              )}
              {rangeMessage && <p role="status">{rangeMessage}</p>}
              <div className="dialog-actions">
                <button className="btn" onClick={cancelSecondsRange}>
                  {rangeBusy ? (rangeExecuting.current ? "取消接回" : "取消检查") : "取消"}
                </button>
                {rangeReady ? (
                  <button
                    className="btn primary"
                    disabled={rangeBusy}
                    onClick={() => void confirmSecondsRange()}
                  >
                    确认生成此画面段
                  </button>
                ) : (
                  <button
                    className="btn primary"
                    disabled={rangeBusy}
                    onClick={() => void inspectSecondsRange()}
                  >
                    检查秒级范围
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {pendingBatch && (
          <div className="dialog-back">
            <div
              className="dialog"
              role="dialog"
              aria-label="生成前确认"
              data-testid="confirm-table"
            >
              <h2>生成前确认</h2>
              <table>
                <thead>
                  <tr>
                    <th>镜头</th>
                    <th>秒数</th>
                    <th>台词</th>
                    <th>台词的声音</th>
                    <th>配乐</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingBatch.map((item) => (
                    <tr key={item.id}>
                      <td>{(film && scopeOf(film, item.sceneId, item)) || `镜头 ${item.no}`}</td>
                      <td>{item.seconds}</td>
                      <td>{item.line.trim() || "无"}</td>
                      <td>{item.line.trim() ? "另外配音" : "没有台词"}</td>
                      <td>
                        {film?.audioClips.some((clip) => clip.lane === "score" && clip.path)
                          ? "已导入"
                          : "无"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p data-testid="batch-estimate">{confirmEstimate(pendingBatch, versions)}</p>
              {draftFaceWarning(Boolean(film?.draft)) ? (
                <p>{draftFaceWarning(Boolean(film?.draft))}</p>
              ) : null}
              {pendingBatch.some(
                (item) =>
                  fitShotToLine(
                    item,
                    film?.scenes.find((sceneItem) => sceneItem.id === item.sceneId)?.no,
                  ).warning,
              ) ? (
                <p>
                  {pendingBatch
                    .map(
                      (item) =>
                        fitShotToLine(
                          item,
                          film?.scenes.find((sceneItem) => sceneItem.id === item.sceneId)?.no,
                        ).warning,
                    )
                    .filter(Boolean)
                    .join("")}
                </p>
              ) : null}
              <div className="acts">
                <button className="btn primary" onClick={confirmBatchGeneration}>
                  开始生成
                </button>
                <button className="btn" onClick={() => setPendingBatch(null)}>
                  先不生成
                </button>
              </div>
            </div>
          </div>
        )}
        {pendingDelete && (
          <div className="dialog-back">
            <div className="dialog" role="dialog" aria-label="确认删除">
              <h2>
                {deleteTarget.current === "series"
                  ? `要删除作品「${film?.seriesTitle || film?.title || "这部作品"}」吗？电脑上的文件会一起删掉，删了找不回来。`
                  : `要删除「${film?.title || "这一集"}」这一集吗？电脑上的文件会一起删掉，删了找不回来。`}
              </h2>
              <div className="acts">
                <button className="btn primary" onClick={confirmDeleteFilm}>
                  确认删除
                </button>
                <button className="btn" onClick={() => setPendingDelete(false)}>
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
        {menu === "queue" && film ? (
          <div
            className="task-back"
            data-overlay
            data-menu="queue"
            role="dialog"
            aria-label="后台生成"
          >
            <div className="task-head">
              <h2>后台生成</h2>
              <span className="sp" />
              <button className="icon-btn" aria-label="关上后台生成" onClick={() => setMenu(null)}>
                <Ic name="x" size={16} />
              </button>
            </div>
            <BatchProgressView batches={feed.batches} />
            <TaskCenter
              title={film.seriesTitle || film.title}
              tasks={namedTasks(feed.tasks, film)}
              paused={paused}
              resumeLabel="继续排队"
              onPause={() => {
                pauseRef.current = true;
                setPaused(true);
                setNotice({
                  code: "GENERATION_PAUSED",
                  text: "已暂停。已经发给 Grok 的那几个可能还会做完。",
                });
              }}
              onResume={() => {
                pauseRef.current = false;
                setPaused(false);
                setNotice("继续排队。");
              }}
              onRetry={(taskId) => retryGenerationTasks([taskId])}
              canRetry={(task) => retryableVideoTask(film, task.id)}
              onRetryFailed={() => {
                const ids = film.jobs
                  .filter((job) => retryableVideoTask(film, job.id))
                  .map((job) => job.id);
                void (async () => {
                  for (const id of ids) {
                    if (filmRef.current?.id !== film.id) return;
                    await retryGenerationTasks([id]);
                  }
                })();
              }}
              onRemove={(taskId) => {
                const cancelled = cancelVideoTask(filmRef.current ?? film, taskId);
                if (!cancelled.jobId) return;
                cancelledJobs.current.add(cancelled.jobId);
                applyLive(cancelled.film);
                const billed = film.backendProjectId || projectId;
                if (cancelled.running && billed) void window.aijian?.cancelStoryFilm?.(billed);
                setNotice({
                  code: "GENERATION_CANCEL_REQUESTED",
                  text: "已取消。如果已经发给 Grok，它可能还会做完。",
                });
              }}
              canRemove={(task) =>
                film.jobs.some(
                  (job) =>
                    job.id === task.id &&
                    (job.status === "queued" ||
                      job.status === "running" ||
                      (job.status === "failed" && job.interruptedFrom === "queued")),
                )
              }
              onOpenStoryboard={() => {
                setMenu(null);
                setStage("board");
              }}
            />
            <NoticeLog log={status.log} />
          </div>
        ) : null}
        {audioLibrary.dialog}
        {audioLibrary.pendingPanel}
        {appSettings ? (
          <div className="dialog-back">
            <div className="dialog work-settings" role="dialog" aria-label="设置">
              <h2>设置</h2>
              <section className="ws-sec" aria-label="账号">
                <h3>账号</h3>
                <p className="role-desc">
                  {accountLine}。只能用 Grok 会员登录；登录、退出在右上角头像的菜单里。
                </p>
              </section>
              <section className="ws-sec" aria-label="导出">
                <h3>默认导出到</h3>
                <div className="pathrow">
                  <input
                    className="input"
                    aria-label="默认导出文件夹"
                    value={prefs.exportDir}
                    placeholder="不填就用软件的默认文件夹"
                    onChange={(event) => changePrefs({ exportDir: event.target.value })}
                  />
                  <button
                    className="btn sm"
                    type="button"
                    onClick={() => {
                      void window.aijian?.pickFilmFolder?.().then((dir) => {
                        if (dir) changePrefs({ exportDir: dir });
                      });
                    }}
                  >
                    浏览
                  </button>
                </div>
              </section>
              <section className="ws-sec" aria-label="默认">
                <h3>默认</h3>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={soundOn}
                    onChange={(event) => setSoundOn(event.target.checked)}
                  />
                  预览有声音（随时按 M 切换）
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={prefs.aiMark}
                    onChange={(event) => changePrefs({ aiMark: event.target.checked })}
                  />
                  新封面标「AI 生成」（部分平台要求标注）
                </label>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={prefs.beginner}
                    onChange={(event) => {
                      changePrefs({ beginner: event.target.checked });
                      if (event.target.checked) setVersions(1);
                    }}
                  />
                  新手模式：每个镜头只出 1 个版本
                </label>
              </section>
              <ReplyCaptureSettings getFilm={() => filmRef.current} onNotice={setNotice} />
              <section className="ws-sec" aria-label="快捷键">
                <h3>快捷键</h3>
                {/* 4C-U04: only keys that do something; the same words as the buttons' tooltips. */}
                <dl className="keys">
                  {SHORTCUTS.map(([key, what]) => (
                    <div key={key}>
                      <dt>
                        <kbd>{key}</kbd>
                      </dt>
                      <dd>{what}</dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section className="ws-sec" aria-label="用量">
                <h3>用量</h3>
                <p className="role-desc">
                  软件看不到 Grok
                  会员还剩多少额度。出一个视频版本、一张图、一段配音，各用一次；剩多少请到 Grok
                  网站看。
                </p>
              </section>
              <div className="acts">
                <span className="sp" />
                <button className="btn" type="button" onClick={() => setAppSettings(false)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {archiveMode ? (
          <ProjectArchiveDialog
            mode={archiveMode}
            projectId={film?.id ?? null}
            onClose={() => setArchiveMode(null)}
            onExport={async () => {
              const current = filmRef.current;
              if (!current) return { kind: "FAILED", code: "INVALID_INPUT" };
              return exportProjectArchive(current, {
                current: () => filmRef.current,
                apply: applyLive,
                acquire: (id) => persistence.acquire(id),
              });
            }}
            onImport={async () =>
              window.aijian?.importFilmProjectArchive
                ? window.aijian.importFilmProjectArchive()
                : { kind: "FAILED", code: "RUNTIME_UNAVAILABLE" }
            }
            onImported={async (id) => {
              const origin = archiveOrigin.current;
              if ((filmRef.current?.id ?? null) !== origin) return false;
              const imported = await readSaved(id);
              if (!imported || (filmRef.current?.id ?? null) !== origin) return false;
              const settled = settleOpenedFilm(imported);
              applyLive(settled.film);
              setScene(settled.film.scenes[0]?.id ?? "scene-1");
              setShot(0);
              setPlaying(false);
              setStage("script");
              setBench(false);
              setMenu(null);
              setArchiveMode(null);
              setNotice({
                code: "STEP_COMPLETE",
                text: NOTICE_TEXT.STEP_COMPLETE,
                detail: "工程包已导入为独立新作品。历史版本和账号信息未带入。",
              });
              return true;
            }}
          />
        ) : null}
        {workSettings && film ? (
          <div className="dialog-back">
            <div className="dialog work-settings" role="dialog" aria-label="作品设置">
              <h2>作品设置 · {film.seriesTitle || film.title}</h2>
              <section className="ws-sec" aria-label="名字">
                <h3>作品名</h3>
                <div className="pathrow">
                  <input
                    className="input"
                    aria-label="作品名"
                    value={rename}
                    onChange={(event) => setRename(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                      event.preventDefault();
                      const name = event.currentTarget.value.trim();
                      if (!film || !name) return;
                      void renameFilm(film.seriesId, name);
                      applyLive({ ...film, title: name, seriesTitle: name });
                      setNotice("已改作品名。");
                    }}
                  />
                  <button
                    className="btn sm"
                    type="button"
                    onClick={() => {
                      if (!film || !rename.trim()) return;
                      void renameFilm(film.seriesId, rename.trim());
                      applyLive({ ...film, title: rename.trim(), seriesTitle: rename.trim() });
                      setNotice("已改作品名。");
                    }}
                  >
                    保存名字
                  </button>
                </div>
              </section>
              <section className="ws-sec" aria-label="画风">
                <h3>画风</h3>
                <p className="role-desc">
                  整部作品的画风在「角色与场景」页最上面改，改了以后已经做好的镜头会标「画风变了」。
                </p>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => {
                    setWorkSettings(false);
                    setBench(false);
                    setStage("cast");
                  }}
                >
                  去改画风
                </button>
              </section>
              <section className="ws-sec" aria-label="历史版本">
                <h3>历史版本</h3>
                {window.aijian?.captureFilmHistory &&
                window.aijian.restoreFilmHistory &&
                window.aijian.listFilmHistory ? (
                  <button
                    className="btn sm"
                    disabled={persistentHistoryBusy}
                    onClick={() => void keepCurrentHistory()}
                  >
                    {persistentHistoryBusy ? "正在处理历史版本…" : "保存当前版本"}
                  </button>
                ) : null}
                {persistentHistoryUnreadable > 0 && persistentHistory?.length ? (
                  <p className="role-desc">
                    有 {persistentHistoryUnreadable} 份历史暂时无法核验，原文件已保留。
                  </p>
                ) : null}
                <HistoryList
                  key={film?.id}
                  entries={persistentHistory?.map(historyEntryView) ?? null}
                  loading={persistentHistoryLoading}
                  error={persistentHistoryError}
                  restoring={persistentHistoryRestoring || (persistentHistoryBusy ? "saving" : "")}
                  onRestore={(id) => void restoreKeptHistory(id)}
                />
              </section>
              <div className="acts">
                <span className="sp" />
                <button className="btn" type="button" onClick={() => setWorkSettings(false)}>
                  关闭
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {exportOpen && (
          <div className="dialog-back">
            <div
              className={coverOpen && film ? "dialog export wide" : "dialog export"}
              role="dialog"
              aria-label="导出成片"
            >
              <h2>{coverOpen && film ? "导出成片 · 封面" : "导出成片"}</h2>
              {coverOpen && film ? (
                // 4B-U04: the cover, a step inside the export dialog.
                <div className="cover-step">
                  {(() => {
                    const data = coverEditorData(film, { mediaUrl: fileMediaUrl });
                    const cover = coverOf(film, data.ok ? data.props : null, prefs.aiMark);
                    const keep = (next: Partial<CoverInput>) =>
                      setFilm({ ...film, cover: { ...cover, ...next } } as FilmProject);
                    return (
                      <CoverEditor
                        title={cover.title}
                        subtitle={cover.subtitle}
                        aiMark={cover.aiMark}
                        backgroundUrl={cover.backgroundUrl || undefined}
                        onTitleChange={(title) => keep({ title })}
                        onSubtitleChange={(subtitle) => keep({ subtitle })}
                        onAiMarkChange={(aiMark) => keep({ aiMark })}
                        onSave={() => {
                          keep({});
                          setCoverOpen(false);
                          setNotice({ code: "COVER_SAVED", text: "已记下封面。" });
                        }}
                      />
                    );
                  })()}
                  <div className="acts">
                    <button className="btn" type="button" onClick={() => setCoverOpen(false)}>
                      返回
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="field">
                    <label>文件名</label>
                    <div className="input">
                      {film
                        ? filmFileName(film.seriesTitle || film.title, film.episodeTitle || "第1集")
                        : "未命名"}
                    </div>
                  </div>
                  {canCropAspect && film ? (
                    <div className="field">
                      <label htmlFor="export-aspect">比例</label>
                      <select
                        id="export-aspect"
                        className="input"
                        aria-label="比例"
                        value={exportAspects}
                        onChange={(event) =>
                          setExportAspects(event.target.value as "work" | "other" | "both")
                        }
                      >
                        <option value="work">
                          {film.aspectRatio === "16:9"
                            ? "横屏 16:9（作品的画幅）"
                            : "竖屏 9:16（作品的画幅）"}
                        </option>
                        <option value="other">
                          {film.aspectRatio === "16:9"
                            ? "竖屏 9:16（从画面中间裁）"
                            : "横屏 16:9（从画面中间裁）"}
                        </option>
                        <option value="both">两种都要</option>
                      </select>
                    </div>
                  ) : film ? (
                    <div className="field">
                      <label>比例</label>
                      <div className="input" title="这个版本的桌面程序只能按作品的画幅导出">
                        {film.aspectRatio === "16:9"
                          ? "横屏 16:9（作品的画幅）"
                          : "竖屏 9:16（作品的画幅）"}
                      </div>
                    </div>
                  ) : null}
                  {film ? (
                    <div className="field">
                      <label htmlFor="export-quality">清晰度</label>
                      <select
                        id="export-quality"
                        className="input"
                        aria-label="清晰度"
                        value={exportQuality}
                        onChange={(event) =>
                          setExportQuality(event.target.value as "1080p" | "720p")
                        }
                      >
                        <option value="1080p">1080p（推荐）</option>
                        <option value="720p">720p（文件小一些）</option>
                      </select>
                    </div>
                  ) : null}
                  <div className="field">
                    <label className="check-row">
                      <input
                        type="checkbox"
                        aria-label="导出时自动调整音量"
                        checked={film ? audioMixSettings(film.audioMix).autoAdjustVolume : false}
                        onChange={(event) => {
                          const live = filmRef.current;
                          if (!live) return;
                          applyLive({
                            ...live,
                            audioMix: {
                              ...audioMixSettings(live.audioMix),
                              autoAdjustVolume: event.target.checked,
                            },
                          });
                        }}
                      />
                      导出时自动调整音量
                    </label>
                    <p className="role-desc">
                      默认关闭。开启后会实际测量并调整全片音量，成片音量可能与当前试听不同；静音不会变成有声。
                    </p>
                  </div>
                  {film ? (
                    <div className="field">
                      <label id="export-subs">字幕</label>
                      <div className="seg" role="radiogroup" aria-labelledby="export-subs">
                        {(
                          [
                            ["burn", "烧进画面"],
                            ["srt", "单独文件"],
                            ["none", "不要"],
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={exportSubs === value}
                            className={exportSubs === value ? "on" : ""}
                            onClick={() => setExportSubs(value)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {film ? (
                    <div className="field">
                      <label>封面</label>
                      <div className="cover-row">
                        {(() => {
                          const data = coverEditorData(film, { mediaUrl: fileMediaUrl });
                          const cover = coverOf(film, data.ok ? data.props : null, prefs.aiMark);
                          return (
                            <span className="cover-sum">
                              {cover.title ? `「${cover.title}」` : "还没有片名"}
                              {cover.subtitle ? ` · ${cover.subtitle}` : ""}
                              {cover.aiMark ? " · 标「AI 生成」" : " · 不标「AI 生成」"}
                            </span>
                          );
                        })()}
                        <button className="btn sm" type="button" onClick={() => setCoverOpen(true)}>
                          改封面
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <p className="role-desc">审核后选择保存位置，检查阶段不会发布文件。</p>
                  <p className="export-line" data-testid="export-summary">
                    {film ? exportLine(film) : "还没有作品。"}
                  </p>
                  {film && missingByScene(film).length > 0 ? (
                    <details className="missing">
                      <summary>按场看还没生成的镜头</summary>
                      <ul>
                        {missingByScene(film).map((row) => (
                          <li key={row.id}>
                            <b>{row.scene}</b>
                            <span>{row.shots}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {film && cleanCopyBlocked ? (
                    <CleanCopyRepair
                      mode="export"
                      count={shotsNeedingCleanCopy(film).length}
                      busy={cleanCopyBusy}
                      onRepair={() => void repairCleanCopies(null)}
                    />
                  ) : null}
                  {exportExecution ? (
                    <ExportProgress
                      operationKey={exportExecution.operationId}
                      phase={exportExecution.phase}
                      progress={exportExecution.progress}
                      cancelState={exportExecution.cancelState}
                      published={exportExecution.published}
                      onRequestCancel={() => requestExportStop(exportExecution.operationId)}
                    />
                  ) : null}
                  {film &&
                  exportQc?.error === qcFailureText.SOURCE_UNVERIFIED &&
                  window.aijian?.recoverFilmCleanCopy ? (
                    <div className="field">
                      <p>
                        已有无字幕副本无法核验时，可从原片的合成记录在本机重建；原片和旧副本都会保留。
                      </p>
                      {legacyCleanCopyTargets(film).map((target) => (
                        <button
                          key={target.shotId}
                          className="btn"
                          disabled={recoveryBusy || exportQcBusy}
                          onClick={() => void recoverLegacyCleanCopy(target.shotId)}
                        >
                          {recoveryBusy
                            ? "正在本机重建…"
                            : `${target.label}：重建可核验的无字幕副本`}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {exportQc ? (
                    <>
                      {exportQc.error ? (
                        <p role="alert" className="role-desc">
                          {exportQc.error}
                        </p>
                      ) : null}
                      {exportQc.ready && exportQc.ready.outputs.length > 1 ? (
                        <div className="seg" aria-label="检查画幅">
                          {exportQc.ready.outputs.map((output, index) => (
                            <button
                              key={output.aspectRatio}
                              className={exportQcAspect === index ? "on" : ""}
                              onClick={() => setExportQcAspect(index)}
                            >
                              {output.aspectRatio}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <ExportCheck
                        reviewMode
                        checking={exportQc.checking}
                        error={exportQc.error}
                        busy={exportQcBusy}
                        stale={exportQcStale}
                        report={exportQc.ready?.outputs[exportQcAspect]?.report ?? null}
                        shots={exportQc.ready?.shots}
                        fileName={exportQc.ready?.fileName}
                        unverified={exportQc.ready?.unverified}
                        publishBlocked={exportQc.ready?.outputs.some((output) => {
                          const read = readQcReport(output.report);
                          return (
                            !read.ok ||
                            read.report.issues.some((issue) => issue.severity === "block")
                          );
                        })}
                        onFix={fixExportIssue}
                        onExport={() => void publishCheckedExport()}
                        onCancel={cancelCheckedExport}
                      />
                    </>
                  ) : null}
                  {/* 4B-U06: the export's progress stays in the dialog. */}
                  {exporting && !exportQc ? (
                    <div className="export-progress" role="status">
                      <span className="bar" aria-hidden="true" />
                      <span>正在导出：拼接、混音、写文件。长一点的片子要几分钟。</span>
                    </div>
                  ) : exportFile ? (
                    <p className="export-done" role="status" title={exportFile}>
                      导出好了：{exportFile}
                    </p>
                  ) : null}
                  <div className="acts">
                    <button className="btn" onClick={() => setExportOpen(false)}>
                      关闭
                    </button>
                    {exportFile ? (
                      <>
                        <button
                          className="btn"
                          title="打开导出的文件夹"
                          onClick={() => void window.aijian?.revealFilmPath?.(exportFile)}
                        >
                          打开文件夹
                        </button>
                        <button
                          className="btn"
                          title="播放导出的文件"
                          onClick={() => void window.aijian?.openFilmPath?.(exportFile)}
                        >
                          播放
                        </button>
                      </>
                    ) : null}
                    <span className="sp" />
                    {!exportQc ? (
                      <button
                        className="btn primary"
                        disabled={exporting || cleanCopyBusy || exportQcBusy}
                        onClick={() => void startExport()}
                      >
                        检查成片
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Who the chat can talk to. 提示词 and 审片 run from 分镜 → 属性 → 高级 instead of the chat. */
const CHAT_ROLES: { id: Role; label: string }[] = [
  { id: "writer", label: "编剧" },
  { id: "director", label: "导演" },
  { id: "action", label: "动作指导" },
  { id: "performance", label: "表演指导" },
  { id: "art", label: "美术" },
];
const inChat = (role: Role) => CHAT_ROLES.some((item) => item.id === role);
/** The helper each page starts with: 剧本 the writer, 角色与场景 the art director, 分镜 the director. */
const PAGE_ROLE: Partial<Record<Stage, Role>> = {
  script: "writer",
  cast: "art",
  board: "director",
};

/** 4C-U08: what the assistant is looking at: 「第 2 场第 3 个镜头」, or the scene. */
function scopeOf(film: FilmProject, sceneId: string, shot?: FilmShot | null): string {
  const scene = film.scenes.find((item) => item.id === (shot?.sceneId || sceneId));
  if (!scene) return "";
  return shot ? `第 ${scene.no} 场第 ${shot.no} 个镜头` : `第 ${scene.no} 场「${scene.title}」`;
}

/** 4C-U08: what can be named with @: the people, then this scene's shots. */
function mentionsOf(film: FilmProject, shots: readonly FilmShot[]): string[] {
  return [
    ...film.characters.map((person) => `@${person.name}`).filter((name) => name.length > 1),
    ...shots.slice(0, 12).map((item) => `@镜头 ${item.no}`),
  ];
}

/** A shot as one line of a suggestion: who is in it, the picture, its length. */
function shotItem(shot: FilmShot): SuggestionItem {
  return {
    id: shot.id,
    who: shotPerson(shot.characters, shot.picture, []),
    text: shot.picture,
    tail: `${shot.seconds}s`,
  };
}

/** A scene as one line of a suggestion: where it happens, or its title. */
function sceneItem(scene: FilmScene): SuggestionItem {
  return { id: scene.id, text: scene.where || scene.title };
}

function Assistant({
  role,
  onRole,
  pending,
  pendingScenes,
  onApply,
  onApplyScenes,
  chat,
  onChat,
  onSend,
  onQuick,
  showRoles = true,
  onToggleRoles,
  structured = [],
  turns = [],
  card = null,
  onRedoRange,
  onDismiss,
  busy = false,
  onRetry,
  shots,
  currentScenes = [],
  onReject,
  solo = false,
  scope = "",
  mentions = [],
}: {
  role: Role;
  onRole: (role: Role) => void;
  pending: FilmShot[] | null;
  pendingScenes?: FilmScene[] | null;
  onApply: () => void;
  onApplyScenes?: () => void;
  /** 3J-U04: set while the last request failed; shows 「换个问法再问一次」 under that reply. */
  onRetry?: () => void;
  shots: FilmShot[];
  chat: string;
  onChat: (value: string) => void;
  onSend: () => void;
  onQuick?: (label: string) => void;
  showRoles?: boolean;
  onToggleRoles?: () => void;
  structured?: string[];
  turns?: { id: string; role: Role; who: "user" | "agent"; text: string }[];
  card?: RoleCard | null;
  onRedoRange?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
  /** The work's scenes now, so a 分场 suggestion can say what it changes (4A-U11). */
  currentScenes?: FilmScene[];
  /** 「不要」: drop the suggestion; nothing changes. */
  onReject?: () => void;
  /** The assistant is the only thing in the right column: Ctrl+J moves into its input. */
  solo?: boolean;
  /** 4C-U08: what the assistant is looking at, like 「第 2 场第 3 个镜头」. */
  scope?: string;
  /** 4C-U08: what can be named with @ in the message: people, then this scene's shots. */
  mentions?: string[];
}) {
  const [mentioning, setMentioning] = useState(false);
  useDismiss(mentioning, () => setMentioning(false), "[data-mention]");
  const pickId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  // 4A-U11: a suggestion that replaces a list (the director's shots, the writer's scenes) is
  // shown as a change to what is there now; a card about one shot keeps its own rows.
  const listScenes =
    card?.mode === "scenes"
      ? (card.scenes ?? null)
      : card || role !== "writer"
        ? null
        : (pendingScenes ?? null);
  const listShots =
    card?.mode === "shots" && role === "director" ? (card.shots ?? null) : card ? null : pending;
  // 4A-U11: Ctrl+J opens and closes the assistant; here that means its input.
  useAssistantKey(() => {
    const box = input.current;
    if (!box) return;
    if (document.activeElement === box) box.blur();
    else box.focus();
  }, solo);
  const talking = CHAT_ROLES.find((item) => item.id === role) ?? CHAT_ROLES[1]!;
  const chatTurns = turns.filter((item) => inChat(item.role));
  const lastRole = turns.at(-1)?.role;
  const chips =
    role === "writer"
      ? ["让编剧分场", "改成短剧"]
      : role === "action"
        ? ["请动作指导看看"]
        : role === "performance"
          ? ["请表演指导看看"]
          : role === "art"
            ? ["请美术定画风"]
            : ["节奏再快些", "加一个特写", "请动作指导看看"];
  return (
    <>
      <div className="role-pick">
        {showRoles || !onToggleRoles ? (
          <>
            <label htmlFor={pickId}>正在和：</label>
            <select
              id={pickId}
              className="input"
              value={talking.id}
              title={ROLE_COPY[talking.id]}
              onChange={(event) => onRole(event.target.value as Role)}
            >
              {CHAT_ROLES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span title={ROLE_COPY[talking.id]}>正在和：{talking.label}</span>
            <button className="btn sm" type="button" onClick={onToggleRoles}>
              换一位
            </button>
          </>
        )}
      </div>
      <div className="pb chat">
        {/* 4A-U11: the opening note is gray text, not a bubble the person seems to have sent. */}
        {chatTurns.length === 0 ? (
          <p className="chat-hint">跟这位助手说说你的想法。放进去之前不会改你写过的字。</p>
        ) : (
          chatTurns.slice(-8).map((item) => (
            <div key={item.id} className={item.who === "user" ? "msg-u" : "msg-a"}>
              {item.text}
            </div>
          ))
        )}
        {onRetry && chatTurns.at(-1)?.who === "agent" ? (
          <div className="msg-retry">
            <button className="btn sm" type="button" onClick={onRetry}>
              换个问法再问一次
            </button>
          </div>
        ) : null}
        {card?.mode === "art" && card.fieldRows !== undefined ? (
          <>
            <p className="role-desc">
              改画风会把已有镜头标为需要重做，原有素材会保留，不会自动重新生成。
            </p>
            <SuggestionCard
              unit="shot"
              current={[]}
              proposed={[]}
              fieldRows={card.fieldRows}
              applied={card.applied}
              busy={busy}
              onApply={onApply}
              onAnother={onSend}
              onReject={onReject}
            />
          </>
        ) : listScenes || listShots ? (
          // 4A-U11: 「现在 6 个 → 建议 4 个」, each line marked, and 放进 / 换一个 / 不要.
          <SuggestionCard
            unit={listScenes ? "scene" : "shot"}
            current={
              listScenes
                ? currentScenes.map(sceneItem)
                : shots
                    .filter((item) =>
                      (listShots ?? []).some((next) => next.sceneId === item.sceneId),
                    )
                    .map(shotItem)
            }
            proposed={listScenes ? listScenes.map(sceneItem) : (listShots ?? []).map(shotItem)}
            applied={card?.applied}
            busy={busy}
            onApply={listScenes && onApplyScenes ? onApplyScenes : onApply}
            onAnother={onSend}
            onReject={onReject}
          />
        ) : card ? (
          <div className="msg-a">
            <span className="ri">
              <Ic name="clap" size={13} />
            </span>
            <div className="bubble">
              <div className="h">
                {card.title} <span>{card.rows.length || card.notes.length} 条</span>
              </div>
              {role === "action" ? <p className="role-desc">{DIFFICULTY_LEGEND}</p> : null}
              <div className="shotlist">
                {card.rows.map((item) => (
                  <div key={item.id}>
                    <span>{item.mark}</span>
                    <span />
                    <span>{item.text}</span>
                    <span>{item.tail}</span>
                  </div>
                ))}
              </div>
              <div className="acts">
                {card.mode === "qc" ? (
                  <>
                    <button className="btn accent sm" type="button" onClick={onRedoRange}>
                      按意见重做这一镜
                    </button>
                    <button
                      className="btn sm"
                      type="button"
                      disabled={card.applied}
                      onClick={onDismiss}
                    >
                      {card.applied ? "已记下" : "知道了"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn accent sm"
                      type="button"
                      disabled={card.applied}
                      onClick={card.mode === "scenes" && onApplyScenes ? onApplyScenes : onApply}
                    >
                      {card.applied ? "已放进去" : card.mode === "scenes" ? "放进剧本" : "放进分镜"}
                    </button>
                    {card.applied ? null : (
                      <>
                        <button className="btn sm" type="button" disabled={busy} onClick={onSend}>
                          换一个
                        </button>
                        {onReject ? (
                          <button className="btn ghost sm" type="button" onClick={onReject}>
                            不要
                          </button>
                        ) : null}
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ) : busy ? (
          <p className="chat-hint">正在写…</p>
        ) : null}
        {structured.length > 0 && (!lastRole || inChat(lastRole)) && (
          <div className="msg-a">
            <div className="bubble">
              <div className="shotlist">
                {structured.map((line) => (
                  <div key={line}>
                    <span />
                    <span />
                    <span>{line}</span>
                    <span />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="quick">
        {chips.map((label) => (
          <button key={label} type="button" onClick={() => onQuick?.(label)}>
            {label}
          </button>
        ))}
      </div>
      {scope || mentions.length > 0 ? (
        <div className="chat-context">
          {scope ? <span className="chat-scope">正在看：{scope}</span> : null}
          <span className="sp" />
          {mentions.length > 0 ? (
            <span className="mention-wrap" data-mention>
              <button
                className="btn sm"
                type="button"
                aria-label="提到人物、场景或镜头"
                title="提到人物、场景或镜头（@）"
                aria-expanded={mentioning}
                onClick={() => setMentioning((open) => !open)}
              >
                @
              </button>
              {mentioning ? (
                <div className="menu mention-menu" role="menu" aria-label="提到谁">
                  {mentions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const gap = chat && !/\s$/.test(chat) ? " " : "";
                        onChat(`${chat}${gap}${item} `);
                        setMentioning(false);
                        input.current?.focus();
                      }}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="composer">
        <textarea
          ref={input}
          className="ph-t"
          aria-label="跟助手说"
          value={chat}
          placeholder={`跟${talking.label}说说你的想法… 回车发送，换行用 Shift+回车`}
          onChange={(event) => onChat(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            onSend();
          }}
        />
        <button className="send" aria-label="发送" type="button" onClick={onSend}>
          <Ic name="send" size={15} />
        </button>
      </div>
    </>
  );
}

/**
 * 4B-U04: the cover as the work keeps it (`cover`, GPT's C6 shape), or what it starts from: the
 * work's name, the episode, a still behind it, and the 「AI 生成」 mark on.
 */
function coverOf(
  film: FilmProject,
  start: { title: string; subtitle?: string; backgroundUrl?: string } | null,
  aiMarkByDefault = true,
): CoverInput {
  const kept = (film as FilmProject & { cover?: Partial<CoverInput> }).cover;
  return {
    title: kept?.title ?? start?.title ?? "",
    subtitle: kept?.subtitle ?? start?.subtitle ?? "",
    aiMark: kept?.aiMark ?? aiMarkByDefault,
    backgroundUrl: kept?.backgroundUrl || start?.backgroundUrl || "",
  };
}

/** The export summary in one line: 「共 3 场 · 28 个镜头 · 约 2 分钟 · 还有 27 个镜头没做好」. */
function exportLine(film: FilmProject): string {
  const seconds = film.shots.reduce((sum, item) => sum + item.seconds, 0);
  const length = seconds >= 90 ? `约 ${Math.round(seconds / 60)} 分钟` : `约 ${seconds} 秒`;
  const missing = chosenExport(film).missing.length;
  const gap = missing === 0 ? "都做好了" : `还有 ${missing} 个镜头没做好`;
  return `共 ${film.scenes.length} 场 · ${film.shots.length} 个镜头 · ${length} · ${gap}`;
}

/**
 * The shots the export would leave out, scene by scene: 「第 1 场 雨夜旧书店」 and
 * 「第 1、2、3 个镜头」. Each shot goes through chosenExport, so the rule is the export's own.
 */
function missingByScene(film: FilmProject): { id: string; scene: string; shots: string }[] {
  return film.scenes.flatMap((scene) => {
    const numbers = film.shots
      .filter((item) => item.sceneId === scene.id)
      .filter((item) => chosenExport({ ...film, shots: [item] }).missing.length > 0)
      .map((item) => item.no);
    if (numbers.length === 0) return [];
    return [
      {
        id: scene.id,
        scene: `第 ${scene.no} 场 ${scene.title}`,
        shots: `第 ${numbers.join("、")} 个镜头`,
      },
    ];
  });
}

/** Where the timeline ruler marks fall: every 5 seconds, every 10 past two minutes. */
function rulerTicks(
  shots: readonly FilmShot[],
  clips: readonly { left: number; width: number }[],
  every?: number,
): { seconds: number; left: number }[] {
  const total = shots.reduce((sum, item) => sum + item.seconds, 0);
  const step = every ?? (total > 120 ? 10 : 5);
  const ticks: { seconds: number; left: number }[] = [];
  for (let at = 0; at <= total; at += step) {
    let start = 0;
    let left = 1;
    for (const [index, item] of shots.entries()) {
      const clip = clips[index];
      if (!clip) break;
      if (at <= start + item.seconds || index === shots.length - 1) {
        const part = item.seconds > 0 ? Math.min(1, (at - start) / item.seconds) : 0;
        left = clip.left + part * clip.width;
        break;
      }
      start += item.seconds;
    }
    ticks.push({ seconds: at, left: Math.round(left) });
  }
  return ticks;
}

/** The usual shot lengths; 「自定义」 takes any whole second from 1 to 15. */
const SECONDS_CHOICES = [2, 3, 4, 5, 6, 10];

/** Who last wrote a shot, for the small mark on its card. 属性 holds the details. */
function shotSource(shot: FilmShot): { tone: string; label: string } {
  if (shot.source === "user" || shot.userFields.length > 0) {
    return { tone: "src-user", label: "你改过" };
  }
  if (shot.source === "agent:action") return { tone: "role-a", label: "动作指导写的" };
  if (shot.source === "agent:performance") return { tone: "role-e", label: "表演指导写的" };
  if (shot.source.endsWith("director")) return { tone: "role-d", label: "导演写的" };
  if (shot.source === "template") return { tone: "src-other", label: "来自模板" };
  return { tone: "src-other", label: "原来就有" };
}

/** The spoken lines of a shot as the card shows them, one per row. */
function cardLines(shot: FilmShot): string[] {
  return shot.line
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean);
}

/** The line under a scene's title in the scene lists: 「内景 · 夜 · 10 镜」. */
function sceneMeta(scene: FilmScene, shots: readonly FilmShot[]): string {
  const count = shots.filter((item) => item.sceneId === scene.id).length;
  return [scene.where, count > 0 ? `${count} 镜` : ""].filter(Boolean).join(" · ");
}

function ScriptPage({
  quiet = false,
  onNext,
  onReject,
  film,
  scene,
  onScene,
  onFilm,
  asking,
  onPlan,
  onWrite,
  onAdapt,
  onImport,
  onAction,
  onPerformance,
  onArt,
  onPrompter,
  onQc,
  pending,
  pendingScenes,
  onApply,
  onApplyScenes,
  role,
  onRole,
  chat,
  onChat,
  onSend,
  showRoles,
  onToggleRoles,
  structured,
  turns,
  card,
  onRedoRange,
  onDismiss,
  onOneClick,
  onRetry,
}: {
  film: FilmProject;
  scene: string;
  onScene: (id: string) => void;
  onFilm: (film: FilmProject) => void;
  asking: boolean;
  onPlan: () => void;
  onWrite: () => void;
  onAdapt: () => void;
  onImport: () => void;
  onAction: () => void;
  onPerformance: () => void;
  onArt: () => void;
  onPrompter: () => void;
  onQc: () => void;
  pending: FilmShot[] | null;
  pendingScenes: FilmScene[] | null;
  onApply: () => void;
  onApplyScenes: () => void;
  role: Role;
  onRole: (role: Role) => void;
  chat: string;
  onChat: (value: string) => void;
  onSend: () => void;
  showRoles: boolean;
  onToggleRoles: () => void;
  structured: string[];
  turns: { id: string; role: Role; who: "user" | "agent"; text: string }[];
  /** 3J-U04: retry for the reply that just failed; the button sits under that reply. */
  onRetry?: () => void;
  card: RoleCard | null;
  onRedoRange: () => void;
  onDismiss: () => void;
  onOneClick: () => void;
  /** 4A-U09: 导出成片 is this screen's primary button, so this page's steps back. */
  quiet?: boolean;
  /** 「下一步：角色与场景」, the primary button once the director has gone through every scene. */
  onNext?: () => void;
  /** 4A-U11: 「不要」 on the assistant's suggestion. */
  onReject?: () => void;
}) {
  const current = film.scenes.find((item) => item.id === scene) ?? film.scenes[0];
  const words = film.scenes.reduce((sum, item) => sum + item.text.length, 0);
  const done = stageProgress(film).script && Boolean(onNext);
  return (
    <>
      <section className="pane">
        <div className="ph">
          <h3>场次</h3>
          <span className="meta">{film.scenes.length} 场</span>
          <span className="sp" />
          <button
            className="icon-btn sm"
            aria-label="加一场"
            onClick={() => {
              const id = `scene-${film.scenes.length + 1}`;
              onFilm({
                ...film,
                scenes: [
                  ...film.scenes,
                  {
                    id,
                    no: film.scenes.length + 1,
                    title: sceneDisplayTitle(""),
                    where: "",
                    text: "",
                    ambience: "",
                    source: "user",
                    userFields: ["text"],
                  },
                ],
              });
              onScene(id);
            }}
          >
            <Ic name="plus" size={15} />
          </button>
        </div>
        <div className="pb scenes">
          {film.scenes.map((item) => (
            <button
              key={item.id}
              className={item.id === scene ? "scene on" : "scene"}
              onClick={() => onScene(item.id)}
            >
              <span className="no">{String(item.no).padStart(2, "0")}</span>
              <span className="t">
                {item.title}
                <small>{sceneMeta(item, film.shots)}</small>
              </span>
            </button>
          ))}
        </div>
        <div className="pfoot">
          <span>
            {film.shots.length > 0 ? (
              <>
                全片约 <b>{film.shots.reduce((sum, item) => sum + item.seconds, 0)} 秒</b>
              </>
            ) : (
              "拆成镜头以后才知道多长"
            )}
          </span>
          <span>
            <b>{words}</b> 字
          </span>
        </div>
      </section>
      <section className="pane">
        <div className="tool">
          <h3>{current ? `${current.no}. ${current.title}` : "这一场"}</h3>
          <span className="vsep" />
          <span className="tool-hint">左边选一场，这里写这一场</span>
          <span className="sp" />
          <button
            className={quiet || done ? "btn" : "btn primary"}
            onClick={onPlan}
            disabled={asking}
          >
            <Ic name="clap" size={15} />
            {asking ? "正在写" : "让导演拆镜头"}
          </button>
          <button
            className="btn"
            type="button"
            onClick={onOneClick}
            disabled={asking}
            title="会在分镜后停下，等你确认"
          >
            {asking ? "正在做" : "一键成片"}
          </button>
          {done ? (
            <button className={quiet ? "btn" : "btn primary"} type="button" onClick={onNext}>
              下一步：角色与场景
            </button>
          ) : (
            <span className="tool-hint">会在分镜后停下，等你确认</span>
          )}
        </div>
        <div className="pb doc">
          <div className="page">
            {/* 4A-U11: with no script yet, 导入小说 sits here instead of in the assistant. */}
            {words === 0 ? (
              <div className="script-empty">
                <span>还没有剧本。直接在下面写，或者</span>
                <button className="btn sm" type="button" onClick={onImport}>
                  导入小说
                </button>
              </div>
            ) : null}
            {current?.where ? <div className="sh">{current.where}</div> : null}
            <textarea
              id="scene-text"
              className="area"
              aria-label="这一场"
              value={current?.text ?? ""}
              onChange={(event) => {
                if (!current) return;
                onFilm({
                  ...film,
                  scenes: film.scenes.map((item) =>
                    item.id === current.id
                      ? {
                          ...item,
                          text: event.target.value,
                          source: "user",
                          userFields: [...new Set([...item.userFields, "text"])],
                        }
                      : item,
                  ),
                });
              }}
            />
          </div>
        </div>
      </section>
      <section className="pane ai">
        {/* 4A-U11: the assistant sits in the same right-column tab on every page; 剧本 has no
            属性, so it is the only tab. */}
        <div className="ptabs">
          <span className="tab-only">AI 助手</span>
        </div>
        <Assistant
          solo
          scope={current ? scopeOf(film, current.id) : ""}
          mentions={mentionsOf(
            film,
            film.shots.filter((item) => item.sceneId === current?.id),
          )}
          currentScenes={film.scenes}
          onReject={onReject}
          role={role}
          onRole={onRole}
          pending={pending}
          pendingScenes={pendingScenes}
          onApply={onApply}
          onApplyScenes={onApplyScenes}
          shots={film.shots}
          chat={chat}
          onChat={onChat}
          onSend={onSend}
          onQuick={(label) => {
            if (label === "让编剧分场" || label === "节奏再快些") onWrite();
            else if (label === "改成短剧" || label === "加一个特写") onAdapt();
            else if (label === "导入小说") onImport();
            else if (label.includes("动作")) {
              onRole("action");
              onAction();
            } else if (label.includes("表演")) {
              onRole("performance");
              onPerformance();
            } else if (label.includes("美术")) {
              onRole("art");
              onArt();
            } else if (label.includes("提示词")) onPrompter();
            else if (label.includes("审片")) onQc();
            else onSend();
          }}
          showRoles={showRoles}
          onToggleRoles={onToggleRoles}
          structured={structured}
          turns={turns}
          card={card}
          onRetry={onRetry}
          onRedoRange={onRedoRange}
          onDismiss={onDismiss}
          busy={asking}
        />
        {film.sourceText ? (
          <details className="role-desc">
            <summary>原文</summary>
            <p>{film.sourceText.slice(0, 4000)}</p>
          </details>
        ) : null}
      </section>
    </>
  );
}

function CastPage({
  quiet = false,
  onNext,
  film,
  onFilm,
  role,
  onRole,
  onPortraits,
  onTraits,
  onAllPortraits,
  portraits,
  portraitBusy,
  voices,
  onPreview,
  hearing,
  chat,
  onChat,
  onSend,
  card,
  turns,
  busy: assistantBusy,
  onApply,
  onReject,
  onQuick,
}: {
  film: FilmProject;
  onFilm: (film: FilmProject) => void;
  role: Role;
  onRole: (role: Role) => void;
  onPortraits: (id: string) => Promise<void>;
  /** 3J-U05: gender or age changed; GPT keeps the data and picks the voice again (C8). */
  onTraits: (id: string, traits: { gender: Gender; ageBand: AgeBand }) => void;
  portraitBusy: boolean;
  /** 3J-U06: one queue for every missing angle of these people (GPT makeAllPortraits). */
  onAllPortraits: (characterIds: string[]) => void;
  /** 3J-U06: the run in progress and each slot's state, from the task feed. */
  portraits: PortraitFeed;
  voices: { id: string; label: string }[];
  onPreview: (voiceId: string, line: string) => void;
  hearing: boolean;
  chat: string;
  onChat: (value: string) => void;
  onSend: () => void;
  card: RoleCard | null;
  turns: Parameters<typeof Assistant>[0]["turns"];
  busy: boolean;
  onApply: () => void;
  onReject: () => void;
  onQuick: (label: string) => void;
  /** 4A-U09: 导出成片 is this screen's primary button, so this page's steps back. */
  quiet?: boolean;
  /** 「下一步：分镜」, the primary button once everyone has an appearance and four portraits. */
  onNext?: () => void;
}) {
  const [who, setWho] = useState(0);
  const [place, setPlace] = useState(0);
  const [side, setSide] = useState<"people" | "places" | "props">("people");
  // 5-3-14: with more than ten people, a search box above the list narrows it by name.
  const [castQuery, setCastQuery] = useState("");
  const castSearch = film.characters.length > 10;
  const castNeedle = castSearch ? castQuery.trim().toLowerCase() : "";
  const character = film.characters[who];
  // 3JR-U03: the 场景 tab edits the place picked on the left, not the person picked before.
  // referenceImage, layout and sceneId come with GPT's 4A-B10 / 3JR-B08; until then they are
  // simply absent and the form says the picture is made before the shots.
  const location = film.locations[place] as
    | (FilmProject["locations"][number] & {
        referenceImage?: string;
        layout?: string;
        sceneId?: string;
        userFields?: string[];
      })
    | undefined;
  const editLocation = (
    patch: { name?: string; prompt?: string; layout?: string; ambience?: string },
    field: string,
  ) =>
    onFilm({
      ...film,
      locations: film.locations.map((item, index) =>
        index === place
          ? {
              ...item,
              ...patch,
              userFields: [
                ...new Set([...((item as { userFields?: string[] }).userFields ?? []), field]),
              ],
            }
          : item,
      ) as FilmProject["locations"],
    });
  const usedIn = location
    ? film.scenes.filter(
        (scene) =>
          scene.id === location.sceneId ||
          (location.name.trim() !== "" &&
            (scene.where === location.name || scene.title.includes(location.name))),
      )
    : [];
  // 4A-U02: shots made before the style changed, as GPT marks them (kept in project.json).
  const restyle = film.shots.filter(needsRestyle).length;
  const VIEWS = ["正面", "侧面", "背面", "脸部"];
  const has = (person: (typeof film.characters)[number], view: string) =>
    person.portraits.some((portrait) => portrait.view === view && portrait.url);
  const ready = film.characters.filter((person) => person.identity.trim());
  const noLook = film.characters.filter((person) => !person.identity.trim());
  const missing = ready.reduce(
    (sum, person) => sum + VIEWS.filter((view) => !has(person, view)).length,
    0,
  );
  const batch = portraits.batch;
  const busy = portraitBusy || Boolean(batch?.running);
  const progress = batch
    ? `${batch.done + batch.failed}/${batch.total}${batch.failed ? ` · 失败 ${batch.failed}` : ""}`
    : "";
  const voiceGroup = voiceGroups(
    voices,
    character?.gender ?? "",
    character?.ageBand ?? "",
    character?.voiceId,
  );
  return (
    <>
      <section className="pane">
        <div className="ph">
          <div className="seg">
            <button className={side === "people" ? "on" : ""} onClick={() => setSide("people")}>
              角色
            </button>
            <button
              className={side === "places" ? "on" : ""}
              onClick={() => {
                setSide("places");
                onFilm(ensureLocations(film));
              }}
            >
              场景
            </button>
            <button className={side === "props" ? "on" : ""} onClick={() => setSide("props")}>
              道具
            </button>
          </div>
        </div>
        <div className="pb scenes">
          {side === "places" &&
            film.locations.map((item, index) => (
              <button
                key={item.id}
                className={index === place ? "scene place on" : "scene place"}
                title={item.name}
                onClick={() => setPlace(index)}
              >
                <span className="t">
                  {item.name}
                  <small>
                    {(item as { referenceImage?: string }).referenceImage
                      ? "有参考图"
                      : "还没有参考图"}
                  </small>
                </span>
              </button>
            ))}
          {side === "props" &&
            film.props.map((item) => (
              <div key={item.id} className="scene place" title={item.name}>
                <span className="t">
                  {item.name}
                  <small>{item.note || "道具"}</small>
                </span>
              </div>
            ))}
          {side === "props" && film.props.length === 0 && (
            <p className="role-desc">还没有道具。让美术写，或在下面加上名字。</p>
          )}
          {side === "props" && (
            <div className="field">
              <label htmlFor="prop-name">道具名字</label>
              <input
                id="prop-name"
                className="input"
                aria-label="道具名字"
                placeholder="写下道具名字，按回车加上"
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                  const name = event.currentTarget.value.trim();
                  if (!name) return;
                  onFilm({
                    ...film,
                    props: [...film.props, { id: `prop-${film.props.length + 1}`, name, note: "" }],
                  });
                  event.currentTarget.value = "";
                }}
              />
            </div>
          )}
          {side === "people" && film.characters.length > 0 && (
            <div className="portrait-all">
              {stageProgress(film).cast && onNext ? (
                <button
                  className={quiet ? "btn sm" : "btn primary sm"}
                  type="button"
                  onClick={onNext}
                >
                  下一步：分镜
                </button>
              ) : (
                <button
                  className={quiet ? "btn sm" : "btn primary sm"}
                  type="button"
                  disabled={busy || missing === 0}
                  onClick={() => onAllPortraits(ready.map((person) => person.id))}
                >
                  {busy ? "正在出定妆照" : "给所有人出定妆照"}
                </button>
              )}
              <span className="portrait-progress" title="这一轮出好的张数 / 要出的张数">
                {batch?.running
                  ? progress
                  : missing === 0 && noLook.length === 0
                    ? "都齐了"
                    : batch
                      ? `上一轮 ${progress}`
                      : `还缺 ${missing} 张`}
              </span>
              {noLook.length > 0 && (
                <p className="portrait-skip" title={noLook.map((person) => person.name).join("、")}>
                  还没写外貌，先跳过：{noLook.map((person) => person.name).join("、")}
                </p>
              )}
            </div>
          )}
          {side === "people" && castSearch ? (
            <input
              className="input cast-search"
              type="search"
              aria-label="找人物"
              placeholder={`找人物（共 ${film.characters.length} 个）`}
              value={castQuery}
              onChange={(event) => setCastQuery(event.target.value)}
            />
          ) : null}
          {side === "people" &&
          castNeedle &&
          !film.characters.some((item) => item.name.toLowerCase().includes(castNeedle)) ? (
            <p className="role-desc">没有名字里带「{castQuery.trim()}」的人物。</p>
          ) : null}
          {side === "people" &&
            film.characters.map((item, index) =>
              castNeedle && !item.name.toLowerCase().includes(castNeedle) ? null : (
                <button
                  key={item.id}
                  className={index === who ? "scene on" : "scene"}
                  onClick={() => setWho(index)}
                >
                  <span className="no">{String(index + 1).padStart(2, "0")}</span>
                  <span className="t">
                    {item.name}
                    <small>
                      {VIEWS.every((view) => has(item, view))
                        ? "定妆照齐了"
                        : `定妆照 ${VIEWS.filter((view) => has(item, view)).length}/4`}
                    </small>
                  </span>
                </button>
              ),
            )}
          {film.characters.length === 0 && (
            <p className="role-desc">
              {film.scenes.some((item) => item.text.trim())
                ? "这一场还没有认出人物和场景。"
                : "还没有人物。写下名字，生成时会写进每一镜。"}
            </p>
          )}
        </div>
      </section>
      <section className="pane">
        <div className="ph">
          <h3>
            {side === "places"
              ? location?.name || "场景"
              : side === "props"
                ? "道具"
                : (character?.name ?? "人物")}
          </h3>
          <span className="meta">
            {side === "places"
              ? "同一个地方，前后镜头的背景对得上"
              : side === "props"
                ? "镜头里反复出现的东西"
                : "同一张脸，同一套衣服"}
          </span>
        </div>
        <div className="pb sheet cast-sheet">
          <section className="style-card" aria-label="整部作品的画风">
            <div className="style-head">
              <span className="sec-t">整部作品的画风</span>
              <select
                id="style-preset"
                className="input"
                aria-label="画风"
                value={film.stylePreset}
                onChange={(event) => {
                  const preset =
                    STYLE_PRESETS.find((item) => item.name === event.target.value) ??
                    STYLE_PRESETS[0]!;
                  onFilm({ ...film, stylePreset: preset.name, styleZh: preset.zh });
                }}
              >
                {STYLE_PRESETS.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              <span className="meta">每张图、每段视频都按这段来</span>
            </div>
            <textarea
              className="area style-text"
              aria-label="画风说明"
              rows={2}
              value={film.styleZh}
              placeholder="还没有画风说明。选一个画风，或者请右边的美术写。"
              onChange={(event) => onFilm({ ...film, styleZh: event.target.value })}
            />
            {restyle > 0 ? (
              <p className="style-warn">
                已有 {restyle} 个镜头是按原来的画风做的，要重新生成才会变。
              </p>
            ) : null}
            {/* 4C-U07: the narration is the whole work's, next to its style, not one person's. */}
            <div className="style-row">
              <label htmlFor="narration-voice" className="sec-t">
                整部作品的旁白
              </label>
              <select
                id="narration-voice"
                className="input"
                aria-label="旁白声音"
                value={film.narrationVoiceId}
                onChange={(event) => onFilm({ ...film, narrationVoiceId: event.target.value })}
              >
                <option value="">还没有选旁白</option>
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
                {film.narrationVoiceId &&
                !voices.some((voice) => voice.id === film.narrationVoiceId) ? (
                  <option value={film.narrationVoiceId}>{voiceLabel(film.narrationVoiceId)}</option>
                ) : null}
              </select>
              <button
                className="btn sm"
                type="button"
                aria-label="试听旁白"
                onClick={() =>
                  onPreview(
                    film.narrationVoiceId,
                    film.shots.find((item) => item.line.trim())?.line ?? "",
                  )
                }
              >
                {hearing ? "停止" : "试听旁白"}
              </button>
            </div>
          </section>
          {side === "places" ? (
            location ? (
              <>
                <div className="cast-info">
                  <div className="field" style={{ padding: 0 }}>
                    <label htmlFor="place-name">名字</label>
                    <input
                      id="place-name"
                      className="input"
                      aria-label="场景名字"
                      value={location.name}
                      onChange={(event) => editLocation({ name: event.target.value }, "name")}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="place-look">这个地方的样子</label>
                    <textarea
                      id="place-look"
                      className="area"
                      aria-label="场景的样子"
                      rows={4}
                      value={location.prompt}
                      placeholder="比如：老城区的旧书店，木书架顶到天花板，门口挂着风铃。"
                      onChange={(event) => editLocation({ prompt: event.target.value }, "prompt")}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="place-layout">里面怎么摆</label>
                    <textarea
                      id="place-layout"
                      className="area"
                      aria-label="场景里怎么摆"
                      rows={2}
                      value={location.layout ?? ""}
                      placeholder="门在哪、窗在哪、人一般站在哪。写清楚了，前后镜头不会乱。"
                      onChange={(event) => editLocation({ layout: event.target.value }, "layout")}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="place-ambience">环境音</label>
                    <textarea
                      id="place-ambience"
                      className="area"
                      aria-label="环境音"
                      rows={2}
                      value={location.ambience}
                      placeholder="比如：雨打在玻璃上，远处有车开过。"
                      onChange={(event) =>
                        editLocation({ ambience: event.target.value }, "ambience")
                      }
                    />
                  </div>
                  {usedIn.length > 0 ? (
                    <p className="place-used">
                      用在：{usedIn.map((scene) => `第 ${scene.no} 场 ${scene.title}`).join("、")}
                    </p>
                  ) : null}
                </div>
                <div className="cast-looks">
                  <div className="looks-head">
                    <span className="sec-t">参考图</span>
                  </div>
                  <figure
                    className="slot place-ref"
                    data-state={location.referenceImage ? "done" : "empty"}
                  >
                    {location.referenceImage ? (
                      <Thumb src={location.referenceImage} />
                    ) : (
                      <div className="slot-empty" aria-label="参考图还没有">
                        还没有参考图
                      </div>
                    )}
                  </figure>
                  <p className="slots-note">
                    {location.referenceImage
                      ? "这一场的镜头出画面时，用这张图对齐背景。"
                      : "出这一场的镜头画面时，会先按左边写的样子做一张没有人物的参考图，前后镜头的背景就能对上。"}
                  </p>
                </div>
              </>
            ) : (
              <div className="cast-info">
                <p className="role-desc">还没有场景。剧本拆成场次以后，这里会按地点列出来。</p>
              </div>
            )
          ) : side === "props" ? (
            <div className="cast-info props-sheet">
              {film.props.length === 0 ? (
                <p className="role-desc">还没有道具。在左边加上名字，或者请右边的美术写。</p>
              ) : (
                film.props.map((item, index) => (
                  <div className="prop-row" key={item.id}>
                    <input
                      className="input"
                      aria-label={`第 ${index + 1} 个道具的名字`}
                      value={item.name}
                      onChange={(event) =>
                        onFilm({
                          ...film,
                          props: film.props.map((row) =>
                            row.id === item.id ? { ...row, name: event.target.value } : row,
                          ),
                        })
                      }
                    />
                    <input
                      className="input"
                      aria-label={`${item.name || "这个道具"}的说明`}
                      placeholder="谁的、长什么样"
                      value={item.note}
                      onChange={(event) =>
                        onFilm({
                          ...film,
                          props: film.props.map((row) =>
                            row.id === item.id ? { ...row, note: event.target.value } : row,
                          ),
                        })
                      }
                    />
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <div className="cast-info">
                <div className="cast-id-row">
                  <div className="field" style={{ padding: 0 }}>
                    <label htmlFor="cast-name">名字</label>
                    <input
                      id="cast-name"
                      className="input"
                      aria-label="人物名字"
                      value={character?.name ?? ""}
                      onChange={(event) => {
                        const name = event.target.value;
                        if (!character) {
                          onFilm({
                            ...film,
                            characters: [
                              {
                                id: "char-1",
                                name,
                                identity: name,
                                voiceId: "leo",
                                source: "user",
                                userFields: ["name"],
                                portraits: [],
                              },
                            ],
                          });
                          return;
                        }
                        onFilm({
                          ...film,
                          characters: film.characters.map((item) =>
                            item.id === character.id
                              ? {
                                  ...item,
                                  name,
                                  source: "user",
                                  userFields: [...new Set([...item.userFields, "name"])],
                                }
                              : item,
                          ),
                          shots: film.shots.map((item) => ({
                            ...item,
                            characters: item.characters.map((person) =>
                              person === character.name ? name : person,
                            ),
                          })),
                        });
                      }}
                    />
                  </div>
                  <div className="field" style={{ padding: 0 }}>
                    <label htmlFor="cast-gender">性别</label>
                    <select
                      id="cast-gender"
                      className="input"
                      aria-label="性别"
                      disabled={!character}
                      value={character?.gender ?? ""}
                      onChange={(event) => {
                        if (!character) return;
                        onTraits(character.id, {
                          gender: event.target.value as Gender,
                          ageBand: character.ageBand ?? "",
                        });
                      }}
                    >
                      <option value="">未写</option>
                      {GENDERS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ padding: 0 }}>
                    <label htmlFor="cast-age">年龄段</label>
                    <select
                      id="cast-age"
                      className="input"
                      aria-label="年龄段"
                      disabled={!character}
                      value={character?.ageBand ?? ""}
                      onChange={(event) => {
                        if (!character) return;
                        onTraits(character.id, {
                          gender: character.gender ?? "",
                          ageBand: event.target.value as AgeBand,
                        });
                      }}
                    >
                      <option value="">未写</option>
                      {AGE_BANDS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="cast-id">外貌</label>
                  <textarea
                    id="cast-id"
                    className="area"
                    aria-label="外貌"
                    rows={4}
                    value={character?.identity ?? ""}
                    onChange={(event) => {
                      if (!character) return;
                      onFilm({
                        ...film,
                        characters: film.characters.map((item) =>
                          item.id === character.id
                            ? {
                                ...item,
                                identity: event.target.value,
                                source: "user",
                                userFields: [...new Set([...item.userFields, "identity"])],
                              }
                            : item,
                        ),
                      });
                    }}
                  />
                </div>
                <div className="sec-t" style={{ marginTop: 12 }}>
                  声音
                </div>
                <p className="role-desc">
                  {character?.voiceId
                    ? `已选：${voiceLabel(character.voiceId)}`
                    : character && !character.gender
                      ? "性别没写，请先选一下，声音会按性别列出。"
                      : "还没有选定声音。"}
                </p>
                {voices.length === 0 ? (
                  <p className="role-desc">登录 Grok 会员后才能看到声音名单。</p>
                ) : (
                  <div className="row2">
                    <select
                      className="input"
                      aria-label="角色声音"
                      value={character?.voiceId ?? ""}
                      onChange={(event) => {
                        if (!character) return;
                        const voiceId = event.target.value;
                        // Picked by hand: GPT keeps it when gender or age change later.
                        onFilm({
                          ...film,
                          characters: film.characters.map((item) =>
                            item.id === character.id
                              ? {
                                  ...item,
                                  voiceId,
                                  userFields: [...new Set([...item.userFields, "voiceId"])],
                                }
                              : item,
                          ),
                        });
                      }}
                    >
                      <option value="">还没有选定</option>
                      {voiceGroup.fitting.length > 0 && (
                        <optgroup
                          label={`适合${character?.ageBand ?? ""}${character?.gender ?? ""}性`}
                        >
                          {voiceGroup.fitting.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {voiceGroup.others.length > 0 && (
                        <optgroup
                          label={character?.gender ? `其他${character.gender}声` : "全部声音"}
                        >
                          {voiceGroup.others.map((voice) => (
                            <option key={voice.id} value={voice.id}>
                              {voice.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button
                      className="btn sm"
                      type="button"
                      aria-label="试听"
                      onClick={() => {
                        if (!character) return;
                        const line =
                          film.shots.find(
                            (item) => item.line.trim() && item.characters.includes(character.name),
                          )?.line ?? "";
                        onPreview(character.voiceId, line);
                      }}
                    >
                      {hearing ? "停止" : "试听"}
                    </button>
                  </div>
                )}
                {voices.length === 0 ? (
                  <button
                    className="btn sm"
                    type="button"
                    aria-label="试听"
                    onClick={() => {
                      if (!character) return;
                      const line =
                        film.shots.find(
                          (item) => item.line.trim() && item.characters.includes(character.name),
                        )?.line ?? "";
                      onPreview(character.voiceId, line);
                    }}
                  >
                    {hearing ? "停止" : "试听"}
                  </button>
                ) : null}
              </div>
              <div className="cast-looks">
                <div className="looks-head">
                  <span className="sec-t">定妆照</span>
                  <span className="sp" />
                  {character && VIEWS.some((view) => !has(character, view)) ? (
                    <button
                      className="btn sm"
                      type="button"
                      disabled={busy}
                      onClick={() => void onPortraits(character.id)}
                    >
                      补齐{character.name}的定妆照（还缺{" "}
                      {VIEWS.filter((view) => !has(character, view)).length} 张）
                    </button>
                  ) : null}
                </div>
                <div className="refs4 slots">
                  {character ? (
                    <p className="slots-note">
                      侧面、背面、脸部按正面这张改出来，脸和衣服跟正面一样。
                    </p>
                  ) : null}
                  {(character
                    ? portraitPrompts(character.name, character.identity, film.styleZh)
                    : []
                  ).map((item) => {
                    const url = character?.portraits.find(
                      (portrait) => portrait.view === item.view && portrait.url,
                    )?.url;
                    const slot = character
                      ? portraits.slots[`${character.id}:${item.view}`]
                      : undefined;
                    // A completed task is not proof this snapshot still has its media.
                    const state = url
                      ? "done"
                      : slot?.state === "done"
                        ? "empty"
                        : (slot?.state ?? "empty");
                    const front = item.view === "正面";
                    return (
                      <figure
                        key={item.view}
                        className={front ? "slot front" : "slot"}
                        data-state={state}
                      >
                        {url ? (
                          <Thumb src={url} />
                        ) : (
                          <div className="slot-empty" aria-label={`${item.view}还没有`}>
                            {item.view}
                          </div>
                        )}
                        <figcaption>
                          {url ? <span>{item.view}</span> : null}
                          {state === "running" && <span className="slot-state">生成中…</span>}
                          {state === "queued" && <span className="slot-state">排队中</span>}
                          {state === "done" && <span className="slot-state done">已完成</span>}
                          {state === "failed" && (
                            <>
                              <span className="slot-state bad" title={slot?.reason || undefined}>
                                失败
                              </span>
                              <button
                                className="link-btn"
                                type="button"
                                disabled={busy}
                                aria-label={`重试${item.view}`}
                                onClick={() => character && void onPortraits(character.id)}
                              >
                                重试
                              </button>
                            </>
                          )}
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
      <section className="pane ai">
        {/* 4A-U11: the same right-column tab as every page; the form in the middle is this
            page's 属性. */}
        <div className="ptabs">
          <span className="tab-only">AI 助手</span>
        </div>
        {/* 5-3-15: it says who or which place is on show, and @ offers the people and places. */}
        <Assistant
          solo
          role={role}
          onRole={onRole}
          pending={null}
          onApply={onApply}
          onReject={onReject}
          onQuick={onQuick}
          card={card}
          turns={turns}
          busy={assistantBusy}
          shots={film.shots}
          chat={chat}
          onChat={onChat}
          onSend={onSend}
          scope={
            side === "people"
              ? (character?.name ?? "")
              : side === "places"
                ? location?.name
                  ? `${location.name}（场景）`
                  : ""
                : "道具"
          }
          mentions={[
            ...film.characters.map((person) => `@${person.name}`),
            ...film.locations.map((item) => `@${item.name}`),
          ].filter((name) => name.length > 1)}
        />
      </section>
    </>
  );
}

/**
 * 4C-U05: one group of a shot's properties. Folded or open as the person left it last time
 * (pro/prefs.ts keeps it), starting from defaultOpen.
 */
function PropGroup({
  id,
  title,
  defaultOpen = false,
  filled = 0,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** 5-3-07: how many fields inside have something in them; a folded title shows 「· 2」. */
  filled?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readGroupOpen(id, defaultOpen));
  const count = !open && filled > 0 ? filled : 0;
  return (
    <details
      className="pgroup"
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === open) return;
        setOpen(next);
        writeGroupOpen(id, next);
      }}
    >
      {/* The number is drawn by CSS, so the title stays the group's name. */}
      <summary
        data-count={count ? `· ${count}` : undefined}
        title={count ? `里面有 ${count} 项填了内容` : undefined}
      >
        {title}
      </summary>
      <div className="pgroup-body">{children}</div>
    </details>
  );
}

/** 4C-U05: 「全部镜头 | 单个镜头」, where 单镜 and 返回分镜 used to be two separate buttons. */
function ShotView({ one, onAll, onOne }: { one: boolean; onAll: () => void; onOne: () => void }) {
  return (
    <div className="seg view-seg" role="group" aria-label="看全部镜头还是一个">
      <button type="button" className={one ? "" : "on"} aria-pressed={!one} onClick={onAll}>
        全部镜头
      </button>
      <button type="button" className={one ? "on" : ""} aria-pressed={one} onClick={onOne}>
        单个镜头
      </button>
    </div>
  );
}

function BoardPage({
  onBatchShots,
  quiet = false,
  onNext,
  onReject,
  film,
  onCleanCopy,
  cleanCopyBusy,
  shots,
  shot,
  onShot,
  onScene,
  onFilm,
  onNotice,
  onGenerate,
  onBatch,
  activeSceneId,
  stills,
  onStills,
  stillProgress,
  onFour,
  fourArmed,
  onPickStill,
  role,
  onRole,
  pending,
  onApply,
  onAction,
  onPerformance,
  onArt,
  onPrompter,
  onQc,
  onTimeLine,
  chat,
  onChat,
  onSend,
  turns,
  assistPulse,
  structured,
  card,
  qcCard = null,
  promptSuggestion = null,
  onRedoRange,
  onDismiss,
  onRetry,
  onFixCoverage,
}: {
  film: FilmProject;
  onCleanCopy: (ids: readonly string[]) => void;
  cleanCopyBusy: boolean;
  shots: FilmShot[];
  shot: number;
  onShot: (index: number) => void;
  onScene: (id: string) => void;
  onFilm: (film: FilmProject) => void;
  onNotice: (text: string) => void;
  onGenerate: () => void;
  onBatch: () => void;
  /** 5-3-06: the confirm table for the cards picked with Shift or Ctrl. */
  onBatchShots?: (shots: FilmShot[]) => void;
  activeSceneId: string;
  stills: string[];
  onStills: () => void;
  onFour: () => void;
  fourArmed: string;
  stillProgress: Record<string, string>;
  onPickStill: (picture: string) => void;
  role: Role;
  onRole: (role: Role) => void;
  pending: FilmShot[] | null;
  onApply: () => void;
  onAction: () => void;
  onPerformance: () => void;
  onArt: () => void;
  onPrompter: () => void;
  onQc: () => void;
  onTimeLine: (shotId: string) => void;
  chat: string;
  onChat: (value: string) => void;
  onSend: () => void;
  turns: { id: string; role: Role; who: "user" | "agent"; text: string }[];
  /** 3J-U04: retry for the reply that just failed; the button sits under that reply. */
  onRetry?: () => void;
  assistPulse: number;
  structured: string[];
  card: RoleCard | null;
  /** The last 审片 answer; it shows under 高级, not in the chat. */
  qcCard?: RoleCard | null;
  promptSuggestion?: ReactNode;
  onRedoRange: () => void;
  onDismiss: () => void;
  /** 3J-U10: 「补上结尾」, GPT fixCoverage (C9). Settles when the director is done. */
  onFixCoverage: (sceneId: string) => Promise<unknown>;
  /** 4A-U09: 导出成片 is this screen's primary button, so 生成这一场 steps back. */
  quiet?: boolean;
  /** 「下一步：剪辑」, once every shot has a video. */
  onNext?: () => void;
  /** 4A-U11: 「不要」 on the assistant's suggestion. */
  onReject?: () => void;
}) {
  const [tab, setTab] = useState<"props" | "ai">("props");
  // 4A-U11: Ctrl+J switches between 属性 and AI 助手.
  useAssistantKey(() => setTab((now) => (now === "ai" ? "props" : "ai")));
  const [customSeconds, setCustomSeconds] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const seenAssist = useRef(assistPulse);
  const lastTurnRole = turns.at(-1)?.role;
  useEffect(() => {
    if (seenAssist.current === assistPulse) return;
    seenAssist.current = assistPulse;
    // 提示词 and 审片 answer under 高级, so their requests keep 属性 open.
    if (!lastTurnRole || inChat(lastTurnRole)) setTab("ai");
  }, [assistPulse, lastTurnRole]);
  const current = shots[shot];
  const seconds = shots.reduce((sum, item) => sum + item.seconds, 0);
  // 3J-U10: what the scene on show still misses (C9) and the actions that fit no shot (C10).
  const sceneKey = `${film.id}:${activeSceneId}`;
  const repair = useCoverageRepair(sceneKey, () => onFixCoverage(activeSceneId));
  const sceneRow = film.scenes.find((item) => item.id === activeSceneId);
  // 3J-U18: 「更多」 closes on Esc, a press outside, choosing an item, or another shot.
  useDismiss(moreOpen, () => setMoreOpen(false), ".more-wrap");
  const shownShotId = current?.id ?? "";
  useEffect(() => setMoreOpen(false), [shownShotId]);
  // 5-3-02: right-click on a card or a scene. The card's menu is the same list as 「更多」.
  const cardMenu = useContextMenu();
  const sceneMenu = useContextMenu();
  const shotMenu: ContextMenuItem[] = current
    ? [
        { label: "前移", onSelect: () => onFilm(moveShot(film, current.id, -1)) },
        { label: "后移", onSelect: () => onFilm(moveShot(film, current.id, 1)) },
        ...(fourArmed !== current.id ? [{ label: "出 4 张候选", onSelect: onFour }] : []),
        ...(shotProgress(current) !== "未生成"
          ? [
              {
                label: "重新生成画面",
                onSelect: onStills,
                disabledReason: stillProgress[current.id] ? "画面正在生成" : undefined,
              },
            ]
          : []),
        {
          label: "删除这一镜",
          danger: true,
          divided: true,
          onSelect: () => {
            onFilm(removeShot(film, current.id));
            onNotice("已删除这一镜，可按 Ctrl+Z 撤销。");
          },
        },
      ]
    : [];
  // GPT's own check, saved on the scene when the director writes it or fixes its end. The page
  // does not run the check again on every edit.
  const coverage = sceneRow?.coverage && !sceneRow.coverage.ok ? sceneRow.coverage : null;
  const shotBudget = sceneRow ? sceneShotBudget(sceneRow.id, film.shots) : null;
  const allBeats = film.unassignedBeats ?? [];
  const sceneBeats = allBeats.filter((beat) => beat.sceneId === sceneRow?.id);
  // 3JR-U04: while an action is dragged the cards show where it can go.
  const [beatDrag, setBeatDrag] = useState(false);
  const [dropAt, setDropAt] = useState(-1);
  // 5-3-05: a card dragged to another place in the scene; a bar shows where it will land.
  const [movingId, setMovingId] = useState("");
  const [moveOver, setMoveOver] = useState(-1);
  // 5-3-06: cards picked with Ctrl (one more or one less) or Shift (a run from the shot on show).
  const [picked, setPicked] = useState<string[]>([]);
  const pickedShots = shots.filter((item) => picked.includes(item.id));
  const multi = pickedShots.length >= 2;
  useEffect(() => setPicked([]), [sceneKey]);
  useEffect(() => {
    if (!multi) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicked([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multi]);
  const movingFrom = movingId ? shots.findIndex((item) => item.id === movingId) : -1;
  const placeBeat = (index: number, target: FilmShot) => {
    const beat = sceneBeats[index];
    if (!beat || target.sceneId !== activeSceneId || beat.sceneId !== activeSceneId) return;
    // GPT's rule decides: a shot with only dialogue never takes a fight action.
    const placed = assignActionBeats(film.shots, beat.sceneId, [
      { text: beat.text, shotId: target.id },
    ]);
    if (placed.unassignedBeats.length > 0) {
      onNotice(
        `镜头 ${target.no} 的画面里没有打斗，放不了这个动作。换一个有打斗的镜头，或者先改这一镜的画面。`,
      );
      return;
    }
    const at = allBeats.indexOf(beat);
    onFilm({
      ...film,
      shots: placed.shots.map((item) =>
        item.id === target.id
          ? { ...item, userFields: [...new Set([...item.userFields, "action"])] }
          : item,
      ),
      unassignedBeats: allBeats.filter((_, position) => position !== at),
    });
    onNotice(`已放到镜头 ${target.no}。`);
  };
  const focused = shots[shot];
  const toolNote = turns
    .filter((item) => (item.role === "prompter" || item.role === "qc") && item.who === "agent")
    .at(-1)?.text;
  const focusedPrompt = focused?.promptZh || (focused ? keyframePrompt(focused, film) : "");
  const missingLocks = focused
    ? missingIdentityLocks(
        [{ id: focused.id, prompt: focusedPrompt, names: focused.characters }],
        film.characters,
      ).map((item) => item.name)
    : [];
  return (
    <>
      <section className="pane">
        <div className="ph">
          <h3>场次</h3>
          <span className="meta">{film.shots.length} 个镜头</span>
          <span className="sp" />
          <button
            className="icon-btn sm"
            aria-label="加一场"
            onClick={() => {
              onFilm(addShot(film, activeSceneId));
              onNotice("已加一个镜头。");
            }}
          >
            <Ic name="plus" size={15} />
          </button>
        </div>
        <div className="pb scenes">
          {film.scenes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === current?.sceneId ? "scene on" : "scene"}
              onClick={() => {
                onScene(item.id);
                onShot(0);
              }}
              onContextMenu={(event) => {
                onScene(item.id);
                onShot(0);
                cardMenu.close();
                sceneMenu.open(event);
              }}
            >
              <span className="no">{String(item.no).padStart(2, "0")}</span>
              <span className="t">
                {item.title}
                <small>{sceneMeta(item, film.shots)}</small>
                {(() => {
                  // 3JR-U04: which scene still has actions to place, seen from any scene.
                  const waiting = allBeats.filter((beat) => beat.sceneId === item.id).length;
                  return waiting > 0 ? (
                    <small className="beat-flag">{waiting} 个动作没对上镜头</small>
                  ) : null;
                })()}
              </span>
            </button>
          ))}
        </div>
        {/* 5-3-02: the scene's menu holds the scene's buttons above the cards. */}
        <ContextMenu
          at={sceneMenu.at}
          label={`${sceneRow?.title ?? "这一场"}的操作`}
          items={
            sceneRow
              ? [
                  {
                    label: "加镜头",
                    onSelect: () => {
                      onFilm(addShot(film, sceneRow.id));
                      onNotice("已加一个镜头。");
                    },
                  },
                  { label: "生成这一场", onSelect: onBatch },
                ]
              : []
          }
          onClose={sceneMenu.close}
        />
        <ContextMenu
          at={cardMenu.at}
          label={`镜头 ${current?.no ?? ""} 的操作`}
          items={shotMenu}
          onClose={cardMenu.close}
        />
        <div className="pfoot stack">
          <span>
            全片：画面 <b>{film.shots.filter((item) => shotProgress(item) !== "未生成").length}</b>/
            {film.shots.length} · 视频{" "}
            <b>{film.shots.filter((item) => shotProgress(item) === "视频已出").length}</b>/
            {film.shots.length}
          </span>
          <span>
            约 <b>{film.shots.reduce((sum, item) => sum + item.seconds, 0)} 秒</b>
          </span>
        </div>
      </section>
      <section className="pane">
        <div className="tool">
          <h3>{sceneRow?.title ?? "镜头"}</h3>
          <span className="meta">
            {shots.length} 个镜头 · {seconds} 秒
          </span>
          <span className="sp" />
          <button
            className="btn"
            onClick={() => {
              onFilm(addShot(film, activeSceneId));
              onNotice("已加一个镜头。");
            }}
          >
            加镜头
          </button>
          {/* 4C-U05: all shots or one shot, the same switch on both views. */}
          <ShotView one={false} onAll={() => undefined} onOne={onGenerate} />
          <button className={quiet ? "btn" : "btn primary"} onClick={onBatch}>
            <Ic name="spark" size={14} />
            生成这一场
          </button>
          {stageProgress(film).board && onNext ? (
            <button className="btn" type="button" onClick={onNext}>
              下一步：剪辑
            </button>
          ) : null}
        </div>
        {sceneRow && (
          <SceneAlerts
            key={sceneKey}
            dragScope={sceneKey}
            repairFailed={repair.failed}
            coverageWarning={
              [
                coverage && !coverage.missingLines.length && !coverage.missingTail
                  ? coverageNotice(coverage).detail
                  : "",
                shotBudget && !shotBudget.ok ? formatShotBudget(shotBudget, film.shots) : "",
              ]
                .filter(Boolean)
                .join("\n") || undefined
            }
            missingTail={coverage?.missingTail ?? null}
            missingLines={coverage?.missingLines ?? []}
            beats={sceneBeats.map((beat) => beat.text)}
            fixing={repair.fixing}
            onFixEnding={coverage ? () => void repair.run() : undefined}
            pickedShot={current ? `镜头 ${current.no}` : ""}
            onPlaceBeat={(index) => current && placeBeat(index, current)}
            onDragChange={(dragging) => {
              setBeatDrag(dragging);
              if (!dragging) setDropAt(-1);
            }}
          />
        )}
        <div className={beatDrag ? "pb grid dropping" : "pb grid"}>
          {shots.map((item, index) => (
            <button
              key={item.id}
              className={[
                "card",
                (multi ? picked.includes(item.id) : index === shot) ? "sel" : "",
                beatDrag && dropAt === index ? "drop-over" : "",
                item.id === movingId ? "moving" : "",
                movingFrom >= 0 && moveOver === index && index !== movingFrom
                  ? index < movingFrom
                    ? "move-before"
                    : "move-after"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  SHOT_DRAG_TYPE,
                  JSON.stringify({ scope: sceneKey, id: item.id }),
                );
                event.dataTransfer.effectAllowed = "move";
                setMovingId(item.id);
              }}
              onDragEnd={() => {
                setMovingId("");
                setMoveOver(-1);
              }}
              // 4C-U05: the card's state is the label on its picture; who wrote it is in here.
              title={`镜头 ${item.no} · ${shotSource(item).label}`}
              aria-pressed={multi ? picked.includes(item.id) : undefined}
              onClick={(event) => {
                if (event.shiftKey) {
                  const from = Math.min(shot, index);
                  const to = Math.max(shot, index);
                  setPicked(shots.slice(from, to + 1).map((other) => other.id));
                  return;
                }
                if (event.ctrlKey || event.metaKey) {
                  setPicked((now) => {
                    const base = now.length > 0 ? now : current ? [current.id] : [];
                    return base.includes(item.id)
                      ? base.filter((id) => id !== item.id)
                      : [...base, item.id];
                  });
                  return;
                }
                setPicked([]);
                onShot(index);
              }}
              onContextMenu={(event) => {
                setPicked([]);
                onShot(index);
                setMoreOpen(false);
                sceneMenu.close();
                cardMenu.open(event);
              }}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(SHOT_DRAG_TYPE)) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (moveOver !== index) setMoveOver(index);
                  return;
                }
                if (!event.dataTransfer.types.includes(BEAT_DRAG_TYPE)) return;
                event.preventDefault();
                if (dropAt !== index) setDropAt(index);
              }}
              onDragLeave={() => {
                if (dropAt === index) setDropAt(-1);
                if (moveOver === index) setMoveOver(-1);
              }}
              onDrop={(event) => {
                const moving = readShotDrag(event.dataTransfer.getData(SHOT_DRAG_TYPE));
                if (moving) {
                  event.preventDefault();
                  setMovingId("");
                  setMoveOver(-1);
                  // Only within the scene on show; a card from another scene or work stays.
                  const from = shots.findIndex((other) => other.id === moving.id);
                  if (moving.scope !== sceneKey || from < 0 || from === index) return;
                  const was = shots[from]!;
                  onFilm(moveShotBy(film, moving.id, index - from));
                  onShot(index);
                  onNotice(movedNotice(was.no, item.no, index < from));
                  return;
                }
                const raw = event.dataTransfer.getData(BEAT_DRAG_TYPE);
                if (!raw) return;
                event.preventDefault();
                setBeatDrag(false);
                setDropAt(-1);
                try {
                  const payload = JSON.parse(raw) as {
                    scope?: string;
                    index?: number;
                    text?: string;
                  };
                  if (payload.scope !== sceneKey || !Number.isInteger(payload.index)) return;
                  const index = payload.index!;
                  if (sceneBeats[index]?.text !== payload.text) return;
                  placeBeat(index, item);
                } catch {
                  // Ignore foreign or outdated drags; never guess which action they refer to.
                }
              }}
            >
              <div style={{ position: "relative" }}>
                <FrameThumb shot={item} />
                <span className={shotProgress(item) === "未生成" ? "badge none" : "badge ok"}>
                  {stillProgress[item.id] ||
                    (shotProgress(item) === "视频已出"
                      ? `版本 ${item.takes.find((take) => take.id === item.selectedTakeId)?.index ?? item.takes.filter((take) => take.status === "done").length}/${item.takes.length}`
                      : shotProgress(item))}
                </span>
                <span className="dur">{item.seconds}s</span>
                {continuityNotes(item).length > 0 ? (
                  <span
                    className="cont-dot"
                    role="img"
                    aria-label={`有 ${continuityNotes(item).length} 条场记提醒`}
                    title={continuityNotes(item)
                      .map((note) => `${note.title}：${note.text}`)
                      .join("\n")}
                  />
                ) : null}
              </div>
              <div className="cb">
                <div className="ct">
                  镜头 {item.no} <span>{item.size}</span>
                  {needsRestyle(item) ? (
                    <span className="restyle" title="画风改过，这一镜要重新生成才会变">
                      画风变了
                    </span>
                  ) : null}
                  {takeBadge(item) ? <span className="ver">{takeBadge(item)}</span> : null}
                  {/* 4B-U07: lip sync on a close shot whose speaker talks on screen. */}
                  {(() => {
                    const lips = lipSyncTag(item);
                    return lips ? (
                      <span className={lips.failed ? "lips failed" : "lips"} title={lips.title}>
                        {lips.text}
                      </span>
                    ) : null;
                  })()}
                </div>
                <p className="pic" title={item.picture}>
                  {item.picture}
                </p>
                {item.line.trim() ? (
                  <p
                    className="line"
                    title={item.line}
                    data-more={cardLines(item).length > 1 ? cardLines(item).length : undefined}
                  >
                    {cardLines(item)[0]}
                  </p>
                ) : null}
                {/* 3JR-U05: resting on the words, or picking the card with the keyboard, shows
                    all of them over the card; the grid does not move. */}
                <div className="full" aria-hidden="true">
                  <div className="ct">
                    镜头 {item.no} <span>{item.size}</span>
                  </div>
                  <p>{item.picture}</p>
                  {cardLines(item).map((text, line) => (
                    <p key={line} className="line">
                      {text}
                    </p>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="pane">
        <div className="ptabs">
          <button
            className={tab === "props" ? "on" : ""}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setTab("props");
            }}
            onClick={() => setTab("props")}
          >
            属性
          </button>
          <button
            className={tab === "ai" ? "on" : ""}
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              setTab("ai");
            }}
            onClick={() => setTab("ai")}
          >
            AI 助手
          </button>
        </div>
        {tab === "ai" ? (
          <Assistant
            role={role}
            onRole={onRole}
            pending={pending}
            onApply={onApply}
            shots={shots}
            chat={chat}
            onChat={onChat}
            onSend={onSend}
            onQuick={(label) => {
              if (label.includes("动作")) {
                onRole("action");
                onAction();
              } else if (label.includes("表演")) {
                onRole("performance");
                onPerformance();
              } else if (label.includes("美术")) {
                onRole("art");
                onArt();
              } else if (label.includes("提示词")) onPrompter();
              else if (label.includes("审片")) onQc();
              else onSend();
            }}
            turns={turns}
            structured={structured}
            card={card}
            onRetry={onRetry}
            onRedoRange={onRedoRange}
            onDismiss={onDismiss}
            onReject={onReject}
            scope={scopeOf(film, activeSceneId, current)}
            mentions={mentionsOf(film, shots)}
          />
        ) : multi ? (
          // 5-3-06: what can be done to every picked shot at once.
          <>
            <div className="shot-h">
              选了 {pickedShots.length} 个镜头{" "}
              <span>共 {pickedShots.reduce((sum, item) => sum + item.seconds, 0)} 秒</span>
            </div>
            <div className="pb multi-pick">
              <p className="multi-list">镜头 {pickedShots.map((item) => item.no).join("、")}</p>
              <div className="field">
                <label>时长都改成（秒）</label>
                <div className="seg" aria-label="时长都改成">
                  {SECONDS_CHOICES.map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      aria-label={`都改成 ${seconds} 秒`}
                      className={pickedShots.every((item) => item.seconds === seconds) ? "on" : ""}
                      onClick={() => {
                        onFilm(
                          pickedShots.reduce(
                            (next, item) =>
                              updateShot(next, item.id, {
                                seconds,
                                userFields: [...new Set([...item.userFields, "seconds"])],
                              }),
                            film,
                          ),
                        );
                        onNotice(`已把 ${pickedShots.length} 个镜头都改成 ${seconds} 秒。`);
                      }}
                    >
                      {seconds}
                    </button>
                  ))}
                </div>
              </div>
              <p className="role-desc">
                按住 Ctrl 点卡片，加一个或去掉一个；按住 Shift 点卡片，选一串。按 Esc 取消。
              </p>
            </div>
            <div className="pfoot2 one">
              <button className="btn" type="button" onClick={() => setPicked([])}>
                取消多选
              </button>
              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  const count = pickedShots.length;
                  onFilm(pickedShots.reduce((next, item) => removeShot(next, item.id), film));
                  setPicked([]);
                  onShot(0);
                  onNotice(`已删除 ${count} 个镜头，可按 Ctrl+Z 撤销。`);
                }}
              >
                {`删除这 ${pickedShots.length} 个`}
              </button>
              {onBatchShots ? (
                <button className="btn" type="button" onClick={() => onBatchShots(pickedShots)}>
                  {pickedShots.every((item) => shotProgress(item) === "未生成")
                    ? `生成这 ${pickedShots.length} 个`
                    : `重新生成这 ${pickedShots.length} 个`}
                </button>
              ) : null}
            </div>
          </>
        ) : current ? (
          <>
            <div className="shot-h">
              镜头 {current.no} <span>{shotProgress(current)}</span>
            </div>
            {continuityNotes(current).length > 0 ? (
              <section className="cont-notes" aria-label="场记提醒">
                <p className="cont-head">场记提醒</p>
                <ul>
                  {continuityNotes(current).map((note, index) => (
                    <li key={`${note.kind}-${index}`}>
                      <b>{note.title}</b>
                      {note.text}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="pb">
              <CleanCopyRepair
                mode="shot"
                count={shotsNeedingCleanCopy(film).includes(current.id) ? 1 : 0}
                busy={cleanCopyBusy}
                onRepair={() => onCleanCopy([current.id])}
              />
              {/* 4C-U05: 画面 open; 声音 and 高级 folded until opened, and each remembers. */}
              <PropGroup id="picture" title="画面" defaultOpen>
                <div className="field">
                  <div className="row3">
                    <div>
                      <label>景别</label>
                      <select
                        className="input"
                        aria-label="景别"
                        value={
                          SHOT_SIZES.includes(current.size as (typeof SHOT_SIZES)[number])
                            ? current.size
                            : classifyShotSize(current.size).size
                        }
                        onChange={(event) =>
                          onFilm(
                            updateShot(film, current.id, {
                              size: event.target.value,
                              userFields: [...new Set([...current.userFields, "size"])],
                            }),
                          )
                        }
                      >
                        {SHOT_SIZES.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>镜头怎么动</label>
                      <select
                        className="input"
                        aria-label="运镜"
                        value={
                          ["固定", "跟拍", "推", "拉", "摇", "慢镜"].includes(current.move)
                            ? current.move
                            : "固定"
                        }
                        onChange={(event) =>
                          onFilm(updateShot(film, current.id, { move: event.target.value }))
                        }
                      >
                        {["固定", "跟拍", "推", "拉", "摇", "慢镜"].map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>角度</label>
                      <div className="input">{current.angle || "平视"}</div>
                    </div>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="shot-seconds">时长（秒）</label>
                  <div className="seg" aria-label="时长">
                    {SECONDS_CHOICES.map((seconds) => (
                      <button
                        key={seconds}
                        type="button"
                        aria-label={`${seconds} 秒`}
                        className={!customSeconds && current.seconds === seconds ? "on" : ""}
                        onClick={() => {
                          setCustomSeconds(false);
                          onFilm(
                            updateShot(film, current.id, {
                              seconds,
                              userFields: [...new Set([...current.userFields, "seconds"])],
                            }),
                          );
                        }}
                      >
                        {seconds}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={
                        customSeconds || !SECONDS_CHOICES.includes(current.seconds) ? "on" : ""
                      }
                      aria-pressed={customSeconds || !SECONDS_CHOICES.includes(current.seconds)}
                      onClick={() => setCustomSeconds(true)}
                    >
                      自定义
                    </button>
                  </div>
                  {customSeconds || !SECONDS_CHOICES.includes(current.seconds) ? (
                    <div className="seconds-box">
                      <input
                        id="shot-seconds"
                        className="input"
                        type="number"
                        min={1}
                        max={15}
                        aria-label="时长秒数"
                        value={current.seconds}
                        onChange={(event) => {
                          const seconds = Number(event.target.value);
                          if (!Number.isFinite(seconds)) return;
                          onFilm(
                            updateShot(film, current.id, {
                              seconds: Math.max(1, Math.min(15, seconds)),
                              userFields: [...new Set([...current.userFields, "seconds"])],
                            }),
                          );
                        }}
                      />
                      <span>秒，1 到 15 秒</span>
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label>画面描述</label>
                  <textarea
                    className="area"
                    rows={3}
                    aria-label="分镜画面"
                    value={current.picture}
                    onChange={(event) =>
                      onFilm(
                        updateShot(film, current.id, {
                          picture: event.target.value,
                          promptZh: "",
                          source: "user",
                          userFields: [...new Set([...current.userFields, "picture"])],
                        }),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>出场角色</label>
                  <div className="tagrow">
                    <span className="tag">
                      {shotPerson(
                        current.characters,
                        current.picture,
                        film.characters.map((person) => person.name),
                      )}
                    </span>
                    {appearanceMark(focusedPrompt, current.characters, film.characters) ? (
                      <span className="tag">
                        {appearanceMark(focusedPrompt, current.characters, film.characters)}
                      </span>
                    ) : null}
                  </div>
                </div>
                {current.stills.some((item) => item.url) && (
                  <div className="shotlist">
                    {current.stills
                      .filter((item) => item.url)
                      .map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          aria-label={`候选画面 ${item.prompt.slice(0, 12)}`}
                          onClick={() => onFilm(updateShot(film, current.id, { poster: item.url }))}
                        >
                          <Thumb src={item.url} />
                        </button>
                      ))}
                  </div>
                )}
                {stills.length > 0 && (
                  <div className="shotlist">
                    {stills.map((item) => (
                      <button key={item} type="button" onClick={() => onPickStill(item)}>
                        {item}
                      </button>
                    ))}
                  </div>
                )}
                {current.tag ? <p className="role-desc">镜头类型：{current.tag}</p> : null}
                {missingLocks.length > 0 && (
                  <p className="role-desc">这一镜的画面说明漏了{missingLocks.join("、")}的外貌。</p>
                )}
              </PropGroup>
              <PropGroup
                id="sound"
                title="声音"
                filled={
                  [
                    current.sound.source === "dub",
                    current.sound.ambience.trim(),
                    current.sound.musicMood.trim(),
                  ].filter(Boolean).length
                }
              >
                <div className="field">
                  <p className="role-desc">台词：{current.line || "这一镜没有台词"}</p>
                  <select
                    className="input"
                    aria-label="声音来源"
                    value={current.sound.source}
                    onChange={(event) =>
                      onFilm(
                        updateShot(film, current.id, {
                          sound: {
                            ...current.sound,
                            source: event.target.value === "dub" ? "dub" : "native",
                          },
                        }),
                      )
                    }
                  >
                    <option value="native">用视频里的声音</option>
                    <option value="dub">另外配音</option>
                  </select>
                  <textarea
                    className="area"
                    aria-label="这一镜的环境音"
                    value={current.sound.ambience}
                    placeholder="环境音"
                    onChange={(event) =>
                      onFilm(
                        updateShot(film, current.id, {
                          sound: { ...current.sound, ambience: event.target.value },
                        }),
                      )
                    }
                  />
                  <input
                    className="input"
                    aria-label="配乐情绪"
                    value={current.sound.musicMood}
                    placeholder="配乐情绪"
                    onChange={(event) =>
                      onFilm(
                        updateShot(film, current.id, {
                          sound: { ...current.sound, musicMood: event.target.value },
                        }),
                      )
                    }
                  />
                  <button className="btn sm" type="button" onClick={() => onTimeLine(current.id)}>
                    按台词定时长
                  </button>
                </div>
              </PropGroup>
              <PropGroup
                id="advanced"
                title="高级"
                filled={
                  [
                    current.styleNote,
                    current.blocking,
                    current.facing,
                    current.action,
                    current.performance,
                  ].filter((text) => text?.trim()).length
                }
              >
                <div className="adv">
                  <label htmlFor="shot-style-note">这一镜的画风</label>
                  <textarea
                    id="shot-style-note"
                    className="area"
                    aria-label="这一镜的画风"
                    placeholder={`不写就用整部作品的画风：${film.stylePreset}`}
                    value={current.styleNote ?? ""}
                    onChange={(event) =>
                      onFilm(updateShot(film, current.id, { styleNote: event.target.value }))
                    }
                  />
                  <p className="role-desc">
                    {current.promptEn || "还没有英文画面说明。可以让「画面说明」助手写。"}
                  </p>
                  <div className="acts">
                    <button className="btn sm" type="button" onClick={onPrompter}>
                      写英文画面说明
                    </button>
                    <button className="btn sm" type="button" onClick={onQc}>
                      审一下这一镜的文字
                    </button>
                  </div>
                  {toolNote ? <p className="role-desc">{toolNote}</p> : null}
                  {promptSuggestion}
                  {qcCard ? (
                    <div className="bubble">
                      <div className="h">{qcCard.title}</div>
                      <div className="shotlist">
                        {qcCard.rows.map((item) => (
                          <div key={item.id}>
                            <span>{item.mark}</span>
                            <span />
                            <span title={item.text}>{item.text}</span>
                            <span />
                          </div>
                        ))}
                      </div>
                      <div className="acts">
                        <button className="btn sm" type="button" onClick={onRedoRange}>
                          按意见重做这一镜
                        </button>
                        <button
                          className="btn sm"
                          type="button"
                          disabled={qcCard.applied}
                          onClick={onDismiss}
                        >
                          {qcCard.applied ? "已记下" : "知道了"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="field">
                  <label htmlFor="shot-blocking">站位</label>
                  <textarea
                    id="shot-blocking"
                    className="area"
                    aria-label="站位"
                    placeholder="谁在画左，谁在画右"
                    value={current.blocking ?? ""}
                    onChange={(event) =>
                      onFilm(updateShot(film, current.id, { blocking: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor="shot-facing">朝向</label>
                  <input
                    id="shot-facing"
                    className="input"
                    aria-label="朝向"
                    placeholder="看向画左或画右"
                    value={current.facing ?? ""}
                    onChange={(event) =>
                      onFilm(updateShot(film, current.id, { facing: event.target.value }))
                    }
                  />
                </div>
                <div className="field">
                  <label>
                    动作要点
                    {current.source === "agent:action" && !current.userFields.includes("action") ? (
                      <span className="from role-a">来自动作指导</span>
                    ) : null}
                  </label>
                  <textarea
                    className="area"
                    aria-label="动作要点"
                    placeholder="没有就留空"
                    value={current.action}
                    onChange={(event) =>
                      onFilm(
                        updateShot(film, current.id, {
                          action: event.target.value,
                          userFields: [...new Set([...current.userFields, "action"])],
                        }),
                      )
                    }
                  />
                </div>
                <div className="field">
                  <label>
                    表演
                    {current.source === "agent:performance" &&
                    !current.userFields.includes("performance") ? (
                      <span className="from role-e">来自表演指导</span>
                    ) : null}
                  </label>
                  <textarea
                    className="area"
                    aria-label="表演"
                    value={current.performance}
                    placeholder="还没有表演提示。"
                    onChange={(event) =>
                      onFilm(
                        updateShot(film, current.id, {
                          performance: event.target.value,
                          userFields: [...new Set([...current.userFields, "performance"])],
                        }),
                      )
                    }
                  />
                </div>
              </PropGroup>
            </div>
            <div className="pfoot2 one">
              <div className="more-wrap">
                <button
                  className="btn"
                  type="button"
                  aria-label="更多操作"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  更多
                </button>
                {moreOpen ? (
                  <div className="menu up" role="menu" aria-label="这一镜的更多操作">
                    {shotMenu.map((item) => (
                      <Fragment key={item.label}>
                        {item.divided ? <div className="menu-sep" role="separator" /> : null}
                        <button
                          type="button"
                          className={item.danger ? "danger" : undefined}
                          disabled={Boolean(item.disabledReason)}
                          onClick={() => {
                            setMoreOpen(false);
                            item.onSelect();
                          }}
                        >
                          {item.label}
                        </button>
                      </Fragment>
                    ))}
                  </div>
                ) : null}
              </div>
              {fourArmed === current.id ? (
                <button className="btn" type="button" onClick={onFour}>
                  确认这 4 张
                </button>
              ) : null}
              {/* 4A-U09: 生成这一场 above is the page's primary button; this one is plain. */}
              {stillProgress[current.id] ? (
                <button className="btn" type="button" disabled>
                  {stillProgress[current.id]}
                </button>
              ) : shotProgress(current) === "未生成" ? (
                <button className="btn" type="button" onClick={onStills}>
                  生成画面
                </button>
              ) : (
                <button className="btn" type="button" onClick={onGenerate}>
                  生成视频
                </button>
              )}
            </div>
          </>
        ) : sceneRow ? (
          // 4C-U07: with no shot to show, the column shows this scene and the whole work.
          <div className="pb scene-props">
            <div className="shot-h">
              第 {sceneRow.no} 场 <span>还没有镜头</span>
            </div>
            <div className="field">
              <label htmlFor="scene-where">这一场在哪</label>
              <input
                id="scene-where"
                className="input"
                aria-label="这一场在哪"
                value={sceneRow.where}
                placeholder="比如：内景 · 夜 · 旧书店"
                onChange={(event) =>
                  onFilm({
                    ...film,
                    scenes: film.scenes.map((item) =>
                      item.id === sceneRow.id ? { ...item, where: event.target.value } : item,
                    ),
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="scene-ambience">这一场的环境音</label>
              <textarea
                id="scene-ambience"
                className="area"
                aria-label="这一场的环境音"
                rows={2}
                value={sceneRow.ambience}
                placeholder="比如：雨打在玻璃上，远处有车开过。"
                onChange={(event) =>
                  onFilm({
                    ...film,
                    scenes: film.scenes.map((item) =>
                      item.id === sceneRow.id ? { ...item, ambience: event.target.value } : item,
                    ),
                  })
                }
              />
            </div>
            <div className="field">
              <label>整部作品</label>
              <p className="role-desc">
                画风：{film.stylePreset}。画风和旁白在「角色与场景」页最上面改。
              </p>
            </div>
            <p className="role-desc">
              这一场还没有镜头：在「AI 助手」里让导演拆，或者点上面「加镜头」。
            </p>
          </div>
        ) : (
          <p className="role-desc">这一场还没有镜头。</p>
        )}
      </section>
    </>
  );
}

/** 4A-U10: the preview's sound switch, on the player itself; M does the same anywhere. */
function MuteButton({ muted, onMute }: { muted: boolean; onMute: () => void }) {
  return (
    <button
      className={muted ? "icon-btn mute on" : "icon-btn mute"}
      type="button"
      aria-label="预览静音 (M)"
      title={muted ? "预览静音中，按 M 打开声音" : "预览静音 (M)"}
      aria-pressed={muted}
      onClick={onMute}
    >
      <Ic name="vol" size={15} />
    </button>
  );
}

function GeneratePage({
  beginner = false,
  quiet = false,
  onMute,
  assistant = null,
  film,
  onCleanCopy,
  cleanCopyBusy,
  shots,
  shot,
  onShot,
  onFilm,
  versions,
  onVersions,
  duration,
  onDuration,
  onCreate,
  onBack,
  playing,
  onPlaying,
  audible,
}: {
  film: FilmProject;
  onCleanCopy: (ids: readonly string[]) => void;
  cleanCopyBusy: boolean;
  shots: FilmShot[];
  shot: number;
  onShot: (index: number) => void;
  onFilm: (film: FilmProject) => void;
  versions: number;
  onVersions: (count: number) => void;
  duration: number;
  onDuration: (seconds: number) => void;
  onCreate: () => void;
  onBack: () => void;
  playing: boolean;
  onPlaying: (value: boolean) => void;
  audible: boolean;
  /** 4A-U09: 导出成片 is this screen's primary button, so 生成 steps back. */
  quiet?: boolean;
  /** 4A-U10: 「预览静音 (M)」 on the player; the switch left the top bar. */
  onMute?: () => void;
  /** 4C-U03: beginner mode, one version per shot; 「一次出几个」 is not offered. */
  beginner?: boolean;
  /** 4A-U11: the same AI 助手 as 分镜, in the right column's second tab. */
  assistant?: ReactNode;
}) {
  // 4A-U11: 属性 | AI 助手 in the right column, like every page; Ctrl+J switches.
  const [side, setSide] = useState<"props" | "ai">("props");
  useAssistantKey(() => setSide((now) => (now === "ai" ? "props" : "ai")));
  const current = shots[shot];
  const prompt = current ? keyframePrompt(current, film) : "先在剧本里拆镜头。";
  const takes = current?.takes ?? [];
  const picked =
    takes.find((item) => item.id === current?.selectedTakeId) ??
    takes.find((item) => item.status === "done");
  function choose(takeId: string) {
    if (!current) return;
    onFilm({
      ...film,
      shots: film.shots.map((item) =>
        item.id === current.id ? { ...item, selectedTakeId: takeId } : item,
      ),
    });
    onPlaying(true);
  }
  return (
    <>
      <section className="pane">
        <div className="ph">
          <h3>镜头</h3>
          <span className="meta">{shots.length} 个</span>
        </div>
        <div className="pb" style={{ padding: 6 }}>
          {shots.map((item, index) => (
            <button
              key={item.id}
              className={index === shot ? "shotrow on" : "shotrow"}
              onClick={() => onShot(index)}
            >
              <FrameThumb shot={item} />
              <div>
                <b>
                  镜头 {item.no} · {item.size}
                </b>
                <small className={shotProgress(item) === "未生成" ? "st-none" : "st-ok"}>
                  {shotProgress(item) === "视频已出"
                    ? `已完成 ${item.takes.filter((take) => take.status === "done").length}`
                    : shotProgress(item)}
                </small>
              </div>
            </button>
          ))}
        </div>
        <div className="pfoot">
          <span>
            已完成{" "}
            <b>
              {shots.filter((item) => item.takes.some((take) => take.status === "done")).length}
            </b>{" "}
            / {shots.length}
          </span>
          <span>
            约 <b>{shots.reduce((sum, item) => sum + item.seconds, 0)} 秒</b>
          </span>
        </div>
      </section>
      <section className="pane">
        <div className="ph">
          <h3>{current ? `镜头 ${current.no}` : "镜头"} · 版本</h3>
          <span className="meta">选一个最好的，会放进剪辑</span>
          <span className="sp" />
          {onMute ? <MuteButton muted={!audible} onMute={onMute} /> : null}
          <ShotView one onAll={onBack} onOne={() => undefined} />
        </div>
        <div className="cand-wrap">
          <div className="bigprev">
            {picked?.videoUrl ? (
              <PreviewVideo
                key={picked.id}
                src={picked.videoUrl}
                playing={playing}
                audible={audible && !dialogueMuted(film)}
                onPlaying={onPlaying}
                onTime={() => undefined}
              />
            ) : (
              // 5-3-13: with no video yet, the first frame shows instead of a black box.
              (() => {
                const still = shotFrame(current);
                return (
                  <div
                    className={still ? "frame" : "frame rain"}
                    style={
                      still
                        ? {
                            backgroundImage: `url(${still})`,
                            backgroundPosition: current?.posterPosition || "50% 50%",
                          }
                        : undefined
                    }
                  >
                    {takes.length > 0 ? (
                      <span className="badge none">{picked?.reason || "这一版还没有画面"}</span>
                    ) : still ? (
                      <span className="still-note">还没有视频，这是开头画面</span>
                    ) : null}
                  </div>
                );
              })()
            )}
          </div>
          {current ? (
            <CleanCopyRepair
              mode="shot"
              count={shotsNeedingCleanCopy(film).includes(current.id) ? 1 : 0}
              busy={cleanCopyBusy}
              onRepair={() => onCleanCopy([current.id])}
            />
          ) : null}
          <div className="cands">
            {takes.length === 0 && (
              <p className="role-desc">还没有版本。在右边点「生成 {versions} 个版本」。</p>
            )}
            {/* 4A-U03: the versions side by side, playing together; the pick goes to 剪辑. */}
            {current && takes.length > 0
              ? (() => {
                  const data = takePickerData(film, current.id, { mediaUrl: fileMediaUrl });
                  return data.ok ? (
                    <TakePicker
                      {...data.props}
                      aspect={film.aspectRatio === "16:9" ? "16:9" : "9:16"}
                      onSelect={choose}
                    />
                  ) : null;
                })()
              : null}
          </div>
        </div>
      </section>
      <section className="pane">
        <div className="ptabs">
          <button className={side === "props" ? "on" : ""} onClick={() => setSide("props")}>
            属性
          </button>
          <button className={side === "ai" ? "on" : ""} onClick={() => setSide("ai")}>
            AI 助手
          </button>
        </div>
        {side === "ai" ? (
          assistant
        ) : (
          <>
            <div className="ph">
              <h3>生成视频</h3>
              <span className="meta">{current ? `镜头 ${current.no}` : "还没有镜头"}</span>
            </div>
            <div className="pb" style={{ padding: "12px 14px" }}>
              <div className="sec-t">
                开头画面<span className="from role-d">这一镜自己的画面</span>
                <span className="sp" />
                <span>不是定妆照</span>
              </div>
              <div className="startf">
                <FrameThumb shot={current} />
                <div>
                  <b>{current ? `镜头 ${current.no} · ${current.size}` : "还没有镜头"}</b>
                  先出这一镜的图，再让它动起来
                </div>
              </div>
              <div className="sec-t" style={{ marginTop: 12 }}>
                角色定妆照
                <span className="sp" />
                <span>人物外貌会写进画面说明</span>
              </div>
              <div className="refs">
                {film.characters.map((item) => (
                  <div className="ref" key={item.id}>
                    <Thumb src={item.portraits.find((portrait) => portrait.url)?.url} />
                    <p>{item.name}</p>
                  </div>
                ))}
              </div>
              <div className="sec-t" style={{ marginTop: 12 }}>
                画面描述
                <span className="sp" />
                {/* 4A-U12: a plain note in gray; orange-red is kept for things to fix. */}
                <span className="from">包括这一镜的画面和人物外貌</span>
              </div>
              <textarea
                className="area"
                aria-label="画面描述"
                style={{ height: 74, width: "100%" }}
                value={current?.picture ?? ""}
                onChange={(event) => {
                  if (!current) return;
                  onFilm({
                    ...film,
                    shots: film.shots.map((item) =>
                      item.id === current.id
                        ? {
                            ...item,
                            picture: event.target.value,
                            action: event.target.value,
                            promptZh: "",
                            source: "user",
                            userFields: [...new Set([...item.userFields, "picture"])],
                          }
                        : item,
                    ),
                  });
                }}
              />
              {/* 3JR-U05: the whole text the model gets stays folded; the description above is what
              people write. */}
              <details className="full-prompt">
                <summary>看 AI 会收到的完整说明</summary>
                <p className="role-desc" data-testid="keyframe-prompt">
                  {current ? continuityPrompt(shots[shot - 1], current, film) : prompt}
                </p>
                <p className="role-desc">{CONTINUITY_REASON}</p>
              </details>
              <div className="row2" style={{ marginTop: 12 }}>
                <div>
                  <div className="sec-t">时长</div>
                  <div className="seg">
                    {[2, 3, 4, 5, 6, 10].map((seconds) => (
                      <button
                        key={seconds}
                        className={(current?.seconds ?? duration) === seconds ? "on" : ""}
                        onClick={() => onDuration(seconds)}
                      >
                        {seconds} 秒
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="row2" style={{ marginTop: 10 }}>
                <div>
                  <div className="sec-t">清晰度</div>
                  <div className="seg">
                    <button
                      className={film.draft ? "on" : ""}
                      onClick={() => onFilm({ ...film, draft: true })}
                    >
                      较快的一版
                    </button>
                    <button
                      className={film.draft ? "" : "on"}
                      onClick={() => onFilm({ ...film, draft: false })}
                    >
                      直接出成片
                    </button>
                  </div>
                </div>
                {/* 4C-U03: beginner mode makes one version per shot and does not offer more. */}
                {beginner ? null : (
                  <div>
                    <div className="sec-t">一次出几个</div>
                    <div className="seg">
                      {[1, 2, 4].map((count) => (
                        <button
                          key={count}
                          type="button"
                          className={versions === count ? "on" : ""}
                          onClick={() => onVersions(count)}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="genbar">
              <div className="model">
                <Ic name="spark" size={14} />
                <span>Grok 会员</span>
                <small title={GENERATE_MODEL}>成片</small>
              </div>
              <button className={quiet ? "btn block" : "btn primary block"} onClick={onCreate}>
                <Ic name="video" size={16} />
                生成 {versions} 个版本
              </button>
              {/* 4A-U12: what one click makes, from the length that is selected. */}
              <div className="note" data-testid="generation-estimate">
                {videoLine(versions, current?.seconds ?? duration)}
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

/**
 * 4B-U02: only main-verified source peaks are shown; unavailable sources remain empty.
 */
function Wave({ clip, verifiedKey }: { clip: AudioClip; verifiedKey?: string }) {
  const waveform = clip.waveform;
  const measuredToken = audioWaveformToken(waveform);
  const peaks =
    waveform && measuredToken && verifiedKey === measuredToken ? waveform.peaks : undefined;
  if (!(clip.durationSeconds > 0) || !peaks || peaks.length < 2)
    return <span className="wave" aria-hidden="true" />;
  const coverage = Math.min(1, waveform!.analyzedSeconds / clip.durationSeconds);
  const points = peaks
    .map(
      (peak, index) =>
        `${((index / (peaks.length - 1)) * 100 * coverage).toFixed(2)},${(50 - peak * 48).toFixed(2)}`,
    )
    .join(" ");
  return (
    <svg
      className="wave"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      role="img"
      aria-label="已核对音源的波形（混音前）"
    >
      <title>音源裁剪窗口的单声道峰值，按实际测得时长定位；未覆盖部分留白，不代表最终混音。</title>
      <polyline points={points} />
    </svg>
  );
}

/**
 * 4B-U02: the 环境音 or 音效 track. Sound files go where their shot is; without files it shows
 * what the director wrote for each shot (环境音 over the shot, 音效 at its moment), dashed,
 * with a note that there is no sound yet.
 */
function PlanLane({
  waveformKeys,
  lane,
  film,
  shots,
  clips,
  zoom = PX_PER_SECOND,
  mixPlan = null,
}: {
  waveformKeys: Readonly<Record<string, string>>;
  lane: "ambience" | "sfx";
  film: FilmProject;
  shots: FilmShot[];
  clips: { id: string; left: number; width: number }[];
  /** Pixels a second (5-3-08). */
  zoom?: number;
  mixPlan?: Extract<AudioMixPreviewResult, { kind: "READY" }>["plan"] | null;
}) {
  const files = film.audioClips.filter(
    (item) =>
      item.lane === lane && item.path && audioTimelineBox(film, item, shots, clips, zoom, mixPlan),
  );
  const name = lane === "ambience" ? "环境音" : "音效";
  const planned =
    lane === "ambience"
      ? shots.flatMap((item) => {
          const clip = clips.find((row) => row.id === item.id);
          const text = item.sound.ambience.trim();
          return clip && text ? [{ id: item.id, left: clip.left, width: clip.width, text }] : [];
        })
      : shots.flatMap((item) => {
          const clip = clips.find((row) => row.id === item.id);
          if (!clip) return [];
          return item.sound.sfx
            .filter((cue) => cue.text.trim())
            .map((cue, index) => ({
              id: `${item.id}-${index}`,
              left:
                clip.left +
                Math.min(clip.width - 8, (cue.atSeconds / Math.max(1, item.seconds)) * clip.width),
              width: 0,
              text: cue.text.trim(),
            }));
        });
  return (
    <div className="lane" style={{ height: "var(--ha)" }}>
      {files.length === 0 && planned.length === 0 ? (
        <span className="lane-empty">这一轨还没有内容</span>
      ) : null}
      {files.map((item) => (
        <div
          key={item.id}
          className={`clip ${lane === "ambience" ? "amb" : "fx"}`}
          style={{
            ...audioTimelineBox(film, item, shots, clips, zoom, mixPlan)!,
          }}
        >
          <Wave clip={item} verifiedKey={waveformKeys[item.id]} />
          <span className="tx">{name}</span>
        </div>
      ))}
      {files.length === 0
        ? planned.map((item) => (
            <div
              key={item.id}
              className={`clip plan ${lane === "ambience" ? "amb" : "fx"}`}
              title={`${item.text}（只有文字，还没有声音文件）`}
              style={
                lane === "ambience"
                  ? { left: item.left, width: Math.max(24, item.width - 2) }
                  : { left: item.left }
              }
            >
              <span className="tx">{item.text}</span>
            </div>
          ))
        : null}
    </div>
  );
}

function EditPage({
  waveformKeys,
  waveformBusy,
  onRefreshWaveforms,
  onMute,
  assistant = null,
  libraryTools = null,
  onSceneMood,
  onSceneVoice,
  onSubtitleStyle,
  film,
  shot,
  onShot,
  shots,
  range,
  comparing,
  rightTab,
  playing,
  actions,
  onTogglePlay,
  onSelectRange,
  onPickClip,
  onClearRange,
  onAction,
  onKeep,
  onChooseTake,
  onTab,
  onNotice,
  onRangeGenerate,
  onPlaying,
  audible,
  onImportMusic,
  onRewrite,
  onMarkIn,
  onMarkOut,
  span,
  onLane,
  onSolo,
  hearLane = "",
  audioPreview = { result: null, busy: false, unsupported: true },
  onRestoreAudioClip,
  onBindPreparedVoice,
}: {
  waveformKeys: Readonly<Record<string, string>>;
  waveformBusy: boolean;
  onRefreshWaveforms: () => void;
  film: FilmProject;
  shot: number;
  onShot: (index: number) => void;
  range: boolean;
  comparing: boolean;
  rightTab: "props" | "fix" | "ai";
  playing: boolean;
  actions: ReturnType<typeof videoActions>;
  onTogglePlay: () => void;
  onSelectRange: () => void;
  onPickClip: () => void;
  onClearRange: () => void;
  onAction: (action: FixAction) => void;
  onKeep: () => void;
  /** 4A-U03: use this version of the shot on show, as on 单镜. */
  onChooseTake: (shotId: string, takeId: string) => void;
  onTab: (tab: "props" | "fix" | "ai") => void;
  onNotice: (text: string) => void;
  onRangeGenerate: () => void;
  onPlaying: (value: boolean) => void;
  audible: boolean;
  onImportMusic: (file: File) => void;
  onRewrite: (picture: string) => void;
  onMarkIn: (seconds: number) => void;
  onMarkOut: (seconds: number) => void;
  span: { from: number; to: number } | null;
  shots: FilmShot[];
  onLane?: (lane: MixLane, gainDb: number) => void;
  onSolo?: (lane: MixLane) => void;
  hearLane?: MixLane | "";
  audioPreview?: AudioPreviewView;
  onRestoreAudioClip?: (id: string) => void;
  onBindPreparedVoice?: (clipId: string, shotId: string, takeId: string) => void;
  /** 4A-U10: 「预览静音 (M)」 on the player; the switch left the top bar. */
  onMute?: () => void;
  /** 4A-U11: the same AI 助手 as 分镜, in the right column's second tab. */
  assistant?: ReactNode;
  libraryTools?: ReactNode;
  /** 4B-U01: 这场的情绪, written to every shot of the scene (shot.sound.musicMood). */
  onSceneMood?: (sceneId: string, mood: Mood) => void;
  /** 4B-U01: the scene's voice level, written to its voice clips (gainDb). */
  onSceneVoice?: (sceneId: string, db: number) => void;
  /** 4B-U03: 「用这个样式」, kept on the work for every subtitle. */
  onSubtitleStyle?: (styleId: SubtitleStyleId) => void;
}) {
  const [monitor, setMonitor] = useState<"preview" | "sound" | "subs">("preview");
  // 5-3-11: guides over the preview: where titles stay readable, and on a portrait work, where
  // the platforms put their buttons and captions.
  const [safeArea, setSafeArea] = useState(false);
  const tall = film.aspectRatio === "9:16";
  // 4B-U03: the style being looked at; 「用这个样式」 keeps it on the work.
  const [subtitlePick, setSubtitlePick] = useState<string>(
    (film as FilmProject & { subtitleStyle?: string }).subtitleStyle ?? "",
  );
  // 4A-U11: Ctrl+J switches between 属性 and AI 助手.
  useAssistantKey(() => onTab(rightTab === "ai" ? "props" : "ai"));
  const [mediaTime, setMediaTime] = useState(0);
  const [cutLength, setCutLength] = useState(0);
  const [takeLength, setTakeLength] = useState(0);
  const [seek, setSeek] = useState<{ seconds: number } | null>(null);
  const timeRef = useRef(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  // 3JR-U02: once anything has a video, the shots still to make fold down to narrow marks.
  const [unfolded, setUnfolded] = useState(false);
  const readyCount = shots.filter(shotReady).length;
  const waitingCount = shots.length - readyCount;
  // 5-3-08: the timeline zooms; every position below comes from these boxes.
  const [zoom, setZoom] = useState<number>(PX_PER_SECOND);
  const clips = editClipLayout(shots, readyCount > 0 && !unfolded, zoom);
  const zoomBy = (direction: 1 | -1) => setZoom((now) => stepZoom(now, direction));
  // 5-3-02: right-click on a clip picks it and offers what the bar above it offers.
  const clipMenu = useContextMenu();
  const clipItems: ContextMenuItem[] = [
    {
      label: "重新生成",
      onSelect: onRangeGenerate,
      disabledReason: actions.regenerate.enabled ? undefined : actions.regenerate.reason,
    },
    {
      label: "换配音",
      onSelect: () => onAction("voice"),
      disabledReason: actions.voice.enabled ? undefined : actions.voice.reason,
    },
    { label: "剪掉", onSelect: () => onAction("cut"), danger: true, divided: true },
  ];
  const zoomToFit = () =>
    setZoom(
      fitZoom(
        shots.reduce((sum, item) => sum + item.seconds, 0),
        tracksRef.current?.clientWidth ?? 0,
      ),
    );
  // Ctrl+wheel over the tracks zooms, as in other editors. React's wheel handler cannot stop
  // the page from zooming, so this listens directly.
  useEffect(() => {
    const box = tracksRef.current;
    if (!box) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((now) => stepZoom(now, event.deltaY < 0 ? 1 : -1));
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);
  // 5-3-10: use the same page-scoped cut history as the timeline button.
  // Keep Delete/Backspace for fields, dialogs and menus when they own the keyboard.
  const cutKey = useRef<() => boolean>(() => false);
  cutKey.current = () => {
    if (!range) return false;
    onAction("cut");
    return true;
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (event.metaKey || event.ctrlKey || event.altKey || typingInField(event)) return;
      if (document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (cutKey.current()) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const zoomControls = (
    <span className="tzoom" role="group" aria-label="时间线缩放">
      <button
        className="icon-btn sm"
        type="button"
        aria-label="缩小时间线"
        title="缩小（Ctrl+滚轮）"
        disabled={zoom <= 6}
        onClick={() => zoomBy(-1)}
      >
        <Ic name="zout" size={14} />
      </button>
      <button
        className="icon-btn sm"
        type="button"
        aria-label="放大时间线"
        title="放大（Ctrl+滚轮）"
        disabled={zoom >= 208}
        onClick={() => zoomBy(1)}
      >
        <Ic name="zin" size={14} />
      </button>
      <button className="btn sm" type="button" title="整部片子放进时间线" onClick={zoomToFit}>
        看全片
      </button>
    </span>
  );
  const cues = subtitleCues(shots);
  const current = shots[shot] ?? shots[0];
  const subtitleView = useMemo(
    () => (monitor === "subs" ? subtitleStyleData(film, { value: subtitlePick }) : null),
    [monitor, film, subtitlePick],
  );
  // 4B-U01: the sound of the scene the shown shot is in; worked out only while it is shown.
  const sceneSound = useMemo(
    () => (monitor === "sound" && current ? soundPanelData(film, current.sceneId) : null),
    [monitor, film, current],
  );
  const chosenTake =
    current?.takes.find((item) => item.id === current.selectedTakeId) ??
    current?.takes.find((item) => item.status === "done");
  const previewSrc =
    film.assemblyUrl || fileMediaUrl(chosenTake?.videoUrl || chosenTake?.videoPath);
  const mixSettings = audioMixSettings(film.audioMix);
  const actualMixPlan = audioPreview.result?.kind === "READY" ? audioPreview.result.plan : null;
  const musicGain = mixSettings.lanes.score.gainDb;
  const dialogueGain = mixSettings.lanes.dialogue.gainDb;
  const trackWidth = Math.max(0, ...clips.map((clip) => clip.left + clip.width)) + 48;
  const importMusic = (
    <label className="btn sm">
      导入音乐
      <input
        type="file"
        accept="audio/*,.mp3,.wav"
        hidden
        aria-label="导入音乐"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onImportMusic(file);
        }}
      />
    </label>
  );
  // 3JR-U01: the joined cut plays the whole film, so its clock runs from the first shot with a
  // video, not from the start of the chosen shot. The playhead follows the shot playing.
  const joined = Boolean(film.assemblyUrl);
  const segments = joined ? cutSegments(film.shots, cutLength) : [];
  const total = shots.reduce((sum, item) => sum + item.seconds, 0);
  const showTime = (seconds: number) => {
    timeRef.current = seconds;
    setMediaTime(seconds);
  };
  const jump = (seconds: number) => {
    showTime(seconds);
    setSeek({ seconds });
  };
  useEffect(() => {
    showTime(0);
    setCutLength(0);
    setTakeLength(0);
  }, [previewSrc]);
  useEffect(() => {
    if (!joined) {
      showTime(0);
      return;
    }
    // Picking a shot (the bin, the arrows) moves the joined cut to it, unless a click on the
    // timeline already put the playhead inside it.
    const here = cutPosition(segments, timeRef.current);
    if (here && here.shotId === shots[shot]?.id) return;
    const at = cutTimeAt(segments, shots, shot, 0);
    if (at !== null) jump(at);
    // Only a new pick moves the cut; the segments change on every render.
  }, [shot, joined]);
  const start = shots.slice(0, shot).reduce((sum, item) => sum + item.seconds, 0);
  // 4C-U01: the part between in and out.
  const picked = selection(shots, span, shot);
  const selected = clips[shot];
  let headLeft = selected?.left ?? 1;
  let headSeconds = start;
  if (joined) {
    const at = cutPosition(segments, mediaTime);
    if (at) {
      headLeft = playheadX(clips, shots, film.shots, at.shotId, at.fraction);
      const index = shots.findIndex((item) => item.id === at.shotId);
      headSeconds =
        index >= 0
          ? timelineSeconds(shots, index, at.fraction)
          : headLeft <= (clips[0]?.left ?? 1)
            ? 0
            : total;
    }
  } else if (current && current.seconds > 0) {
    const fraction = Math.min(1, mediaTime / (takeLength > 0 ? takeLength : current.seconds));
    headLeft = (selected?.left ?? 1) + fraction * (selected?.width ?? 0);
    headSeconds = start + fraction * current.seconds;
  }
  const sourceSeconds = joined
    ? (cutPosition(segments, mediaTime)?.fraction ?? 0) *
      (chosenTake?.durationSeconds ?? current?.seconds ?? 0)
    : mediaTime;
  const seekTo = (x: number) => {
    const point = pointAt(clips, x);
    if (!point) return;
    if (joined) {
      const at = cutTimeAt(segments, shots, point.index, point.fraction);
      if (at !== null) jump(at);
      if (point.index !== shot) onShot(point.index);
      return;
    }
    const target = shots[point.index];
    if (point.index !== shot) onShot(point.index);
    if (!target || !target.takes.some((take) => take.videoUrl || take.videoPath)) return;
    jump(point.fraction * (point.index === shot && takeLength > 0 ? takeLength : target.seconds));
  };
  const areaX = (clientX: number) => clientX - (areaRef.current?.getBoundingClientRect().left ?? 0);
  useEffect(() => {
    const box = tracksRef.current;
    if (!box || !playing) return;
    const margin = 48;
    if (
      headLeft < box.scrollLeft + margin ||
      headLeft > box.scrollLeft + box.clientWidth - margin
    ) {
      box.scrollLeft = Math.max(0, headLeft - margin);
    }
  }, [headLeft, playing]);
  // 5-3-09: J / K / L play backwards, stop and play (J or L again goes faster), ← / → move one
  // frame (Shift: one second), ↑ / ↓ go to the cut before or after, as in other editors.
  const [rate, setRate] = useState(1);
  const [backwards, setBackwards] = useState(0);
  useEffect(() => {
    if (playing) setBackwards(0);
    else setRate(1);
  }, [playing]);
  const cuts = shots.reduce<number[]>(
    (list, item) => [...list, (list[list.length - 1] ?? 0) + item.seconds],
    [0],
  );
  const goTo = (seconds: number) =>
    seekTo(xAtSeconds(shots, clips, Math.min(total, Math.max(0, seconds))));
  const goToCut = (index: number) => {
    if (index >= shots.length) {
      const last = clips[clips.length - 1];
      if (last) seekTo(last.left + last.width);
      return;
    }
    if (joined) {
      const at = cutTimeAt(segments, shots, index, 0);
      if (at !== null) jump(at);
    } else if (index === shot) jump(0);
    if (index !== shot) onShot(index);
  };
  const transport = useRef<{
    key: (event: KeyboardEvent) => boolean;
    back: (seconds: number) => boolean;
  }>({ key: () => false, back: () => false });
  transport.current.back = (seconds) => {
    if (headSeconds <= 0.01) return false;
    goTo(headSeconds - seconds);
    return true;
  };
  transport.current.key = (event) => {
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    if (key === "k") {
      onPlaying(false);
      setBackwards(0);
      return true;
    }
    if (key === "l") {
      setBackwards(0);
      if (playing) setRate((now) => Math.min(4, now * 2));
      else onPlaying(true);
      return true;
    }
    if (key === "j") {
      if (playing) onPlaying(false);
      setBackwards((now) => (now ? Math.min(4, now * 2) : 1));
      return true;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      onPlaying(false);
      setBackwards(0);
      const step = event.shiftKey ? 1 : FRAME_SECONDS;
      goTo(headSeconds + (key === "ArrowLeft" ? -step : step));
      return true;
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      const later = key === "ArrowDown";
      const index = later
        ? cuts.findIndex((at) => at > headSeconds + 0.05)
        : cuts.filter((at) => at < headSeconds - 0.05).length - 1;
      if (index >= 0) goToCut(index);
      return true;
    }
    return false;
  };
  useEffect(() => {
    if (!backwards) return;
    const timer = window.setInterval(() => {
      if (!transport.current.back(0.1 * backwards)) setBackwards(0);
    }, 100);
    return () => window.clearInterval(timer);
  }, [backwards]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The ruler moves itself with the arrows when it has the focus.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInField(event) || document.querySelector('[role="dialog"]')) return;
      if (transport.current.key(event)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      {comparing ? (
        <section className="pane">
          <div className="ph">
            <h3>对比</h3>
            <span className="meta">镜头 {current?.no ?? shot + 1} · 选中的一段</span>
            <span className="sp" />
            <div className="seg">
              <button className="on">左右对比</button>
            </div>
          </div>
          <div className="cmp cmp-takes">
            {/* 4A-U03: the same picker as 单镜, so a version is chosen the same way everywhere. */}
            {current && (current.takes.length ?? 0) > 0
              ? (() => {
                  const data = takePickerData(film, current.id, { mediaUrl: fileMediaUrl });
                  return data.ok ? (
                    <TakePicker
                      {...data.props}
                      aspect={film.aspectRatio === "16:9" ? "16:9" : "9:16"}
                      onSelect={(takeId) => onChooseTake(current.id, takeId)}
                    />
                  ) : null;
                })()
              : null}
            {(current?.takes.length ?? 0) < 2 && (
              <p className="role-desc">还没有两个版本可以对比。</p>
            )}
          </div>
          <div className="cmpbar">
            <button
              className="icon-btn"
              aria-label={playing ? "暂停" : "播放"}
              onClick={onTogglePlay}
            >
              <Ic name={playing ? "pause" : "play"} />
            </button>
            <span className="tc">
              {clock(start)} – {clock(start + (current?.seconds ?? 0))}
            </span>
            <span className="sp" />
            <span className="meta">
              {current?.takes.filter((item) => item.status === "done").length ?? 0} 个版本
            </span>
            {/* 4A-U10: a version is chosen in the picker above, the same as on 单镜. */}
            <button className="btn" onClick={onKeep}>
              关掉对比
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="pane">
            <div className="ph">
              <span className="meta">{shots.length} 个镜头</span>
            </div>
            <div className="pb bin">
              {shots.map((item, index) => (
                <button
                  key={item.id}
                  className="it"
                  onClick={() => {
                    onShot(index);
                    onSelectRange();
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <FrameThumb shot={item} />
                    <span className="dur">{item.seconds}s</span>
                  </div>
                  <p>
                    镜头 {item.no} · {item.size}
                  </p>
                </button>
              ))}
            </div>
          </section>
          <section className="pane monitor">
            {/* 4B-U01: the scene's sound takes the preview's place, one click away. */}
            <div className="ph">
              <div className="seg monitor-tabs">
                <button
                  type="button"
                  className={monitor === "preview" ? "on" : ""}
                  onClick={() => setMonitor("preview")}
                >
                  预览
                </button>
                <button
                  type="button"
                  className={monitor === "sound" ? "on" : ""}
                  onClick={() => {
                    onPlaying(false);
                    setMonitor("sound");
                  }}
                >
                  声音
                </button>
                <button
                  type="button"
                  className={monitor === "subs" ? "on" : ""}
                  onClick={() => {
                    onPlaying(false);
                    setMonitor("subs");
                  }}
                >
                  字幕
                </button>
              </div>
              <span className="meta" title={film.title}>
                {film.title}
              </span>
              <span className="sp" />
              {monitor === "preview" ? (
                <button
                  type="button"
                  className="btn sm safe-toggle"
                  aria-pressed={safeArea}
                  title={
                    tall ? "画出平台的按钮和标题会挡住的地方" : "画出字幕和标题不会被切掉的范围"
                  }
                  onClick={() => setSafeArea((value) => !value)}
                >
                  安全框
                </button>
              ) : null}
            </div>
            {monitor === "subs" ? (
              // 4B-U03: the subtitle look, on a landscape and a portrait frame; the portrait one
              // keeps the line above the area the platforms cover with their buttons.
              <div className="pb sound-pane">
                {subtitleView?.ok ? (
                  <SubtitleStyle
                    {...subtitleView.props}
                    value={subtitlePick}
                    onChange={setSubtitlePick}
                    onApply={(styleId) => onSubtitleStyle?.(styleId as SubtitleStyleId)}
                  />
                ) : (
                  <p className="role-desc">
                    {subtitleView
                      ? `${subtitleView.empty.title}。${subtitleView.empty.detail}`
                      : ""}
                  </p>
                )}
              </div>
            ) : monitor === "sound" ? (
              <div className="pb sound-pane">
                {sceneSound?.ok ? (
                  <SoundPanel
                    {...sceneSound.props}
                    onMoodChange={(mood) => {
                      if (current) onSceneMood?.(current.sceneId, mood);
                    }}
                    onMasterChange={() => undefined}
                    onLaneChange={(lane, _volume, db) => {
                      if (current && lane === "dialogue") onSceneVoice?.(current.sceneId, db);
                    }}
                  />
                ) : (
                  <p className="role-desc">
                    {sceneSound
                      ? `${sceneSound.empty.title}。${sceneSound.empty.detail}`
                      : "先在左边选一个镜头。"}
                  </p>
                )}
              </div>
            ) : (
              <PreviewFullscreen ignoreShortcut={typingInField} onNotice={onNotice}>
                <div className="screen">
                  {previewSrc ? (
                    <PreviewVideo
                      src={previewSrc}
                      mixPreview={
                        audioPreview.result?.kind === "READY" ? audioPreview.result : null
                      }
                      mixTimeOffset={
                        joined
                          ? 0
                          : audioPreview.result?.kind === "READY"
                            ? (audioPreview.result.plan.shots.find(
                                (row) => row.shotId === current?.id,
                              )?.startSeconds ?? start)
                            : start
                      }
                      soloLane={hearLane}
                      playing={playing}
                      audible={false}
                      sound={audible}
                      onPlaying={onPlaying}
                      onTime={showTime}
                      seek={seek}
                      onDuration={joined ? setCutLength : setTakeLength}
                      rate={rate}
                    />
                  ) : (
                    <div className="frame rain">
                      {/* 4C-U07: a gray note in the middle, not dressed as a subtitle. */}
                      <span className="screen-empty">
                        {shots.filter((item) => item.takes.some((take) => take.videoUrl)).length > 1
                          ? ROUGH_CUT_REASON
                          : "还没有可以播放的视频。"}
                      </span>
                    </div>
                  )}
                  {safeArea ? (
                    <div className="safe-guide" data-overlay="" aria-hidden="true">
                      {tall ? (
                        <>
                          <span className="safe-side" />
                          <span className="safe-band">平台的按钮和标题会挡住这里</span>
                        </>
                      ) : (
                        <>
                          <span className="safe-box" />
                          <span className="safe-box inner">
                            <span className="safe-note">字幕和标题放在这个框里</span>
                          </span>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="ctrl">
                  <span className="tc">
                    <b>{clock(headSeconds)}</b> / {clock(total)}
                    {backwards ? (
                      <span className="speed" role="status">
                        倒放 {backwards}×
                      </span>
                    ) : playing && rate > 1 ? (
                      <span className="speed" role="status">
                        快放 {rate}×
                      </span>
                    ) : null}
                  </span>
                  <div className="pc">
                    <button
                      className="icon-btn"
                      aria-label="上一个"
                      onClick={() => onShot(Math.max(0, shot - 1))}
                    >
                      <Ic name="skipb" />
                    </button>
                    <button
                      className="playb"
                      aria-label={playing ? "暂停" : "播放"}
                      title={playing ? "暂停（空格）" : "播放（空格）"}
                      onClick={onTogglePlay}
                    >
                      <Ic name={playing ? "pause" : "play"} size={16} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label="下一个"
                      onClick={() => onShot(Math.min(shots.length - 1, shot + 1))}
                    >
                      <Ic name="skipf" />
                    </button>
                  </div>
                  {onMute ? <MuteButton muted={!audible} onMute={onMute} /> : null}
                </div>
              </PreviewFullscreen>
            )}
          </section>
        </>
      )}
      <section className="pane">
        {/* 4A-U11: 属性 | AI 助手 like every page; 修改这一段 is part of 属性 now. */}
        <div className="ptabs">
          <button className={rightTab !== "ai" ? "on" : ""} onClick={() => onTab("props")}>
            属性
          </button>
          <button className={rightTab === "ai" ? "on" : ""} onClick={() => onTab("ai")}>
            AI 助手
          </button>
        </div>
        {rightTab === "ai" ? (
          assistant
        ) : (
          <div className="pb">
            <div className="field">
              <label>
                镜头 {current?.no ?? ""} · {current?.size || "中景"} · {current?.seconds ?? 0} 秒
              </label>
            </div>
            <div className="field">
              <div className="row3">
                <div>
                  <label>开始</label>
                  <div className="input">{clock(start)}</div>
                </div>
                <div>
                  <label>结束</label>
                  <div className="input">{clock(start + (current?.seconds ?? 0))}</div>
                </div>
                <div>
                  <label>镜头怎么动</label>
                  <div className="input">{current?.move || "固定"}</div>
                </div>
              </div>
            </div>
            <div className="field">
              <div className="sec-t">这一镜的描述</div>
              <textarea
                className="area"
                aria-label="改这一镜的描述"
                style={{ height: 62 }}
                value={current?.picture ?? ""}
                onChange={(event) => onRewrite(event.target.value)}
              />
              {/* 4A-U10: the actions on this part are on the timeline bar below, once. */}
              <p className="role-desc">
                重做、换配音、剪掉，用下面时间线上的按钮。剪掉后可按 Ctrl+Z 撤销。
              </p>
            </div>
            {libraryTools}
            <p className="role-desc">
              {hearLane
                ? `当前只试听${AUDIO_LANE_LABEL[hearLane]}，不改变导出。`
                : "当前四轨一起试听。"}
            </p>
            <p className="role-desc">
              整轨音量保留各片段原有音量；单听仅试听，不改变导出。预览未应用导出响度归一化。
            </p>
            <p className="role-desc" role="status">
              {audioPreview.busy
                ? "正在核对所选版本的音轨…"
                : audioPreview.unsupported
                  ? "当前桌面能力不支持完整轨道试听；不会用原视频声音冒充混音。"
                  : audioPreview.result?.kind === "FAILED"
                    ? "音轨暂时无法核验，未播放未确认的声音。"
                    : ""}
            </p>
            {audioPreview.result?.kind === "FAILED" && (
              <button className="btn sm" onClick={audioPreview.retry}>
                重试音轨试听
              </button>
            )}
            {film.audioClips
              .filter(
                (clip) =>
                  clip.shotId === current?.id &&
                  (isPreparedVoice(clip) ||
                    (clip.lane === "dialogue" &&
                      clip.enabled === false &&
                      clip.takeId === current?.selectedTakeId)),
              )
              .map((clip) => {
                const binding = preparedVoiceBinding(film, clip);
                return (
                  <p key={`prepared-${clip.id}`} className="role-desc">
                    {isPreparedVoice(clip)
                      ? "待绑定配音：已保留，尚未用于画面；请先核对当前台词和声音。"
                      : "已保留的配音：当前停用，可重新选用。"}
                    {binding?.alreadyBound ? (
                      <span>已用于当前版本，原配音仍保留。</span>
                    ) : binding ? (
                      <button
                        className="btn sm"
                        onClick={() =>
                          onBindPreparedVoice?.(clip.id, binding.shotId, binding.takeId)
                        }
                      >
                        {isPreparedVoice(clip)
                          ? "将这段配音用于当前版本（现用配音保留）"
                          : "改用这段已保留配音（不重新配音）"}
                      </button>
                    ) : (
                      <span>生成画面后可免费绑定，不需要再次配音。</span>
                    )}
                  </p>
                );
              })}
            {film.audioClips
              .filter((clip) => clip.path && clip.gainDb <= -40)
              .map((clip) => (
                <p key={clip.id} className="role-desc">
                  {clip.label || "音频片段"}已单独静音。
                  <button className="btn sm" onClick={() => onRestoreAudioClip?.(clip.id)}>
                    恢复片段默认音量
                  </button>
                </p>
              ))}
            <p className="role-desc hint">
              已填写对白的原声和配音片段会保守避让配乐；逐句时间尚未核实。
              全片配乐默认重复铺满，不保证无缝接缝；波形仅表示已测的一轮源音频。
              <span className="q" role="img" aria-label="说明" title={LOUDNESS_NOTE}>
                ?
              </span>
            </p>
          </div>
        )}
      </section>
      <section className="pane timeline">
        {range ? (
          <div className="selbar">
            {/* 4C-U01: coarse shot selection; the dialog checks actual seconds. Speech stays unchanged. */}
            <span className="lab">
              已选{" "}
              {picked.first === picked.last
                ? `镜头 ${shots[picked.first]?.no ?? picked.first + 1}`
                : `镜头 ${shots[picked.first]?.no ?? picked.first + 1}–${shots[picked.last]?.no ?? picked.last + 1}`}{" "}
              · {clock(picked.start)}–{clock(picked.start + picked.seconds)} · {picked.seconds} 秒
            </span>
            {picked.hasLine ? (
              <span
                className="sel-hint"
                title="当前没有可靠的逐句语音对齐，秒级重做不自动扩展整句，也不重配对白或验证口型。"
              >
                仅重做画面，保留原音轨
              </span>
            ) : null}
            {/* 4C-U01: an existing take opens seconds review; a shot without video opens ordinary creation. */}
            <button
              className="btn primary"
              title={actions.regenerate.reason}
              aria-disabled={!actions.regenerate.enabled}
              onClick={() =>
                actions.regenerate.enabled ? onRangeGenerate() : onAction("regenerate")
              }
            >
              <Ic name="refresh" size={13} />
              重新生成
            </button>
            <button
              className="btn"
              title={actions.voice.reason}
              aria-disabled={!actions.voice.enabled}
              onClick={() => onAction("voice")}
            >
              <Ic name="mic" size={13} />
              换配音
            </button>
            <button
              className="btn"
              title={actions.cut.reason}
              aria-keyshortcuts="Delete"
              onClick={() => onAction("cut")}
            >
              <Ic name="trash" size={13} />
              剪掉
            </button>
            <span className="sp" />
            {zoomControls}
            {importMusic}
            <button
              className="btn sm"
              disabled={waveformBusy}
              onClick={onRefreshWaveforms}
              title="核对本机音源并读取混音前的波形，不生成声音"
            >
              {waveformBusy ? "读取波形中" : "刷新音频波形"}
            </button>
            <button className="icon-btn sm" aria-label="取消选择" onClick={onClearRange}>
              <Ic name="x" size={14} />
            </button>
          </div>
        ) : (
          <div className="ttool">
            <button className="icon-btn on" aria-label="选择" title="选择">
              <Ic name="cursor" />
            </button>
            <button
              className="icon-btn"
              aria-label="删除"
              title="删除选中的镜头 (Delete)"
              aria-keyshortcuts="Delete"
              onClick={() => onAction("cut")}
            >
              <Ic name="trash" />
            </button>
            <span className="vsep" />
            <button
              className="icon-btn"
              aria-label="设入点"
              title="设入点 (I)"
              onClick={() => onMarkIn(sourceSeconds)}
            >
              <Ic name="bracketL" />
            </button>
            <button
              className="icon-btn"
              aria-label="设出点"
              title="设出点 (O)"
              onClick={() => onMarkOut(sourceSeconds)}
            >
              <Ic name="bracketR" />
            </button>
            <span className="sp" />
            {readyCount > 0 && waitingCount > 0 ? (
              <button
                type="button"
                className="btn sm"
                aria-pressed={unfolded}
                title={
                  unfolded
                    ? "没生成的镜头收成细条，做好的镜头更好找"
                    : "没生成的镜头按计划的长度摆出来"
                }
                onClick={() => setUnfolded((value) => !value)}
              >
                {unfolded ? "收起没生成的" : `展开没生成的 ${waitingCount} 个`}
              </button>
            ) : null}
            {zoomControls}
            {importMusic}
            <button
              className="btn sm"
              disabled={waveformBusy}
              onClick={onRefreshWaveforms}
              title="核对本机音源并读取混音前的波形，不生成声音"
            >
              {waveformBusy ? "读取波形中" : "刷新音频波形"}
            </button>
          </div>
        )}
        <div className="tbody">
          <div className="theads">
            <div className="ruler-h" />
            <div className="th" style={{ height: "var(--hs)" }}>
              <span className="sw" style={{ background: "var(--t-sub)" }} />
              <Ic name="text" size={13} />
              字幕
            </div>
            <div className="th" style={{ height: "var(--hv)" }}>
              <span className="sw" style={{ background: "var(--t-video)" }} />
              <Ic name="film" size={13} />
              视频
            </div>
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-voice)" }} />
              <Ic name="mic" size={13} />
              对白
              <AudioLaneControls
                lane="dialogue"
                gainDb={dialogueGain}
                muted={mixSettings.lanes.dialogue.muted}
                onLane={onLane}
                onSolo={onSolo}
              />
            </div>
            {/* 4B-U02: 环境音 and 音效 have their own tracks; until there are sound files they
                only show what was written for each shot. */}
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-amb)" }} />
              <Ic name="vol" size={13} />
              环境音
              <AudioLaneControls
                lane="ambience"
                gainDb={mixSettings.lanes.ambience.gainDb}
                muted={mixSettings.lanes.ambience.muted}
                onLane={onLane}
                onSolo={onSolo}
              />
            </div>
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-sfx)" }} />
              <Ic name="spark" size={13} />
              音效
              <AudioLaneControls
                lane="sfx"
                gainDb={mixSettings.lanes.sfx.gainDb}
                muted={mixSettings.lanes.sfx.muted}
                onLane={onLane}
                onSolo={onSolo}
              />
            </div>
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-music)" }} />
              <Ic name="music" size={13} />
              配乐
              <AudioLaneControls
                lane="score"
                gainDb={musicGain}
                muted={mixSettings.lanes.score.muted}
                onLane={onLane}
                onSolo={onSolo}
              />
            </div>
          </div>
          <div className="tracks" ref={tracksRef}>
            <div
              className="track-area"
              ref={areaRef}
              style={{ width: trackWidth }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if ((event.target as HTMLElement).closest("button, input, label")) return;
                scrubbing.current = true;
                event.currentTarget.setPointerCapture?.(event.pointerId);
                seekTo(areaX(event.clientX));
              }}
              onPointerMove={(event) => {
                if (scrubbing.current) seekTo(areaX(event.clientX));
              }}
              onPointerUp={() => {
                scrubbing.current = false;
              }}
              onPointerCancel={() => {
                scrubbing.current = false;
              }}
            >
              <div
                className="ruler"
                role="slider"
                tabIndex={0}
                aria-label="播放位置"
                title="点或拖到这里，预览跳到这个时间"
                aria-valuemin={0}
                aria-valuemax={Math.round(total * 10) / 10}
                aria-valuenow={Math.round(headSeconds * 10) / 10}
                aria-valuetext={clock(headSeconds)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 5 : 1;
                  const to =
                    event.key === "ArrowLeft"
                      ? headSeconds - step
                      : event.key === "ArrowRight"
                        ? headSeconds + step
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? total
                            : null;
                  if (to === null) return;
                  event.preventDefault();
                  seekTo(xAtSeconds(shots, clips, Math.min(total, Math.max(0, to))));
                }}
              >
                {spacedTicks(
                  ticksOutsideFolds(
                    rulerTicks(
                      shots,
                      clips,
                      rulerStep(
                        shots.reduce((sum, item) => sum + item.seconds, 0),
                        zoom,
                      ),
                    ),
                    clips,
                  ),
                ).map((tick) => (
                  <span key={tick.seconds} style={{ left: tick.left }}>
                    {clock(tick.seconds)}
                  </span>
                ))}
              </div>
              <div className="lane" style={{ height: "var(--hs)" }}>
                {cues.length === 0 ? <span className="lane-empty">这一轨还没有内容</span> : null}
                {cues.map((cue) => {
                  const clip = clips.find((item) => item.id === cue.id);
                  if (!clip) return null;
                  return (
                    <div
                      key={cue.id}
                      className={clip.folded ? "clip s folded" : "clip s"}
                      style={{ left: clip.left, width: clip.width }}
                      title={clip.folded ? cue.text : undefined}
                    >
                      {clip.folded ? null : <span className="tx">{cue.text}</span>}
                    </div>
                  );
                })}
              </div>
              <ContextMenu
                at={clipMenu.at}
                label={`镜头 ${current?.no ?? shot + 1} 的操作`}
                items={clipItems}
                onClose={clipMenu.close}
              />
              <div className="lane" style={{ height: "var(--hv)" }}>
                {clips.map((clip, index) => {
                  const item = shots[index];
                  const ready = item ? shotReady(item) : false;
                  const scene = film.scenes.find((row) => row.id === item?.sceneId);
                  const number = item?.no ?? index + 1;
                  const name = scene ? `${scene.no}-${number}` : `镜头 ${number}`;
                  const fullName = (item && scopeOf(film, item.sceneId, item)) || `镜头 ${number}`;
                  const waiting = `${fullName} 还没生成（${item?.seconds ?? 0} 秒）`;
                  return (
                    <button
                      key={clip.id}
                      className={
                        ready ? "clip v" : clip.folded ? "clip v empty folded" : "clip v empty"
                      }
                      style={{ left: clip.left, width: clip.width }}
                      title={ready ? fullName : waiting}
                      aria-label={clip.folded ? "未生成" : undefined}
                      onClick={(event) => {
                        // A keyboard press has no pointer position: go to the clip's start.
                        seekTo(event.detail === 0 ? clip.left : areaX(event.clientX));
                        onShot(index);
                        onPickClip();
                      }}
                      onContextMenu={(event) => {
                        onShot(index);
                        onPickClip();
                        clipMenu.open(event);
                      }}
                    >
                      {clip.folded ? null : <span className="lb">{ready ? name : "未生成"}</span>}
                      {/* 4C-U01: which made version the cut uses, 「版本 2/3」. */}
                      {!clip.folded && item && takeBadge(item) ? (
                        <span className="ver">{takeBadge(item)}</span>
                      ) : null}
                      {/* 4B-U07: the same 口型 mark on the clip. */}
                      {(() => {
                        const lips = !clip.folded && item ? lipSyncTag(item) : null;
                        return lips ? (
                          <span className={lips.failed ? "lips failed" : "lips"} title={lips.title}>
                            {lips.text}
                          </span>
                        ) : null;
                      })()}
                    </button>
                  );
                })}
              </div>
              <div className="lane" style={{ height: "var(--ha)" }}>
                {film.audioClips.some((item) => item.lane === "dialogue" && item.path) ||
                actualMixPlan?.tracks.some((track) => track.native) ? null : (
                  <span className="lane-empty">这一轨还没有内容</span>
                )}
                {film.audioClips
                  .filter(
                    (item) =>
                      item.lane === "dialogue" &&
                      item.path &&
                      audioTimelineBox(film, item, shots, clips, zoom, actualMixPlan),
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      className="clip a"
                      data-voice={isVoiceFile(item.path ?? "") ? "1" : undefined}
                      data-voice-binding={isPreparedVoice(item) ? "pending" : "bound"}
                      title={isPreparedVoice(item) ? "待绑定配音：已保留，尚未用于画面" : undefined}
                      style={{
                        ...audioTimelineBox(film, item, shots, clips, zoom, actualMixPlan)!,
                      }}
                    >
                      <Wave clip={item} verifiedKey={waveformKeys[item.id]} />
                      <span className="tx">
                        {isPreparedVoice(item)
                          ? "待绑定配音"
                          : item.enabled === false
                            ? "已停用配音"
                            : item.label || "对白"}
                      </span>
                    </div>
                  ))}
                {actualMixPlan?.tracks
                  .filter(
                    (track) =>
                      track.native && !film.audioClips.some((clip) => clip.id === track.key),
                  )
                  .map((track) => {
                    const sourceShot = actualMixPlan.shots.find(
                      (row) => row.nativeSourceKey === track.sourceKey,
                    );
                    if (!sourceShot) return null;
                    const virtual = {
                      id: track.key,
                      lane: "dialogue" as const,
                      label: "原声" as const,
                      shotId: sourceShot.shotId,
                      takeId: sourceShot.takeId,
                      startSeconds: track.startSeconds - sourceShot.startSeconds,
                      durationSeconds: track.endSeconds - track.startSeconds,
                      offsetSeconds: track.offsetSeconds,
                      gainDb: track.gainDb,
                    };
                    const box = audioTimelineBox(film, virtual, shots, clips, zoom, actualMixPlan);
                    return box ? (
                      <div
                        key={track.key}
                        className="clip a"
                        style={box}
                        title="已核验所选版本的原声；未提供逐句语音对齐"
                      >
                        <span className="tx">原声（所选版本）</span>
                      </div>
                    ) : null;
                  })}
              </div>
              <PlanLane
                waveformKeys={waveformKeys}
                lane="ambience"
                film={film}
                shots={shots}
                clips={clips}
                zoom={zoom}
              />
              <PlanLane
                waveformKeys={waveformKeys}
                lane="sfx"
                film={film}
                shots={shots}
                clips={clips}
                zoom={zoom}
              />
              <div className="lane" style={{ height: "var(--ha)" }}>
                {film.audioClips.some((item) => item.lane === "score" && item.path) ? null : (
                  <span className="lane-empty">这一轨还没有内容</span>
                )}
                {film.audioClips
                  .filter(
                    (item) =>
                      item.lane === "score" &&
                      item.path &&
                      audioTimelineBox(film, item, shots, clips, zoom, actualMixPlan),
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      className="clip m"
                      style={audioTimelineBox(film, item, shots, clips, zoom, actualMixPlan)!}
                    >
                      <Wave clip={item} verifiedKey={waveformKeys[item.id]} />
                      <span className="tx">
                        导入的音乐
                        {item.durationSeconds > 0 ? "" : " · 波形时长未确定"}
                        {shots.some((shotItem) => shotItem.line.trim()) ? " · 说话时变小" : ""}
                      </span>
                    </div>
                  ))}
              </div>
              {range && span && clips[span.from] && clips[span.to] && (
                <div
                  className="range"
                  style={{
                    left: clips[Math.min(span.from, span.to)]!.left,
                    width:
                      clips[Math.max(span.from, span.to)]!.left +
                      clips[Math.max(span.from, span.to)]!.width -
                      clips[Math.min(span.from, span.to)]!.left,
                  }}
                >
                  <span className="h l">入 {clock(start)}</span>
                  <span className="h r">出 {clock(start + (current?.seconds ?? 0))}</span>
                </div>
              )}
              <div className="playhead" style={{ left: headLeft }} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
