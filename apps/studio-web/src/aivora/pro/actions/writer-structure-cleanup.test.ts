import { expect, it } from "vitest";
import { blankFilm, sampleFilm, type FilmProject } from "../../film/project";
import { splitNovel } from "../../film/operations";
import { createProductionPipeline } from "../../film/production-pipeline";
import {
  applyStoryStructureTransaction,
  prepareWriterTransaction,
  undoStoryStructureTransaction,
} from "./story-structure-transaction";

function setup() {
  const film = sampleFilm();
  film.jobs = [];
  film.audioClips = [];
  film.sourceText = "第一场 新小说\n这份原文必须完整保存。";
  const scenes = splitNovel(film.sourceText).scenes;
  return { film, scenes };
}

it("replaces the sample's unused automatic storyboard and restores every old typed shot on undo/redo", () => {
  const { film, scenes } = setup();
  const old = structuredClone(film);
  const tx = prepareWriterTransaction(film, scenes);
  expect(tx.unsupported).toEqual([]);
  expect(tx.shotChanges).toHaveLength(1);
  scenes[0]!.text = "不能修改固定草稿";
  const applied = applyStoryStructureTransaction(film, tx);
  expect(applied.conflicts).toEqual([]);
  expect(applied.film.scenes).toHaveLength(1);
  expect(applied.film.scenes[0]!.text).toContain("这份原文必须完整保存。");
  expect(applied.film.shots).toEqual([]);
  expect(applied.film.sourceText).toBe(film.sourceText);
  expect(film).toEqual(old);
  const undone = undoStoryStructureTransaction(applied.film, applied.receipt!);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film).toEqual(old);
  const redone = applyStoryStructureTransaction(undone.film, applied.receipt!);
  expect(redone.conflicts).toEqual([]);
  expect(redone.film).toEqual(applied.film);
});

it("simulates cleanup and scene replacement as one atomic CAS operation", () => {
  const { film, scenes } = setup();
  const tx = prepareWriterTransaction(film, scenes);
  const live = structuredClone(film);
  live.scenes[0]!.text = "审核期间手改原场";
  const result = applyStoryStructureTransaction(live, tx);
  expect(result.conflicts).toContain("TARGET_EDITED");
  expect(result.film).toBe(live);
  expect(result.film.shots).toEqual(film.shots);
});

const protectedWork: [string, (film: FilmProject) => void][] = [
  [
    "poster",
    (film) => {
      film.shots[0]!.poster = "/tmp/rendered.png";
    },
  ],
  [
    "take",
    (film) => {
      film.shots[0]!.takes = [
        {
          id: "take",
          shotId: film.shots[0]!.id,
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
          shotId: film.shots[0]!.id,
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
          shotId: film.shots[0]!.id,
          takeId: "",
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
    "continuity",
    (film) => {
      film.shots[1]!.continuityFromShotId = film.shots[0]!.id;
    },
  ],
  [
    "manual shot",
    (film) => {
      film.shots[0]!.userFields = ["picture"];
    },
  ],
  [
    "unknown shot provenance",
    (film) => {
      film.shots[0]!.source = "legacy-unknown";
    },
  ],
  [
    "unassigned action",
    (film) => {
      film.unassignedBeats = [{ sceneId: film.shots[0]!.sceneId, text: "待核对动作" }];
    },
  ],
  [
    "scene state",
    (film) => {
      film.scenes[1]!.performanceState = { unassigned: [] };
    },
  ],
  [
    "manual scene",
    (film) => {
      film.scenes[1]!.source = "user";
      film.scenes[1]!.text = "手写场次";
    },
  ],
  [
    "pipeline task",
    (film) => {
      film.productionPipeline = createProductionPipeline(film.id, "version");
      film.productionPipeline.steps.find((step) => step.id === "stills")!.targets = [
        { id: film.shots[0]!.id, status: "running", attempt: 1 },
      ];
    },
  ],
];
it.each(protectedWork)(
  "protects existing and late %s when cleaning old automatic shots",
  (_, protect) => {
    const { film, scenes } = setup();
    const tx = prepareWriterTransaction(film, scenes);
    const live = structuredClone(film);
    protect(live);
    const result = applyStoryStructureTransaction(live, tx);
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.film).toBe(live);
    expect(result.receipt).toBeNull();
    expect(prepareWriterTransaction(live, scenes).unsupported.length).toBeGreaterThan(0);
  },
);

it("keeps retained scenes and new media while cleaning only replaced scenes", () => {
  const { film, scenes } = setup();
  const retained = film.scenes[0]!;
  const untouched = { ...film.shots[0]!, id: "retained-shot", sceneId: retained.id };
  film.shots.unshift(untouched);
  const tx = prepareWriterTransaction(film, [structuredClone(retained), { ...scenes[0]!, no: 2 }]);
  expect(tx.unsupported).toEqual([]);
  const live = structuredClone(film);
  live.shots[0]!.poster = "/tmp/new-retained.png";
  live.scenes[0]!.coverage = {
    sceneId: retained.id,
    ok: false,
    lastLine: "",
    missingLines: ["保留风险"],
    missingTail: null,
  };
  const result = applyStoryStructureTransaction(live, tx);
  expect(result.conflicts).toEqual([]);
  expect(result.film.shots).toEqual([live.shots[0]]);
  expect(result.film.scenes[0]).toEqual(live.scenes[0]);
  expect(undoStoryStructureTransaction(result.film, result.receipt!).film).toEqual(live);
});

it("does not partially restore old scenes when new storyboard content or orphan tasks arrived before undo", () => {
  const { film, scenes } = setup();
  const applied = applyStoryStructureTransaction(film, prepareWriterTransaction(film, scenes));
  const withNewShot = {
    ...applied.film,
    shots: [
      {
        ...film.shots[0]!,
        id: "new-work",
        sceneId: applied.film.scenes[0]!.id,
        poster: "/tmp/new.png",
      },
    ],
  };
  const result = undoStoryStructureTransaction(withNewShot, applied.receipt!);
  expect(result.conflicts.length).toBeGreaterThan(0);
  expect(result.film).toBe(withNewShot);
  const withOrphanTask = {
    ...applied.film,
    jobs: [
      {
        id: "late",
        shotId: film.shots[0]!.id,
        kind: "video" as const,
        take: 1,
        status: "running" as const,
        prompt: "",
        reason: "",
      },
    ],
  };
  const blocked = undoStoryStructureTransaction(withOrphanTask, applied.receipt!);
  expect(blocked.conflicts.length).toBeGreaterThan(0);
  expect(blocked.film).toBe(withOrphanTask);
});

it("restores multiple obsolete scene storyboards atomically and rejects conflicts in later child operations", () => {
  const { film, scenes } = setup();
  const extra = { ...film.shots[0]!, id: "other-scene-shot", sceneId: film.scenes[2]!.id };
  film.shots.push(extra);
  const tx = prepareWriterTransaction(film, scenes);
  expect(tx.shotChanges).toHaveLength(2);
  expect(tx.unsupported).toEqual([]);
  const late = structuredClone(film);
  late.shots.at(-1)!.picture = "另场手改不能被第一场清理掩盖";
  const blocked = applyStoryStructureTransaction(late, tx);
  expect(blocked.conflicts).toContain("TARGET_EDITED");
  expect(blocked.film).toBe(late);
  const applied = applyStoryStructureTransaction(film, tx);
  expect(applied.conflicts).toEqual([]);
  expect(applied.film.shots).toEqual([]);
  const undone = undoStoryStructureTransaction(applied.film, applied.receipt!);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film).toEqual(film);
  const changed = structuredClone(undone.film);
  changed.shots[0]!.poster = "/tmp/arrived-after-undo.png";
  const redo = applyStoryStructureTransaction(changed, applied.receipt!);
  expect(redo.conflicts.length).toBeGreaterThan(0);
  expect(redo.film).toBe(changed);
});

it("splits the initial manuscript while retaining its verbatim source through atomic undo and redo", () => {
  const film = blankFilm();
  film.scenes[0]!.text = "  第一场 书店\n林晚说：今晚打烊了。\n\n第二场 码头\n周烈放下钢条。  ";
  film.scenes[0]!.userFields = ["text"];
  const scenes = splitNovel(film.scenes[0]!.text).scenes;
  const tx = prepareWriterTransaction(film, scenes);
  expect(tx.unsupported).toEqual([]);
  const applied = applyStoryStructureTransaction(film, tx);
  expect(applied.conflicts).toEqual([]);
  expect(applied.film.scenes).toHaveLength(scenes.length);
  expect(applied.film.sourceText).toBe(film.scenes[0]!.text);
  const undone = undoStoryStructureTransaction(applied.film, applied.receipt!);
  expect(undone.film).toEqual(film);
  expect(applyStoryStructureTransaction(undone.film, applied.receipt!).film).toEqual(applied.film);
  const late = { ...applied.film, sourceText: "确认后补充的原文" };
  expect(undoStoryStructureTransaction(late, applied.receipt!).film).toBe(late);
  const edited = structuredClone(film);
  edited.scenes[0]!.text += "请求期间手改";
  expect(applyStoryStructureTransaction(edited, tx).film).toBe(edited);
});

it.each(["title", "state", "additionalScene", "source"])(
  "does not treat an existing authored scene with %s as the initial manuscript",
  (kind) => {
    const film = blankFilm();
    film.scenes[0]!.text = "第一场 书店\n林晚留在书店。\n第二场 码头\n周烈回到码头。";
    // No text lock: require explicit protection instead of relying on applyScenes retaining it.
    if (kind === "title") film.scenes[0]!.title = "人工书店场";
    if (kind === "state") film.scenes[0]!.performanceState = { unassigned: [] };
    if (kind === "additionalScene") film.scenes.push({ ...film.scenes[0]!, id: "authored", no: 2 });
    if (kind === "source") film.sourceText = "此前独立保存的原作";
    const tx = prepareWriterTransaction(film, splitNovel(film.scenes[0]!.text).scenes);
    expect(tx.unsupported).toContain("SCENE_STATE_PROTECTED:scene-1");
    expect(applyStoryStructureTransaction(film, tx).film).toBe(film);
  },
);

it("renumbers a retained manual scene with field CAS while keeping its shots and late content", () => {
  const { film, scenes } = setup();
  const retained = {
    ...film.scenes[0]!,
    id: "scene-7",
    no: 7,
    text: "独立手写场次保留",
    source: "user",
    userFields: ["text"],
  };
  film.scenes.push(retained);
  const shot = {
    ...film.shots[0]!,
    id: "retained-manual-shot",
    sceneId: retained.id,
    source: "user",
    userFields: ["picture"],
    poster: "/tmp/old.png",
  };
  film.shots.push(shot);
  const tx = prepareWriterTransaction(film, scenes);
  expect(tx.unsupported).toEqual([]);
  expect(tx.sceneNumbering).toEqual([{ id: retained.id, before: 7, after: 1 }]);
  const live = structuredClone(film);
  live.scenes.at(-1)!.text += "。审核期间补充";
  live.shots.at(-1)!.poster = "/tmp/late.png";
  const applied = applyStoryStructureTransaction(live, tx);
  expect(applied.conflicts).toEqual([]);
  expect(applied.film.scenes[0]).toEqual({ ...live.scenes.at(-1)!, no: 1 });
  expect(applied.film.shots).toEqual([live.shots.at(-1)]);
  const undone = undoStoryStructureTransaction(applied.film, applied.receipt!);
  expect(undone.conflicts).toEqual([]);
  expect(undone.film).toEqual(live);
  expect(applyStoryStructureTransaction(undone.film, applied.receipt!).film).toEqual(applied.film);
  const conflict = structuredClone(applied.film);
  conflict.scenes[0]!.no = 9;
  const blocked = undoStoryStructureTransaction(conflict, applied.receipt!);
  expect(blocked.conflicts).toEqual(["SCENE_NUMBER_CHANGED"]);
  expect(blocked.film).toBe(conflict);
  live.scenes.at(-1)!.no = 8;
  expect(applyStoryStructureTransaction(live, tx).conflicts).toEqual(["SCENE_NUMBER_CHANGED"]);
});
