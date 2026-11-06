import { directorBudget } from "../director-budget";
import type { AgentRequestControl } from "../workflow";
import { NOTICE_TEXT } from "../../film/notices";
import type { FilmProject, FilmShot } from "../../film/project";
import { directorRequestInput, requestDirectorDraft, type DirectorRequestHost } from "./director";

export type DirectorRetryHost = DirectorRequestHost & {
  enrich: (
    film: FilmProject,
    sceneId: string,
    shots: FilmShot[],
    valid: () => boolean,
    control?: AgentRequestControl,
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
  const budget = directorBudget({
    current: host.current,
    control: host.control,
    progress: host.progress,
  });
  budget.progress("正在重新写这一场的镜头。");
  let draft: FilmShot[] | null = null;
  try {
    const reply = await budget.run(() =>
      requestDirectorDraft(
        input,
        {
          ...host,
          current: budget.current,
          control: budget.control,
          progress: budget.progress,
        },
        job.instruction,
      ),
    );
    if (!host.current()) return { kind: "stale" as const };
    if (!reply.shots)
      return { kind: "rejected" as const, detail: reply.detail || "导演这次没有给出能用的镜头。" };
    draft = reply.shots;
    const shots = await budget.run(() =>
      host.enrich(film, sceneId, reply.shots!, budget.current, budget.control),
    );
    if (!host.current()) return { kind: "stale" as const };
    return { kind: "ready" as const, shots, partial: false };
  } catch (error) {
    if (!host.current() || ["REQUEST_STALE", "TEXT_CANCELLED"].includes(budget.reason()))
      return { kind: "stale" as const };
    if (budget.reason() !== "TEXT_TIMEOUT") throw error;
    host.notify?.({ code: "TEXT_TIMEOUT", text: NOTICE_TEXT.TEXT_TIMEOUT });
    return draft
      ? { kind: "ready" as const, shots: draft, partial: true }
      : { kind: "rejected" as const, detail: NOTICE_TEXT.TEXT_TIMEOUT };
  } finally {
    budget.dispose();
  }
}
