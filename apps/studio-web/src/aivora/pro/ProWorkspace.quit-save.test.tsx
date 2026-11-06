import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { FilmFlushRequest } from "@aijian/contracts/quit-save";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function open() {
  const film = sampleFilm();
  film.directory = "/saved/work";
  let disk = structuredClone(film),
    listener: ((request: FilmFlushRequest) => void) | undefined;
  const write = vi.fn(async (value: FilmProject) => {
    disk = structuredClone(value);
    return structuredClone(value);
  });
  const flushed = vi.fn(async () => undefined),
    unsubscribe = vi.fn(() => {
      listener = undefined;
    });
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(disk)),
    writeFilmProject: write,
    onFlush: (handler: (request: FilmFlushRequest) => void) => {
      listener = handler;
      return unsubscribe;
    },
    flushed,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  const view = render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  return {
    film,
    write,
    flushed,
    unsubscribe,
    view,
    disk: () => disk,
    flush: (requestId: string) => {
      if (!listener) throw new Error("missing listener");
      listener({ requestId });
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
it("does not send success before the actual current snapshot has finished writing", async () => {
  const f = await open(),
    wait = gate();
  f.write.mockImplementationOnce(async (value) => {
    await wait.promise;
    return value;
  });
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "本次尚未写盘的编辑" } });
  act(() => f.flush("request-1"));
  await waitFor(() => expect(f.write).toHaveBeenCalledTimes(2));
  expect(f.flushed).not.toHaveBeenCalled();
  await act(async () => wait.resolve());
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "request-1", status: "saved" }),
  );
});
it("reports a real failed save and only acknowledges a subsequent successful retry as saved", async () => {
  const f = await open();
  f.write.mockRejectedValueOnce(new Error("private/disk full"));
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "保留在编辑器的修改" } });
  act(() => f.flush("failed-request"));
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "failed-request", status: "failed" }),
  );
  expect(screen.getByLabelText("这一场")).toHaveValue("保留在编辑器的修改");
  expect(document.querySelector(".statusbar .where")).toHaveTextContent(
    "没有写到应用数据目录，可以重试。",
  );
  act(() => f.flush("retry-request"));
  await waitFor(() =>
    expect(f.flushed).toHaveBeenCalledWith({ requestId: "retry-request", status: "saved" }),
  );
  expect(f.disk().scenes[0]!.text).toBe("保留在编辑器的修改");
  expect(document.querySelector(".statusbar .where")).not.toHaveTextContent("没有写到");
});
it("removes the lifecycle subscription and does not acknowledge a late save after unmount", async () => {
  const f = await open(),
    wait = gate();
  f.write.mockImplementationOnce(async (value) => {
    await wait.promise;
    return value;
  });
  fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "等待写入" } });
  act(() => f.flush("unmounted-request"));
  await waitFor(() => expect(f.write).toHaveBeenCalledTimes(2));
  f.view.unmount();
  expect(f.unsubscribe).toHaveBeenCalledOnce();
  await act(async () => wait.resolve());
  expect(f.flushed).not.toHaveBeenCalled();
});
