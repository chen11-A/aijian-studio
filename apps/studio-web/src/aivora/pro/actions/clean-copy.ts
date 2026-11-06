import { spokenLine } from "../../film/operations";
import type { FilmProject, FilmShot, FilmTake } from "../../film/project";
import { exportMedia } from "./generation-run";

/** 4B-B12: what happened to one shot when its copy without subtitles was made again. */
export type CleanCopyOutcome = {
  shotId: string;
  shot: string;
  status: "done" | "failed" | "missing" | "stale";
  reason?: string;
};

type Host = {
  current: () => FilmProject | null;
  apply: (next: FilmProject) => void;
  /** Persist the already applied result before proceeding to another target. */
  persist?: (snapshot: FilmProject) => Promise<void>;
};

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
): FilmProject | null {
  const shot = film.shots.find((item) => item.id === shotId);
  const selected = shot && chosenTake(shot);
  if (
    !selected ||
    selected.id !== takeId ||
    selected.videoPath !== videoPath ||
    selected.cleanVideoPath?.trim()
  )
    return null;
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
  // Freeze only the requested version identities before the first await.
  const targets = base.shots.flatMap((shot) => {
    const take = chosenTake(shot);
    return wanted.has(shot.id) && take && !take.cleanVideoPath?.trim()
      ? [{ shotId: shot.id, shot: `镜头 ${shot.no}`, takeId: take.id, videoPath: take.videoPath }]
      : [];
  });
  for (const target of targets) {
    const stale = () =>
      outcomes.push({ shotId: target.shotId, shot: target.shot, status: "stale" });
    const currentTarget = () => {
      const live = host.current();
      const shot =
        live?.id === base.id ? live.shots.find((item) => item.id === target.shotId) : undefined;
      const take = shot && chosenTake(shot);
      return (
        take?.id === target.takeId &&
        take.videoPath === target.videoPath &&
        !take.cleanVideoPath?.trim()
      );
    };
    if (host.current()?.id !== base.id) {
      stale();
      break;
    }
    if (!currentTarget()) {
      stale();
      continue;
    }
    if (!bridge?.remakeStoryFilmCleanCopy) {
      outcomes.push({
        shotId: target.shotId,
        shot: target.shot,
        status: "failed",
        reason: "需要桌面版",
      });
      continue;
    }
    let data: Record<string, unknown>;
    try {
      data = (await bridge.remakeStoryFilmCleanCopy(projectId, target.videoPath)).data;
    } catch {
      if (!currentTarget()) {
        stale();
        if (host.current()?.id !== base.id) break;
        continue;
      }
      outcomes.push({
        shotId: target.shotId,
        shot: target.shot,
        status: "failed",
        reason: "本机处理没有完成",
      });
      continue;
    }
    const latest = host.current();
    if (!latest || latest.id !== base.id) {
      stale();
      break;
    }
    if (!currentTarget()) {
      stale();
      continue;
    }
    const media = exportMedia(data);
    if (data.status === "SUCCEEDED" && media.cleanVideoPath) {
      const updated = withResult(latest, target.shotId, target.takeId, target.videoPath, (item) => {
        const next: FilmTake = { ...item, cleanVideoPath: media.cleanVideoPath };
        if (media.subtitleCues) next.subtitleCues = media.subtitleCues;
        delete next.cleanCopyReason;
        return next;
      });
      if (!updated) {
        stale();
        continue;
      }
      host.apply(updated);
      const written = host.current();
      const shot =
        written?.id === base.id
          ? written.shots.find((item) => item.id === target.shotId)
          : undefined;
      const take = shot && chosenTake(shot);
      if (
        written &&
        take?.id === target.takeId &&
        take.videoPath === target.videoPath &&
        take.cleanVideoPath === media.cleanVideoPath
      ) {
        await host.persist?.(written);
        outcomes.push({ shotId: target.shotId, shot: target.shot, status: "done" });
      } else stale();
    } else if (data.status === "NOT_FOUND") {
      outcomes.push({ shotId: target.shotId, shot: target.shot, status: "missing" });
    } else {
      // Service error text can contain local paths. Present only known Chinese categories.
      const reasons: Record<string, string> = {
        EXPORT_FAILED: "合成没有完成",
        MEDIA_ENCODE_FAILED: "整理画面或配音时没有成功",
        PROBE_FAILED: "没有读到可以合成的画面",
        CLEAN_COPY_MISSING: "合成说做好了，但文件不在",
      };
      const detail =
        typeof data.clean_copy_error === "string" ? reasons[data.clean_copy_error] : undefined;
      const reason = detail ? `不带字幕的那份没有做出来（${detail}）` : "不带字幕的那份没有做出来";
      const updated = withResult(
        latest,
        target.shotId,
        target.takeId,
        target.videoPath,
        (item) => ({
          ...item,
          cleanCopyReason: reason,
          ...(media.subtitleCues && !item.subtitleCues ? { subtitleCues: media.subtitleCues } : {}),
        }),
      );
      if (!updated) {
        stale();
        continue;
      }
      host.apply(updated);
      const written = host.current();
      if (!written || written.id !== base.id) {
        stale();
        break;
      }
      await host.persist?.(written);
      outcomes.push({ shotId: target.shotId, shot: target.shot, status: "failed", reason });
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
  for (const item of outcomes.filter((entry) => entry.status === "stale"))
    parts.push(`${item.shot}的作品或版本已经变化，已跳过旧结果。`);
  return parts.join("");
}
