import type { FilmProject, FilmShot } from "../../film/project";
import { directorRequestInput, requestDirectorDraft, type DirectorRequestHost } from "./director";

export type DirectorRetryHost = DirectorRequestHost & {
  enrich: (
    film: FilmProject,
    sceneId: string,
    shots: FilmShot[],
    valid: () => boolean,
  ) => Promise<FilmShot[]>;
};
/** Retry the saved wording, but use the same source-aware parser and enrichment as an
 * initial director request. No response writes the film without user confirmation. */
export async function retryDirectorDraft(
  film: FilmProject,
  sceneId: string,
  job: { context: string; instruction: string },
  host: DirectorRetryHost,
) {
  const scene = film.scenes.find((item) => item.id === sceneId);
  const source = scene?.text ?? "";
  const input = directorRequestInput(film, sceneId, source || film.title, source);
  // The saved request includes the original user direction and global paragraph IDs.
  if (job.context.trim()) input.context = job.context;
  if (!host.current()) return { kind: "stale" as const };
  const reply = await requestDirectorDraft(input, host, job.instruction);
  if (!host.current()) return { kind: "stale" as const };
  if (!reply.shots)
    return { kind: "rejected" as const, detail: reply.detail || "模型没有按格式返回。" };
  const shots = await host.enrich(film, sceneId, reply.shots, host.current);
  if (!host.current()) return { kind: "stale" as const };
  return { kind: "ready" as const, shots };
}
