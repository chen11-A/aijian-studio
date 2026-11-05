import { afterEach, expect, it, vi } from "vitest";
import { blankFilm } from "../film/project";
import { runPipelineAgentAction, type PipelineAgentHost } from "./pipeline-agent-actions";
import type { AgentReply, AgentRequestControl } from "./workflow";

afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const film = blankFilm();
  film.scenes[0]!.text = "门打开了。警笛响起。";
  const target = { step: "director" as const, targetId: film.scenes[0]!.id };
  const controls: AgentRequestControl[] = [];
  const notify = vi.fn();
  return { film, target, controls, notify };
}
const incomplete = {
  text: JSON.stringify({ shots: [{ picture: "门打开了。", seconds: 3 }] }),
  detail: "",
};
it("includes response headers in the four-minute deadline and reports elapsed progress", async () => {
  const s = setup();
  const request: PipelineAgentHost["request"] = vi.fn((_a, _c, _i, control) => {
    s.controls.push(control!);
    return new Promise<AgentReply>(() => undefined);
  });
  const pending = runPipelineAgentAction(s.film, s.target, {
    request,
    valid: () => true,
    notify: s.notify,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(s.notify).toHaveBeenCalledWith(
    expect.objectContaining({
      code: "DIRECTOR_PROGRESS",
      text: expect.stringContaining("30 秒"),
      detail: expect.stringContaining("30 秒"),
    }),
  );
  await vi.advanceTimersByTimeAsync(210_000);
  expect(await pending).toEqual(
    expect.objectContaining({ status: "failed", code: "TEXT_TIMEOUT" }),
  );
  expect(s.controls[0]!.signal.aborted).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("shares the deadline across retry and repair, retaining only the pre-timeout draft", async () => {
  const s = setup();
  let late!: (reply: AgentReply) => void;
  let calls = 0;
  const request: PipelineAgentHost["request"] = vi.fn(async (_a, _c, _i, control) => {
    s.controls.push(control!);
    calls++;
    if (calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 100_000));
      return { text: null, detail: "", code: "TEXT_STALLED" };
    }
    if (calls === 2) {
      await new Promise((resolve) => setTimeout(resolve, 100_000));
      return incomplete;
    }
    return new Promise<AgentReply>((resolve) => {
      late = resolve;
    });
  });
  const pending = runPipelineAgentAction(s.film, s.target, {
    request,
    valid: () => true,
    notify: s.notify,
  });
  await vi.advanceTimersByTimeAsync(200_000);
  expect(request).toHaveBeenCalledTimes(3);
  expect(new Set(s.controls.map((c) => c.deadlineAt)).size).toBe(1);
  await vi.advanceTimersByTimeAsync(40_000);
  const result = await pending;
  expect(result).toMatchObject({ status: "blocked", code: "TEXT_TIMEOUT" });
  expect(result.film?.shots.some((shot) => shot.picture === "门打开了。")).toBe(true);
  const snapshot = JSON.stringify(result.film);
  expect(s.controls[2]!.signal.aborted).toBe(true);
  late({
    text: JSON.stringify({ shots: [{ picture: s.film.scenes[0]!.text, seconds: 3 }] }),
    detail: "",
  });
  await Promise.resolve();
  expect(JSON.stringify(result.film)).toBe(snapshot);
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels a pending repair immediately even though the repair helper catches request errors", async () => {
  const s = setup();
  const controller = new AbortController();
  let calls = 0;
  const request: PipelineAgentHost["request"] = vi.fn((_a, _c, _i, control) => {
    s.controls.push(control!);
    return ++calls === 1 ? Promise.resolve(incomplete) : new Promise<AgentReply>(() => undefined);
  });
  const pending = runPipelineAgentAction(s.film, s.target, {
    request,
    valid: () => true,
    signal: controller.signal,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledTimes(2);
  controller.abort();
  expect(await pending).toEqual({ status: "blocked", code: "OPERATION_CANCELLED" });
  expect(s.controls[1]!.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
it("starts a fresh four-minute budget for each scene, rather than sharing one across a film", async () => {
  const s = setup();
  s.film.scenes.push({ ...s.film.scenes[0]!, id: "scene-2" });
  const request: PipelineAgentHost["request"] = vi.fn(async (_a, _c, _i, control) => {
    s.controls.push(control!);
    await new Promise((resolve) => setTimeout(resolve, 180_000));
    return {
      text: JSON.stringify({ shots: [{ picture: s.film.scenes[0]!.text, seconds: 3 }] }),
      detail: "",
    };
  });
  const host = { request, valid: () => true };
  const first = runPipelineAgentAction(s.film, s.target, host);
  await vi.advanceTimersByTimeAsync(180_000);
  expect((await first).status).toBe("done");
  const second = runPipelineAgentAction(s.film, { step: "director", targetId: "scene-2" }, host);
  await vi.advanceTimersByTimeAsync(180_000);
  expect((await second).status).toBe("done");
  expect(s.controls[1]!.deadlineAt - s.controls[0]!.deadlineAt).toBe(180_000);
  expect(vi.getTimerCount()).toBe(0);
});

it("invalidated input aborts pending headers without returning an obsolete draft", async () => {
  const s = setup();
  let valid = true;
  const request: PipelineAgentHost["request"] = vi.fn((_a, _c, _i, control) => {
    s.controls.push(control!);
    return new Promise<AgentReply>(() => undefined);
  });
  const pending = runPipelineAgentAction(s.film, s.target, { request, valid: () => valid });
  valid = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toEqual({ status: "blocked", code: "REQUEST_STALE" });
  expect(s.controls[0]!.signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
