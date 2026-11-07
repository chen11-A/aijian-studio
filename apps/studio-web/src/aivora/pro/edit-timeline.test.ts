import { describe, expect, it } from "vitest";
import type { FilmShot } from "../film/project";
import {
  cutPosition,
  cutSegments,
  cutTake,
  cutTimeAt,
  editClipLayout,
  fitZoom,
  FOLDED_WIDTH,
  playheadX,
  PX_PER_SECOND,
  pointAt,
  rulerStep,
  shotReady,
  spacedTicks,
  stepZoom,
  ticksOutsideFolds,
  timelineSeconds,
  xAtSeconds,
} from "./edit-timeline";

function shot(id: string, seconds: number, video = false, sceneId = "s1"): FilmShot {
  return {
    id,
    sceneId,
    seconds,
    selectedTakeId: video ? `${id}-t` : "",
    takes: video
      ? [
          {
            id: `${id}-t`,
            shotId: id,
            index: 1,
            status: "done",
            stillUrl: "",
            videoPath: `/films/${id}.mp4`,
            videoUrl: `file:///films/${id}.mp4`,
            prompt: "",
            createdAt: "",
            reason: "",
          },
        ]
      : [],
  } as unknown as FilmShot;
}

const clips = [
  { id: "a", left: 1, width: 100 },
  { id: "b", left: 103, width: 50 },
  { id: "c", left: 155, width: 200 },
];

describe("folding shots with no video (3JR-U02)", () => {
  const shots = [shot("a", 4, true), shot("b", 2), shot("c", 6), shot("d", 3, true)];

  it("keeps finished shots at their length and narrows the rest", () => {
    expect(shotReady(shots[0]!)).toBe(true);
    expect(shotReady(shots[1]!)).toBe(false);
    expect(editClipLayout(shots, true)).toEqual([
      { id: "a", left: 1, width: 206, folded: false },
      { id: "b", left: 209, width: FOLDED_WIDTH, folded: true },
      { id: "c", left: 227, width: FOLDED_WIDTH, folded: true },
      { id: "d", left: 245, width: 154, folded: false },
    ]);
  });

  it("shows every shot at its length when unfolded", () => {
    expect(editClipLayout(shots, false).map((clip) => [clip.width, clip.folded])).toEqual([
      [206, false],
      [102, false],
      [310, false],
      [154, false],
    ]);
  });

  it("leaves the folded shots without ruler marks", () => {
    const clips = editClipLayout(shots, true);
    const ticks = [
      { seconds: 0, left: 1 },
      { seconds: 5, left: 215 },
      { seconds: 10, left: 300 },
    ];
    expect(ticksOutsideFolds(ticks, clips).map((tick) => tick.seconds)).toEqual([0, 10]);
  });

  it("drops ruler marks that would print on top of each other", () => {
    const ticks = [0, 30, 60, 70, 140].map((left) => ({ left }));
    expect(spacedTicks(ticks).map((tick) => tick.left)).toEqual([0, 60, 140]);
  });
});

describe("joined cut timing", () => {
  it("keeps only shots with a video file, in film order", () => {
    const shots = [shot("a", 4, true), shot("b", 2), shot("c", 6, true)];
    expect(cutTake(shots[1]!)).toBeUndefined();
    expect(cutSegments(shots)).toEqual([
      { shotId: "a", start: 0, seconds: 4 },
      { shotId: "c", start: 4, seconds: 6 },
    ]);
  });

  it("stretches the plan to the cut's real length", () => {
    const segments = cutSegments([shot("a", 4, true), shot("c", 6, true)], 20);
    expect(segments).toEqual([
      { shotId: "a", start: 0, seconds: 8 },
      { shotId: "c", start: 8, seconds: 12 },
    ]);
  });

  it("finds the playing shot and how far into it", () => {
    const segments = cutSegments([shot("a", 4, true), shot("c", 6, true)]);
    expect(cutPosition(segments, 2)).toEqual({ shotId: "a", fraction: 0.5 });
    expect(cutPosition(segments, 7)).toEqual({ shotId: "c", fraction: 0.5 });
    expect(cutPosition(segments, 99)).toEqual({ shotId: "c", fraction: 1 });
    expect(cutPosition([], 3)).toBeNull();
  });
});

describe("playhead on the timeline", () => {
  const shown = [shot("a", 4, true), shot("b", 2), shot("c", 6, true)];

  it("moves through the shot that is playing instead of sticking at its right edge", () => {
    const segments = cutSegments(shown);
    const early = cutPosition(segments, 1)!;
    const later = cutPosition(segments, 7)!;
    expect(playheadX(clips, shown, shown, early.shotId, early.fraction)).toBe(26);
    expect(playheadX(clips, shown, shown, later.shotId, later.fraction)).toBe(255);
  });

  it("pins to the near end for a shot of another scene", () => {
    const before = shot("z0", 3, true, "s0");
    const after = shot("z9", 3, true, "s9");
    const all = [before, ...shown, after];
    expect(playheadX(clips, shown, all, "z0", 0.5)).toBe(1);
    expect(playheadX(clips, shown, all, "z9", 0.5)).toBe(355);
  });

  it("reads the timeline time under the playhead", () => {
    expect(timelineSeconds(shown, 2, 0.5)).toBe(9);
    expect(timelineSeconds(shown, 0, 0)).toBe(0);
  });
});

describe("clicking the timeline", () => {
  const shown = [shot("a", 4, true), shot("b", 2), shot("c", 6, true)];

  it("finds the shot under the pointer, snapping past either end", () => {
    expect(pointAt(clips, 51)).toEqual({ index: 0, fraction: 0.5 });
    expect(pointAt(clips, 128)).toEqual({ index: 1, fraction: 0.5 });
    expect(pointAt(clips, -20)).toEqual({ index: 0, fraction: 0 });
    expect(pointAt(clips, 900)).toEqual({ index: 2, fraction: 1 });
    expect(pointAt([], 10)).toBeNull();
  });

  it("turns a time back into an x for the arrow keys", () => {
    expect(xAtSeconds(shown, clips, 2)).toBe(51);
    expect(xAtSeconds(shown, clips, 9)).toBe(255);
    expect(xAtSeconds(shown, clips, 99)).toBe(355);
    expect(xAtSeconds([], [], 3)).toBe(1);
  });

  it("jumps to that point of the joined cut", () => {
    const segments = cutSegments(shown);
    expect(cutTimeAt(segments, shown, 0, 0.5)).toBe(2);
    expect(cutTimeAt(segments, shown, 2, 0.5)).toBe(7);
  });

  it("jumps to the next shot with a video when the clicked one has none", () => {
    const segments = cutSegments(shown);
    expect(cutTimeAt(segments, shown, 1, 0.5)).toBe(4);
    const tail = [shot("a", 4, true), shot("b", 2)];
    expect(cutTimeAt(cutSegments(tail), tail, 1, 0.5)).toBe(4);
    expect(cutTimeAt([], shown, 0, 0)).toBeNull();
  });
});

describe("timeline zoom (5-3-08)", () => {
  const made = (id: string, seconds: number) =>
    ({ id, seconds, takes: [{ id: `${id}-t`, status: "done" }] }) as unknown as FilmShot;

  it("keeps the starting layout and scales it in and out", () => {
    const shots = [made("a", 4), made("b", 2)];
    expect(editClipLayout(shots, false)).toEqual(editClipLayout(shots, false, PX_PER_SECOND));
    const wide = editClipLayout(shots, false, 104);
    expect(wide[0]!.width).toBe(4 * 104 - 2);
    const narrow = editClipLayout(shots, false, 13);
    expect(narrow[0]!.width).toBe(4 * 13 - 2);
    expect(narrow[1]!.left).toBe(narrow[0]!.left + narrow[0]!.width + 2);
  });

  it("steps through the zoom levels and fits the whole cut", () => {
    expect(stepZoom(52, 1)).toBe(104);
    expect(stepZoom(52, -1)).toBe(26);
    expect(stepZoom(208, 1)).toBe(208);
    expect(stepZoom(6, -1)).toBe(6);
    expect(stepZoom(40, 1)).toBe(52);
    expect(fitZoom(100, 1024)).toBe(10);
    expect(fitZoom(0, 1024)).toBe(PX_PER_SECOND);
    expect(fitZoom(10000, 1024)).toBe(6);
  });

  it("spaces the ruler for the zoom", () => {
    expect(rulerStep(60, 208)).toBe(1);
    expect(rulerStep(60, 104)).toBe(2);
    expect(rulerStep(60, 52)).toBe(5);
    expect(rulerStep(200, 52)).toBe(10);
    expect(rulerStep(600, 6)).toBe(30);
  });
});

describe("native assembly actual clocks", () => {
  const shown = [shot("a", 99, true), shot("unfinished", 99), shot("c", 99, true)];
  const actual = {
    durationSeconds: 3,
    shots: [
      { shotId: "a", takeId: "a-t", startSeconds: 0, durationSeconds: 2 },
      { shotId: "c", takeId: "c-t", startSeconds: 2, durationSeconds: 1 },
    ],
  };
  it("uses actual selected-source times and excludes unfinished estimates without scaling to browser metadata", () => {
    const segments = cutSegments(shown, 100, actual);
    expect(segments).toEqual([
      { shotId: "a", start: 0, seconds: 2 },
      { shotId: "c", start: 2, seconds: 1 },
    ]);
    expect(cutPosition(segments, 2.5)).toEqual({ shotId: "c", fraction: 0.5 });
    expect(cutTimeAt(segments, shown, 2, 0.5)).toBe(2.5);
  });
  it("does not estimate missing, reordered, discontinuous or changed selected-version clocks", () => {
    expect(cutSegments(shown, 100, null)).toEqual([]);
    expect(cutSegments(shown, 100, { ...actual, shots: [...actual.shots].reverse() })).toEqual([]);
    expect(
      cutSegments(shown, 100, {
        ...actual,
        shots: actual.shots.map((r, i) => ({ ...r, startSeconds: i ? 2.1 : 0 })),
      }),
    ).toEqual([]);
    expect(
      cutSegments(
        shown.map((s, i) =>
          i ? s : { ...s, selectedTakeId: "new", takes: [{ ...s.takes[0]!, id: "new" }] },
        ),
        100,
        actual,
      ),
    ).toEqual([]);
  });
});
