import { spokenLine } from "../../film/operations";
import type { FilmProject, FilmShot, FilmTake } from "../../film/project";
import { exportMedia } from "./generation-run";

/** 4B-B12: what happened to one shot when its copy without subtitles was made again. */
export type CleanCopyOutcome = {
  shotId: string;
  shot: string;
  status: "done" | "failed" | "missing";
  reason?: string;
};

type Host = { current: () => FilmProject | null; apply: (next: FilmProject) => void };

/** The take an export uses for this shot, the same choice as chosenExport makes. */
function chosenTake(shot: FilmShot): FilmTake | undefined {
  return shot.selectedTakeId
    ? shot.takes.find(
        (take) => take.id === shot.selectedTakeId && take.status === "done" && take.videoPath,
      )
    : shot.takes.find((take) => take.status === "done" && take.videoPath);
}

/**
 * Shots whose chosen take still has its subtitle in the picture: made before 4B-B09, or whose
 * copy without subtitles failed. Without a line nothing was burned in, so nothing is needed.
 */
export function shotsNeedingCleanCopy(film: FilmProject): string[] {
  return film.shots.flatMap((shot) => {
    const take = chosenTake(shot);
    return take && !take.cleanVideoPath?.trim() && spokenLine(shot) ? [shot.id] : [];
  });
}

function withResult(
  film: FilmProject,
  shotId: string,
  takeId: string,
  videoPath: string,
  patch: (take: FilmTake) => FilmTake,
): FilmProject {
  return {
    ...film,
    shots: film.shots.map((shot) =>
      shot.id !== shotId
        ? shot
        : {
            ...shot,
            // A take replaced or regenerated meanwhile is left alone.
            takes: shot.takes.map((take) =>
              take.id === takeId && take.videoPath === videoPath ? patch(take) : take,
            ),
          },
    ),
  };
}

/**
 * 4B-B12: make the copy without burned subtitles again for these shots (all that need one when
 * `shotIds` is null), one at a time, from each film's saved assembly. No video is generated and
 * nothing is charged. Each result is written into the latest film as it arrives, so other edits
 * made meanwhile are kept.
 */
export async function remakeCleanCopies(
  base: FilmProject,
  shotIds: readonly string[] | null,
  projectId: string,
  host: Host,
): Promise<{ outcomes: CleanCopyOutcome[]; notice: string }> {
  const bridge = window.aijian;
  const wanted = new Set(shotIds ?? shotsNeedingCleanCopy(base));
  const outcomes: CleanCopyOutcome[] = [];
  for (const shot of base.shots) {
    if (!wanted.has(shot.id)) continue;
    const take = chosenTake(shot);
    const label = `镜头 ${shot.no}`;
    if (!take || take.cleanVideoPath?.trim()) continue;
    if (!bridge?.remakeStoryFilmCleanCopy) {
      outcomes.push({ shotId: shot.id, shot: label, status: "failed", reason: "需要桌面版" });
      continue;
    }
    let data: Record<string, unknown>;
    try {
      data = (await bridge.remakeStoryFilmCleanCopy(projectId, take.videoPath)).data;
    } catch (error) {
      const text = error instanceof Error && error.message ? error.message : "没有连上本机服务";
      outcomes.push({ shotId: shot.id, shot: label, status: "failed", reason: text.slice(0, 200) });
      continue;
    }
    const latest = host.current();
    if (!latest || latest.id !== base.id) break;
    const media = exportMedia(data);
    if (data.status === "SUCCEEDED" && media.cleanVideoPath) {
      host.apply(
        withResult(latest, shot.id, take.id, take.videoPath, (item) => {
          const next: FilmTake = { ...item, cleanVideoPath: media.cleanVideoPath };
          if (media.subtitleCues) next.subtitleCues = media.subtitleCues;
          delete next.cleanCopyReason;
          return next;
        }),
      );
      outcomes.push({ shotId: shot.id, shot: label, status: "done" });
    } else if (data.status === "NOT_FOUND") {
      outcomes.push({ shotId: shot.id, shot: label, status: "missing" });
    } else {
      const reason = media.cleanCopyReason || "不带字幕的那份没有做出来";
      host.apply(
        withResult(latest, shot.id, take.id, take.videoPath, (item) => ({
          ...item,
          cleanCopyReason: reason,
          ...(media.subtitleCues && !item.subtitleCues ? { subtitleCues: media.subtitleCues } : {}),
        })),
      );
      outcomes.push({ shotId: shot.id, shot: label, status: "failed", reason });
    }
  }
  return { outcomes, notice: cleanCopyNotice(outcomes) };
}

/** One status line for the whole run. */
export function cleanCopyNotice(outcomes: readonly CleanCopyOutcome[]): string {
  if (!outcomes.length) return "没有需要补做的镜头。";
  const done = outcomes.filter((item) => item.status === "done");
  const parts: string[] = [];
  if (done.length)
    parts.push(
      done.length === outcomes.length
        ? `${done.length === 1 ? done[0]!.shot : `${done.length} 个镜头`}不带字幕的那份补好了。`
        : `${done.map((item) => item.shot).join("、")}不带字幕的那份补好了。`,
    );
  for (const item of outcomes.filter((entry) => entry.status === "failed"))
    parts.push(
      item.reason?.startsWith("不带字幕的那份")
        ? `${item.shot}${item.reason}，可以再试一次。`
        : `${item.shot}没有补成（${item.reason ?? "原因不明"}），可以再试一次。`,
    );
  const missing = outcomes.filter((item) => item.status === "missing");
  if (missing.length)
    parts.push(
      `${missing.map((item) => item.shot).join("、")}找不到当时的合成记录，只能重新生成${
        missing.length > 1 ? "这几个" : "这个"
      }镜头。`,
    );
  return parts.join("");
}
