import { afterEach, describe, expect, it, vi } from "vitest";
import { subtitleExportPlan } from "../../film/operations";
import { sampleFilm, type FilmProject, type FilmTake } from "../../film/project";
import { cleanCopyNotice, remakeCleanCopies, shotsNeedingCleanCopy } from "./clean-copy";

afterEach(() => {
  delete window.aijian;
});

const take = (shotId: string, extra: Partial<FilmTake> = {}): FilmTake => ({
  id: `${shotId}-take`,
  shotId,
  index: 1,
  status: "done",
  stillUrl: "",
  videoPath: `/ws/story-films/${shotId}-film.mp4`,
  videoUrl: "",
  prompt: "",
  createdAt: "",
  reason: "",
  ...extra,
});

/** Three shots with lines: made before 4B-B09, a failed clean copy, and one with its copy. */
function film(): FilmProject {
  const base = sampleFilm();
  base.audioClips = [];
  base.shots = base.shots.slice(1, 4).map((shot, index) => ({
    ...shot,
    line: `第 ${index + 1} 句`,
    lines: [{ speaker: "林晚", text: `第 ${index + 1} 句` }],
    selectedTakeId: "",
    takes: [
      take(
        shot.id,
        index === 1
          ? { cleanCopyReason: "不带字幕的那份没有做出来（整理画面或配音时没有成功）" }
          : index === 2
            ? { cleanVideoPath: `/ws/story-films/${shot.id}-film-clean.mp4` }
            : {},
      ),
    ],
  }));
  return base;
}

function host(base: FilmProject) {
  let current: FilmProject | null = base;
  return {
    current: () => current,
    apply: (next: FilmProject) => {
      current = next;
    },
    latest: () => current!,
  };
}

const answer = (data: Record<string, unknown>) =>
  Promise.resolve({ data, request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7" });

describe("4B-B12 make the copy without subtitles again", () => {
  it("lists the shots whose chosen take still has its subtitle in the picture", () => {
    const base = film();
    expect(shotsNeedingCleanCopy(base)).toEqual([base.shots[0]!.id, base.shots[1]!.id]);
    base.shots[0] = { ...base.shots[0]!, line: "", lines: [] };
    expect(shotsNeedingCleanCopy(base)).toEqual([base.shots[1]!.id]);
  });

  it("writes each new copy and its subtitle times into the take, and then exports clean", async () => {
    const base = film();
    const [old, failed] = base.shots;
    const remake = vi.fn((_project: string, path: string) =>
      answer(
        path === old!.takes[0]!.videoPath
          ? {
              status: "SUCCEEDED",
              message: "",
              clean_output_path: "/ws/story-films/a-film-clean-1234abcd.mp4",
              subtitle_cues: [{ text: "东西交出来，", start_seconds: 0.4, end_seconds: 1.2 }],
            }
          : {
              status: "FAILED",
              message: "",
              clean_copy_error: "EXPORT_FAILED",
              clean_copy_reason: "不带字幕的那份没有做出来（合成没有完成）",
            },
      ),
    );
    window.aijian = { remakeStoryFilmCleanCopy: remake } as unknown as NonNullable<
      typeof window.aijian
    >;
    const place = host(base);
    const result = await remakeCleanCopies(base, null, "prj_x", place);
    expect(remake.mock.calls.map((call) => call[1])).toEqual([
      old!.takes[0]!.videoPath,
      failed!.takes[0]!.videoPath,
    ]);
    const saved = place.latest();
    expect(saved.shots[0]!.takes[0]).toMatchObject({
      cleanVideoPath: "/ws/story-films/a-film-clean-1234abcd.mp4",
      subtitleCues: [{ text: "东西交出来，", start: 0.4, end: 1.2 }],
    });
    expect(saved.shots[1]!.takes[0]!.cleanCopyReason).toBe(
      "不带字幕的那份没有做出来（合成没有完成）",
    );
    expect(result.outcomes.map((item) => item.status)).toEqual(["done", "failed"]);
    expect(result.notice).toBe(
      `镜头 ${old!.no}不带字幕的那份补好了。` +
        `镜头 ${failed!.no}不带字幕的那份没有做出来（合成没有完成），可以再试一次。`,
    );
    const plan = subtitleExportPlan(saved, "srt");
    expect(plan.baked).toEqual([]);
    expect(plan.unclean.map((item) => item.shot)).toEqual([`镜头 ${failed!.no}`]);
    expect(plan.paths[0]).toBe("/ws/story-films/a-film-clean-1234abcd.mp4");
  });

  it("leaves a take it cannot find a record for, or one replaced meanwhile, as it is", async () => {
    const base = film();
    const place = host(base);
    const remake = vi.fn(async (_project: string, path: string) => {
      // While the first one is being made, the user regenerates that shot.
      place.apply({
        ...place.latest(),
        shots: place
          .latest()
          .shots.map((shot, index) =>
            index === 0
              ? { ...shot, takes: [{ ...shot.takes[0]!, videoPath: "/ws/story-films/new.mp4" }] }
              : shot,
          ),
      });
      return answer(
        path.includes(base.shots[0]!.id)
          ? { status: "SUCCEEDED", message: "", clean_output_path: "/ws/story-films/x-clean.mp4" }
          : { status: "NOT_FOUND", message: "找不到" },
      );
    });
    window.aijian = { remakeStoryFilmCleanCopy: remake } as unknown as NonNullable<
      typeof window.aijian
    >;
    const result = await remakeCleanCopies(base, null, "prj_x", place);
    expect(place.latest().shots[0]!.takes[0]!.cleanVideoPath).toBeUndefined();
    expect(place.latest().shots[1]!.takes[0]).toEqual(base.shots[1]!.takes[0]);
    expect(result.outcomes.map((item) => item.status)).toEqual(["done", "missing"]);
    expect(result.notice).toContain(
      `镜头 ${base.shots[1]!.no}找不到当时的合成记录，只能重新生成这个镜头。`,
    );
  });

  it("does only the shots asked for, and says why when the service cannot be reached", async () => {
    const base = film();
    const remake = vi.fn().mockRejectedValue(new Error("成片服务没有完成。"));
    window.aijian = { remakeStoryFilmCleanCopy: remake } as unknown as NonNullable<
      typeof window.aijian
    >;
    const result = await remakeCleanCopies(base, [base.shots[1]!.id], "prj_x", host(base));
    expect(remake).toHaveBeenCalledTimes(1);
    expect(result.notice).toBe(
      `镜头 ${base.shots[1]!.no}没有补成（成片服务没有完成。），可以再试一次。`,
    );
    expect(cleanCopyNotice([])).toBe("没有需要补做的镜头。");
  });
});
