import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function desktop() {
  const first = sampleFilm();
  first.directory = "/saved/original";
  const second = structuredClone(first);
  second.id = "film_savestatussecond001";
  second.episodeNo = 2;
  second.episodeTitle = "第 2 集";
  second.directory = "/saved/second";
  second.scenes[0]!.text = "第二集的原文。";
  const disk = new Map([
    [first.id, structuredClone(first)],
    [second.id, structuredClone(second)],
  ]);
  const write = vi.fn(async (value: FilmProject) => {
    disk.set(value.id, structuredClone(value));
    return structuredClone(value);
  });
  const flushed = vi.fn();
  let flush: (() => void) | undefined;
  window.aijian = {
    listFilmSeries: vi.fn(async () => [
      { id: first.seriesId, title: first.seriesTitle, savedAt: "", path: first.directory },
    ]),
    listFilmEpisodes: vi.fn(async () =>
      [first, second].map((film) => ({
        id: film.id,
        seriesId: film.seriesId,
        title: film.episodeTitle,
        no: film.episodeNo,
        shots: film.shots.length,
        done: 0,
        savedAt: "",
      })),
    ),
    readFilmProject: vi.fn(async (id: string) =>
      structuredClone(disk.get(id) ?? (id === first.seriesId ? disk.get(first.id) : null)),
    ),
    writeFilmProject: write,
    onFlush: (handler: () => void) => {
      flush = handler;
    },
    flushed,
  } as unknown as Window["aijian"];
  window.localStorage.setItem("aivora.film.activeId", first.id);
  return {
    first,
    second,
    disk,
    write,
    flushed,
    flush: () => {
      if (!flush) throw new Error("flush handler missing");
      flush();
    },
  };
}
const where = () => document.querySelector<HTMLElement>(".statusbar .where")!;
const saveFailure = "没有写到应用数据目录，可以重试。";
async function open() {
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场", { exact: true });
}
async function openSecond() {
  fireEvent.click(screen.getByRole("button", { name: "作品", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "第 2 集", exact: true }));
  await waitFor(() =>
    expect(screen.getByLabelText("这一场", { exact: true })).toHaveValue("第二集的原文。"),
  );
}

describe("saved directory and current save outcome", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
  });

  it("shows a failed save ahead of an existing directory and clears it after a successful retry", async () => {
    const bridge = desktop();
    const original = bridge.first.scenes[0]!.text;
    bridge.write.mockRejectedValueOnce(new Error("disk full"));
    await open();
    fireEvent.change(screen.getByLabelText("这一场", { exact: true }), {
      target: { value: "已应用但还没落盘的新正文。" },
    });
    await waitFor(() => expect(where()).toHaveTextContent(saveFailure));
    expect(where()).not.toHaveTextContent("作品保存在");
    expect(where()).toHaveTextContent(bridge.first.directory);
    expect(screen.getByLabelText("这一场", { exact: true })).toHaveValue(
      "已应用但还没落盘的新正文。",
    );
    expect(bridge.disk.get(bridge.first.id)!.scenes[0]!.text).toBe(original);
    act(() => bridge.flush());
    expect(where()).toHaveTextContent("正在保存");
    await waitFor(() => expect(bridge.flushed).toHaveBeenCalledOnce());
    await waitFor(() => expect(where()).toHaveTextContent("作品保存在"));
    expect(where()).not.toHaveTextContent(saveFailure);
    expect(bridge.disk.get(bridge.first.id)!.scenes[0]!.text).toBe("已应用但还没落盘的新正文。");
    expect(bridge.write).toHaveBeenCalledTimes(2);
  });

  it("does not mark a newer unsaved snapshot as saved when an older flush succeeds", async () => {
    const bridge = desktop();
    await open();
    await waitFor(() => expect(bridge.write).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(where()).toHaveTextContent("作品保存在"));
    const pending = deferred<FilmProject>();
    bridge.write.mockImplementationOnce(() => pending.promise);
    act(() => bridge.flush());
    await waitFor(() => expect(bridge.write).toHaveBeenCalledTimes(2));
    const old = bridge.write.mock.calls[1]![0];
    fireEvent.change(screen.getByLabelText("这一场", { exact: true }), {
      target: { value: "同一工程里更新但尚未写盘的正文。" },
    });
    await act(async () => pending.resolve({ ...old, directory: "/saved/stale-snapshot" }));
    expect(bridge.flushed).toHaveBeenCalledOnce();
    expect(where()).toHaveTextContent("正在保存");
    expect(where()).not.toHaveTextContent(/作品保存在|stale-snapshot/);
    expect(bridge.disk.get(bridge.first.id)!.scenes[0]!.text).toBe(bridge.first.scenes[0]!.text);
    await waitFor(() => expect(bridge.write).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(where()).toHaveTextContent("作品保存在"));
    expect(bridge.disk.get(bridge.first.id)!.scenes[0]!.text).toBe(
      "同一工程里更新但尚未写盘的正文。",
    );
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an old project's late flush %s while still acknowledging shutdown",
    async (outcome) => {
      const bridge = desktop();
      await open();
      await waitFor(() => expect(bridge.write).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(where()).toHaveTextContent("作品保存在"));
      const pending = deferred<FilmProject>();
      bridge.write.mockImplementationOnce(() => pending.promise);
      act(() => bridge.flush());
      await waitFor(() => expect(bridge.write).toHaveBeenCalledTimes(2));
      const old = bridge.write.mock.calls[1]![0];
      await openSecond();
      await waitFor(() =>
        expect(bridge.write.mock.calls.some(([film]) => film.id === bridge.second.id)).toBe(true),
      );
      await waitFor(() => expect(where()).toHaveTextContent("作品保存在"));
      await act(async () => {
        if (outcome === "resolve") pending.resolve({ ...old, directory: "/saved/stale-original" });
        else pending.reject(new Error("old project failed"));
      });
      expect(bridge.flushed).toHaveBeenCalledOnce();
      expect(where()).toHaveTextContent(bridge.second.directory);
      expect(where()).toHaveTextContent("作品保存在");
      expect(where()).not.toHaveTextContent(/stale-original|没有写到/);
      expect(screen.getByLabelText("这一场", { exact: true })).toHaveValue("第二集的原文。");
    },
  );

  it("does not let an old successful flush clear the new project's real save failure", async () => {
    const bridge = desktop();
    await open();
    await waitFor(() => expect(bridge.write).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(where()).toHaveTextContent("作品保存在"));
    const pending = deferred<FilmProject>();
    bridge.write.mockImplementationOnce(() => pending.promise);
    act(() => bridge.flush());
    await waitFor(() => expect(bridge.write).toHaveBeenCalledTimes(2));
    const old = bridge.write.mock.calls[1]![0];
    bridge.write.mockRejectedValueOnce(new Error("second project disk full"));
    await openSecond();
    await waitFor(() => expect(where()).toHaveTextContent(saveFailure));
    await act(async () => pending.resolve({ ...old, directory: "/saved/stale-original" }));
    expect(bridge.flushed).toHaveBeenCalledOnce();
    expect(where()).toHaveTextContent(saveFailure);
    expect(where()).toHaveTextContent(bridge.second.directory);
    expect(where()).not.toHaveTextContent(/作品保存在|stale-original/);
  });
});
