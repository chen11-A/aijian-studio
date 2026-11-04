import { listFilms, readSaved, removeFilm } from "../film/library";
import { interruptStaleWork, type FilmProject } from "../film/project";

export async function deleteCurrentFilm(
  base: FilmProject,
  series: boolean,
  host: {
    valid: () => boolean;
    apply: (film: FilmProject | null) => void;
    close: () => void;
    notice: (message: string) => void;
  },
) {
  try {
    await removeFilm(series ? base.seriesId : base.id);
    if (!host.valid()) return;
    const rows = series ? [] : await listFilms();
    if (!host.valid()) return;
    const saved = rows[0] ? await readSaved(rows[0].id) : null;
    if (!host.valid()) return;
    host.close();
    host.notice(series ? "已删除这部作品。" : "已删除这一集。");
    host.apply(saved ? interruptStaleWork(saved).film : null);
  } catch {
    if (host.valid()) host.notice("删除没有完成，请重试。");
  }
}
