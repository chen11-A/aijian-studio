import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FilmGenerationExecutionGateway } from "@aijian/contracts/film-generation-execution";
import { sampleFilm, type FilmProject } from "../film/project";
import { sceneLocationTargets } from "../film/location-reference";
import { historyRecordHash } from "./actions/persistent-history";
import { runPipelineAgentAction } from "./pipeline-agent-actions";
import { ProWorkspace } from "./ProWorkspace";
import { saveStillReview, stillChecklist } from "./still-acceptance";
vi.mock("./pipeline-agent-actions", () => ({ runPipelineAgentAction: vi.fn() }));
const projectId = `prj_${"a".repeat(32)}`;
function fixture() {
  const film = sampleFilm();
  film.backendProjectId = projectId;
  film.characters = [];
  film.scenes = [film.scenes[1]!];
  film.shots = [
    {
      ...film.shots[0]!,
      sceneId: film.scenes[0]!.id,
      characters: [],
      line: "",
      lines: [],
      speaker: "",
      poster: "/tmp/adopted-frame.png",
      stills: [],
      takes: [],
      selectedTakeId: "",
    },
  ];
  const shot = film.shots[0]!;
  const verdicts = Object.fromEntries(
    stillChecklist(film, shot).map((item) => [item.id, "match" as const]),
  );
  const reviewed = saveStillReview(film, shot.id, verdicts, "2026-11-10T00:00:00.000Z");
  if (!reviewed.adopted) throw new Error(reviewed.error);
  film.shots = reviewed.film.shots;
  let stored = structuredClone(film);
  const video = vi.fn(async () => ({
    data: { status: "SUCCEEDED", output_path: "/tmp/new-execution.mp4" },
  }));
  const still = vi.fn(async () => ({ path: "/tmp/new-execution.png", reason: "" }));
  const capture = vi.fn(async (input: { expectedHash: string }) => {
    expect(input.expectedHash).toBe(await historyRecordHash(stored));
    return {
      kind: "CAPTURED",
      entry: {
        id: `hst_${"a".repeat(32)}`,
        createdAt: "2026-01-01",
        reason: "before-batch-generation",
        summary: { scenes: 1, shots: 1, done: 0 },
      },
    };
  });
  const prepare = vi.fn<FilmGenerationExecutionGateway["prepareFilmGenerationExecution"]>(
    async (input) => {
      expect(capture).toHaveBeenCalledTimes(1);
      expect(input.expectedProjectHash).toBe(await historyRecordHash(stored));
      expect(stored.shots[0]!.takes).toEqual([]);
      return {
        kind: "PREPARED",
        executionId: "native-execution",
        projectId: film.id,
        projectHash: input.expectedProjectHash,
        targets: input.targets.map((t) => ({
          shotId: t.shotId,
          preparation: "CLIENT_IMAGES" as const,
          videoSlotIds: Array.from({ length: t.versions }, (_, i) => `slot-${t.shotId}-${i}`),
          slotPreparations: Array.from(
            { length: t.versions },
            (_, i) => `slot-${t.shotId}-${i}`,
          ).map((videoSlotId) => ({ videoSlotId, preparation: "CLIENT_IMAGES" as const })),
        })),
        stages: [
          ...sceneLocationTargets(stored).map((p) => ({
            stageId: `location-${p.id}`,
            kind: "location-reference" as const,
            targetId: p.id,
          })),
          { stageId: "native-frame", kind: "shot-frame", targetId: film.shots[0]!.id },
        ],
      };
    },
  );
  const retire = vi.fn<FilmGenerationExecutionGateway["retireFilmGenerationExecution"]>(
    async () => ({ kind: "RETIRED" }),
  );
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(stored)),
    writeFilmProject: vi.fn(async (next: FilmProject) => {
      stored = structuredClone(next);
      return structuredClone(stored);
    }),
    prepareFilmProject: vi.fn(async (next: FilmProject) => structuredClone(next)),
    listFilmHistory: vi.fn(async () => ({ kind: "LIST", entries: [], unreadable: 0 })),
    restoreFilmHistory: vi.fn(async () => {
      throw new Error("RESTORE_FORBIDDEN");
    }),
    captureFilmHistory: capture,
    createStoryFilm: video,
    generateFilmStill: still,
    prepareFilmGenerationExecution: prepare,
    retireFilmGenerationExecution: retire,
  } as unknown as Window["aijian"];
  window.aijianGrok = {
    status: vi.fn(async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "owner",
      lastError: null,
    })),
    models: vi.fn(async () => ({
      kind: "OK",
      models: [
        { id: "grok-imagine-video-1.5", label: "video" },
        { id: "grok-imagine-image-2.0", label: "image" },
      ],
    })),
  } as unknown as Window["aijianGrok"];
  window.localStorage.setItem("aivora.film.activeId", film.id);
  return { film, prepare, retire, video, still, capture, stored: () => stored };
}
async function open() {
  render(<ProWorkspace projectId={projectId} />);
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  await screen.findByRole("navigation", { name: "创作阶段" });
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /分镜/,
    }),
  );
}
function submit(versions = 1) {
  fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
  if (versions === 2) fireEvent.click(screen.getByRole("button", { name: "2" }));
  fireEvent.click(screen.getByRole("button", { name: `生成 ${versions} 个版本` }));
  fireEvent.click(screen.getByRole("button", { name: "开始生成" }));
}
beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
  vi.mocked(runPipelineAgentAction).mockReset();
});
afterEach(cleanup);
it("prepares only after explicit confirmation and real canonical backup, then forwards the issued image and video contexts", async () => {
  const f = fixture();
  await open();
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  submit();
  await waitFor(() => expect(f.video).toHaveBeenCalledTimes(1));
  const calls = f.still.mock.calls as unknown as unknown[][];
  expect(calls.length).toBeGreaterThan(0);
  expect(
    calls.every(
      (c) => c.length === 5 && (c[4] as { executionId: string }).executionId === "native-execution",
    ),
  ).toBe(true);
  expect(calls.some((c) => (c[4] as { stageId: string }).stageId === "native-frame")).toBe(false);
  const video = f.video.mock.calls as unknown as unknown[][];
  expect(video[0]![3]).toEqual({
    executionId: "native-execution",
    videoSlotId: `slot-${f.film.shots[0]!.id}-0`,
    shotId: f.film.shots[0]!.id,
    takeId: expect.any(String),
  });
  await waitFor(() => expect(f.retire).toHaveBeenCalledWith({ executionId: "native-execution" }));
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.stored())).not.toContain("native-execution");
});
it("missing protected capability never falls back to automatic still or video dispatch", async () => {
  const f = fixture();
  delete window.aijian!.prepareFilmGenerationExecution;
  await open();
  submit();
  await screen.findByText("当前桌面版本还不支持受保护的自动生成，请更新后再试。");
  expect(f.still).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
  expect(f.stored().shots[0]!.takes).toEqual([]);
});
it("retires a late prepared execution after the account epoch changes, without allocating a take or dispatching an image", async () => {
  const f = fixture();
  const original = f.prepare.getMockImplementation()!;
  let release!: () => void;
  let admitted!: () => void;
  const entered = new Promise<void>((resolve) => {
    admitted = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.prepare.mockImplementation(async (input) => {
    const reply = await original(input);
    admitted();
    await hold;
    return reply;
  });
  await open();
  submit();
  await entered;
  window.dispatchEvent(new Event("aivora-grok-changed"));
  release();
  await waitFor(() =>
    expect(f.retire).toHaveBeenCalledExactlyOnceWith({ executionId: "native-execution" }),
  );
  expect(f.still).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
  expect(f.stored().shots[0]!.takes).toEqual([]);
});

it("TaskCenter retires the running slot immediately, then preserves the paused sibling for the original resume flow", async () => {
  const f = fixture();
  let release!: (value: { data: { status: string; output_path: string } }) => void;
  f.video.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  try {
    await open();
    submit(2);
    await waitFor(() => expect(f.video).toHaveBeenCalledTimes(1));
    const queued = structuredClone(f.stored().shots[0]!.takes[1]);
    fireEvent.click(screen.getByRole("button", { name: /后台生成/ }));
    fireEvent.click(await screen.findByRole("button", { name: "停下这一次" }));
    expect(f.retire).toHaveBeenNthCalledWith(1, {
      executionId: "native-execution",
      videoSlotId: `slot-${f.film.shots[0]!.id}-0`,
    });
    await waitFor(() => expect(f.retire).toHaveBeenCalledWith({ executionId: "native-execution" }));
    expect(f.video).toHaveBeenCalledTimes(1);
    expect(f.stored().shots[0]!.takes[1]).toEqual(queued);
    expect(f.stored().shots[0]!.takes[1]!.status).toBe("queued");
  } finally {
    release?.({ data: { status: "SUCCEEDED", output_path: "/tmp/late-cancelled.mp4" } });
  }
});

it("only explicit native STORYFILM_CACHE skips all client images, without treating missing stages as cache", async () => {
  const f = fixture();
  const original = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementation(async (input) => {
    const reply = await original(input);
    if (reply.kind !== "PREPARED") return reply;
    return {
      ...reply,
      stages: [],
      targets: reply.targets.map((t) => ({
        ...t,
        preparation: "STORYFILM_CACHE",
        slotPreparations: t.slotPreparations.map((slot) => ({
          ...slot,
          preparation: "STORYFILM_CACHE" as const,
        })),
      })),
    };
  });
  delete window.aijian!.generateFilmStill;
  await open();
  submit();
  await waitFor(() => expect(f.video).toHaveBeenCalledTimes(1));
  expect(f.still).not.toHaveBeenCalled();
  await waitFor(() => expect(f.retire).toHaveBeenCalledWith({ executionId: "native-execution" }));
});
it("CLIENT_IMAGES with a missing issued stage cannot silently use an unprotected image path", async () => {
  const f = fixture();
  const original = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementation(async (input) => {
    const reply = await original(input);
    return reply.kind === "PREPARED" ? { ...reply, stages: [] } : reply;
  });
  await open();
  submit();
  await waitFor(() => expect(f.retire).toHaveBeenCalledWith({ executionId: "native-execution" }));
  expect(f.still).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
});
it.each(["fixed-result", "transport"])(
  "protected image %s uncertainty stops without retry or later video, preserving the existing work",
  async (mode) => {
    const f = fixture();
    if (mode === "transport") f.still.mockRejectedValueOnce(Error("PRIVATE-DO-NOT-DISPLAY"));
    else
      f.still.mockResolvedValueOnce(
        Object.assign(
          { path: "/tmp/kept-native-image.png", reason: "PRIVATE-DO-NOT-DISPLAY" },
          { code: "WRITE_UNCONFIRMED" },
        ),
      );
    await open();
    submit();
    await screen.findAllByText("生成记录尚未确认，已停后续请求，请先核对任务和素材。");
    await waitFor(() => expect(f.retire).toHaveBeenCalledWith({ executionId: "native-execution" }));
    expect(f.still).toHaveBeenCalledTimes(1);
    expect(f.video).not.toHaveBeenCalled();
    expect(f.stored().shots[0]!.poster).toBe("/tmp/adopted-frame.png");
    expect(f.stored().locations.some((p) => p.referenceImage?.includes("kept-native-image"))).toBe(
      false,
    );
    expect(screen.queryByText(/PRIVATE-DO-NOT-DISPLAY/)).toBeNull();
  },
);

it("fresh real Pro runs text structure first and waits for explicit complete media scope confirmation before native preparation", async () => {
  const f = fixture();
  const template = {
    ...f.film.shots[0]!,
    picture: "雨落。",
    action: "雨落。",
    seconds: 3,
    poster: "",
    stills: [],
  };
  const fresh = {
    ...f.film,
    sourceText: "雨落。",
    unassignedBeats: [],
    shots: [],
    scenes: [{ ...f.film.scenes[0]!, text: "雨落。", title: "书店", tags: [] }],
  };
  await window.aijian!.writeFilmProject!(fresh);
  const textOrder: string[] = [];
  vi.mocked(runPipelineAgentAction).mockImplementation(async (film, target) => {
    textOrder.push(target.step);
    return {
      status: "done",
      code: "STEP_COMPLETE",
      film:
        target.step === "director"
          ? { ...film, shots: [{ ...template, sceneId: target.targetId }] }
          : film,
    };
  });
  f.prepare.mockImplementation(async (input) => {
    expect(f.capture).toHaveBeenCalledTimes(2);
    expect(input.mode).toBe("pipeline");
    expect(input.targets).toEqual([{ shotId: template.id, versions: 1 }]);
    expect(input.expectedProjectHash).toBe(await historyRecordHash(f.stored()));
    expect(f.stored().shots[0]!.takes).toEqual([]);
    return {
      kind: "PREPARED",
      executionId: "native-execution",
      projectId: input.projectId,
      projectHash: input.expectedProjectHash,
      targets: [
        {
          shotId: template.id,
          videoSlotIds: ["fresh-slot"],
          slotPreparations: ["fresh-slot"].map((videoSlotId) => ({
            videoSlotId,
            preparation: "CLIENT_IMAGES" as const,
          })),
          preparation: "CLIENT_IMAGES",
        },
      ],
      stages: [
        ...sceneLocationTargets(f.stored()).map((p) => ({
          stageId: `location-${p.id}`,
          kind: "location-reference" as const,
          targetId: p.id,
        })),
        { stageId: "native-frame", kind: "shot-frame", targetId: template.id },
      ],
    };
  });
  render(<ProWorkspace projectId={projectId} />);
  await screen.findByRole("navigation", { name: "创作阶段" });
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  fireEvent.click(screen.getByRole("button", { name: "一键成片" }));
  const progress = await screen.findByRole("region", { name: "一键成片进度" });
  await waitFor(() =>
    expect(within(progress).getByRole("button", { name: "继续生成" })).toBeEnabled(),
  );
  expect(textOrder).toEqual(["writer", "writer", "art", "director", "prompter"]);
  expect(progress.textContent).toContain("视频最多 1 次生成");
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  expect(f.video).not.toHaveBeenCalled();
  expect(f.stored().productionPipeline).toMatchObject({
    status: "checkpoint",
    current: "portraits",
    continued: false,
  });
  fireEvent.click(within(progress).getByRole("button", { name: "继续生成" }));
  await waitFor(() =>
    expect(f.stored().productionPipeline).toMatchObject({
      status: "needs-input",
      current: "review",
      continued: false,
    }),
  );
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.still).toHaveBeenCalledTimes(2);
  expect(f.video).not.toHaveBeenCalled();
  expect(JSON.stringify(f.stored())).not.toContain("native-execution");
});

it("keeps a native cached first slot separate from the later explicitly issued client-image version", async () => {
  const f = fixture(),
    original = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementation(async (input) => {
    const reply = await original(input);
    if (reply.kind !== "PREPARED") return reply;
    return {
      ...reply,
      targets: reply.targets.map((target) => ({
        ...target,
        slotPreparations: target.slotPreparations.map((slot, index) => ({
          ...slot,
          preparation: index === 0 ? ("STORYFILM_CACHE" as const) : ("CLIENT_IMAGES" as const),
        })),
      })),
    };
  });
  f.video.mockImplementation(async () => {
    const frameCalls = (f.still.mock.calls as unknown as unknown[][]).filter(
      (call) => (call[4] as { stageId: string }).stageId === "native-frame",
    );
    expect(frameCalls).toHaveLength(0);
    return { data: { status: "SUCCEEDED", output_path: "/tmp/new-execution.mp4" } };
  });
  await open();
  submit(2);
  await waitFor(() => expect(f.video).toHaveBeenCalledTimes(2));
  const contexts = f.video.mock.calls as unknown as unknown[][];
  expect(contexts.map((call) => (call[3] as { videoSlotId: string }).videoSlotId)).toEqual([
    `slot-${f.film.shots[0]!.id}-0`,
    `slot-${f.film.shots[0]!.id}-1`,
  ]);
  expect(contexts.map((call) => (call[1] as { regenerate: boolean }).regenerate)).toEqual([
    false,
    true,
  ]);
  expect(contexts[1]![3]).toEqual({
    executionId: "native-execution",
    videoSlotId: `slot-${f.film.shots[0]!.id}-1`,
    shotId: f.film.shots[0]!.id,
    takeId: expect.any(String),
  });
  const prepared = await f.prepare.mock.results[0]!.value;
  expect(prepared).toMatchObject({
    kind: "PREPARED",
    targets: [
      {
        slotPreparations: [{ preparation: "STORYFILM_CACHE" }, { preparation: "CLIENT_IMAGES" }],
      },
    ],
  });
  expect(f.prepare).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(f.stored().shots[0]!.takes.filter((take) => take.status === "done")).toHaveLength(2),
  );
  expect(JSON.stringify(f.stored())).not.toContain("native-execution");
});
