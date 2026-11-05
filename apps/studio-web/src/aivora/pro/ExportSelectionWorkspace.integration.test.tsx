import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete window.aijian;
});

async function openExport(aspectRatio: "16:9" | "9:16", failSecond = false) {
  localStorage.clear();
  const film = sampleFilm();
  film.aspectRatio = aspectRatio;
  film.audioClips = [];
  film.shots = film.shots.slice(0, 1);
  const shot = film.shots[0]!;
  shot.takes = [
    {
      id: "ready-take",
      shotId: shot.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "/source/selected.mp4",
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  shot.selectedTakeId = "ready-take";
  const outputs = ["/actual/first.mp4", "/actual/second.mp4"];
  const exportFilmCut = vi.fn().mockImplementation(async () => {
    if (failSecond && exportFilmCut.mock.calls.length === 2) throw new Error("encoder failure");
    return { ok: true, path: outputs[exportFilmCut.mock.calls.length - 1] };
  });
  const pickFilmFolder = vi.fn(async () => "/actual");
  const openFilmPath = vi.fn(async () => undefined);
  const writeFilmProject = vi.fn(async (value: FilmProject) => value);
  window.aijian = {
    readFilmProject: vi.fn(async () => structuredClone(film)),
    writeFilmProject,
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => []),
    exportFilmCut,
    pickFilmFolder,
    openFilmPath,
    cancelFilmExport: vi.fn(async () => ({ ok: true })),
  } as unknown as NonNullable<typeof window.aijian>;
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "导出成片" }));
  const dialog = screen.getByRole("dialog", { name: "导出成片" });
  await waitFor(() => expect(within(dialog).getByLabelText("比例")).toHaveValue("work"));
  return { dialog, exportFilmCut, pickFilmFolder, openFilmPath, writeFilmProject, film };
}

it.each(["16:9", "9:16"] as const)(
  "UI 两种都要 exports both actual aspects for a %s project",
  async (aspectRatio) => {
    const f = await openExport(aspectRatio);
    fireEvent.change(within(f.dialog).getByLabelText("比例"), { target: { value: "both" } });
    fireEvent.click(within(f.dialog).getByRole("button", { name: "开始导出" }));
    await waitFor(() => expect(f.exportFilmCut).toHaveBeenCalledTimes(2));
    const other = aspectRatio === "16:9" ? "9:16" : "16:9";
    expect(f.exportFilmCut.mock.calls.map((call) => call[3].aspectRatio)).toEqual([
      aspectRatio,
      other,
    ]);
    expect(f.exportFilmCut.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ["/source/selected.mp4", "/actual"],
      ["/source/selected.mp4", "/actual"],
    ]);
    expect(f.pickFilmFolder).toHaveBeenCalledTimes(1);
    fireEvent.click(await within(f.dialog).findByRole("button", { name: "播放" }));
    expect(f.openFilmPath).toHaveBeenCalledWith("/actual/first.mp4");
    await waitFor(() =>
      expect(
        f.writeFilmProject.mock.calls.some(([value]) => value.exportPath === "/actual/first.mp4"),
      ).toBe(true),
    );
    expect(
      f.writeFilmProject.mock.calls.every(([value]) => value.aspectRatio === aspectRatio),
    ).toBe(true);
  },
);

it("UI other exports only the opposite aspect and uses the real returned path", async () => {
  const f = await openExport("16:9");
  fireEvent.change(within(f.dialog).getByLabelText("比例"), { target: { value: "other" } });
  fireEvent.click(within(f.dialog).getByRole("button", { name: "开始导出" }));
  fireEvent.click(await within(f.dialog).findByRole("button", { name: "播放" }));
  expect(f.exportFilmCut).toHaveBeenCalledTimes(1);
  expect(f.exportFilmCut.mock.calls[0]![3].aspectRatio).toBe("9:16");
  expect(f.openFilmPath).toHaveBeenCalledWith("/actual/first.mp4");
});

it("UI keeps the first real output playable when the second aspect fails", async () => {
  const f = await openExport("16:9", true);
  fireEvent.change(within(f.dialog).getByLabelText("比例"), { target: { value: "both" } });
  fireEvent.click(within(f.dialog).getByRole("button", { name: "开始导出" }));
  await waitFor(() => expect(f.exportFilmCut).toHaveBeenCalledTimes(2));
  fireEvent.click(await within(f.dialog).findByRole("button", { name: "播放" }));
  expect(f.openFilmPath).toHaveBeenCalledWith("/actual/first.mp4");
  expect(document.querySelector(".status-note")?.getAttribute("title")).toContain(
    "已保存 1 个文件",
  );
});
