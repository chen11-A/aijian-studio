import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FilmGenerationExecutionGateway } from "@aijian/contracts/film-generation-execution";
import { sampleFilm, type FilmProject } from "../film/project";
import { sceneLocationTargets } from "../film/location-reference";
import { historyRecordHash } from "./actions/persistent-history";
import { ProWorkspace } from "./ProWorkspace";
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
      poster: "",
      stills: [],
      takes: [],
      selectedTakeId: "",
    },
  ];
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
          videoSlotIds: Array.from({ length: t.versions }, (_, i) => `slot-${t.shotId}-${i}`),
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
  expect(calls.some((c) => (c[4] as { stageId: string }).stageId === "native-frame")).toBe(true);
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
