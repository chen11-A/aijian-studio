import type { FilmProject } from "../../film/project";
import type { EditorSelection } from "./editor-context";
/** Disk writes remain authorized; only the delayed UI completion belongs to this exact view/version. */
export function editorCompletionCurrent(
  applied: FilmProject,
  origin: EditorSelection,
  current: FilmProject | null,
  selection: EditorSelection,
) {
  return (
    applied === current &&
    origin.projectId === selection.projectId &&
    origin.page === selection.page &&
    origin.sceneId === selection.sceneId &&
    origin.shotId === selection.shotId
  );
}
