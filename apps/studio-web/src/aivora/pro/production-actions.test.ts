import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { createProductionActions } from "./production-actions";
import type { AgentRequestControl, AgentReply } from "./workflow";

it("keeps explicitly cleared traits empty and preserves a manually chosen voice", async () => {
  let film = sampleFilm();
  const id = film.characters[0]!.id;
  const actions = createProductionActions({
    current: () => film,
    apply: (next) => {
      film = next;
    },
    requestDirector: vi.fn(),
    notify: vi.fn(),
  });
  await actions.updateCharacterTraits(id, { gender: "", ageBand: "" });
  expect(film.characters[0]).toMatchObject({
    gender: "",
    ageBand: "",
    voiceId: "",
    voiceCode: "VOICE_TRAITS_REQUIRED",
  });
  film.characters[0] = {
    ...film.characters[0]!,
    voiceId: "custom-user-voice",
    userFields: ["voiceId"],
  };
  await actions.updateCharacterTraits(id, { gender: "男", ageBand: "老年" });
  expect(JSON.parse(JSON.stringify(film)).characters[0]).toMatchObject({
    gender: "男",
    ageBand: "老年",
    voiceId: "custom-user-voice",
  });
});

function coverageFixture() {
  let film = sampleFilm();
  const sceneId = film.scenes[0]!.id;
  film.scenes[0]!.text = "门打开了。警笛响起。";
  film.shots = [];
  const apply = vi.fn((next: typeof film) => {
    film = next;
  });
  const notify = vi.fn();
  return {
    sceneId,
    apply,
    notify,
    current: () => film,
    changeText: () => {
      film = { ...film, scenes: film.scenes.map((scene) => ({ ...scene, text: "新原文。" })) };
    },
    switchProject: () => {
      film = { ...film, id: "another" };
    },
  };
}

it("manual coverage includes pending response headers in a 240-second budget and ignores late repair", async () => {
  vi.useFakeTimers();
  try {
    const f = coverageFixture();
    let control: AgentRequestControl | undefined;
    let finish!: (reply: AgentReply) => void;
    const requestDirector = vi.fn((_context, _instruction, next) => {
      control = next;
      return new Promise<AgentReply>((resolve) => {
        finish = resolve;
      });
    });
    const actions = createProductionActions({ ...f, requestDirector });
    const started = Date.now();
    const pending = actions.fixCoverage(f.sceneId);
    expect(control?.deadlineAt).toBe(started + 240_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "DIRECTOR_PROGRESS",
        detail: expect.stringContaining("30 秒"),
      }),
    );
    await vi.advanceTimersByTimeAsync(210_000);
    expect(await pending).toBeNull();
    expect(control?.signal.aborted).toBe(true);
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "TEXT_TIMEOUT" }));
    finish({
      text: JSON.stringify({ shots: [{ picture: "门打开了。警笛响起。", seconds: 3 }] }),
      detail: "",
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(f.apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it.each(["changeText", "switchProject"] as const)(
  "manual coverage aborts %s and cannot write an obsolete result",
  async (change) => {
    vi.useFakeTimers();
    try {
      const f = coverageFixture();
      let control: AgentRequestControl | undefined;
      const actions = createProductionActions({
        ...f,
        requestDirector: (_c, _i, next) => {
          control = next;
          return new Promise(() => undefined);
        },
      });
      const pending = actions.fixCoverage(f.sceneId);
      f.notify.mockClear(); // Only notifications after ownership changes are forbidden.
      f[change]();
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBeNull();
      expect(control?.signal.aborted).toBe(true);
      expect(f.apply).not.toHaveBeenCalled();
      if (change === "changeText")
        expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "REQUEST_STALE" }));
      else expect(f.notify).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("manual coverage forwards cancellation and clears its timers", async () => {
  vi.useFakeTimers();
  try {
    const f = coverageFixture();
    const cancel = new AbortController();
    let control: AgentRequestControl | undefined;
    const actions = createProductionActions({
      ...f,
      requestDirector: (_c, _i, next) => {
        control = next;
        return new Promise(() => undefined);
      },
    });
    const pending = actions.fixCoverage(f.sceneId, cancel.signal);
    cancel.abort();
    expect(await pending).toBeNull();
    expect(control?.signal.aborted).toBe(true);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.notify).toHaveBeenCalledWith(expect.objectContaining({ code: "OPERATION_CANCELLED" }));
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("manual coverage constrains a retrying host to the same original deadline", async () => {
  vi.useFakeTimers();
  try {
    const { retryDirectorTimeout } = await import("./workflow");
    const f = coverageFixture();
    const controls: AgentRequestControl[] = [];
    let count = 0;
    const actions = createProductionActions({
      ...f,
      requestDirector: (_c, _i, control) =>
        retryDirectorTimeout(
          async (retry) => {
            controls.push(retry);
            if (++count === 1) {
              await new Promise((resolve) => setTimeout(resolve, 180_000));
              return { text: null, detail: "", code: "TEXT_STALLED" };
            }
            return new Promise(() => undefined);
          },
          () => undefined,
          f.notify,
          { signal: control!.signal, totalMs: control!.deadlineAt - Date.now() },
        ),
    });
    const pending = actions.fixCoverage(f.sceneId);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(controls).toHaveLength(2);
    expect(controls[1]!.deadlineAt).toBe(controls[0]!.deadlineAt);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toBeNull();
    expect(controls[1]!.signal.aborted).toBe(true);
    expect(f.apply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("manual coverage still saves a complete source-grounded repair", async () => {
  const f = coverageFixture();
  const actions = createProductionActions({
    ...f,
    requestDirector: async () => ({
      text: JSON.stringify({ shots: [{ picture: "门打开了。警笛响起。", seconds: 3 }] }),
      detail: "",
    }),
  });
  expect((await actions.fixCoverage(f.sceneId))?.ok).toBe(true);
  expect(f.apply).toHaveBeenCalledOnce();
});
