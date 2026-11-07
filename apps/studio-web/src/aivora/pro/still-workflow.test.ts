import { generationExecutionFixture } from "./generation-execution.test-fixture";
import { createGenerationExecutionSession } from "./actions/generation-execution";
import { historyRecordHash } from "./actions/persistent-history";
import type * as WorkflowModule from "./workflow";
import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { taskSnapshot } from "../film/task-progress";
import { requestShotStill, stillFailureNotice } from "./workflow";
import { ensureShotFrame, makeFourStills } from "./still-workflow";
vi.mock("./workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof WorkflowModule>()),
  requestShotStill: vi.fn(),
}));
const diagnostics = { referenceCount: 0, imageLimit: 5, videoReferenceLimit: 13 };

async function preframeExecution(base: ReturnType<typeof sampleFilm>) {
  const bridge = generationExecutionFixture(async () => structuredClone(base));
  const execution = createGenerationExecutionSession(bridge, () => true);
  await execution.prepare({
    projectId: base.id,
    expectedProjectHash: await historyRecordHash(base),
    mode: "video",
    targets: [{ shotId: base.shots[0]!.id, versions: 1 }],
  });
  return execution;
}

it("queues candidates immediately and discards a delayed image after project switch", async () => {
  const base = sampleFilm();
  let current = base;
  const shot = base.shots[0]!;
  let resolve!: (result: Awaited<ReturnType<typeof requestShotStill>>) => void;
  vi.mocked(requestShotStill).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const apply = vi.fn();
  const pending = makeFourStills(base, shot, {
    current: () => current,
    valid: () => current.id === base.id,
    apply,
  });
  expect(
    taskSnapshot().tasks.some(
      (task) => task.id === `candidate:${shot.id}:0` && task.status === "queued",
    ),
  ).toBe(true);
  await Promise.resolve();
  current = { ...base, id: "new-project" };
  resolve({ url: "late.png", reason: "", diagnostics });
  const result = await pending;
  expect(apply).not.toHaveBeenCalled();
  expect(result).toMatchObject({ done: 0, cancelled: true });
});

it("keeps successful candidates when another fails and reports partial completion", async () => {
  const base = sampleFilm();
  let current = base;
  const shot = base.shots[0]!;
  const count = shot.stills.length;
  vi.mocked(requestShotStill)
    .mockReset()
    .mockResolvedValueOnce({ url: "", reason: "supplier denied", diagnostics })
    .mockResolvedValue({ url: "candidate.png", reason: "", diagnostics });
  const result = await makeFourStills(base, shot, {
    current: () => current,
    valid: () => true,
    apply: (next) => {
      current = next;
    },
  });
  expect(result).toMatchObject({ done: 3, failed: 1, cancelled: false });
  expect(current.shots[0]!.stills).toHaveLength(count + 3);
});

it("preserves a user-selected HTTPS frame without an image request", async () => {
  const base = sampleFilm();
  const shot = { ...base.shots[0]!, poster: "https://example.com/user-frame.png" };
  vi.mocked(requestShotStill).mockClear();
  const result = await ensureShotFrame(base, shot, {
    current: () => base,
    valid: () => true,
    apply: vi.fn(),
  });
  expect(result).toBe(shot);
  expect(requestShotStill).not.toHaveBeenCalled();
});

it("publishes a video preframe as an image task and protects a late response", async () => {
  const base = sampleFilm();
  const shot = { ...base.shots[0]!, poster: "", stills: [] };
  let valid = true;
  let resolve!: (result: Awaited<ReturnType<typeof requestShotStill>>) => void;
  vi.mocked(requestShotStill).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const apply = vi.fn();
  const execution = await preframeExecution(base);
  const pending = ensureShotFrame(base, shot, {
    current: () => base,
    valid: () => valid,
    apply,
    execution,
  });
  expect(
    taskSnapshot().tasks.some(
      (task) =>
        task.id === `preframe:${shot.id}` && task.status === "queued" && task.kind === "image",
    ),
  ).toBe(true);
  await Promise.resolve();
  expect(requestShotStill).toHaveBeenLastCalledWith(
    base,
    shot,
    expect.any(String),
    execution.image("shot-frame", shot.id),
  );

  valid = false;
  resolve({ url: "late.png", reason: "", diagnostics });
  await expect(pending).rejects.toThrow("WORK_STALE");
  expect(apply).not.toHaveBeenCalled();
});

it("3J-B19 reports repeated candidate failure once without provider diagnostics", async () => {
  const base = sampleFilm();
  const reason = "首帧选用 5 张参考图，模型上限 13；请求失败。";
  vi.mocked(requestShotStill).mockReset().mockResolvedValue({ url: "", reason, diagnostics });
  const result = await makeFourStills(base, base.shots[0]!, {
    current: () => base,
    valid: () => true,
    apply: vi.fn(),
  });
  expect(result).toMatchObject({ done: 0, failed: 4 });
  expect(result.notice).toBe(stillFailureNotice(new Error(reason)).text);
  expect(result.notice).not.toMatch(/模型|上限|首帧|\d/u);
  expect(result.failures).toEqual(Array(4).fill(reason));
});

it("3J-B19 video preframe failure does not forward developer diagnostics", async () => {
  const base = sampleFilm();
  const shot = { ...base.shots[0]!, poster: "", stills: [] };
  const reason = "首帧选用 5 张参考图，模型上限 13；请求失败。";
  vi.mocked(requestShotStill).mockReset().mockResolvedValue({ url: "", reason, diagnostics });
  const apply = vi.fn();
  const execution = await preframeExecution(base);
  await expect(
    ensureShotFrame(base, shot, { current: () => base, valid: () => true, apply, execution }),
  ).rejects.toThrow(`镜头 ${shot.no} 首帧未完成：${stillFailureNotice(new Error(reason)).text}`);
  expect(apply).not.toHaveBeenCalled();
});
