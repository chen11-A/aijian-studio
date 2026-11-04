import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, upgradeFilm, type FilmProject } from "../film/project";
import { readSaved, saveFilm } from "../film/library";
import { fileMediaUrl, hydrateFilm } from "./workflow";
import { createProductionPipeline, type ProductionStepId } from "../film/production-pipeline";
import { runPipelineAgentAction } from "./pipeline-agent-actions";
import {
  createFilmPipelineController,
  filmPipelineCheckpoint,
  filmPipelineFingerprint,
  filmPipelineTargets,
  projectProductionProgress,
  type FilmPipelineHost,
} from "./film-pipeline-controller";
vi.mock("./pipeline-agent-actions", () => ({
  runPipelineAgentAction: vi.fn(async (film: FilmProject) => ({ status: "done", film })),
}));
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  vi.mocked(runPipelineAgentAction)
    .mockReset()
    .mockImplementation(async (film) => ({ status: "done", film, code: "STEP_COMPLETE" }));
});
function fixture(): FilmProject {
  const film = sampleFilm();
  film.id = `film_${crypto.randomUUID().replaceAll("-", "")}`;
  film.characters = film.characters.slice(0, 1);
  film.characters[0]!.portraits = ["正面", "侧面", "背面", "脸部"].map((view) => ({
    view,
    prompt: "fixture",
    url: `/media/${view}.png`,
  }));
  film.scenes = film.scenes
    .slice(0, 1)
    .map((scene) => ({ ...scene, text: "雨落。", title: "书店", tags: [] }));
  film.sourceText = "雨落。";
  film.shots = film.shots.slice(0, 1).map((shot) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    picture: "雨落。",
    action: "雨落。",
    line: "",
    lines: [],
    speaker: "",
    characters: [],
    seconds: 3,
    poster: "/media/start.png",
    takes: [],
    selectedTakeId: "",
  }));
  return film;
}
async function prime(film: FilmProject, start: ProductionStepId) {
  const hash = await filmPipelineFingerprint(film);
  const state = createProductionPipeline(film.id, hash);
  for (const step of state.steps) {
    if (step.id === start) break;
    step.targets = filmPipelineTargets(film, step.id).map((id) => ({
      id,
      status: "done",
      attempt: 1,
    }));
    Object.assign(step, {
      planned: true,
      status: "done",
      done: step.targets.length,
      total: step.targets.length,
    });
  }
  if (["video", "assembly"].includes(start)) {
    state.status = "checkpoint";
    state.checkpoint = filmPipelineCheckpoint(film);
  }
  film.productionPipeline = state;
  film.productionInputFingerprint = hash;
  return film;
}
function setup(film = fixture()) {
  let live = film;
  const disk: FilmProject[] = [];
  const events: string[] = [];
  const host: FilmPipelineHost = {
    current: () => live,
    apply: (next) => {
      events.push("apply");
      live = next;
    },
    save: vi.fn(async (next, guard) => {
      expect(guard()).toBe(true);
      events.push("save");
      disk.push(structuredClone(next));
    }),
    request: vi.fn(async () => ({ text: null, detail: "" })),
    verifyMedia: async () => true,
    video: vi.fn<NonNullable<FilmPipelineHost["video"]>>(async (base, id, ctx) => {
      const next = {
        ...base,
        shots: base.shots.map((shot) =>
          shot.id === id
            ? {
                ...shot,
                selectedTakeId: `take-${id}`,
                takes: [
                  {
                    id: `take-${id}`,
                    shotId: id,
                    index: 1,
                    status: "done" as const,
                    stillUrl: shot.poster,
                    videoPath: `/media/${id}.mp4`,
                    videoUrl: `/media/${id}.mp4`,
                    prompt: "fixture",
                    createdAt: "",
                    reason: "",
                  },
                ],
              }
            : shot,
        ),
      };
      await ctx.commitPartial(next);
      return { status: "done", film: ctx.current() };
    }),
    assemble: vi.fn<NonNullable<FilmPipelineHost["assemble"]>>(async (_base, _paths) => ({
      status: "done",
      path: "/media/film.mp4",
    })),
  };
  return {
    host,
    disk,
    events,
    live: () => live,
    edit: (next: FilmProject) => {
      live = next;
    },
    controller: () => createFilmPipelineController(host),
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("film pipeline controller", () => {
  it("enumerates every stable scene, character and shot target", () => {
    const film = fixture();
    const other = { ...film.scenes[0]!, id: "second", text: "他挥拳打斗。", tags: ["打斗"] };
    film.scenes.push(other);
    film.shots.push({
      ...film.shots[0]!,
      id: "second-shot",
      sceneId: other.id,
      characters: [film.characters[0]!.name],
    });
    expect(filmPipelineTargets(film, "writer")).toEqual(["script", "cast"]);
    expect(filmPipelineTargets(film, "art")).toEqual(["art"]);
    expect(filmPipelineTargets(film, "portraits")).toEqual(
      film.characters.flatMap((person) =>
        ["正面", "侧面", "背面", "脸部"].map((view) => `${person.id}@${view}`),
      ),
    );
    expect(filmPipelineTargets(film, "director")).toEqual(film.scenes.map((scene) => scene.id));
    expect(filmPipelineTargets(film, "action")).toEqual(["second"]);
    expect(filmPipelineTargets(film, "performance")).toEqual(["second"]);
    for (const step of ["prompter", "stills", "video"] as const)
      expect(filmPipelineTargets(film, step)).toEqual(film.shots.map((shot) => shot.id));
    expect(filmPipelineTargets(film, "review")).toEqual(["all"]);
  });
  it("hashes business content without duplicating source text or hashing pipeline metadata", async () => {
    const film = fixture();
    const hash = await filmPipelineFingerprint(film);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await filmPipelineFingerprint({
        ...film,
        savedAt: "later",
        directory: "/media",
        productionInputFingerprint: "other",
        productionPipeline: createProductionPipeline(film.id, "other"),
      }),
    ).toBe(hash);
    expect(await filmPipelineFingerprint({ ...film, title: "edited" })).not.toBe(hash);
  });
  it("saves returned text artifacts and terminal target state together before next dispatch", async () => {
    const env = setup();
    const order: string[] = [];
    vi.mocked(runPipelineAgentAction).mockImplementation(async (film, target) => {
      order.push(`${target.step}/${target.targetId}`);
      if (target.targetId === "cast") expect(env.disk.at(-1)?.title).toBe("writer result");
      return {
        status: "done",
        code: "OK",
        film: target.targetId === "script" ? { ...film, title: "writer result" } : film,
      };
    });
    const result = await env.controller().run();
    expect(order.slice(0, 3)).toEqual(["writer/script", "writer/cast", "art/art"]);
    expect(
      env.disk.some(
        (saved) =>
          saved.title === "writer result" &&
          saved.productionPipeline?.steps[0]?.targets[0]?.status === "done",
      ),
    ).toBe(true);
    expect(result.status).toBe("needs-input");
    expect(env.events.every((event, index) => event === (index % 2 ? "apply" : "save"))).toBe(true);
    for (const saved of env.disk)
      expect(saved.productionInputFingerprint).toBe(await filmPipelineFingerprint(saved));
  });
  it("requires human review and a separate explicit continue before video", async () => {
    const env = setup(await prime(fixture(), "review"));
    env.host.review = vi.fn<NonNullable<FilmPipelineHost["review"]>>(async () => ({
      status: "done",
    }));
    const review = await env.controller().run({ continue: true });
    expect(review.status).toBe("needs-input");
    expect(env.host.review).not.toHaveBeenCalled();
    const checkpoint = await env
      .controller()
      .run({ acceptInputs: [{ key: "review/all", reason: "已人工检查全部首帧" }] });
    expect(checkpoint.status).toBe("checkpoint");
    expect(checkpoint.checkpoint).toMatchObject({ shotCount: 1, seconds: 3, estimatedRequests: 1 });
    expect(env.host.video).not.toHaveBeenCalled();
    expect((await env.controller().run()).status).toBe("checkpoint");
    const complete = await env.controller().run({ continue: true });
    expect(complete.status).toBe("accepted");
    expect(env.host.video).toHaveBeenCalledOnce();
    expect(env.host.assemble).toHaveBeenCalledOnce();
    expect(env.live().assemblyPath).toBe("/media/film.mp4");
    expect(projectProductionProgress(complete).steps.at(-1)?.id).toBe("assembly");
    expect(JSON.stringify(complete)).not.toMatch(/aiChoice|score/);
  });
  it("saves each portrait with the running state and keeps every completed angle", async () => {
    const film = fixture();
    film.characters[0]!.portraits = [];
    const env = setup(await prime(film, "portraits"));
    env.host.generatePortraits = vi.fn<NonNullable<FilmPipelineHost["generatePortraits"]>>(
      async (_base, target, ctx) => {
        const [id, view] = target.split("@");
        if (!id || !view) throw new Error("Invalid portrait test target");
        {
          const live = ctx.current();
          await ctx.commitPartial({
            ...live,
            characters: live.characters.map((person) =>
              person.id === id
                ? {
                    ...person,
                    portraits: [
                      ...person.portraits,
                      { view, prompt: "fixture", url: `/media/${view}.png` },
                    ],
                  }
                : person,
            ),
          });
          expect(env.disk.at(-1)?.characters[0]?.portraits).toHaveLength(
            ctx.current().characters[0]!.portraits.length,
          );
          expect(
            env.disk
              .at(-1)
              ?.productionPipeline?.steps.find((step) => step.id === "portraits")
              ?.targets.find((item) => item.id === target)?.status,
          ).toBe("running");
        }
        return { status: "done", film: ctx.current() };
      },
    );
    await env.controller().run();
    expect(env.host.generatePortraits).toHaveBeenCalledTimes(4);
    expect(env.live().characters[0]?.portraits).toHaveLength(4);
  });
  it("does not call incomplete portraits done even when a callback claims success", async () => {
    const film = fixture();
    film.characters[0]!.portraits = [];
    const env = setup(await prime(film, "portraits"));
    env.host.generatePortraits = async (base) => ({ status: "done", film: base });
    const result = await env.controller().run();
    expect(result.status).toBe("failed");
    expect(result.steps.find((step) => step.id === "portraits")?.targets[0]?.code).toBe(
      "PORTRAITS_INCOMPLETE",
    );
  });
  it("recovers running work as uncertain without dispatching it again", async () => {
    const env = setup(await prime(fixture(), "stills"));
    const state = env.live().productionPipeline!;
    Object.assign(
      state.steps.find((step) => step.id === "stills")!,
      {
        status: "running",
        planned: true,
        done: 0,
        total: 1,
        targets: [{ id: env.live().shots[0]!.id, status: "running", attempt: 1 }],
      },
    );
    state.status = "running";
    env.host.generateStill = vi.fn<NonNullable<FilmPipelineHost["generateStill"]>>();
    expect((await env.controller().recover()).status).toBe("uncertain");
    expect((await env.controller().run()).status).toBe("uncertain");
    expect(env.host.generateStill).not.toHaveBeenCalled();
  });
  it("stops stale text after an external edit, even an in-place edit", async () => {
    const env = setup();
    const reply = deferred<{ status: "done"; code: string; film: FilmProject }>();
    vi.mocked(runPipelineAgentAction).mockImplementationOnce(() => reply.promise);
    const pending = env.controller().run();
    await vi.waitFor(() => expect(runPipelineAgentAction).toHaveBeenCalledOnce());
    const edited = env.live();
    edited.title = "manual edit";
    const saves = env.disk.length;
    reply.resolve({ status: "done", code: "OK", film: { ...edited, title: "late result" } });
    expect((await pending).code).toBe("PIPELINE_INPUT_CHANGED");
    expect(env.live().title).toBe("manual edit");
    expect(env.disk).toHaveLength(saves);
  });
  it("rejects partial writes after a project switch and retains prior saved media", async () => {
    const film = fixture();
    film.characters[0]!.portraits = [];
    const env = setup(await prime(film, "portraits"));
    env.host.generatePortraits = async (_film, target, ctx) => {
      const id = target.split("@")[0];
      const current = ctx.current();
      await ctx.commitPartial({
        ...current,
        characters: current.characters.map((person) =>
          person.id === id
            ? { ...person, portraits: [{ view: "正面", prompt: "", url: "/media/front.png" }] }
            : person,
        ),
      });
      const changed = { ...ctx.current(), title: "manual", id: "another-project" };
      env.edit(changed);
      await expect(ctx.commitPartial({ ...current, title: "late" })).rejects.toThrow(
        "PIPELINE_INPUT_CHANGED",
      );
      return { status: "done", film: current };
    };
    expect((await env.controller().run()).code).toBe("PIPELINE_INPUT_CHANGED");
    expect(env.disk.at(-1)?.characters[0]?.portraits).toHaveLength(1);
    expect(env.live().id).toBe("another-project");
  });
  it("does not advance after a terminal save failure", async () => {
    const env = setup();
    env.host.save = vi.fn(async (next) => {
      if (next.productionPipeline?.steps[0]?.targets[0]?.status === "done")
        throw new Error("disk unavailable");
      env.disk.push(structuredClone(next));
    });
    const result = await env.controller().run();
    expect(result).toMatchObject({ status: "uncertain", code: "PIPELINE_SAVE_FAILED" });
    expect(runPipelineAgentAction).toHaveBeenCalledOnce();
    expect(env.live().productionPipeline?.steps[0]?.targets[0]?.status).toBe("running");
  });
  it("does not overwrite user edits made while persistence is pending", async () => {
    const env = setup();
    const saved = deferred<void>();
    env.host.save = vi.fn(async (_next, guard) => {
      await saved.promise;
      expect(guard()).toBe(false);
    });
    const running = env.controller().run();
    await vi.waitFor(() => expect(env.host.save).toHaveBeenCalledOnce());
    env.edit({ ...env.live(), title: "edit during save" });
    saved.resolve();
    expect((await running).code).toBe("PIPELINE_INPUT_CHANGED");
    expect(env.live().title).toBe("edit during save");
    expect(runPipelineAgentAction).not.toHaveBeenCalled();
  });
  it("prevents a second owner from dispatching the same project", async () => {
    const env = setup();
    const reply = deferred<{ status: "done"; code: string; film: FilmProject }>();
    vi.mocked(runPipelineAgentAction).mockImplementationOnce(() => reply.promise);
    const pending = env.controller().run();
    await vi.waitFor(() => expect(runPipelineAgentAction).toHaveBeenCalledOnce());
    expect((await env.controller().run()).code).toBe("PIPELINE_ALREADY_RUNNING");
    reply.resolve({ status: "done", code: "OK", film: env.live() });
    await pending;
  });
  it("keeps coverage and unassigned-action risks at the checkpoint", () => {
    const film = fixture();
    film.unassignedBeats = [{ sceneId: film.scenes[0]!.id, text: "unassigned" }];
    film.scenes[0]!.text += "\n结尾没有镜头。";
    const checkpoint = filmPipelineCheckpoint(film);
    expect(checkpoint.coverage[0]?.missingTail).toBe("结尾没有镜头。");
    expect(checkpoint.risks).toContainEqual(
      expect.objectContaining({ code: "ACTION_UNASSIGNED", severity: "block" }),
    );
  });
  it("does not mark video done when the returned film has no saved clip", async () => {
    const env = setup(await prime(fixture(), "video"));
    env.host.video = async (film) => ({ status: "done", film });
    const result = await env.controller().run({ continue: true });
    expect(result.status).toBe("failed");
    expect(env.host.assemble).not.toHaveBeenCalled();
  });
  it("preserves assembly output but does not call partial audio success complete", async () => {
    const film = fixture();
    const env = setup(await prime(film, "video"));
    env.host.assemble = async (base) => ({
      status: "needs-input",
      code: "ASSEMBLY_AUDIO_INCOMPLETE",
      film: { ...base, assemblyPath: "/media/partial.mp4" },
    });
    const result = await env.controller().run({ continue: true });
    expect(result.status).toBe("needs-input");
    expect(env.live().assemblyPath).toBe("/media/partial.mp4");
  });
});

it("rejects a stale completion snapshot without erasing saved portrait progress", async () => {
  const film = fixture();
  film.characters[0]!.portraits = [];
  const env = setup(await prime(film, "portraits"));
  env.host.generatePortraits = async (base, target, ctx) => {
    const old = structuredClone(base);
    const [id, view] = target.split("@");
    await ctx.commitPartial({
      ...ctx.current(),
      characters: ctx
        .current()
        .characters.map((person) =>
          person.id === id
            ? { ...person, portraits: [{ view: view ?? "", prompt: "", url: "/media/front.png" }] }
            : person,
        ),
    });
    return { status: "done", film: old };
  };
  const result = await env.controller().run();
  expect(result.status).toBe("blocked");
  expect(result.steps.find((step) => step.id === "portraits")?.targets[0]?.code).toBe(
    "STEP_RESULT_STALE",
  );
  expect(env.live().characters[0]?.portraits).toHaveLength(1);
});

it("does not resume changed persisted inputs or reset malformed state silently", async () => {
  const env = setup(await prime(fixture(), "review"));
  env.edit({ ...env.live(), title: "edited after close" });
  expect((await env.controller().run()).code).toBe("PIPELINE_INPUT_CHANGED");
  expect(env.disk).toHaveLength(0);
  const malformed = {
    ...env.live(),
    productionPipeline: { ...env.live().productionPipeline!, steps: [] },
  };
  env.edit(malformed);
  expect((await env.controller().run()).code).toBe("STATE_INVALID");
  expect(env.disk).toHaveLength(0);
});

it("requires every generated video before assembling multiple shots", async () => {
  const film = fixture();
  film.shots.push({ ...film.shots[0]!, id: "second-shot" });
  const env = setup(await prime(film, "video"));
  const result = await env.controller().run({ continue: true });
  expect(result.status).toBe("done");
  expect(env.host.video).toHaveBeenCalledTimes(2);
  expect(env.host.assemble).toHaveBeenCalledWith(
    expect.objectContaining({ id: film.id }),
    [`/media/${film.shots[0]!.id}.mp4`, "/media/second-shot.mp4"],
    expect.any(Object),
  );
  expect(env.live().assemblyPath).toBe("/media/film.mp4");
});

it("keeps a failed visual review blocked even when the capability is enabled", async () => {
  const env = setup(await prime(fixture(), "review"));
  env.host.visualReviewAvailable = true;
  env.host.review = vi.fn<NonNullable<FilmPipelineHost["review"]>>(async () => ({
    status: "failed",
    code: "REVIEW_FAILED",
  }));
  expect((await env.controller().run()).status).toBe("failed");
  expect(env.host.video).not.toHaveBeenCalled();
});

it("does not reuse a missing saved clip reported by the desktop verifier", async () => {
  const env = setup(await prime(fixture(), "video"));
  env.host.verifyMedia = async (_path, kind) => kind !== "video";
  const result = await env.controller().run({ continue: true });
  expect(result.status).toBe("failed");
  expect(env.host.assemble).not.toHaveBeenCalled();
});

it("hashes materialized media before each atomic project write and resumes the reloaded snapshot", async () => {
  const film = fixture();
  film.shots[0]!.poster = "data:image/png;base64,aGVsbG8=";
  film.characters[0]!.portraits[0]!.url = "data:image/png;base64,d29ybGQ=";
  film.assemblyUrl = "blob:session-only";
  const env = setup(await prime(film, "review"));
  let serial = 0;
  const materialize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(materialize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" && ["poster", "url", "assemblyUrl"].includes(key)
          ? item.startsWith("data:")
            ? `/media/materialized-${++serial}.png`
            : item.startsWith("blob:")
              ? ""
              : item
          : materialize(item),
      ]),
    );
  };
  env.host.prepareSnapshot = vi.fn(async (snapshot, guard) => {
    expect(guard()).toBe(true);
    env.events.push("prepare");
    return materialize(snapshot) as FilmProject;
  });
  env.host.save = vi.fn(async (snapshot, guard) => {
    expect(guard()).toBe(true);
    // Existing desktop write materializes again: the prepared input must be idempotent.
    const stored = materialize(snapshot) as FilmProject;
    expect(stored).toEqual(snapshot);
    expect(stored.productionInputFingerprint).toBe(await filmPipelineFingerprint(stored));
    env.events.push("save");
    env.disk.push(structuredClone(stored));
  });
  expect((await env.controller().run()).status).toBe("needs-input");
  expect(serial).toBe(2);
  expect(env.events).toEqual(env.disk.flatMap(() => ["prepare", "save", "apply"]));
  const reloaded = structuredClone(env.disk.at(-1)!);
  expect(reloaded.shots[0]!.poster).toMatch(/^\/media\/materialized-/);
  expect(reloaded.assemblyUrl).toBe("");
  expect(env.live().shots[0]!.poster).toBe(reloaded.shots[0]!.poster);
  env.edit(reloaded);
  expect((await env.controller().recover()).status).toBe("needs-input");
  expect((await env.controller().run()).code).not.toBe("PIPELINE_INPUT_CHANGED");
  // A real media edit is still an input change; media fields are not excluded from hashing.
  env.edit({
    ...env.live(),
    shots: env.live().shots.map((shot) => ({ ...shot, poster: "/media/user-edit.png" })),
  });
  expect((await env.controller().run()).code).toBe("PIPELINE_INPUT_CHANGED");
});

it("blocks transient media without preparation instead of committing an invalid fingerprint", async () => {
  const film = fixture();
  film.shots[0]!.poster = "data:image/png;base64,aGVsbG8=";
  const env = setup(await prime(film, "review"));
  expect((await env.controller().run()).code).toBe("PIPELINE_PREPARATION_REQUIRED");
  expect(env.disk).toHaveLength(0);
  expect(env.events).not.toContain("apply");
});

it("does not persist or apply prepared media after a concurrent edit", async () => {
  const env = setup(await prime(fixture(), "review"));
  const started = deferred<void>();
  const prepared = deferred<FilmProject>();
  env.host.prepareSnapshot = async () => {
    started.resolve();
    return prepared.promise;
  };
  const pending = env.controller().run();
  await started.promise;
  const original = structuredClone(env.live());
  env.edit({ ...env.live(), title: "user changed title during materialization" });
  prepared.resolve(original);
  expect((await pending).code).toBe("PIPELINE_INPUT_CHANGED");
  expect(env.disk).toHaveLength(0);
  expect(env.live().title).toBe("user changed title during materialization");
});

it("rejects preparation that leaves transient media or changes project identity", async () => {
  const film = fixture();
  film.assemblyUrl = "blob:session-only";
  const env = setup(await prime(film, "review"));
  env.host.prepareSnapshot = async (snapshot) => snapshot;
  expect((await env.controller().run()).code).toBe("PIPELINE_PREPARATION_REQUIRED");
  env.host.prepareSnapshot = async (snapshot) => ({ ...snapshot, seriesId: "different-series" });
  expect((await env.controller().run()).code).toBe("PIPELINE_PREPARATION_INVALID");
  expect(env.disk).toHaveLength(0);
});

it("recovers the actual save / upgrade / hydration round trip without accepting source or media edits", async () => {
  delete window.aijian;
  window.localStorage.clear();
  const film = fixture();
  delete film.characters[0]!.gender;
  delete film.characters[0]!.ageBand;
  film.assemblyPath = "/media/assembled.mp4";
  film.assemblyUrl = fileMediaUrl(film.assemblyPath);
  film.shots[0]!.takes = [
    {
      id: "saved-take",
      shotId: film.shots[0]!.id,
      index: 1,
      status: "done",
      stillUrl: film.shots[0]!.poster,
      videoPath: "/media/saved.mp4",
      videoUrl: "",
      prompt: "",
      reason: "",
      createdAt: "",
    },
  ];
  const env = setup(await prime(film, "review"));
  env.host.save = async (snapshot, guard) => {
    expect(guard()).toBe(true);
    await saveFilm(snapshot, window.localStorage);
  };
  expect((await env.controller().run()).status).toBe("needs-input");
  const saved = await readSaved(film.id, window.localStorage);
  expect(saved).not.toBeNull();
  const reloaded = await hydrateFilm(upgradeFilm(saved)!);
  expect(reloaded.characters[0]!.gender).toBe("");
  expect(reloaded.assemblyUrl).toBe("");
  expect(reloaded.shots[0]!.takes[0]!.videoUrl).toBe(fileMediaUrl("/media/saved.mp4"));
  env.edit(reloaded);
  expect((await env.controller().recover()).status).toBe("needs-input");
  const stable = structuredClone(env.live());
  for (const edited of [
    { ...stable, sourceText: "真正改变的原文" },
    { ...stable, assemblyPath: "/media/different-assembly.mp4" },
    { ...stable, shots: stable.shots.map((shot) => ({ ...shot, poster: "/media/different.png" })) },
    {
      ...stable,
      shots: stable.shots.map((shot) => ({
        ...shot,
        takes: shot.takes.map((take) => ({ ...take, videoPath: "/media/different.mp4" })),
      })),
    },
    {
      ...stable,
      shots: stable.shots.map((shot) => ({
        ...shot,
        takes: shot.takes.map((take) => ({
          ...take,
          videoUrl: "https://example.com/unrelated.mp4",
        })),
      })),
    },
  ]) {
    env.edit(edited);
    expect((await env.controller().recover()).code).toBe("PIPELINE_INPUT_CHANGED");
  }
});

it("validates the saved fingerprint before interrupting only owned video work during recovery", async () => {
  const film = fixture();
  const shot = film.shots[0]!;
  shot.takes = [
    {
      id: "pending",
      shotId: shot.id,
      index: 1,
      status: "running",
      stillUrl: shot.poster,
      videoPath: "",
      videoUrl: "",
      prompt: "",
      reason: "",
      createdAt: "",
    },
  ];
  film.shots.push({
    ...shot,
    id: "unowned",
    takes: [{ ...shot.takes[0]!, id: "unowned-take", shotId: "unowned", status: "queued" }],
  });
  film.jobs = [
    {
      id: "owned-job",
      kind: "video",
      shotId: shot.id,
      take: 1,
      status: "queued",
      prompt: "",
      reason: "",
    },
    {
      id: "portrait-job",
      kind: "portrait",
      shotId: shot.id,
      take: 1,
      status: "running",
      prompt: "",
      reason: "",
    },
  ];
  const prepared = await prime(film, "video");
  const state = prepared.productionPipeline!;
  Object.assign(
    state.steps.find((step) => step.id === "video")!,
    {
      status: "running",
      planned: true,
      total: 1,
      done: 0,
      targets: [{ id: shot.id, status: "running", attempt: 1 }],
    },
  );
  state.status = "running";
  state.current = "video";
  const env = setup(await hydrateFilm(upgradeFilm(prepared)!));
  const original = structuredClone(env.live());
  env.edit({ ...original, sourceText: "tampered" });
  expect((await env.controller().recover()).code).toBe("PIPELINE_INPUT_CHANGED");
  expect(env.disk).toHaveLength(0);
  env.edit(original);
  expect((await env.controller().recover()).status).toBe("uncertain");
  expect(env.live().shots[0]!.takes[0]).toMatchObject({
    status: "failed",
    interruptedFrom: "running",
  });
  expect(env.live().jobs[0]).toMatchObject({ status: "failed", interruptedFrom: "queued" });
  expect(env.live().shots[1]!.takes[0]!.status).toBe("queued");
  expect(env.live().jobs[1]!.status).toBe("running");
  expect(env.disk).toHaveLength(1);
  expect(
    env.disk[0]!.productionPipeline!.steps.find((step) => step.id === "video")!.targets[0]!.status,
  ).toBe("uncertain");
  expect(env.disk[0]!.productionInputFingerprint).toBe(await filmPipelineFingerprint(env.disk[0]!));
  expect(env.host.video).not.toHaveBeenCalled();
  expect(runPipelineAgentAction).not.toHaveBeenCalled();
});

it("plans locations after characters and resumes only the failed location target", async () => {
  const film = fixture();
  film.locations = [
    { id: "one", name: "书店", prompt: "书架", ambience: "" },
    { id: "two", name: "街道", prompt: "路灯", ambience: "" },
    { id: "unused", name: "医院", prompt: "走廊", ambience: "" },
  ];
  film.scenes[0]!.where = "书店";
  film.scenes.push({ ...film.scenes[0]!, id: "scene-two", where: "街道" });
  expect(filmPipelineTargets(film, "portraits")).not.toContain("location:unused");
  expect(filmPipelineTargets(film, "portraits").slice(-2)).toEqual([
    "location:one",
    "location:two",
  ]);
  const env = setup(await prime(film, "portraits"));
  let refuse = true;
  env.host.generatePortraits = vi.fn<NonNullable<FilmPipelineHost["generatePortraits"]>>(
    async (_base, target, ctx) => {
      if (target === "location:two" && refuse)
        return { status: "failed", code: "LOCATION_IMAGE_FAILED" };
      const live = ctx.current();
      await ctx.commitPartial({
        ...live,
        locations: live.locations.map((location) =>
          target === `location:${location.id}`
            ? {
                ...location,
                referenceImage: `/media/${location.id}.png`,
                referenceStyleRevision: live.styleRevision ?? 0,
              }
            : location,
        ),
      });
      return { status: "done", film: ctx.current() };
    },
  );
  expect((await env.controller().run()).status).toBe("failed");
  expect(env.disk.at(-1)?.locations[0]!.referenceImage).toBe("/media/one.png");
  refuse = false;
  await env.controller().run({ retryTargets: ["portraits/location:two"] });
  expect(vi.mocked(env.host.generatePortraits!).mock.calls.map((call) => call[1])).toEqual([
    "location:one",
    "location:two",
    "location:two",
  ]);
  const target = env
    .live()
    .productionPipeline!.steps.find((step) => step.id === "portraits")!
    .targets.find((item) => item.id === "location:two");
  expect(target?.status).toBe("done");
});

it("reuses verified location images but rejects stale styles and false success", async () => {
  for (const mode of ["valid", "missing", "stale", "layout"] as const) {
    const film = fixture();
    film.locations = [
      {
        id: "one",
        name: "书店",
        prompt: "书架",
        ambience: "",
        referenceImage: "/media/place.png",
        referenceStyleRevision: mode === "stale" ? 99 : (film.styleRevision ?? 0),
        ...(mode === "layout" ? { layout: "门在左边", referenceLayout: "门在右边" } : {}),
      },
    ];
    film.scenes[0]!.where = "书店";
    const env = setup(await prime(film, "portraits"));
    env.host.verifyMedia = async (path) => !(mode === "missing" && path === "/media/place.png");
    env.host.generatePortraits = vi.fn<NonNullable<FilmPipelineHost["generatePortraits"]>>(
      async (base) => ({ status: "done", film: base }),
    );
    await env.controller().run();
    const target = env
      .live()
      .productionPipeline!.steps.find((step) => step.id === "portraits")!
      .targets.find((item) => item.id === "location:one");
    if (mode === "valid") {
      expect(target?.status).toBe("done");
      expect(env.host.generatePortraits).not.toHaveBeenCalled();
    } else {
      expect(target?.status).toBe("failed");
      expect(target?.code).toBe("LOCATION_IMAGE_INCOMPLETE");
    }
  }
});

it("does not queue empty, unused or partially matching location names", () => {
  const film = fixture();
  film.scenes[0]!.where = "旧书店";
  film.locations = [
    { id: "empty", name: "", prompt: "", ambience: "" },
    { id: "partial", name: "书店", prompt: "", ambience: "" },
    { id: "unused", name: "医院", prompt: "", ambience: "" },
  ];
  expect(
    filmPipelineTargets(film, "portraits").filter((target) => target.startsWith("location:")),
  ).toEqual([]);
});
