import { expect, it } from "vitest";
import { sampleFilm, type FilmProject, type FilmShot } from "../../film/project";
import {
  prepareExplicitShotSplitTransaction,
  applyStoryStructureTransaction,
  undoStoryStructureTransaction,
} from "./story-structure-transaction";

function setup() {
  const film = sampleFilm();
  film.jobs = [];
  film.audioClips = [];
  const base = film.shots[0]!;
  const target: FilmShot = {
    ...base,
    id: "target",
    sceneId: film.scenes[0]!.id,
    no: 1,
    picture: "甲在窗前",
    line: "第一句。第二句。",
    lines: [{ speaker: "甲", text: "第一句。第二句。" }],
    speaker: "甲",
    source: "user",
    userFields: ["line", "seconds"],
    takes: [],
    stills: [],
    poster: "",
    selectedTakeId: "",
    continuityFrame: undefined,
    continuityFromShotId: undefined,
  };
  film.scenes[0]!.text = "甲说：“第一句。第二句。”";
  const following = { ...target, id: "following", no: 2, line: "", lines: [], userFields: [] };
  const other = { ...following, id: "other", sceneId: film.scenes[1]!.id, no: 1 };
  film.shots = [target, following, other];
  film.unassignedBeats = [{ sceneId: target.sceneId, text: "保留未分配动作" }];
  const pair: FilmShot[] = [
    { ...target, seconds: 3, line: "第一句。", lines: [{ speaker: "甲", text: "第一句。" }] },
    {
      ...target,
      id: crypto.randomUUID(),
      no: 2,
      seconds: 3,
      line: "第二句。",
      lines: [{ speaker: "甲", text: "第二句。" }],
    },
  ];
  return { film, target, following, other, pair };
}

it("explicitly replaces a user-edited target, keeps every other shot and preserves later media while relabeling", () => {
  const { film, target, following, other, pair } = setup();
  following.poster = "/tmp/existing-following.png";
  const tx = prepareExplicitShotSplitTransaction(film, target.id, pair);
  expect(tx.unsupported).toEqual([]);
  pair[0]!.line = "不能更改已审核草稿";
  const live = structuredClone(film);
  live.shots[1]!.poster = "/tmp/later-following.png";
  live.shots[1]!.picture = "后镜后续手改";
  live.shots[2]!.poster = "/tmp/other.png";
  const result = applyStoryStructureTransaction(live, tx);
  expect(result.conflicts).toEqual([]);
  expect(result.film.shots.map((shot) => shot.id)).toEqual([
    target.id,
    pair[1]!.id,
    following.id,
    other.id,
  ]);
  expect(result.film.shots.map((shot) => shot.no)).toEqual([1, 2, 3, 1]);
  expect(result.film.shots.slice(0, 2).map((shot) => shot.line)).toEqual(["第一句。", "第二句。"]);
  expect(result.film.shots[2]).toEqual({ ...live.shots[1], no: 3 });
  expect(result.film.shots[3]).toEqual(live.shots[2]);
  expect(result.film.unassignedBeats).toEqual(live.unassignedBeats);
  const undone = undoStoryStructureTransaction(result.film, result.receipt!);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film.shots).toEqual(live.shots);
  expect(undone.film.unassignedBeats).toEqual(live.unassignedBeats);
});

it("rejects invalid target IDs, non-unique new IDs and cross-scene pairs", () => {
  const { film, target, pair } = setup();
  expect(prepareExplicitShotSplitTransaction(film, "missing", pair).unsupported).toContain(
    "INVALID_SPLIT_TARGET",
  );
  for (const invalid of [
    [],
    [pair[0]!],
    [{ ...pair[0]!, id: "wrong" }, pair[1]!],
    [pair[0]!, { ...pair[1]!, id: "not-a-uuid" }],
    [pair[0]!, { ...pair[1]!, sceneId: film.scenes[1]!.id }],
  ]) {
    expect(prepareExplicitShotSplitTransaction(film, target.id, invalid).unsupported).toContain(
      "INVALID_SPLIT_PROPOSAL",
    );
  }
  film.shots[1]!.id = pair[1]!.id;
  expect(prepareExplicitShotSplitTransaction(film, target.id, pair).unsupported).toContain(
    "SPLIT_ID_COLLISION",
  );
});

const work: [string, (film: FilmProject) => void][] = [
  [
    "poster",
    (film) => {
      film.shots[0]!.poster = "/tmp/old.png";
    },
  ],
  [
    "take",
    (film) => {
      film.shots[0]!.takes = [
        {
          id: "take",
          shotId: "target",
          index: 1,
          status: "done",
          stillUrl: "",
          videoPath: "/tmp/video.mp4",
          videoUrl: "",
          prompt: "",
          createdAt: "",
          reason: "",
        },
      ];
    },
  ],
  [
    "job",
    (film) => {
      film.jobs = [
        {
          id: "job",
          shotId: "target",
          kind: "video",
          take: 1,
          status: "running",
          prompt: "",
          reason: "",
        },
      ];
    },
  ],
  [
    "audio",
    (film) => {
      film.audioClips = [
        {
          id: "clip",
          shotId: "target",
          takeId: "take",
          lane: "dialogue",
          label: "配音",
          startSeconds: 0,
          durationSeconds: 3,
          offsetSeconds: 0,
          gainDb: 0,
        },
      ];
    },
  ],
  [
    "incoming continuity",
    (film) => {
      film.shots[1]!.continuityFromShotId = "target";
    },
  ],
];
it.each(work)(
  "rejects original or late %s even though the split proposal has no assets",
  (_, addWork) => {
    const { film, target, pair } = setup();
    const tx = prepareExplicitShotSplitTransaction(film, target.id, pair);
    const live = structuredClone(film);
    addWork(live);
    const late = applyStoryStructureTransaction(live, tx);
    expect(late.conflicts.length).toBeGreaterThan(0);
    expect(late.film).toBe(live);
    expect(late.receipt).toBeNull();
    const preparedWithWork = prepareExplicitShotSplitTransaction(live, target.id, pair);
    expect(preparedWithWork.unsupported.length).toBeGreaterThan(0);
  },
);

it("refuses stale target edits and numbering changes atomically before apply or undo", () => {
  const { film, target, pair } = setup();
  const tx = prepareExplicitShotSplitTransaction(film, target.id, pair);
  const changedTarget = structuredClone(film);
  changedTarget.shots[0]!.line = "用户又改了台词";
  expect(applyStoryStructureTransaction(changedTarget, tx).conflicts).toContain("TARGET_EDITED");
  const changedNumber = structuredClone(film);
  changedNumber.shots[1]!.no = 99;
  expect(applyStoryStructureTransaction(changedNumber, tx).conflicts).toContain(
    "SHOT_NUMBER_CHANGED",
  );
  const applied = applyStoryStructureTransaction(film, tx);
  expect(applied.conflicts).toEqual([]);
  const later = structuredClone(applied.film);
  later.shots[2]!.no = 99;
  const undo = undoStoryStructureTransaction(later, applied.receipt!);
  expect(undo.conflicts).toContain("SHOT_NUMBER_CHANGED");
  expect(undo.film).toBe(later);
});

it("returns NO_CHANGES for an identical existing adjacent pair without duplicating the second shot", () => {
  const { film, target, pair } = setup();
  const applied = applyStoryStructureTransaction(
    film,
    prepareExplicitShotSplitTransaction(film, target.id, pair),
  );
  expect(applied.conflicts).toEqual([]);
  const tx = prepareExplicitShotSplitTransaction(
    applied.film,
    target.id,
    applied.film.shots.slice(0, 2),
  );
  const again = applyStoryStructureTransaction(applied.film, tx);
  expect(again.code).toBe("NO_CHANGES");
  expect(again.film).toBe(applied.film);
  expect(again.film.shots).toHaveLength(4);
});
