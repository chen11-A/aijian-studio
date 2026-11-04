import type { FilmProject } from "../../film/project";

export type EditorPage = "script" | "cast" | "board" | "edit";
export type EditorSelection = {
  projectId: string;
  page: EditorPage;
  sceneId?: string;
  shotId?: string;
};
export type EditorContextError =
  "PROJECT_MISMATCH" | "SCENE_NOT_FOUND" | "SHOT_NOT_FOUND" | "SELECTION_MISMATCH";

/** Resolve only the actual selection. An absent selection never means the first scene. */
export function resolveEditorContext(film: FilmProject, selection: EditorSelection) {
  const error = (code: EditorContextError) => ({ ok: false as const, code });
  if (film.id !== selection.projectId) return error("PROJECT_MISMATCH");
  const shot = selection.shotId
    ? film.shots.find((item) => item.id === selection.shotId)
    : undefined;
  if (selection.shotId && !shot) return error("SHOT_NOT_FOUND");
  if (shot && selection.sceneId && shot.sceneId !== selection.sceneId)
    return error("SELECTION_MISMATCH");
  const sceneId = selection.sceneId || shot?.sceneId;
  const scene = sceneId ? film.scenes.find((item) => item.id === sceneId) : undefined;
  if (sceneId && !scene) return error("SCENE_NOT_FOUND");
  const shots = shot ? [shot] : scene ? film.shots.filter((item) => item.sceneId === scene.id) : [];
  const names = new Set(
    shots.flatMap((item) => [
      ...item.characters,
      item.speaker ?? "",
      ...(item.lines ?? []).map((line) => line.speaker),
    ]),
  );
  return {
    ok: true as const,
    context: {
      project: {
        id: film.id,
        title: film.title,
        styleZh: film.styleZh,
        aspectRatio: film.aspectRatio,
      },
      page: selection.page,
      scene: scene ? structuredClone(scene) : null,
      shot: shot ? structuredClone(shot) : null,
      shots: structuredClone(shots),
      characters: structuredClone(film.characters.filter((person) => names.has(person.name))),
      locations: structuredClone(
        film.locations.filter((location) => location.name === scene?.where),
      ),
    },
  };
}

/** Provider input is an explicit text projection, never the UI/media snapshot above. */
export function editorAgentContext(film: FilmProject, selection: EditorSelection) {
  const resolved = resolveEditorContext(film, selection);
  if (!resolved.ok) return resolved;
  const { context } = resolved;
  return {
    ok: true as const,
    context: {
      page: context.page,
      project: {
        id: context.project.id,
        title: context.project.title,
        style: context.project.styleZh,
      },
      scene: context.scene
        ? {
            id: context.scene.id,
            title: context.scene.title,
            text: context.scene.text,
            where: context.scene.where,
          }
        : null,
      selectedShotId: context.shot?.id ?? null,
      shots: context.shots.map((shot) => ({
        id: shot.id,
        sceneId: shot.sceneId,
        no: shot.no,
        size: shot.size,
        picture: shot.picture,
        action: shot.action,
        performance: shot.performance,
        characters: [...shot.characters],
        // Preserve both representations: later user edits may make the legacy scalar authoritative.
        line: shot.line,
        speaker: shot.speaker ?? "",
        lines: (shot.lines ?? []).map((line) => ({ speaker: line.speaker, text: line.text })),
      })),
      characters: context.characters.map((person) => ({
        name: person.name,
        identity: person.identity,
        gender: person.gender ?? "",
        ageBand: person.ageBand ?? "",
      })),
    },
  };
}
