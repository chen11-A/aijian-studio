import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { reviewShotText } from "./text-review";

function setup() {
  const base = sampleFilm();
  const shot = base.shots[0]!;
  const request = vi.fn(async () => ({
    text: JSON.stringify({ verdict: "可用", issues: ["只审文字"] }),
    detail: "",
  }));
  return {
    base,
    shot,
    request,
    host: { request, valid: () => true, current: () => base, apply: vi.fn() },
  };
}
it("sends only selected text and version identities, and preserves text-only evidence", async () => {
  const { base, shot, host, request } = setup();
  shot.poster = "/private/portrait.png";
  const result = await reviewShotText(base, shot, host);
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]).toEqual([
    "qc",
    JSON.stringify({
      shot_id: shot.id,
      picture: shot.picture,
      takes: shot.takes.map((take) => ({ take_id: take.id, status: take.status })),
    }),
    expect.stringContaining("seen_frames 必须为 false"),
  ]);
  expect(JSON.stringify(request.mock.calls)).not.toContain("/private/");
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("expected ready");
  expect(result.film.reviewReports?.at(-1)).toMatchObject({
    evidence: "text-only",
    visualVerified: false,
  });
  expect(host.apply).toHaveBeenCalledExactlyOnceWith(result.film);
  expect(result.film.shots).toEqual(base.shots);
  expect(base.reviewReports).toBeUndefined();
});
it("does not request without a selected shot", async () => {
  const s = setup();
  expect(await reviewShotText(s.base, undefined, s.host)).toMatchObject({ status: "rejected" });
  expect(s.request).not.toHaveBeenCalled();
});
it("discards an expired turn before parsing or applying", async () => {
  const s = setup();
  const current = vi.fn(() => s.base);
  expect(await reviewShotText(s.base, s.shot, { ...s.host, valid: () => false, current })).toEqual({
    status: "stale",
  });
  expect(current).not.toHaveBeenCalled();
});
it.each(["shot", "project"])(
  "retains live edits when %s changes during the request",
  async (change) => {
    const s = setup();
    const live = structuredClone(s.base);
    if (change === "shot") live.shots[0]!.picture = "手改画面";
    else live.id = "other-project";
    expect(await reviewShotText(s.base, s.shot, { ...s.host, current: () => live })).toEqual({
      status: "blocked",
    });
    expect(live.reviewReports).toBeUndefined();
    expect(s.host.apply).not.toHaveBeenCalled();
  },
);
it("retains unrelated live changes instead of returning the request snapshot", async () => {
  const s = setup();
  const live = { ...s.base, title: "新标题" };
  const result = await reviewShotText(s.base, s.shot, { ...s.host, current: () => live });
  expect(result.status).toBe("ready");
  if (result.status === "ready") expect(result.film.title).toBe("新标题");
});
it("preserves malformed-reply failure and transport exceptions", async () => {
  const s = setup();
  s.request.mockResolvedValueOnce({ text: "", detail: "请求失败" });
  expect(await reviewShotText(s.base, s.shot, s.host)).toMatchObject({
    status: "rejected",
    notice: expect.stringContaining("请求失败"),
  });
  s.request.mockRejectedValueOnce(new Error("network"));
  await expect(reviewShotText(s.base, s.shot, s.host)).rejects.toThrow("network");
});
