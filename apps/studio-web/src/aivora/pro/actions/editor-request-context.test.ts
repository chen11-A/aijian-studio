import { describe, expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { globalEditorRequest } from "./editor-request-context";
import { writerDraftInput, planWriterDraft } from "./writer";
import { planArtDraft } from "./art";
import type { EditorSelection } from "./editor-context";

const reply = { text: null, detail: "test provider" };
describe("global writer/art selected request supplement", () => {
  it("keeps the complete writer manuscript and exact instruction while selecting a later shot", async () => {
    const film = sampleFilm();
    const shot = film.shots.find((row) => row.sceneId !== film.scenes[0]!.id)!;
    const request = vi.fn().mockResolvedValue(reply);
    const wrapped = globalEditorRequest(
      film,
      { projectId: film.id, page: "board", shotId: shot.id },
      request,
    );
    if (!wrapped.ok) throw new Error(wrapped.code);
    const input = writerDraftInput(film, "write", "保留原意");
    await planWriterDraft(input, { connected: true, request: wrapped.request });
    const [role, context, instruction] = request.mock.calls[0]!;
    expect(role).toBe("writer");
    for (const scene of film.scenes)
      for (const line of scene.text.split("\n").filter(Boolean)) expect(context).toContain(line);
    expect(context).toContain(`"selectedShotId":"${shot.id}"`);
    expect(context).toContain('"taskScope":"project"');
    expect(context).toContain("不得因选中场景或镜头而省略其他原文、人物、场景");
    expect(instruction).toBe("写成短剧，按地点和时间分场，保留全部台词与结尾。保留原意");
  });
  it("does not append the selected scene manuscript twice to writer input", async () => {
    const film = sampleFilm();
    const scene = film.scenes[0]!;
    scene.text = "独一无二的完整长文段落。".repeat(1000) + "只出现一次的最后一句。";
    const request = vi.fn().mockResolvedValue(reply);
    const wrapped = globalEditorRequest(
      film,
      { projectId: film.id, page: "script", sceneId: scene.id },
      request,
    );
    if (!wrapped.ok) throw new Error(wrapped.code);
    await planWriterDraft(writerDraftInput(film, "write", ""), {
      connected: true,
      request: wrapped.request,
    });
    expect(request.mock.calls[0]![1].split(scene.text)).toHaveLength(2);
    expect(request.mock.calls[0]![1]).toContain(`"id":"${scene.id}"`);
    await wrapped.request("art", "all people", "instruction");
    expect(request.mock.calls[1]![1]).toContain(JSON.stringify(scene.text));
  });
  it("keeps all art characters, even those outside the selected scene", async () => {
    const film = sampleFilm();
    film.characters.push({ ...film.characters[0]!, id: "outside", name: "其他场人物" });
    const request = vi.fn().mockResolvedValue(reply);
    const wrapped = globalEditorRequest(
      film,
      { projectId: film.id, page: "cast", sceneId: film.scenes[0]!.id },
      request,
    );
    if (!wrapped.ok) throw new Error(wrapped.code);
    await planArtDraft(film, { request: wrapped.request, current: () => true });
    expect(
      request.mock.calls[0]![1].startsWith(
        `画风：${film.styleZh}\n人物：${film.characters.map((p) => p.name).join("、")}`,
      ),
    ).toBe(true);
    expect(request.mock.calls[0]![2]).toBe("写出画风、每人一句固定外貌、场景和道具。只输出 JSON。");
  });
  it("captures once, preserves original context bytes and never adds media fields", async () => {
    const film = sampleFilm();
    const shot = film.shots[0]!;
    shot.poster = "https://private.example/poster.png";
    film.characters[0]!.portraits = [
      { view: "正面", prompt: "secret prompt", url: "aivora-media://private-face" },
    ];
    film.directory = "/private/project";
    const selection: EditorSelection = { projectId: film.id, page: "board", shotId: shot.id };
    const request = vi.fn().mockResolvedValue(reply);
    const wrapped = globalEditorRequest(film, selection, request);
    if (!wrapped.ok) throw new Error(wrapped.code);
    const before = shot.picture;
    shot.picture = "later edit";
    selection.shotId = "deleted";
    const context = "  原始全项目输入\n最后一段\n";
    await wrapped.request("writer", context, "instruction");
    await wrapped.request("writer", context, "instruction");
    const first = request.mock.calls[0]![1];
    expect(first.slice(0, context.length)).toBe(context);
    expect(first).toBe(request.mock.calls[1]![1]);
    expect(first).toContain(before);
    for (const secret of [
      "later edit",
      "deleted",
      "private.example",
      "private-face",
      "secret prompt",
      "/private/project",
      "portraits",
      "poster",
      "takes",
    ])
      expect(first).not.toContain(secret);
  });
  it("does not guess a selection when none exists", async () => {
    const film = sampleFilm();
    const request = vi.fn().mockResolvedValue(reply);
    const wrapped = globalEditorRequest(film, { projectId: film.id, page: "script" }, request);
    if (!wrapped.ok) throw new Error(wrapped.code);
    await wrapped.request("writer", "global", "instruction");
    expect(request.mock.calls[0]![1]).toContain('"scene":null,"selectedShotId":null,"shots":[]');
    expect(request.mock.calls[0]![1]).not.toContain(film.scenes[0]!.text);
  });
  it.each(["PROJECT_MISMATCH", "SCENE_NOT_FOUND", "SHOT_NOT_FOUND", "SELECTION_MISMATCH"] as const)(
    "exposes invalid selection %s without provider request",
    (code) => {
      const film = sampleFilm();
      const request = vi.fn();
      const selection: EditorSelection = { projectId: film.id, page: "board" };
      if (code === "PROJECT_MISMATCH") selection.projectId = "other";
      if (code === "SCENE_NOT_FOUND") selection.sceneId = "missing";
      if (code === "SHOT_NOT_FOUND") selection.shotId = "missing";
      if (code === "SELECTION_MISMATCH") {
        selection.shotId = film.shots[0]!.id;
        selection.sceneId = "other";
      }
      expect(globalEditorRequest(film, selection, request)).toEqual({ ok: false, code });
      expect(request).not.toHaveBeenCalled();
    },
  );
});
