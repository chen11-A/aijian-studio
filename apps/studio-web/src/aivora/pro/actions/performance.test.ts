import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { planPerformanceDraft, type PerformanceDraftHost } from "./performance";

it("prepares only the current shot's performance and voice direction, retaining other hand edits", async () => {
  const film = sampleFilm();
  const shot = {
    ...film.shots[0]!,
    characters: ["林晚", "沈砚"],
    userFields: ["picture", "performance", "line"],
    delivery: "旧语气",
  };
  const before = structuredClone(shot);
  const request = vi.fn<PerformanceDraftHost["request"]>().mockResolvedValue({
    text: JSON.stringify([
      { emotion: "冷静", face: ["皱眉"], voice: { tone: "压低", pace: "慢" } },
    ]),
    detail: "",
  });
  const result = await planPerformanceDraft(shot, {
    request,
    current: () => true,
    connected: true,
  });
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "performance",
    expect.stringContaining(`镜头 id：${shot.id}`),
    expect.stringContaining("who 写人物名字"),
  );
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected performance draft");
  expect(result.line).toContain("视线");
  expect(result.line).toContain("皱眉");
  expect(result.shot.delivery).toContain("语速慢");
  expect(result.shot.picture).toBe(shot.picture);
  expect(result.shot.line).toBe(shot.line);
  expect(result.shot.userFields).toEqual(["picture", "line"]);
  expect(result.shot.id).toBe(shot.id);
  expect(shot).toEqual(before);
});

it("retains an existing delivery when the reply has no voice direction", async () => {
  const shot = { ...sampleFilm().shots[0]!, delivery: "用户原语气" };
  const result = await planPerformanceDraft(shot, {
    request: async () => ({ text: '[{"face":["抬眉"]}]', detail: "" }),
    current: () => true,
    connected: true,
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") expect(result.shot.delivery).toBe("用户原语气");
});

it("retries exactly once while connected and rejects a second malformed reply", async () => {
  const request = vi
    .fn<PerformanceDraftHost["request"]>()
    .mockResolvedValue({ text: "bad", detail: "没有返回格式" });
  expect(
    await planPerformanceDraft(sampleFilm().shots[0]!, {
      request,
      current: () => true,
      connected: true,
    }),
  ).toEqual({ status: "rejected", notice: "没有返回格式 没有写入。" });
  expect(request).toHaveBeenCalledTimes(2);
});

it("discards a reply that becomes stale during the retry", async () => {
  let current = true;
  const request = vi
    .fn<PerformanceDraftHost["request"]>()
    .mockResolvedValueOnce({ text: "bad", detail: "" })
    .mockImplementationOnce(async () => {
      current = false;
      return { text: '[{"face":["抬眉"]}]', detail: "" };
    });
  expect(
    await planPerformanceDraft(sampleFilm().shots[0]!, {
      request,
      current: () => current,
      connected: true,
    }),
  ).toEqual({ status: "stale" });
  expect(request).toHaveBeenCalledTimes(2);
});

it("keeps offline suggestions and propagates transport errors to the foreground boundary", async () => {
  const shot = sampleFilm().shots[0]!;
  const request = vi
    .fn<PerformanceDraftHost["request"]>()
    .mockResolvedValue({ text: null, detail: "offline" });
  const result = await planPerformanceDraft(shot, {
    request,
    current: () => true,
    connected: false,
  });
  expect(result.status).toBe("ready");
  if (result.status === "ready") expect(result.event).toBe("offline");
  expect(request).toHaveBeenCalledOnce();
  const error = new Error("transport failed");
  request.mockRejectedValueOnce(error);
  await expect(
    planPerformanceDraft(shot, { request, current: () => true, connected: true }),
  ).rejects.toBe(error);
});
