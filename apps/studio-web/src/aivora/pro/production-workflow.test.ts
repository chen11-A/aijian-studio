import { describe, it, expect, vi } from "vitest";
import { sampleFilm, type FilmShot } from "../film/project";
import { repairDirectorCoverage, fixCoverage, RequestSequences } from "./director-workflow";
import { makeAllPortraits } from "./portrait-workflow";
import { subscribeTasks, taskSnapshot } from "../film/task-progress";

const shot = (id: string, picture: string, action = ""): FilmShot => ({
  ...sampleFilm().shots[0]!,
  id,
  sceneId: "s1",
  no: 1,
  picture,
  action,
  line: "",
  lines: [],
  speaker: "",
  size: "中景",
  takes: [],
  stills: [],
  poster: "",
  userFields: [],
});
const scene = {
  id: "s1",
  title: "门口",
  where: "门口 · 夜",
  text: "门口下雨。\n有人走到窗前。\n远处传来警笛。",
};
const reply = (shots: object[]) => ({ text: JSON.stringify({ shots }), detail: "" });

describe("director repair without data loss", () => {
  it("repairs the missing ending once and retains the existing silent action", async () => {
    const existing = [shot("old1", "门口下雨。", "有人走到窗前。")];
    const request = vi.fn(async () =>
      reply([
        { picture: "门口下雨。", action: "有人走到窗前。", seconds: 10 },
        { picture: "远处传来警笛。", seconds: 10 },
      ]),
    );
    const result = await repairDirectorCoverage(scene, existing, request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.coverage.ok).toBe(true);
    expect(result.shots.map((shot) => shot.action).join(" ")).toContain("有人走到窗前。");
  });
  it("rejects a reply that retains all dialogue and ending but removes a silent middle action", async () => {
    const existing = [shot("old1", "门口下雨。", "有人走到窗前。")];
    const result = await repairDirectorCoverage(scene, existing, async () =>
      reply([{ picture: "门口下雨。\n远处传来警笛。", action: "" }]),
    );
    expect(result.shots).toBe(existing);
    expect(result.coverage.missingTail).toBe("远处传来警笛。");
    expect(result.repaired).toBe(false);
  });
  it("retains generated media and edited identities or refuses a merged replacement", async () => {
    const existing = [
      {
        ...shot("old1", "门口下雨。", "有人走到窗前。"),
        poster: "/old.png",
        userFields: ["picture"],
      },
    ];
    const result = await repairDirectorCoverage(scene, existing, async () =>
      reply([
        { picture: "门口下雨。", action: "有人走到窗前。", seconds: 10 },
        { picture: "远处传来警笛。", seconds: 10 },
      ]),
    );
    expect(result.shots[0]?.id).toBe("old1");
    expect(result.shots[0]?.poster).toBe("/old.png");
    expect(result.shots[0]?.userFields).toEqual(["picture"]);
    const merged = await repairDirectorCoverage(scene, existing, async () =>
      reply([{ picture: "门口下雨。\n远处传来警笛。", action: "有人走到窗前。" }]),
    );
    expect(merged.repaired).toBe(false);
    expect(merged.shots).toBe(existing);
  });
  it("keeps scene ordering and incomplete coverage after a repair failure", async () => {
    const film = sampleFilm();
    film.scenes = [
      { ...film.scenes[0]!, ...scene },
      { ...film.scenes[1]!, id: "s2", text: "另一个场景。" },
    ];
    film.shots = [
      shot("old1", "门口下雨。", "有人走到窗前。"),
      { ...shot("other", "另一个场景。"), sceneId: "s2" },
    ];
    const result = await fixCoverage(film, "s1", async () => {
      throw new Error("offline");
    });
    expect(result.film.shots.map((shot) => shot.id)).toEqual(["old1", "other"]);
    expect(result.film.scenes[0]?.coverage?.ok).toBe(false);
  });
  it("invalidates an old request when a newer request or project becomes active", () => {
    const sequences = new RequestSequences();
    let project = "a";
    const first = sequences.begin("a", "director", () => project);
    const second = sequences.begin("a", "director", () => project);
    expect(first()).toBe(false);
    expect(second()).toBe(true);
    project = "b";
    expect(second()).toBe(false);
  });
});

describe("whole-cast portrait queue", () => {
  it("retries a failed front once, blocks its dependent views and persists the next character", async () => {
    let film = sampleFilm();
    film.characters = film.characters.slice(0, 2).map((person) => ({ ...person, portraits: [] }));
    const persisted: number[] = [];
    const request = vi
      .fn()
      .mockResolvedValueOnce({ url: "", reason: "fail" })
      .mockResolvedValueOnce({ url: "", reason: "fail" })
      .mockResolvedValue({ url: "/new.png", reason: "" });
    const snapshots: number[] = [];
    const off = subscribeTasks((tasks) =>
      snapshots.push(tasks.filter((task) => task.status === "queued").length),
    );
    const pending = makeAllPortraits({
      base: film,
      current: () => film,
      apply: async (next) => {
        film = next;
        persisted.push(film.characters.flatMap((person) => person.portraits).length);
      },
      generate: request,
      progress: vi.fn(),
    });
    expect(snapshots.some((count) => count > 0)).toBe(true);
    const result = await pending;
    off();
    expect(request).toHaveBeenCalledTimes(6);
    expect(request.mock.calls.slice(0, 2).map((call) => call[1])).toEqual([[], []]);
    expect(request.mock.calls[0]?.[0]).toBe(request.mock.calls[1]?.[0]);
    expect(request.mock.calls.slice(2).map((call) => call[1])).toEqual([
      [],
      ["/new.png"],
      ["/new.png"],
      ["/new.png"],
    ]);
    expect(
      request.mock.calls
        .slice(2)
        .every((call) => String(call[0]).includes(film.characters[1]!.identity)),
    ).toBe(true);
    expect(film.characters[0]!.portraits).toEqual([]);
    expect(film.characters[1]!.portraits.map((portrait) => portrait.view)).toEqual([
      "正面",
      "侧面",
      "背面",
      "脸部",
    ]);
    expect(result.failures).toEqual([
      { characterId: film.characters[0]!.id, view: "正面", reason: "fail" },
      ...["侧面", "背面", "脸部"].map((view) => ({
        characterId: film.characters[0]!.id,
        view,
        reason: "先补好正面照，再生成这个角度。",
        code: "PORTRAIT_ANCHOR_REQUIRED",
      })),
    ]);
    expect(result).toMatchObject({ total: 8, done: 4, failed: 4, cancelled: false });
    expect(persisted).toEqual([1, 2, 3, 4]);
    expect(taskSnapshot().batches.at(-1)).toMatchObject({
      done: 4,
      total: 8,
      failed: 4,
      running: false,
    });
  });
  it("does not save a late portrait after switching projects", async () => {
    const base = sampleFilm();
    let film = base;
    const apply = vi.fn();
    const result = await makeAllPortraits({
      base,
      current: () => film,
      apply,
      generate: async () => {
        film = { ...base, id: "other" };
        return { url: "/late.png", reason: "" };
      },
      progress: vi.fn(),
    });
    expect(apply).not.toHaveBeenCalled();
    expect(result.cancelled).toBe(true);
  });
  it("does not duplicate a timed-out image request or save its late result", async () => {
    const film = sampleFilm();
    film.characters = [
      {
        ...film.characters[0]!,
        portraits: ["侧面", "背面", "脸部"].map((view) => ({
          view,
          prompt: "",
          url: "/existing.png",
        })),
      },
    ];
    let release: (value: { url: string; reason: string }) => void = () => undefined;
    const generate = vi.fn(
      () =>
        new Promise<{ url: string; reason: string }>((resolve) => {
          release = resolve;
        }),
    );
    const apply = vi.fn();
    const result = await makeAllPortraits({
      base: film,
      current: () => film,
      apply,
      generate,
      progress: vi.fn(),
      taskTimeoutMs: 10,
    });
    release({ url: "/late.png", reason: "" });
    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });
});

it("rejects a repair that reduces repeated dialogue occurrences", async () => {
  const repeated = { ...scene, text: "甲说：“别动。”\n乙说：“别动。”\n丙说：“别动。”\n警笛远去。" };
  const existing = [
    {
      ...shot("a", "甲站着"),
      speaker: "甲",
      line: "别动。",
      lines: [{ speaker: "甲", text: "别动。" }],
    },
    {
      ...shot("b", "乙站着"),
      speaker: "乙",
      line: "别动。",
      lines: [{ speaker: "乙", text: "别动。" }],
    },
  ];
  const result = await repairDirectorCoverage(repeated, existing, async () =>
    reply([{ picture: "甲站着\n乙站着\n警笛远去。", line: "别动。", speaker: "甲" }]),
  );
  expect(result.repaired).toBe(false);
  expect(result.shots).toBe(existing);
  expect(result.coverage.missingLines).toEqual(["别动。"]);
});

it("computes saved coverage after preserving a manually edited shot", async () => {
  const { applyDirectorPlan } = await import("./director-workflow");
  const film = sampleFilm();
  film.scenes = [{ ...film.scenes[0]!, ...scene, text: "甲说：“别动。”\n警笛远去。" }];
  const edited = { ...shot("locked", "警笛远去。"), userFields: ["line"], line: "", lines: [] };
  film.shots = [edited];
  const incoming = [
    {
      ...edited,
      line: "别动。",
      lines: [{ speaker: "甲", text: "别动。" }],
      speaker: "甲",
      userFields: [],
    },
  ];
  const saved = applyDirectorPlan(film, incoming, "s1");
  expect(saved.shots[0]?.line).toBe("");
  expect(saved.scenes[0]?.coverage?.ok).toBe(false);
  expect(saved.scenes[0]?.coverage?.missingLines).toEqual(["别动。"]);
});

it("sends each action target's identity, size and all dialogue lines with source constraints", async () => {
  const { enrichDirectorPlan } = await import("./enrichment-workflow");
  const film = sampleFilm();
  const story = "铁棍挥下。\n甲说：“走！”";
  film.scenes = [{ ...film.scenes[0]!, ...scene, text: story }];
  const target = {
    ...shot("physical", story, "铁棍挥下。"),
    characters: ["甲"],
    speaker: "甲",
    line: "走！",
    lines: [{ speaker: "甲", text: "走！" }],
  };
  const request = vi.fn(async (role: string) =>
    role === "performance"
      ? { text: JSON.stringify([{ id: target.id, face: ["警觉"] }]), detail: "" }
      : {
          text: JSON.stringify({ shots: [{ id: target.id, nodes: [{ text: "格挡铁棍" }] }] }),
          detail: "",
        },
  );
  await enrichDirectorPlan(film, "s1", [target], {
    valid: () => true,
    request,
    warning: vi.fn(),
    unassigned: vi.fn(),
  });
  const action = request.mock.calls.find(([role]) => role === "action");
  expect(action).toBeDefined();
  const context = String((action as unknown as string[])[1]);
  expect(context).toContain("动作约束");
  expect(context).toContain('"id":"physical"');
  expect(context).toContain('"size":"中景"');
  expect(context).toContain('"lines":[{"speaker":"甲","text":"走！"}]');
});
