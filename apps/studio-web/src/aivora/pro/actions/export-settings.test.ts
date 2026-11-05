import { afterEach, describe, expect, it, vi } from "vitest";
import { filmSubtitleCues, subtitleExportPlan } from "../../film/operations";
import { sampleFilm, type FilmProject, type FilmTake } from "../../film/project";
import type { FilmExportSettings } from "../media-tasks";
import { applyVideoResponse } from "./generation-run";
import { exportFilmSelection } from "./export-selection";

afterEach(() => {
  delete window.aijian;
});

const take = (shotId: string, extra: Partial<FilmTake> = {}): FilmTake => ({
  id: `${shotId}-take`,
  shotId,
  index: 1,
  status: "done",
  stillUrl: "",
  videoPath: `/story/${shotId}-film.mp4`,
  videoUrl: "",
  prompt: "",
  createdAt: "",
  reason: "",
  ...extra,
});

/** Two shots with lines: the first made with a clean copy, the second before 4B-B09. */
function film(): FilmProject {
  const base = sampleFilm();
  base.audioClips = [];
  base.aspectRatio = "9:16";
  base.shots = base.shots.slice(2, 4).map((shot, index) => ({
    ...shot,
    selectedTakeId: "",
    takes: [
      take(
        shot.id,
        index === 0
          ? {
              cleanVideoPath: `/story/${shot.id}-film-clean.mp4`,
              subtitleCues: [{ text: shot.line, start: 0.4, end: 1.8 }],
              durationSeconds: 2,
            }
          : { durationSeconds: 3 },
      ),
    ],
  }));
  return base;
}

const settings = (subtitles: FilmExportSettings["subtitles"]): FilmExportSettings => ({
  quality: "720p",
  subtitles,
  style: "yellow",
  cover: {
    title: "雨夜巷战",
    subtitle: "第 1 集",
    aiMark: true,
    backgroundUrl: "aivora-media://local/?path=%2Fstory%2Fstill.png",
  },
});

describe("4B-B09 export settings", () => {
  it("keeps the take without burned subtitles and its subtitle times from the service", () => {
    const base = film();
    const shot = base.shots[0]!;
    const running = {
      ...shot.takes[0]!,
      status: "running" as const,
      cleanVideoPath: undefined,
      subtitleCues: undefined,
    };
    base.shots[0] = { ...shot, takes: [running] };
    const result = applyVideoResponse(base, base.shots[0]!, running, {
      status: "SUCCEEDED",
      output_path: "/story/new-film.mp4",
      duration_seconds: "2.000",
      clean_output_path: "/story/new-film-clean.mp4",
      subtitle_cues: [
        { text: "东西交出来，", start_seconds: 0.4, end_seconds: 1.2 },
        { text: "", start_seconds: 1.2, end_seconds: 1.5 },
        { text: "坏的", start_seconds: 2, end_seconds: 1 },
      ],
    });
    const saved = result.film.shots[0]!.takes[0]!;
    expect(saved.cleanVideoPath).toBe("/story/new-film-clean.mp4");
    expect(saved.subtitleCues).toEqual([{ text: "东西交出来，", start: 0.4, end: 1.2 }]);
  });

  it("uses clean takes where there are, and lists older shots whose subtitle is in the picture", () => {
    const base = film();
    const burn = subtitleExportPlan(base, "burn");
    expect(burn.paths).toEqual([
      base.shots[0]!.takes[0]!.cleanVideoPath,
      base.shots[1]!.takes[0]!.videoPath,
    ]);
    expect(burn.cues[0]).toHaveLength(1);
    expect(burn.cues[1]).toEqual([]);
    expect(burn.seconds).toEqual([2, 3]);
    expect(burn.baked).toEqual([`镜头 ${base.shots[1]!.no}`]);
    expect(subtitleExportPlan(base, "none").cues[0]).toEqual([]);
  });

  it("moves each take's subtitles to its place in the film, never past its own shot", () => {
    expect(
      filmSubtitleCues(
        [
          [{ text: "一", start: 0.4, end: 1.8 }],
          [],
          [
            { text: "二", start: 0, end: 9 },
            { text: "三", start: 5, end: 6 },
          ],
        ],
        [2, 3, 1.5],
      ),
    ).toEqual([
      { text: "一", start: 0.4, end: 1.8 },
      { text: "二", start: 5, end: 6.5 },
    ]);
  });

  function bridge(durations?: number[]) {
    const cut = vi.fn().mockImplementation(async (_s, _d, _n, options) => ({
      ok: true,
      path: `/out/film-${options.aspectRatio.replace(":", "x")}.mp4`,
      ...(options.subtitles?.mode === "srt" ? { subtitlePath: "/out/film.srt" } : {}),
      coverPath: "/out/film-封面.png",
    }));
    const assemble = vi
      .fn()
      .mockResolvedValue({
        path: "/films/assembly.mp4",
        reason: "",
        ...(durations ? { durations } : {}),
      });
    window.aijian = {
      pickFilmFolder: vi.fn().mockResolvedValue("/out"),
      exportFilmCut: cut,
      cancelFilmExport: vi.fn().mockResolvedValue({ ok: true }),
      assembleFilm: assemble,
    } as unknown as NonNullable<typeof window.aijian>;
    return { cut, assemble };
  }
  const host = (base: FilmProject) => {
    let current: FilmProject | null = base;
    return {
      current: () => current,
      valid: () => true,
      apply: (next: FilmProject) => {
        current = next;
      },
    };
  };

  it("hands quality, subtitles in the work's look and the cover to the desktop export", async () => {
    const base = film();
    const { cut, assemble } = bridge([2.04, 3]);
    const result = await exportFilmSelection(
      base,
      [],
      "/out",
      host(base),
      "work",
      settings("burn"),
    );
    expect(result.status).toBe("done");
    expect(assemble.mock.calls[0]![1]).toEqual([
      base.shots[0]!.takes[0]!.cleanVideoPath,
      base.shots[1]!.takes[0]!.videoPath,
    ]);
    expect(cut.mock.calls[0]![3]).toMatchObject({
      aspectRatio: "9:16",
      canvas: "9:16",
      quality: "720p",
      subtitles: {
        mode: "burn",
        style: "yellow",
        cues: [{ text: base.shots[0]!.line, start: 0.4, end: 1.8 }],
      },
      cover: {
        title: "雨夜巷战",
        subtitle: "第 1 集",
        aiMark: true,
        still: "aivora-media://local/?path=%2Fstory%2Fstill.png",
      },
    });
    expect(result.outputs[0]).toMatchObject({
      coverPath: "/out/film-封面.png",
      note: `镜头 ${base.shots[1]!.no}是之前生成的，字幕还是原来的样子。`,
    });
  });

  it("refuses to drop or split out a subtitle that an older shot has in its picture", async () => {
    const base = film();
    const { cut } = bridge([2, 3]);
    for (const mode of ["none", "srt"] as const) {
      const result = await exportFilmSelection(
        base,
        [],
        "/out",
        host(base),
        "work",
        settings(mode),
      );
      expect(result.status).toBe("failed");
      expect(result.error).toMatchObject({
        code: "EXPORT_SUBTITLES_BAKED",
        detail: expect.stringContaining(
          `镜头 ${base.shots[1]!.no}是之前生成的，字幕已经在画面里，去不掉`,
        ),
      });
    }
    expect(cut).not.toHaveBeenCalled();
  });

  it("writes a .srt and leaves the picture clean once every shot has a clean copy", async () => {
    const base = film();
    base.shots[1]!.takes[0] = {
      ...base.shots[1]!.takes[0]!,
      cleanVideoPath: "/story/b-clean.mp4",
      subtitleCues: [{ text: "雨太大", start: 0, end: 1 }],
    };
    const { cut } = bridge();
    const result = await exportFilmSelection(base, [], "/out", host(base), "work", settings("srt"));
    expect(result.status).toBe("done");
    // Without measured lengths from the joining, the takes' own lengths place the subtitles.
    expect(cut.mock.calls[0]![3].subtitles.cues).toEqual([
      { text: base.shots[0]!.line, start: 0.4, end: 1.8 },
      { text: "雨太大", start: 2, end: 3 },
    ]);
    expect(result.outputs[0]!.subtitlePath).toBe("/out/film.srt");
  });
});
