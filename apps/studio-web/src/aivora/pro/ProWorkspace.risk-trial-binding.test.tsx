import type { FilmRiskTrialGateway } from "@aijian/contracts/film-risk-trial";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import * as pipeline from "./pipeline-workspace-host";
import * as editors from "./actions/editor-host";
import * as persistence from "./film-persistence";
import { historyRecordHash } from "./actions/persistent-history";
import { ProWorkspace } from "./ProWorkspace";
const originalPipeline = pipeline.createPipelineWorkspaceHost,
  originalEditor = editors.createEditorHost,
  originalQueue = persistence.createFilmPersistence;
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function open(
  options: {
    film?: FilmProject;
    read?: (id: string) => Promise<FilmProject | null>;
    write?: (film: FilmProject) => Promise<FilmProject>;
    prepare?: (film: FilmProject) => Promise<FilmProject>;
    check?: FilmRiskTrialGateway["checkFilmRiskTrialDecision"];
    extra?: Record<string, unknown>;
  } = {},
) {
  const film = options.film ?? sampleFilm();
  let disk = structuredClone(film);
  let host!: pipeline.PipelineWorkspaceHost,
    editor!: Parameters<typeof originalEditor>[0],
    queue!: ReturnType<typeof originalQueue>,
    adapter!: ReturnType<typeof originalPipeline>;
  const recoveries = new Set<Promise<unknown>>();
  vi.spyOn(pipeline, "createPipelineWorkspaceHost").mockImplementation((value) => {
    host = value;
    adapter = originalPipeline(value);
    const recover = adapter.recover;
    adapter.recover = () => {
      const pending = recover();
      recoveries.add(pending);
      void pending.then(
        () => recoveries.delete(pending),
        () => recoveries.delete(pending),
      );
      return pending;
    };
    return adapter;
  });
  vi.spyOn(editors, "createEditorHost").mockImplementation((value) => {
    editor = value;
    return originalEditor(value);
  });
  vi.spyOn(persistence, "createFilmPersistence").mockImplementation((value) => {
    queue = originalQueue(value);
    return queue;
  });
  const read = vi.fn(async (id: string) => {
    const value = options.read ? await options.read(id) : structuredClone(disk);
    if (value) disk = structuredClone(value);
    return value;
  });
  const check = vi.fn<FilmRiskTrialGateway["checkFilmRiskTrialDecision"]>(
    options.check ??
      (async (input) => ({
        kind: "ACCEPTED" as const,
        projectId: input.projectId,
        decisionId: input.decisionId,
        inputFingerprint: "a".repeat(64),
      })),
  );
  const write = vi.fn(async (value: FilmProject) => {
    disk = options.write ? await options.write(value) : structuredClone(value);
    return structuredClone(disk);
  });
  const provider = vi.fn();
  window.aijian = {
    ...options.extra,
    listFilmSeries: async () => [],
    readFilmProject: read,
    writeFilmProject: write,
    prepareFilmProject: async (value: FilmProject) =>
      options.prepare ? options.prepare(value) : structuredClone(value),
    checkFilmRiskTrialDecision: check,
    createStoryFilm: provider,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() => expect(host.current()?.id).toBe(film.id));
  await act(async () => {
    while (recoveries.size) await Promise.allSettled([...recoveries]);
    await queue.flushAll();
  });
  return {
    film,
    host,
    adapter,
    queue: () => queue,
    editor,
    read,
    check,
    write,
    provider,
    disk: () => disk,
    adopt: (value: FilmProject) => act(() => editor.applyLive(value)),
    lease: { save: vi.fn(async () => undefined), release: vi.fn(async () => undefined) },
  };
}
it("uses a fresh main canonical hash under the existing lease without replaying a snapshot or bypassing generation confirmation", async () => {
  const f = await open(),
    decisionId = `rtd_${"b".repeat(32)}`;
  await f.host.checkTrialDecision!(decisionId, f.lease, f.film.shots[0]!.id);
  expect(f.check).toHaveBeenCalledWith({
    projectId: f.film.id,
    expectedHash: await historyRecordHash(f.disk()),
    decisionId,
    targetShotId: f.film.shots[0]!.id,
  });
  expect(f.lease.save).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("does not call native after an edit or project change during the actual canonical read", async () => {
  const f = await open(),
    entered = deferred<void>(),
    release = deferred<FilmProject>();
  f.read.mockImplementationOnce(async () => {
    entered.resolve();
    return release.promise;
  });
  const pending = f.host.checkTrialDecision!(`rtd_${"c".repeat(32)}`, f.lease);
  const rejected = expect(pending).rejects.toMatchObject({ code: "PIPELINE_REQUEST_STALE" });
  try {
    await entered.promise;
    f.adopt({ ...f.editor.current()!, title: "用户新稿" });
  } finally {
    release.resolve(structuredClone(f.disk()));
  }
  await rejected;
  expect(f.check).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("rejects an old native acceptance after the user changes the just-finished prior shot", async () => {
  const f = await open(),
    entered = deferred<void>(),
    release = deferred<Awaited<ReturnType<typeof f.check>>>();
  f.check.mockImplementationOnce(async () => {
    entered.resolve();
    return release.promise;
  });
  const decisionId = `rtd_${"d".repeat(32)}`,
    pending = f.host.checkTrialDecision!(decisionId, f.lease, f.film.shots[1]!.id);
  const rejected = expect(pending).rejects.toMatchObject({ code: "PIPELINE_REQUEST_STALE" });
  try {
    await entered.promise;
    const live = f.editor.current()!;
    f.adopt({
      ...live,
      shots: live.shots.map((shot, i) => (i ? shot : { ...shot, picture: "用户回改上一镜" })),
    });
  } finally {
    release.resolve({
      kind: "ACCEPTED",
      projectId: f.film.id,
      decisionId,
      inputFingerprint: "a".repeat(64),
    });
  }
  await rejected;
  expect(f.editor.current()!.shots[0]!.picture).toBe("用户回改上一镜");
  expect(f.provider).not.toHaveBeenCalled();
});
it("keeps unsupported, wrong-project and wrong-decision results from becoming a successful gate", async () => {
  const f = await open(),
    decisionId = `rtd_${"e".repeat(32)}`;
  for (const value of [
    { kind: "ACCEPTED", projectId: "other", decisionId, inputFingerprint: "a".repeat(64) },
    { kind: "ACCEPTED", projectId: f.film.id, decisionId: "old", inputFingerprint: "a".repeat(64) },
  ]) {
    f.check.mockResolvedValueOnce(value as Awaited<ReturnType<typeof f.check>>);
    await expect(f.host.checkTrialDecision!(decisionId, f.lease)).rejects.toMatchObject({
      code: "PIPELINE_REQUEST_STALE",
    });
  }
  delete window.aijian!.checkFilmRiskTrialDecision;
  await expect(f.host.checkTrialDecision!(decisionId, f.lease)).rejects.toMatchObject({
    code: "PIPELINE_REQUEST_STALE",
  });
  expect(f.provider).not.toHaveBeenCalled();
});

it("persists the real pipeline runtime through the actual Pro lease before each real main check, including the next independent target", async () => {
  const { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join, resolve } = await import("node:path");
  const { createProductionPipeline } = await import("../film/production-pipeline");
  const { filmPipelineFingerprint, filmPipelineTargets, filmPipelineCheckpoint } =
    await import("./film-pipeline-controller");
  const { applyVideoResponse } = await import("./actions/generation-run");
  type OwnedTrials = {
    prepare(
      owner: number,
      input: Parameters<FilmRiskTrialGateway["prepareFilmRiskTrial"]>[0],
    ): ReturnType<FilmRiskTrialGateway["prepareFilmRiskTrial"]>;
    record(
      owner: number,
      input: Parameters<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]>[0],
    ): ReturnType<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]>;
    check(
      owner: number,
      input: Parameters<FilmRiskTrialGateway["checkFilmRiskTrialDecision"]>[0],
    ): ReturnType<FilmRiskTrialGateway["checkFilmRiskTrialDecision"]>;
  };
  // Normal Vitest source execution across workspace roots, not a product source-loader fallback.
  const nativePath = resolve("../desktop/src/film-risk-trial.ts");
  const libraryPath = resolve("../desktop/src/film-library.ts");
  const historyPath = resolve("../desktop/src/film-history.ts");
  const native = await vi.importActual<{ createFilmRiskTrials(host: unknown): OwnedTrials }>(
    nativePath,
  );
  const library = await vi.importActual<{
    writeProject(root: string, film: unknown): Promise<FilmProject>;
    readProject(root: string, id: string): Promise<FilmProject | null>;
    prepareProject(root: string, film: unknown): Promise<FilmProject>;
  }>(libraryPath);
  const history = await vi.importActual<{
    createFilmHistory(host: { filmsRoot: string }): {
      capture(input: unknown): Promise<{ kind: string }>;
      list(projectId: string): Promise<unknown>;
      restore(input: unknown): Promise<unknown>;
    };
  }>(historyPath);
  const root = await mkdtemp(join(tmpdir(), "试片主机真实队列 "));
  let f: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const film = sampleFilm();
    film.backendProjectId = `prj_${"f".repeat(32)}`;
    film.characters = [];
    film.locations = [];
    film.props = [];
    film.jobs = [];
    film.audioClips = [];
    film.narrationVoiceId = "eve";
    film.unassignedBeats = [];
    film.scenes = [{ ...film.scenes[0]!, title: "雨景", text: "雨落。", tags: [] }];
    const filmsRoot = join(root, "films"),
      storyFilmsRoot = join(root, "story"),
      media = join(filmsRoot, film.seriesId, "episodes", film.id, "media");
    await mkdir(media, { recursive: true });
    await mkdir(storyFilmsRoot);
    const video = join(media, "trial.mp4"),
      image = join(media, "first.png");
    await writeFile(video, "selected bytes for the persisted-runtime test; probe is controlled");
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWl8AAAAASUVORK5CYII=";
    await writeFile(image, Buffer.from(png, "base64"));
    film.shots = [0, 1, 2].map((index) => ({
      ...structuredClone(film.shots[0]!),
      id: `runtime-shot-${index}`,
      sceneId: film.scenes[0]!.id,
      no: index + 1,
      picture: "雨落。",
      action: "雨落。",
      actionBeats: [],
      line: "雨落。",
      lines: [{ speaker: "", text: "雨落。" }],
      speaker: "",
      characters: [],
      seconds: 3,
      continuityFromShotId: undefined,
      continuityFrame: undefined,
      poster: image,
      stills: [],
      selectedTakeId: index ? "" : "trial-take",
      takes: index
        ? []
        : [
            {
              id: "trial-take",
              shotId: "runtime-shot-0",
              index: 1,
              status: "done",
              videoPath: video,
              videoUrl: "",
              stillUrl: "",
              prompt: "已生成素材",
              reason: "",
              createdAt: "",
            },
          ],
    }));
    const fingerprint = await filmPipelineFingerprint(film),
      state = createProductionPipeline(film.id, fingerprint);
    for (const step of state.steps) {
      if (step.id === "video") break;
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
    state.status = "checkpoint";
    state.checkpoint = filmPipelineCheckpoint(film);
    film.productionPipeline = state;
    film.productionInputFingerprint = fingerprint;
    await library.writeProject(filmsRoot, film);
    const trials = native.createFilmRiskTrials({
      filmsRoot,
      storyFilmsRoot,
      tools: async () => ({ ffmpegPath: "controlled", ffprobePath: "controlled" }),
      run: async () => ({
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", duration: "1.25" }],
          format: { duration: "1.25" },
        }),
        stderr: "",
      }),
      videoOwner: async () => true,
    });
    const histories = history.createFilmHistory({ filmsRoot });
    const capture = vi.fn((input: unknown) => histories.capture(input));
    const runtime: {
      target?: string;
      status?: string;
      continued?: boolean;
      targetStatus?: string;
    }[] = [];
    f = await open({
      film,
      read: (id) => library.readProject(filmsRoot, id),
      write: (value) => library.writeProject(filmsRoot, value),
      prepare: (value) => library.prepareProject(filmsRoot, value),
      extra: {
        captureFilmHistory: capture,
        listFilmHistory: (id: string) => histories.list(id),
        restoreFilmHistory: (input: unknown) => histories.restore(input),
      },
      check: async (input) => {
        const actual = (await library.readProject(filmsRoot, film.id))!;
        const current = actual.productionPipeline!;
        runtime.push({
          target: input.targetShotId,
          status: current.status,
          continued: current.continued,
          targetStatus: current.steps
            .find((step) => step.id === "video")
            ?.targets.find((target) => target.id === input.targetShotId)?.status,
        });
        if (input.targetShotId) {
          expect(current.status).toBe("running");
          expect(current.current).toBe("video");
          expect(current.continued).toBe(true);
          expect(runtime.at(-1)!.targetStatus).toBe("running");
        }
        const result = await trials.check(1, input);
        expect(result.kind).toBe("ACCEPTED");
        return result;
      },
    });
    const lease = await f.queue().acquire(film.id);
    try {
      const before = f.editor.current()!;
      await lease.save(before, () => f!.editor.current() === before);
      const actual = (await library.readProject(filmsRoot, film.id))!;
      const ready = await trials.prepare(1, {
        projectId: film.id,
        expectedHash: await historyRecordHash(actual),
        shotId: film.shots[0]!.id,
        takeId: "trial-take",
      });
      expect(ready.kind).toBe("READY");
      if (ready.kind !== "READY") throw Error("main prepare failed");
      lease.beginExternalWrite!(() => f!.editor.current() === before);
      const recorded = await trials.record(1, {
        projectId: film.id,
        expectedHash: ready.projectHash,
        reviewId: ready.reviewId,
        decision: "accepted",
        note: "人工决定；非技术/费用授权",
      });
      expect(recorded.kind).toBe("RECORDED");
      if (recorded.kind !== "RECORDED") throw Error("main record failed");
      f.adopt(recorded.project as unknown as FilmProject);
      expect(
        lease.confirmExternalWrite!(
          recorded.project as unknown as FilmProject,
          f.editor.current()!,
          () => true,
        ),
      ).toBe(true);
      const decisionId = recorded.decision.id;
      await lease.release();
      const synthetic = vi.fn<pipeline.PipelineWorkspaceHost["submitGeneration"]>(
        async ([shot], control) => {
          const base = f!.editor.current()!,
            take = {
              id: `new-${shot!.id}`,
              shotId: shot!.id,
              index: 1,
              status: "running" as const,
              videoPath: "",
              videoUrl: "",
              stillUrl: "",
              prompt: "fixed",
              reason: "",
              createdAt: "",
            };
          await control.apply({
            ...base,
            shots: base.shots.map((row) =>
              row.id === shot!.id ? { ...row, takes: [...row.takes, take] } : row,
            ),
          });
          const output = join(media, `${shot!.id}.mp4`),
            voice = join(media, `${shot!.id}.wav`);
          await copyFile(video, output);
          await writeFile(voice, "controlled producer voice bytes");
          const response = applyVideoResponse(f!.editor.current()!, shot!, take, {
            status: "SUCCEEDED",
            output_path: output,
            voice_path: voice,
            preview_image: `data:image/png;base64,${png}`,
            duration_seconds: 5,
          });
          await control.apply(response.film);
        },
      );
      f.host.submitGeneration = synthetic;
      await act(async () => {
        await f!.adapter.continueAfterTrial(decisionId);
      });
      expect(runtime.map((row) => row.target)).toEqual([
        undefined,
        "runtime-shot-1",
        "runtime-shot-2",
      ]);
      expect(synthetic).toHaveBeenCalledTimes(2);
      expect(capture).toHaveBeenCalled();
      expect(f.provider).not.toHaveBeenCalled();
      const final = (await library.readProject(filmsRoot, film.id))!;
      expect(final.shots[0]!.selectedTakeId).toBe("trial-take");
      expect(
        final.shots
          .slice(1)
          .every((shot) => shot.takes.some((take) => take.status === "done" && take.videoPath)),
      ).toBe(true);
      expect(final.audioClips.filter((clip) => clip.label === "配音")).toHaveLength(2);
      expect((await readFile(video)).toString()).toBe(
        "selected bytes for the persisted-runtime test; probe is controlled",
      );
    } finally {
      await lease.release();
    }
  } finally {
    cleanup();
    if (f) await f.queue().flushAll();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
