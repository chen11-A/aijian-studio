import { describe, expect, it } from "vitest";
import { sampleFilm, type FilmProject, type FilmShot } from "../../film/project";
import { applyDirectorPlan } from "../director-workflow";
import { createProductionPipeline } from "../../film/production-pipeline";
import {
  prepareDirectorTransaction,
  prepareWriterTransaction,
  applyStoryStructureTransaction,
  undoStoryStructureTransaction,
} from "./story-structure-transaction";

function setup() {
  const film = sampleFilm();
  film.jobs = [];
  film.audioClips = [];
  film.unassignedBeats = [];
  film.scenes = film.scenes
    .slice(0, 2)
    .map((scene, index) => ({ ...scene, no: index + 1, userFields: [] }));
  film.shots = film.scenes.map((scene, index) => ({
    ...film.shots[0]!,
    id: `${scene.id}-shot-1`,
    sceneId: scene.id,
    no: 1,
    picture: `第${index + 1}场画面`,
    takes: [],
    stills: [],
    poster: "",
    selectedTakeId: "",
    continuityFrame: undefined,
    continuityFromShotId: undefined,
    source: "agent:director",
    userFields: [],
  }));
  return { film, sceneId: film.scenes[0]!.id, shot: film.shots[0]!, other: film.shots[1]! };
}
const proposal = (shot: FilmShot) => ({
  ...shot,
  picture: "固定建议新画面",
  action: "抬起手",
  lines: [
    { speaker: "甲", text: "第一句。" },
    { speaker: "乙", text: "第二句。" },
  ],
  line: "第一句。\n第二句。",
});
const dependencyCases: [string, (film: FilmProject) => void][] = [
  [
    "takes",
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
          prompt: "old",
          createdAt: "",
          reason: "",
        },
      ];
    },
  ],
  [
    "poster",
    (film) => {
      film.shots[0]!.poster = "/tmp/frame.png";
    },
  ],
  [
    "stills",
    (film) => {
      film.shots[0]!.stills = [{ id: "still", url: "/tmp/still.png", prompt: "old" }];
    },
  ],
  [
    "selectedTake",
    (film) => {
      film.shots[0]!.selectedTakeId = "selected";
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
          prompt: "generation",
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
          takeId: "take",
          lane: "dialogue",
          label: "配音",
          startSeconds: 0,
          durationSeconds: 3,
          offsetSeconds: 0,
          gainDb: 0,
          path: "/tmp/voice.wav",
        },
      ];
    },
  ],
  [
    "outgoing continuity",
    (film) => {
      film.shots[0]!.continuityFromShotId = "previous";
    },
  ],
  [
    "incoming continuity",
    (film) => {
      film.shots[1]!.continuityFromShotId = film.shots[0]!.id;
    },
  ],
  [
    "pipeline target",
    (film) => {
      film.productionPipeline = createProductionPipeline(film.id, "version");
      film.productionPipeline.steps.find((step) => step.id === "stills")!.targets = [
        { id: film.shots[0]!.id, status: "queued", attempt: 0 },
      ];
    },
  ],
];

describe("fixed story structure transactions", () => {
  it("applies and undoes shots, full coverage and unassigned metadata atomically while keeping unrelated new media", () => {
    const { film, sceneId, shot, other } = setup();
    film.scenes[0]!.paragraphCoverage = {
      ok: false,
      missingParagraphs: ["P101"],
      duplicateParagraphs: ["P102"],
      invalidParagraphs: [],
      crossSceneRisk: true,
    };
    film.unassignedBeats = [
      { sceneId, text: "old unresolved" },
      { sceneId: other.sceneId, text: "other unresolved" },
    ];
    const incoming = proposal(shot);
    incoming.directorPlan = {
      sourceSnapshot: "baseline",
      timingStatus: "needs_review",
      segments: [],
    };
    const beats = [{ sceneId, text: "new unresolved" }];
    const expected = structuredClone(applyDirectorPlan(film, [incoming], sceneId, beats));
    const tx = prepareDirectorTransaction(film, sceneId, [incoming], beats);
    expect(tx.unsupported).toEqual([]);
    incoming.picture = "changed after review must not change the transaction";
    beats[0]!.text = "mutated after review";
    const live = structuredClone(film);
    live.shots[1]!.poster = "/tmp/new-unrelated.png";
    live.scenes[1]!.text = "别的场手改";
    live.scenes[0]!.performanceState = { unassigned: [] };
    const applied = applyStoryStructureTransaction(live, tx);
    expect(applied.conflicts).toEqual([]);
    expect(applied.film.shots[0]).toEqual(expected.shots[0]);
    expect(applied.film.scenes[0]!.coverage).toEqual(expected.scenes[0]!.coverage);
    expect(applied.film.scenes[0]!.paragraphCoverage).toEqual(film.scenes[0]!.paragraphCoverage);
    expect(applied.film.scenes[0]!.performanceState).toEqual(live.scenes[0]!.performanceState);
    expect(applied.film.unassignedBeats).toEqual(expected.unassignedBeats);
    expect(applied.film.shots[1]!.poster).toBe("/tmp/new-unrelated.png");
    expect(applied.film.scenes[1]!.text).toBe("别的场手改");
    const undone = undoStoryStructureTransaction(applied.film, applied.receipt!);
    expect(undone.conflicts).toEqual([]);
    expect(undone.film.shots[0]).toEqual(shot);
    expect(undone.film.scenes[0]).not.toHaveProperty("coverage");
    expect(undone.film.unassignedBeats).toEqual(film.unassignedBeats);
    expect(undone.film.shots[1]!.poster).toBe("/tmp/new-unrelated.png");
  });

  it.each(dependencyCases)(
    "rejects replacement/deletion with existing %s rather than silently losing it",
    (_, addWork) => {
      const { film, sceneId, shot } = setup();
      addWork(film);
      const before = structuredClone(film);
      for (const incoming of [[proposal(shot)], [{ ...proposal(shot), id: "replacement-id" }]]) {
        const tx = prepareDirectorTransaction(film, sceneId, incoming);
        const result = applyStoryStructureTransaction(film, tx);
        expect(result.conflicts.length).toBeGreaterThan(0);
        expect(result.film).toBe(film);
        expect(result.receipt).toBeNull();
      }
      expect(film).toEqual(before);
    },
  );

  it.each(dependencyCases)(
    "atomically refuses new %s arriving between review and apply/undo",
    (_, addWork) => {
      const { film, sceneId, shot } = setup();
      const tx = prepareDirectorTransaction(film, sceneId, [proposal(shot)]);
      const live = structuredClone(film);
      addWork(live);
      const blocked = applyStoryStructureTransaction(live, tx);
      expect(blocked.conflicts.length).toBeGreaterThan(0);
      expect(blocked.film).toBe(live);
      expect(blocked.film.scenes[0]).not.toHaveProperty("coverage");
      const applied = applyStoryStructureTransaction(film, tx);
      expect(applied.conflicts).toEqual([]);
      const withWork = structuredClone(applied.film);
      addWork(withWork);
      const undo = undoStoryStructureTransaction(withWork, applied.receipt!);
      expect(undo.conflicts.length).toBeGreaterThan(0);
      expect(undo.film).toBe(withWork);
    },
  );

  it("uses request-time source, coverage and unresolved-action CAS with no partial writes", () => {
    const { film, sceneId, shot } = setup();
    const tx = prepareDirectorTransaction(
      film,
      sceneId,
      [proposal(shot)],
      [{ sceneId, text: "new" }],
    );
    const variants = [
      structuredClone(film),
      structuredClone(film),
      structuredClone(film),
      structuredClone(film),
    ];
    variants[0]!.scenes[0]!.text = "手改源文";
    variants[1]!.scenes[0]!.coverage = {
      sceneId,
      ok: false,
      lastLine: "",
      missingLines: ["new risk"],
      missingTail: null,
    };
    variants[2]!.unassignedBeats = [{ sceneId, text: "concurrent risk" }];
    variants[3]!.shots[0]!.picture = "手改镜头";
    for (const live of variants) {
      const result = applyStoryStructureTransaction(live, tx);
      expect(result.film).toBe(live);
      expect(result.conflicts.length).toBeGreaterThan(0);
    }
  });

  it("rejects any cross-scene director response instead of applying its extra scenes", () => {
    const { film, sceneId, shot, other } = setup();
    expect(
      prepareDirectorTransaction(film, sceneId, [proposal(shot), proposal(other)]).unsupported,
    ).toContain("OUTSIDE_SCENE_PROPOSAL");
    expect(
      prepareDirectorTransaction(
        film,
        sceneId,
        [proposal(shot)],
        [{ sceneId: other.sceneId, text: "foreign" }],
      ).unsupported,
    ).toContain("OUTSIDE_SCENE_PROPOSAL");
  });

  it("preserves new media on an unchanged shot inside the reviewed scene", () => {
    const { film, sceneId, shot } = setup();
    const second = { ...shot, id: `${sceneId}-second`, no: 2 };
    film.shots.splice(1, 0, second);
    const tx = prepareDirectorTransaction(film, sceneId, [structuredClone(shot), proposal(second)]);
    const live = structuredClone(film);
    live.shots[0]!.poster = "/tmp/new-on-unchanged-shot.png";
    const applied = applyStoryStructureTransaction(live, tx);
    expect(applied.conflicts).toEqual([]);
    expect(applied.film.shots[0]).toEqual(live.shots[0]);
    expect(applied.film.shots[1]!.picture).toBe("固定建议新画面");
    const undone = undoStoryStructureTransaction(applied.film, applied.receipt!);
    expect(undone.conflicts).toEqual([]);
    expect(undone.film.shots[0]).toEqual(live.shots[0]);
  });

  it("adds first shots and undoes them, but refuses a later task for the empty scene", () => {
    const { film, sceneId, shot } = setup();
    film.shots = film.shots.filter((row) => row.sceneId !== sceneId);
    const tx = prepareDirectorTransaction(film, sceneId, [proposal(shot)]);
    const applied = applyStoryStructureTransaction(film, tx);
    expect(applied.conflicts).toEqual([]);
    expect(undoStoryStructureTransaction(applied.film, applied.receipt!).film.shots).toEqual(
      film.shots,
    );
    const live = structuredClone(film);
    live.productionPipeline = createProductionPipeline(live.id, "version");
    live.productionPipeline.steps.find((step) => step.id === "director")!.targets = [
      { id: sceneId, status: "running", attempt: 1 },
    ];
    expect(applyStoryStructureTransaction(live, tx).conflicts).toContain("TASKS_CHANGED");
  });

  it("treats identical reviewed content as no changes even when it already has media", () => {
    const { film, sceneId, shot } = setup();
    shot.poster = "/tmp/keep.png";
    const base = applyDirectorPlan(film, [shot], sceneId);
    const tx = prepareDirectorTransaction(base, sceneId, [structuredClone(shot)]);
    expect(tx.unsupported).toEqual([]);
    const result = applyStoryStructureTransaction(base, tx);
    expect(result.code).toBe("NO_CHANGES");
    expect(result.film).toBe(base);
  });

  it("adds writer scenes while leaving unchanged scenes and their new dependent media intact", () => {
    const { film, shot } = setup();
    const scenes = [
      ...structuredClone(film.scenes),
      {
        ...structuredClone(film.scenes[1]!),
        id: "scene-new",
        no: 3,
        text: "新场全部正文",
        paragraphCoverage: {
          ok: false,
          missingParagraphs: ["P103"],
          duplicateParagraphs: [],
          invalidParagraphs: [],
          crossSceneRisk: false,
        },
      },
    ];
    const tx = prepareWriterTransaction(film, scenes);
    expect(tx.unsupported).toEqual([]);
    scenes[2]!.text = "cannot alter fixed draft";
    const live = structuredClone(film);
    live.shots[0]!.poster = "/tmp/later.png";
    live.scenes[0]!.coverage = {
      sceneId: shot.sceneId,
      ok: false,
      missingLines: ["new risk"],
      missingTail: null,
      lastLine: "",
    };
    const result = applyStoryStructureTransaction(live, tx);
    expect(result.conflicts).toEqual([]);
    expect(result.film.scenes[2]!.text).toBe("新场全部正文");
    expect(result.film.scenes[2]!.paragraphCoverage?.missingParagraphs).toEqual(["P103"]);
    expect(result.film.scenes[0]).toEqual(live.scenes[0]);
    expect(result.film.shots[0]!.poster).toBe("/tmp/later.png");
    const undone = undoStoryStructureTransaction(result.film, result.receipt!);
    expect(undone.conflicts).toEqual([]);
    expect(undone.film.scenes).toEqual(live.scenes);
    expect(undone.film.shots).toEqual(live.shots);
  });

  it("refuses writer replacement of scenes with manually edited shots or unresolved work and rejects changed source", () => {
    const { film } = setup();
    film.shots[0]!.userFields = ["picture"];
    const changed = film.scenes.map((scene, index) =>
      index ? scene : { ...scene, text: "重写正文" },
    );
    expect(prepareWriterTransaction(film, changed).unsupported).toContain(
      `DEPENDENT_WORK_EXISTS:${film.scenes[0]!.id}`,
    );
    const empty = { ...film, shots: [] };
    const tx = prepareWriterTransaction(empty, changed);
    const live = { ...empty, sourceText: "新导入原文" };
    expect(applyStoryStructureTransaction(live, tx).conflicts).toContain("SOURCE_CHANGED");
    const withBeats = {
      ...empty,
      unassignedBeats: [{ sceneId: film.scenes[0]!.id, text: "待核对" }],
    };
    expect(prepareWriterTransaction(withBeats, changed).unsupported).toContain(
      `DEPENDENT_WORK_EXISTS:${film.scenes[0]!.id}`,
    );
  });
});
