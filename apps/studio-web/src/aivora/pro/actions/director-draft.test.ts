import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { planDirectorDraft } from "./director-draft";
function setup() {
  const base = sampleFilm();
  const scene = base.scenes[0]!;
  scene.text = "风停了。";
  const shot = {
    ...base.shots[0]!,
    sceneId: scene.id,
    picture: scene.text,
    line: "",
    lines: [],
    action: "",
  };
  const request = vi.fn(async () => ({
    text: JSON.stringify({ shots: [{ picture: scene.text, seconds: 3 }] }),
    detail: "",
  }));
  const host = {
    connected: true,
    request,
    current: () => true,
    progress: vi.fn(),
    notify: vi.fn(),
    warnings: () => [],
    enrich: vi.fn(async () => [shot]),
  };
  return { base, scene, shot, host };
}
it("keeps offline drafting without a request or enrichment", async () => {
  const s = setup();
  const result = await planDirectorDraft(s.base, s.scene.id, "", { ...s.host, connected: false });
  expect(result).toMatchObject({
    status: "complete",
    event: "offline",
    notice: expect.stringContaining("没登录，先用软件自己的规则拆了镜头"),
  });
  expect(s.host.request).not.toHaveBeenCalled();
  expect(s.host.enrich).not.toHaveBeenCalled();
});
it("reuses request and enrichment then reports coverage without changing the project", async () => {
  const s = setup(),
    before = structuredClone(s.base);
  const result = await planDirectorDraft(s.base, s.scene.id, "补充要求", s.host);
  expect(s.host.request).toHaveBeenCalledOnce();
  expect(s.host.enrich).toHaveBeenCalledOnce();
  expect(JSON.stringify(s.host.request.mock.calls)).toContain("补充要求");
  expect(result).toMatchObject({
    status: "complete",
    event: "shots",
    shots: [s.shot],
    coverage: { ok: true },
  });
  expect(s.base).toEqual(before);
});
it("returns the existing retry proposal for malformed replies", async () => {
  const s = setup();
  s.host.request.mockResolvedValue({ text: "无镜头", detail: "没有结果" });
  expect(await planDirectorDraft(s.base, s.scene.id, "", s.host)).toMatchObject({
    status: "complete",
    shots: null,
    event: "rejected",
    retry: {
      role: "director",
      context: expect.stringContaining(s.scene.id),
      instruction: expect.stringContaining('"shots"'),
    },
    notice: "没有结果 没有写入镜头。",
  });
  expect(s.host.enrich).not.toHaveBeenCalled();
});
it("retains missing dialogue/tail evidence and deduplicates enrichment warnings", async () => {
  const s = setup();
  s.scene.text = "她说：“别走。”\n远处响起警笛。";
  const result = await planDirectorDraft(s.base, s.scene.id, "", {
    ...s.host,
    warnings: () => ["补全失败", "补全失败"],
  });
  expect(result).toMatchObject({
    status: "complete",
    coverage: {
      ok: false,
      missingLines: expect.arrayContaining(["别走。"]),
      missingTail: expect.any(String),
    },
    coverageNotice: { code: "COVERAGE_INCOMPLETE" },
  });
  if (result.status === "complete") expect(result.notice.match(/补全失败/g)).toHaveLength(1);
});
it("keeps all over-budget shots and reports the target", async () => {
  const s = setup();
  const shots = Array.from({ length: 30 }, (_, i) => ({ ...s.shot, id: `extra-${i}`, no: i + 1 }));
  s.host.enrich.mockResolvedValue(shots);
  const result = await planDirectorDraft(s.base, s.scene.id, "", s.host);
  expect(result).toMatchObject({
    status: "complete",
    shots,
    notice: expect.stringContaining("保留 30 镜"),
  });
});
it.each(["request", "enrich"] as const)(
  "does not publish after scope expires during %s",
  async (step) => {
    const s = setup();
    let valid = true;
    if (step === "request")
      s.host.request.mockImplementation(async () => {
        valid = false;
        return { text: '{"shots":[{"picture":"风停了。"}]}', detail: "" };
      });
    else
      s.host.enrich.mockImplementation(async () => {
        valid = false;
        return [s.shot];
      });
    expect(
      await planDirectorDraft(s.base, s.scene.id, "", { ...s.host, current: () => valid }),
    ).toEqual({ status: "stale" });
    if (step === "request") expect(s.host.enrich).not.toHaveBeenCalled();
  },
);
it("returns the same transport failure without manufacturing a retry or shots", async () => {
  const s = setup();
  s.host.request.mockRejectedValue(new Error("failed"));
  expect(await planDirectorDraft(s.base, s.scene.id, "", s.host)).toMatchObject({
    status: "complete",
    shots: null,
    retry: undefined,
    notice: "模型没有返回。没有写入镜头。",
  });
});
it("never falls back to the first scene for an unknown selection", async () => {
  const s = setup();
  expect(await planDirectorDraft(s.base, "missing", "", s.host)).toMatchObject({
    status: "complete",
    shots: null,
    notice: "先写好这一场，再请导演。",
  });
  expect(s.host.request).not.toHaveBeenCalled();
});
