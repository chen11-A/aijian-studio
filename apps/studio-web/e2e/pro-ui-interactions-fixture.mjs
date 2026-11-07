export const READY_SHOT_MENU = ["前移", "后移", "出 4 张候选", "重新生成画面", "删除这一镜"];
/** Fixed local-only native ABI extensions; no model/media generation or CSS injection. */
export function installUiInteractionsBridge() {
  const audit = { renames: [], orphanRefusals: [], forbidden: [] };
  window.__uiInteractionsAudit = audit;
  const waveform = window.aijian.readFilmAudioWaveform;
  window.aijian.readFilmAudioWaveform = async (input) => {
    const raw = window.__proCreationAudit.record(input?.projectId),
      clips = raw?.audioClips.filter((c) => c.id === input?.clipId) ?? [];
    if (clips.length === 1 && !raw.shots.some((s) => s.id === clips[0].shotId)) {
      const c = clips[0];
      if (
        Object.keys(input).sort().join() !== "clipId,expectedSourceKey,projectId" ||
        !/^legacy-voice-[0-5]$/.test(c.id) ||
        c.path !== `/synthetic/voice-${Number(c.id.at(-1))}.wav` ||
        typeof input.expectedSourceKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.expectedSourceKey)
      ) {
        audit.forbidden.push("orphan-wave-scope");
        throw Error("FORBIDDEN_ORPHAN_ANALYSIS");
      }
      audit.orphanRefusals.push({ input: { ...input }, code: "SOURCE_CHANGED" });
      return { kind: "FAILED", code: "SOURCE_CHANGED" };
    }
    return waveform(input);
  };

  window.aijian.renameFilmSeries = async (seriesId, title) => {
    const films = Object.keys(window.localStorage)
      .filter((k) => k.startsWith("aivora.film.v1."))
      .map((k) => ({ key: k, film: JSON.parse(window.localStorage.getItem(k)) }))
      .filter((r) => r.film.seriesId === seriesId);
    if (!films.length || typeof title !== "string" || !title.trim() || title !== title.trim()) {
      audit.forbidden.push("rename-scope");
      throw Error("FORBIDDEN_UI_RENAME");
    }
    audit.renames.push({ seriesId, title });
    for (const row of films) {
      const changed = { ...row.film, title, seriesTitle: title };
      window.localStorage.setItem(row.key, JSON.stringify(changed));
    }
  };
}
export function seedUiInteractionsProject() {
  const film = JSON.parse(window.localStorage.getItem("aivora.film.active"));
  const target = film.shots[0];
  target.sound = { ...target.sound, source: "native", ambience: "", musicMood: "" };
  for (const key of ["styleNote", "blocking", "facing", "action", "performance"]) target[key] = "";
  const text = JSON.stringify(film);
  window.localStorage.setItem("aivora.film.active", text);
  window.localStorage.setItem(`aivora.film.v1.${film.id}`, text);
  return { projectId: film.id, shotIds: film.shots.map((s) => s.id), seriesId: film.seriesId };
}

/** Observe only real per-element metadata listener admissions; never changes media state. */
export function observeUiSeekMetadata(video) {
  const state = { registrations: 0 };
  const add = video.addEventListener;
  video.addEventListener = function (type, listener, options) {
    if (type === "loadedmetadata") state.registrations += 1;
    return add.call(this, type, listener, options);
  };
  window.__uiInteractionsAudit.seekMetadata = state;
  return state;
}
