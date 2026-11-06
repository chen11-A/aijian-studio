/** Browser-only synthetic ABI. No audio samples, suppliers or native filesystem are contacted. */
export function installFeatureBridge({ state }) {
  const audit = { text: [], waves: [], pending: [], assemblies: [], forbidden: [] };
  window.__proFeatureAudit = audit;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  audit.saved = () => {
    const id = window.localStorage.getItem("aivora.film.activeId");
    const raw =
      window.localStorage.getItem(`aivora.film.v1.${id}`) ||
      window.localStorage.getItem("aivora.film.active");
    return raw ? JSON.parse(raw) : null;
  };
  const bridge = window.aijian;
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("Forbidden feature-audit dispatch");
  };
  for (const name of [
    "prepareFilmExport",
    "publishFilmExport",
    "exportFilmCut",
    "generateFilmStill",
    "generateFilmVideo",
    "createStoryFilm",
    "importMusic",
    "remakeStoryFilmCleanCopy",
  ])
    bridge[name] = async () => forbidden(name);
  bridge.assembleFilm = async (seriesId, paths, musicPath, gainDb, dialogue) => {
    audit.assemblies.push({
      projectId: audit.saved()?.id,
      seriesId,
      paths: clone(paths),
      musicPath,
      gainDb,
      dialogue: clone(dialogue),
    });
    // Local preview assembly is a legitimate optional ABI, distinct from paid generation/export.
    // Refuse predictably: this UI gate never runs FFmpeg or claims a real joined preview.
    throw new Error("SYNTHETIC_LOCAL_PREVIEW_UNAVAILABLE");
  };
  bridge.prepareFilmProject = async (film) => clone(film);
  bridge.readFilmAudioWaveform = async (input) => {
    audit.waves.push(clone(input));
    const film = audit.saved(),
      clip = film?.audioClips.find((c) => c.id === input.clipId);
    if (!clip?.path) return { kind: "EMPTY", code: "NO_SOURCE" };
    if (!(clip.durationSeconds > 0)) return { kind: "EMPTY", code: "WINDOW_UNKNOWN" };
    const shot = film.shots.find((s) => s.id === clip.shotId);
    if (shot && shot.selectedTakeId !== clip.takeId)
      return { kind: "FAILED", code: "SOURCE_CHANGED" };
    const result = {
      kind: "READY",
      waveform: {
        schemaVersion: 1,
        sourceKey: input.expectedSourceKey,
        sourceSha256: "a".repeat(64),
        offsetSeconds: clip.offsetSeconds,
        durationSeconds: clip.durationSeconds,
        analyzedSeconds: 5,
        peaks: Array.from({ length: 256 }, (_, i) => (i % 17) / 32),
      },
    };
    if (state.startsWith("waveform"))
      return new Promise((resolve) => {
        audit.pending.push({
          input: clone(input),
          resolve: (mismatch) =>
            resolve(
              mismatch
                ? {
                    ...clone(result),
                    waveform: { ...clone(result.waveform), sourceKey: "b".repeat(64) },
                  }
                : clone(result),
            ),
        });
      });
    return result;
  };
  audit.resolveWave = (index, mismatch = false) => {
    if (!audit.pending[index]) throw Error("Missing synthetic waveform request");
    audit.pending[index].resolve(mismatch);
  };
  if (state.startsWith("history")) {
    audit.history = { list: [], capture: [], restore: [], pending: [], snapshots: [] };
    const stable = (value) =>
      Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([k, v]) => [k, stable(v)]),
            )
          : value;
    const hash = async (value) =>
      [
        ...new Uint8Array(
          await window.crypto.subtle.digest(
            "SHA-256",
            new window.TextEncoder().encode(JSON.stringify(stable(value))),
          ),
        ),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    let sequence = 0;
    const entry = (reason, film) => ({
      id: `hst_${(++sequence).toString(16).padStart(32, "0")}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 12, sequence)).toISOString(),
      reason,
      summary: {
        scenes: film.scenes.length,
        shots: film.shots.length,
        done: film.shots.filter((s) => s.takes.some((t) => t.status === "done")).length,
      },
    });
    const rawProject = (id) => {
      const raw = window.localStorage.getItem(`aivora.film.v1.${id}`);
      return raw ? JSON.parse(raw) : null;
    };
    bridge.listFilmEpisodes = async (seriesId) =>
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith("aivora.film.v1."))
        .map((k) => JSON.parse(window.localStorage.getItem(k)))
        .filter((f) => f.seriesId === seriesId)
        .map((f) => ({
          id: f.id,
          seriesId: f.seriesId,
          title: f.episodeTitle,
          no: f.episodeNo,
          shots: f.shots.length,
          done: f.shots.length,
          savedAt: f.savedAt,
        }));
    bridge.listFilmHistory = async (projectId) => {
      audit.history.list.push(projectId);
      if (!audit.history.snapshots.some((s) => s.projectId === projectId)) {
        const film = rawProject(projectId);
        for (const reason of ["manual", "before-pipeline", "before-batch-generation"])
          audit.history.snapshots.push({
            projectId,
            entry: entry(reason, film),
            project: clone(film),
          });
      }
      return {
        kind: "LIST",
        entries: audit.history.snapshots
          .filter((s) => s.projectId === projectId)
          .map((s) => clone(s.entry))
          .reverse(),
        unreadable: 1,
      };
    };
    bridge.captureFilmHistory = async (input) => {
      const film = rawProject(input.projectId),
        matched = input.expectedHash === (await hash(film));
      audit.history.capture.push({ ...clone(input), matched });
      if (!matched) return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
      const kept = entry(input.reason, film);
      audit.history.snapshots.push({
        projectId: input.projectId,
        entry: kept,
        project: clone(film),
      });
      return { kind: "CAPTURED", entry: clone(kept) };
    };
    bridge.restoreFilmHistory = async (input) => {
      const film = rawProject(input.projectId),
        matched = input.expectedHash === (await hash(film));
      audit.history.restore.push({ ...clone(input), matched });
      if (!matched) return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
      return new Promise((resolve) =>
        audit.history.pending.push({
          resolve: (kind) => {
            if (kind === "PARTIAL")
              resolve({
                kind: "PARTIAL",
                project: { ...clone(film), styleZh: "旧工程迟到的部分恢复，不应覆盖新工程。" },
                backup: entry("before-restore", film),
              });
            else resolve({ kind: "FAILED", code: "WRITE_FAILED", unchanged: true });
          },
        }),
      );
    };
    audit.resolveHistory = (index, kind = "FAILED") => {
      if (!audit.history.pending[index]) throw Error("Missing synthetic restore");
      audit.history.pending[index].resolve(kind);
    };
  }
  window.aijianGrok = {
    status: async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "合成测试账号",
      lastError: null,
    }),
    models: async () => ({ kind: "OK", models: [{ id: "grok-4.7", label: "合成文本模型" }] }),
    completeText: async (input) => {
      if (input.agent !== "art") return forbidden("non-art-text");
      audit.text.push({ agent: input.agent, film: clone(audit.saved()) });
      return {
        kind: "OK",
        text: JSON.stringify({
          prompt_block_zh: "合成建议画风：暖色胶片和柔和侧光，保留每个人物的外貌。".repeat(12),
        }),
      };
    },
    speak: async () => forbidden("voice"),
    generateVideo: async () => forbidden("video"),
    signIn: async () => forbidden("sign-in"),
  };
}

/** Called after the existing Pro project seed, before the real host is reloaded. */
export function seedFeatureProject({ state }) {
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  film.styleZh = "合成原有画风：冷色水墨与克制光线，维持原有角色特征。".repeat(12);
  film.locations = [];
  film.props = [];
  film.characters[0].portraits = [
    { view: "正面", url: film.shots[0].poster, prompt: "合成保留外貌" },
  ];
  if (state.startsWith("waveform")) {
    const shot = film.shots.find((s) => s.sceneId === film.scenes[0].id);
    film.audioClips = [
      {
        id: "feature-known-audio",
        lane: state === "waveform-known" ? "score" : "dialogue",
        shotId: state === "waveform-known" ? "" : shot.id,
        takeId: state === "waveform-known" ? "" : shot.selectedTakeId,
        label: state === "waveform-known" ? "" : "配音",
        path: "/synthetic/feature-window.wav",
        startSeconds: 0,
        offsetSeconds: 0,
        durationSeconds: 20,
        gainDb: 0,
      },
    ];
    if (state === "waveform-unknown-stale")
      film.audioClips.push({
        id: "feature-unknown-music",
        lane: "score",
        shotId: "",
        takeId: "",
        label: "",
        path: "/synthetic/unknown-music.wav",
        startSeconds: 0,
        offsetSeconds: 0,
        durationSeconds: 0,
        gainDb: -14,
      });
  }
  if (state.startsWith("history")) {
    const other = {
      ...JSON.parse(JSON.stringify(film)),
      id: "film_featureother000001",
      episodeNo: 2,
      episodeTitle: "合成第2集",
      styleZh: "另一个合成作品的画风，旧请求不可覆盖。",
    };
    window.localStorage.setItem(`aivora.film.v1.${other.id}`, JSON.stringify(other));
  }
  window.localStorage.setItem("aivora.film.active", JSON.stringify(film));
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
  window.localStorage.setItem("aivora.film.activeId", film.id);
  return { projectId: film.id, style: film.styleZh, shotId: film.audioClips[0]?.shotId };
}
