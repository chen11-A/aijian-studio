/** Controlled new native assembly ABI only. No path-bearing renderer request or legacy fallback. */
export function installAssemblyAuditBridge({
  mode = "refuse",
  durations = [1.2, 2.4, 0.8, 1.6, 2, 1],
  incomplete = "audio",
} = {}) {
  const clone = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value))),
    bridge = window.aijian;
  const normalize = (value) =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, v]) => [k, normalize(v)]),
          )
        : value;
  const hash = async (value) =>
    [
      ...new Uint8Array(
        await window.crypto.subtle.digest(
          "SHA-256",
          new window.TextEncoder().encode(JSON.stringify(normalize(value))),
        ),
      ),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const listeners = new Set(),
    operations = new Map();
  const audit = {
    calls: [],
    cancels: [],
    events: [],
    legacy: [],
    forbidden: [],
    mode,
    durations: [...durations],
    incomplete,
    artifacts: [],
    playRequests: [],
    pauseRequests: [],
    serial: 0,
    saveTimers: [],
    pendingWrites: Object.create(null),
    pendingNative: Object.create(null),
  };
  window.__assemblyAudit = audit;
  // Observe the real Pro autosave; never change its delay, invoke it early or flush it.
  audit.scope = () => {
    try {
      const root = window.document.querySelector(".pro-root"),
        button = window.document.querySelector(".topbar .proj"),
        episode = button
          ?.querySelector(".ep")
          ?.textContent.replace(/^\s*\/\s*/, "")
          .trim(),
        title = [...(button?.childNodes ?? [])]
          .filter((n) => n.nodeType === 3)
          .map((n) => n.textContent)
          .join("")
          .trim();
      const matches = [
        ...new Set(
          Object.keys(window.localStorage)
            .filter((k) => k.startsWith("aivora.film.v1."))
            .flatMap((k) => {
              const raw = JSON.parse(window.localStorage.getItem(k));
              return raw &&
                (raw.seriesTitle || raw.title) === title &&
                (raw.episodeTitle || `第 ${raw.episodeNo || 1} 集`) === episode
                ? [raw.id]
                : [];
            }),
        ),
      ];
      return {
        projectId: matches.length === 1 ? matches[0] : null,
        stage: root?.getAttribute("data-stage") ?? null,
      };
    } catch {
      return { projectId: null, stage: null };
    }
  };
  if (typeof window.setTimeout === "function" && typeof window.clearTimeout === "function") {
    const timer = window.setTimeout,
      clear = window.clearTimeout,
      active = new Map();
    window.setTimeout = function (handler, delay, ...args) {
      const stack = delay === 400 && typeof handler === "function" ? new window.Error().stack : "";
      const autosave =
        typeof stack === "string" &&
        /[\\/]src[\\/]aivora[\\/]pro[\\/]ProWorkspace\.tsx(?::|\?)/u.test(stack);
      if (!autosave) return timer.call(window, handler, delay, ...args);
      const entry = {
        ...audit.scope(),
        generation: audit.saveTimers.length + 1,
        status: "scheduled",
      };
      audit.saveTimers.push(entry);
      let id;
      id = timer.call(
        window,
        (...values) => {
          active.delete(id);
          entry.status = "fired";
          return handler.apply(window, values);
        },
        delay,
        ...args,
      );
      active.set(id, entry);
      return id;
    };
    window.clearTimeout = function (id) {
      const entry = active.get(id);
      if (entry) {
        entry.status = "cancelled";
        active.delete(id);
      }
      return clear.call(window, id);
    };
  }
  if (typeof bridge.writeFilmProject === "function") {
    const write = bridge.writeFilmProject;
    bridge.writeFilmProject = async (...args) => {
      const id = args[0]?.id ?? "unknown";
      audit.pendingWrites[id] = (audit.pendingWrites[id] ?? 0) + 1;
      try {
        return await write.apply(bridge, args);
      } finally {
        audit.pendingWrites[id]--;
      }
    };
  }
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_ASSEMBLY_DISPATCH");
  };
  // Assembly's existing persistence preflight checks these desktop capabilities, but
  // does not capture or restore history. Preserve real modeled history where present.
  for (const name of [
    "listFilmHistory",
    "captureFilmHistory",
    "restoreFilmHistory",
    "verifyFilmDialogueSplitBackup",
  ])
    if (typeof bridge[name] !== "function") bridge[name] = async () => forbidden(name);
  bridge.assembleFilm = async () => {
    audit.legacy.push("assembleFilm");
    return forbidden("legacy-assemble");
  };
  const selected = (record) =>
    record.shots.flatMap((shot) => {
      const take = shot.selectedTakeId
        ? shot.takes.find((t) => t.id === shot.selectedTakeId && t.status === "done" && t.videoPath)
        : shot.takes.find((t) => t.status === "done" && t.videoPath);
      return take ? [{ shotId: shot.id, takeId: take.id }] : [];
    });
  const emit = (operation, phase, cancelState = "available", progress) => {
    const event = {
      operationId: operation.id,
      projectId: operation.input.projectId,
      seq: ++operation.seq,
      phase,
      cancelState,
      published: [],
      ...(progress ? { progress } : {}),
    };
    operation.snapshot = event;
    audit.events.push(clone(event));
    for (const listener of listeners) listener(clone(event));
    return event;
  };
  const resultFor = (operation) => {
    const input = operation.input;
    let at = 0;
    const shots = input.expectedSelection.map((selection, index) => {
      const durationSeconds = audit.durations[index % audit.durations.length];
      const row = { ...selection, startSeconds: at, durationSeconds };
      at += durationSeconds;
      return row;
    });
    if (!shots.every((s) => Number.isFinite(s.durationSeconds) && s.durationSeconds > 0))
      throw Error("INVALID_SYNTHETIC_CLOCK");
    const path = `/synthetic/assembly/artifact-${++audit.serial}.mp4`,
      partial = operation.mode === "partial";
    const artifact = {
      kind: partial ? "PARTIAL" : "ASSEMBLED",
      projectId: input.projectId,
      projectHash: input.expectedHash,
      path,
      durationSeconds: at,
      shots,
      limitations: ["合成ABI核验：不是实际FFmpeg成片、播放或听感证明。"],
      ...(partial ? { incomplete: audit.incomplete } : {}),
    };
    audit.artifacts.push(clone(artifact));
    return artifact;
  };
  bridge.assembleFilmProject = async (input, operationId) => {
    const requestProject = typeof input?.projectId === "string" ? input.projectId : "unknown";
    audit.pendingNative[requestProject] = (audit.pendingNative[requestProject] ?? 0) + 1;
    try {
      const shape =
        input &&
        Object.keys(input).sort().join() === "expectedHash,expectedSelection,projectId" &&
        typeof input.projectId === "string" &&
        /^film_[a-z0-9]{16,40}$/u.test(input.projectId) &&
        typeof input.expectedHash === "string" &&
        /^[a-f0-9]{64}$/u.test(input.expectedHash) &&
        Array.isArray(input.expectedSelection) &&
        input.expectedSelection.length > 0 &&
        input.expectedSelection.length <= 128 &&
        input.expectedSelection.every(
          (row) =>
            row &&
            Object.keys(row).sort().join() === "shotId,takeId" &&
            [row.shotId, row.takeId].every(
              (id) =>
                typeof id === "string" && id.length > 0 && id.length <= 160 && !id.includes("\0"),
            ),
        ) &&
        new Set(input.expectedSelection.map((s) => s.shotId)).size ===
          input.expectedSelection.length;
      const raw = shape ? await bridge.readFilmProject(input.projectId) : null,
        canonicalHash = raw ? await hash(raw) : null,
        expected = raw ? selected(raw) : [];
      const matched =
        !!shape &&
        raw?.id === input.projectId &&
        input.expectedHash === canonicalHash &&
        JSON.stringify(input.expectedSelection) === JSON.stringify(expected);
      const id = operationId ?? `qa-internal-${audit.calls.length + 1}`;
      audit.calls.push({
        input: clone(input),
        operationId: operationId ?? null,
        canonicalHash,
        audioMix: clone(raw?.audioMix ?? null),
        subtitleStyle: raw?.subtitleStyle ?? "white",
        expectedSelection: expected,
        matched,
      });
      if (!shape) return { kind: "FAILED", code: "INVALID_INPUT" };
      if (!matched) return { kind: "FAILED", code: "PROJECT_CHANGED" };
      if (operations.has(id)) return { kind: "FAILED", code: "BUSY" };
      const operation = {
        id,
        input: clone(input),
        seq: 0,
        mode: audit.mode,
        settled: false,
        cancelRequested: false,
      };
      operations.set(id, operation);
      emit(operation, "preparing", "available", {
        kind: "units",
        completed: 0,
        total: input.expectedSelection.length,
        unit: "镜头",
      });
      if (operation.mode === "refuse") {
        operation.settled = true;
        emit(operation, "failed", "unavailable");
        return { kind: "FAILED", code: "SOURCE_UNVERIFIED" };
      }
      emit(operation, "joining", "available");
      if (operation.mode === "hold")
        return await new Promise((resolve) => {
          operation.resolve = resolve;
          audit.admitted?.(id);
        });
      const artifact = resultFor(operation);
      operation.settled = true;
      emit(operation, artifact.kind === "PARTIAL" ? "partial" : "completed", "unavailable");
      return artifact;
    } finally {
      audit.pendingNative[requestProject]--;
    }
  };
  bridge.cancelFilmAssemblyOperation = async (operationId) => {
    const operation = operations.get(operationId);
    let result;
    if (!operation) result = { kind: "NOT_FOUND" };
    else if (operation.stopped) result = { kind: "STOPPED", snapshot: clone(operation.snapshot) };
    else if (operation.settled)
      result = { kind: "UNAVAILABLE", snapshot: clone(operation.snapshot) };
    else {
      operation.cancelRequested = true;
      result = {
        kind: "REQUESTED",
        snapshot: clone(emit(operation, operation.snapshot.phase, "requested")),
      };
    }
    audit.cancels.push({ operationId, kind: result.kind });
    return result;
  };
  bridge.onFilmAssemblyProgress = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  audit.finish = (id, { stopped = false, partial = false } = {}) => {
    const operation = operations.get(id);
    if (!operation?.resolve || operation.settled) throw Error("NO_ASSEMBLY_ADMISSION");
    operation.settled = true;
    if (stopped) {
      operation.stopped = true;
      emit(operation, "failed", "stopped");
      operation.resolve({ kind: "FAILED", code: "OPERATION_STOPPED" });
      return;
    }
    if (partial) operation.mode = "partial";
    const artifact = resultFor(operation);
    emit(operation, artifact.kind === "PARTIAL" ? "partial" : "completed", "unavailable");
    operation.resolve(artifact);
  };
  audit.hash = hash;
}

/** Narrow synthetic media lifecycle: records requests; never claims protocol/codec playback. */
export function installAssemblyMediaRequests() {
  const audit = window.__assemblyAudit,
    prototype = window.HTMLMediaElement?.prototype;
  if (!prototype || !audit) return;
  const isArtifact = (element) => {
    try {
      const url = new window.URL(element.currentSrc || element.src);
      return (
        url.protocol === "aivora-media:" &&
        ["/synthetic/assembly/restarted.mp4", ...audit.artifacts.map((a) => a.path)].includes(
          url.searchParams.get("path"),
        )
      );
    } catch {
      return false;
    }
  };
  const play = prototype.play,
    pause = prototype.pause;
  prototype.play = function () {
    if (isArtifact(this)) {
      audit.playRequests.push("synthetic-assembly");
      return Promise.resolve();
    }
    return play.call(this);
  };
  prototype.pause = function () {
    if (isArtifact(this)) {
      audit.pauseRequests.push("synthetic-assembly");
      return;
    }
    return pause.call(this);
  };
}

/** Initial synthetic project facts, never a live React/state mutation. */
export function seedAssemblyProject({ restarted = false } = {}) {
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  film.shots.forEach((shot, index) => {
    shot.picture = `第${index + 1}个合成镜头的画面`;
  });
  if (restarted) {
    film.assemblyPath = "/synthetic/assembly/restarted.mp4";
    delete film.assemblyUrl;
  }
  window.localStorage.setItem("aivora.film.active", JSON.stringify(film));
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
}

/** Closed readiness metadata only; no raw DOM, record, path, callback or stack. */
export function readAssemblyReadiness() {
  const audit = window.__assemblyAudit,
    marker = audit?.lastReadiness;
  if (!marker) return null;
  const scope = audit.scope(),
    own = audit.saveTimers.filter(
      (t) => t.projectId === marker.projectId && t.stage === marker.stage,
    );
  return {
    phase:
      scope.projectId === marker.projectId && scope.stage === marker.stage
        ? "scoped"
        : "scope-changed",
    generation: own.at(-1)?.generation ?? 0,
    pendingTimers: own.filter((t) => t.status === "scheduled").length,
    unboundTimers: audit.saveTimers.filter((t) => !t.projectId && t.status === "scheduled").length,
    pendingWrites: audit.pendingWrites[marker.projectId] ?? 0,
    pendingNative: audit.pendingNative[marker.projectId] ?? 0,
    saving: !!window.document.querySelector(".statusbar .where")?.textContent.includes("正在保存"),
  };
}
