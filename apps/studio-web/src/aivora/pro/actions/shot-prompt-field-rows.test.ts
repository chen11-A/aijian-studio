import { describe, expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { diffEditorSuggestion, type EditorSuggestion } from "./editor-changes";
import { projectShotPromptFields } from "./shot-prompt-field-rows";

function fixture() {
  const before = sampleFilm();
  const shot = before.shots[0]!;
  shot.promptZh = "雨夜，店员站在窗边。";
  shot.promptEn = "";
  const after = structuredClone(before);
  after.shots[0]!.promptZh = "店员看着窗外，雨水划过玻璃。";
  after.shots[0]!.promptEn = "The clerk watches rain through the window.";
  const origin = {
    projectId: before.id,
    page: "board" as const,
    sceneId: shot.sceneId,
    shotId: shot.id,
  };
  return { before, after, origin, diff: diffEditorSuggestion(before, after, origin) };
}

describe("4A-U11 stored single-shot prompt field projection", () => {
  it("projects exact request before/after in a fixed field order without IDs or mutable film reads", () => {
    const f = fixture();
    f.diff.changes.reverse();
    const rows = projectShotPromptFields(f.diff, f.origin);
    expect(rows).toEqual([
      {
        key: "prompt-zh",
        label: "中文画面说明",
        kind: "changed",
        before: "雨夜，店员站在窗边。",
        after: "店员看着窗外，雨水划过玻璃。",
      },
      {
        key: "prompt-en",
        label: "英文画面说明",
        kind: "changed",
        before: "",
        after: "The clerk watches rain through the window.",
      },
    ]);
    f.before.shots[0]!.promptZh = "后来改的现场内容";
    expect(projectShotPromptFields(f.diff, f.origin)).toEqual(rows);
    expect(JSON.stringify(rows)).not.toContain(f.origin.shotId);
  });

  it("preserves absent versus present empty text without coercing values", () => {
    const f = fixture();
    const diff = structuredClone(f.diff);
    diff.changes[0]!.before = { present: false, value: undefined };
    diff.changes[0]!.after = { present: true, value: "" };
    diff.changes[1]!.after = { present: false, value: undefined };
    expect(projectShotPromptFields(diff, f.origin)).toMatchObject([
      { kind: "added", before: null, after: "" },
      { kind: "removed", before: "", after: null },
    ]);
    expect(projectShotPromptFields({ ...f.diff, changes: [] }, f.origin)).toEqual([]);
  });

  it.each([
    "unsupported",
    "project",
    "shot",
    "scene",
    "page",
    "field",
    "target",
    "duplicate",
    "object",
  ])("rejects %s as a whole rather than presenting a partial diff", (kind) => {
    const f = fixture();
    const diff = structuredClone(f.diff);
    if (kind === "unsupported") diff.unsupported = ["STRUCTURE_CHANGED"];
    if (kind === "project") diff.selection.projectId += "other";
    if (kind === "shot") diff.selection.shotId += "other";
    if (kind === "scene") diff.selection.sceneId += "other";
    if (kind === "page") diff.selection.page = "cast";
    if (kind === "field") diff.changes[1]!.field = "picture";
    if (kind === "target") diff.changes[1]!.target = { collection: "project" };
    if (kind === "duplicate") diff.changes.push(structuredClone(diff.changes[0]!));
    if (kind === "object") diff.changes[1]!.after.value = { secret: "hidden" };
    expect(projectShotPromptFields(diff, f.origin)).toBeNull();
  });

  it("does not expose the actual selected shot identifier embedded in prompt prose", () => {
    const f = fixture();
    f.diff.changes[0]!.after.value = `参考内部镜头 ${f.origin.shotId} 的结果`;
    expect(projectShotPromptFields(f.diff, f.origin)).toBeNull();
  });

  it.each([
    "/private/work/shot.mp4",
    "C:\\private\\shot.mp4",
    "https://private.example/image.png",
    "aivora-media://local/?path=hidden",
    "Bearer private-token",
    "api_key=private-value",
    '{"videoPath":"hidden"}',
    "shot_123456789",
    "bad\u0000text",
  ])("does not expose sensitive/structured text %s", (value) => {
    const f = fixture();
    const diff: EditorSuggestion = structuredClone(f.diff);
    diff.changes[1]!.after.value = value;
    expect(projectShotPromptFields(diff, f.origin)).toBeNull();
  });
});
