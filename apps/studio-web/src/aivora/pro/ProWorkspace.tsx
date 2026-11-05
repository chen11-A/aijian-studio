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
import { buildLegacyStoryboard } from "./actions/legacy-storyboard";
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
import { createPipelineWorkspaceHost, type PipelineVideoHost } from "./pipeline-workspace-host";
import { createFilmPersistence } from "./film-persistence";
import { stillFailureNotice } from "./workflow";
import { coverageNotice } from "../film/coverage-notice";
import { useProductionActions } from "./use-production-actions";
import { BatchProgressView } from "../next/wiring/BatchProgressView";
import { useWorkOwners } from "./use-work-owners";
import { exportFilmTask, revoiceFilmShot } from "./media-tasks";
import { deleteCurrentFilm } from "./delete-workflow";
import { makeFourStills } from "./still-workflow";
import { useEffect, useId, useMemo, useRef, useState, type SetStateAction } from "react";
import {
  addShot,
  clipLayout,
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
import { dbToVolumePercent, volumePercentToDb } from "../film/audio";
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
import type { UiNotice } from "../film/contracts3j";
import { enrichDirectorPlan } from "./enrichment-workflow";
import { makeAllPortraits } from "./portrait-workflow";
import { applyDirectorPlan, RequestSequences } from "./director-workflow";
import { directorPlanStatus, sceneDisplayTitle } from "../film/director-continuity";
import { completeMembershipAgent } from "./agent-workflow";
import { publishFilmJobs } from "../film/task-progress";
import { TaskCenter } from "../next/TaskCenter";
import { feedProgress, namedTasks, useTaskFeed } from "../next/wiring/taskFeed";
import { useCoverageRepair } from "../next/wiring/useCoverageRepair";
import { useStatusNotice } from "../next/wiring/statusNotice";
import { portraitFeed, type PortraitFeed } from "../next/wiring/portraitFeed";
import { NoticeLog } from "../next/NoticeLog";
import { BEAT_DRAG_TYPE, SceneAlerts } from "../next/SceneAlerts";
import { HomeStart, type Aspect } from "../next/HomeStart";
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

const STAGES: { id: Stage; label: string }[] = [
  { id: "script", label: "剧本" },
  { id: "cast", label: "角色与场景" },
  { id: "board", label: "分镜" },
  { id: "edit", label: "剪辑" },
];

const SIGN_IN_NOTE = "请打开安装好的 AIVORA 再登录。";
const ROUGH_CUT_REASON = "多镜头没有接上，没有导出。";

const ROLE_COPY: Record<Role, string> = {
  writer: "编剧：把想法或小说收成一场一场的剧本。确认前不会改你写过的字。",
  director: "导演：把剧本拆成镜头，定好景别、时长和节奏。",
  action: "动作指导：把打斗拆成一拍一拍的动作，标出力度、方向和慢镜。",
  performance: "表演指导：给每个镜头写情绪、眼神和语气。两人以上要写视线交接。",
  art: "美术：定画风，给每个角色一句固定外貌，并写下场景和道具。",
  prompter: "提示词工程师：把这一镜写成中文提示词。英文放在高级里。",
  qc: "审片：只会给出对文字的意见，版本仍由你选。",
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
}: {
  src: string;
  voice?: string;
  music?: string;
  playing: boolean;
  audible: boolean;
  sound?: boolean;
  onPlaying: (value: boolean) => void;
  onTime: (seconds: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const onPlayingRef = useRef(onPlaying);
  const onTimeRef = useRef(onTime);
  onPlayingRef.current = onPlaying;
  onTimeRef.current = onTime;
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

function displayableImage(url: string | undefined): string {
  return fileMediaUrl(url);
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
  const [scene, setScene] = useState("02");
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
  const [oneClickReady, setOneClickReady] = useState(false);
  const [range, setRange] = useState(false);
  const [span, setSpan] = useState<{ from: number; to: number } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [fixAction, setFixAction] = useState<FixAction>("rewrite");
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
  const pipelineWorkspace = useMemo(
    () =>
      createPipelineWorkspaceHost({
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
      }),
    [persistence],
  );
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
    filmRef.current = film;
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
    if (film.scenes.some((item) => item.id === scene)) return;
    setScene(film.scenes[0]?.id ?? "scene-1");
  }, [film, scene]);

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
    return withForeground(oneClickFilmWork, "ONECLICKFILM_FAILED");
  }

  async function oneClickFilmWork() {
    if (!film) return;
    const turn = pushTurn("director", "编剧与导演连续处理");
    supplementWarnings.current = [];
    const valid = () => filmRef.current?.id === film.id && activeTurn.current === turn;
    setAsking(true);
    setOneClickReady(false);
    setNotice("正在让编剧和导演写到分镜。还不会出视频。");
    const result = await buildLegacyStoryboard(film, {
      current: () => filmRef.current,
      valid,
      request: completeAgent,
      apply: setFilm,
      fillCast,
      enrich: completeDirectorPlan,
      merge: (base, sceneId, shots) =>
        applyDirectorPlan(base, shots, sceneId, unassignedDraft.current),
      progress: setNotice,
      notify: emitNotice,
    });
    if (result.kind === "stale") return;
    if (result.kind === "stopped") {
      writing.current = false;
      setAsking(false);
      setOneClickReady(true);
      setNotice(result.text);
      return;
    }
    const next = result.film;
    const shown = next.scenes.find((item) =>
      next.shots.some((shotItem) => shotItem.sceneId === item.id),
    );
    if (shown) setScene(shown.id);
    setShot(0);
    setStage("board");
    setPending(null);
    setPendingRole(null);
    writing.current = false;
    setAsking(false);
    setOneClickReady(true);
    const planStatus = next.scenes.map((scene) => ({
      title: scene.title,
      ...directorPlanStatus(scene, next.shots),
    }));
    const code = planStatus.some((status) => !status.coverage.ok)
      ? "COVERAGE_INCOMPLETE"
      : planStatus.some((status) => status.overBudget)
        ? "DIRECTOR_OVER_BUDGET"
        : "STORYBOARD_READY";
    setNotice({
      code,
      text: NOTICE_TEXT[code],
      detail: [
        ...planStatus
          .filter((status) => !status.coverage.ok || status.overBudget)
          .map((status) =>
            status.coverage.ok
              ? `${status.title}：${status.shotCount}/${status.target}`
              : `${status.title}：${coverageNotice(status.coverage).detail}`,
          ),
        ...supplementWarnings.current,
      ].join("；"),
    });
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
      setNotice(!soundOn ? "声音关着。打开顶栏的声音再试听。" : "已停止试听。");
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
      const result = await exportFilmTask(current, plan.paths, directoryOverride || exportDir, {
        current: () => filmRef.current,
        valid,
        apply: applyLive,
      });
      if (!valid()) return;
      setExportDir(result.directory);
      setExportFile(result.path);
      setNotice(`已导出到 ${result.path}`);
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
  // UI wiring (3J-U04): one status message at a time, worded by its code, gone after 5 seconds;
  // past messages are listed in the task center.
  const status = useStatusNotice(notice);
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
  useEffect(() => {
    if (!film || oneClickFromHome.current !== film.id) return;
    oneClickFromHome.current = "";
    void oneClickFilm();
  }, [film]);
  useEffect(() => {
    if (!open) void listFilms().then(setSeriesList);
  }, [open]);
  // UI wiring (3J-U02): each page opens with its own helper in the assistant. Only a page
  // change picks it; chooseRole is a new function on every render.
  useEffect(() => {
    const helper = PAGE_ROLE[stage];
    if (helper) chooseRole(helper);
  }, [stage]);

  return (
    <div
      className="pro-root"
      style={{ overflow: "hidden", maxWidth: "100vw", width: "100%" }}
      data-stage={stage}
      data-sample={open ? "open" : "empty"}
      data-generate={actions.regenerate.enabled ? "on" : "off"}
    >
      <div className="app">
        <header className="topbar">
          <div className="tb-left">
            <div className="logo">
              <div className="logo-mark">A</div>
              AIVORA
            </div>
            <span className="vsep" />
            <button
              className="proj"
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
              title="撤销"
              disabled={!canUndo}
              onClick={undoEdit}
            >
              <Ic name="undo" />
            </button>
            <button
              className="icon-btn"
              aria-label="重做"
              title="重做"
              disabled={!canRedo}
              onClick={redoEdit}
            >
              <Ic name="redo" />
            </button>
            {menu === "project" && (
              <div className="menu" role="menu" aria-label="作品菜单">
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
                            ? "上次有生成没做完，已标成已中断。可以重试。"
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
                    setStage("cast");
                    setNotice("画风在角色与场景，每镜次数在单镜工作台。");
                  }}
                >
                  作品设置
                </button>
              </div>
            )}
          </div>
          <nav className="tabs" aria-label="创作阶段">
            {STAGES.map((item, index) => {
              const done = open && index < STAGES.findIndex((stageItem) => stageItem.id === stage);
              const on = item.id === stage;
              return (
                <button
                  key={item.id}
                  className={`tab${done ? " done" : ""}${on ? " on" : ""}`}
                  aria-current={on ? "page" : undefined}
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
                </button>
              );
            })}
          </nav>
          <div className="tb-right">
            <button
              className="chip"
              onClick={() => {
                if (membershipDenied) setNotice("这个会员不能用这里的模型。");
                else if (connected) setNotice("Grok 会员已连接。");
                else void signInGrok();
              }}
            >
              <span
                className="dot"
                style={connected && !membershipDenied ? undefined : { background: "#E8A33D" }}
              />
              {membershipDenied
                ? "会员不能用这个功能"
                : connected
                  ? "Grok 会员 · 已连接"
                  : signingIn || account.state === "AWAITING_BROWSER"
                    ? "正在等浏览器"
                    : account.state === "REAUTH_REQUIRED"
                      ? "需要重新登录"
                      : "未登录"}
            </button>
            <button
              className="btn"
              type="button"
              aria-pressed={soundOn}
              onClick={() => setSoundOn((value) => !value)}
            >
              {soundOn ? "声音开" : "声音关"}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setExportOpen(true);
                if (!exportDir) {
                  void window.aijian?.defaultFilmFolder?.().then((dir) => {
                    if (dir) setExportDir(dir);
                  });
                }
              }}
            >
              <Ic name="upload" size={15} />
              导出成片
            </button>
            <button
              className="avatar"
              aria-label="账号"
              onClick={() => setMenu(menu === "account" ? null : "account")}
            >
              {connected && account.label ? (
                account.label.slice(0, 1)
              ) : (
                <Ic name="user" size={14} />
              )}
            </button>
            {menu === "account" && (
              <div className="menu" role="menu" aria-label="账号菜单">
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
                <button onClick={() => void signOutAccount()}>退出登录</button>
              </div>
            )}
          </div>
        </header>
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
                    text: "选一个小说文件。读好以后点「放入剧本」，再点「一键成片」。",
                  });
                  fileRef.current?.click();
                }}
                onBlank={(aspect) => {
                  startWork(aspect);
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
                  onUndo={undoEdit}
                  onRedo={redoEdit}
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
                  onTemplate={applyTemplate}
                />
              )}
              {stage === "cast" && (
                <CastPage
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
                    setNotice("已换成这一条构图。");
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
                  card={
                    roleCards[role]?.shots &&
                    roleCards[role]?.shots.every((item) => item.sceneId !== scene)
                      ? null
                      : (roleCards[role] ?? null)
                  }
                  qcCard={roleCards.qc ?? null}
                  onRedoRange={() => {
                    setStage("edit");
                    setRange(true);
                    setNotice("已选中这一镜。在时间线上点「只重做这一段」。");
                  }}
                  onDismiss={() => {
                    markApplied("qc");
                    setNotice("已记下审片意见。版本仍由你选。");
                  }}
                />
              )}
              {stage === "board" && bench && (
                <GeneratePage
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
                  film={film}
                  shot={shot}
                  onShot={setShot}
                  shots={shownShots}
                  range={range}
                  comparing={comparing}
                  fixAction={fixAction}
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
                    setNotice(gainDb <= -40 ? "这一路已静音。" : "音量已记下，导出时用这个音量。");
                  }}
                  onSolo={(lane) => {
                    setHearLane((current) => {
                      const next = current === lane ? "" : lane;
                      setNotice(
                        next === "score"
                          ? "只听音乐。音量没有改。"
                          : next === "dialogue"
                            ? "只听配音。音量没有改。"
                            : "各路一起听。",
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
                    const rows = shownShots.slice(Math.min(from, to), Math.max(from, to) + 1);
                    if (rows.length === 0) return;
                    setPendingBatch(rows);
                    setNotice(
                      `只重做镜头 ${rows.map((item) => item.no).join("、")}。确认表里点开始生成才会出视频。`,
                    );
                  }}
                  onClearRange={() => {
                    setRange(false);
                    setComparing(false);
                    setRightTab("props");
                  }}
                  onAction={runAction}
                  onKeep={() => {
                    setComparing(false);
                    setNotice("保留旧版。新版留在历史版本里。");
                  }}
                  onReplace={() => {
                    const current = shownShots[shot];
                    const newer = [...(current?.takes ?? [])]
                      .reverse()
                      .find(
                        (take) => take.status === "done" && take.id !== current?.selectedTakeId,
                      );
                    if (film && current && newer) {
                      setFilm({
                        ...film,
                        shots: film.shots.map((item) =>
                          item.id === current.id ? { ...item, selectedTakeId: newer.id } : item,
                        ),
                      });
                      setNotice("已用新版替换。旧版留在历史版本里。");
                    } else {
                      setNotice("还没有可以替换的新版本。");
                    }
                    setComparing(false);
                    setRange(false);
                  }}
                  onTab={setRightTab}
                  onUndo={undoEdit}
                  onRedo={redoEdit}
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
          {oneClickReady && (
            <button
              type="button"
              onClick={() => {
                const live = filmRef.current;
                if (!live || live.shots.length === 0) {
                  void oneClickFilm();
                  return;
                }
                queueBatch(live.shots);
                setOneClickReady(false);
              }}
            >
              继续出视频
            </button>
          )}
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
            {status.line?.detail ? (
              <span className="status-detail">{status.line.detail.replace(/\n/g, " · ")}</span>
            ) : null}
          </span>
          <button className="task" onClick={() => setMenu(menu === "queue" ? null : "queue")}>
            <Ic name="loader" size={12} />
            后台生成：
            {asking
              ? "AI 在写"
              : feedNow.active > 0
                ? `正在做 ${feedNow.active} 个`
                : portraitBusy
                  ? "正在出定妆照"
                  : "没有在做的"}
            <span className="bar">
              <i style={{ width: `${feed.tasks.length > 0 ? feedNow.percent : progress}%` }} />
            </span>
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
              <p>接下来会打开浏览器，进入 Grok Build 授权页。点允许后回到这里。</p>
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
                      <td>{item.line.trim() ? "单独配音" : "无台词"}</td>
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
                  ? `确认删除作品「${film?.seriesTitle || film?.title || "这部作品"}」？文件会删掉。`
                  : `确认删除「${film?.title || "这一集"}」？文件会删掉。`}
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
          <div className="task-back" data-overlay role="dialog" aria-label="后台生成">
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
                setNotice("已暂停。已经发出的请求不一定能停。");
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
                setNotice("已取消这一次。已经发出的请求不一定能停。");
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
        {exportOpen && (
          <div className="dialog-back">
            <div className="dialog export" role="dialog" aria-label="导出成片">
              <h2>导出成片</h2>
              <div className="field">
                <label>文件名</label>
                <div className="input">
                  {film
                    ? filmFileName(film.seriesTitle || film.title, film.episodeTitle || "第1集")
                    : "未命名"}
                </div>
              </div>
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
                  {exporting ? "正在导出" : "开始导出"}
                </button>
              </div>
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
}) {
  const pickId = useId();
  const scenes = role === "writer" ? pendingScenes : null;
  const list = pending ?? [];
  const talking = CHAT_ROLES.find((item) => item.id === role) ?? CHAT_ROLES[1]!;
  const chatTurns = turns.filter((item) => inChat(item.role));
  const lastRole = turns.at(-1)?.role;
  const chips =
    role === "writer"
      ? ["让编剧写", "改成短剧", "导入小说"]
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
        {(chatTurns.length > 0
          ? chatTurns.slice(-8)
          : [
              {
                id: "hint",
                role,
                who: "user" as const,
                text: "跟这位助手说说你的想法。确认之前不会改你写过的字。",
              },
            ]
        ).map((item) => (
          <div key={item.id} className={item.who === "user" ? "msg-u" : "msg-a"}>
            {item.text}
          </div>
        ))}
        {onRetry && chatTurns.at(-1)?.who === "agent" ? (
          <div className="msg-retry">
            <button className="btn sm" type="button" onClick={onRetry}>
              换个问法再问一次
            </button>
          </div>
        ) : null}
        <div className="msg-a">
          <span className="ri">
            <Ic name="clap" size={13} />
          </span>
          <div className="bubble">
            <div className="h">
              {card
                ? card.title
                : scenes
                  ? `建议写成 ${scenes.length} 场`
                  : pending
                    ? `建议拆成 ${pending.length} 个镜头`
                    : busy
                      ? "正在写"
                      : list.length > 0
                        ? "当前镜头"
                        : "暂无待写入的建议"}{" "}
              <span>
                {card
                  ? card.rows.length || card.notes.length
                  : scenes
                    ? scenes.length
                    : list.length}{" "}
                条
              </span>
            </div>
            {role === "action" && card ? <p className="role-desc">{DIFFICULTY_LEGEND}</p> : null}
            <div className="shotlist">
              {card
                ? card.rows.map((item) => (
                    <div key={item.id}>
                      <span>{item.mark}</span>
                      <span />
                      <span>{item.text}</span>
                      <span>{item.tail}</span>
                    </div>
                  ))
                : scenes
                  ? scenes.map((item) => (
                      <div key={item.id}>
                        <span>{item.no}</span>
                        <span>场</span>
                        <span>{item.where || item.title}</span>
                        <span />
                      </div>
                    ))
                  : list.map((item, index) => (
                      <div key={item.id}>
                        <span>{index + 1}</span>
                        <span>{shotPerson(item.characters, item.picture, [])}</span>
                        <span>{item.picture}</span>
                        <span>{item.seconds}s</span>
                      </div>
                    ))}
            </div>
            {structured.length > 0 && (!lastRole || inChat(lastRole)) && (
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
            )}
            {list.length === 0 && !card && !scenes && !pending ? null : (
              <div className="acts">
                {card?.mode === "qc" ? (
                  <>
                    <button className="btn primary sm" type="button" onClick={onRedoRange}>
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
                  <button
                    className="btn primary sm"
                    type="button"
                    disabled={card?.applied}
                    onClick={
                      card?.mode === "scenes" && onApplyScenes
                        ? onApplyScenes
                        : card
                          ? onApply
                          : scenes && onApplyScenes
                            ? onApplyScenes
                            : onApply
                    }
                  >
                    {card?.applied
                      ? "已写入"
                      : card?.mode === "scenes" || scenes
                        ? "放入剧本"
                        : "写入分镜"}
                  </button>
                )}
                <button className="btn sm" type="button" onClick={onSend}>
                  返回修改
                </button>
              </div>
            )}
          </div>
        </div>
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

/** The export summary in one line: 「共 3 场 · 28 个镜头 · 约 149 秒 · 27 个还没生成」. */
function exportLine(film: FilmProject): string {
  const seconds = film.shots.reduce((sum, item) => sum + item.seconds, 0);
  const missing = chosenExport(film).missing.length;
  const gap = missing === 0 ? "都已生成" : `${missing} 个还没生成`;
  return `共 ${film.scenes.length} 场 · ${film.shots.length} 个镜头 · 约 ${seconds} 秒 · ${gap}`;
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

/** The line under a scene's title in the scene lists: 「内景 · 夜 · 10 镜」. */
function sceneMeta(scene: FilmScene, shots: readonly FilmShot[]): string {
  const count = shots.filter((item) => item.sceneId === scene.id).length;
  return [scene.where, count > 0 ? `${count} 镜` : ""].filter(Boolean).join(" · ");
}

function ScriptPage({
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
  onUndo,
  onRedo,
  showRoles,
  onToggleRoles,
  structured,
  turns,
  card,
  onRedoRange,
  onDismiss,
  onOneClick,
  onTemplate,
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
  onUndo: () => void;
  onRedo: () => void;
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
  onTemplate: (name: string) => void;
}) {
  const current = film.scenes.find((item) => item.id === scene) ?? film.scenes[0];
  const words = film.scenes.reduce((sum, item) => sum + item.text.length, 0);
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
              "拆开以后才有时长"
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
          <button className="icon-btn" aria-label="撤销" title="撤销" onClick={onUndo}>
            <Ic name="undo" />
          </button>
          <button className="icon-btn" aria-label="重做" title="重做" onClick={onRedo}>
            <Ic name="redo" />
          </button>
          <span className="vsep" />
          <div className="seg">
            <button className="on">场景</button>
          </div>
          <span className="sp" />
          <button className="btn primary" onClick={onPlan} disabled={asking}>
            <Ic name="clap" size={15} />
            {asking ? "正在写" : "让导演拆镜头"}
          </button>
          <button className="btn" type="button" onClick={onOneClick} disabled={asking}>
            {asking ? "正在做" : "一键成片"}
          </button>
          <select
            className="input"
            aria-label="从模板开始"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value) onTemplate(event.target.value);
              event.target.value = "";
            }}
          >
            <option value="">从模板开始</option>
            {FILM_TEMPLATES.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="pb doc">
          <div className="page">
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
        <div className="ph">
          <Ic name="spark" size={16} />
          <h3>AI 助手</h3>
          <span className="sp" />
          <button className="icon-btn sm" aria-label="更多">
            <Ic name="more" size={16} />
          </button>
        </div>
        <Assistant
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
            if (label === "让编剧写" || label === "节奏再快些") onWrite();
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
}) {
  const [who, setWho] = useState(0);
  const [place, setPlace] = useState(0);
  const [side, setSide] = useState<"people" | "places" | "props">("people");
  const character = film.characters[who];
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
                  <small>空镜</small>
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
                placeholder="加上道具，回车写入"
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
              <button
                className="btn primary sm"
                type="button"
                disabled={busy || missing === 0}
                onClick={() => onAllPortraits(ready.map((person) => person.id))}
              >
                {busy ? "正在出定妆照" : "给所有人出定妆照"}
              </button>
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
          <h3>{character?.name ?? "人物"}</h3>
          <span className="meta">同一张脸，同一套衣服</span>
        </div>
        <div className="pb sheet cast-sheet">
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
            <div className="field">
              <label htmlFor="style-preset">画风</label>
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
                    <optgroup label={`适合${character?.ageBand ?? ""}${character?.gender ?? ""}性`}>
                      {voiceGroup.fitting.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {voiceGroup.others.length > 0 && (
                    <optgroup label={character?.gender ? `其他${character.gender}声` : "全部声音"}>
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
            {side === "places" && film.locations[place] && (
              <div className="field">
                <label htmlFor="place-ambience">环境音</label>
                <textarea
                  id="place-ambience"
                  className="area"
                  aria-label="环境音"
                  value={film.locations[place]?.ambience ?? ""}
                  onChange={(event) => {
                    const ambience = event.target.value;
                    onFilm({
                      ...film,
                      locations: film.locations.map((item, index) =>
                        index === place ? { ...item, ambience } : item,
                      ),
                    });
                  }}
                />
              </div>
            )}
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
                  补这个人的
                </button>
              ) : null}
            </div>
            <div className="refs4 slots">
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
                return (
                  <figure key={item.view} className="slot" data-state={state}>
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
        </div>
      </section>
      <section className="pane ai">
        <div className="ph">
          <Ic name="spark" size={16} />
          <h3>AI 助手</h3>
        </div>
        <Assistant
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

function BoardPage({
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
}) {
  const [tab, setTab] = useState<"props" | "ai">("props");
  const [showEnglish, setShowEnglish] = useState(false);
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
  // GPT's own check, saved on the scene when the director writes it or fixes its end. The page
  // does not run the check again on every edit.
  const coverage = sceneRow?.coverage && !sceneRow.coverage.ok ? sceneRow.coverage : null;
  const allBeats = film.unassignedBeats ?? [];
  const sceneBeats = allBeats.filter((beat) => beat.sceneId === sceneRow?.id);
  const placeBeat = (index: number, target: FilmShot) => {
    const beat = sceneBeats[index];
    if (!beat || target.sceneId !== activeSceneId || beat.sceneId !== activeSceneId) return;
    // GPT's rule decides: a shot with only dialogue never takes a fight action.
    const placed = assignActionBeats(film.shots, beat.sceneId, [
      { text: beat.text, shotId: target.id },
    ]);
    if (placed.unassignedBeats.length > 0) {
      onNotice(`镜头 ${target.no} 只有对白，放不了这个动作。换一个有动作的镜头。`);
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
          <button className="btn" onClick={onGenerate}>
            单镜
          </button>
          <button className="btn primary" onClick={onBatch}>
            <Ic name="spark" size={14} />
            生成这一场
          </button>
        </div>
        {sceneRow && (
          <SceneAlerts
            key={sceneKey}
            dragScope={sceneKey}
            repairFailed={repair.failed}
            coverageWarning={
              coverage && !coverage.missingLines.length && !coverage.missingTail
                ? coverageNotice(coverage).detail
                : undefined
            }
            missingTail={coverage?.missingTail ?? null}
            missingLines={coverage?.missingLines ?? []}
            beats={sceneBeats.map((beat) => beat.text)}
            fixing={repair.fixing}
            onFixEnding={() => void repair.run()}
            pickedShot={current ? `镜头 ${current.no}` : ""}
            onPlaceBeat={(index) => current && placeBeat(index, current)}
          />
        )}
        <div className="pb grid">
          {shots.map((item, index) => (
            <button
              key={item.id}
              className={index === shot ? "card sel" : "card"}
              onClick={() => onShot(index)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(BEAT_DRAG_TYPE)) event.preventDefault();
              }}
              onDrop={(event) => {
                const raw = event.dataTransfer.getData(BEAT_DRAG_TYPE);
                if (!raw) return;
                event.preventDefault();
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
              </div>
              <div className="cb">
                <div className="ct">
                  镜头 {item.no} <span>{item.size}</span>
                  <i
                    className={`src ${shotSource(item).tone}`}
                    title={shotSource(item).label}
                    aria-hidden="true"
                  />
                </div>
                <p className="pic" title={item.picture}>
                  {item.picture}
                </p>
                {item.line.trim() ? (
                  <p className="line" title={item.line}>
                    {item.line.split("\n")[0]}
                  </p>
                ) : null}
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
          />
        ) : current ? (
          <>
            <div className="shot-h">
              镜头 {current.no} <span>{shotProgress(current)}</span>
            </div>
            <div className="pb">
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
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => setShowEnglish((value) => !value)}
                >
                  高级
                </button>
                {showEnglish ? (
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
                      {current.promptEn || "英文提示词还没写。请提示词工程师写。"}
                    </p>
                    <div className="acts">
                      <button className="btn sm" type="button" onClick={onPrompter}>
                        写英文提示词
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
              {current.tag ? <p className="role-desc">镜头类型：{current.tag}</p> : null}
              {missingLocks.length > 0 && (
                <p className="role-desc">这一镜的提示词漏了{missingLocks.join("、")}的外貌描述。</p>
              )}
              <div className="field">
                <label>声音计划</label>
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
                  <option value="native">画面自带</option>
                  <option value="dub">单独配音</option>
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
              </div>
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
                    <button
                      type="button"
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
              {stillProgress[current.id] ? (
                <button className="btn primary" type="button" disabled>
                  {stillProgress[current.id]}
                </button>
              ) : shotProgress(current) === "未生成" ? (
                <button className="btn primary" type="button" onClick={onStills}>
                  生成画面
                </button>
              ) : (
                <button className="btn primary" type="button" onClick={onGenerate}>
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

function GeneratePage({
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
}) {
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
          <button className="btn sm" onClick={onBack}>
            返回分镜
          </button>
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
                <span className="badge none">
                  {takes.length === 0 ? "还没有版本" : picked?.reason || "这一版还没有画面"}
                </span>
              </div>
            )}
          </div>
          <div className="cands">
            {takes.length === 0 && <p className="role-desc">还没有版本。点下面生成。</p>}
            {takes.map((item) => (
              <button
                key={item.id}
                className={item.id === current?.selectedTakeId ? "cand pick" : "cand"}
                onClick={() => choose(item.id)}
              >
                <div
                  className={
                    displayableImage(item.stillUrl) || item.videoUrl ? "thumb" : "thumb rain"
                  }
                >
                  {displayableImage(item.stillUrl) ? (
                    <div
                      className="still"
                      style={{ backgroundImage: `url(${displayableImage(item.stillUrl)})` }}
                    />
                  ) : item.videoUrl ? (
                    <video src={item.videoUrl} muted playsInline preload="metadata" />
                  ) : null}
                  <span className="dur">
                    {item.status === "done"
                      ? `${current?.seconds ?? 0}s`
                      : item.status === "running"
                        ? "生成中"
                        : item.status === "queued"
                          ? "排队"
                          : "失败"}
                  </span>
                </div>
                <div className="cl">
                  <span>
                    第{item.index}版/{takes.length}
                  </span>
                  <span>
                    {item.id === current?.selectedTakeId
                      ? "当前版本"
                      : item.status === "done"
                        ? "用这一版"
                        : item.reason || item.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="pane">
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
            <span>外貌写进提示词</span>
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
            <span className="from role-a">含这一镜和外貌</span>
          </div>
          <textarea
            className="area"
            aria-label="画面描述"
            style={{ height: 74 }}
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
          <p className="role-desc" data-testid="keyframe-prompt">
            {current ? continuityPrompt(shots[shot - 1], current, film) : prompt}
          </p>
          <p className="role-desc">{CONTINUITY_REASON}</p>
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
          </div>
        </div>
        <div className="genbar">
          <div className="model">
            <Ic name="spark" size={14} />
            <span>Grok 会员</span>
            <small title={GENERATE_MODEL}>成片</small>
            <span className="sp" />
            <small>不另外收费</small>
          </div>
          <button className="btn primary block" onClick={onCreate}>
            <Ic name="video" size={16} />
            生成 {versions} 个版本
          </button>
          <div className="note" data-testid="generation-estimate">
            {generationEstimate(1, versions, duration)}
          </div>
        </div>
      </section>
    </>
  );
}

function EditPage({
  film,
  shot,
  onShot,
  shots,
  range,
  comparing,
  fixAction,
  rightTab,
  playing,
  actions,
  onTogglePlay,
  onSelectRange,
  onPickClip,
  onClearRange,
  onAction,
  onKeep,
  onReplace,
  onTab,
  onUndo,
  onRedo,
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
  fixAction: FixAction;
  rightTab: "props" | "fix" | "ai";
  playing: boolean;
  actions: ReturnType<typeof videoActions>;
  onTogglePlay: () => void;
  onSelectRange: () => void;
  onPickClip: () => void;
  onClearRange: () => void;
  onAction: (action: FixAction) => void;
  onKeep: () => void;
  onReplace: () => void;
  onTab: (tab: "props" | "fix" | "ai") => void;
  onUndo: () => void;
  onRedo: () => void;
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
}) {
  const [mediaTime, setMediaTime] = useState(0);
  const clips = clipLayout(shots);
  const cues = subtitleCues(shots);
  const current = shots[shot] ?? shots[0];
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
  useEffect(() => {
    setMediaTime(0);
  }, [shot, previewSrc]);
  const start = shots.slice(0, shot).reduce((sum, item) => sum + item.seconds, 0);
  const selected = clips[shot];
  const tiles: { id: FixAction; icon: string; label: string }[] = [
    { id: "regenerate", icon: "refresh", label: "重新生成" },
    { id: "rewrite", icon: "edit", label: "改描述再生成" },
    { id: "voice", icon: "mic", label: "换配音字幕" },
    { id: "cut", icon: "cut", label: "剪掉这段" },
  ];
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
          <div className="cmp">
            {(current?.takes ?? []).map((item) => (
              <div className="side" key={item.id}>
                <div className="lbl">
                  <span>
                    第{item.index}版/{current?.takes.length ?? 0}
                  </span>
                  <span>
                    {item.id === current?.selectedTakeId ? "当前版本" : item.reason || item.status}
                  </span>
                </div>
                {item.videoUrl ? (
                  <video className="frame" src={item.videoUrl} />
                ) : (
                  <div className="frame rain" />
                )}
              </div>
            ))}
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
            <button className="btn" onClick={onKeep}>
              保留旧版
            </button>
            <button className="btn primary" onClick={onReplace}>
              <Ic name="swap" size={14} />
              用新版替换
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
            <div className="ph">
              <h3>预览</h3>
              <span className="meta">{film.title}</span>
              <span className="sp" />
            </div>
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
                  onTime={setMediaTime}
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
                <b>{clock(film.assemblyUrl ? mediaTime : start + mediaTime)}</b> /{" "}
                {clock(shots.reduce((sum, item) => sum + item.seconds, 0))}
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
            </div>
          </section>
        </>
      )}
      <section className="pane">
        <div className="ptabs">
          <button className={rightTab === "props" ? "on" : ""} onClick={() => onTab("props")}>
            属性
          </button>
          <button className={rightTab === "fix" ? "on" : ""} onClick={() => onTab("fix")}>
            修改这一段
          </button>
          <button className={rightTab === "ai" ? "on" : ""} onClick={() => onTab("ai")}>
            AI 助手
          </button>
        </div>
        {rightTab === "fix" ? (
          <>
            <div className="selinfo">
              <b>
                镜头 {current?.no ?? ""} · {current?.move || "固定"}
              </b>
              <small>
                {clock(start)} – {clock(start + (current?.seconds ?? 0))} · {current?.seconds ?? 0}{" "}
                秒
              </small>
            </div>
            <div className="pb">
              <div className="tiles">
                {tiles.map((tile) => (
                  <button
                    key={tile.id}
                    className={`tile${fixAction === tile.id ? " on" : ""}${tile.id === "cut" ? " danger" : ""}`}
                    aria-disabled={!actions[tile.id].enabled}
                    title={actions[tile.id].reason}
                    onClick={() => onAction(tile.id)}
                  >
                    <Ic name={tile.icon === "cut" ? "trash" : tile.icon} size={15} />
                    {tile.label}
                  </button>
                ))}
              </div>
              <div style={{ padding: "12px 12px 0" }}>
                <div className="sec-t">这一镜的描述</div>
                <textarea
                  className="area"
                  aria-label="改这一镜的描述"
                  style={{ height: 62 }}
                  value={current?.picture ?? ""}
                  onChange={(event) => onRewrite(event.target.value)}
                />
                <div className="row2" style={{ marginTop: 8 }}>
                  <div className="input">一次出 {film.takesPerShot || 1} 个</div>
                  <button className="btn primary" onClick={() => onAction(fixAction)}>
                    <Ic name="spark" size={14} />
                    生成新版本
                  </button>
                </div>
              </div>
            </div>
          </>
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
              <button className="btn" onClick={onSelectRange}>
                回到分镜重新生成
              </button>
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
            <span className="lab">
              已选 {clock(start)}–{clock(start + (current?.seconds ?? 0))} · {current?.seconds ?? 0}{" "}
              秒
            </span>
            <button
              className="btn primary"
              title={actions.regenerate.reason}
              aria-disabled={!actions.regenerate.enabled}
              onClick={() => onAction("regenerate")}
            >
              <Ic name="refresh" size={13} />
              重新生成
            </button>
            <button
              className="btn"
              title={actions.rewrite.reason}
              aria-disabled={!actions.rewrite.enabled}
              onClick={() => onAction("rewrite")}
            >
              <Ic name="edit" size={13} />
              改描述
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
            {current ? (
              <button className="btn sm" type="button" onClick={onRangeGenerate}>
                只重做这一段
              </button>
            ) : null}
            {importMusic}
            <button className="icon-btn sm" aria-label="取消选择" onClick={onClearRange}>
              <Ic name="x" size={14} />
            </button>
          </div>
        ) : (
          <div className="ttool">
            <button className="icon-btn on" aria-label="选择" title="选择 (V)">
              <Ic name="cursor" />
            </button>
            <button
              className="icon-btn"
              aria-label="删除"
              title="删除 (Del)"
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
            <span className="vsep" />
            <button className="icon-btn" aria-label="撤销" title="撤销" onClick={onUndo}>
              <Ic name="undo" />
            </button>
            <button className="icon-btn" aria-label="重做" title="重做" onClick={onRedo}>
              <Ic name="redo" />
            </button>
            <span className="sp" />
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
              配音
              <span className="lane-controls">
                <button
                  type="button"
                  aria-label="静音配音"
                  onClick={() => {
                    const muted = film.audioClips.some(
                      (clip) => clip.lane === "dialogue" && clip.gainDb <= -40,
                    );
                    onLane?.("dialogue", muted ? 0 : -80);
                  }}
                >
                  静音
                </button>
                <button type="button" aria-label="单听配音" onClick={() => onSolo?.("dialogue")}>
                  单听
                </button>
                <input
                  aria-label="配音音量"
                  title={`配音音量 ${dbToVolumePercent(dialogueGain)}`}
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
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-music)" }} />
              <Ic name="music" size={13} />
              音乐
              <span className="lane-controls">
                <button
                  type="button"
                  aria-label="静音音乐"
                  onClick={() => {
                    const muted = film.audioClips.some(
                      (clip) => clip.lane === "score" && clip.gainDb <= -40,
                    );
                    onLane?.("score", muted ? musicRestore : -80);
                  }}
                >
                  静音
                </button>
                <button type="button" aria-label="单听音乐" onClick={() => onSolo?.("score")}>
                  单听
                </button>
                <input
                  aria-label="音乐音量"
                  title={`音乐音量 ${dbToVolumePercent(musicGain)}`}
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
          <div className="tracks">
            <div className="track-area" style={{ width: trackWidth }}>
              <div className="ruler">
                {rulerTicks(shots, clips).map((tick) => (
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
                      className="clip s"
                      style={{ left: clip.left, width: clip.width }}
                    >
                      <span className="tx">{cue.text}</span>
                    </div>
                  );
                })}
              </div>
              <div className="lane" style={{ height: "var(--hv)" }}>
                {clips.map((clip, index) => {
                  const ready = shots[index]?.takes.some((take) => take.status === "done");
                  return (
                    <button
                      key={clip.id}
                      className={ready ? "clip v" : "clip v empty"}
                      style={{ left: clip.left, width: clip.width }}
                      onClick={() => {
                        onShot(index);
                        onPickClip();
                      }}
                    >
                      <span className="lb">
                        {ready ? `镜头 ${shots[index]?.no ?? index + 1}` : "未生成"}
                      </span>
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
                      <span className="tx">{item.label || "配音"}</span>
                    </div>
                  ))}
              </div>
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
                      <span className="tx">
                        导入的音乐
                        {shots.some((shotItem) => shotItem.line.trim()) ? " · 导出时让路" : ""}
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
              <div
                className="playhead"
                style={{
                  left:
                    (selected?.left ?? 1) +
                    (current && current.seconds > 0
                      ? Math.min(1, mediaTime / current.seconds) * (selected?.width ?? 0)
                      : 0),
                }}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
