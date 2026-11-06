import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSaved, saveFilm } from "../film/library";
import { sampleFilm, type FilmTake } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";

const take = (shotId: string, index: number, clean = false): FilmTake => ({
  id: `${shotId}-take-${index}`,
  shotId,
  index,
  status: "done",
  stillUrl: "",
  videoPath: `/source/${shotId}-${index}.mp4`,
  videoUrl: "",
  prompt: "",
  createdAt: "",
  reason: "",
  ...(clean ? { cleanVideoPath: `/source/${shotId}-${index}-clean.mp4` } : {}),
});
function fixture() {
  const film = sampleFilm();
  film.scenes = [film.scenes[1]!];
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.audioClips = [];
  film.shots = film.shots.slice(1, 4).map((shot, index) => ({
    ...shot,
    no: index + 1,
    line: `第 ${index + 1} 句`,
    lines: [{ speaker: "", text: `第 ${index + 1} 句` }],
    takes:
      index === 0 ? [take(shot.id, 1), take(shot.id, 2, true)] : [take(shot.id, 1, index === 2)],
    selectedTakeId: `${shot.id}-take-1`,
  }));
  return film;
}
const answer = (data: Record<string, unknown>) => ({ data, request_id: "local-test" });
function bridge() {
  const remake = vi.fn(async (_project: string, _path: string) => answer({ status: "NOT_FOUND" }));
  const exportCut = vi.fn(async () => ({ ok: true, path: "/out/movie.mp4" }));
  const generate = vi.fn();
  window.aijian = {
    remakeStoryFilmCleanCopy: remake,
    prepareFilmExport: vi.fn(async () => ({ kind: "FAILED", code: "CLEAN_COPY_REQUIRED" })),
    exportFilmCut: exportCut,
    pickFilmFolder: vi.fn(async () => "/out"),
    createStoryFilm: generate,
  } as unknown as Window["aijian"];
  return { remake, exportCut, generate };
}
async function open(film = fixture()) {
  await saveFilm(film);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    [...document.querySelectorAll<HTMLButtonElement>("nav.tabs button")].find((item) =>
      item.textContent?.includes("分镜"),
    )!,
  );
  return film;
}
const status = () => document.querySelector(".status-note")?.textContent;

beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});

describe("4B-U09 workspace clean copy repair", () => {
  it("offers repair for the selected version, reuses only its assembly and preserves other takes", async () => {
    const { remake, exportCut, generate } = bridge();
    remake.mockImplementation(async () =>
      answer({ status: "SUCCEEDED", clean_output_path: "/source/repaired-clean.mp4" }),
    );
    const film = await open();
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    fireEvent.click(screen.getByRole("button", { name: "用第 2 版" }));
    expect(screen.queryByRole("button", { name: "补做不带字幕的版本" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "用第 1 版" }));
    fireEvent.click(screen.getByRole("button", { name: "补做不带字幕的版本" }));
    await waitFor(() => expect(status()).toContain("补好了"));
    expect(remake).toHaveBeenCalledTimes(1);
    expect(remake).toHaveBeenCalledWith(film.backendProjectId, film.shots[0]!.takes[0]!.videoPath);
    expect(screen.queryByRole("button", { name: "补做不带字幕的版本" })).toBeNull();
    await waitFor(async () => {
      const shot = (await readSaved(film.id))!.shots[0]!;
      expect(shot.selectedTakeId).toBe(film.shots[0]!.selectedTakeId);
      expect(shot.takes).toHaveLength(2);
      expect(shot.takes[0]!.videoPath).toBe(film.shots[0]!.takes[0]!.videoPath);
      expect(shot.takes[0]!.cleanVideoPath).toBe("/source/repaired-clean.mp4");
      expect(shot.takes[1]!.cleanVideoPath).toBe(film.shots[0]!.takes[1]!.cleanVideoPath);
    });
    expect(exportCut).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(status()).not.toMatch(/\/source\/|\.mp4/);
  });

  it("repairs only missing selected copies after a blocked export and retains partial/missing outcomes", async () => {
    const { remake, exportCut, generate } = bridge();
    const film = await open();
    let finish!: (value: ReturnType<typeof answer>) => void;
    remake.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    const dialog = within(screen.getByRole("dialog", { name: "导出成片" }));
    expect(dialog.queryByRole("button", { name: /一键补做/ })).toBeNull();
    fireEvent.click(dialog.getByRole("radio", { name: "不要" }));
    fireEvent.click(dialog.getByRole("button", { name: "检查成片" }));
    fireEvent.click(await dialog.findByRole("button", { name: "一键补做这 2 镜" }));
    expect(dialog.getByRole("button", { name: "正在补做无字幕版本…" })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "审核后发布" })).toBeDisabled();
    await waitFor(() => expect(remake).toHaveBeenCalledTimes(1));
    await act(async () =>
      finish(answer({ status: "SUCCEEDED", clean_output_path: "/source/repaired-clean.mp4" })),
    );
    await waitFor(() => expect(status()).toContain("找不到当时的合成记录"));
    expect(remake.mock.calls.map(([, path]) => path)).toEqual(
      film.shots.slice(0, 2).map((shot) => shot.takes[0]!.videoPath),
    );
    expect(dialog.getByRole("button", { name: "一键补做这 1 镜" })).toBeEnabled();
    expect(dialog.getByText(/有 1 个镜头/)).toHaveTextContent("补好后，请再点导出。");
    expect(status()).toContain("补好了");
    expect(status()).not.toMatch(/\/source\/|NOT_FOUND|\.mp4/);
    expect(exportCut).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
