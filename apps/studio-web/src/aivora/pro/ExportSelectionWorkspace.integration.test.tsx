import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type {
  FilmExportQcInput,
  FilmExportQcPrepared,
  FilmExportQcPublishInput,
  FilmExportQcPublishResult,
} from "@aijian/contracts/film-export-qc";
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
  film.cover = {
    title: film.seriesTitle,
    subtitle: film.episodeTitle,
    aiMark: true,
    backgroundUrl: "/source/selected-cover.png",
  };
  const shot = film.shots[0]!;
  shot.takes = [
    {
      id: "ready-take",
      shotId: shot.id,
      index: 1,
      status: "done",
      stillUrl: "",
      videoPath: "/source/selected.mp4",
      cleanVideoPath: "/source/selected-clean.mp4",
      subtitleCues: [{ text: "保留的字幕", start: 0, end: 0.5 }],
      videoUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  shot.selectedTakeId = "ready-take";
  const paths = ["/actual/first.mp4", "/actual/second.mp4"];
  let stored = structuredClone(film);
  const preparedProjects: FilmProject[] = [];
  const prepareFilmExport = vi.fn(
    async (input: FilmExportQcInput): Promise<FilmExportQcPrepared> => {
      preparedProjects.push(structuredClone(stored));
      return {
        kind: "READY",
        qcReceipt: "opaque-review-receipt",
        outputs: input.settings.aspects.map((aspectRatio) => ({
          aspectRatio,
          report: {
            schemaVersion: 1,
            media: {
              duration: 1,
              width: aspectRatio === "16:9" ? 1280 : 720,
              height: aspectRatio === "16:9" ? 720 : 1280,
            },
            audio: { present: true, integratedLufs: -16, truePeakDbtp: -2 },
            assumptions: {},
            issues: [],
          },
        })),
        shots: [],
        fileName: "成片.mp4",
        unverified: ["台词是否说完未检查。"],
      };
    },
  );
  const publishFilmExport = vi.fn(
    async (input: FilmExportQcPublishInput): Promise<FilmExportQcPublishResult> => ({
      kind: failSecond ? "PARTIAL" : "PUBLISHED",
      outputs: input.settings.aspects
        .slice(0, failSecond ? 1 : undefined)
        .map((aspectRatio, index) => ({ aspectRatio, path: paths[index]! })),
    }),
  );
  const exportFilmCut = vi.fn(),
    assembleFilm = vi.fn(),
    pickFilmFolder = vi.fn(),
    openFilmPath = vi.fn(async () => undefined),
    createStoryFilm = vi.fn();
  const writeFilmProject = vi.fn(async (value: FilmProject) => {
    stored = structuredClone(value);
    return structuredClone(value);
  });
  window.aijian = {
    readFilmProject: vi.fn(async () => structuredClone(stored)),
    writeFilmProject,
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => []),
    prepareFilmExport,
    publishFilmExport,
    discardFilmExport: vi.fn(async () => undefined),
    exportFilmCut,
    assembleFilm,
    pickFilmFolder,
    openFilmPath,
    createStoryFilm,
  } as unknown as NonNullable<typeof window.aijian>;
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  fireEvent.click(await screen.findByRole("button", { name: "导出成片" }));
  const dialog = screen.getByRole("dialog", { name: "导出成片" });
  await waitFor(() => expect(within(dialog).getByLabelText("比例")).toHaveValue("work"));
  return {
    dialog,
    prepareFilmExport,
    publishFilmExport,
    preparedProjects,
    exportFilmCut,
    assembleFilm,
    pickFilmFolder,
    openFilmPath,
    writeFilmProject,
    createStoryFilm,
    film,
  };
}
async function checkAndPublish(f: Awaited<ReturnType<typeof openExport>>) {
  {
    const silentChoice = within(f.dialog).queryByRole("button", { name: "本片静音" });
    if (silentChoice) fireEvent.click(silentChoice);
  }
  fireEvent.click(within(f.dialog).getByRole("button", { name: "检查成片" }));
  const publish = await within(f.dialog).findByRole("button", { name: "审核后发布" });
  await waitFor(() => expect(publish).toBeEnabled());
  expect(f.publishFilmExport).not.toHaveBeenCalled();
  expect(f.exportFilmCut).not.toHaveBeenCalled();
  expect(f.assembleFilm).not.toHaveBeenCalled();
  fireEvent.click(publish);
  await waitFor(() => expect(f.publishFilmExport).toHaveBeenCalledTimes(1));
}
it.each(["16:9", "9:16"] as const)(
  "UI 两种都要 reviews both actual aspects before one publication for a %s project",
  async (aspectRatio) => {
    const f = await openExport(aspectRatio);
    fireEvent.change(within(f.dialog).getByLabelText("比例"), { target: { value: "both" } });
    await checkAndPublish(f);
    const other = aspectRatio === "16:9" ? "9:16" : "16:9";
    expect(f.prepareFilmExport.mock.calls[0]![0].settings.aspects).toEqual([aspectRatio, other]);
    expect(f.publishFilmExport.mock.calls[0]![0]).toEqual({
      ...f.prepareFilmExport.mock.calls[0]![0],
      qcReceipt: "opaque-review-receipt",
    });
    expect(f.publishFilmExport.mock.calls[0]![0].expectedSelection).toEqual([
      { shotId: f.film.shots[0]!.id, takeId: "ready-take" },
    ]);
    expect(JSON.stringify(f.prepareFilmExport.mock.calls[0]![0])).not.toContain("/source/");
    expect(f.pickFilmFolder).not.toHaveBeenCalled();
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
it("UI other reviews only the opposite aspect and uses the real published path", async () => {
  const f = await openExport("16:9");
  fireEvent.change(within(f.dialog).getByLabelText("比例"), { target: { value: "other" } });
  await checkAndPublish(f);
  expect(f.prepareFilmExport).toHaveBeenCalledTimes(1);
  expect(f.publishFilmExport.mock.calls[0]![0].settings.aspects).toEqual(["9:16"]);
  fireEvent.click(await within(f.dialog).findByRole("button", { name: "播放" }));
  expect(f.openFilmPath).toHaveBeenCalledWith("/actual/first.mp4");
});
it("UI keeps the first real published output playable and saved when the second aspect fails", async () => {
  const f = await openExport("16:9", true);
  fireEvent.change(within(f.dialog).getByLabelText("比例"), { target: { value: "both" } });
  await checkAndPublish(f);
  fireEvent.click(await within(f.dialog).findByRole("button", { name: "播放" }));
  expect(f.openFilmPath).toHaveBeenCalledWith("/actual/first.mp4");
  await waitFor(() =>
    expect(
      f.writeFilmProject.mock.calls.some(([value]) => value.exportPath === "/actual/first.mp4"),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(document.querySelector(".status-note")?.getAttribute("title")).toContain(
      "部分交付尚未完成，已确认写出的文件保留，请核对下方记录。",
    ),
  );
  expect(await f.publishFilmExport.mock.results[0]!.value).toEqual({
    kind: "PARTIAL",
    outputs: [{ aspectRatio: "16:9", path: "/actual/first.mp4" }],
  });
  expect(
    within(f.dialog).getByText("本次导出仅完成一部分，已写出的文件保留。"),
  ).toBeInTheDocument();
  expect(
    within(f.dialog).getByText("这次导出未提供交付清单，暂时不能核对交付证据。"),
  ).toBeInTheDocument();
  expect(
    within(f.dialog).queryByRole("heading", { name: "交付清单已生成" }),
  ).not.toBeInTheDocument();
  expect(f.publishFilmExport).toHaveBeenCalledTimes(1);
  expect(f.openFilmPath).toHaveBeenCalledExactlyOnceWith("/actual/first.mp4");
  expect(f.exportFilmCut).not.toHaveBeenCalled();
  expect(f.assembleFilm).not.toHaveBeenCalled();
  expect(f.createStoryFilm).not.toHaveBeenCalled();
});
it("UI binds chosen 清晰度/字幕 and the persisted cover to the reviewed project instead of passing paths", async () => {
  const f = await openExport("9:16");
  fireEvent.change(within(f.dialog).getByLabelText("清晰度"), { target: { value: "720p" } });
  fireEvent.click(within(f.dialog).getByRole("radio", { name: "单独文件" }));
  await checkAndPublish(f);
  expect(f.prepareFilmExport.mock.calls[0]![0]).toMatchObject({
    projectId: f.film.id,
    settings: {
      aspects: ["9:16"],
      quality: "720p",
      subtitles: "srt",
      style: "white",
      aiMark: true,
    },
  });
  expect(f.preparedProjects[0]!.cover).toEqual(f.film.cover);
  expect(f.preparedProjects[0]!.shots[0]!.takes[0]).toMatchObject({
    cleanVideoPath: "/source/selected-clean.mp4",
    subtitleCues: [{ text: "保留的字幕", start: 0, end: 0.5 }],
  });
  expect(f.publishFilmExport.mock.calls[0]![0].settings).toEqual(
    f.prepareFilmExport.mock.calls[0]![0].settings,
  );
  expect(f.prepareFilmExport.mock.calls[0]![0]).not.toHaveProperty("cover");
});
