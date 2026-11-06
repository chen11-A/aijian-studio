/** Synthetic native metadata only; no providers, files or sound-quality assertions. */
export function seedAudioMixProject() {
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  const shot = film.shots.find((s) => s.sceneId === film.scenes[0].id);
  film.audioClips = ["dialogue", "ambience", "sfx", "score"].map((lane, i) => ({
    id: `mix-${lane}`,
    lane,
    label: `合成${lane}片段`,
    shotId: lane === "score" ? "" : shot.id,
    takeId: lane === "score" ? "" : shot.selectedTakeId,
    path: `/synthetic/mix-${lane}.wav`,
    startSeconds: 0,
    durationSeconds: 2,
    offsetSeconds: 0,
    gainDb: -6 - i,
  }));
  const dialogue = film.audioClips[0];
  film.audioClips.push(
    {
      ...dialogue,
      id: "mix-old-voice",
      label: "保留的第3版配音",
      takeId: shot.takes[2].id,
      path: "/synthetic/old-voice.wav",
    },
    {
      ...dialogue,
      id: "mix-disabled-voice",
      label: "停用的配音",
      enabled: false,
      path: "/synthetic/disabled-voice.wav",
    },
    {
      ...dialogue,
      id: "mix-pending-voice",
      label: "尚未绑定的配音",
      takeId: "",
      path: "/synthetic/pending-voice.wav",
    },
  );
  delete film.audioMix;
  window.localStorage.setItem("aivora.film.active", JSON.stringify(film));
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, JSON.stringify(film));
  return { projectId: film.id, shotId: shot.id };
}
export function installAudioMixBridge({ state, planUrl, wavBase64, wavSha256 }) {
  const native = window.aijian,
    creation = window.__proCreationAudit;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const audit = {
    requests: [],
    pending: [],
    reads: [],
    waves: [],
    prepare: [],
    forbidden: [],
    mode:
      state === "mix-preview-retry" ? "hold-busy" : state === "mix-stale-reply" ? "hold" : "ready",
  };
  window.__proAudioMixAudit = audit;
  const forbidden = (name) => {
    audit.forbidden.push(name);
    throw Error("FORBIDDEN_AUDIO_MIX_DISPATCH");
  };
  for (const name of [
    "exportFilmProjectArchive",
    "importFilmProjectArchive",
    "publishFilmExport",
    "discardFilmExport",
  ])
    native[name] = async () => forbidden(name);
  const bytes = Uint8Array.from(window.atob(wavBase64), (c) => c.charCodeAt(0));
  native.readFilmMedia = async (path, options) => {
    const matched =
      creation.saved().audioClips.some((c) => c.path === path) &&
      options.expectedSha256 === wavSha256 &&
      options.maxBytes >= bytes.length;
    audit.reads.push({ matched });
    if (!matched) return forbidden("unverified-media-read");
    return [...bytes];
  };
  native.readFilmAudioWaveform = async (input) => {
    const matched =
      creation.saved().audioClips.some((clip) => clip.id === input.clipId) &&
      input.projectId === creation.saved().id;
    audit.waves.push({ matched });
    if (!matched) return forbidden("unverified-waveform-read");
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  };
  native.getFilmAudioMixPreview = async (input) => {
    const film = clone(creation.saved());
    const matched =
      Object.keys(input).sort().join() === "expectedHash,projectId" &&
      input.projectId === film.id &&
      input.expectedHash === (await creation.hash(film));
    const index = audit.requests.length;
    audit.requests.push({
      matched,
      selected: film.shots.map((s) => [s.id, s.selectedTakeId]),
      input: clone(input),
    });
    if (!matched) return forbidden("unverified-preview-hash");
    if (audit.mode === "hold-busy")
      return new Promise((resolve) => {
        audit.pending.push({ index, resolve: () => resolve({ kind: "FAILED", code: "BUSY" }) });
        audit.pendingChanged?.();
      });
    if (audit.mode === "busy") return { kind: "FAILED", code: "BUSY" };
    if (audit.mode === "failed") return { kind: "FAILED", code: "SOURCE_UNVERIFIED" };
    const { buildAudioMixPlan, audioMixSettings } = await import(planUrl);
    let cursor = 0;
    const sources = {},
      sourcePaths = {},
      sourceSha256 = {};
    const shots = film.shots.map((s) => {
      const nativeSourceKey = `native:${s.id}:${s.selectedTakeId}`;
      sources[nativeSourceKey] = {
        durationSeconds: s.seconds,
        hasAudio: false,
        channels: 1,
        byteLength: bytes.length,
      };
      const row = {
        shotId: s.id,
        takeId: s.selectedTakeId,
        startSeconds: cursor,
        durationSeconds: s.seconds,
        nativeSourceKey,
        hasDialogue: false,
      };
      cursor += s.seconds;
      return row;
    });
    const clips = film.audioClips.map((c) => {
      const sourceKey = `source:${c.id}`;
      sources[sourceKey] = {
        durationSeconds: 2,
        hasAudio: true,
        channels: 1,
        byteLength: bytes.length,
      };
      sourcePaths[sourceKey] = c.path;
      sourceSha256[sourceKey] = wavSha256;
      return { ...c, sourceKey };
    });
    const result = {
      kind: "READY",
      plan: buildAudioMixPlan({
        projectId: film.id,
        durationSeconds: cursor,
        shots,
        clips,
        sources,
        controls: { lanes: audioMixSettings(film.audioMix).lanes },
      }),
      sourcePaths,
      sourceSha256,
      sourceInfo: sources,
      fingerprint: input.expectedHash,
    };
    audit.requests[index].trackLanes = result.plan.tracks.map((t) => t.lane);
    audit.requests[index].trackKeys = result.plan.tracks.map((t) => t.key);
    if (audit.mode === "hold")
      return new Promise((resolve) => {
        audit.pending.push({
          index,
          resolve: (failed = false) =>
            resolve(failed ? { kind: "FAILED", code: "SOURCE_UNVERIFIED" } : clone(result)),
        });
        audit.pendingChanged?.();
      });
    return clone(result);
  };
  audit.resolve = (index, failed = false) => {
    if (!audit.pending[index]) throw Error("MISSING_AUDIO_MIX_PENDING");
    audit.pending[index].resolve(failed);
  };
  native.prepareFilmExport = async (input) => {
    const film = creation.saved();
    const expected = film.shots.map((s) => ({ shotId: s.id, takeId: s.selectedTakeId }));
    const matched =
      input.projectId === film.id &&
      JSON.stringify(input.expectedSelection) === JSON.stringify(expected);
    audit.prepare.push({ input: clone(input), matched, audioMix: clone(film.audioMix ?? null) });
    if (!matched) return forbidden("unverified-qc-selection");
    // Legitimate local QC preparation is refused without creating any output/receipt.
    return { kind: "FAILED", code: "TOOLS_UNAVAILABLE" };
  };
}
