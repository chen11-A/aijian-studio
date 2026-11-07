/** Synthetic three-method native recovery ABI; no provider GET, download, chooser or filesystem. */
export function installVideoRecoveryBridge({ state }) {
  const clone = (value) => JSON.parse(JSON.stringify(value)),
    bridge = window.aijian;
  const audit = { lists: [], recovers: [], saves: [], pending: [], writes: [], forbidden: [] };
  window.__proVideoRecoveryAudit = audit;
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw new Error("FORBIDDEN_VIDEO_RECOVERY_DISPATCH");
  };
  for (const name of [
    "createProject",
    "createStoryFilm",
    "generateFilmStill",
    "generateFilmVideo",
    "exportFilmCut",
    "assembleFilm",
  ])
    bridge[name] = async () => forbidden(name);
  for (const name of ["completeText", "generateVideo", "speak"])
    window.aijianGrok[name] = async () => forbidden(name);
  const write = bridge.writeFilmProject;
  bridge.writeFilmProject = async (...args) => {
    const result = await write(...args);
    audit.writes.push({ projectId: args[0].id, stored: clone(result) });
    return result;
  };
  const attemptId = "a".repeat(32),
    file = { fileName: `recovered-${attemptId}.mp4`, sha256: "c".repeat(64), bytes: 2048 };
  const records = () =>
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith("aivora.film.v1."))
      .map((key) => JSON.parse(window.localStorage.getItem(key)));
  const project = (id) => {
    if (
      typeof id !== "string" ||
      !/^prj_[a-f0-9]{32}$/.test(id) ||
      records().filter((r) => r.backendProjectId === id).length !== 1
    )
      return forbidden("invalid-project");
    return records().find((r) => r.backendProjectId === id);
  };
  const check = (id, key) => {
    project(id);
    if (key !== attemptId) return forbidden("invalid-attempt");
  };
  const list = async (id) => {
    const record = project(id);
    audit.lists.push({ projectId: id });
    const recovered = state === "recovery-unknown" && audit.lists.length > 1;
    return {
      kind: "ATTEMPTS",
      items:
        record.episodeNo === 2
          ? []
          : [
              {
                attemptId,
                state: recovered ? "RECOVERED" : "UNKNOWN",
                ...(recovered ? { file: clone(file) } : {}),
              },
            ],
      hasMore: false,
    };
  };
  const recover = async (id, key) => {
    check(id, key);
    audit.recovers.push({ projectId: id, attemptId: key });
    if (state === "recovery-late")
      return await new Promise((resolve) => {
        audit.pending.push({
          released: false,
          resolve: () => resolve({ kind: "RECOVERED", attemptId, file: clone(file) }),
        });
      });
    if (state === "recovery-unknown") {
      if (audit.recovers.length === 1) return { kind: "UNKNOWN", attemptId, reason: "WAITING" };
      if (audit.recovers.length === 2) return { kind: "FAILED", code: "WRITE_UNCONFIRMED" };
      return forbidden("recovery-repeat");
    }
    return { kind: "RECOVERED", attemptId, file: clone(file) };
  };
  const save = async (id, key) => {
    check(id, key);
    audit.saves.push({ projectId: id, attemptId: key });
    if (state === "recovery-unknown")
      return audit.saves.length === 1
        ? { kind: "FAILED", code: "WRITE_UNCONFIRMED" }
        : forbidden("save-repeat");
    if (state === "recovery-success" && audit.saves.length === 1) return { kind: "CANCELLED" };
    return { kind: "SAVED", file: clone(file) };
  };
  audit.exposeNative = () => {
    bridge.listGenerationVideoRecoveries = list;
    bridge.recoverGenerationVideo = recover;
    bridge.saveRecoveredGenerationVideo = save;
  };
  audit.release = (index) => {
    const pending = audit.pending[index];
    if (!pending || pending.released) throw new Error("INVALID_RECOVERY_RELEASE");
    pending.released = true;
    pending.resolve();
  };
  if (state === "recovery-unavailable") {
    delete bridge.listGenerationVideoRecoveries;
    delete bridge.recoverGenerationVideo;
    delete bridge.saveRecoveredGenerationVideo;
  } else audit.exposeNative();
}
export function seedVideoRecoveryProject({ state }) {
  const clone = (value) => JSON.parse(JSON.stringify(value)),
    film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  film.jobs = [];
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  const other = {
    ...clone(film),
    id: "film_recoveryother0001",
    episodeNo: 2,
    episodeTitle: "合成找回第2集",
    styleZh: "另一集当前稿不接收原视频回包。",
    backendProjectId: state === "recovery-unavailable" ? "" : `prj_${"b".repeat(32)}`,
  };
  window.localStorage.setItem(`aivora.film.v1.${other.id}`, JSON.stringify(other));
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
  window.localStorage.setItem("aivora.film.active", JSON.stringify(film));
  window.localStorage.setItem("aivora.film.activeId", film.id);
  return {
    projectId: film.id,
    backendProjectId: film.backendProjectId,
    otherId: other.id,
    otherBackendProjectId: other.backendProjectId,
  };
}
