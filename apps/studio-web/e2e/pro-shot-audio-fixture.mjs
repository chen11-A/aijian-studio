/** Synthetic native suggestion ABI only; never copies, decodes, plays or creates audio. */
export function seedShotAudioProject({ shotId }) {
  const key = window.localStorage.getItem("aivora.film.activeId");
  const film = JSON.parse(window.localStorage.getItem(`aivora.film.v1.${key}`));
  const shot = film.shots.find((s) => s.id === shotId);
  film.audioClips = [
    {
      id: "suggestion-preserved-clip",
      shotId,
      takeId: shot.selectedTakeId,
      lane: "sfx",
      path: "/synthetic/preserved.ogg",
      label: "原有音效",
      startSeconds: 0,
      durationSeconds: 1,
      offsetSeconds: 0,
      gainDb: -9,
      enabled: true,
    },
  ];
  for (const store of ["aivora.film.active", `aivora.film.v1.${key}`])
    window.localStorage.setItem(store, JSON.stringify(film));
}
export function installShotAudioBridge({ state, catalog }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const bridge = window.aijian,
    creation = window.__proCreationAudit;
  const originalWrite = bridge.writeFilmProject;
  const audit = {
    calls: [],
    writes: 0,
    rejectedWrites: 0,
    forbidden: [],
    pending: [],
    flushes: [],
    failWrites: false,
    mode:
      state === "shot-audio-pending-stale"
        ? "hold"
        : state === "shot-audio-empty-missing"
          ? "missing"
          : "ready",
    duration: 2.25,
  };
  window.__shotAudioAudit = audit;
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_SHOT_AUDIO_DISPATCH");
  };
  for (const name of [
    "addBundledFilmAudio",
    "applyBundledFilmShotAudio",
    "generateFilmStill",
    "createStoryFilm",
    "importMusic",
    "exportFilmProjectArchive",
    "importFilmProjectArchive",
    "prepareFilmExport",
    "publishFilmExport",
    "discardFilmExport",
  ])
    bridge[name] = async () => forbidden(name);
  bridge.writeFilmProject = async (film) => {
    if (audit.failWrites) {
      audit.rejectedWrites++;
      throw Error("PRIVATE_SYNTHETIC_SAVE_FAILURE");
    }
    const stored = await originalWrite(film);
    audit.writes++;
    return stored;
  };
  bridge.getFilmAudioMixPreview = async (input) => {
    if (input.expectedHash !== (await creation.hash(creation.record(input.projectId))))
      return forbidden("preview-input");
    return { kind: "FAILED", code: "SOURCE_UNVERIFIED" };
  };
  bridge.readFilmAudioWaveform = async () => ({ kind: "FAILED", code: "TOOLS_UNAVAILABLE" });
  let flushHandler;
  bridge.onFlush = (callback) => {
    flushHandler = callback;
    return () => {
      flushHandler = undefined;
    };
  };
  bridge.flushed = async (value) => {
    audit.flushes.push(clone(value));
  };
  audit.flush = () => {
    if (!flushHandler) throw Error("MISSING_FLUSH_HANDLER");
    flushHandler({ requestId: "shot-audio-readonly-quit" });
  };
  const assetFor = (lane) =>
    catalog.assets.find(
      (a) =>
        a.type === (lane === "score" ? "music" : "sfx") &&
        a.durationSeconds > 3 &&
        /^https?:/.test(a.source),
    );
  const plan = (input) => ({
    kind: "SUGGESTED",
    projectId: input.projectId,
    projectHash: input.expectedProjectHash,
    shotId: input.shotId,
    takeId: input.takeId,
    durationSeconds: audit.duration,
    catalogSha256: catalog.manifestSha256,
    pickerSha256: "b".repeat(64),
    planFingerprint: "c".repeat(64),
    clips: ["ambience", "ambience", "sfx", "sfx", "score", "score"].map((lane, i) => ({
      key: `segment-${i}`,
      lane,
      asset: clone(assetFor(lane)),
      reason: "合成计划：根据明确文字时间安排，不代表已听过。",
      placement: {
        startSeconds: i % 2 ? 1.25 : 0.123456789,
        durationSeconds: 0.5,
        offsetSeconds: 0.125,
        gainDb: -30,
        loop: false,
      },
      envelope: {
        schemaVersion: 1,
        baseGainDb: -25,
        fades: [
          { direction: "in", startSeconds: -0.25, durationSeconds: 0.5 },
          { direction: "out", startSeconds: 0.25, durationSeconds: 0.25 },
        ],
        gainAutomation: [
          { startSeconds: 0, endSeconds: 0.25, gainDb: -32 },
          { startSeconds: 0.25, endSeconds: 0.5, gainDb: -28 },
        ],
      },
    })),
    warnings: Array.from({ length: 5 }, (_, i) => ({
      code: "MATCH_MISSING",
      index: i + 1,
      message: `合成提醒${i + 1}：${"未匹配的动作声音仍需人工决定，已有素材不应被覆盖。".repeat(10)}`,
    })),
    limitations: Array.from({ length: 5 }, (_, i) => ({
      code: "PLANNED_TIMES_ONLY",
      index: i + 1,
      message: `合成限制${i + 1}：${"文字计划并非成片动作、对白或听感审核；尚未试听。".repeat(10)}`,
    })),
  });
  audit.resolvePending = () => {
    const pending = audit.pending.shift();
    if (!pending) throw Error("MISSING_SUGGESTION_ADMISSION");
    audit.mode = "ready";
    pending.resolve(clone(pending.plan));
  };
  bridge.suggestBundledFilmShotAudio = async (input) => {
    const raw = creation.record(input.projectId),
      shot = raw?.shots.find((s) => s.id === input.shotId);
    const matched =
      Object.keys(input).sort().join() === "expectedProjectHash,projectId,shotId,takeId" &&
      shot?.selectedTakeId === input.takeId &&
      input.expectedProjectHash === (await creation.hash(raw));
    audit.calls.push({ input: clone(input), matched, mode: audit.mode });
    if (!matched) return forbidden("suggestion-input");
    if (audit.mode === "missing")
      return { kind: "FAILED", code: "LIBRARY_UNAVAILABLE", unchanged: true };
    if (audit.mode === "source-failed")
      return { kind: "FAILED", code: "SOURCE_UNVERIFIED", unchanged: true };
    if (audit.mode === "limit")
      return {
        kind: "FAILED",
        code: "PLAN_UNSUPPORTED",
        reason: "TRACK_LIMIT",
        maxSegments: 128,
        minimumRequiredSegments: 129,
        unchanged: true,
      };
    const value = plan(input);
    if (audit.mode === "invalid") return { ...value, durationSeconds: NaN };
    if (audit.mode === "empty")
      return {
        ...value,
        clips: [],
        warnings: [],
        limitations: [
          { code: "MUSIC_MOOD_UNDECIDED", message: "配乐情绪待决定，暂不建议配乐。" },
          { code: "ACTION_TIME_UNCONFIRMED", message: "动作没有明确计划时间，未安排对应音效。" },
        ],
      };
    if (audit.mode === "hold")
      return new Promise((resolve) => {
        audit.pending.push({ resolve, plan: value });
        audit.pendingAdmitted?.();
      });
    return clone(value);
  };
}
