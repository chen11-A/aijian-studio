import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { taskSnapshot } from "../../film/task-progress";
import { exportAspectPlan, exportFilmSelection } from "./export-selection";

afterEach(() => {
  delete window.aijian;
  vi.useRealTimers();
});
function fixture() {
  const base = sampleFilm();
  base.audioClips = [];
  let current: FilmProject | null = base;
  const apply = vi.fn((next: FilmProject) => {
    current = next;
  });
  const pick = vi.fn().mockResolvedValue("/out");
  const cut = vi.fn().mockImplementation(async (_s, _d, _n, options) => ({
    ok: true,
    path: `/out/movie-${options.aspectRatio.replace(":", "x")}.mp4`,
  }));
  const cancel = vi.fn().mockResolvedValue({ ok: true });
  window.aijian = {
    pickFilmFolder: pick,
    exportFilmCut: cut,
    cancelFilmExport: cancel,
  } as unknown as NonNullable<typeof window.aijian>;
  const host = { current: () => current, valid: () => true, apply };
  return {
    base,
    host,
    apply,
    pick,
    cut,
    cancel,
    switchProject: () => {
      current = { ...base, id: "another" };
    },
  };
}
it("plans work/other/both relative to the project including the legacy portrait default", () => {
  expect(exportAspectPlan({ aspectRatio: "16:9" }, "work")).toEqual(["16:9"]);
  expect(exportAspectPlan({ aspectRatio: "16:9" }, "other")).toEqual(["9:16"]);
  expect(exportAspectPlan({ aspectRatio: "9:16" }, "both")).toEqual(["9:16", "16:9"]);
  expect(exportAspectPlan({}, "work")).toEqual(["9:16"]);
});
it("queues immediately, selects the folder once and keeps the first successful path after both exports", async () => {
  const f = fixture();
  f.base.aspectRatio = "16:9";
  const pending = exportFilmSelection(f.base, ["/source.mp4"], "", f.host, "both");
  expect(taskSnapshot().tasks.find((t) => t.id === `export:${f.base.id}:16:9`)?.status).toBe(
    "queued",
  );
  const result = await pending;
  expect(result.status).toBe("done");
  expect(result.outputs).toEqual([
    { aspectRatio: "16:9", path: "/out/movie-16x9.mp4" },
    { aspectRatio: "9:16", path: "/out/movie-9x16.mp4" },
  ]);
  expect(f.pick).toHaveBeenCalledTimes(1);
  expect(f.host.current()?.exportPath).toBe(result.primaryPath);
  expect(result.primaryPath).toBe("/out/movie-16x9.mp4");
  expect(f.cut.mock.calls[0]![3]).not.toHaveProperty("signal");
});
it("reports partial success and retains the first file when the second conversion fails", async () => {
  const f = fixture();
  f.cut
    .mockResolvedValueOnce({ ok: true, path: "/out/first.mp4" })
    .mockRejectedValueOnce(new Error("encoder failed"));
  const result = await exportFilmSelection(f.base, ["/source.mp4"], "/out", f.host, "both");
  expect(result).toMatchObject({
    status: "partial",
    primaryPath: "/out/first.mp4",
    error: { code: "EXPORT_FAILED" },
  });
  expect(f.apply).toHaveBeenCalledTimes(1);
  expect(f.pick).not.toHaveBeenCalled();
});
it("does not claim two outputs if the desktop returns the same destination", async () => {
  const f = fixture();
  f.cut.mockResolvedValue({ ok: true, path: "/out/one.mp4" });
  const result = await exportFilmSelection(f.base, ["/source.mp4"], "/out", f.host, "both");
  expect(result.status).toBe("partial");
  expect(result.outputs).toHaveLength(1);
});
it("immediately cancels an active desktop request and ignores its late success without starting another", async () => {
  const f = fixture();
  const controller = new AbortController();
  let finish!: (value: { ok: boolean; path: string }) => void;
  f.cut.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = exportFilmSelection(
    f.base,
    ["/source.mp4"],
    "/out",
    { ...f.host, signal: controller.signal },
    "both",
  );
  await vi.waitFor(() => expect(f.cut).toHaveBeenCalledTimes(1));
  controller.abort();
  expect((await pending).status).toBe("cancelled");
  expect(f.cancel).toHaveBeenCalledWith(f.cut.mock.calls[0]![3].requestId);
  finish({ ok: true, path: "/out/late.mp4" });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.apply).not.toHaveBeenCalled();
  expect(f.cut).toHaveBeenCalledTimes(1);
  expect(
    taskSnapshot()
      .tasks.filter((t) => t.kind === "export")
      .some((t) => t.status === "failed" && t.reason === "已取消"),
  ).toBe(true);
});
it("pre-aborted requests do not start provider work or ask for a folder", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  expect(
    (
      await exportFilmSelection(f.base, ["/source.mp4"], "", {
        ...f.host,
        signal: controller.signal,
      })
    ).status,
  ).toBe("cancelled");
  expect(f.cut).not.toHaveBeenCalled();
  expect(f.pick).not.toHaveBeenCalled();
});
it("cancels on project switch within the safety poll and never writes to the next project", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.cut.mockImplementation(() => new Promise(() => undefined));
  const pending = exportFilmSelection(f.base, ["/source.mp4"], "/out", f.host, "both");
  await vi.advanceTimersByTimeAsync(0);
  expect(f.cut).toHaveBeenCalledTimes(1);
  f.switchProject();
  await vi.advanceTimersByTimeAsync(100);
  expect((await pending).status).toBe("stale");
  expect(f.cancel).toHaveBeenCalledTimes(1);
  expect(f.apply).not.toHaveBeenCalled();
});
it("retains first output on cancellation during the second task", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.cut
    .mockResolvedValueOnce({ ok: true, path: "/out/first.mp4" })
    .mockImplementationOnce(() => new Promise(() => undefined));
  const pending = exportFilmSelection(
    f.base,
    ["/source.mp4"],
    "/out",
    { ...f.host, signal: controller.signal },
    "both",
  );
  await vi.waitFor(() => expect(f.cut).toHaveBeenCalledTimes(2));
  controller.abort();
  expect(await pending).toMatchObject({
    status: "cancelled",
    primaryPath: "/out/first.mp4",
    outputs: [{ path: "/out/first.mp4" }],
  });
  expect(f.host.current()?.exportPath).toBe("/out/first.mp4");
});
it("recognizes a dismissed folder picker as cancellation and does not attempt the second format", async () => {
  const f = fixture();
  f.pick.mockResolvedValue("");
  const result = await exportFilmSelection(f.base, ["/source.mp4"], "", f.host, "both");
  expect(result.status).toBe("cancelled");
  expect(f.pick).toHaveBeenCalledTimes(1);
  expect(f.cut).not.toHaveBeenCalled();
});

it("an invalid save lease prevents both folder selection and export", async () => {
  const f = fixture();
  const result = await exportFilmSelection(
    f.base,
    ["/source.mp4"],
    "",
    { ...f.host, valid: () => false },
    "both",
  );
  expect(result.status).toBe("stale");
  expect(f.pick).not.toHaveBeenCalled();
  expect(f.cut).not.toHaveBeenCalled();
});
it("cancel during local assembly prevents a late assembly result from starting desktop export", async () => {
  const f = fixture();
  const controller = new AbortController();
  let finish!: (value: { path: string; reason: string }) => void;
  const assemble = vi.fn(
    () =>
      new Promise<{ path: string; reason: string }>((resolve) => {
        finish = resolve;
      }),
  );
  window.aijian!.assembleFilm = assemble as NonNullable<typeof window.aijian>["assembleFilm"];
  const pending = exportFilmSelection(
    f.base,
    ["/one.mp4", "/two.mp4"],
    "/out",
    { ...f.host, signal: controller.signal },
    "both",
  );
  await vi.waitFor(() => expect(assemble).toHaveBeenCalledTimes(1));
  controller.abort();
  expect((await pending).status).toBe("cancelled");
  finish({ path: "/assembled.mp4", reason: "" });
  await Promise.resolve();
  await Promise.resolve();
  expect(f.cut).not.toHaveBeenCalled();
  expect(f.apply).not.toHaveBeenCalled();
});
it("each export write preserves the current project's newer fields", async () => {
  const f = fixture();
  f.cut.mockImplementation(async (_s, _d, _n, options) => {
    f.host.apply({ ...f.host.current()!, title: "Edited while exporting" });
    return { ok: true, path: `/out/movie-${options.aspectRatio.replace(":", "x")}.mp4` };
  });
  expect((await exportFilmSelection(f.base, ["/source.mp4"], "/out", f.host, "both")).status).toBe(
    "done",
  );
  expect(f.host.current()?.title).toBe("Edited while exporting");
});
