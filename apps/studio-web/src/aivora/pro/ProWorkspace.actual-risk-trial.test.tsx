import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FilmRiskTrialGateway } from "@aijian/contracts/film-risk-trial";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { sampleFilm, type FilmProject } from "../film/project";
import * as pipeline from "./pipeline-workspace-host";
import { createProductionPipeline } from "../film/production-pipeline";
import {
  filmPipelineCheckpoint,
  filmPipelineFingerprint,
  filmPipelineTargets,
} from "./film-pipeline-controller";
import { ProWorkspace } from "./ProWorkspace";
import * as editor from "./actions/editor-host";
import * as persistence from "./film-persistence";
const originalEditor = editor.createEditorHost,
  originalQueue = persistence.createFilmPersistence;
const createUrl = URL.createObjectURL,
  revokeUrl = URL.revokeObjectURL;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  cleanup();
  for (const close of cleanups.splice(0)) await close();
  URL.createObjectURL = createUrl;
  URL.revokeObjectURL = revokeUrl;
  vi.restoreAllMocks();
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
type Native = {
  prepare(
    owner: number,
    input: Parameters<FilmRiskTrialGateway["prepareFilmRiskTrial"]>[0],
  ): ReturnType<FilmRiskTrialGateway["prepareFilmRiskTrial"]>;
  readMedia(
    owner: number,
    projectId: string,
    reviewId: string,
  ): ReturnType<FilmRiskTrialGateway["readFilmRiskTrialMedia"]>;
  record(
    owner: number,
    input: Parameters<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]>[0],
  ): ReturnType<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]>;
  check(
    owner: number,
    input: Parameters<FilmRiskTrialGateway["checkFilmRiskTrialDecision"]>[0],
  ): ReturnType<FilmRiskTrialGateway["checkFilmRiskTrialDecision"]>;
};
async function open(checkpoint = false) {
  const native = await vi.importActual<{ createFilmRiskTrials(host: unknown): Native }>(
    resolve("../desktop/src/film-risk-trial.ts"),
  );
  const library = await vi.importActual<{
    writeProject(root: string, value: unknown): Promise<FilmProject>;
    readProject(root: string, id: string): Promise<FilmProject | null>;
    prepareProject(root: string, value: unknown): Promise<FilmProject>;
  }>(resolve("../desktop/src/film-library.ts"));
  const root = await mkdtemp(join(tmpdir(), "actual-trial-ui-")),
    filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story");
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.characters = [];
  film.locations = [];
  film.props = [];
  film.jobs = [];
  film.audioClips = [];
  film.unassignedBeats = [];
  film.scenes = [{ ...film.scenes[0]!, text: "雨落。", tags: [] }];
  const media = join(filmsRoot, film.seriesId, "episodes", film.id, "media");
  await mkdir(media, { recursive: true });
  await mkdir(storyFilmsRoot);
  const video = join(media, "actual.mp4"),
    image = join(media, "first.png");
  await writeFile(video, "controlled video bytes; probe and decoding are separate");
  await writeFile(
    image,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWl8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  film.shots = [
    {
      ...film.shots[0]!,
      characters: [],
      sceneId: film.scenes[0]!.id,
      line: "",
      lines: [],
      picture: "雨落。",
      action: "雨落。",
      seconds: 4,
      continuityFromShotId: undefined,
      continuityFrame: undefined,
      stills: [],
      poster: image,
      selectedTakeId: "actual-take",
      takes: [
        {
          id: "actual-take",
          shotId: film.shots[0]!.id,
          index: 3,
          status: "done",
          videoPath: video,
          videoUrl: "",
          stillUrl: "",
          prompt: "",
          reason: "",
          createdAt: "",
        },
      ],
    },
  ];
  if (checkpoint) {
    film.shots.push({
      ...structuredClone(film.shots[0]!),
      id: "actual-next-shot",
      no: 2,
      selectedTakeId: "",
      takes: [],
    });
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
  }
  await library.writeProject(filmsRoot, film);
  let host!: Parameters<typeof originalEditor>[0], queue!: ReturnType<typeof originalQueue>;
  vi.spyOn(editor, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalEditor(value);
  });
  vi.spyOn(persistence, "createFilmPersistence").mockImplementation((value) => {
    queue = originalQueue(value);
    return queue;
  });
  let pipelineHost!: pipeline.PipelineWorkspaceHost;
  const nativePipeline = pipeline.createPipelineWorkspaceHost,
    recoveries = new Set<Promise<unknown>>();
  vi.spyOn(pipeline, "createPipelineWorkspaceHost").mockImplementation((value) => {
    pipelineHost = value;
    const adapter = nativePipeline(value),
      originalRecover = adapter.recover;
    adapter.recover = () => {
      const task = originalRecover();
      recoveries.add(task);
      void task.then(
        () => recoveries.delete(task),
        () => recoveries.delete(task),
      );
      return task;
    };
    const originalContinue = adapter.continueAfterTrial;
    adapter.continueAfterTrial = (id) => {
      const task = originalContinue(id);
      recoveries.add(task);
      void task.then(
        () => recoveries.delete(task),
        () => recoveries.delete(task),
      );
      return task;
    };
    return adapter;
  });
  const writes = new Set<Promise<unknown>>();
  const write = vi.fn((value: FilmProject) => {
    const task = library.writeProject(filmsRoot, value);
    writes.add(task);
    void task.then(
      () => writes.delete(task),
      () => writes.delete(task),
    );
    return task;
  });
  const controls: { beforeCommit?: () => Promise<void>; sourceValid: boolean } = {
    sourceValid: true,
  };
  const trials = native.createFilmRiskTrials({
    filmsRoot,
    storyFilmsRoot,
    tools: async () => ({ ffmpegPath: "controlled", ffprobePath: "controlled" }),
    run: async () => ({
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", duration: "2.25" }],
        format: { duration: "2.25" },
      }),
      stderr: "",
    }),
    videoOwner: async () => controls.sourceValid,
    beforeCommit: () => controls.beforeCommit?.(),
  });
  const prepare = vi.fn<FilmRiskTrialGateway["prepareFilmRiskTrial"]>((input) =>
      trials.prepare(1, input),
    ),
    mediaRead = vi.fn<FilmRiskTrialGateway["readFilmRiskTrialMedia"]>((id, reviewId) =>
      trials.readMedia(1, id, reviewId),
    ),
    record = vi.fn<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]>((input) =>
      trials.record(1, input),
    ),
    check = vi.fn<FilmRiskTrialGateway["checkFilmRiskTrialDecision"]>((input) =>
      trials.check(1, input),
    );
  const provider = vi.fn();
  window.aijian = {
    listFilmSeries: async () => [],
    readFilmProject: (id: string) => library.readProject(filmsRoot, id),
    writeFilmProject: write,
    prepareFilmProject: (value: FilmProject) => library.prepareProject(filmsRoot, value),
    prepareFilmRiskTrial: prepare,
    readFilmRiskTrialMedia: mediaRead,
    recordFilmRiskTrialDecision: record,
    checkFilmRiskTrialDecision: check,
    createStoryFilm: provider,
  } as unknown as Window["aijian"];
  URL.createObjectURL = vi.fn(() => "blob:controlled-actual-trial");
  URL.revokeObjectURL = vi.fn();
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await act(async () => {
    while (recoveries.size) await Promise.allSettled([...recoveries]);
    await queue.flushAll();
  });
  cleanups.push(async () => {
    await act(async () => {
      while (recoveries.size) await Promise.allSettled([...recoveries]);
      while (writes.size) await Promise.allSettled([...writes]);
      await queue.flushAll();
      while (writes.size) await Promise.allSettled([...writes]);
    });
    await rm(root, { recursive: true, force: true });
  });
  return {
    film,
    host,
    queue,
    prepare,
    mediaRead,
    record,
    check,
    provider,
    controls,
    write,
    raw: () => library.readProject(filmsRoot, film.id),
    video,
    pipeline: () => pipelineHost,
    async startReview() {
      fireEvent.click(
        within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
          name: /剪辑/,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "审核实际版本试片" }));
      return screen.findByRole("dialog", { name: "实际版本试片审核" });
    },
    async review() {
      fireEvent.click(
        within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
          name: /剪辑/,
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "审核实际版本试片" }));
      const dialog = await screen.findByRole("dialog", { name: "实际版本试片审核" });
      await within(dialog).findByText("实际素材时长：2.25 秒");
      return dialog;
    },
  };
}
it("mounts with zero trial calls, then uses real native media/FS and records an explicit needs-changes decision without continuing or changing media", async () => {
  const f = await open();
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.record).not.toHaveBeenCalled();
  expect(f.mediaRead).not.toHaveBeenCalled();
  expect(f.check).not.toHaveBeenCalled();
  const dialog = await f.review();
  const before = await f.raw();
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.mediaRead).toHaveBeenCalledTimes(1);
  expect(
    within(dialog)
      .getAllByRole("radio")
      .every((row) => !(row as HTMLInputElement).checked),
  ).toBe(true);
  fireEvent.ended(dialog.querySelector("video")!);
  expect(f.record).not.toHaveBeenCalled();
  const note = "  还需修改🙂\n原样保留  ";
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: note } });
  fireEvent.click(within(dialog).getByRole("radio", { name: "这个实际版本需要修改" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "保存本次人工决定" }));
  await within(dialog).findByText("人工决定已记录：需修改。");
  const after = (await f.raw())!;
  expect(after.riskTrialDecisions).toHaveLength(1);
  expect(after.riskTrialDecisions![0]!.note).toBe(note);
  expect(after.shots).toEqual(before!.shots);
  expect(after.audioClips).toEqual(before!.audioClips);
  expect(f.record).toHaveBeenCalledTimes(1);
  expect(f.provider).not.toHaveBeenCalled();
  expect(f.check).not.toHaveBeenCalled();
  expect(within(dialog).queryByRole("button", { name: "继续生成" })).toBeNull();
  expect((await f.queue.flushAll()).status).toBe("saved");
});
it("accounts for a closed late native write, keeps BUSY unknown, and resolves from the global panel without a second record", async () => {
  const f = await open(),
    dialog = await f.review(),
    entered = gate<void>(),
    release = gate<void>();
  f.controls.beforeCommit = async () => {
    entered.resolve();
    await release.promise;
  };
  fireEvent.click(within(dialog).getByRole("radio", { name: "接受这个实际版本" }));
  fireEvent.click(within(dialog).getByRole("checkbox"));
  const actual = f.record.getMockImplementation()!;
  let nativeRecord: ReturnType<FilmRiskTrialGateway["recordFilmRiskTrialDecision"]> | undefined;
  cleanups.unshift(async () => {
    release.resolve();
    await nativeRecord;
  });
  f.record.mockImplementationOnce(async (input) => {
    nativeRecord = actual(input);
    await entered.promise;
    throw Error("LOST_ACK_PRIVATE");
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "保存本次人工决定" }));
  await entered.promise;
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  await screen.findByRole("button", { name: "试片记录待核对（1）" });
  expect((await f.queue.flushAll()).status).toBe("unknown");
  fireEvent.click(screen.getByRole("button", { name: "试片记录待核对（1）" }));
  const panel = screen.getByRole("dialog", { name: "试片记录保存状态" });
  fireEvent.click(within(panel).getByRole("button", { name: "核对试片保存结果" }));
  await within(panel).findByText("本机记录还在处理中，请稍后手动核对，不要重复记录。");
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.raw())!.riskTrialDecisions).toBeUndefined();
  expect((await f.queue.flushAll()).status).toBe("unknown");
  release.resolve();
  await nativeRecord;
  fireEvent.click(within(panel).getByRole("button", { name: "核对试片保存结果" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "试片记录待核对（1）" })).toBeNull(),
  );
  expect(
    within(panel).getByText("人工决定已记录。继续仍须重新确认生成范围、数量与费用。"),
  ).toBeVisible();
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.raw())!.riskTrialDecisions).toHaveLength(1);
  expect((await f.queue.flushAll()).status).toBe("saved");
  expect(f.provider).not.toHaveBeenCalled();
});

it("does not continue from an accepted record or ended event, uses the original complete checkpoint, and rejects changed source at the real final main check", async () => {
  const f = await open(true),
    dialog = await f.review();
  fireEvent.ended(dialog.querySelector("video")!);
  fireEvent.click(within(dialog).getByRole("radio", { name: "接受这个实际版本" }));
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "保存本次人工决定" }));
  await within(dialog).findByText("人工决定已记录：接受。");
  expect(f.check).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
  const continuing = within(dialog).getByRole("button", { name: "继续生成" });
  expect(continuing).toBeEnabled();
  expect(dialog.textContent).toContain("1 次生成");
  expect(dialog.textContent).toContain("用会员额度");
  // Local test supplies the already existing API project and existing pre-run checkpoint;
  // provider remains forbidden. The actual native checker sees changed source ownership.
  f.pipeline().ensureBillingProject = async () => f.film.backendProjectId!;
  f.pipeline().beforeRun = async () => undefined;
  await writeFile(f.video, "different actual selected video bytes after human record");
  fireEvent.click(continuing);
  fireEvent.click(continuing);
  await waitFor(() => expect(f.check).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(f.check.mock.settledResults[0]?.type).toBe("fulfilled"));
  expect(f.check.mock.settledResults[0]?.value).toMatchObject({
    kind: "FAILED",
    code: "REVIEW_STALE",
  });
  expect(f.provider).not.toHaveBeenCalled();
  expect(f.record).toHaveBeenCalledTimes(1);
  expect((await f.raw())!.shots[0]!.takes).toHaveLength(1);
});

it("closes a pending read and changes page without displaying late media or recording a decision", async () => {
  const f = await open(),
    entered = gate<void>(),
    release = gate<void>(),
    actual = f.prepare.getMockImplementation()!;
  cleanups.unshift(async () => release.resolve());
  f.prepare.mockImplementationOnce(async (input) => {
    const result = await actual(input);
    entered.resolve();
    await release.promise;
    return result;
  });
  const dialog = await f.startReview();
  await entered.promise;
  expect((await f.queue.flushAll()).status).toBe("saved");
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剧本/,
    }),
  );
  await act(async () => {
    release.resolve();
    await f.prepare.mock.results[0]!.value;
  });
  expect(screen.queryByRole("dialog", { name: "实际版本试片审核" })).toBeNull();
  expect(f.mediaRead).not.toHaveBeenCalled();
  expect(f.record).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
});
it("exposes save failure before native preparation and preserves the actual draft for retry", async () => {
  const f = await open(),
    original = f.host.current()!;
  f.write.mockRejectedValueOnce(Error("PRIVATE_SAVE_DETAIL"));
  const dialog = await f.startReview();
  await within(dialog).findByText("当前编辑还没保存上，请先核对保存状态，再准备试片。");
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.record).not.toHaveBeenCalled();
  expect(f.host.current()!.shots).toEqual(original.shots);
  expect(dialog.textContent).not.toContain("PRIVATE_SAVE_DETAIL");
  await act(async () => {
    await f.queue.flushAll();
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "重新核对实际素材" }));
  await within(dialog).findByText("实际素材时长：2.25 秒");
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.provider).not.toHaveBeenCalled();
});
it.each(["videoPath", "cleanVideoPath"] as const)(
  "retires the displayed Blob and old form when the same selected take changes %s",
  async (field) => {
    const f = await open(),
      dialog = await f.review(),
      before = f.host.current()!;
    fireEvent.click(within(dialog).getByRole("radio", { name: "接受这个实际版本" }));
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(within(dialog).getByRole("button", { name: "保存本次人工决定" })).toBeEnabled();
    await act(async () =>
      f.host.applyLive({
        ...before,
        shots: before.shots.map((shot) =>
          shot.id === before.shots[0]!.id
            ? {
                ...shot,
                takes: shot.takes.map((take) =>
                  take.id === "actual-take" ? { ...take, [field]: `${f.video}.changed.mp4` } : take,
                ),
              }
            : shot,
        ),
      }),
    );
    await within(dialog).findByText("创作输入或选版已变化，请重新核对实际试片。");
    expect(dialog.querySelector("video")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:controlled-actual-trial");
    expect(within(dialog).queryByRole("button", { name: "保存本次人工决定" })).toBeNull();
    expect(f.record).not.toHaveBeenCalled();
    expect(f.check).not.toHaveBeenCalled();
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.prepare).toHaveBeenCalledTimes(1);
  },
);
