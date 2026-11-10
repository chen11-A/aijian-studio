import type { FilmProject, FilmShot } from "../film/project";
import { confirmShotFixedInput, importShotFixedInput } from "./actions/fixed-input-actions";

/** Explicit user choice for a manual still. The button does not send a path or metadata. */
export function FixedInputImportButton({
  film,
  shot,
  offerId,
  liveFilm,
  onFilm,
  onNotice,
}: {
  film: FilmProject;
  shot: FilmShot;
  offerId?: string;
  liveFilm: () => FilmProject | null;
  onFilm: (film: FilmProject) => void;
  onNotice: (text: string) => void;
}) {
  return (
    <>
      <button
        className="btn"
        type="button"
        onClick={() =>
          void importShotFixedInput(film, shot, { current: liveFilm, apply: onFilm, onNotice })
        }
      >
        导入为固定输入
      </button>
      {offerId ? (
        <button
          className="btn"
          type="button"
          onClick={() => void confirmShotFixedInput(film.id, offerId, onNotice)}
        >
          确认这张手工画面为固定输入
        </button>
      ) : null}
    </>
  );
}
