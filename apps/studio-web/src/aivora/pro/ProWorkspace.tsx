import { prepareShotSceneReferences } from "./actions/scene-references";
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
import { exportFilmSelection } from "./actions/export-selection";
import { revoiceFilmShot } from "./media-tasks";
import { deleteCurrentFilm } from "./delete-workflow";
import { makeFourStills } from "./still-workflow";
import {
  cutPosition,
  cutSegments,
  cutTimeAt,
  editClipLayout,
  playheadX,
  pointAt,
  shotReady,
  spacedTicks,
  ticksOutsideFolds,
  timelineSeconds,
  xAtSeconds,
} from "./edit-timeline";
import {
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
  filmFileName,
  LOUDNESS_NOTE,
  assignActionBeats,
  moveShot,
  portraitPrompts,
  shotProgress,
  PREVIEW_REASON,
  voiceLabel,
  removeShot,
  generationEstimate,
  spokenLine,
  draftFaceWarning,
  dialogueTracks,
  previewMix,
  fitShotToLine,
  subtitleCues,
  updateShot,
} from "../film/operations";
import { dbToVolumePercent, volumePercentToDb, type AudioClip } from "../film/audio";
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
  middlePath,
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
  ["I / O", "剪辑页设入点 / 出点"],
  ["M", "预览静音 / 有声"],
  ["Esc", "关掉菜单和对话框"],
];

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

function BedAudio({ src, playing }: { src: string; playing: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
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
  playing,
  audible,
  sound = true,
  onPlaying,
  onTime,
  seek = null,
  onDuration,
}: {
  src: string;
  voice?: string;
  music?: string;
  playing: boolean;
  audible: boolean;
  sound?: boolean;
  onPlaying: (value: boolean) => void;
  onTime: (seconds: number) => void;
  /** 3JR-U01: jump here; a new object each time, even for the same second. */
  seek?: { seconds: number } | null;
  /** The real length of the video, once the player knows it. */
  onDuration?: (seconds: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
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
      video.muted = !audible;
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
  }, [audible, playing, src]);
  return (
    <>
      <video
        ref={ref}
        className="frame"
        src={src}
        playsInline
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
      <BedAudio src={voice} playing={playing && sound} />
      <BedAudio src={music} playing={playing && sound} />
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
  const [partialExport, setPartialExport] = useState<string[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const workOwners = useWorkOwners(film?.id ?? "");
  const exporting = workOwners.busy("export");
  const [asking, setAsking] = useState(false);
  const [pendingRetry, setPendingRetry] = useState<{
    role: Role;
    context: string;
    instruction: string;
    origin?: EditorSelection;
  } | null>(null);
  const [confirmSignIn, setConfirmSignIn] = useState(false);
  const [range, setRange] = useState(false);
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
  const [hearLane, setHearLane] = useState<"" | "dialogue" | "score">("");
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
  const [diskError, setDiskError] = useState("");
  const [pendingBatch, setPendingBatch] = useState<FilmShot[] | null>(null);
  const [exportDir, setExportDir] = useState("");
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
    if (next) next = applyContinuityChecks(next);
    filmRef.current = next;
    setFilmState(next);
  }
  const persistence = useMemo(
    () => createFilmPersistence({ current: () => filmRef.current, write: writeFilm }),
    [],
  );
  const saveFilm = (next: FilmProject) => persistence.save(next);
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
      if (settled.interrupted) setNotice("上次有生成没做完，已标成已中断。可以重试。");
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
    if (!film) return;
    if (historyScope.current.page !== stage && committed.current?.id === film.id) {
      pageHistory.record(committed.current, film, historyScope.current);
      committed.current = film;
    }
    historyScope.current = editorSelection.current;
    const generation = ++saveGeneration.current;
    const savingId = film.id;
    const flush = () => {
      void persistence.flush().catch(() => undefined);
    };
    window.addEventListener("beforeunload", flush);
    setSavingDisk(true);
    const handle = window.setTimeout(() => {
      void saveFilm(film)
        .then((stored) => {
          if (generation !== saveGeneration.current) return;
          if (!stored) {
            setSavingDisk(false);
            return;
          }
          if (stored.directory && stored.directory !== BROWSER_DIRECTORY) {
            setDiskFilmId(savingId);
            setDiskPath(stored.directory);
            setDiskError("");
          }
          setSavingDisk(false);
        })
        .catch(() => {
          if (generation === saveGeneration.current) {
            setDiskError("没有写到应用数据目录，可以重试。");
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
    window.aijian?.onFlush?.(() => {
      void persistence.flush().then(
        () => window.aijian?.flushed?.(),
        () => {
          setDiskError("没有写到应用数据目录，可以重试。");
          window.aijian?.flushed?.();
        },
      );
    });
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
    setNotice("正在打开浏览器。页面上写的是 Grok Build，点 Allow 即可。");
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
              : `导演拆好了。点「写入分镜」才会写入。${supplementWarnings.current.join(" ")}`,
          );
        } else finishTurn(turn, `${result.detail} 没有写入镜头。`);
        return;
      }
      const reply = await completeAgent(job.role, job.context, job.instruction);
      if (valid()) finishTurn(turn, `${reply.detail || "模型没有按格式返回。"} 没有写入镜头。`);
    } catch {
      if (valid()) finishTurn(turn, "这次没有写完。没有写入镜头。");
    } finally {
      if (activeTurn.current === turn) {
        writing.current = false;
        setAsking(false);
      }
    }
  }

  function applyPending() {
    const card = roleCards[role];
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
        setNotice("没有写到应用数据目录，可以重试。");
        return;
      }
      const latest = filmRef.current;
      if (!latest) return;
      void fillCast(latest);
      setNotice(
        draft.transaction.kind === "writer"
          ? "已放入剧本。你改过的场没有被盖掉。"
          : "已写入分镜。你改过的镜头没有被盖掉。",
      );
      const placed = turnsRef.current.map((item) =>
        item.who === "agent" && item.text.includes("才会写入")
          ? {
              ...item,
              text: draft.transaction.kind === "writer" ? "剧本已经写入。" : "镜头已经写入分镜。",
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
        setNotice("没有写到应用数据目录，可以重试。");
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
    if (workOwners.has(current.id, "portraits")) return;
    const release = workOwners.begin(current.id, "portraits");
    try {
      const valid = requestSequences.current.begin(
        current.id,
        "portraits",
        () => filmRef.current?.id ?? "",
      );
      await makeAllPortraits({
        base: current,
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
        generate: (prompt, references) => requestFilmStill(current, prompt, references),
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
          stored ? "已写入这一镜。你改过的字没有被盖掉。" : "没有写到应用数据目录，可以重试。",
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
        setNotice("没有写到应用数据目录，可以重试。");
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
            ? "已写入画风、外貌、场景和道具。你改过的外貌没有被盖掉。"
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
    artDraft.current = transaction;
    setStructured(result.lines);
    publishCard("art", {
      artDiff: transaction,
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
    finishTurn(turn, "美术写好了。点「写入分镜」才会写入外貌、场景和道具。");
    noteAgent("art", "art", "美术写好了。点「写入分镜」才会写入外貌、场景和道具。");

    setPending(null);
    setPendingRole(null);
  }

  function planPrompter() {
    return withForeground(planPrompterWork, "PLANPROMPTER_FAILED");
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
      setNotice(connected ? PREVIEW_REASON : "配音需要 Grok 会员。");
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
          ? "配音加载超时，可以重试。"
          : preview
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
      setNotice("这句话超过 15 秒，拆成两镜。点「写入分镜」才会写入。");
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
      const ready = await prepareSceneMedia(base, [current], valid);
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
    if (!id || generationRuns.current.has(id)) return;
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
    const selected = preflight.selected;
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
    const canSubmit = gate.enabled && Boolean(billingProject && bridge?.createStoryFilm);
    const blocked = !gate.enabled ? gate.reason : DESKTOP_REASON;
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
      const styleFailure = styleFailureNotice(error) ?? continuityFailureNotice(error);
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

  async function startExport(directoryOverride?: string, allowPartial = false) {
    const bridge = window.aijian;
    if (!bridge?.exportFilmCut || !bridge.pickFilmFolder) {
      setNotice("导出要在桌面版里选择文件夹。网页里不能写成片。");
      return;
    }
    const current = filmRef.current;
    if (!current || workOwners.has(current.id, "export")) return;
    const valid = requestSequences.current.begin(
      current.id,
      "export",
      () => filmRef.current?.id ?? "",
    );
    const plan = chosenExport(current);
    if (plan.paths.length === 0) {
      setNotice(
        plan.missing.length > 0
          ? `还没生成：${plan.missing.join("、")}。`
          : "还没有可以导出的视频。",
      );
      return;
    }
    if (plan.missing.length > 0 && !allowPartial) {
      setPartialExport(plan.missing);
      setNotice(`还没生成：${plan.missing.join("、")}。可以只导出已生成的。`);
      return;
    }
    const release = workOwners.begin(current.id, "export");
    setNotice("正在导出。");
    try {
      const result = await exportFilmSelection(
        current,
        plan.paths,
        directoryOverride || exportDir,
        {
          current: () => filmRef.current,
          valid,
          apply: applyLive,
        },
        exportAspects,
      );
      if (!valid() || result.status === "stale") return;
      if (result.directory) setExportDir(result.directory);
      if (result.primaryPath) setExportFile(result.primaryPath);
      if (result.status === "done")
        setNotice({
          code: "EXPORT_DONE",
          text: NOTICE_TEXT.EXPORT_DONE,
          detail: result.outputs
            .map((output) => `${output.aspectRatio}：${output.path}`)
            .join("；"),
        });
      else if (result.status === "partial")
        setNotice({
          code: "EXPORT_FAILED",
          text: NOTICE_TEXT.EXPORT_FAILED,
          detail: `已保存 ${result.outputs.length} 个文件，其余没有导出，请重试。`,
        });
      else
        emitNotice({
          code: result.status === "cancelled" ? "EXPORT_FOLDER_REQUIRED" : "EXPORT_FAILED",
          text: result.status === "cancelled" ? "没有选择文件夹。" : NOTICE_TEXT.EXPORT_FAILED,
        });
    } catch (error) {
      if (valid())
        emitNotice({
          code:
            error instanceof Error && "code" in error && error.code === "EXPORT_CANCELLED"
              ? "EXPORT_FOLDER_REQUIRED"
              : "EXPORT_FAILED",
          text:
            error instanceof Error && "code" in error && error.code === "EXPORT_CANCELLED"
              ? "没有选择文件夹。"
              : "没有导出成功，可以重试。",
          detail: error instanceof Error ? error.message : undefined,
        });
    } finally {
      release();
    }
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
  const canCropAspect =
    typeof window !== "undefined" && "cancelFilmExport" in (window.aijian ?? {});
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
          ? "上次有生成没做完，已标成已中断。可以重试。"
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
  // 4C-U03: 设置, the person's own defaults on this computer.
  const [appSettings, setAppSettings] = useState(false);
  const [prefs, setPrefs] = useState(readPrefs);
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
  const shotAssistant = (
    <Assistant
      role={role}
      onRole={chooseRole}
      pending={pendingRole === role ? pending : null}
      onApply={applyPending}
      onReject={() => markApplied(role)}
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
    />
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
            <button
              className="proj"
              data-menu="project"
              aria-label="作品"
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
            {menu === "project" && (
              <div className="menu" role="menu" aria-label="作品菜单" data-menu="project">
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
                <input
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
                    setMenu(null);
                    setNotice("已改作品名。");
                  }}
                />
                <button
                  onClick={() => {
                    if (!film || !rename.trim()) return;
                    void renameFilm(film.seriesId, rename.trim());
                    applyLive({ ...film, title: rename.trim(), seriesTitle: rename.trim() });
                    setMenu(null);
                    setNotice("已改作品名。");
                  }}
                >
                  保存名字
                </button>
                <button
                  onClick={() => {
                    deleteTarget.current = "episode";
                    setMenu(null);
                    setPendingDelete(true);
                  }}
                >
                  删除这一集
                </button>
                <button
                  onClick={() => {
                    deleteTarget.current = "series";
                    setMenu(null);
                    setPendingDelete(true);
                  }}
                >
                  删除这部作品
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    setWorkSettings(true);
                  }}
                >
                  作品设置
                </button>
              </div>
            )}
          </div>
          <nav className="tabs" aria-label="创作阶段">
            {STAGES.map((item, index) => {
              // UIR-06: ticked only when that part is done; otherwise how far it got.
              const progress = open && film && item.id !== "edit" ? stageTabs(film)[item.id] : null;
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
          <div className="tb-right">
            {exportView.ready ? null : (
              <span className="export-why" id="export-why">
                {exportView.why}
              </span>
            )}
            <button
              className={exportView.lead ? "btn primary" : exportView.ready ? "btn" : "btn off"}
              aria-describedby={exportView.ready ? undefined : "export-why"}
              onClick={() => {
                setExportOpen(true);
                if (!exportDir && prefs.exportDir) setExportDir(prefs.exportDir);
                else if (!exportDir) {
                  void window.aijian?.defaultFilmFolder?.().then((dir) => {
                    if (dir) setExportDir(dir);
                  });
                }
              }}
            >
              <Ic name="upload" size={15} />
              导出成片
            </button>
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
                  onReject={() => markApplied(role)}
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
                  onRedoRange={redoFromReview}
                  onDismiss={keepReview}
                  onReject={() => markApplied(role)}
                />
              )}
              {stage === "board" && bench && (
                <GeneratePage
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
                  onMute={() => setSoundOn((value) => !value)}
                  assistant={shotAssistant}
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
                    const ids = new Set(
                      film.shots.filter((item) => item.sceneId === sceneId).map((item) => item.id),
                    );
                    setFilm({
                      ...film,
                      audioClips: film.audioClips.map((clip) =>
                        clip.lane === "dialogue" && ids.has(clip.shotId)
                          ? { ...clip, gainDb: db }
                          : clip,
                      ),
                    });
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
                  onMarkIn={() => {
                    setSpan({ from: shot, to: span?.to ?? shot });
                    setRange(true);
                    setComparing(true);
                    setRightTab("fix");
                  }}
                  onMarkOut={() => {
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
                    if (lane === "score" && gainDb > -40) scoreGain.current = gainDb;
                    applyLive({
                      ...live,
                      audioClips: live.audioClips.map((clip) =>
                        clip.lane === lane ? { ...clip, gainDb } : clip,
                      ),
                    });
                    setNotice(gainDb <= -40 ? "这一轨已静音。" : "音量已记下，导出时用这个音量。");
                  }}
                  onSolo={(lane) => {
                    setHearLane((current) => {
                      const next = current === lane ? "" : lane;
                      setNotice(
                        next === "score"
                          ? "只听配乐。音量没有改。"
                          : next === "dialogue"
                            ? "只听对白。音量没有改。"
                            : "所有声音一起听。",
                      );
                      return next;
                    });
                  }}
                  musicRestore={scoreGain.current}
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
                  onRangeGenerate={() => {
                    const from = span?.from ?? shot;
                    const to = span?.to ?? shot;
                    // 4A-U10: making a video always opens the same 单镜 panel; a longer part
                    // of the cut is queued shot by shot.
                    if (from === to) {
                      setRange(false);
                      setComparing(false);
                      setShot(from);
                      setBench(true);
                      setStage("board");
                      return;
                    }
                    const rows = shownShots.slice(Math.min(from, to), Math.max(from, to) + 1);
                    if (rows.length === 0) return;
                    setPendingBatch(rows);
                    const names = rows
                      .map((item) => {
                        const no = film?.scenes.find((row) => row.id === item.sceneId)?.no;
                        return no ? `第 ${no} 场第 ${item.no} 个镜头` : `第 ${item.no} 个镜头`;
                      })
                      .join("、");
                    setNotice(`只重做${names}。在确认表里点「开始生成」才会出视频。`);
                  }}
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
                      const latest = filmRef.current ?? film;
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
        <footer className="statusbar">
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
          <button
            className="task"
            data-menu="queue"
            onClick={() => setMenu(menu === "queue" ? null : "queue")}
          >
            <Ic name="loader" size={12} />
            后台生成：
            {asking
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
          <span className="sp" />
          <span className="where">
            {savedDirectory
              ? "作品保存在"
              : savingDisk
                ? "正在保存…"
                : diskError || (filmDiskReady() ? "已保存在这台电脑上" : BROWSER_DIRECTORY)}{" "}
            <b>{savedDirectory || film?.title || ""}</b>
          </span>
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
                    <th>声音来源</th>
                    <th>配乐</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingBatch.map((item) => (
                    <tr key={item.id}>
                      <td>镜头 {item.no}</td>
                      <td>{item.seconds}</td>
                      <td>{item.line.trim() || "无"}</td>
                      <td>{item.line.trim() ? "另外配音" : "无台词"}</td>
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
              {pendingBatch.some((item) => fitShotToLine(item).warning) ? (
                <p>
                  {pendingBatch
                    .map((item) => fitShotToLine(item).warning)
                    .filter(Boolean)
                    .join("")}
                </p>
              ) : null}
              <div className="acts">
                <button
                  className="btn primary"
                  onClick={() => {
                    const rows = pendingBatch;
                    setPendingBatch(null);
                    if (rows && filmRef.current) {
                      applyLive({
                        ...filmRef.current,
                        shots: filmRef.current.shots.map(
                          (shot) => rows.find((item) => item.id === shot.id) ?? shot,
                        ),
                      });
                    }
                    void submitGeneration(rows ?? undefined);
                  }}
                >
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
        {workSettings && film ? (
          <div className="dialog-back">
            <div className="dialog work-settings" role="dialog" aria-label="作品设置">
              <h2>作品设置 · {film.seriesTitle || film.title}</h2>
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
                {/* GPT 4C-B02 gives the kept versions and restores one (next/INTEGRATION.md). */}
                <HistoryList entries={null} onRestore={() => undefined} />
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
                  <div className="field">
                    <label htmlFor="export-dir">保存到</label>
                    <div className="pathrow">
                      {/* The box shows a long path with its middle cut out; typing shows all of it. */}
                      <div className="pathfield" data-layer title={exportDir}>
                        <input
                          id="export-dir"
                          className="input"
                          aria-label="导出文件夹"
                          value={exportDir}
                          placeholder="点「浏览」选一个文件夹"
                          onChange={(event) => setExportDir(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            const path = event.currentTarget.value.trim();
                            if (!path) return;
                            setExportDir(path);
                            void startExport(path);
                          }}
                        />
                        {exportDir ? (
                          <span className="pathshow" aria-hidden="true">
                            {middlePath(exportDir)}
                          </span>
                        ) : null}
                      </div>
                      <button
                        className="btn sm"
                        type="button"
                        onClick={() => {
                          void window.aijian?.pickFilmFolder?.().then((dir) => {
                            if (dir) setExportDir(dir);
                          });
                        }}
                      >
                        浏览
                      </button>
                    </div>
                  </div>
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
                  {partialExport && partialExport.length > 0 ? (
                    <p className="role-desc">还有镜头没生成，可以只导出已生成的。</p>
                  ) : null}
                  {/* 4B-U06: the export's progress stays in the dialog. */}
                  {exporting ? (
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
                    {partialExport && partialExport.length > 0 && (
                      <button className="btn" onClick={() => void startExport(exportDir, true)}>
                        只导出已生成的
                      </button>
                    )}
                    <button
                      className="btn primary"
                      disabled={exporting}
                      onClick={() => void startExport()}
                    >
                      {exporting ? "正在导出" : "导出"}
                    </button>
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
}) {
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
        {listScenes || listShots ? (
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
): { seconds: number; left: number }[] {
  const total = shots.reduce((sum, item) => sum + item.seconds, 0);
  const step = total > 120 ? 10 : 5;
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
  /** 4A-U09: 导出成片 is this screen's primary button, so this page's steps back. */
  quiet?: boolean;
  /** 「下一步：分镜」, the primary button once everyone has an appearance and four portraits. */
  onNext?: () => void;
}) {
  const [who, setWho] = useState(0);
  const [place, setPlace] = useState(0);
  const [side, setSide] = useState<"people" | "places" | "props">("people");
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
          {side === "people" &&
            film.characters.map((item, index) => (
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
            ))}
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
                <label htmlFor="narration-voice">旁白</label>
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
                    <option value={film.narrationVoiceId}>
                      {voiceLabel(film.narrationVoiceId)}
                    </option>
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
                    const state = url ? "done" : (slot?.state ?? "empty");
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
        <Assistant
          solo
          role={role}
          onRole={onRole}
          pending={null}
          onApply={() => undefined}
          shots={film.shots}
          chat={chat}
          onChat={onChat}
          onSend={onSend}
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
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readGroupOpen(id, defaultOpen));
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
      <summary>{title}</summary>
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
  quiet = false,
  onNext,
  onReject,
  film,
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
  onRedoRange,
  onDismiss,
  onRetry,
  onFixCoverage,
}: {
  film: FilmProject;
  shots: FilmShot[];
  shot: number;
  onShot: (index: number) => void;
  onScene: (id: string) => void;
  onFilm: (film: FilmProject) => void;
  onNotice: (text: string) => void;
  onGenerate: () => void;
  onBatch: () => void;
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
  // GPT's own check, saved on the scene when the director writes it or fixes its end. The page
  // does not run the check again on every edit.
  const coverage = sceneRow?.coverage && !sceneRow.coverage.ok ? sceneRow.coverage : null;
  const shotBudget = sceneRow ? sceneShotBudget(sceneRow.id, film.shots) : null;
  const allBeats = film.unassignedBeats ?? [];
  const sceneBeats = allBeats.filter((beat) => beat.sceneId === sceneRow?.id);
  // 3JR-U04: while an action is dragged the cards show where it can go.
  const [beatDrag, setBeatDrag] = useState(false);
  const [dropAt, setDropAt] = useState(-1);
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
                index === shot ? "sel" : "",
                beatDrag && dropAt === index ? "drop-over" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              // 4C-U05: the card's state is the label on its picture; who wrote it is in here.
              title={`镜头 ${item.no} · ${shotSource(item).label}`}
              onClick={() => onShot(index)}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(BEAT_DRAG_TYPE)) return;
                event.preventDefault();
                if (dropAt !== index) setDropAt(index);
              }}
              onDragLeave={() => {
                if (dropAt === index) setDropAt(-1);
              }}
              onDrop={(event) => {
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
          />
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
              <PropGroup id="sound" title="声音">
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
              <PropGroup id="advanced" title="高级">
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
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        onFilm(moveShot(film, current.id, -1));
                      }}
                    >
                      前移
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        onFilm(moveShot(film, current.id, 1));
                      }}
                    >
                      后移
                    </button>
                    {fourArmed !== current.id ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          onFour();
                        }}
                      >
                        出 4 张候选
                      </button>
                    ) : null}
                    {shotProgress(current) !== "未生成" ? (
                      <button
                        type="button"
                        disabled={Boolean(stillProgress[current.id])}
                        onClick={() => {
                          setMoreOpen(false);
                          onStills();
                        }}
                      >
                        重新生成画面
                      </button>
                    ) : null}
                    <div className="menu-sep" role="separator" />
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        setMoreOpen(false);
                        onFilm(removeShot(film, current.id));
                        onNotice("已删除这一镜。");
                      }}
                    >
                      删除这一镜
                    </button>
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
              <div className="frame rain">
                {takes.length > 0 ? (
                  <span className="badge none">{picked?.reason || "这一版还没有画面"}</span>
                ) : null}
              </div>
            )}
          </div>
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
                起始画面<span className="from role-d">这一镜自己的画面</span>
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
 * 4B-U02: the room left in an audio clip for its waveform. GPT's C3 gives the peaks
 * (`waveform`, 0–1, evenly spaced); until then the strip stays empty.
 */
function Wave({ clip }: { clip: AudioClip }) {
  const peaks = (clip as AudioClip & { waveform?: number[] }).waveform;
  if (!peaks || peaks.length < 2) return <span className="wave" aria-hidden="true" />;
  const points = peaks
    .map((peak, index) => {
      const x = (index / (peaks.length - 1)) * 100;
      const y = 50 - Math.max(0, Math.min(1, peak)) * 48;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg className="wave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
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
  lane,
  film,
  shots,
  clips,
}: {
  lane: "ambience" | "sfx";
  film: FilmProject;
  shots: FilmShot[];
  clips: { id: string; left: number; width: number }[];
}) {
  const files = film.audioClips.filter((item) => item.lane === lane && item.path);
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
            left: clips.find((clip) => clip.id === item.shotId)?.left ?? 1,
            width: Math.max(32, Math.round((item.durationSeconds || 2) * 52) - 2),
          }}
        >
          <Wave clip={item} />
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
  onMute,
  assistant = null,
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
  onNotice: _onNotice,
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
  musicRestore = -14,
  hearLane = "",
}: {
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
  onMarkIn: () => void;
  onMarkOut: () => void;
  span: { from: number; to: number } | null;
  shots: FilmShot[];
  onLane?: (lane: "dialogue" | "score", gainDb: number) => void;
  onSolo?: (lane: "dialogue" | "score") => void;
  musicRestore?: number;
  hearLane?: "" | "dialogue" | "score";
  /** 4A-U10: 「预览静音 (M)」 on the player; the switch left the top bar. */
  onMute?: () => void;
  /** 4A-U11: the same AI 助手 as 分镜, in the right column's second tab. */
  assistant?: ReactNode;
  /** 4B-U01: 这场的情绪, written to every shot of the scene (shot.sound.musicMood). */
  onSceneMood?: (sceneId: string, mood: Mood) => void;
  /** 4B-U01: the scene's voice level, written to its voice clips (gainDb). */
  onSceneVoice?: (sceneId: string, db: number) => void;
  /** 4B-U03: 「用这个样式」, kept on the work for every subtitle. */
  onSubtitleStyle?: (styleId: SubtitleStyleId) => void;
}) {
  const [monitor, setMonitor] = useState<"preview" | "sound" | "subs">("preview");
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
  const clips = editClipLayout(shots, readyCount > 0 && !unfolded);
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
  const voiceClip = film.audioClips.find(
    (clip) =>
      clip.lane === "dialogue" && clip.shotId === current?.id && isVoiceFile(clip.path ?? ""),
  );
  const scoreClip = film.audioClips.find((clip) => clip.lane === "score" && clip.path);
  const musicGain = scoreClip?.gainDb ?? -14;
  const dialogueGain =
    film.audioClips.find((clip) => clip.lane === "dialogue" && clip.path)?.gainDb ?? 0;
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
  const mix = previewMix({
    joined: Boolean(film.assemblyUrl),
    voice: fileMediaUrl(voiceClip?.path),
    music: fileMediaUrl(scoreClip?.path),
    dialogueMuted: dialogueMuted(film),
    solo: hearLane,
    musicHeard: Boolean(scoreClip) && (hearLane === "score" || (scoreClip?.gainDb ?? -14) > -40),
  });
  const voiceSrc = mix.voice;
  const musicSrc = mix.music;
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
              <span className="meta">{film.title}</span>
              <span className="sp" />
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
              <>
                <div className="screen">
                  {previewSrc ? (
                    <PreviewVideo
                      src={previewSrc}
                      voice={voiceSrc}
                      music={musicSrc}
                      playing={playing}
                      audible={audible && mix.hearVideo}
                      sound={audible}
                      onPlaying={onPlaying}
                      onTime={showTime}
                      seek={seek}
                      onDuration={joined ? setCutLength : setTakeLength}
                    />
                  ) : (
                    <div className="frame rain">
                      <span className="subt">
                        {shots.filter((item) => item.takes.some((take) => take.videoUrl)).length > 1
                          ? ROUGH_CUT_REASON
                          : "还没有可以播放的视频。"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="ctrl">
                  <span className="tc">
                    <b>{clock(headSeconds)}</b> / {clock(total)}
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
              </>
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
              <p className="role-desc">重做、换配音、剪掉，用下面时间线上的按钮。</p>
            </div>
            <p className="role-desc hint">
              有台词时，导出会把配乐压低
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
            {/* 4C-U01: the whole part between in and out, and a note when a line is in it. */}
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
                title="台词不会从中间切开：选到一句台词的一部分，重做时这一整句都会重来。"
              >
                这句台词会整句重来
              </span>
            ) : null}
            {/* 4A-U10: one 重新生成. One shot opens its 单镜 panel, a longer part is queued. */}
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
            <button className="btn" title={actions.cut.reason} onClick={() => onAction("cut")}>
              <Ic name="trash" size={13} />
              剪掉
            </button>
            <span className="sp" />
            {importMusic}
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
              title="删除选中的镜头"
              onClick={() => onAction("cut")}
            >
              <Ic name="trash" />
            </button>
            <span className="vsep" />
            <button className="icon-btn" aria-label="设入点" title="设入点 (I)" onClick={onMarkIn}>
              <Ic name="bracketL" />
            </button>
            <button className="icon-btn" aria-label="设出点" title="设出点 (O)" onClick={onMarkOut}>
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
            {importMusic}
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
              <span className="lane-controls">
                <button
                  type="button"
                  aria-label="静音对白"
                  onClick={() => {
                    const muted = film.audioClips.some(
                      (clip) => clip.lane === "dialogue" && clip.gainDb <= -40,
                    );
                    onLane?.("dialogue", muted ? 0 : -80);
                  }}
                >
                  静音
                </button>
                <button type="button" aria-label="单听对白" onClick={() => onSolo?.("dialogue")}>
                  单听
                </button>
                <input
                  aria-label="对白音量"
                  title={`对白音量 ${dbToVolumePercent(dialogueGain)}`}
                  type="range"
                  min={0}
                  max={100}
                  value={dbToVolumePercent(dialogueGain)}
                  onChange={(event) =>
                    onLane?.("dialogue", volumePercentToDb(Number(event.target.value)))
                  }
                />
              </span>
            </div>
            {/* 4B-U02: 环境音 and 音效 have their own tracks; until there are sound files they
                only show what was written for each shot. */}
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-amb)" }} />
              <Ic name="vol" size={13} />
              环境音
            </div>
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-sfx)" }} />
              <Ic name="spark" size={13} />
              音效
            </div>
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-music)" }} />
              <Ic name="music" size={13} />
              配乐
              <span className="lane-controls">
                <button
                  type="button"
                  aria-label="静音配乐"
                  onClick={() => {
                    const muted = film.audioClips.some(
                      (clip) => clip.lane === "score" && clip.gainDb <= -40,
                    );
                    onLane?.("score", muted ? musicRestore : -80);
                  }}
                >
                  静音
                </button>
                <button type="button" aria-label="单听配乐" onClick={() => onSolo?.("score")}>
                  单听
                </button>
                <input
                  aria-label="配乐音量"
                  title={`配乐音量 ${dbToVolumePercent(musicGain)}`}
                  type="range"
                  min={0}
                  max={100}
                  value={dbToVolumePercent(musicGain)}
                  onChange={(event) =>
                    onLane?.("score", volumePercentToDb(Number(event.target.value)))
                  }
                />
              </span>
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
                {spacedTicks(ticksOutsideFolds(rulerTicks(shots, clips), clips)).map((tick) => (
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
              <div className="lane" style={{ height: "var(--hv)" }}>
                {clips.map((clip, index) => {
                  const item = shots[index];
                  const ready = item ? shotReady(item) : false;
                  const name = `镜头 ${item?.no ?? index + 1}`;
                  const waiting = `${name} 还没生成（${item?.seconds ?? 0} 秒）`;
                  return (
                    <button
                      key={clip.id}
                      className={
                        ready ? "clip v" : clip.folded ? "clip v empty folded" : "clip v empty"
                      }
                      style={{ left: clip.left, width: clip.width }}
                      title={ready ? undefined : waiting}
                      aria-label={clip.folded ? "未生成" : undefined}
                      onClick={(event) => {
                        // A keyboard press has no pointer position: go to the clip's start.
                        seekTo(event.detail === 0 ? clip.left : areaX(event.clientX));
                        onShot(index);
                        onPickClip();
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
                {film.audioClips.some((item) => item.lane === "dialogue" && item.path) ? null : (
                  <span className="lane-empty">这一轨还没有内容</span>
                )}
                {film.audioClips
                  .filter((item) => item.lane === "dialogue" && item.path)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="clip a"
                      data-voice={isVoiceFile(item.path ?? "") ? "1" : undefined}
                      style={{
                        left: clips.find((clip) => clip.id === item.shotId)?.left ?? 1,
                        width: Math.max(48, Math.round((item.durationSeconds || 2) * 52) - 2),
                      }}
                    >
                      <Wave clip={item} />
                      <span className="tx">{item.label || "对白"}</span>
                    </div>
                  ))}
              </div>
              <PlanLane lane="ambience" film={film} shots={shots} clips={clips} />
              <PlanLane lane="sfx" film={film} shots={shots} clips={clips} />
              <div className="lane" style={{ height: "var(--ha)" }}>
                {film.audioClips.some((item) => item.lane === "score" && item.path) ? null : (
                  <span className="lane-empty">这一轨还没有内容</span>
                )}
                {film.audioClips
                  .filter((item) => item.lane === "score" && item.path)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="clip m"
                      style={{
                        left: 1,
                        width: Math.max(
                          48,
                          clips.reduce((sum, clip) => sum + clip.width, 0),
                        ),
                      }}
                    >
                      <Wave clip={item} />
                      <span className="tx">
                        导入的音乐
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
