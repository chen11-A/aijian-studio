import type { FilmProjectArchiveExport } from "@aijian/contracts/film-project-archive";
import { upgradeFilm, type FilmProject } from "../../film/project";
import { historyRecordHash } from "./persistent-history";
import type { FilmSaveLease } from "../film-persistence";
/** Hold the normal save lease so delayed automatic saves cannot change the export baseline. */
export async function exportProjectArchive(
  base: FilmProject,
  host: {
    current: () => FilmProject | null;
    apply: (film: FilmProject) => void;
    acquire: (id: string) => Promise<FilmSaveLease>;
  },
): Promise<FilmProjectArchiveExport> {
  const bridge = window.aijian;
  if (!bridge?.exportFilmProjectArchive || !bridge.readFilmProject)
    return { kind: "FAILED", code: "RUNTIME_UNAVAILABLE" };
  let accepted = base;
  const current = () => host.current() === accepted;
  const lease = await host.acquire(base.id);
  try {
    if (!current()) return { kind: "FAILED", code: "PROJECT_CHANGED" };
    await lease.save(accepted, current);
    const raw = await bridge.readFilmProject(base.id);
    if (!current() || !raw || raw.id !== base.id)
      return { kind: "FAILED", code: "PROJECT_CHANGED" };
    const canonical = upgradeFilm(raw as Partial<FilmProject>);
    if (!canonical) return { kind: "FAILED", code: "PROJECT_CHANGED" };
    host.apply(canonical);
    accepted = host.current()!;
    await lease.save(accepted, current);
    const stored = await bridge.readFilmProject(base.id);
    if (!current() || !stored || stored.id !== base.id)
      return { kind: "FAILED", code: "PROJECT_CHANGED" };
    const expectedHash = await historyRecordHash(stored);
    if (!current()) return { kind: "FAILED", code: "PROJECT_CHANGED" };
    return await bridge.exportFilmProjectArchive({ projectId: base.id, expectedHash });
  } finally {
    await lease.release();
  }
}
