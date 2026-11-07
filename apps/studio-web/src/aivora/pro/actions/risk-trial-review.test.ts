import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { detectDirectorCoverage } from "../../film/director-continuity";
import { buildTrialReview } from "./risk-trial-review";
function fixture() {
  const film = sampleFilm();
  film.scenes = film.scenes.slice(0, 2);
  film.scenes[0]!.text = "甲说：“你好。”\n乙说：“再见。”\n甲推开门。";
  film.shots = [2, 1, 3].map((no, i) => ({
    ...structuredClone(film.shots[0]!),
    id: `risk-${i}`,
    no,
    sceneId: film.scenes[i === 2 ? 1 : 0]!.id,
    line: "",
    lines: [],
    speaker: "",
    takes: [],
    selectedTakeId: "",
    continuity: [],
    picture: "当前画面文字",
  }));
  film.shots[1]!.lines = [
    { speaker: "甲", text: "你好。" },
    { speaker: "乙", text: "再见。" },
  ];
  film.unassignedBeats = [{ sceneId: film.scenes[0]!.id, text: "未归属的转身" }];
  return film;
}
it("uses actual ordered scene representatives, shotLines and scene-only coverage/unassigned reasons without inventing where the gap occurs", () => {
  const film = fixture(),
    before = structuredClone(film),
    review = buildTrialReview(film);
  expect(review.candidates[0]!.id).toBe("risk-1");
  const rep = review.candidates[0]!;
  expect(rep.reasons.map((r) => r.code)).toEqual(
    expect.arrayContaining([
      "SCENE_FIRST",
      "DIALOGUE_FIRST",
      "MULTI_SPEAKER",
      "SCENE_COVERAGE",
      "SCENE_UNASSIGNED",
    ]),
  );
  expect(rep.reasons.find((r) => r.code === "SCENE_FIRST")!.text).toContain("不代表覆盖全部风险");
  expect(rep.reasons.find((r) => r.code === "SCENE_COVERAGE")!.text).toContain("场级线索");
  const actual = detectDirectorCoverage(film.scenes[0]!, film.shots);
  expect(rep.sceneMissingLines).toEqual(actual.missingLines);
  expect(rep.sceneMissingTail).toBe(actual.missingTail);
  expect(rep.dialogue).toEqual(["甲：你好。", "乙：再见。"]);
  expect(film).toEqual(before);
});
it("only reports selected-version record status and never exposes paths/IDs as user-facing facts", () => {
  const film = fixture(),
    shot = film.shots[1]!;
  shot.takes = [
    {
      id: "private-take",
      shotId: shot.id,
      index: 2,
      status: "done",
      videoPath: "/private/not-inspected.mp4",
      videoUrl: "",
      stillUrl: "",
      createdAt: "",
      prompt: "",
      reason: "",
    },
  ];
  shot.selectedTakeId = "private-take";
  const row = buildTrialReview(film).candidates.find((c) => c.id === shot.id)!;
  expect(row.version).toBe("第 2 版 · 完成记录（文件与内容未核验）");
  expect(row.version).not.toMatch(/private|\.mp4|已播放/);
  shot.takes[0]!.status = "running";
  expect(buildTrialReview(film).candidates.find((c) => c.id === shot.id)!.version).toContain(
    "处理中记录",
  );
});
it("keeps save metadata and unrelated project titles out of the key but invalidates actual source, selected-version and record changes", () => {
  const film = fixture(),
    key = buildTrialReview(film).key;
  expect(
    buildTrialReview({ ...film, title: "无关新标题", savedAt: "later", directory: "/other" }).key,
  ).toBe(key);
  for (const change of [
    (f: typeof film) => {
      f.shots[0]!.picture = "新画面";
    },
    (f: typeof film) => {
      f.scenes[0]!.text = "改了本场原文";
    },
    (f: typeof film) => {
      f.shots[0]!.performance = "变了结尾表演文字";
    },
    (f: typeof film) => {
      f.shots[0]!.sound = { ...f.shots[0]!.sound, ambience: "改变环境声音文字" };
    },
    (f: typeof film) => {
      f.shots[1]!.selectedTakeId = "另一版";
    },
    (f: typeof film) => {
      f.shots[0]!.continuity = [{ kind: "missing_look", text: "待核对" }];
    },
  ]) {
    const next = structuredClone(film);
    change(next);
    expect(buildTrialReview(next).key).not.toBe(key);
  }
});
it("omits ambiguous identities or missing scenes explicitly rather than guessing a navigation target", () => {
  const film = fixture();
  film.shots[0]!.id = film.shots[1]!.id;
  film.shots[2]!.sceneId = "unknown";
  const review = buildTrialReview(film);
  expect(review.omitted).toBe(3);
  expect(review.candidates).toEqual([]);
  expect(review.notices.join(" ")).toContain("3 个镜头");
});
it("leaves an empty project honestly empty", () => {
  const film = fixture();
  film.shots = [];
  expect(buildTrialReview(film).candidates).toEqual([]);
});
it("does not borrow an export or pipeline fallback when the explicit selection is empty, invalid or duplicated", () => {
  const film = fixture(),
    shot = film.shots[1]!;
  shot.takes = [
    {
      id: "private-first",
      shotId: shot.id,
      index: 1,
      status: "done",
      videoPath: "/private/video.mp4",
      videoUrl: "",
      stillUrl: "",
      createdAt: "",
      prompt: "",
      reason: "",
    },
  ];
  const label = () => buildTrialReview(film).candidates.find((c) => c.id === shot.id)!.version;
  expect(label()).toContain("显式选版字段为空");
  expect(label()).not.toContain("第 1 版");
  shot.selectedTakeId = "missing-record";
  expect(label()).toContain("未对应到现有记录");
  shot.selectedTakeId = "private-first";
  shot.takes.push({ ...shot.takes[0]! });
  expect(label()).toContain("不唯一");
  shot.takes.pop();
  shot.takes[0]!.videoPath = "";
  expect(label()).toBe("第 1 版 · 完成记录（文件与内容未核验）");
});

it("does not relabel a later unique shot as the scene's first shot when the actual first identity is ambiguous", () => {
  const film = fixture();
  film.shots[1]!.id = film.shots[0]!.id;
  film.shots[2]!.sceneId = film.scenes[0]!.id;
  const review = buildTrialReview(film);
  expect(review.omitted).toBe(2);
  expect(review.candidates).toEqual([]);
});
