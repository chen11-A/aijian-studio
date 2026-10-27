import { useEffect, useRef, useState } from "react";
import {
  actionBeats,
  adaptToShortDrama,
  addShot,
  applyScenes,
  clipLayout,
  clock,
  continuityPrompt,
  CONTINUITY_REASON,
  DESKTOP_REASON,
  ensureLocations,
  extractCastOffline,
  exportSummary,
  mergeCast,
  parseCastReply,
  extractBookText,
  LOUDNESS_NOTE,
  offlineScreenplay,
  parseWriterScenes,
  performanceLine,
  moveShot,
  planVideoJobs,
  portraitPrompts,
  PREVIEW_REASON,
  removeShot,
  splitNovel,
  generationEstimate,
  storyFilmBatches,
  subtitleCues,
  updateShot,
  VOICES,
} from "../film/operations";
import {
  activeFilmId,
  BROWSER_DIRECTORY,
  filmDiskReady,
  listEpisodes,
  listFilms,
  mediaUrl,
  readSaved,
  removeFilm,
  renameFilm,
  saveFilm,
  type EpisodeEntry,
  type FilmIndexEntry,
} from "../film/library";
import {
  applyShots,
  agentRequest,
  blankFilm,
  keyframePrompt,
  newEpisode,
  parseDirectorShots,
  sampleFilm,
  offlineShots,
  textModel,
  STYLE_PRESETS,
  type FilmProject,
  type FilmScene,
  type FilmShot,
  type FilmTake,
} from "../film/project";
import { grokBridge } from "../grok-auth/transport";
import { useGrokConnected } from "../grok-auth/useGrokConnected";
import { videoActions, GENERATE_MODEL, VIDEO_DRAFT_MODEL, type VideoAction } from "./capabilities";
import { Ic } from "./icons";
import "./pro.css";

type Stage = "script" | "cast" | "board" | "edit";
type Role = "writer" | "director" | "action" | "performance";
type FixAction = VideoAction;

const STAGES: { id: Stage; label: string }[] = [
  { id: "script", label: "剧本" },
  { id: "cast", label: "角色与场景" },
  { id: "board", label: "分镜" },
  { id: "edit", label: "剪辑" },
];

const SETTINGS_NOTE = "设置页还没接上。画风在角色与场景，每镜次数在单镜工作台。";
const USAGE_NOTE = "用量页还没接上。生成次数记在每部作品里。";
const ROUGH_CUT_REASON = "多镜头还没接成一条，先播放这一镜。";
const SHOT_SIZES = ["大远景", "远景", "全景", "中景", "近景", "特写", "大特写"];

function settleNextJob(
  base: FilmProject,
  shotId: string,
  status: "done" | "failed" | "queued",
): FilmProject {
  let marked = false;
  return {
    ...base,
    jobs: base.jobs.map((job) => {
      if (
        marked ||
        job.shotId !== shotId ||
        (job.status !== "running" && job.status !== "queued")
      ) {
        return job;
      }
      marked = true;
      return { ...job, status };
    }),
  };
}

function filmSignature(value: FilmProject): string {
  return JSON.stringify({
    ...value,
    savedAt: "",
    directory: "",
    assemblyUrl: "",
    shots: value.shots.map((shot) => ({
      ...shot,
      takes: shot.takes.map((take) => ({ ...take, videoUrl: "" })),
    })),
  });
}

const ROLE_COPY: Record<Role, string> = {
  writer: "编剧：把想法或小说收成一场一场的剧本。确认前不会改你写过的字。",
  director: "导演：把剧本拆成镜头，定好景别、时长和节奏。",
  action: "动作指导：把打斗拆成一拍一拍的动作，标出力度、方向和慢镜。",
  performance: "表演指导：给每个镜头写情绪、眼神和语气。",
};

function shotFrame(shot: FilmShot | undefined): string {
  if (!shot) return "";
  if (shot.poster) return shot.poster;
  const take =
    shot.takes.find((item) => item.id === shot.selectedTakeId) ??
    shot.takes.find((item) => item.status === "done");
  const url = take?.stillUrl ?? "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("http")) return url;
  return "";
}

function PreviewVideo({
  src,
  playing,
  onPlaying,
  onTime,
}: {
  src: string;
  playing: boolean;
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
      return;
    }
    const start = async () => {
      if (typeof video.play !== "function") return;
      video.muted = false;
      try {
        await video.play();
      } catch {
        if (cancelled) return;
        video.muted = true;
        try {
          await video.play();
        } catch {
          if (!cancelled) onPlayingRef.current(false);
          return;
        }
      }
      if (!cancelled) tick();
    };
    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [playing, src]);
  return (
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
  const style = src
    ? { backgroundImage: `url(${src})`, backgroundPosition: position ?? "50% 50%" }
    : undefined;
  return <div className={rain || !src ? "thumb rain" : "thumb"} style={style} />;
}

function displayableImage(url: string | undefined): string {
  if (!url) return "";
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("http")) return url;
  return "";
}

function takeVideo(shot: FilmShot | undefined): string {
  if (!shot) return "";
  const take =
    shot.takes.find((item) => item.id === shot.selectedTakeId && item.videoUrl) ??
    shot.takes.find((item) => item.status === "done" && item.videoUrl);
  return take?.videoUrl ?? "";
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
  const [film, setFilm] = useState<FilmProject | null>(null);
  const [stage, setStage] = useState<Stage>("script");
  const [scene, setScene] = useState("02");
  const [role, setRole] = useState<Role>("director");
  const [shot, setShot] = useState(0);
  const [pending, setPending] = useState<FilmShot[] | null>(null);
  const [pendingScenes, setPendingScenes] = useState<FilmScene[] | null>(null);
  const [menu, setMenu] = useState<"project" | "account" | "queue" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [fixAction, setFixAction] = useState<FixAction>("rewrite");
  const [rightTab, setRightTab] = useState<"props" | "fix" | "ai">("props");
  const [notice, setNotice] = useState("");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [versions, setVersions] = useState(2);
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
  const pastRef = useRef<FilmProject[]>([]);
  const futureRef = useRef<FilmProject[]>([]);
  const committed = useRef<FilmProject | null>(null);
  const skipHistory = useRef(false);
  const pauseRef = useRef(false);
  const assembledKey = useRef("");
  const openShotRef = useRef("");
  const [historyTick, setHistoryTick] = useState(0);
  const actions = videoActions(modelIds);

  useEffect(() => {
    const bridge = grokBridge();
    if (!connected || !bridge) return;
    let live = true;
    void bridge.models().then((listed) => {
      if (!live || listed.kind !== "OK") return;
      setModelIds(listed.models.map((model) => model.id));
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
      if (!live || !stored) return;
      filmRef.current = stored;
      committed.current = stored;
      setFilm(stored);
      const first = stored.scenes[0]?.id;
      if (first) setScene(first);
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    filmRef.current = film;
    if (!film) return;
    const savingId = film.id;
    let cancelled = false;
    void saveFilm(film)
      .then((stored) => {
        if (cancelled) return;
        if (stored.directory && stored.directory !== BROWSER_DIRECTORY) {
          setDiskFilmId(savingId);
          setDiskPath(stored.directory);
          setDiskError("");
        }
      })
      .catch(() => {
        if (!cancelled) setDiskError("没有写到应用数据目录，可以重试。");
      });
    let timer = 0;
    if (skipHistory.current) {
      skipHistory.current = false;
      committed.current = film;
    } else if (!committed.current) {
      committed.current = film;
    } else {
      timer = window.setTimeout(() => {
        const previous = committed.current;
        if (previous && filmSignature(previous) !== filmSignature(film)) {
          pastRef.current = [...pastRef.current, previous].slice(-50);
          futureRef.current = [];
          setHistoryTick((value) => value + 1);
        }
        committed.current = film;
      }, 500);
    }
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [film]);

  function rememberFilm(next: FilmProject) {
    filmRef.current = next;
    setFilm(next);
  }

  function undoEdit() {
    const current = filmRef.current;
    const baseline = committed.current;
    if (current && baseline && filmSignature(current) !== filmSignature(baseline)) {
      skipHistory.current = true;
      rememberFilm(baseline);
      return;
    }
    const previous = pastRef.current.pop();
    if (!previous || !current) return;
    futureRef.current.push(current);
    skipHistory.current = true;
    setHistoryTick((value) => value + 1);
    rememberFilm(previous);
  }

  function redoEdit() {
    const current = filmRef.current;
    const next = futureRef.current.pop();
    if (!next || !current) return;
    pastRef.current.push(current);
    skipHistory.current = true;
    setHistoryTick((value) => value + 1);
    rememberFilm(next);
  }

  const open = film !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
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
        setPlaying((value) => !value);
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
    setComparing(true);
    setNotice(
      action === "extend"
        ? "延长会从最后一帧往后接，每个版本各算一次。"
        : "每个版本各算一次生成。视频自带的声音已关掉。",
    );
  };

  const title = film?.title ?? "未命名作品";
  const savedDirectory =
    diskFilmId === film?.id && diskPath && diskPath !== BROWSER_DIRECTORY
      ? diskPath
      : film?.directory && film.directory !== BROWSER_DIRECTORY
        ? film.directory
        : "";
  const sceneShots = film?.shots.filter((item) => item.sceneId === scene) ?? [];
  const shownShots = sceneShots.length > 0 ? sceneShots : (film?.shots ?? []);
  openShotRef.current = shownShots[shot]?.id ?? "";

  async function planDirector(asked = "") {
    if (!film) return;
    const current = film.scenes.find((item) => item.id === scene) ?? film.scenes[0];
    const sceneId = current?.id ?? "scene-1";
    const story = [current?.text.trim() || film.title, asked.trim()].filter(Boolean).join("\n");
    const names = film.characters.map((item) => `${item.name}：${item.identity}`).join("\n");
    const context = `画风：${film.styleZh}\n人物：\n${names}\n剧本：\n${story}`;
    let next = offlineShots(story, sceneId);
    let text = "没有登录，已用离线拆镜。点「放入分镜」才会写入。";
    const bridge = grokBridge();
    const billingProject = /^prj_[0-9a-f]{32}$/.test(projectId ?? "") ? projectId : "";
    if (connected && bridge && !billingProject) {
      text = "这一次没有记到作品上，已用离线拆镜。点「放入分镜」才会写入。";
    } else if (connected && bridge && billingProject) {
      const result = await bridge.completeText({
        model: textModel(modelIds),
        text: agentRequest("director", context, "把这一场拆成镜头"),
        projectId: billingProject,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.kind === "OK") {
        const parsed = parseDirectorShots(result.text, sceneId);
        if (parsed) {
          next = parsed;
          text = "导演拆好了。点「放入分镜」才会写入。";
        } else {
          text = "模型没有按格式返回，已用离线拆镜。点「放入分镜」才会写入。";
        }
      } else {
        text = "模型没有返回，已用离线拆镜。点「放入分镜」才会写入。";
      }
    }
    setPending(next);
    setRole("director");
    setNotice(text);
  }

  function applyPending() {
    if (!film || !pending) {
      setNotice("还没有可放入的镜头。");
      return;
    }
    const only = pending.length === 1 ? pending[0] : undefined;
    if (only && (only.source === "agent:action" || only.source === "agent:performance")) {
      const existing = film.shots.find((item) => item.id === only.id);
      if (
        existing &&
        (existing.userFields.includes("action") || existing.userFields.includes("performance"))
      ) {
        setNotice("这一镜是你改过的，没有盖掉。");
        return;
      }
      setFilm(
        updateShot(film, only.id, {
          action: only.action,
          performance: only.performance,
          source: only.source,
        }),
      );
      setNotice("已写入这一镜。你改过的字没有被盖掉。");
      return;
    }
    const sceneId =
      film.scenes.find((item) => item.id === scene)?.id ?? film.scenes[0]?.id ?? "scene-1";
    const placed = applyShots(film, pending, sceneId);
    setFilm(placed);
    setShot(0);
    void fillCast(placed);
    setNotice("已放入分镜。你改过的镜头没有被盖掉。");
  }

  async function completeAgent(
    agent: "writer" | "director" | "action" | "performance",
    context: string,
    user: string,
  ): Promise<string | null> {
    const bridge = grokBridge();
    if (!connected || !bridge || !film) return null;
    const billingProject = /^prj_[0-9a-f]{32}$/.test(projectId ?? "") ? projectId : "";
    if (!billingProject) return null;
    const result = await bridge.completeText({
      model: textModel(modelIds),
      text: agentRequest(agent, context, user),
      projectId: billingProject,
      idempotencyKey: crypto.randomUUID(),
    });
    return result.kind === "OK" ? result.text : null;
  }

  async function fillCast(base: FilmProject) {
    if (base.characters.length > 0 && base.locations.length > 0) return;
    const story = base.scenes
      .map((item) => item.text)
      .filter(Boolean)
      .join("\n");
    if (!story.trim()) return;
    let extracted = extractCastOffline(story);
    const reply = await completeAgent(
      "writer",
      story,
      '抽出人物和场景，只返回 JSON：{"characters":[{"name":"","identity":""}],"locations":[{"name":"","prompt":""}]}',
    );
    const parsed = reply ? parseCastReply(reply) : null;
    if (parsed && (parsed.characters.length > 0 || parsed.locations.length > 0)) extracted = parsed;
    const merged = mergeCast(filmRef.current ?? base, extracted);
    if (merged === (filmRef.current ?? base)) {
      if (base.characters.length === 0 && base.locations.length === 0) {
        setNotice("这一场还没有认出人物和场景。");
      }
      return;
    }
    applyLive(merged);
    const names = merged.characters.map((item) => item.name).filter(Boolean);
    if (names.length > 0) setNotice(`已记下人物：${names.join("、")}。`);
  }

  async function planWriter(kind: "write" | "adapt") {
    if (!film) return;
    const story =
      film.scenes
        .map((item) => item.text)
        .filter(Boolean)
        .join("\n") || film.title;
    const idea = chat.trim() || story;
    let scenes = kind === "adapt" ? adaptToShortDrama(idea, 60) : offlineScreenplay(idea, 60);
    let text =
      kind === "adapt"
        ? "没有登录，已按大约 60 秒收成短剧。点「放入剧本」才会写入。"
        : "没有登录，已用离线编剧。点「放入剧本」才会写入。";
    const reply = await completeAgent(
      "writer",
      `画风：${film.styleZh}\n目标大约 60 秒。`,
      kind === "adapt" ? `把这些内容改成短剧：\n${idea}` : `写成短剧：\n${idea}`,
    );
    if (reply) {
      const parsed = parseWriterScenes(reply);
      if (parsed) {
        scenes = parsed;
        text = "编剧写好了。点「放入剧本」才会写入。";
      } else {
        text = "模型没有按格式返回，已用离线编剧。点「放入剧本」才会写入。";
      }
    } else if (connected) {
      text = "模型没有返回，已用离线编剧。点「放入剧本」才会写入。";
    }
    setPendingScenes(scenes);
    setRole("writer");
    setNotice(text);
  }

  function applyPendingScenes() {
    if (!film || !pendingScenes) {
      setNotice("还没有可放入的场次。");
      return;
    }
    const next = applyScenes(film, pendingScenes);
    setFilm(next);
    void fillCast(next);
    const first = next.scenes[0]?.id;
    if (first) setScene(first);
    setNotice("已放入剧本。你改过的场没有被盖掉。");
  }

  async function importBook(file: File) {
    const book = await extractBookText(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!book.text.trim()) {
      setNotice(book.note);
      return;
    }
    const split = splitNovel(book.text);
    if (split.scenes.length === 0) {
      setNotice(split.note || "没有读到场次。");
      return;
    }
    setPendingScenes(split.scenes);
    setRole("writer");
    setNotice(`${book.note}${split.note} 读到 ${split.scenes.length} 场。点「放入剧本」才会写入。`);
  }

  async function planAction() {
    if (!film) return;
    const current = shownShots[shot];
    const text = current?.picture || current?.action || film.title;
    let beats = actionBeats(text);
    let note = "没有登录，已用离线动作指导。点「放入分镜」写到这一镜。";
    const reply = await completeAgent(
      "action",
      `人物：${film.characters.map((item) => item.name).join("、")}`,
      text,
    );
    if (reply) {
      const parsed = actionBeats(reply);
      if (parsed.length > 0 && !reply.includes("这一下还没写")) {
        beats = parsed;
        note = "动作指导写好了。点「放入分镜」写到这一镜。";
      }
    }
    if (!current) {
      setNotice("先拆出镜头，再请动作指导。");
      return;
    }
    setPending([
      {
        ...current,
        action: beats
          .map(
            (beat) =>
              `${beat.text}（${beat.feasibility}${beat.workaround ? `，${beat.workaround}` : ""}）`,
          )
          .join(""),
        source: "agent:action",
        userFields: current.userFields.filter((field) => field !== "action"),
      },
    ]);
    setRole("action");
    setNotice(note);
  }

  async function planPerformance() {
    if (!film) return;
    const current = shownShots[shot];
    if (!current) {
      setNotice("先拆出镜头，再请表演指导。");
      return;
    }
    let line = performanceLine(current.picture);
    let note = "没有登录，已用离线表演指导。点「放入分镜」写到这一镜。";
    const reply = await completeAgent("performance", current.picture, "写这一镜的表演");
    if (reply && reply.trim()) {
      line = reply.replace(/\s+/g, " ").trim().slice(0, 80);
      note = "表演指导写好了。点「放入分镜」写到这一镜。";
    }
    setPending([
      {
        ...current,
        performance: line,
        source: "agent:performance",
        userFields: current.userFields.filter((field) => field !== "performance"),
      },
    ]);
    setRole("performance");
    setNotice(note);
  }

  function sendChat() {
    const asked = chat.trim();
    if (role === "writer") void planWriter("write");
    else if (role === "action") void planAction();
    else if (role === "performance") void planPerformance();
    else void planDirector(asked);
    setChat("");
  }

  function applyLive(next: FilmProject) {
    filmRef.current = next;
    setFilm(next);
  }

  function replaceTakes(
    base: FilmProject,
    shotId: string,
    takes: FilmTake[],
    selected = "",
  ): FilmProject {
    return {
      ...base,
      shots: base.shots.map((item) =>
        item.id === shotId
          ? { ...item, takes, selectedTakeId: selected || item.selectedTakeId }
          : item,
      ),
    };
  }

  async function makeStill(prompt: string): Promise<{ url: string; reason: string }> {
    const bridge = window.aijian;
    const current = filmRef.current;
    if (!current || !bridge?.generateFilmStill) {
      return { url: "", reason: "请打开安装好的 AIVORA 再出图。" };
    }
    try {
      const result = await bridge.generateFilmStill(current.seriesId, prompt);
      if (!result.path) return { url: "", reason: result.reason || "出图没有成功，可以重试。" };
      const bytes = bridge.readFilmMedia ? await bridge.readFilmMedia(result.path) : null;
      return {
        url: bytes ? mediaUrl(bytes, "image/png") : "",
        reason: bytes ? "画面已生成。" : "画面已保存，这一页还打不开。",
      };
    } catch {
      return { url: "", reason: "出图没有成功，可以重试。" };
    }
  }

  async function clipUrl(path: string): Promise<string> {
    const bridge = window.aijian;
    if (!path || !bridge) return "";
    try {
      const bytes = bridge.readFilmMedia
        ? await bridge.readFilmMedia(path)
        : bridge.readStoryFilmMedia
          ? await bridge.readStoryFilmMedia(path)
          : null;
      return bytes ? mediaUrl(bytes, "video/mp4") : "";
    } catch {
      return "";
    }
  }

  async function submitGeneration(targets?: FilmShot[]) {
    const live = filmRef.current ?? film;
    if (!live) return;
    const selected = (targets ?? [shownShots[shot] ?? live.shots[0]]).filter(
      (item): item is FilmShot => Boolean(item),
    );
    if (selected.length === 0) {
      setNotice("先在剧本里拆镜头。");
      return;
    }
    setNotice(generationEstimate(selected.length, versions, duration));
    if (live.draft && modelIds.length > 0 && !modelIds.includes(VIDEO_DRAFT_MODEL)) {
      setNotice(`模型列表里没有 ${VIDEO_DRAFT_MODEL}，不能先出草稿。`);
      return;
    }
    const gate = actions.regenerate;
    const bridge = window.aijian;
    const canSubmit = gate.enabled && Boolean(projectId && bridge?.createStoryFilm);
    const blocked = !gate.enabled ? gate.reason : DESKTOP_REASON;
    const jobs = selected.flatMap((item) => planVideoJobs(item, versions, canSubmit, blocked));
    if (!canSubmit) {
      applyLive({
        ...live,
        jobs: [
          ...live.jobs.filter((job) => !selected.some((item) => item.id === job.shotId)),
          ...jobs,
        ],
      });
      setNotice(blocked);
      return;
    }
    let next = live;
    const groups = selected.map((item) => {
      const fresh: FilmTake[] = Array.from({ length: versions }, (_, index) => ({
        id: crypto.randomUUID(),
        shotId: item.id,
        index: item.takes.length + index + 1,
        status: "running",
        stillUrl: "",
        videoPath: "",
        videoUrl: "",
        prompt: item.picture,
        createdAt: new Date().toISOString(),
        reason: "",
      }));
      next = replaceTakes(
        next,
        item.id,
        [...item.takes, ...fresh],
        item.selectedTakeId || fresh[0]?.id || "",
      );
      return { shot: item, takes: fresh, hadTakes: item.takes.length > 0 };
    });
    next = {
      ...next,
      jobs: [
        ...next.jobs.filter((job) => !selected.some((item) => item.id === job.shotId)),
        ...jobs.map((job) => ({ ...job, status: "running" as const })),
      ],
    };
    applyLive(next);
    try {
      for (const group of groups) {
        for (let index = 0; index < group.takes.length; index += 1) {
          const take = group.takes[index]!;
          const current = filmRef.current ?? next;
          if (pauseRef.current) {
            const queued = group.takes.slice(index).map((item) => item.id);
            applyLive(
              replaceTakes(
                current,
                group.shot.id,
                (current.shots.find((item) => item.id === group.shot.id)?.takes ?? []).map(
                  (item) =>
                    queued.includes(item.id)
                      ? { ...item, status: "queued", reason: "已暂停。点继续再生成剩下的。" }
                      : item,
                ),
              ),
            );
            setNotice("已暂停。点继续再生成剩下的。");
            return;
          }
          const shotNow = current.shots.find((item) => item.id === group.shot.id) ?? group.shot;
          const body = storyFilmBatches(current, [shotNow], current.draft)[0];
          const response = await bridge!.createStoryFilm!(projectId!, {
            ...body!,
            regenerate: index > 0 || group.hadTakes,
          });
          const data = response.data ?? {};
          const message = typeof data.message === "string" ? data.message : "";
          const output = typeof data.output_path === "string" ? data.output_path : "";
          const preview = typeof data.preview_image === "string" ? data.preview_image : "";
          const reportedRaw = data.duration_seconds;
          const reported =
            typeof reportedRaw === "number"
              ? reportedRaw
              : typeof reportedRaw === "string"
                ? Number(reportedRaw)
                : 0;
          const ok = data.status === "SUCCEEDED";
          const videoUrl = ok ? await clipUrl(output) : "";
          const done = ok && Boolean(videoUrl || preview || output);
          const latest = filmRef.current ?? current;
          const takes = (latest.shots.find((item) => item.id === group.shot.id)?.takes ?? []).map(
            (item) =>
              item.id === take.id
                ? {
                    ...item,
                    status: done ? ("done" as const) : ("failed" as const),
                    videoPath: output,
                    videoUrl,
                    stillUrl: preview,
                    reason: message,
                  }
                : item,
          );
          const frame =
            preview.startsWith("data:") || preview.startsWith("blob:") || preview.startsWith("http")
              ? preview
              : "";
          let saved = replaceTakes(
            latest,
            group.shot.id,
            takes,
            done ? take.id : latest.shots.find((item) => item.id === group.shot.id)?.selectedTakeId,
          );
          if (done && frame) saved = updateShot(saved, group.shot.id, { poster: frame });
          if (done && Number.isFinite(reported) && reported > 0.4) {
            const shown = Math.max(1, Math.min(15, Math.round(reported)));
            const chosen = saved.shots.find((item) => item.id === group.shot.id)?.seconds ?? 0;
            if (Math.abs(shown - chosen) >= 1) {
              saved = updateShot(saved, group.shot.id, { seconds: shown });
            }
          }
          saved = settleNextJob(saved, group.shot.id, done ? "done" : "failed");
          applyLive(saved);
          if (done && group.shot.id === openShotRef.current) setPlaying(true);
          setNotice(message || (done ? "这一版已经生成。" : "没有生成成功，可以重试。"));
        }
      }
    } catch {
      const latest = filmRef.current ?? next;
      let failed = latest;
      for (const group of groups) {
        failed = replaceTakes(
          failed,
          group.shot.id,
          (failed.shots.find((item) => item.id === group.shot.id)?.takes ?? []).map((item) =>
            item.status === "running"
              ? { ...item, status: "failed", reason: "没有生成成功，可以重试。" }
              : item,
          ),
        );
      }
      applyLive({
        ...failed,
        jobs: failed.jobs.map((job) =>
          job.status === "running" || job.status === "queued"
            ? { ...job, status: "failed" as const }
            : job,
        ),
      });
      setNotice("没有生成成功，可以重试。");
    }
  }

  function askBatch() {
    const rows = shownShots.length > 0 ? shownShots : (film?.shots ?? []);
    if (rows.length === 0) {
      setNotice("先在剧本里拆镜头。");
      return;
    }
    setPendingBatch(rows);
    setNotice(generationEstimate(rows.length, versions, duration));
  }

  async function joinedCut(paths: string[]) {
    const current = filmRef.current;
    const bridge = window.aijian;
    if (!current || paths.length === 0) return;
    if (paths.length === 1 || !bridge?.assembleFilm) {
      if (paths.length > 1) setNotice(ROUGH_CUT_REASON);
      return;
    }
    try {
      const result = await bridge.assembleFilm(current.seriesId, paths);
      const url = result.path ? await clipUrl(result.path) : "";
      const latest = filmRef.current ?? current;
      applyLive({ ...latest, assemblyPath: result.path, assemblyUrl: url });
      if (result.reason) setNotice(result.reason);
    } catch {
      setNotice(ROUGH_CUT_REASON);
    }
  }

  async function startExport() {
    const bridge = window.aijian;
    if (!bridge?.exportFilmCut || !bridge.pickFilmFolder) {
      setNotice("导出要在桌面版里选择文件夹。网页里不能写成片。");
      return;
    }
    const current = filmRef.current;
    if (!current) return;
    const paths = current.shots
      .map((item) => item.takes.find((take) => take.status === "done" && take.videoPath)?.videoPath)
      .filter((item): item is string => Boolean(item));
    let source = current.assemblyPath;
    if (!source && paths.length > 1) {
      await joinedCut(paths);
      source = filmRef.current?.assemblyPath ?? "";
    }
    if (!source) source = paths[0] ?? "";
    if (!source) {
      setNotice("还没有可以导出的视频。");
      return;
    }
    const directory = exportDir || (await bridge.pickFilmFolder()) || "";
    if (!directory) {
      setNotice("没有选择文件夹。");
      return;
    }
    setExportDir(directory);
    setExporting(true);
    setNotice("正在导出。");
    try {
      const name = `${current.seriesTitle || current.title}-${current.episodeTitle || "第1集"}.mp4`;
      const result = await bridge.exportFilmCut(source, directory, name);
      setExportFile(result.path);
      applyLive({ ...(filmRef.current ?? current), exportPath: result.path });
      setNotice(`已导出到 ${result.path}`);
    } catch {
      setNotice("没有导出成功，可以重试。");
    } finally {
      setExporting(false);
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
    const key = paths.join("|");
    if (assembledKey.current === key) return;
    assembledKey.current = key;
    void joinedCut(paths);
  }, [stage, film]);

  const dirty =
    film !== null &&
    committed.current !== null &&
    filmSignature(film) !== filmSignature(committed.current);
  const canUndo = historyTick >= 0 && (pastRef.current.length > 0 || dirty);
  const canRedo = futureRef.current.length > 0;
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

  return (
    <div
      className="pro-root"
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
                  <button
                    key={item.id}
                    onClick={() => {
                      void readSaved(item.id).then((saved) => {
                        if (!saved) {
                          setNotice("没有打开这部作品。");
                          return;
                        }
                        applyLive(saved);
                        setScene(saved.scenes[0]?.id ?? "scene-1");
                        setShot(0);
                        setMenu(null);
                        setNotice(`已打开${saved.seriesTitle || saved.title}。`);
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
                {episodes.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      void readSaved(item.id).then((saved) => {
                        if (!saved) return;
                        applyLive(saved);
                        setScene(saved.scenes[0]?.id ?? scene);
                        setMenu(null);
                        setNotice(`已打开${saved.episodeTitle}。`);
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
                    if (!film) return;
                    void removeFilm(film.id).then(async () => {
                      const rows = await listFilms();
                      const saved = rows[0] ? await readSaved(rows[0].id) : null;
                      if (saved) applyLive(saved);
                      else setFilm(null);
                      setMenu(null);
                      setNotice("已删除这一集。");
                    });
                  }}
                >
                  删除这一集
                </button>
                <button
                  onClick={() => {
                    if (!film) return;
                    void removeFilm(film.seriesId).then(() => {
                      setFilm(null);
                      setMenu(null);
                      setNotice("已删除这部作品。");
                    });
                  }}
                >
                  删除这部作品
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    setStage("cast");
                    setNotice(SETTINGS_NOTE);
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
              onClick={() => setNotice(connected ? "Grok 会员已连接。" : "需要重新登录。")}
            >
              <span className="dot" style={connected ? undefined : { background: "#E8A33D" }} />
              {connected ? "Grok 会员 · 已连接" : "需要重新登录"}
            </button>
            <button className="btn primary" onClick={() => setExportOpen(true)}>
              <Ic name="upload" size={15} />
              导出成片
            </button>
            <button
              className="avatar"
              aria-label="账号"
              onClick={() => setMenu(menu === "account" ? null : "account")}
            >
              C
            </button>
            {menu === "account" && (
              <div className="menu" role="menu" aria-label="账号菜单">
                <button
                  onClick={() => {
                    setMenu(null);
                    setNotice(SETTINGS_NOTE);
                  }}
                >
                  设置
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    setNotice(USAGE_NOTE);
                  }}
                >
                  用量
                </button>
                <button
                  onClick={() => {
                    setMenu(null);
                    setNotice("已退出登录。");
                  }}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </header>
        <main className={wsClass}>
          {!open || !film ? (
            <section className="pane" style={{ gridColumn: "1 / -1" }}>
              <div className="empty-center">
                <div>
                  <h2>写下你的故事，或者一句话的想法</h2>
                  <p>还没有作品。可以新建，也可以先打开示例看看整条流程。</p>
                  <div className="acts">
                    <button
                      className="btn primary"
                      onClick={() => {
                        setFilm(blankFilm());
                        setStage("script");
                        setNotice("从一句故事开始。");
                      }}
                    >
                      新建作品
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        setFilm(sampleFilm());
                        setScene("02");
                        setNotice("已打开示例「雨夜巷战」。");
                      }}
                    >
                      打开示例
                    </button>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <>
              {stage === "script" && (
                <ScriptPage
                  film={film}
                  scene={scene}
                  onScene={setScene}
                  onFilm={setFilm}
                  onPlan={() => void planDirector()}
                  onWrite={() => void planWriter("write")}
                  onAdapt={() => void planWriter("adapt")}
                  onImport={() => fileRef.current?.click()}
                  onAction={() => void planAction()}
                  onPerformance={() => void planPerformance()}
                  pending={pending}
                  pendingScenes={pendingScenes}
                  onApply={applyPending}
                  onApplyScenes={applyPendingScenes}
                  role={role}
                  onRole={setRole}
                  chat={chat}
                  onChat={setChat}
                  onSend={sendChat}
                  onUndo={undoEdit}
                  onRedo={redoEdit}
                />
              )}
              {stage === "cast" && (
                <CastPage
                  film={film}
                  onFilm={setFilm}
                  role={role}
                  onRole={setRole}
                  onNotice={setNotice}
                  chat={chat}
                  onChat={setChat}
                  onSend={sendChat}
                />
              )}
              {stage === "board" && !bench && (
                <BoardPage
                  film={film}
                  shots={shownShots}
                  shot={shot}
                  onShot={setShot}
                  onFilm={setFilm}
                  onNotice={setNotice}
                  onGenerate={() => setBench(true)}
                  onBatch={askBatch}
                  stills={[]}
                  onStills={() => {
                    const current = shownShots[shot];
                    if (!current || !window.aijian?.generateFilmStill) {
                      setNotice("请打开安装好的 AIVORA 再出图。");
                      return;
                    }
                    setNotice("正在出这一镜的画面。");
                    void makeStill(keyframePrompt(current, film)).then((made) => {
                      if (!made.url) {
                        setNotice(made.reason);
                        return;
                      }
                      const latest = filmRef.current;
                      if (!latest) return;
                      setFilm(
                        updateShot(latest, current.id, {
                          poster: made.url,
                          stills: [
                            ...current.stills,
                            { id: crypto.randomUUID(), prompt: current.picture, url: made.url },
                          ],
                        }),
                      );
                      setNotice(made.reason);
                    });
                  }}
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
                  onRole={setRole}
                  pending={pending}
                  onApply={applyPending}
                  onAction={() => void planAction()}
                  onPerformance={() => void planPerformance()}
                  chat={chat}
                  onChat={setChat}
                  onSend={sendChat}
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
                  onCreate={() => void submitGeneration()}
                  playing={playing}
                  onPlaying={setPlaying}
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
                  onTogglePlay={() => setPlaying((value) => !value)}
                  onSelectRange={() => {
                    setRange(true);
                    setComparing(true);
                    setRightTab("fix");
                  }}
                  onPickClip={() => {
                    setRange(true);
                    setRightTab("fix");
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
                    setComparing(false);
                    setRange(false);
                    setNotice("已用新版替换。旧版留在历史版本里。");
                  }}
                  onTab={setRightTab}
                  onUndo={undoEdit}
                  onRedo={redoEdit}
                  onNotice={setNotice}
                  onPlaying={setPlaying}
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
          <span>{notice}</span>
          <button className="task" onClick={() => setMenu(menu === "queue" ? null : "queue")}>
            <Ic name="loader" size={12} />
            后台生成：
            {film && film.jobs.some((job) => job.status === "running" || job.status === "queued")
              ? `视频 ${film.jobs.filter((job) => job.status === "queued" || job.status === "running").length} 个排队`
              : "没有排队"}
            <span className="bar">
              <i style={{ width: `${progress}%` }} />
            </span>
          </button>
          {pendingBatch && (
            <>
              <span data-testid="batch-estimate">
                {generationEstimate(pendingBatch.length, versions, duration)}
              </span>
              <button
                className="btn sm"
                onClick={() => {
                  const rows = pendingBatch;
                  setPendingBatch(null);
                  void submitGeneration(rows);
                }}
              >
                开始生成
              </button>
              <button className="btn sm" onClick={() => setPendingBatch(null)}>
                先不生成
              </button>
            </>
          )}
          <span className="sp" />
          <span className="where">
            {savedDirectory
              ? "作品保存在"
              : filmDiskReady()
                ? diskError || "正在写入应用数据目录"
                : BROWSER_DIRECTORY}{" "}
            <b>{savedDirectory || film?.title || ""}</b>
          </span>
        </footer>
        {menu === "queue" && (
          <div
            className="menu"
            style={{ left: 220, bottom: 28, top: "auto" }}
            role="dialog"
            aria-label="生成队列"
          >
            <button
              onClick={() => {
                pauseRef.current = !paused;
                setPaused((value) => !value);
                setNotice(paused ? "继续排队。" : "已暂停。已经发出的请求不一定能停。");
              }}
            >
              {paused ? "继续排队" : "暂停排队"}
            </button>
            <button
              onClick={() => {
                const failed = (film?.shots ?? []).filter((item) =>
                  item.takes.some((take) => take.status === "failed"),
                );
                if (failed.length === 0) {
                  setNotice("没有失败的生成。");
                  return;
                }
                void submitGeneration(failed);
              }}
            >
              重试失败的
            </button>
            {(film?.jobs ?? []).length === 0 && <button>没有排队的生成</button>}
            {(film?.jobs ?? []).map((job) => (
              <button
                key={job.id}
                onClick={() => {
                  if (!film) return;
                  if (projectId && window.aijian?.cancelStoryFilm && job.status === "running") {
                    void window.aijian.cancelStoryFilm(projectId);
                  }
                  setFilm({
                    ...film,
                    jobs: film.jobs.map((item) =>
                      item.id === job.id ? { ...item, status: "cancelled" } : item,
                    ),
                  });
                  setNotice("已取消这一次。已经发出的请求不一定能停。");
                }}
              >
                {job.kind === "video" ? "视频" : "画面"} · 版本 {job.take} ·{" "}
                {job.status === "blocked"
                  ? job.reason
                  : job.status === "done"
                    ? "好了"
                    : job.status === "failed"
                      ? "没有成功"
                      : job.status === "cancelled"
                        ? "已取消"
                        : "点此取消"}
              </button>
            ))}
          </div>
        )}
        {exportOpen && (
          <div className="dialog-back">
            <div className="dialog" role="dialog" aria-label="导出成片">
              <h2>导出成片</h2>
              <div className="field">
                <label>文件名</label>
                <div className="input">
                  {film ? `${film.seriesTitle || film.title}-${film.episodeTitle}` : "未命名"}
                </div>
              </div>
              <div className="field">
                <label htmlFor="export-dir">保存到</label>
                <button
                  id="export-dir"
                  className="input"
                  type="button"
                  onClick={() => {
                    void window.aijian?.pickFilmFolder?.().then((dir) => {
                      if (dir) setExportDir(dir);
                    });
                  }}
                >
                  {exportDir || "点这里选择文件夹"}
                </button>
              </div>
              <p className="role-desc" data-testid="export-summary">
                {film ? exportSummary(film) : "还没有作品。"}
              </p>
              <div className="acts">
                <button className="btn" onClick={() => setExportOpen(false)}>
                  关闭
                </button>
                <button
                  className="btn"
                  disabled={!exportFile}
                  title={exportFile ? "打开导出的文件夹" : "还没有导出的文件"}
                  onClick={() => {
                    if (exportFile) void window.aijian?.revealFilmPath?.(exportFile);
                  }}
                >
                  打开文件夹
                </button>
                <button
                  className="btn"
                  disabled={!exportFile}
                  title={exportFile ? "播放导出的文件" : "还没有导出的文件"}
                  onClick={() => {
                    if (exportFile) void window.aijian?.openFilmPath?.(exportFile);
                  }}
                >
                  播放
                </button>
                <button className="btn primary" onClick={() => void startExport()}>
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

function Assistant({
  role,
  onRole,
  pending,
  pendingScenes,
  onApply,
  onApplyScenes,
  shots,
  chat,
  onChat,
  onSend,
  onQuick,
}: {
  role: Role;
  onRole: (role: Role) => void;
  pending: FilmShot[] | null;
  pendingScenes?: FilmScene[] | null;
  onApply: () => void;
  onApplyScenes?: () => void;
  shots: FilmShot[];
  chat: string;
  onChat: (value: string) => void;
  onSend: () => void;
  onQuick?: (label: string) => void;
}) {
  const scenes = role === "writer" ? pendingScenes : null;
  const list = pending ?? shots;
  const chips =
    role === "writer"
      ? ["让编剧写", "改成短剧", "导入小说"]
      : role === "action"
        ? ["请动作指导看看"]
        : role === "performance"
          ? ["请表演指导看看"]
          : ["节奏再快些", "加一个特写", "请动作指导看看"];
  return (
    <>
      <div className="roles">
        <button className={role === "writer" ? "role on" : "role"} onClick={() => onRole("writer")}>
          <span className="ri">
            <Ic name="text" size={15} />
          </span>
          编剧
        </button>
        <button
          className={role === "director" ? "role on" : "role"}
          onClick={() => onRole("director")}
        >
          <span className="ri">
            <Ic name="clap" size={15} />
          </span>
          导演
        </button>
        <button className={role === "action" ? "role on" : "role"} onClick={() => onRole("action")}>
          <span className="ri">
            <Ic name="sword" size={15} />
          </span>
          动作指导
        </button>
        <button
          className={role === "performance" ? "role on" : "role"}
          onClick={() => onRole("performance")}
        >
          <span className="ri">
            <Ic name="heart" size={15} />
          </span>
          表演指导
        </button>
      </div>
      <div className="role-desc">{ROLE_COPY[role]}</div>
      <div className="pb chat">
        <div className="msg-u">把这一场拆成镜头。确认之前不要改我写过的字。</div>
        <div className="msg-a">
          <span className="ri">
            <Ic name="clap" size={13} />
          </span>
          <div className="bubble">
            <div className="h">
              {scenes
                ? `建议写成 ${scenes.length} 场`
                : pending
                  ? `建议拆成 ${pending.length} 个镜头`
                  : "当前镜头"}{" "}
              <span>{scenes ? scenes.length : list.length} 条</span>
            </div>
            <div className="shotlist">
              {scenes
                ? scenes.slice(0, 8).map((item) => (
                    <div key={item.id}>
                      <span>{item.no}</span>
                      <span>场</span>
                      <span>{item.text}</span>
                      <span />
                    </div>
                  ))
                : list.slice(0, 8).map((item, index) => (
                    <div key={item.id}>
                      <span>{index + 1}</span>
                      <span>{item.size}</span>
                      <span>{item.picture}</span>
                      <span>{item.seconds}s</span>
                    </div>
                  ))}
            </div>
            <div className="acts">
              <button
                className="btn primary sm"
                onClick={scenes && onApplyScenes ? onApplyScenes : onApply}
              >
                {scenes ? "放入剧本" : "放入分镜"}
              </button>
              <button className="btn sm" type="button" onClick={onSend}>
                再改改
              </button>
            </div>
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
          placeholder={`跟${
            role === "writer"
              ? "编剧"
              : role === "action"
                ? "动作指导"
                : role === "performance"
                  ? "表演指导"
                  : "导演"
          }说说你的想法…`}
          onChange={(event) => onChat(event.target.value)}
        />
        <button className="send" aria-label="发送" type="button" onClick={onSend}>
          <Ic name="send" size={15} />
        </button>
      </div>
    </>
  );
}

function ScriptPage({
  film,
  scene,
  onScene,
  onFilm,
  onPlan,
  onWrite,
  onAdapt,
  onImport,
  onAction,
  onPerformance,
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
}: {
  film: FilmProject;
  scene: string;
  onScene: (id: string) => void;
  onFilm: (film: FilmProject) => void;
  onPlan: () => void;
  onWrite: () => void;
  onAdapt: () => void;
  onImport: () => void;
  onAction: () => void;
  onPerformance: () => void;
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
                    title: `第 ${film.scenes.length + 1} 场`,
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
                <small>{item.where}</small>
              </span>
              <span className="c" />
            </button>
          ))}
        </div>
        <div className="pfoot">
          <span>
            全片约 <b>{film.shots.reduce((sum, item) => sum + item.seconds, 0)} 秒</b>
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
            <button disabled title="剧本格式还没接上。这一版整场写在一起。">
              动作
            </button>
            <button disabled title="剧本格式还没接上。这一版整场写在一起。">
              角色
            </button>
            <button disabled title="剧本格式还没接上。这一版整场写在一起。">
              对白
            </button>
          </div>
          <span className="sp" />
          <button className="btn primary" onClick={onPlan}>
            <Ic name="clap" size={15} />
            让导演拆镜头
          </button>
        </div>
        <div className="pb doc">
          <div className="page">
            <div className="sh">{current?.where || "地点还没写"}</div>
            <label className="ac" htmlFor="scene-text">
              这一场
            </label>
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
            else if (label.includes("动作")) onAction();
            else if (label.includes("表演")) onPerformance();
            else onSend();
          }}
        />
      </section>
    </>
  );
}

function CastPage({
  film,
  onFilm,
  role,
  onRole,
  onNotice,
  chat,
  onChat,
  onSend,
}: {
  film: FilmProject;
  onFilm: (film: FilmProject) => void;
  role: Role;
  onRole: (role: Role) => void;
  onNotice: (text: string) => void;
  chat: string;
  onChat: (value: string) => void;
  onSend: () => void;
}) {
  const [who, setWho] = useState(0);
  const [side, setSide] = useState<"people" | "places">("people");
  const character = film.characters[who];
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
          </div>
        </div>
        <div className="pb scenes">
          {side === "places" &&
            film.locations.map((item) => (
              <div key={item.id} className="scene">
                <span className="t">
                  {item.name}
                  <small>空镜</small>
                </span>
              </div>
            ))}
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
                  <small>人物</small>
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
        <div className="pb sheet">
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
          <div className="field">
            <label htmlFor="cast-id">外貌</label>
            <textarea
              id="cast-id"
              className="area"
              aria-label="外貌"
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
            参考图
          </div>
          <div className="refs4">
            {(character
              ? portraitPrompts(character.name, character.identity, film.styleZh)
              : []
            ).map((item) => (
              <div key={item.view}>
                <Thumb
                  src={character?.portraits.find((portrait) => portrait.view === item.view)?.url}
                  rain={!character?.portraits.find((portrait) => portrait.view === item.view)?.url}
                />
                <p>{item.view}</p>
              </div>
            ))}
          </div>
          <button
            className="btn sm"
            type="button"
            onClick={() => {
              if (!character) return;
              if (!window.aijian?.generateFilmStill) {
                onNotice("请打开安装好的 AIVORA 再出图。");
                return;
              }
              const prompts = portraitPrompts(character.name, character.identity, film.styleZh);
              onNotice("正在出定妆照。");
              void (async () => {
                const portraits = [];
                for (const item of prompts) {
                  const made = await makeStill(item.prompt);
                  portraits.push({ view: item.view, prompt: item.prompt, url: made.url });
                  if (!made.url) {
                    onNotice(made.reason);
                    return;
                  }
                }
                const latest = film;
                onFilm({
                  ...latest,
                  characters: latest.characters.map((item) =>
                    item.id === character.id ? { ...item, portraits } : item,
                  ),
                });
                onNotice("定妆照已生成。");
              })();
            }}
          >
            生成定妆照
          </button>
          <div className="sec-t" style={{ marginTop: 12 }}>
            声音
          </div>
          <div className="voices">
            {VOICES.map((voice) => (
              <div className="vcard" key={voice.id}>
                <div>
                  <b title={voice.id}>
                    {voice.name}
                    {voice.recommended ? " · 推荐" : ""}
                  </b>
                  <small>{voice.description}</small>
                </div>
                {voice.recommended ? <span className="tag">推荐</span> : <span />}
                <button
                  className="btn sm"
                  type="button"
                  title={PREVIEW_REASON}
                  onClick={() => {
                    if (!character) return;
                    onFilm({
                      ...film,
                      characters: film.characters.map((item) =>
                        item.id === character.id ? { ...item, voiceId: voice.id } : item,
                      ),
                    });
                    onNotice(`${voice.name}，${voice.description}。${PREVIEW_REASON}`);
                  }}
                >
                  {character?.voiceId === voice.id ? "已选" : "选用"}
                </button>
              </div>
            ))}
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
  onFilm,
  onNotice,
  onGenerate,
  onBatch,
  stills,
  onStills,
  onPickStill,
  role,
  onRole,
  pending,
  onApply,
  onAction,
  onPerformance,
  chat,
  onChat,
  onSend,
}: {
  film: FilmProject;
  shots: FilmShot[];
  shot: number;
  onShot: (index: number) => void;
  onFilm: (film: FilmProject) => void;
  onNotice: (text: string) => void;
  onGenerate: () => void;
  onBatch: () => void;
  stills: string[];
  onStills: () => void;
  onPickStill: (picture: string) => void;
  role: Role;
  onRole: (role: Role) => void;
  pending: FilmShot[] | null;
  onApply: () => void;
  onAction: () => void;
  onPerformance: () => void;
  chat: string;
  onChat: (value: string) => void;
  onSend: () => void;
}) {
  const [tab, setTab] = useState<"props" | "ai">("props");
  const current = shots[shot];
  const seconds = shots.reduce((sum, item) => sum + item.seconds, 0);
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
              const sceneId = current?.sceneId ?? film.scenes[0]?.id ?? "scene-1";
              onFilm(addShot(film, sceneId));
              onNotice("已加一个镜头。");
            }}
          >
            <Ic name="plus" size={15} />
          </button>
        </div>
        <div className="pb scenes">
          {film.scenes.map((item) => (
            <div key={item.id} className={item.id === current?.sceneId ? "scene on" : "scene"}>
              <span className="no">{String(item.no).padStart(2, "0")}</span>
              <span className="t">
                {item.title}
                <small>{item.where}</small>
              </span>
              <span className="c">
                {film.shots.filter((shotItem) => shotItem.sceneId === item.id).length} 镜
              </span>
            </div>
          ))}
        </div>
        <div className="pfoot">
          <span>
            已生成{" "}
            <b>
              {
                film.shots.filter((item) => item.takes.some((take) => take.status === "done"))
                  .length
              }
            </b>{" "}
            / {film.shots.length}
          </span>
          <span>
            约 <b>{seconds} 秒</b>
          </span>
        </div>
      </section>
      <section className="pane">
        <div className="tool">
          <h3>{film.scenes.find((item) => item.id === current?.sceneId)?.title ?? "镜头"}</h3>
          <span className="meta">
            {shots.length} 个镜头 · {seconds} 秒
          </span>
          <span className="sp" />
          <button
            className="btn"
            onClick={() => {
              const sceneId = current?.sceneId ?? film.scenes[0]?.id ?? "scene-1";
              onFilm(addShot(film, sceneId));
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
        <div className="pb grid">
          {shots.map((item, index) => (
            <button
              key={item.id}
              className={index === shot ? "card sel" : "card"}
              onClick={() => onShot(index)}
            >
              <div style={{ position: "relative" }}>
                <FrameThumb shot={item} />
                <span
                  className={
                    item.takes.some((take) => take.status === "done") ? "badge ok" : "badge none"
                  }
                >
                  {item.takes.some((take) => take.status === "done")
                    ? `版本 ${item.takes.find((take) => take.id === item.selectedTakeId)?.index ?? item.takes.filter((take) => take.status === "done").length}/${item.takes.length}`
                    : "未生成"}
                </span>
                <span className="dur">{item.seconds}s</span>
              </div>
              <div className="cb">
                <div className="ct">
                  镜头 {item.no} <span>{item.size}</span>
                </div>
                <p>{item.picture}</p>
                <span className="tag">{item.characters[0] ?? "人物"}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
      <section className="pane">
        <div className="ptabs">
          <button className={tab === "props" ? "on" : ""} onClick={() => setTab("props")}>
            属性
          </button>
          <button className={tab === "ai" ? "on" : ""} onClick={() => setTab("ai")}>
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
              if (label.includes("动作")) onAction();
              else if (label.includes("表演")) onPerformance();
              else onSend();
            }}
          />
        ) : current ? (
          <>
            <div className="shot-h">
              镜头 {current.no}{" "}
              <span>
                {current.takes.some((take) => take.status === "done") ? "已有版本" : "未生成"}
              </span>
            </div>
            <div className="pb">
              <div className="field">
                <div className="row2">
                  <div>
                    <label>景别</label>
                    <select
                      className="input"
                      aria-label="景别"
                      value={current.size}
                      onChange={(event) =>
                        onFilm(
                          updateShot(film, current.id, {
                            size: event.target.value,
                            userFields: [...new Set([...current.userFields, "size"])],
                          }),
                        )
                      }
                    >
                      {(SHOT_SIZES.includes(current.size)
                        ? SHOT_SIZES
                        : [current.size, ...SHOT_SIZES]
                      ).map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>运镜</label>
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
                </div>
              </div>
              <div className="field">
                <div className="row2">
                  <div>
                    <label>时长</label>
                    <div className="input">{current.seconds} 秒</div>
                  </div>
                  <div>
                    <label>角度</label>
                    <div className="input">{current.angle || "平视"}</div>
                  </div>
                </div>
              </div>
              <div className="field">
                <label htmlFor="shot-style">画风</label>
                <select
                  id="shot-style"
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
                <textarea
                  className="area"
                  aria-label="这一镜的画风"
                  style={{ marginTop: 8 }}
                  placeholder="不写就用整部作品的画风"
                  value={current.styleNote ?? ""}
                  onChange={(event) =>
                    onFilm(updateShot(film, current.id, { styleNote: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label>画面描述</label>
                <textarea
                  className="area"
                  aria-label="分镜画面"
                  value={current.picture}
                  onChange={(event) =>
                    onFilm(
                      updateShot(film, current.id, {
                        picture: event.target.value,
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
                  {current.characters.map((name) => (
                    <span key={name} className="tag">
                      {name}
                    </span>
                  ))}
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
            <div className="pfoot2">
              <button className="btn" onClick={() => onFilm(moveShot(film, current.id, -1))}>
                前移
              </button>
              <button className="btn" onClick={() => onFilm(moveShot(film, current.id, 1))}>
                后移
              </button>
              <button
                className="btn"
                onClick={() => {
                  onFilm(removeShot(film, current.id));
                  onNotice("已删除这一镜。");
                }}
              >
                删除
              </button>
              <button className="btn" onClick={onStills}>
                生成画面
              </button>
              <button className="btn primary" onClick={onGenerate}>
                生成视频
              </button>
            </div>
          </>
        ) : (
          <p className="role-desc">先在剧本里让导演拆镜头。</p>
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
                <small
                  className={
                    item.takes.some((take) => take.status === "done") ? "st-ok" : "st-none"
                  }
                >
                  {item.takes.some((take) => take.status === "done")
                    ? `已完成 ${item.takes.filter((take) => take.status === "done").length}`
                    : "未生成"}
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
                src={picked.videoUrl}
                playing={playing}
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
                    版本 {item.index}/{takes.length}
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
                {[2, 3, 5, 8].map((seconds) => (
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
                  先出草稿
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
  onNotice,
  onPlaying,
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
  onPlaying: (value: boolean) => void;
  shots: FilmShot[];
}) {
  const [mediaTime, setMediaTime] = useState(0);
  const clips = clipLayout(shots);
  const cues = subtitleCues(shots);
  const current = shots[shot] ?? shots[0];
  const previewSrc =
    film.assemblyUrl ||
    current?.takes.find((item) => item.id === current.selectedTakeId)?.videoUrl ||
    "";
  useEffect(() => {
    setMediaTime(0);
  }, [shot, previewSrc]);
  const start = shots.slice(0, shot).reduce((sum, item) => sum + item.seconds, 0);
  const selected = clips[shot];
  const tiles: { id: FixAction; icon: string; label: string }[] = [
    { id: "regenerate", icon: "refresh", label: "重新生成" },
    { id: "rewrite", icon: "edit", label: "改描述再生成" },
    { id: "edit", icon: "wand", label: "改画面细节" },
    { id: "extend", icon: "extend", label: "往后延长" },
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
              <button disabled title="只看新版还没接上。">
                只看新版
              </button>
            </div>
          </div>
          <div className="cmp">
            {(current?.takes ?? []).slice(0, 2).map((item) => (
              <div className="side" key={item.id}>
                <div className="lbl">
                  <span>
                    版本 {item.index}/{current?.takes.length ?? 0}
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
            <div className="mtabs">
              <button className="on">
                <Ic name="film" size={16} />
                镜头
              </button>
              <button disabled title="配音轨还没接上。">
                <Ic name="mic" size={16} />
                配音
              </button>
              <button disabled title="音乐轨还没接上。">
                <Ic name="music" size={16} />
                音乐
              </button>
              <button disabled title="字幕轨还没接上。">
                <Ic name="text" size={16} />
                字幕
              </button>
            </div>
            <div className="ph">
              <span className="meta">{shots.length} 个镜头</span>
              <span className="sp" />
              <button className="icon-btn sm" aria-label="搜索" disabled title="搜索还没接上。">
                <Ic name="search" size={14} />
              </button>
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
                  playing={playing}
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
              <div className="cr">
                <button className="icon-btn" aria-label="音量" disabled title="音量还没接上。">
                  <Ic name="vol" />
                </button>
                <button className="icon-btn" aria-label="全屏" disabled title="全屏还没接上。">
                  <Ic name="max" />
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
                <div className="area" style={{ height: 62, overflow: "hidden" }}>
                  {current?.picture || "还没有这一镜的描述。"}
                </div>
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
                  <label>运镜</label>
                  <div className="input">{current?.move || "固定"}</div>
                </div>
              </div>
            </div>
            <div className="field">
              <label>进入方式</label>
              <div className="input">转场还没接上。</div>
            </div>
            <div className="field">
              <button className="btn" onClick={onSelectRange}>
                回到分镜重新生成
              </button>
            </div>
            <p className="role-desc">{LOUDNESS_NOTE}</p>
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
              title={actions.edit.reason}
              aria-disabled={!actions.edit.enabled}
              onClick={() => onAction("edit")}
            >
              <Ic name="wand" size={13} />
              改细节
            </button>
            <button
              className="btn"
              title={actions.extend.reason}
              aria-disabled={!actions.extend.enabled}
              onClick={() => onAction("extend")}
            >
              <Ic name="extend" size={13} />
              延长
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
              aria-label="分割"
              title="分割还没接上。"
              onClick={() => onNotice("分割还没接上。")}
            >
              <Ic name="split" />
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
            <button
              className="icon-btn"
              aria-label="设入点"
              title="设入点 (I)"
              onClick={onSelectRange}
            >
              <Ic name="bracketL" />
            </button>
            <button
              className="icon-btn"
              aria-label="设出点"
              title="设出点 (O)"
              onClick={onSelectRange}
            >
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
            <button className="icon-btn" aria-label="自动吸附" disabled title="自动吸附还没接上。">
              <Ic name="magnet" />
            </button>
            <button className="icon-btn" aria-label="缩小" disabled title="缩放还没接上。">
              <Ic name="zout" />
            </button>
            <span className="zoom" />
            <button className="icon-btn" aria-label="放大" disabled title="缩放还没接上。">
              <Ic name="zin" />
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
              配音
            </div>
            <div className="th" style={{ height: "var(--ha)" }}>
              <span className="sw" style={{ background: "var(--t-music)" }} />
              <Ic name="music" size={13} />
              音乐
            </div>
          </div>
          <div className="tracks">
            <div className="ruler">
              {[0, 0.5, 1].map((part, index) => {
                const total = shots.reduce((sum, item) => sum + item.seconds, 0);
                return (
                  <span key={part} style={{ left: index * 160 }}>
                    {clock(total * part)}
                  </span>
                );
              })}
            </div>
            <div className="lane" style={{ height: "var(--hs)" }}>
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
              {cues.map((cue) => {
                const clip = clips.find((item) => item.id === cue.id);
                const owner = shots.find((item) => item.id === cue.id);
                if (!clip) return null;
                return (
                  <div
                    key={cue.id}
                    className="clip a"
                    style={{ left: clip.left, width: clip.width }}
                  >
                    <span className="tx">{owner?.characters[0] ?? "配音"}</span>
                  </div>
                );
              })}
            </div>
            <div className="lane" style={{ height: "var(--ha)" }} />
            {range && selected && (
              <div className="range" style={{ left: selected.left, width: selected.width }}>
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
      </section>
    </>
  );
}
