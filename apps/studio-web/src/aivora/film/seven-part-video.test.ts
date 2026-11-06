import { expect, it } from "vitest";
import { sampleFilm, upgradeFilm, videoPrompt } from "./project";
import { compileSevenPartVideo, reviewedVideoText } from "./seven-part-video";
import { motionPrompt, storyFilmBatches } from "./operations";
import { generationVideoBody, rangeVideoBody } from "../pro/actions/video-prompt-review";
function fixture() {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  film.characters = [];
  film.props = [];
  film.locations = [];
  Object.assign(shot, {
    characters: [],
    line: "",
    lines: [],
    picture: "空街的雨水反光。",
    action: "雨水沿路面流动。",
    performance: "",
    seconds: 4,
    userFields: ["picture", "action"],
    directorPlan: undefined,
    actionPlan: undefined,
    performancePlan: undefined,
    selectedTakeId: "",
    takes: [],
  });
  film.shots = [shot];
  return { film, shot };
}
function review() {
  const env = fixture();
  env.shot.reviewedVideoPrompt = compileSevenPartVideo(env.film, env.shot).draft;
  return env;
}
it("compiles seven honest text sections and real request consumes the confirmed video field despite old picture locks", () => {
  const { film, shot } = review();
  expect(compileSevenPartVideo(film, shot).sections.map((s) => s.label)).toEqual([
    "风格",
    "镜头",
    "布局",
    "身份",
    "动作",
    "声音",
    "约束",
  ]);
  expect(compileSevenPartVideo(film, shot).sections[3]).toMatchObject({
    text: "待决定",
    undecided: true,
  });
  const prompt = storyFilmBatches(film, [shot], false)[0]!.shots![0]!.prompt;
  expect(prompt).toContain(shot.reviewedVideoPrompt!.text);
  expect(prompt).toContain(film.styleZh);
  expect(prompt).not.toContain(film.id);
  expect(prompt).not.toContain(shot.id);
  expect(prompt).not.toContain("待决定");
  expect(videoPrompt(shot, film)).toBe(shot.reviewedVideoPrompt!.text);
  expect(motionPrompt(shot, film)).toBe(shot.reviewedVideoPrompt!.text);
  expect(() => motionPrompt(shot)).toThrow(/作品上下文/);
  expect(() => videoPrompt(shot)).toThrow(/作品上下文/);
  expect(upgradeFilm(JSON.parse(JSON.stringify(film)))!.shots[0]!.reviewedVideoPrompt).toEqual(
    shot.reviewedVideoPrompt,
  );
});
it("only uses explicitly selected visible people; an empty list never expands to the library", () => {
  const { film, shot } = fixture();
  const person = {
    ...sampleFilm().characters[0]!,
    name: "甲",
    identity: "银色短发",
    userFields: [],
  };
  film.characters = [person, { ...person, id: "other-person", name: "乙", identity: "金色长发" }];
  shot.characters = ["甲"];
  shot.picture = "甲站在空街，乙不入画。";
  expect(compileSevenPartVideo(film, shot).draft.text).toContain("银色短发");
  expect(compileSevenPartVideo(film, shot).draft.text).not.toContain("金色长发");
  shot.characters = [];
  shot.picture = "空街的雨水反光。";
  expect(compileSevenPartVideo(film, shot).draft.text).not.toContain("银色短发");
});
it.each(["picture", "action", "seconds", "selectedTakeId"] as const)(
  "rejects a changed %s and never borrows the old binding",
  (field) => {
    const { film, shot } = review();
    Object.assign(shot, { [field]: field === "seconds" ? 5 : "later-change" });
    expect(() => storyFilmBatches(film, [shot], false)).toThrow(/重新整理/);
  },
);
it("rechecks complete cached body and ignores non-creative saves and incoming media", () => {
  const { film, shot } = review();
  film.savedAt = "later";
  film.directory = "/tmp/other";
  shot.poster = "/tmp/new-frame.png";
  shot.takes.push({
    id: "late",
    shotId: shot.id,
    index: 1,
    status: "done",
    videoPath: "/tmp/late.mp4",
    stillUrl: "",
    videoUrl: "",
    prompt: "",
    reason: "",
    createdAt: "",
  });
  expect(reviewedVideoText(film, shot)).toBe(shot.reviewedVideoPrompt!.text);
  shot.reviewedVideoPrompt!.text = "未经核对的替换内容";
  expect(() => reviewedVideoText(film, shot)).toThrow(/重新整理/);
});
it.each([0, 1.5, 16, NaN, Infinity])(
  "explains invalid request length %s without silently truncating",
  (seconds) => {
    const { film, shot } = fixture();
    shot.seconds = seconds;
    expect(compileSevenPartVideo(film, shot).issues.join()).toContain("整数时长");
  },
);
it("keeps story URLs/numbers and blocks known metadata/real credential forms without showing their contents", () => {
  const { film, shot } = fixture();
  shot.picture = "招牌写着https://example.test和编号2026。";
  expect(compileSevenPartVideo(film, shot).issues).toEqual([]);
  shot.picture = `内部 ${film.id} Bearer ${"a".repeat(30)}`;
  const result = compileSevenPartVideo(film, shot);
  expect(result.issues.join()).toContain("布局");
  expect(result.draft.text).toBe("");
  expect(JSON.stringify(result.sections)).not.toContain(film.id);
  expect(JSON.stringify(result.sections)).not.toContain("Bearer");
});
it("keeps full voice inputs outside the silent visual body; oversized final request refuses instead of clipping", () => {
  const { film, shot } = fixture();
  shot.line = "原句对白";
  shot.sound.ambience = "风声";
  const facts = compileSevenPartVideo(film, shot);
  expect(facts.sections[5]!.text).toContain("原句对白");
  expect(facts.sections[5]!.text).toContain("关闭原生声音");
  expect(facts.draft.text).not.toContain("原句对白");
  shot.line = "";
  shot.picture = "长画面".repeat(1000);
  shot.reviewedVideoPrompt = compileSevenPartVideo(film, shot).draft;
  expect(() => storyFilmBatches(film, [shot], false)).toThrow(/太长/);
});
it("only projects the actual queue's first automatic selection and retains the original stored review", () => {
  const { film, shot } = review();
  const original = structuredClone(shot);
  const take = {
    id: "first-new",
    shotId: shot.id,
    index: 1,
    status: "queued" as const,
    videoPath: "",
    videoUrl: "",
    stillUrl: "",
    prompt: "",
    reason: "",
    createdAt: "",
  };
  shot.takes = [take];
  shot.selectedTakeId = take.id;
  const saved = structuredClone(shot.reviewedVideoPrompt);
  expect(generationVideoBody(film, shot, original, take.id, false)!.shots![0]!.prompt).toContain(
    original.reviewedVideoPrompt!.text,
  );
  expect(shot.reviewedVideoPrompt).toEqual(saved);
  shot.selectedTakeId = "user-other";
  expect(() => generationVideoBody(film, shot, original, take.id, false)).toThrow(/重新整理/);
  shot.selectedTakeId = take.id;
  shot.picture = "后来修改";
  expect(() => generationVideoBody(film, shot, original, take.id, false)).toThrow(/重新整理/);
});
it("uses a distinct temporary range scope after verifying the whole-shot review and keeps the persisted whole body", () => {
  const { film, shot } = review();
  const saved = structuredClone(shot.reviewedVideoPrompt);
  const body = rangeVideoBody(film, shot, 2, false)!;
  expect(body.shots![0]!.duration_seconds).toBe(2);
  expect(body.shots![0]!.prompt).toContain("2 秒");
  expect(body.shots![0]!.prompt).not.toContain("4 秒");
  expect(shot.reviewedVideoPrompt).toEqual(saved);
  shot.picture = "后来修改";
  expect(() => rangeVideoBody(film, shot, 2, false)).toThrow(/重新整理/);
});

it("preserves real full dialogue/TTS fields without turning sound facts into native video audio", () => {
  const { film, shot } = fixture();
  film.narrationVoiceId = "eve";
  shot.line = "完整原句对白";
  shot.lines = [{ speaker: "", text: "完整原句对白" }];
  shot.sound.ambience = "雨声";
  shot.sound.musicMood = "缓慢低音";
  shot.reviewedVideoPrompt = compileSevenPartVideo(film, shot).draft;
  const request = storyFilmBatches(film, [shot], false)[0]!.shots![0]!;
  expect(request.lines).toEqual([{ speaker: "", text: "完整原句对白", voice_id: "eve" }]);
  expect(request.narration).toBe("完整原句对白");
  expect(request.prompt).not.toContain("完整原句对白");
  expect(request.prompt).not.toContain("缓慢低音");
  expect(shot.lines).toEqual([{ speaker: "", text: "完整原句对白" }]);
});
it("marks missing camera facts as undecided, preserves technical-story text and binds source/voice edits", () => {
  const { film, shot } = fixture();
  shot.move = "";
  shot.angle = "";
  shot.picture = "工程师在屏幕上写下 /tmp/example.log 与 https://example.test。";
  const facts = compileSevenPartVideo(film, shot);
  expect(facts.sections[1]!.text).toContain("运镜：待决定");
  expect(facts.sections[1]!.text).toContain("角度：待决定");
  expect(facts.draft.text).not.toContain("待决定");
  expect(facts.issues).toEqual([]);
  shot.reviewedVideoPrompt = facts.draft;
  film.sourceText = "后来修改的输入";
  expect(() => reviewedVideoText(film, shot)).toThrow(/重新整理/);
});

it("keeps archived creative text untrusted until the imported work organizes its own facts", () => {
  const { film, shot } = review();
  const text = shot.reviewedVideoPrompt!.text;
  film.id = "film_importedreview0001";
  shot.reviewedVideoPrompt = { schemaVersion: 1, text, factsKey: "" };
  expect(() => storyFilmBatches(film, [shot], false)).toThrow(/重新整理/);
  expect(shot.reviewedVideoPrompt.text).toBe(text);
  shot.reviewedVideoPrompt = compileSevenPartVideo(film, shot).draft;
  expect(storyFilmBatches(film, [shot], false)[0]!.shots![0]!.prompt).toContain(text);
});

it("ignores an empty derived location placeholder/image arrival but rejects a changed actual location description", () => {
  const { film, shot } = review();
  const scene = film.scenes.find((scene) => scene.id === shot.sceneId)!;
  film.locations = [
    {
      id: "new-location",
      sceneId: scene.id,
      name: scene.where,
      prompt: "",
      ambience: "",
      referenceImage: "/media/new-location.png",
    },
  ];
  expect(reviewedVideoText(film, shot)).toBe(shot.reviewedVideoPrompt!.text);
  film.locations[0]!.layout = "左侧是入口，右侧是窗口。";
  expect(() => reviewedVideoText(film, shot)).toThrow(/重新整理/);
});

it("rejects an exact known private media URL without banning unrelated URLs in the story", () => {
  const { film, shot } = fixture();
  shot.poster = "https://private.example/media?token=synthetic-private-token";
  shot.picture = "画面说明误带素材地址：" + shot.poster;
  const rejected = compileSevenPartVideo(film, shot);
  expect(rejected.issues).not.toHaveLength(0);
  expect(rejected.draft.text).toBe("");
  expect(JSON.stringify(rejected.sections)).not.toContain("synthetic-private-token");
  shot.picture = "招牌上写着 https://example.test。";
  expect(compileSevenPartVideo(film, shot).issues).toEqual([]);
});
