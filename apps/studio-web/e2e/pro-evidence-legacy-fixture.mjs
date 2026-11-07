/** Synthetic evidence ABI only: no filesystem write, decoder, provider or user account. */
export function installEvidenceLegacyBridge({ state }) {
  const bridge = window.aijian,
    creation = window.__proCreationAudit,
    clone = (value) => JSON.parse(JSON.stringify(value));
  const receipts = new Map();
  let serial = 0;
  const audit = {
    waveforms: [],
    prepares: [],
    publishes: [],
    results: [],
    filmWrites: [],
    pending: [],
    exportCancels: [],
    opened: [],
    revealed: [],
    forbidden: [],
  };
  window.__proEvidenceLegacyAudit = audit;
  if (typeof bridge.writeFilmProject === "function") {
    const write = bridge.writeFilmProject;
    bridge.writeFilmProject = async (value) => {
      const result = await write(value);
      audit.filmWrites.push({ projectId: value.id, stored: clone(result) });
      return result;
    };
  }
  const observed = (result) => {
    audit.results.push(clone(result));
    return result;
  };
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_EVIDENCE_LEGACY_DISPATCH");
  };
  // Optional local analysis is not paid dispatch. Validate the actual canonical source
  // identity, then refuse tools predictably; this gate never invents peaks or decodes audio.
  bridge.readFilmAudioWaveform = async (input) => {
    const film = creation.record(input?.projectId),
      clips = film?.audioClips?.filter((clip) => clip.id === input?.clipId) ?? [];
    if (
      !input ||
      Object.keys(input).sort().join() !== "clipId,expectedSourceKey,projectId" ||
      !film ||
      clips.length !== 1 ||
      typeof input.expectedSourceKey !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.expectedSourceKey)
    )
      return forbidden("waveform-scope");
    const clip = clips[0],
      shots = film.shots.filter((shot) => shot.id === clip.shotId);
    if (!clip.path?.startsWith("/synthetic/") || shots.length !== 1)
      return forbidden("waveform-source");
    const shot = shots[0],
      selected = typeof shot.selectedTakeId === "string" ? shot.selectedTakeId : "",
      takes = shot.takes.filter((take) => take.id === selected);
    if (takes.length > 1) return forbidden("waveform-source");
    const take = takes[0],
      expected = await creation.hash([
        film.id,
        clip.id,
        clip.lane,
        clip.shotId,
        clip.takeId,
        clip.label,
        clip.path,
        clip.offsetSeconds,
        clip.durationSeconds,
        selected,
        take?.videoPath ?? "",
        take?.status ?? "",
        film.seriesId ?? "",
        film.backendProjectId ?? "",
      ]);
    if (expected !== input.expectedSourceKey) return forbidden("waveform-key");
    const code = selected !== clip.takeId ? "SOURCE_CHANGED" : "TOOLS_UNAVAILABLE";
    audit.waveforms.push({ input: clone(input), matched: true, code });
    return { kind: "FAILED", code };
  };
  bridge.createProject = async () => forbidden("createProject");
  for (const name of [
    "createStoryFilm",
    "createFilmVideo",
    "generateFilmRange",
    "prepareFilmRange",
    "submitGeneration",
    "exportFilmCut",
    "assembleFilm",
  ])
    bridge[name] = async () => forbidden(name);
  window.aijianGrok.completeText = async () => forbidden("completeText");
  window.aijianGrok.generateVideo = async () => forbidden("generateVideo");
  window.aijianGrok.speak = async () => forbidden("speak");
  bridge.openFilmPath = async (path) => {
    audit.opened.push(path);
  };
  bridge.revealFilmPath = async (path) => {
    audit.revealed.push(path);
  };
  const selection = (film) =>
    film.shots
      .filter((s) =>
        s.takes.some((t) => t.id === s.selectedTakeId && t.status === "done" && t.videoPath),
      )
      .sort(
        (a, b) =>
          film.scenes.findIndex((s) => s.id === a.sceneId) -
            film.scenes.findIndex((s) => s.id === b.sceneId) || a.no - b.no,
      )
      .map((s) => ({ shotId: s.id, takeId: s.selectedTakeId }));
  bridge.cancelFilmExportOperation = async (operationId) => {
    const kind = audit.pending.some((entry) => entry.operationId === operationId && !entry.released)
      ? "UNAVAILABLE"
      : "NOT_FOUND";
    audit.exportCancels.push({ operationId, kind });
    return { kind };
  };
  bridge.prepareFilmExport = async (input, operationId) => {
    const film = creation.record(input.projectId);
    if (
      !film ||
      JSON.stringify(selection(film)) !== JSON.stringify(input.expectedSelection) ||
      !operationId ||
      Object.keys(input).sort().join() !== "expectedSelection,projectId,settings"
    )
      return forbidden("prepareScope");
    const token = `synthetic-evidence-review-${++serial}`;
    receipts.set(token, { input: clone(input), film: clone(film) });
    audit.prepares.push({ input: clone(input), operationId });
    return {
      kind: "READY",
      qcReceipt: token,
      fileName: "合成成片.mp4",
      shots: input.expectedSelection.map((s, i) => ({
        id: s.shotId,
        label: `选材第 ${i + 1} 镜`,
        start: i * 1.5,
        end: (i + 1) * 1.5,
      })),
      outputs: input.settings.aspects.map((aspect) => ({
        aspectRatio: aspect,
        report: {
          schemaVersion: 1,
          media: {
            duration: input.expectedSelection.length * 1.5,
            width: aspect === "16:9" ? 1920 : 1080,
            height: aspect === "16:9" ? 1080 : 1920,
          },
          audio: { present: true, integratedLufs: -16, truePeakDbtp: -2 },
          assumptions: { streams: "合成技术记录，不是文件检查" },
          issues: [],
        },
      })),
      unverified: ["完整观看和试听仍需人工完成。"],
    };
  };
  bridge.discardFilmExport = async (token) => {
    receipts.delete(token);
  };
  audit.release = (index) => {
    const entry = audit.pending[index];
    if (!entry || entry.released) throw Error("EVIDENCE_PENDING_MISSING");
    entry.released = true;
    entry.resolve();
  };
  bridge.publishFilmExport = async (input, operationId) => {
    const receipt = receipts.get(input.qcReceipt);
    receipts.delete(input.qcReceipt);
    const { qcReceipt, ...scope } = input;
    if (
      !receipt ||
      !qcReceipt ||
      JSON.stringify(scope) !== JSON.stringify(receipt.input) ||
      !operationId
    )
      return forbidden("publishScope");
    audit.publishes.push({ input: clone(input), operationId });
    if (state === "evidence-stale" && audit.publishes.length === 2)
      await new Promise((resolve) => audit.pending.push({ resolve, released: false, operationId }));
    const cleanup = state === "evidence-partial" && audit.publishes.length === 2;
    const partial =
      (state === "evidence-partial" && audit.publishes.length === 1) ||
      (state === "evidence-failed-legacy" && audit.publishes.length === 1);
    const aspects = partial ? input.settings.aspects.slice(0, 1) : input.settings.aspects;
    const files = aspects.flatMap((aspect, i) => {
      const stem = `合成交付长文件名${"完整记录".repeat(12)}-${aspect.replace(":", "x")}-${audit.publishes.length}`;
      const file = {
        role: "video",
        aspectRatio: aspect,
        fileName: `${stem}.mp4`,
        sha256: (i ? "c" : "b").repeat(64),
        bytes: 1234,
        technical: {
          durationSeconds: input.expectedSelection.length * 1.5,
          durationBasis: "video-stream",
          video: {
            codec: "h264",
            width: aspect === "16:9" ? 1920 : 1080,
            height: aspect === "16:9" ? 1080 : 1920,
            displayWidth: aspect === "16:9" ? 1920 : 1080,
            displayHeight: aspect === "16:9" ? 1080 : 1920,
            averageFrameRate: 29.97,
            pixelFormat: "yuv420p",
            colorSpace: null,
            colorPrimaries: null,
            colorTransfer: null,
            colorRange: null,
          },
          audioTracks: partial
            ? null
            : [{ index: 0, codec: "aac", sampleRate: 48000, channels: 2, channelLayout: "stereo" }],
        },
        qc: {
          schemaVersion: 1,
          status: "clear",
          counts: { block: 0, warn: 0, info: 0 },
          integratedLufs: -16,
          truePeakDbtp: -2,
        },
      };
      return [
        file,
        ...(input.settings.subtitles === "srt"
          ? [
              {
                role: "subtitles",
                aspectRatio: aspect,
                fileName: `${stem}.srt`,
                sha256: "d".repeat(64),
                bytes: 56,
                technical: null,
                qc: null,
              },
            ]
          : []),
      ];
    });
    const outputs = aspects.map((aspect) => ({
      aspectRatio: aspect,
      path: `/synthetic/published/${files.find((f) => f.role === "video" && f.aspectRatio === aspect).fileName}`,
    }));
    if (state === "evidence-failed-legacy")
      return observed(
        audit.publishes.length === 1
          ? {
              kind: "PARTIAL",
              outputs,
              deliveryEvidence: {
                kind: "FAILED",
                code: "EVIDENCE_WRITE_FAILED",
                files: files.map(({ role, aspectRatio, fileName }) => ({
                  role,
                  aspectRatio,
                  fileName,
                })),
              },
            }
          : { kind: "PUBLISHED", outputs },
      );
    const manifest = {
      schemaVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      status: partial ? "partial" : "complete",
      selection: input.expectedSelection.map((s, i) => {
        const shot = receipt.film.shots.find((row) => row.id === s.shotId),
          scene = receipt.film.scenes.find((row) => row.id === shot.sceneId),
          take = shot.takes.find((row) => row.id === s.takeId);
        return {
          shotId: shot.id,
          takeId: take.id,
          label: `第 ${scene.no} 场 · 镜头 ${shot.no}`,
          versionLabel: take.index ? `第 ${take.index} 版` : null,
          startSeconds: i * 1.5,
          endSeconds: (i + 1) * 1.5,
        };
      }),
      settings: clone(input.settings),
      files,
      unverified: Array.from(
        { length: 6 },
        (_, i) =>
          `未验证项 ${i + 1}：${"人物身份、动作、字幕完整性、口型与全部音轨听感仍需人工完整播放核对。".repeat(state === "evidence-written" ? 5 : 1)}`,
      ),
    };
    return observed({
      kind: partial || cleanup ? "PARTIAL" : "PUBLISHED",
      outputs,
      deliveryEvidence: {
        ...(cleanup ? { cleanupUnconfirmed: true } : {}),
        kind: "WRITTEN",
        fileName: `合成交付证据清单-${audit.publishes.length}.json`,
        manifestSha256: "a".repeat(64),
        manifest,
      },
    });
  };
}
export function seedEvidenceLegacyProject({ state }) {
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active")),
    clone = (value) => JSON.parse(JSON.stringify(value));
  film.jobs = [];
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.shots = film.shots.map((shot, i) => ({
    ...shot,
    sceneId: film.scenes[0].id,
    no: i + 1,
    picture: `合成原镜头 ${String.fromCharCode(65 + i)}，人物站在门边。`,
    line: "",
    lines: [],
    speaker: "",
    characters: [film.characters[0].name],
  }));
  film.audioClips = film.shots.map((shot, i) => ({
    id: `legacy-voice-${i}`,
    lane: "dialogue",
    shotId: shot.id,
    takeId: shot.selectedTakeId,
    label: `合成旧声音 ${i + 1}`,
    path: `/synthetic/voice-${i}.wav`,
    startSeconds: 0,
    durationSeconds: 1,
    offsetSeconds: 0,
    gainDb: -3,
    enabled: true,
  }));
  if (state === "legacy-empty-fullscreen") {
    film.shots[0].takes = [];
    film.shots[0].selectedTakeId = "";
  }
  if (state === "legacy-cast-search")
    film.characters = Array.from({ length: 12 }, (_, i) => ({
      ...clone(film.characters[0]),
      id: `legacy-person-${i + 1}`,
      name: `合成人物${String(i + 1).padStart(2, "0")}完整长名字`,
      portraits: [],
    }));
  if (state === "legacy-cast-search")
    for (const shot of film.shots) shot.characters = [film.characters[0].name];
  const other = {
    ...clone(film),
    id: "evidence-other-work",
    episodeNo: 2,
    episodeTitle: "合成交付第2集",
    styleZh: "另一作品的字段和素材保留。",
  };
  window.localStorage.setItem(`aivora.film.v1.${other.id}`, JSON.stringify(other));
  const text = JSON.stringify(film);
  window.localStorage.setItem("aivora.film.active", text);
  window.localStorage.setItem("aivora.film.activeId", film.id);
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, text);
  return {
    projectId: film.id,
    otherId: other.id,
    shotIds: film.shots.map((s) => s.id),
    person: film.characters.at(-1).name,
  };
}

/** Read-only real rectangles; the original full-box clipping rule is unchanged. */
export function measureEvidenceControl(element) {
  const r = element.getBoundingClientRect();
  let l = 0,
    t = 0,
    right = window.innerWidth,
    bottom = window.innerHeight,
    clip = null;
  for (let p = element.parentElement; p; p = p.parentElement) {
    const css = window.getComputedStyle(p),
      b = p.getBoundingClientRect();
    if (/hidden|clip|auto|scroll/.test(css.overflowX)) {
      if (b.left > l || b.right < right) clip = p;
      l = Math.max(l, b.left);
      right = Math.min(right, b.right);
    }
    if (/hidden|clip|auto|scroll/.test(css.overflowY)) {
      if (b.top > t || b.bottom < bottom) clip = p;
      t = Math.max(t, b.top);
      bottom = Math.min(bottom, b.bottom);
    }
  }
  const bounds = (b) => ({ x: b.x, y: b.y, width: b.width, height: b.height });
  const menu = element.closest(".mention-menu"),
    style = menu ? window.getComputedStyle(menu) : null;
  const hit = window.document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const kinds = ["mention-menu", "mention-wrap", "chat-context", "pane", "pro-root"];
  return {
    complete:
      r.width > 2 &&
      r.height > 2 &&
      r.left >= l - 1 &&
      r.right <= right + 1 &&
      r.top >= t - 1 &&
      r.bottom <= bottom + 1,
    box: bounds(r),
    visible: { x: l, y: t, width: Math.max(0, right - l), height: Math.max(0, bottom - t) },
    clipKind: clip ? (kinds.find((name) => clip.classList.contains(name)) ?? "other") : "other",
    clipBox: clip ? bounds(clip.getBoundingClientRect()) : null,
    hitSelf: !!hit && (hit === element || element.contains(hit)),
    menuPosition: ["absolute", "fixed", "relative", "static"].includes(style?.position)
      ? style.position
      : "unknown",
    menuTop: style ? Number.parseFloat(style.top) : null,
    menuLeft: style ? Number.parseFloat(style.left) : null,
    menuBox: menu ? bounds(menu.getBoundingClientRect()) : null,
  };
}
/** Closed DOM observations, not source strings, React state or fabricated clock values. */
export function readEvidencePointer({ x, y }) {
  const root = window.document.querySelector(".pro-root"),
    video = window.document.querySelector(".preview-player video.frame"),
    active = window.document.querySelector(".pane.monitor .monitor-tabs .on")?.textContent.trim();
  const stages = ["script", "cast", "board", "edit"],
    stage = root?.getAttribute("data-stage");
  const declared = (source) => {
    try {
      const url = new window.URL(source);
      return (
        url.protocol === "aivora-media:" &&
        window.__assemblyAudit.artifacts.some((a) => a.path === url.searchParams.get("path"))
      );
    } catch {
      return false;
    }
  };
  const hit = window.document.elementFromPoint(x, y),
    button = hit?.closest("button"),
    text = button?.textContent.trim();
  const target = hit?.closest(".ruler")
    ? "ruler"
    : hit?.closest(".monitor-tabs")
      ? ({ 预览: "preview-tab", 声音: "sound-tab", 字幕: "subtitles-tab" }[text] ?? "other")
      : hit?.closest(".track-area")
        ? "track-area"
        : "other";
  return {
    stage: stages.includes(stage) ? stage : "unknown",
    monitor: { 预览: "preview", 声音: "sound", 字幕: "subtitles" }[active] ?? "unknown",
    videos: window.document.querySelectorAll(".preview-player video.frame").length,
    attached: video?.isConnected === true,
    current: declared(video?.currentSrc),
    attribute: declared(video?.src),
    ready: video?.readyState ?? null,
    time: video?.currentTime ?? null,
    hit: target,
    x,
    y,
  };
}

/** Observe this drag's original track element only; never changes event defaults or selection. */
export function observeEvidenceRangeDrag(command) {
  if (command === "read") {
    const value = window.__evidenceRangeDrag?.read() ?? null;
    window.__evidenceRangeDrag?.close();
    return value;
  }
  window.__evidenceRangeDrag?.close();
  const area = window.document.querySelector(".track-area");
  if (!area || command !== "start") return null;
  const kinds = [
    "pointerdown",
    "gotpointercapture",
    "pointermove",
    "pointerup",
    "lostpointercapture",
    "pointercancel",
    "dragstart",
    "dragend",
  ];
  const events = [],
    counts = Object.fromEntries(kinds.map((kind) => [kind, 0]));
  const number = (value) =>
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 200000 ? value : null;
  let started = false,
    closed = false;
  const listeners = kinds.map((kind) => {
    const listener = (event) => {
      if (kind === "pointerdown") started = true;
      if (!started || (kind === "pointermove" && event.buttons === 0)) return;
      counts[kind]++;
      if (events.length >= 12) return;
      events.push({
        kind,
        buttons:
          Number.isInteger(event.buttons) && event.buttons >= 0 && event.buttons <= 7
            ? event.buttons
            : null,
        hit: event.target?.closest?.(".ruler")
          ? "ruler"
          : event.target?.closest?.(".clip.v")
            ? "clip"
            : event.target?.closest?.(".track-area")
              ? "track-area"
              : "other",
        x: number(event.clientX),
        y: number(event.clientY),
        value: number(
          Number(
            window.document.querySelector('.ruler[role="slider"]')?.getAttribute("aria-valuenow"),
          ),
        ),
      });
    };
    area.addEventListener(kind, listener, true);
    return [kind, listener];
  });
  window.__evidenceRangeDrag = {
    close: () => {
      if (closed) return;
      closed = true;
      for (const [kind, listener] of listeners) area.removeEventListener(kind, listener, true);
    },
    read: () => ({
      attached: area.isConnected === true,
      selectionCollapsed: window.getSelection()?.isCollapsed ?? null,
      counts: { ...counts },
      events: events.map((event) => ({ ...event })),
    }),
  };
  return null;
}
