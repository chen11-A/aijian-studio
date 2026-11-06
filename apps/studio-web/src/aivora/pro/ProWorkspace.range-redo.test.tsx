import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { FilmRangeGateway } from "@aijian/contracts/film-range";
import { sampleFilm, type FilmProject } from "../film/project";
import { historyRecordHash } from "./actions/persistent-history";
import { ProWorkspace } from "./ProWorkspace";
beforeEach(() => localStorage.clear());
afterEach(() => {
  delete window.aijian;
  delete window.aijianGrok;
});
function fixture() {
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.scenes = [film.scenes[0]!];
  film.shots = film.shots.slice(0, 1);
  film.shots[0]!.sceneId = film.scenes[0]!.id;
  const shot = film.shots[0]!;
  shot.seconds = 4;
  shot.line = "原来的整句对白。";
  shot.lines = [];
  shot.selectedTakeId = "source";
  shot.takes = [
    {
      id: "source",
      shotId: shot.id,
      index: 1,
      status: "done",
      videoPath: "/media/original.mp4",
      videoUrl: "",
      stillUrl: "",
      prompt: "原画面",
      createdAt: "",
      reason: "",
      durationSeconds: 4,
    },
  ];
  let disk = structuredClone(film),
    fail = false;
  const events: string[] = [];
  const prepare = vi.fn<FilmRangeGateway["prepareFilmRange"]>(async (input) => {
    expect(input.projectId).toBe(disk.id);
    expect(input.takeId).toBe("source");
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    if (fail) return { kind: "FAILED", code: "INVALID_RANGE" };
    return {
      kind: "READY",
      planId: "rng_private",
      plan: {
        requested: { start: input.start, end: input.end },
        effective: { start: 1, end: 3 },
        duration: 4,
        generationSeconds: 2,
        frameRate: 24,
        speech: "preserve-original-audio",
      },
    };
  });
  const generate = vi.fn<FilmRangeGateway["generateFilmRange"]>(async (input) => {
    expect(input.confirmed).toBe(true);
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    expect(Object.keys(input).sort()).toEqual([
      "confirmed",
      "expectedHash",
      "planId",
      "projectId",
      "prompt",
    ]);
    events.push("history-saved", "ordinary-video");
    disk.shots[0]!.takes.push({
      ...disk.shots[0]!.takes[0]!,
      id: "segment",
      videoPath: "/media/segment.mp4",
    });
    return { kind: "GENERATED", project: structuredClone(disk), segmentTakeId: "segment" };
  });
  const finish = vi.fn<FilmRangeGateway["finishFilmRange"]>(async (input) => {
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    events.push("splice");
    disk.shots[0]!.takes.push({
      ...disk.shots[0]!.takes[0]!,
      id: "composed",
      videoPath: "/media/composed.mp4",
    });
    disk.shots[0]!.selectedTakeId = "composed";
    return { kind: "SPLICED", project: structuredClone(disk) };
  });
  const oldVideo = vi.fn(),
    still = vi.fn();
  const discard = vi.fn(async () => undefined);
  window.aijian = {
    prepareFilmRange: prepare,
    generateFilmRange: generate,
    finishFilmRange: finish,
    discardFilmRange: discard,
    readFilmProject: async () => structuredClone(disk),
    writeFilmProject: async (value: FilmProject) => {
      disk = structuredClone(value);
      return structuredClone(disk);
    },
    listFilmSeries: async () => [
      { id: film.seriesId, title: film.title, path: "/projects", savedAt: "" },
    ],
    listFilmEpisodes: async () => [
      {
        id: film.id,
        seriesId: film.seriesId,
        title: film.episodeTitle,
        no: 1,
        shots: 1,
        done: 1,
        savedAt: "",
      },
    ],
    listFilmHistory: async () => ({ kind: "LIST", entries: [], unreadable: 0 }),
    restoreFilmHistory: vi.fn(),
    captureFilmHistory: vi.fn(),
    createStoryFilm: oldVideo,
    generateFilmStill: still,
  } as unknown as Window["aijian"];
  window.aijianGrok = {
    status: async () => ({
      provider: "GROK_LOGIN",
      runtime: "DESKTOP",
      state: "CONNECTED",
      secureStorage: "AVAILABLE",
      accountLabel: "test",
      lastError: null,
    }),
    models: async () => ({
      kind: "OK",
      models: ["grok-imagine-video-1.5", "grok-imagine-image-2.0", "grok-4.7"].map((id) => ({
        id,
        label: id,
      })),
    }),
  } as unknown as Window["aijianGrok"];
  localStorage.setItem("aivora.film.activeId", film.id);
  return {
    film,
    prepare,
    generate,
    finish,
    oldVideo,
    still,
    discard,
    events,
    saved: () => disk,
    fail: () => {
      fail = true;
    },
  };
}
async function open() {
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() =>
    expect(document.querySelector(".pro-root")).toHaveAttribute("data-generate", "on"),
  );
  const tab = screen
    .getAllByRole("button", { name: /剪辑/ })
    .find((item) => item.className.includes("tab"))!;
  fireEvent.click(tab);
  fireEvent.click(screen.getByRole("button", { name: "设入点" }));
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  return screen.getByRole("dialog", { name: "秒级局部重做" });
}
it("shows actual seconds and audio/speech boundary before explicit single dispatch, retains original takes", async () => {
  const f = fixture(),
    dialog = await open();
  fireEvent.change(within(dialog).getByLabelText("局部重做入点"), { target: { value: "1.03" } });
  fireEvent.change(within(dialog).getByLabelText("局部重做出点"), { target: { value: "2.99" } });
  expect(dialog).toHaveTextContent("保留原完整音轨");
  expect(dialog).toHaveTextContent("无法精确扩展整句");
  fireEvent.click(within(dialog).getByRole("button", { name: "检查秒级范围" }));
  const confirm = await within(dialog).findByRole("button", { name: "确认生成此画面段" });
  expect(dialog).toHaveTextContent("1.030–2.990");
  expect(dialog).toHaveTextContent("1.000–3.000");
  expect(dialog).toHaveTextContent("约 2 秒");
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.saved().shots[0]!.selectedTakeId).toBe("source");
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(f.saved().shots[0]!.selectedTakeId).toBe("composed"));
  expect(f.generate).toHaveBeenCalledOnce();
  expect(f.finish).toHaveBeenCalledOnce();
  expect(f.events).toEqual(["history-saved", "ordinary-video", "splice"]);
  expect(f.saved().shots[0]!.takes.map((row) => row.id)).toEqual(["source", "segment", "composed"]);
  expect(f.oldVideo).not.toHaveBeenCalled();
  expect(f.still).not.toHaveBeenCalled();
  expect(dialog).not.toHaveTextContent("rng_private");
});
it("does not dispatch on invalid seconds or dismissal", async () => {
  const f = fixture(),
    dialog = await open();
  f.fail();
  fireEvent.click(within(dialog).getByRole("button", { name: "检查秒级范围" }));
  await within(dialog).findByText(/请选择单镜内至少1秒/);
  expect(within(dialog).queryByRole("button", { name: "确认生成此画面段" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.oldVideo).not.toHaveBeenCalled();
});
it("keeps approved range cancellation and missing bridge capability at zero ordinary requests", async () => {
  const f = fixture(),
    dialog = await open();
  fireEvent.click(within(dialog).getByRole("button", { name: "检查秒级范围" }));
  await within(dialog).findByRole("button", { name: "确认生成此画面段" });
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.discard).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
  delete window.aijian!.prepareFilmRange;
  fireEvent.click(screen.getByRole("button", { name: "检查秒级范围" }));
  expect(screen.getByRole("dialog", { name: "秒级局部重做" })).toHaveTextContent(
    "需要支持此功能的桌面版",
  );
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.oldVideo).not.toHaveBeenCalled();
});
it("cancels an in-flight local range inspection and discards its late plan without enabling generation", async () => {
  const f = fixture();
  let resolve!: () => void;
  const hold = new Promise<void>((done) => {
    resolve = done;
  });
  const original = f.prepare.getMockImplementation()!;
  f.prepare.mockImplementationOnce(async (input) => {
    await hold;
    return original(input);
  });
  const dialog = await open();
  fireEvent.click(within(dialog).getByRole("button", { name: "检查秒级范围" }));
  await waitFor(() => expect(f.prepare).toHaveBeenCalledOnce());
  fireEvent.click(within(dialog).getByRole("button", { name: "取消检查" }));
  expect(screen.queryByRole("dialog", { name: "秒级局部重做" })).toBeNull();
  resolve();
  await waitFor(() => expect(f.discard).toHaveBeenCalledWith(f.film.id, "rng_private"));
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.oldVideo).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "确认生成此画面段" })).toBeNull();
});
