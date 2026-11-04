import type { FilmProject } from "../../film/project";
import type { EditorSelection } from "./editor-context";

/** A delayed checkpoint owns one exact render and selection, not just a project ID. */
export function historyCheckpoint(
  film: FilmProject,
  selection: EditorSelection,
  host: {
    current: () => FilmProject | null;
    selection: () => EditorSelection;
    commit: (film: FilmProject, selection: EditorSelection) => void;
  },
) {
  const captured = structuredClone(selection);
  return () => {
    const scope = host.selection();
    if (
      host.current() !== film ||
      scope.projectId !== captured.projectId ||
      scope.page !== captured.page ||
      scope.sceneId !== captured.sceneId ||
      scope.shotId !== captured.shotId
    )
      return false;
    host.commit(film, captured);
    return true;
  };
}
