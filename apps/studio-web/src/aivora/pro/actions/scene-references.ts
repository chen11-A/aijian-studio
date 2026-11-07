import type { GenerationExecutionSession } from "./generation-execution";
import {
  ensureSceneReferences,
  locationImageCurrent,
  sceneLocation,
} from "../../film/location-reference";
import { NOTICE_TEXT } from "../../film/notices";
import type { FilmProject, FilmShot } from "../../film/project";
import { runTask } from "../../film/task-progress";
import { requestFilmStill } from "../workflow";

export type SceneReferenceHost = {
  current: () => FilmProject | null;
  valid: () => boolean;
  apply: (film: FilmProject) => void | Promise<void>;
  request?: typeof requestFilmStill;
  execution?: GenerationExecutionSession;
};

/** Persist only selected scenes; a failed reference prevents dependent media requests. */
export async function prepareShotSceneReferences(
  base: FilmProject,
  shots: readonly FilmShot[],
  host: SceneReferenceHost,
): Promise<FilmProject> {
  for (const sceneId of new Set(shots.map((shot) => shot.sceneId))) {
    const live = host.current();
    if (!host.valid() || !live || live.id !== base.id) throw new Error("WORK_STALE");
    const place = sceneLocation(live, sceneId);
    if (place && locationImageCurrent(live, place)) continue;
    await runTask(
      {
        id: `scene-reference:${sceneId}`,
        projectId: base.id,
        shotId: shots.find((shot) => shot.sceneId === sceneId)?.id,
        kind: "image",
        title: "场景参考",
      },
      async (signal) => {
        const result = await ensureSceneReferences({
          base: live,
          sceneIds: [sceneId],
          current: host.current,
          apply: host.apply,
          isCurrent: () => host.valid() && !signal.aborted,
          generate: (prompt, references) =>
            (host.request ?? requestFilmStill)(live, prompt, references),
          ...(host.execution
            ? {
                generateFor: (locationId: string, prompt: string, references: string[]) =>
                  (host.request ?? requestFilmStill)(
                    live,
                    prompt,
                    references,
                    host.execution!.image("location-reference", locationId),
                  ),
              }
            : {}),
        });
        if (result.cancelled || signal.aborted) throw new Error("WORK_STALE");
        if (result.failed) {
          const code = result.failures[0]?.code ?? "LOCATION_IMAGE_INCOMPLETE";
          throw Object.assign(
            new Error(
              NOTICE_TEXT[code as keyof typeof NOTICE_TEXT] ??
                NOTICE_TEXT.LOCATION_IMAGE_INCOMPLETE,
            ),
            { code },
          );
        }
      },
    );
  }
  const live = host.current();
  if (!host.valid() || !live || live.id !== base.id) throw new Error("WORK_STALE");
  return live;
}
