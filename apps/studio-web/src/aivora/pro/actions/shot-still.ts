import { withShotCostumes } from "../../film/costume-rules";
import { withLocationLayout } from "../../film/location-reference";
import { firstFrameReferences, updateShot } from "../../film/operations";
import { keyframePrompt, type FilmProject, type FilmShot } from "../../film/project";
import { runTask } from "../../film/task-progress";
import { requestShotStill } from "../workflow";

export type ShotStillHost = {
  current: () => FilmProject | null;
  valid: () => boolean;
  apply: (film: FilmProject) => void | Promise<void>;
  request?: typeof requestShotStill;
};
function input(film: FilmProject, shot: FilmShot): string {
  return JSON.stringify([
    film.seriesId,
    film.aspectRatio,
    film.styleZh,
    shot.sceneId,
    withShotCostumes(withLocationLayout(keyframePrompt(shot, film), film, shot), film, shot),
    firstFrameReferences(film, shot),
  ]);
}

/** Reuse the real task queue and first-frame request; merge only into the still-owned shot. */
export async function generateShotStill(base: FilmProject, shot: FilmShot, host: ShotStillHost) {
  const capturedInput = input(base, shot);
  const capturedPoster = shot.poster;
  const prompt = keyframePrompt(shot, base);
  return runTask(
    {
      id: `still:${shot.id}`,
      projectId: base.id,
      shotId: shot.id,
      kind: "image",
      title: "生成画面",
    },
    async (signal) => {
      if (!host.valid() || host.current()?.id !== base.id) throw new Error("WORK_STALE");
      const made = await (host.request ?? requestShotStill)(base, shot, prompt);
      if (signal.aborted) throw new Error("TASK_TIMEOUT");
      const live = host.current();
      if (!live || live.id !== base.id || !host.valid()) throw new Error("WORK_STALE");
      const latest = live.shots.find((item) => item.id === shot.id);
      if (!latest) throw new Error("WORK_STALE");
      if (input(live, latest) !== capturedInput) {
        throw Object.assign(new Error("镜头内容已修改，旧画面没有写入。"), {
          code: "SHOT_STILL_INPUT_CHANGED",
        });
      }
      if (!made.url) throw new Error(made.reason || "STILL_FAILED");
      const selectedChanged = latest.poster !== capturedPoster;
      await host.apply(
        updateShot(live, shot.id, {
          ...(selectedChanged ? {} : { poster: made.url }),
          stills: [...latest.stills, { id: crypto.randomUUID(), prompt, url: made.url }],
        }),
      );
      return { notice: selectedChanged ? "画面已加入候选，保留了你选择的首帧。" : made.reason };
    },
  );
}
