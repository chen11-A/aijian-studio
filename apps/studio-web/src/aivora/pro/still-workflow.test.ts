import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { taskSnapshot } from "../film/task-progress";
import { requestShotStill } from "./workflow";
import { ensureShotFrame, makeFourStills } from "./still-workflow";
vi.mock("./workflow", () => ({ requestShotStill: vi.fn() }));

it("queues candidates immediately and discards a delayed image after project switch", async () => {
  const base = sampleFilm();
  let current = base;
  const shot = base.shots[0]!;
  let resolve!: (result: { url: string; reason: string }) => void;
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
  resolve({ url: "late.png", reason: "" });
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
    .mockResolvedValueOnce({ url: "", reason: "supplier denied" })
    .mockResolvedValue({ url: "candidate.png", reason: "" });
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
  let resolve!: (result: { url: string; reason: string }) => void;
  vi.mocked(requestShotStill).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const apply = vi.fn();
  const pending = ensureShotFrame(base, shot, { current: () => base, valid: () => valid, apply });
  expect(
    taskSnapshot().tasks.some(
      (task) =>
        task.id === `preframe:${shot.id}` && task.status === "queued" && task.kind === "image",
    ),
  ).toBe(true);
  await Promise.resolve();
  valid = false;
  resolve({ url: "late.png", reason: "" });
  await expect(pending).rejects.toThrow("WORK_STALE");
  expect(apply).not.toHaveBeenCalled();
});
