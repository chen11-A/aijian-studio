import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { activeFilmId, readSaved, saveFilm } from "../film/library";
import * as persistenceModule from "./film-persistence";
import { ProWorkspace } from "./ProWorkspace";

const createPersistence = persistenceModule.createFilmPersistence;
const success = {
  data: { status: "SUCCEEDED", clean_output_path: "/tmp/repaired-clean.mp4" },
  request_id: "test",
};
function fixture() {
  const film = sampleFilm();
  film.backendProjectId = `prj_${"a".repeat(32)}`;
  film.scenes = [film.scenes[0]!];
  film.audioClips = [];
  film.shots = film.shots.slice(0, 2).map((shot, index) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    no: index + 1,
    line: "需要字幕",
    lines: [{ speaker: "", text: "需要字幕" }],
    selectedTakeId: `chosen-${index}`,
    takes: [0, 1].map((version) => ({
      id: version ? `other-${index}` : `chosen-${index}`,
      shotId: shot.id,
      index: version + 1,
      status: "done" as const,
      videoPath: `/tmp/original-${index}-${version}.mp4`,
      videoUrl: "",
      stillUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    })),
  }));
  return film;
}
function bridge() {
  const remake = vi.fn().mockResolvedValue(success);
  const generate = vi.fn();
  const cut = vi.fn();
  window.aijian = {
    remakeStoryFilmCleanCopy: remake,
    createStoryFilm: generate,
    prepareFilmExport: vi.fn(async () => ({ kind: "FAILED", code: "CLEAN_COPY_REQUIRED" })),
    exportFilmCut: cut,
    pickFilmFolder: vi.fn(async () => "/out"),
  } as unknown as Window["aijian"];
  return { remake, generate, cut };
}
async function open(film: FilmProject) {
  await saveFilm(film);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
}
function board() {
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: "分镜",
    }),
  );
}
function script() {
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: "剧本",
    }),
  );
}
function repairButton() {
  return screen.getByRole("button", { name: "补做不带字幕的版本" });
}
const status = () => document.querySelector(".status-note")?.textContent;
beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());

describe("4B-B12 workspace repair ownership", () => {
  it("rejects repeated clicks and does not write a late result to a newly selected version", async () => {
    const film = fixture();
    const { remake, generate, cut } = bridge();
    let finish!: (value: typeof success) => void;
    remake.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open(film);
    board();
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    const button = repairButton();
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(remake).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "用第 2 版" }));
    await act(async () => {
      finish(success);
    });
    await waitFor(() => expect(status()).toContain("已经变化"));
    expect(status()).not.toContain("补好了");
    const saved = await readSaved(film.id);
    expect(saved!.shots[0]!.takes.every((take) => !take.cleanVideoPath)).toBe(true);
    expect(generate).not.toHaveBeenCalled();
    expect(cut).not.toHaveBeenCalled();
  });

  it("rechecks the selected version after billing preparation before dispatch", async () => {
    const film = fixture();
    film.backendProjectId = "";
    const { remake } = bridge();
    let finish!: (value: { data: { id: string } }) => void;
    window.aijian!.createProject = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open(film);
    board();
    fireEvent.click(screen.getByRole("button", { name: "单个镜头" }));
    fireEvent.click(repairButton());
    await waitFor(() => expect(window.aijian!.createProject).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "用第 2 版" }));
    await act(async () => {
      finish({ data: { id: `prj_${"b".repeat(32)}` } });
    });
    await waitFor(() => expect(status()).toContain("已经变化"));
    expect(remake).not.toHaveBeenCalled();
  });

  it("persists the first repaired shot to its own work when switching while the second is pending", async () => {
    const film = fixture();
    const other = structuredClone(film);
    other.id = "film_cleanother000001";
    other.episodeTitle = "第 2 集";
    other.episodeNo = 2;
    await saveFilm(other);
    const { remake, generate, cut } = bridge();
    let finish!: (value: typeof success) => void;
    remake.mockResolvedValueOnce(success).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open(film);
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    const dialog = within(screen.getByRole("dialog", { name: "导出成片" }));
    fireEvent.click(dialog.getByRole("radio", { name: "不要" }));
    fireEvent.click(dialog.getByRole("button", { name: "检查成片" }));
    fireEvent.click(await dialog.findByRole("button", { name: "一键补做这 2 镜" }));
    await waitFor(() => expect(remake).toHaveBeenCalledTimes(2));
    expect((await readSaved(film.id))!.shots[0]!.takes[0]!.cleanVideoPath).toBe(
      success.data.clean_output_path,
    );
    fireEvent.click(dialog.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    await screen.findByText(/已打开第 2 集/);
    await act(async () => {
      finish(success);
    });
    const original = (await readSaved(film.id))!;
    const switched = (await readSaved(other.id))!;
    expect(original.shots[0]!.takes[0]!.cleanVideoPath).toBe(success.data.clean_output_path);
    expect(original.shots[1]!.takes[0]!.cleanVideoPath).toBeUndefined();
    expect(switched.shots.every((shot) => shot.takes.every((take) => !take.cleanVideoPath))).toBe(
      true,
    );
    expect(status()).not.toContain("补好了");
    expect(generate).not.toHaveBeenCalled();
    expect(cut).not.toHaveBeenCalled();
  });

  it("saves a queued original-work result after switching without changing the active work", async () => {
    const film = fixture();
    const other = structuredClone(film);
    other.id = "film_queueother00001";
    other.episodeTitle = "第 2 集";
    other.episodeNo = 2;
    await saveFilm(other);
    const { remake } = bridge();
    let release!: () => void;
    let blocked = false;
    vi.spyOn(persistenceModule, "createFilmPersistence").mockImplementation((host) =>
      createPersistence({
        ...host,
        write: async (snapshot) => {
          if (
            !blocked &&
            snapshot.scenes[0]!.text === "等待写盘" &&
            !snapshot.shots[0]!.takes[0]!.cleanVideoPath
          ) {
            blocked = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return host.write(snapshot);
        },
      }),
    );
    await open(film);
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "等待写盘" } });
    await waitFor(() => expect(blocked).toBe(true));
    board();
    fireEvent.click(repairButton());
    await waitFor(() => expect(remake).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "补做不带字幕的版本" })).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "作品" }));
    fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
    await screen.findByText(/已打开第 2 集/);
    await act(async () => {
      release();
    });
    await waitFor(async () =>
      expect((await readSaved(film.id))!.shots[0]!.takes[0]!.cleanVideoPath).toBe(
        success.data.clean_output_path,
      ),
    );
    expect(activeFilmId()).toBe(other.id);
    expect(
      (await readSaved(other.id))!.shots.every((shot) =>
        shot.takes.every((take) => !take.cleanVideoPath),
      ),
    ).toBe(true);
    expect(status()).not.toContain("补好了");
  });

  it("retains earlier saved copies and reports an interrupted batch when a later write fails", async () => {
    const film = fixture();
    const { remake, generate } = bridge();
    vi.spyOn(persistenceModule, "createFilmPersistence").mockImplementation((host) =>
      createPersistence({
        ...host,
        write: async (snapshot) => {
          if (snapshot.shots[1]!.takes[0]!.cleanVideoPath)
            throw new Error("/private/output.json write failure");
          return host.write(snapshot);
        },
      }),
    );
    await open(film);
    fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
    const dialog = within(screen.getByRole("dialog", { name: "导出成片" }));
    fireEvent.click(dialog.getByRole("radio", { name: "不要" }));
    fireEvent.click(dialog.getByRole("button", { name: "检查成片" }));
    fireEvent.click(await dialog.findByRole("button", { name: "一键补做这 2 镜" }));
    await waitFor(() => expect(status()).toContain("补做中断，已经保存的版本会保留"));
    expect(status()).not.toMatch(/private|output.json/);
    const saved = (await readSaved(film.id))!;
    expect(saved.shots[0]!.takes[0]!.cleanVideoPath).toBe(success.data.clean_output_path);
    expect(saved.shots[1]!.takes[0]!.cleanVideoPath).toBeUndefined();
    expect(remake).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a queued stale save instead of overwriting a newer edit of the same work", async () => {
    const film = fixture();
    const { remake } = bridge();
    let release!: () => void;
    let blocked = false;
    const writes: FilmProject[] = [];
    vi.spyOn(persistenceModule, "createFilmPersistence").mockImplementation((host) =>
      createPersistence({
        ...host,
        write: async (snapshot) => {
          writes.push(structuredClone(snapshot));
          if (
            !blocked &&
            snapshot.scenes[0]!.text === "等待写盘" &&
            !snapshot.shots[0]!.takes[0]!.cleanVideoPath
          ) {
            blocked = true;
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return host.write(snapshot);
        },
      }),
    );
    await open(film);
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "等待写盘" } });
    await waitFor(() => expect(blocked).toBe(true));
    board();
    fireEvent.click(repairButton());
    await waitFor(() => expect(remake).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "补做不带字幕的版本" })).toBeNull(),
    );
    script();
    fireEvent.change(screen.getByLabelText("这一场"), { target: { value: "后来的编辑" } });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(status()).toContain("补做中断"));
    expect(status()).not.toContain("补好了");
    await waitFor(async () =>
      expect((await readSaved(film.id))?.scenes[0]?.text).toBe("后来的编辑"),
    );
    expect(
      writes
        .filter((snapshot) => snapshot.shots[0]!.takes[0]!.cleanVideoPath)
        .every((snapshot) => snapshot.scenes[0]!.text === "后来的编辑"),
    ).toBe(true);
  });
});
