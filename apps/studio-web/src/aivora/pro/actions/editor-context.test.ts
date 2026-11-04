import { describe, expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { resolveEditorContext } from "./editor-context";

describe("editor selection context", () => {
  it("uses the chosen scene and shot rather than the first scene, and returns independent data", () => {
    const film = sampleFilm();
    const shot = film.shots.find((item) => item.sceneId !== film.scenes[0]!.id)!;
    const result = resolveEditorContext(film, {
      projectId: film.id,
      page: "board",
      shotId: shot.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.scene?.id).toBe(shot.sceneId);
    expect(result.context.shots.map((item) => item.id)).toEqual([shot.id]);
    result.context.shot!.picture = "changed request snapshot";
    expect(shot.picture).not.toBe("changed request snapshot");
  });
  it("never invents a selection or accepts stale project and scene identities", () => {
    const film = sampleFilm();
    expect(resolveEditorContext(film, { projectId: "other", page: "script" })).toEqual({
      ok: false,
      code: "PROJECT_MISMATCH",
    });
    expect(
      resolveEditorContext(film, { projectId: film.id, page: "board", shotId: "deleted" }),
    ).toEqual({ ok: false, code: "SHOT_NOT_FOUND" });
    const shot = film.shots[0]!;
    expect(
      resolveEditorContext(film, {
        projectId: film.id,
        page: "board",
        sceneId: "wrong",
        shotId: shot.id,
      }),
    ).toEqual({ ok: false, code: "SELECTION_MISMATCH" });
    const result = resolveEditorContext(film, { projectId: film.id, page: "script" });
    if (!result.ok) throw new Error(result.code);
    expect(result.context.scene).toBeNull();
    expect(result.context.shots).toEqual([]);
  });
});

it("projects only selected agent text and preserves the entire source and every dialogue line", async () => {
  const { editorAgentContext } = await import("./editor-context");
  const film = sampleFilm();
  const shot = film.shots[0]!;
  const scene = film.scenes.find((item) => item.id === shot.sceneId)!;
  scene.text = `${"完整原文。".repeat(2000)}最后一句不能丢。`;
  shot.lines = [
    { speaker: "林晚", text: "第一句。第二句。" },
    { speaker: "沈砚", text: "最后的对白。" },
  ];
  shot.line = shot.lines.map((line) => line.text).join("\n");
  shot.poster = "https://private.example/portrait.png";
  shot.stills = [
    { id: "secret-still", prompt: "internal-media-prompt", url: "/home/private/pictures/face.png" },
  ];
  film.directory = "C:\\Users\\private\\AIVORA";
  film.jobs = [
    {
      id: "secret-job",
      kind: "video",
      shotId: shot.id,
      take: 1,
      status: "queued",
      prompt: "internal-job-prompt",
      reason: "internal-log-detail",
    },
  ];
  const result = editorAgentContext(film, { projectId: film.id, page: "board", shotId: shot.id });
  if (!result.ok) throw new Error(result.code);
  expect(result.context.scene?.text).toBe(scene.text);
  expect(result.context.shots[0]?.lines).toEqual(shot.lines);
  expect(result.context.shots[0]?.line).toBe(shot.line);
  const request = JSON.stringify(result.context);
  for (const secret of [
    shot.poster,
    "private/pictures",
    "private\\\\AIVORA",
    "secret-still",
    "secret-job",
    "internal-media-prompt",
    "internal-job-prompt",
    "internal-log-detail",
  ])
    expect(request).not.toContain(secret);
  expect(result.context.shots[0]).not.toHaveProperty("takes");
  expect(result.context).not.toHaveProperty("jobs");
  expect(result.context).not.toHaveProperty("pipeline");
});

it.each(["script", "cast", "board", "edit"] as const)(
  "agent context on %s never substitutes an unselected first scene",
  async (page) => {
    const { editorAgentContext } = await import("./editor-context");
    const film = sampleFilm();
    const result = editorAgentContext(film, { projectId: film.id, page });
    if (!result.ok) throw new Error(result.code);
    expect(result.context.page).toBe(page);
    expect(result.context.scene).toBeNull();
    expect(result.context.selectedShotId).toBeNull();
    expect(result.context.shots).toEqual([]);
    expect(JSON.stringify(result.context)).not.toContain(film.scenes[0]!.text);
  },
);
