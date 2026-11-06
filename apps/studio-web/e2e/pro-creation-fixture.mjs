/** Synthetic native archive ABI and canonical library; no ZIP, provider or real filesystem. */
export function installCreationBridge({ state }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const audit = {
    exports: [],
    imports: [],
    assemblies: [],
    forbidden: [],
    pendingExports: [],
    pendingImports: [],
  };
  window.__proCreationAudit = audit;
  const raw = (id) => {
    const text = window.localStorage.getItem(`aivora.film.v1.${id}`);
    return text ? JSON.parse(text) : null;
  };
  const all = () =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("aivora.film.v1."))
      .map((key) => JSON.parse(window.localStorage.getItem(key)));
  audit.saved = () =>
    raw(window.localStorage.getItem("aivora.film.activeId")) ||
    JSON.parse(window.localStorage.getItem("aivora.film.active") || "null");
  audit.record = (id) => clone(raw(id));
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
  audit.hash = async (value) =>
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
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_CREATION_DISPATCH");
  };
  const bridge = window.aijian;
  for (const name of [
    "prepareFilmExport",
    "publishFilmExport",
    "discardFilmExport",
    "exportFilmCut",
    "generateFilmStill",
    "generateFilmVideo",
    "createStoryFilm",
    "remakeStoryFilmCleanCopy",
    "importMusic",
    "readFilmAudioWaveform",
  ])
    bridge[name] = async () => forbidden(name);
  bridge.prepareFilmProject = async (film) => clone(film);
  bridge.readFilmProject = async (id) =>
    clone(
      raw(id) ||
        all()
          .filter((film) => film.seriesId === id)
          .sort((a, b) => a.episodeNo - b.episodeNo)[0] ||
        null,
    );
  bridge.writeFilmProject = async (film) => {
    const value = clone(film);
    window.localStorage.setItem(`aivora.film.v1.${value.id}`, JSON.stringify(value));
    // Match the existing native-ABI audit bridge: observe the actual host's saved
    // project via storage. Import completion itself never changes active selection.
    window.localStorage.setItem("aivora.film.active", JSON.stringify(value));
    window.localStorage.setItem("aivora.film.activeId", value.id);
    return clone(value);
  };
  bridge.listFilmSeries = async () => [
    ...new Map(
      all().map((film) => [
        film.seriesId,
        {
          id: film.seriesId,
          title: film.seriesTitle,
          savedAt: film.savedAt || "",
          path: "synthetic-library",
        },
      ]),
    ).values(),
  ];
  bridge.listFilmEpisodes = async (seriesId) =>
    all()
      .filter((film) => film.seriesId === seriesId)
      .map((film) => ({
        id: film.id,
        seriesId,
        title: film.episodeTitle,
        no: film.episodeNo,
        shots: film.shots.length,
        done: film.shots.length,
        savedAt: film.savedAt || "",
      }));
  bridge.assembleFilm = async (seriesId, paths, musicPath, gainDb, dialogue) => {
    audit.assemblies.push({
      projectId: audit.saved()?.id,
      seriesId,
      paths: clone(paths),
      musicPath,
      gainDb,
      dialogue: clone(dialogue),
    });
    throw Error("SYNTHETIC_LOCAL_PREVIEW_UNAVAILABLE");
  };
  bridge.exportFilmProjectArchive = async (input) => {
    const film = raw(input.projectId);
    const matched =
      Object.keys(input).sort().join() === "expectedHash,projectId" &&
      input.expectedHash === (await audit.hash(film));
    audit.exports.push({ input: clone(input), matched });
    if (!matched) return { kind: "FAILED", code: "PROJECT_CHANGED" };
    if (state === "archive-export-outcomes")
      return audit.exports.length === 1
        ? { kind: "FAILED", code: "SOURCE_MISSING" }
        : { kind: "CANCELLED" };
    return new Promise((resolve) => audit.pendingExports.push({ resolve }));
  };
  audit.resolveExport = (index) => {
    if (!audit.pendingExports[index]) throw Error("MISSING_SYNTHETIC_EXPORT");
    audit.pendingExports[index].resolve({ kind: "EXPORTED", mediaCount: 4 });
  };
  const importResult = () => {
    const film = JSON.parse(window.localStorage.getItem("pro.creation.import-source"));
    window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
    return { kind: "IMPORTED", projectId: film.id, mediaCount: 4 };
  };
  bridge.importFilmProjectArchive = async (...args) => {
    audit.imports.push({ arity: args.length });
    if (args.length) return { kind: "FAILED", code: "INVALID_INPUT" };
    if (state === "archive-import-guard")
      return new Promise((resolve) => audit.pendingImports.push({ resolve }));
    return importResult();
  };
  audit.resolveImport = (index) => {
    if (!audit.pendingImports[index]) throw Error("MISSING_SYNTHETIC_IMPORT");
    audit.pendingImports[index].resolve(importResult());
  };
  window.aijianGrok = {
    status: async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "合成测试账号",
      lastError: null,
    }),
    models: async () => ({
      kind: "OK",
      models: [
        "grok-4.7",
        "grok-imagine-video-1.5",
        "grok-imagine-video-1.5-lite",
        "grok-imagine-image-2.0",
      ].map((id) => ({ id, label: id })),
    }),
    completeText: async () => forbidden("completeText"),
    speak: async () => forbidden("speak"),
    generateVideo: async () => forbidden("generateVideo"),
    signIn: async () => forbidden("signIn"),
  };
}

/** Retains the six-shot/three-version base, changing only synthetic descriptive facts. */
export function seedCreationProject({ state }) {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  film.styleZh = "克制的水墨画风，保持人物和环境一致。";
  film.locations = [];
  film.props = [];
  film.audioClips = [];
  const person = film.characters[0];
  person.identity = "合成主角，短发，黑色外套，外貌保持一致。";
  person.portraits = [{ view: "正面", prompt: "合成参考", url: film.shots[0].poster }];
  for (const shot of film.shots)
    Object.assign(shot, {
      characters: [person.name],
      line: "",
      lines: [],
      speaker: "",
      seconds: 4,
      userFields: [],
      picture: `${person.name}站在街边的门前。`,
      action: `${person.name}抬手，然后停住。`,
      performance: "克制地抬眉。",
      directorPlan: undefined,
      actionPlan: undefined,
      performancePlan: undefined,
      reviewedVideoPrompt: undefined,
    });
  if (state === "seven-long-unknown") {
    const target = film.shots.find((shot) => shot.sceneId === film.scenes[0].id);
    film.styleZh = "合成画风：冷色水墨、柔和光线和稳定的材质。".repeat(8);
    target.characters = [];
    target.speaker = "";
    target.line = "";
    target.lines = [];
    target.picture =
      "雨水映着街灯，门边的招牌保持原样，路面纹理与明暗关系需要人工观看核对。".repeat(12);
    target.action = "雨滴沿屋檐落下，积水表面缓缓起伏。".repeat(5);
    target.performance = "";
    target.sound = {
      source: "native",
      ambience: "雨声仅是后期设想，尚未试听。",
      sfx: [],
      musicMood: "尚未选配乐",
    };
  }
  const other = {
    ...clone(film),
    id: "film_creationother0001",
    episodeNo: 2,
    episodeTitle: "合成第2集",
    styleZh: "另一集的合成画风，旧导入不能覆盖。",
  };
  const imported = {
    ...clone(film),
    id: "film_creationimport01",
    seriesId: "film_creationseries01",
    seriesTitle: "导入后的合成作品",
    title: "导入后的合成作品",
    backendProjectId: "",
    jobs: [],
    narrationVoiceId: "",
  };
  for (const shot of imported.shots)
    for (const take of shot.takes) {
      take.videoPath = `/synthetic/imported/${take.id}.mp4`;
      if (take.cleanVideoPath) take.cleanVideoPath = `/synthetic/imported/${take.id}-clean.mp4`;
    }
  for (const p of imported.characters) {
    p.voiceId = "";
    delete p.voiceCode;
    delete p.voiceDefault;
  }
  window.localStorage.setItem("pro.creation.import-source", JSON.stringify(imported));
  window.localStorage.setItem(`aivora.film.v1.${other.id}`, JSON.stringify(other));
  window.localStorage.setItem("aivora.film.active", JSON.stringify(film));
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
  window.localStorage.setItem("aivora.film.activeId", film.id);
  return {
    projectId: film.id,
    seriesId: film.seriesId,
    otherId: other.id,
    importedId: imported.id,
    shotId: film.shots.find((shot) => shot.sceneId === film.scenes[0].id).id,
  };
}
