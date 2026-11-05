import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmShot } from "../../film/project";
import { planDirectorDraft } from "./director-draft";
import type { AgentRequestControl } from "../workflow";
import { enrichDirectorPlan } from "../enrichment-workflow";

afterEach(() => vi.useRealTimers());
const pending = <T>() => new Promise<T>(() => undefined);
function setup() {
  vi.useFakeTimers();
  const base = sampleFilm();
  const scene = base.scenes[0]!;
  scene.text = "风停了。";
  const reply = {
    text: JSON.stringify({ shots: [{ picture: "风停了。", seconds: 3 }] }),
    detail: "",
  };
  return { base, scene, reply, progress: vi.fn(), notify: vi.fn() };
}
it("counts headers and aborts one whole scene at four minutes", async () => {
  const s = setup();
  let control: AgentRequestControl | undefined;
  const request = vi.fn((_role, _context, _instruction, value) => {
    control = value;
    return pending<{ text: null; detail: string }>();
  });
  const enrich = vi.fn();
  const work = planDirectorDraft(s.base, s.scene.id, "", {
    ...s,
    connected: true,
    current: () => true,
    warnings: () => [],
    request,
    enrich,
  });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(s.progress.mock.calls.some(([text]) => text.includes("30 秒"))).toBe(true);
  await vi.advanceTimersByTimeAsync(210_000);
  expect(await work).toMatchObject({ status: "complete", shots: null });
  expect(control?.signal.aborted).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(enrich).not.toHaveBeenCalled();
  expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "TEXT_TIMEOUT" }));
  expect(vi.getTimerCount()).toBe(0);
});
it("shares the original deadline with enrichment and rejects its late result", async () => {
  const s = setup();
  let firstControl: AgentRequestControl | undefined;
  let extraControl: AgentRequestControl | undefined;
  let resolveExtra!: (shots: FilmShot[]) => void;
  const enrich = vi.fn((_base, _scene, _shots, _current, control) => {
    extraControl = control;
    return new Promise<FilmShot[]>((resolve) => {
      resolveExtra = resolve;
    });
  });
  const work = planDirectorDraft(s.base, s.scene.id, "", {
    ...s,
    connected: true,
    current: () => true,
    warnings: () => [],
    enrich,
    request: async (_role, _context, _instruction, control) => {
      firstControl = control;
      await new Promise((resolve) => setTimeout(resolve, 180_000));
      return s.reply;
    },
  });
  await vi.advanceTimersByTimeAsync(180_000);
  expect(extraControl?.deadlineAt).toBe(firstControl?.deadlineAt);
  await vi.advanceTimersByTimeAsync(60_000);
  const result = await work;
  expect(result).toMatchObject({
    status: "complete",
    event: "partial",
    shots: [expect.objectContaining({ picture: "风停了。" })],
  });
  expect(extraControl?.signal.aborted).toBe(true);
  const before = JSON.stringify(result);
  resolveExtra([{ ...s.base.shots[0]!, picture: "迟到结果" }]);
  await Promise.resolve();
  expect(JSON.stringify(result)).toBe(before);
  expect(vi.getTimerCount()).toBe(0);
});
it("propagates cancellation and emits no completion draft", async () => {
  const s = setup();
  const cancel = new AbortController();
  let requestControl: AgentRequestControl | undefined;
  const work = planDirectorDraft(s.base, s.scene.id, "", {
    ...s,
    connected: true,
    current: () => true,
    warnings: () => [],
    enrich: vi.fn(),
    control: { deadlineAt: Date.now() + 240_000, signal: cancel.signal },
    request: (_role, _context, _instruction, control) => {
      requestControl = control;
      return pending();
    },
  });
  cancel.abort();
  expect(await work).toEqual({ status: "stale" });
  expect(requestControl?.signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(s.notify).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("enrichment forwards remaining budget and stops subsequent requests", async () => {
  const s = setup();
  const signal = new AbortController().signal;
  const control = { deadlineAt: Date.now() + 5_000, signal };
  const shots = [
    {
      ...s.base.shots[0]!,
      sceneId: s.scene.id,
      picture: "风停了。",
      action: "",
      line: "",
      lines: [],
      characters: ["林晚"],
    },
  ];
  let forwarded: AgentRequestControl | undefined;
  const request = vi.fn((_role, _context, _instruction, c) => {
    forwarded = c;
    return pending<{ text: null; detail: string }>();
  });
  const warning = vi.fn(),
    unassigned = vi.fn();
  const work = enrichDirectorPlan(s.base, s.scene.id, shots, {
    valid: () => true,
    control,
    request,
    warning,
    unassigned,
  });
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await work).toEqual(shots);
  expect(forwarded?.deadlineAt).toBe(control.deadlineAt);
  expect(forwarded?.signal.aborted).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  expect(warning).not.toHaveBeenCalled();
  expect(unassigned).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("manual retry shares the four-minute budget across parsing and enrichment", async () => {
  const { retryDirectorDraft } = await import("./director-retry");
  const s = setup();
  let enrichedControl: AgentRequestControl | undefined;
  const work = retryDirectorDraft(
    s.base,
    s.scene.id,
    { context: "原请求", instruction: "重试" },
    {
      ...s,
      current: () => true,
      request: async () => {
        await new Promise((resolve) => setTimeout(resolve, 180_000));
        return s.reply;
      },
      enrich: (_film, _scene, _shots, _valid, control) => {
        enrichedControl = control;
        return pending();
      },
    },
  );
  await vi.advanceTimersByTimeAsync(240_000);
  expect(await work).toMatchObject({ kind: "rejected" });
  expect(enrichedControl?.signal.aborted).toBe(true);
  expect(s.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "TEXT_TIMEOUT" }));
  expect(vi.getTimerCount()).toBe(0);
});

it("legacy orchestration stops the timed-out scene without applying its late enrichment", async () => {
  const { buildLegacyStoryboard } = await import("./legacy-storyboard");
  const s = setup();
  s.base.scenes = [s.scene];
  s.base.shots = [];
  let live = s.base;
  const merge = vi.fn((film) => film);
  let directorDeadline: number | undefined;
  let enrichedControl: AgentRequestControl | undefined;
  const work = buildLegacyStoryboard(s.base, {
    ...s,
    current: () => live,
    valid: () => true,
    apply: (film) => {
      live = film;
    },
    fillCast: async () => undefined,
    merge,
    request: async (role, _context, _instruction, control) => {
      if (role === "writer")
        return {
          text: JSON.stringify({ scenes: [{ title: s.scene.title, text: s.scene.text }] }),
          detail: "",
        };
      directorDeadline = control?.deadlineAt;
      await new Promise((resolve) => setTimeout(resolve, 180_000));
      return s.reply;
    },
    enrich: (_film, _scene, _shots, _valid, control) => {
      enrichedControl = control;
      return pending();
    },
  });
  await vi.advanceTimersByTimeAsync(240_000);
  expect(await work).toMatchObject({ kind: "stopped" });
  expect(enrichedControl?.deadlineAt).toBe(directorDeadline);
  expect(enrichedControl?.signal.aborted).toBe(true);
  expect(merge).not.toHaveBeenCalled();
  expect(live.shots).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});
