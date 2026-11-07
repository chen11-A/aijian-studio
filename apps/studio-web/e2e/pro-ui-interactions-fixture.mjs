/** Fixed local-only native ABI extensions; no model/media generation or CSS injection. */
export function installUiInteractionsBridge() {
  const audit = { renames: [], forbidden: [] };
  window.__uiInteractionsAudit = audit;
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
