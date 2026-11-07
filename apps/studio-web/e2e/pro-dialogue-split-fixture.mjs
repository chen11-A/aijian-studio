/** Synthetic native read/backup/CAS boundary. No real snapshot, file copy or provider. */
export function seedDialogueSplitProject({ shotId }) {
  const id = window.localStorage.getItem("aivora.film.activeId"),
    film = window.__proCreationAudit.record(id),
    shot = film.shots.find((s) => s.id === shotId);
  shot.line = ("完整台词".repeat(8) + "。 ").repeat(3);
  shot.lines = [{ speaker: film.characters[0].name, text: shot.line }];
  shot.speaker = film.characters[0].name;
  shot.seconds = 15;
  shot.continuityFromShotId = "";
  delete shot.continuityFrame;
  for (const key of ["aivora.film.active", `aivora.film.v1.${id}`])
    window.localStorage.setItem(key, JSON.stringify(film));
}
export function installDialogueSplitBridge({ state, helperModuleUrl }) {
  const clone = (v) => JSON.parse(JSON.stringify(v)),
    bridge = window.aijian,
    creation = window.__proCreationAudit,
    readonly = window.__shotAudioAudit;
  const audit = {
    prepares: [],
    applies: [],
    verifies: [],
    previews: [],
    waves: [],
    writes: [],
    assemblies: [],
    forbidden: [],
    nativeWrites: 0,
    active: "",
    backups: {},
    pendingReads: [],
    request: null,
    serial: 0,
    readMode: state === "dialogue-split-foreign-conflict" ? "hold" : "ready",
    applyMode: ["dialogue-split-unknown", "dialogue-split-foreign-conflict"].includes(state)
      ? "transport"
      : "ready",
    incompleteRead: state === "dialogue-split-backup-delta-guard",
    corruptBackup: state === "dialogue-split-backup-delta-guard",
  };
  window.__dialogueSplitAudit = audit;
  const raw = (id) => creation.record(id),
    store = (record) =>
      window.localStorage.setItem(`aivora.film.v1.${record.id}`, JSON.stringify(record));
  const helpers = () => (audit.helpers ??= import(helperModuleUrl));
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_SPLIT_DISPATCH");
  };
  bridge.writeFilmProject = async (film) => {
    const record = clone(film);
    store(record);
    if (window.localStorage.getItem("aivora.film.activeId") === record.id)
      window.localStorage.setItem("aivora.film.active", JSON.stringify(record));
    audit.writes.push({ projectId: record.id, hash: await creation.hash(record) });
    readonly.writes++;
    return clone(record);
  };
  const read = bridge.readFilmProject;
  bridge.readFilmProject = async (id) => {
    const record = await read(id);
    if (
      audit.incompleteRead &&
      audit.nativeWrites &&
      record?.id === audit.request?.input.projectId
    ) {
      const broken = clone(record),
        at = broken.shots.findIndex((s) => s.splitSource);
      if (at >= 0) broken.shots.splice(at, 1);
      return broken;
    }
    return record;
  };
  const preview = bridge.getFilmAudioMixPreview;
  bridge.getFilmAudioMixPreview = async (input) => {
    const result = await preview(input);
    audit.previews.push({ projectId: input.projectId, kind: result.kind });
    return result;
  };
  bridge.readFilmAudioWaveform = async (input) => {
    audit.waves.push({ projectId: input.projectId, clipId: input.clipId });
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  };
  bridge.assembleFilm = async (seriesId, paths, musicPath, gainDb, dialogue) => {
    audit.assemblies.push({
      seriesId,
      paths: clone(paths),
      musicPath,
      gainDb,
      dialogue: clone(dialogue),
    });
    throw Error("SYNTHETIC_LOCAL_ASSEMBLY_UNAVAILABLE");
  };
  for (const name of [
    "suggestBundledFilmShotAudio",
    "applyBundledFilmShotAudio",
    "addBundledFilmAudio",
    "inspectBundledFilmAudioTarget",
    "captureFilmHistory",
    "restoreFilmHistory",
    "previewVoice",
  ])
    bridge[name] = async () => forbidden(name);
  const inputShape = (input) =>
    input &&
    Object.keys(input).sort().join() === "expectedHash,projectId,shotId,versions" &&
    typeof input.projectId === "string" &&
    /^film_[a-z0-9]{16,40}$/u.test(input.projectId) &&
    typeof input.expectedHash === "string" &&
    /^[a-f0-9]{64}$/u.test(input.expectedHash) &&
    typeof input.shotId === "string" &&
    input.shotId.length > 0 &&
    input.shotId.length <= 160 &&
    Number.isInteger(input.versions) &&
    input.versions >= 1 &&
    input.versions <= 4;
  const review = async (input) => {
    const record = raw(input.projectId);
    if (!inputShape(input)) return forbidden("prepare-shape");
    if (audit.active === input.projectId) return { kind: "FAILED", code: "BUSY", unchanged: true };
    if (
      !record ||
      record.id !== input.projectId ||
      input.expectedHash !== (await creation.hash(record))
    )
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    const { dialogueSplitContext, planDialogueSplit } = await helpers(),
      context = dialogueSplitContext(record, input.shotId, input.versions);
    if (!context) return { kind: "FAILED", code: "UNSUPPORTED_PLAN", unchanged: true };
    const plan = planDialogueSplit(context.request);
    if (plan.kind !== "READY") return { kind: "FAILED", code: "UNSUPPORTED_PLAN", unchanged: true };
    return {
      kind: "READY",
      projectId: record.id,
      shotId: input.shotId,
      projectHash: input.expectedHash,
      reviewFingerprint: await creation.hash({
        version: "native-dialogue-split-v1",
        context: context.semantic,
        plan,
      }),
      model: context.scope.model,
      plan,
      notes: [
        "确认只调整分镜结构，不生成配音、图片或视频。",
        "原镜与全部旧版本在本机历史可恢复；工程包不包含本机历史。",
        "旧音轨引用保留原绑定，全片时间未自动重排。",
        ...Array.from(
          { length: 5 },
          (_, i) =>
            `合成核对第${i + 1}项：${"这只是文字拆镜安排，需要重新检查每个新镜头的动作与声音，不代表已观看或听过。".repeat(8)}`,
        ),
      ],
    };
  };
  bridge.prepareFilmDialogueSplit = async (input) => {
    const result = await review(input);
    audit.prepares.push({ input: clone(input), kind: result.kind, code: result.code ?? null });
    if (audit.readMode === "hold" && result.kind === "READY")
      return new Promise((resolve) => {
        audit.pendingReads.push({ result: clone(result), resolve });
        audit.readAdmitted?.();
      });
    return result;
  };
  audit.releaseRead = () => {
    const p = audit.pendingReads.shift();
    if (!p) throw Error("NO_SPLIT_READ");
    audit.readMode = "ready";
    p.resolve(clone(p.result));
  };
  const commit = async (request) => {
    const record = raw(request.input.projectId);
    if ((await creation.hash(record)) !== request.input.expectedHash) {
      audit.active = "";
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    }
    const { projectDialogueSplitRecord } = await helpers(),
      ids = request.ready.plan.parts.map(() => window.crypto.randomUUID()),
      historyId = `hst_${(++audit.serial).toString(16).padStart(32, "0")}`;
    const next = projectDialogueSplitRecord(
      record,
      request.input.shotId,
      request.ready.plan,
      request.ready.reviewFingerprint,
      historyId,
      ids,
    );
    if (!next) throw Error("INVALID_SYNTHETIC_PROJECTION");
    const entry = {
      id: historyId,
      createdAt: "2026-01-01T00:00:00.000Z",
      reason: "before-dialogue-split",
      summary: {
        scenes: record.scenes.length,
        shots: record.shots.length,
        done: record.shots.filter((s) => s.takes.some((t) => t.status === "done" && t.videoPath))
          .length,
      },
    };
    const body = {
      schemaVersion: 1,
      projectId: record.id,
      seriesId: record.seriesId,
      entry,
      snapshot: clone(record),
    };
    audit.backups[historyId] = {
      ...body,
      checksum: audit.corruptBackup ? "0".repeat(64) : await creation.hash(body),
    };
    const project = { ...next, savedAt: "2026-01-02T00:00:00.000Z" };
    if ((await creation.hash(raw(record.id))) !== request.input.expectedHash) {
      delete audit.backups[historyId];
      audit.active = "";
      return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    }
    store(project);
    audit.nativeWrites++;
    audit.active = "";
    return { kind: "APPLIED", project: clone(project), backup: entry, childIds: ids };
  };
  bridge.applyFilmDialogueSplit = async (input) => {
    const shape =
      input &&
      Object.keys(input).sort().join() ===
        "expectedHash,projectId,reviewFingerprint,shotId,versions";
    const { reviewFingerprint, ...prepareInput } = input ?? {},
      ready = shape ? await review(prepareInput) : null;
    const matched = ready?.kind === "READY" && ready.reviewFingerprint === reviewFingerprint;
    audit.applies.push({ input: clone(input), matched });
    if (!matched || audit.active) return forbidden("apply-scope-or-repeat");
    const request = { input: clone(prepareInput), ready: clone(ready) };
    audit.request = request;
    audit.active = input.projectId;
    if (audit.applyMode === "transport") throw Error("SYNTHETIC_SPLIT_UNKNOWN");
    return commit(request);
  };
  audit.finish = () => {
    if (!audit.active || !audit.request) throw Error("NO_SPLIT_WRITE");
    return commit(audit.request);
  };
  bridge.verifyFilmDialogueSplitBackup = async (input) => {
    const shape =
      input &&
      Object.keys(input).sort().join() === "beforeHash,historyId,projectId" &&
      typeof input.projectId === "string" &&
      /^film_[a-z0-9]{16,40}$/u.test(input.projectId) &&
      typeof input.historyId === "string" &&
      /^hst_[a-f0-9]{32}$/u.test(input.historyId) &&
      typeof input.beforeHash === "string" &&
      /^[a-f0-9]{64}$/u.test(input.beforeHash);
    if (!shape) return forbidden("verify-shape");
    if (audit.active === input.projectId) {
      audit.verifies.push({ kind: "BUSY" });
      return { kind: "FAILED", code: "BUSY", unchanged: true };
    }
    const stored = audit.backups[input.historyId],
      { checksum, ...body } = stored ?? {};
    const matched =
      !!stored &&
      body.projectId === input.projectId &&
      body.seriesId === raw(input.projectId)?.seriesId &&
      body.entry.id === input.historyId &&
      body.entry.reason === "before-dialogue-split" &&
      checksum === (await creation.hash(body)) &&
      input.beforeHash === (await creation.hash(body.snapshot));
    audit.verifies.push({ kind: matched ? "VERIFIED" : "BACKUP_FAILED" });
    return matched
      ? { kind: "VERIFIED", ...clone(input), entry: clone(body.entry) }
      : { kind: "FAILED", code: "BACKUP_FAILED", unchanged: true };
  };
  bridge.listFilmHistory = async (projectId) => {
    const entries = [];
    let unreadable = 0;
    for (const stored of Object.values(audit.backups).filter((v) => v.projectId === projectId)) {
      const { checksum, ...body } = stored;
      if (checksum === (await creation.hash(body))) entries.push(clone(body.entry));
      else unreadable++;
    }
    return { kind: "LIST", entries, unreadable };
  };
}
