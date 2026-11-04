import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { planActionDraft, type ActionDraftHost } from "./action";

it("uses explicit shot IDs within the one-shot manual scope and preserves unassigned beats", async () => {
  const film = sampleFilm();
  const current = film.shots[0]!;
  current.picture = "沈砚打斗闪避。";
  current.action = "";
  current.userFields = ["picture", "line"];
  film.scenes.find((scene) => scene.id === current.sceneId)!.text = "铁棍挥来。";
  const snapshot = structuredClone(film);
  const request = vi.fn<ActionDraftHost["request"]>().mockResolvedValue({
    text: JSON.stringify({
      beats: [
        { shot_id: film.shots[1]!.id, text: "别镜挥铁棍", at_seconds: 0 },
        { shot_id: current.id, text: "保留原文：肘击", at_seconds: 1 },
      ],
    }),
    detail: "",
  });
  const result = await planActionDraft(film, current, {
    request,
    current: () => true,
    connected: true,
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected action draft");
  expect(request.mock.calls[0]![1]).toContain(`当前镜头 id：${current.id}`);
  expect(request.mock.calls[0]![1]).toContain("动作约束：");
  expect(result.shot.action).toBe("肘击");
  expect(result.shot.action).not.toMatch(/保留原文|动作约束|别镜/);
  expect(result.unassigned).toEqual([{ sceneId: current.sceneId, text: "别镜挥铁棍" }]);
  expect(result.shot.sound.sfx).toEqual([{ atSeconds: 1, text: "肘击" }]);
  expect(result.notes.join(" ")).not.toMatch(/保留原文|动作约束|别镜/);
  expect(result.shot.userFields).toEqual(["picture", "line"]);
  expect(film).toEqual(snapshot);
});

it("does not place combat into a dialogue shot even when the model names its ID", async () => {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  shot.picture = "林晚在书店说话。";
  shot.action = "";
  const result = await planActionDraft(film, shot, {
    request: async () => ({
      text: JSON.stringify({ beats: [{ shot_id: shot.id, text: "保留原文：挥铁棍" }] }),
      detail: "",
    }),
    current: () => true,
    connected: true,
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.shot.action).toBe("");
    expect(result.shot.sound.sfx).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.unassigned).toEqual([{ sceneId: shot.sceneId, text: "挥铁棍" }]);
    expect(result.notice).toBe("有动作没对上镜头，去分镜看看。");
    expect(result.notice).not.toMatch(/\b[A-Z]{3,}(?:_[A-Z0-9]+)+\b/);
  }
});

it("does not assign an id-less beat by reply order", async () => {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  const result = await planActionDraft(film, shot, {
    request: async () => ({ text: '{"beats":[{"text":"抬手"}]}', detail: "" }),
    current: () => true,
    connected: true,
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.shot.action).toBe(shot.action);
    expect(result.unassigned).toEqual([{ sceneId: shot.sceneId, text: "抬手" }]);
  }
});

it("retries malformed connected replies once and preserves rejection without a draft", async () => {
  const film = sampleFilm();
  const request = vi
    .fn<ActionDraftHost["request"]>()
    .mockResolvedValueOnce({ text: "bad", detail: "first" })
    .mockResolvedValueOnce({ text: null, detail: "second" });
  expect(
    await planActionDraft(film, film.shots[0], { request, current: () => true, connected: true }),
  ).toEqual({ status: "rejected", notice: "second 没有写入。", logRejection: false });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]![2]).toContain("只输出 JSON，不要解释。");
});

it("stops before retry when the turn becomes stale", async () => {
  const film = sampleFilm();
  const request = vi
    .fn<ActionDraftHost["request"]>()
    .mockResolvedValue({ text: "bad", detail: "" });
  expect(
    await planActionDraft(film, film.shots[0], { request, current: () => false, connected: true }),
  ).toEqual({ status: "stale" });
  expect(request).toHaveBeenCalledOnce();
});

it("retains offline behavior and does not manufacture an unassigned update", async () => {
  const film = sampleFilm();
  const request = vi
    .fn<ActionDraftHost["request"]>()
    .mockResolvedValue({ text: null, detail: "offline" });
  const result = await planActionDraft(film, film.shots[0], {
    request,
    current: () => true,
    connected: false,
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") {
    expect(result.event).toBe("offline");
    expect(result.unassigned).toBeUndefined();
  }
  expect(request).toHaveBeenCalledOnce();
});
