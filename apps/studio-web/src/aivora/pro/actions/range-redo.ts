import type { FilmRangeGateway, FilmRangePlan } from "@aijian/contracts/film-range";
import { upgradeFilm, type FilmProject } from "../../film/project";
import { historyRecordHash, prepareHistoryInput, type HistoryHost } from "./persistent-history";
export type RangeReady = {
  project: FilmProject;
  shotId: string;
  takeId: string;
  planId: string;
  plan: FilmRangePlan;
};
/** Retain only new real versions across local edits. Source selection and all current input
 * remain the user's; a late full record can never replace another work or resurrect a shot. */
export function mergeRangeVersions(
  current: FilmProject,
  original: FilmProject,
  returned: FilmProject,
): FilmProject {
  if (current.id !== original.id || returned.id !== original.id) return current;
  return {
    ...current,
    shots: current.shots.map((shot) => {
      const before = original.shots.find((row) => row.id === shot.id);
      const incoming = returned.shots.find((row) => row.id === shot.id);
      if (!before || !incoming) return shot;
      const old = new Set(before.takes.map((take) => take.id));
      const existing = new Set(shot.takes.map((take) => take.id));
      return {
        ...shot,
        takes: [
          ...shot.takes,
          ...incoming.takes.filter((take) => !old.has(take.id) && !existing.has(take.id)),
        ],
      };
    }),
  };
}
export async function executeRangeRedo(
  ready: RangeReady,
  prompt: string,
  host: HistoryHost & {
    gateway: FilmRangeGateway;
    cancelled: () => boolean;
    accept: (film: FilmProject) => void;
  },
) {
  if (host.current() !== ready.project || host.cancelled()) return "stale" as const;
  const input = await prepareHistoryInput(ready.project, host);
  let accepted = input.film;
  const current = () => host.current() === accepted && !host.cancelled();
  const adopt = (film: FilmProject) => {
    host.accept(film);
    accepted = host.current()!;
  };
  try {
    if (!current()) return "stale" as const;
    const generated = await host.gateway.generateFilmRange({
      projectId: ready.project.id,
      planId: ready.planId,
      expectedHash: input.expectedHash,
      confirmed: true,
      prompt,
    });
    if (generated.kind !== "GENERATED") {
      if (generated.requestMayHaveRun) {
        const raw = await window.aijian!.readFilmProject!(ready.project.id);
        const retained = upgradeFilm(raw as FilmProject),
          live = host.current();
        if (retained && live?.id === ready.project.id) {
          adopt(mergeRangeVersions(live, ready.project, retained));
          await input.lease.save(accepted, () => host.current() === accepted);
        }
        return "unconfirmed" as const;
      }
      return generated.code === "BACKUP_FAILED"
        ? ("backup-failed" as const)
        : generated.code === "PROJECT_CHANGED"
          ? ("stale" as const)
          : ("not-started" as const);
    }
    const candidate = upgradeFilm(generated.project as FilmProject);
    if (!candidate || candidate.id !== ready.project.id) return "unconfirmed" as const;
    if (!current()) {
      const live = host.current();
      if (live?.id === ready.project.id) {
        adopt(mergeRangeVersions(live, ready.project, candidate));
        await input.lease.save(accepted, () => host.current() === accepted);
      }
      return "retained" as const;
    }
    adopt(candidate);
    // Candidate is retained durably by main before local assembly is requested. This
    // checkpoint also prevents the save lease from replaying the original take list.
    await input.lease.save(accepted, () => host.current() === accepted);
    const stored = await window.aijian!.readFilmProject!(ready.project.id);
    if (!current() || !stored || stored.id !== ready.project.id) return "retained" as const;
    const expectedHash = await historyRecordHash(stored);
    if (!current()) return "retained" as const;
    const result = await host.gateway.finishFilmRange({
      projectId: ready.project.id,
      planId: ready.planId,
      segmentTakeId: generated.segmentTakeId,
      expectedHash,
    });
    if (result.kind === "PARTIAL") {
      const partial = upgradeFilm(result.project as FilmProject),
        live = host.current();
      if (partial && live?.id === ready.project.id) {
        adopt(mergeRangeVersions(live, ready.project, partial));
        await input.lease.save(accepted, () => host.current() === accepted);
      }
      return "unconfirmed" as const;
    }
    if (result.kind !== "SPLICED") return "retained" as const;
    const composed = upgradeFilm(result.project as FilmProject);
    if (!composed || composed.id !== ready.project.id) return "retained" as const;
    if (!current()) {
      const live = host.current();
      if (live?.id === ready.project.id) {
        adopt(mergeRangeVersions(live, ready.project, composed));
        await input.lease.save(accepted, () => host.current() === accepted);
      }
      return "retained" as const;
    }
    adopt(composed);
    await input.lease.save(accepted, () => host.current() === accepted);
    return "applied" as const;
  } finally {
    try {
      await host.gateway.discardFilmRange(ready.project.id, ready.planId);
    } catch {
      // A consumed/expired plan needs no retry. IPC shutdown must never strand the save
      // lease or replace an already-known generation/commit result with a cleanup error.
    } finally {
      await input.release();
    }
  }
}
