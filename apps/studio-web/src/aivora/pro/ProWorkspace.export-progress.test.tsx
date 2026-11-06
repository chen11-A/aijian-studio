import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { saveFilm } from "../film/library";
import type {
  FilmExportCancelAck,
  FilmExportProgressEvent,
  FilmExportQcInput,
  FilmExportQcPrepared,
  FilmExportQcPublishInput,
  FilmExportQcPublishResult,
} from "@aijian/contracts/film-export-qc";
import { ProWorkspace } from "./ProWorkspace";
const report = {
  schemaVersion: 1,
  media: { duration: 1, width: 1280, height: 720 },
  audio: { present: true, integratedLufs: -16, truePeakDbtp: -2 },
  assumptions: {},
  issues: [],
};
const ready: FilmExportQcPrepared = {
  kind: "READY",
  qcReceipt: "review-receipt",
  outputs: [{ aspectRatio: "16:9", report }],
  shots: [],
  fileName: "片名.mp4",
  unverified: ["台词完整性未检查。"],
};
async function open() {
  const film = sampleFilm();
  film.scenes = [film.scenes[0]!];
  film.shots = film.shots.slice(0, 1).map((shot) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    selectedTakeId: "take-ready",
    takes: [
      {
        id: "take-ready",
        shotId: shot.id,
        index: 1,
        status: "done" as const,
        stillUrl: "",
        videoPath: "/source/video.mp4",
        videoUrl: "",
        prompt: "",
        createdAt: "",
        reason: "",
      },
    ],
  }));
  film.audioClips = [];
  await saveFilm(film);
  const other = structuredClone(film);
  other.id = "film_progressother0001";
  other.episodeTitle = "第 2 集";
  other.episodeNo = 2;
  const stored = new Map([
    [film.id, structuredClone(film)],
    [other.id, other],
  ]);
  let listener: ((value: FilmExportProgressEvent) => void) | undefined;
  let resolvePrepare!: (
      value: FilmExportQcPrepared | { kind: "FAILED"; code: "OPERATION_STOPPED" },
    ) => void,
    resolvePublish!: (value: FilmExportQcPublishResult) => void;
  const prepare = vi.fn(
    (_input: FilmExportQcInput, _id?: string) =>
      new Promise<FilmExportQcPrepared | { kind: "FAILED"; code: "OPERATION_STOPPED" }>(
        (resolve) => {
          resolvePrepare = resolve;
        },
      ),
  );
  const publish = vi.fn(
    (_input: FilmExportQcPublishInput, _id?: string) =>
      new Promise<FilmExportQcPublishResult>((resolve) => {
        resolvePublish = resolve;
      }),
  );
  const cancel = vi.fn(async (_id: string): Promise<FilmExportCancelAck> => ({
      kind: "REQUESTED",
    })),
    discard = vi.fn(async () => undefined),
    old = vi.fn(),
    play = vi.fn();
  window.aijian = {
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.title, savedAt: "", path: "" },
    ]),
    listFilmEpisodes: vi.fn(async () =>
      [...stored.values()].map((value) => ({
        id: value.id,
        seriesId: value.seriesId,
        title: value.episodeTitle,
        no: value.episodeNo,
        shots: value.shots.length,
        done: 1,
        savedAt: "",
      })),
    ),
    readFilmProject: vi.fn(async (id: string) => structuredClone(stored.get(id) ?? null)),
    writeFilmProject: vi.fn(async (value: FilmProject) => {
      stored.set(value.id, structuredClone(value));
      return value;
    }),
    prepareFilmExport: prepare,
    publishFilmExport: publish,
    cancelFilmExportOperation: cancel,
    discardFilmExport: discard,
    onFilmExportProgress: (next: (value: FilmExportProgressEvent) => void) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    exportFilmCut: old,
    assembleFilm: old,
    createStoryFilm: old,
    openFilmPath: play,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  const prepareId = () => prepare.mock.calls.at(-1)![1]!,
    publishId = () => publish.mock.calls.at(-1)![1]!;
  const event = (
    id: string,
    seq: number,
    extra: Partial<FilmExportProgressEvent> = {},
  ): FilmExportProgressEvent => ({
    operationId: id,
    projectId: film.id,
    seq,
    phase: "rendering",
    cancelState: "available",
    published: [],
    ...extra,
  });
  const emit = async (value: FilmExportProgressEvent) => {
    await act(async () => listener?.(value));
  };
  return {
    film,
    prepare,
    publish,
    cancel,
    discard,
    old,
    play,
    prepareId,
    publishId,
    event,
    emit,
    start: async () => {
      fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
      await waitFor(() => expect(prepare).toHaveBeenCalled());
    },
    ready: async () => {
      await act(async () => resolvePrepare(ready));
    },
    stopped: async () => {
      await act(async () => resolvePrepare({ kind: "FAILED", code: "OPERATION_STOPPED" }));
    },
    published: async (value: FilmExportQcPublishResult) => {
      await act(async () => resolvePublish(value));
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
describe("actual workspace independent export execution feed", () => {
  it("stops the old work on an actual project switch and refuses its late READY and completion", async () => {
    const f = await open();
    await f.start();
    const old = f.prepareId();
    await f.emit(f.event(old, 1));
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    await screen.findByText(/已打开第 2 集/);
    await waitFor(() => expect(f.cancel).toHaveBeenCalledWith(old));
    await f.ready();
    await f.emit(f.event(old, 30, { phase: "completed", cancelState: "unavailable" }));
    await waitFor(() => expect(f.discard).toHaveBeenCalledWith(ready.qcReceipt));
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    expect(screen.getByRole("button", { name: "审核后发布" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "审核后发布" }));
    expect(screen.queryByText("台词完整性未检查。")).toBeNull();
    expect(screen.queryByRole("heading", { name: "本次发布结束" })).toBeNull();
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.old).not.toHaveBeenCalled();
  });

  it("keeps a NOT_FOUND stop unknown instead of claiming it stopped", async () => {
    const f = await open();
    await f.start();
    const id = f.prepareId();
    await f.emit(f.event(id, 1));
    f.cancel.mockResolvedValueOnce({ kind: "NOT_FOUND" });
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    expect(await screen.findByRole("heading", { name: "当前处理状态待确认" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "处理已停止" })).toBeNull();
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("keeps a network-unknown stop locked until an authoritative event", async () => {
    const f = await open();
    await f.start();
    const id = f.prepareId();
    await f.emit(f.event(id, 1));
    f.cancel.mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    await waitFor(() => expect(f.cancel).toHaveBeenCalledTimes(1));
    await f.emit(f.event(id, 2));
    expect(screen.getByRole("button", { name: "正在请求停止" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "处理已停止" })).toBeNull();
    await f.emit(f.event(id, 3, { phase: "failed", cancelState: "stopped" }));
    expect(screen.getByRole("heading", { name: "处理已停止" })).toBeInTheDocument();
  });

  it("keeps one execution identity over rerenders and close/reopen; ready is a review, not completion", async () => {
    const f = await open();
    await f.start();
    const id = f.prepareId();
    expect(id).toMatch(/^[\w-]+$/);
    await f.emit(
      f.event(id, 1, { progress: { kind: "units", completed: 1, total: 2, unit: "画幅" } }),
    );
    expect(screen.getByRole("progressbar", { name: "本阶段进度" })).toHaveAttribute("value", "1");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(f.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    expect(f.prepareId()).toBe(id);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    await f.emit(f.event(id, 2, { phase: "checking" }));
    expect(screen.getByRole("progressbar", { name: "本阶段进度" })).not.toHaveAttribute("value");
    await f.emit(f.event(id, 3, { phase: "waitingReview", cancelState: "unavailable" }));
    await f.ready();
    expect(screen.getByRole("heading", { name: "等待审核检查结果" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "本次发布结束" })).toBeNull();
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.old).not.toHaveBeenCalled();
  });
  it("shows REQUESTED without claiming stopped, then waits for authoritative STOPPED", async () => {
    const f = await open();
    await f.start();
    const id = f.prepareId();
    await f.emit(f.event(id, 1));
    f.cancel.mockResolvedValueOnce({
      kind: "REQUESTED",
      snapshot: f.event(id, 3, { cancelState: "requested" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    await screen.findByRole("button", { name: "正在请求停止" });
    expect(screen.queryByRole("heading", { name: "处理已停止" })).toBeNull();
    await f.emit(f.event(id, 2, { cancelState: "available" }));
    expect(screen.getByRole("button", { name: "正在请求停止" })).toBeDisabled();
    await f.emit(f.event(id, 4, { phase: "failed", cancelState: "stopped" }));
    await f.stopped();
    expect(screen.getByRole("heading", { name: "处理已停止" })).toBeInTheDocument();
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.publish).not.toHaveBeenCalled();
  });
  it("uses an explicit UNAVAILABLE ACK to permit a second stop in the next aspect of the same operation", async () => {
    const f = await open();
    await f.start();
    const id = f.prepareId();
    await f.emit(f.event(id, 1));
    f.cancel.mockResolvedValueOnce({
      kind: "UNAVAILABLE",
      snapshot: f.event(id, 2, { phase: "publishing", cancelState: "unavailable" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    await waitFor(() => expect(f.cancel).toHaveBeenCalledTimes(1));
    await f.emit(f.event(id, 3, { phase: "publishing", cancelState: "available" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "停止处理" })).toBeEnabled());
    f.cancel.mockResolvedValueOnce({
      kind: "REQUESTED",
      snapshot: f.event(id, 4, { cancelState: "requested" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "停止处理" }));
    await waitFor(() => expect(f.cancel).toHaveBeenCalledTimes(2));
    expect(f.cancel.mock.calls.map((call) => call[0])).toEqual([id, id]);
    expect(screen.queryByRole("heading", { name: "处理已停止" })).toBeNull();
  });
  it("rejects old executions, foreign projects and late results after settings changes", async () => {
    const f = await open();
    await f.start();
    const old = f.prepareId();
    await f.emit(f.event(old, 1));
    fireEvent.change(screen.getByLabelText("清晰度"), { target: { value: "720p" } });
    await waitFor(() => expect(f.cancel).toHaveBeenCalledWith(old));
    await f.ready();
    expect(f.discard).toHaveBeenCalledWith(ready.qcReceipt);
    await f.emit(f.event(old, 100, { phase: "completed", cancelState: "unavailable" }));
    expect(screen.queryByRole("heading", { name: "本次发布结束" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消本次导出" }));
    await f.start();
    const current = f.prepareId();
    expect(current).not.toBe(old);
    await f.emit(f.event(old, 101, { phase: "completed" }));
    await f.emit(f.event(current, 20, { projectId: "film-foreign", phase: "completed" }));
    expect(screen.queryByRole("heading", { name: "本次发布结束" })).toBeNull();
    await f.emit(f.event(current, 1));
    expect(screen.getByRole("heading", { name: "正在制作导出画幅" })).toBeInTheDocument();
  });
  it("retains an actually published first output and its playback after a stopped partial publication", async () => {
    const f = await open();
    await f.start();
    await f.ready();
    fireEvent.click(screen.getByRole("button", { name: "审核后发布" }));
    await waitFor(() => expect(f.publish).toHaveBeenCalled());
    const id = f.publishId();
    expect(id).not.toBe(f.prepareId());
    await f.emit(
      f.event(id, 1, {
        phase: "publishing",
        cancelState: "requested",
        published: [{ aspectRatio: "16:9", label: "/private/hidden.mp4" }],
      }),
    );
    await f.emit(
      f.event(id, 2, {
        phase: "partial",
        cancelState: "stopped",
        published: [{ aspectRatio: "16:9" }],
      }),
    );
    await f.published({
      kind: "PARTIAL",
      outputs: [{ aspectRatio: "16:9", path: "/published/first.mp4" }],
    });
    expect(screen.getByRole("heading", { name: "处理已停止" })).toBeInTheDocument();
    expect(screen.getByText("横屏成片")).toBeInTheDocument();
    expect(document.querySelector(".nx-export-progress")).not.toHaveTextContent("private");
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(f.play).toHaveBeenCalledWith("/published/first.mp4");
    expect(f.old).not.toHaveBeenCalled();
  });
});
