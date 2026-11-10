import type { GenerationExecutionSession } from "./actions/generation-execution";
import { keyframePrompt } from "../film/project";
import { withIdentityLocks } from "../film/phase2";
import type { FilmProject, FilmShot } from "../film/project";
import { keyframeVariants, shotReference, updateShot } from "../film/operations";
import { runTask } from "../film/task-progress";
import { requestShotStill, stillFailureNotice } from "./workflow";

type StillHost = {
  current: () => FilmProject | null;
  valid: () => boolean;
  execution?: GenerationExecutionSession;
  apply: (film: FilmProject) => void | Promise<void>;
};

export async function makeFourStills(base: FilmProject, shot: FilmShot, host: StillHost) {
  let done = 0;
  const failures: string[] = [];
  const prompts = keyframeVariants(shot, base);
  for (const [index, prompt] of prompts.entries()) {
    if (!host.valid()) break;
    try {
      await runTask(
        {
          id: `candidate:${shot.id}:${index}`,
          projectId: base.id,
          shotId: shot.id,
          kind: "image",
          title: `候选画面 ${index + 1}/4`,
        },
        async (signal) => {
          const made = await requestShotStill(
            base,
            shot,
            withIdentityLocks(prompt, base.characters, shot.characters).prompt,
          );
          const live = host.current();
          if (signal.aborted || !host.valid() || live?.id !== base.id)
            throw new Error("WORK_STALE");
          if (!made.url) throw new Error(made.reason || "STILL_FAILED");
          const latest = live.shots.find((item) => item.id === shot.id);
          if (!latest) throw new Error("WORK_STALE");
          await host.apply(
            updateShot(live, shot.id, {
              stills: [...latest.stills, { id: crypto.randomUUID(), prompt, url: made.url }],
              poster: made.url,
            }),
          );
          done++;
        },
      );
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "STILL_FAILED");
    }
  }
  return {
    done,
    failed: failures.length,
    failures,
    cancelled: !host.valid(),
    notice: failures.length
      ? stillFailureNotice(new Error(failures[0])).text
      : "4 张候选画面已生成。点一张作为这一镜的画面。",
  };
}

/**
 * Pipeline stills still call this (`makePipelineStill`). Video generation does not:
 * a missing first frame stops at the adoption gate instead of being invented here.
 */
export async function ensureShotFrame(
  base: FilmProject,
  shot: FilmShot,
  host: StillHost,
): Promise<FilmShot> {
  if (shotReference(shot, base).still) return shot;
  return runTask(
    {
      id: `preframe:${shot.id}`,
      projectId: base.id,
      shotId: shot.id,
      kind: "image",
      title: "视频首帧",
    },
    async (signal) => {
      if (!host.execution)
        throw Object.assign(new Error("GENERATION_EXECUTION_UNAVAILABLE"), {
          code: "GENERATION_EXECUTION_UNAVAILABLE",
        });
      const made = await requestShotStill(
        base,
        shot,
        keyframePrompt(shot, base),
        host.execution.image("shot-frame", shot.id),
      );
      const live = host.current();
      if (signal.aborted || !host.valid() || live?.id !== base.id) throw new Error("WORK_STALE");
      if (!made.url)
        throw new Error(
          `镜头 ${shot.no} 首帧未完成：${stillFailureNotice(new Error(made.reason)).text}`,
        );
      const latest = live.shots.find((item) => item.id === shot.id);
      if (!latest) throw new Error("WORK_STALE");
      await host.apply(updateShot(live, shot.id, { poster: made.url }));
      return { ...latest, poster: made.url };
    },
  );
}
