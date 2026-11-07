/** Closed synthetic trial ABI. No media production, filesystem, probe or provider is performed. */
export function installActualTrialBridge({ state, mediaBytes }) {
  const bridge = window.aijian,
    creation = window.__proCreationAudit,
    clone = (value) => JSON.parse(JSON.stringify(value)),
    reviews = new Map(),
    active = new Set();
  let serial = 0;
  const audit = {
    prepares: [],
    media: [],
    records: [],
    checks: [],
    writes: [],
    captures: [],
    pending: [],
    forbidden: [],
  };
  window.__actualTrialAudit = audit;
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_ACTUAL_TRIAL_DISPATCH");
  };
  for (const name of [
    "createProject",
    "createStoryFilm",
    "generateFilmStill",
    "generateFilmVideo",
    "exportFilmCut",
    "assembleFilm",
    "previewVoice",
    "remakeStoryFilmCleanCopy",
  ])
    bridge[name] = async () => forbidden(name);
  for (const name of ["completeText", "generateVideo", "speak"])
    window.aijianGrok[name] = async () => forbidden(name);
  const stored = (value) => {
    const film = clone(value);
    window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
    if (window.localStorage.getItem("aivora.film.activeId") === film.id)
      window.localStorage.setItem("aivora.film.active", JSON.stringify(film));
    return film;
  };
  bridge.writeFilmProject = async (value) => {
    const id = value.id,
      pending = window.__assemblyAudit?.pendingWrites;
    if (pending) pending[id] = (pending[id] ?? 0) + 1;
    try {
      const film = stored(value);
      audit.writes.push({ projectId: film.id, hash: await creation.hash(film) });
      return clone(film);
    } finally {
      if (pending) pending[id]--;
    }
  };
  const raw = (id) => creation.record(id);
  const scope = async (input) => {
    const film = raw(input?.projectId),
      shots = film?.shots?.filter((shot) => shot.id === input?.shotId) ?? [],
      takes = shots.length === 1 ? shots[0].takes.filter((take) => take.id === input.takeId) : [];
    const matched =
      !!film &&
      shots.length === 1 &&
      takes.length === 1 &&
      shots[0].selectedTakeId === input.takeId &&
      takes[0].status === "done" &&
      typeof takes[0].videoPath === "string";
    return {
      film,
      shot: shots[0],
      take: takes[0],
      matched,
      cas: !!film && input.expectedHash === (await creation.hash(film)),
    };
  };
  bridge.prepareFilmRiskTrial = async (input) => {
    if (!input || Object.keys(input).sort().join() !== "expectedHash,projectId,shotId,takeId")
      return forbidden("prepare-shape");
    const target = await scope(input),
      call = { input: clone(input), matched: target.matched, cas: target.cas, reply: "PENDING" };
    audit.prepares.push(call);
    const fail = (code) => {
      call.reply = code;
      return { kind: "FAILED", code, unchanged: true };
    };
    if (active.has(input.projectId)) return fail("BUSY");
    if (!target.matched) return fail("REVIEW_STALE");
    if (!target.cas) return fail("PROJECT_CHANGED");
    const binding = {
      global: await creation.hash([target.film.id, target.film.styleZh]),
      trial: await creation.hash([
        target.take.videoPath,
        target.take.cleanVideoPath,
        target.take.index,
        target.take.prompt,
        target.take.createdAt,
      ]),
      targets: target.film.shots.map((shot) => ({ shotId: shot.id, fingerprint: "c".repeat(64) })),
    };
    const inputFingerprint = await creation.hash({
      projectId: input.projectId,
      shotId: input.shotId,
      takeId: input.takeId,
      binding,
    });
    const reviewId = `rtr_${(++serial).toString(16).padStart(32, "0")}`,
      decisionId = `rtd_${serial.toString(16).padStart(32, "0")}`;
    reviews.clear();
    reviews.set(reviewId, { input: clone(input), binding, inputFingerprint, decisionId });
    const old = [...(target.film.riskTrialDecisions ?? [])]
      .reverse()
      .find(
        (row) =>
          row.shotId === input.shotId &&
          row.takeId === input.takeId &&
          row.inputFingerprint === inputFingerprint,
      );
    const publicDecision = old
      ? Object.fromEntries(Object.entries(old).filter(([key]) => key !== "binding"))
      : null;
    call.reply = "READY";
    return {
      kind: "READY",
      projectId: input.projectId,
      projectHash: input.expectedHash,
      reviewId,
      shotId: input.shotId,
      takeId: input.takeId,
      label: `第 ${target.film.scenes.find((scene) => scene.id === target.shot.sceneId).no} 场 · 镜头 ${target.shot.no}`,
      versionLabel: `第 ${target.take.index} 版`,
      durationSeconds: 2.25,
      batchShotCount: target.film.shots.length,
      inputFingerprint,
      existingDecision: publicDecision,
      limitations: [
        "这里只绑定合成ABI所述画面素材，不证明实际文件、解码或完整观看。",
        ...Array.from(
          { length: 5 },
          (_, i) =>
            `仍需人工核对 ${i + 1}：${"人物、动作、全部对白、字幕与整片混音听感需逐项核对。".repeat(5)}`,
        ),
      ],
    };
  };
  bridge.readFilmRiskTrialMedia = async (projectId, reviewId) => {
    const review = reviews.get(reviewId);
    if (!review || review.input.projectId !== projectId) return forbidden("media-scope");
    audit.media.push({ projectId, reviewId });
    const result = () => ({ kind: "MEDIA", bytes: new Uint8Array(mediaBytes) });
    if (state === "trial-stale-source" && audit.media.length === 1)
      return new Promise((resolve) =>
        audit.pending.push({ kind: "media", released: false, resolve: () => resolve(result()) }),
      );
    return result();
  };
  bridge.recordFilmRiskTrialDecision = async (input) => {
    if (
      !input ||
      Object.keys(input).sort().join() !== "decision,expectedHash,note,projectId,reviewId" ||
      !["accepted", "needs-changes"].includes(input.decision) ||
      typeof input.note !== "string" ||
      input.note.length > 500
    )
      return forbidden("record-shape");
    const review = reviews.get(input.reviewId),
      film = raw(input.projectId);
    if (!review || review.input.projectId !== input.projectId) return forbidden("record-scope");
    const matched = input.expectedHash === (await creation.hash(film));
    audit.records.push({ input: clone(input), matched });
    if (!matched) return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
    if (active.has(input.projectId)) return forbidden("repeat-record");
    const commit = async () => {
      const current = raw(input.projectId);
      if ((await creation.hash(current)) !== input.expectedHash)
        return { kind: "FAILED", code: "PROJECT_CHANGED", unchanged: true };
      const decision = {
        schemaVersion: 1,
        id: review.decisionId,
        projectId: input.projectId,
        shotId: review.input.shotId,
        takeId: review.input.takeId,
        inputFingerprint: review.inputFingerprint,
        decision: input.decision,
        note: input.note,
        recordedAt: "2026-11-07T00:00:00.000Z",
      };
      const project = stored({
        ...current,
        savedAt: "2026-11-07T00:00:00.000Z",
        riskTrialDecisions: [
          ...(current.riskTrialDecisions ?? []),
          { ...decision, binding: review.binding },
        ],
      });
      return { kind: "RECORDED", project, decision };
    };
    if (state === "trial-unknown-global") {
      active.add(input.projectId);
      audit.pending.push({
        kind: "record",
        released: false,
        resolve: async () => {
          try {
            await commit();
          } finally {
            active.delete(input.projectId);
          }
        },
      });
      throw Error("SYNTHETIC_LOST_TRIAL_ACK");
    }
    return commit();
  };
  bridge.checkFilmRiskTrialDecision = async (input) => {
    const film = raw(input?.projectId),
      rows = film?.riskTrialDecisions?.filter((row) => row.id === input?.decisionId) ?? [];
    const matched =
      !!film && rows.length === 1 && input.expectedHash === (await creation.hash(film));
    audit.checks.push({ input: clone(input), matched });
    if (!matched) return forbidden("check-scope");
    // This profile deliberately closes the final native check; no paid work is authorized.
    return { kind: "FAILED", code: "REVIEW_STALE", unchanged: true };
  };
  bridge.captureFilmHistory = async (input) => {
    const film = raw(input?.projectId),
      matched =
        !!film &&
        input.expectedHash === (await creation.hash(film)) &&
        input.reason === "before-pipeline" &&
        state === "trial-accepted-checkpoint";
    audit.captures.push({ input: clone(input), matched });
    if (!matched) return forbidden("history-scope");
    return {
      kind: "CAPTURED",
      entry: {
        id: `hist_${"d".repeat(32)}`,
        createdAt: "2026-11-07T00:00:00Z",
        reason: "before-pipeline",
        summary: { scenes: film.scenes.length, shots: film.shots.length, done: film.shots.length },
      },
    };
  };
  for (const name of ["restoreFilmHistory", "verifyFilmDialogueSplitBackup"])
    bridge[name] = async () => forbidden(name);
  audit.release = async (index) => {
    const entry = audit.pending[index];
    if (!entry || entry.released) return forbidden("release-scope");
    entry.released = true;
    await entry.resolve();
  };
}
export async function seedActualTrialProject({ state, controllerUrl, pipelineUrl }) {
  const clone = (value) => JSON.parse(JSON.stringify(value)),
    film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  film.jobs = [];
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  delete film.productionPipeline;
  delete film.productionInputFingerprint;
  delete film.riskTrialDecisions;
  film.characters = [];
  film.locations = [];
  film.props = [];
  film.sourceText = "雨落。";
  film.unassignedBeats = [];
  film.scenes = [{ ...film.scenes[0], text: "雨落。", title: "合成雨景", tags: [] }];
  film.shots = film.shots.map((shot, index) => ({
    ...shot,
    sceneId: film.scenes[0].id,
    no: index + 1,
    picture: "雨落。",
    action: "雨落。",
    line: "",
    lines: [],
    speaker: "",
    continuityFromShotId: undefined,
    continuityFrame: undefined,
    characters: [],
    takes: shot.takes.map((take) => ({ ...take, shotId: shot.id })),
  }));
  if (state === "trial-accepted-checkpoint") {
    const { filmPipelineFingerprint, filmPipelineCheckpoint, filmPipelineTargets } = await import(
        controllerUrl
      ),
      { createProductionPipeline } = await import(pipelineUrl);
    const fingerprint = await filmPipelineFingerprint(film),
      pipeline = createProductionPipeline(film.id, fingerprint);
    for (const step of pipeline.steps) {
      if (step.id === "video") break;
      step.targets = filmPipelineTargets(film, step.id).map((id) => ({
        id,
        status: "done",
        attempt: 1,
      }));
      Object.assign(step, {
        planned: true,
        status: "done",
        done: step.targets.length,
        total: step.targets.length,
      });
    }
    pipeline.status = "checkpoint";
    pipeline.checkpoint = filmPipelineCheckpoint(film);
    film.productionPipeline = pipeline;
    film.productionInputFingerprint = fingerprint;
  }
  const other = {
    ...clone(film),
    id: "film_actualtrialother01",
    episodeNo: 2,
    episodeTitle: "合成试片第2集",
    styleZh: "当前另一作品不接收原试片回包。",
    backendProjectId: `prj_${"b".repeat(32)}`,
  };
  delete other.productionPipeline;
  delete other.productionInputFingerprint;
  for (const value of [film, other])
    window.localStorage.setItem(`aivora.film.v1.${value.id}`, JSON.stringify(value));
  window.localStorage.setItem("aivora.film.active", JSON.stringify(film));
  window.localStorage.setItem("aivora.film.activeId", film.id);
  return {
    projectId: film.id,
    otherId: other.id,
    shotId: film.shots[0].id,
    takeId: film.shots[0].selectedTakeId,
  };
}
