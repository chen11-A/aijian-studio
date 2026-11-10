import * as exportCheckModule from "../next/ExportCheck";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import * as editorModule from "./actions/editor-host";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveFilm, readSaved } from "../film/library";
import { sampleFilm, type FilmProject } from "../film/project";
import type { FilmExportQcInput, FilmExportQcPrepared } from "@aijian/contracts/film-export-qc";
import { ProWorkspace } from "./ProWorkspace";
const report = {
  schemaVersion: 1,
  media: { duration: 2, width: 1280, height: 720 },
  audio: { present: true, integratedLufs: -16, truePeakDbtp: -2 },
  assumptions: { streams: "技术检测" },
  issues: [],
};
const ready: FilmExportQcPrepared = {
  kind: "READY",
  qcReceipt: "opaque-receipt",
  outputs: [{ aspectRatio: "16:9", report }],
  shots: [],
  fileName: "雨夜.mp4",
  unverified: ["台词是否说完未检查：需要真实播放和试听。"],
};
function fixture() {
  const film = sampleFilm();
  film.scenes = [film.scenes[0]!];
  film.audioClips = [];
  film.shots = film.shots.slice(0, 2).map((shot, index) => ({
    ...shot,
    sceneId: film.scenes[0]!.id,
    selectedTakeId: `take-${index}`,
    takes: [
      {
        id: `take-${index}`,
        shotId: shot.id,
        index: 1,
        status: "done" as const,
        videoPath: `/source/${index}.mp4`,
        stillUrl: "",
        videoUrl: "",
        prompt: "",
        reason: "",
        createdAt: "",
      },
    ],
  }));
  return film;
}
async function open(options: { pending?: boolean; legacy?: boolean } = {}) {
  const film = fixture();
  await saveFilm(film);
  let release!: (value: FilmExportQcPrepared) => void;
  const prepare = options.pending
    ? vi.fn(
        (_input: FilmExportQcInput) =>
          new Promise<FilmExportQcPrepared>((resolve) => {
            release = resolve;
          }),
      )
    : vi.fn().mockResolvedValue(ready);
  const publish = vi.fn().mockResolvedValue({
    kind: "PUBLISHED",
    outputs: [{ aspectRatio: "16:9", path: "/published/movie.mp4" }],
  });
  const discard = vi.fn().mockResolvedValue(undefined),
    old = vi.fn();
  let disk = structuredClone(film);
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(disk)),
    writeFilmProject: vi.fn(async (value: FilmProject) => {
      disk = structuredClone(value);
      return structuredClone(value);
    }),
    ...(!options.legacy
      ? { prepareFilmExport: prepare, publishFilmExport: publish, discardFilmExport: discard }
      : {}),
    exportFilmCut: old,
    assembleFilm: old,
    pickFilmFolder: vi.fn(),
  } as unknown as Window["aijian"];
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /分镜/,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "属性" }));
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  return {
    film,
    prepare,
    publish,
    discard,
    old,
    release: async () => {
      await act(async () => release(ready));
    },
  };
}
const check = () => {
  const silent = screen.queryByRole("button", { name: "本片静音" });
  if (silent) fireEvent.click(silent);
  fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
};
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
describe("QC prepare/review/publish host", () => {
  it("only sends identities/settings, reviews before publishing and never invokes legacy export", async () => {
    const f = await open();
    expect(screen.queryByLabelText("导出文件夹")).toBeNull();
    check();
    const publish = await screen.findByRole("button", { name: "审核后发布" });
    await waitFor(() => expect(publish).toBeEnabled());
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.old).not.toHaveBeenCalled();
    const payload = f.prepare.mock.calls[0]![0];
    expect(payload.expectedSelection.map((item: { takeId: string }) => item.takeId)).toEqual([
      "take-0",
      "take-1",
    ]);
    expect(JSON.stringify(payload)).not.toContain("/source/");
    expect(JSON.stringify(payload)).not.toContain("picture");
    expect(screen.getByText(/台词是否说完未检查/)).toBeInTheDocument();
    expect((await readSaved(f.film.id))?.exportPath).not.toBe("/published/movie.mp4");
    expect(
      document.querySelectorAll(".dialog.export button.primary,.dialog.export .nx-primary"),
    ).toHaveLength(1);
    fireEvent.click(publish);
    await waitFor(() => expect(f.publish).toHaveBeenCalledTimes(1));
    await waitFor(async () =>
      expect((await readSaved(f.film.id))?.exportPath).toBe("/published/movie.mp4"),
    );
    expect(f.old).not.toHaveBeenCalled();
  });
  it("blocks the legacy-only bridge with no unchecked fallback", async () => {
    const f = await open({ legacy: true });
    check();
    await waitFor(() =>
      expect(document.querySelector(".status-note")).toHaveTextContent("导出前检查没有完成"),
    );
    expect(f.old).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
  });
  it("cancels a completed review without publishing", async () => {
    const f = await open();
    check();
    await screen.findByRole("button", { name: "审核后发布" });
    fireEvent.click(screen.getByRole("button", { name: "取消本次导出" }));
    await waitFor(() => expect(f.discard).toHaveBeenCalledWith(ready.qcReceipt));
    expect(f.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "检查成片" })).toBeInTheDocument();
  });
  it("invalidates review after settings change and discards late prepare output after input changes", async () => {
    const f = await open({ pending: true });
    check();
    await waitFor(() => expect(f.prepare).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("radio", { name: "不要" }));
    await f.release();
    await waitFor(() => expect(f.discard).toHaveBeenCalledWith(ready.qcReceipt));
    expect(f.publish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "审核后发布" })).toBeDisabled();
  });
  it("does not check when the project save fails", async () => {
    const f = await open();
    window.aijian!.writeFilmProject = vi.fn().mockRejectedValue(new Error("/private/disk"));
    check();
    await screen.findByText(/工程还没保存，尚未检查/);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(document.querySelector(".dialog.export")).not.toHaveTextContent("/private/disk");
  });
  it("blocks a whole two-aspect receipt when a different output has a block", async () => {
    const f = await open();
    f.prepare.mockResolvedValue({
      ...ready,
      outputs: [
        ready.outputs[0]!,
        {
          aspectRatio: "9:16",
          report: {
            ...report,
            issues: [
              {
                id: "tp",
                severity: "block",
                time: 0,
                timeLabel: "整片",
                end: 2,
                type: "true_peak",
                message: "峰值过高",
                suggestion: "调低音量",
                action: "adjust_volume",
                detail: {},
                scope: "program",
              },
            ],
          },
        },
      ],
    });
    check();
    await screen.findByRole("button", { name: "审核后发布" });
    expect(screen.getByRole("button", { name: "审核后发布" })).toBeDisabled();
    expect(f.publish).not.toHaveBeenCalled();
  });
});

it("synchronizes real data-URL materialization before QC and publishes without rematerializing the reviewed assets", async () => {
  const create = editorModule.createEditorHost;
  let host!: Parameters<typeof create>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return create(value);
  });
  const root = await mkdtemp(join(tmpdir(), "qc-host-persist-"));
  // Execute the actual desktop storage module without widening the web TS project.
  const desktopModule = pathToFileURL(resolve("../desktop/src/film-library.ts")).href;
  const { writeProject, readProject } = (await import(desktopModule)) as {
    writeProject: (root: string, value: unknown) => Promise<Record<string, unknown>>;
    readProject: (
      root: string,
      id: string,
    ) => Promise<(Record<string, unknown> & { shots?: { poster?: string }[] }) | null>;
  };
  try {
    const f = await open();
    window.aijian!.writeFilmProject = vi.fn(async (value) => writeProject(root, value));
    window.aijian!.readFilmProject = vi.fn(async (id) => readProject(root, id));
    const updated = structuredClone(host.current()!);
    updated.shots[0]!.poster = "data:image/png;base64,YWJj";
    updated.audioClips = [
      {
        id: "audio",
        lane: "score",
        shotId: "",
        takeId: "",
        label: "",
        startSeconds: 0,
        durationSeconds: 1,
        offsetSeconds: 0,
        gainDb: -14,
        path: "data:audio/wav;base64,YWJj",
      },
    ];
    await act(async () => host.applyLive(updated));
    check();
    const confirm = await screen.findByRole("button", { name: "审核后发布" });
    await waitFor(() => expect(confirm).toBeEnabled());
    const stored = await readProject(root, f.film.id);
    const media = join(root, f.film.seriesId, "media");
    const before = await readdir(media);
    expect(host.current()!.shots[0]!.poster).not.toMatch(/^data:/);
    expect(host.current()!.audioClips[0]!.path).not.toMatch(/^data:/);
    fireEvent.click(screen.getByRole("button", { name: "审核后发布" }));
    await waitFor(() => expect(f.publish).toHaveBeenCalledTimes(1));
    await waitFor(async () =>
      expect((await readProject(root, f.film.id))?.exportPath).toBe("/published/movie.mp4"),
    );
    const after = await readProject(root, f.film.id);
    expect((after?.shots?.[0] as { poster: string }).poster).toBe(
      (stored?.shots?.[0] as { poster: string }).poster,
    );
    expect(await readdir(media)).toEqual(before);
  } finally {
    cleanup();
    await Promise.allSettled(
      vi.mocked(window.aijian!.writeFilmProject!).mock.results.map((result) => result.value),
    );
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
});
it("does not replace a newer edit with a late saved canonical snapshot", async () => {
  const create = editorModule.createEditorHost;
  let host!: Parameters<typeof create>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return create(value);
  });
  const f = await open();
  let release!: (film: Record<string, unknown>) => void;
  const write = vi.fn(
    (_value: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => {
        release = resolve;
      }),
  );
  window.aijian!.writeFilmProject = write;
  check();
  await waitFor(() => expect(release).toBeTypeOf("function"));
  const original = write.mock.calls[0]![0];
  const edited = structuredClone(host.current()!);
  edited.shots[0]!.picture = "存盘时的新编辑";
  await act(async () => host.applyLive(edited));
  await act(async () => release(original));
  await waitFor(() => expect(screen.getByRole("button", { name: "审核后发布" })).toBeDisabled());
  expect(host.current()!.shots[0]!.picture).toBe("存盘时的新编辑");
  expect(f.prepare).not.toHaveBeenCalled();
});

it("rejects a retained publish callback synchronously after live input changes before React renders", async () => {
  const create = editorModule.createEditorHost,
    renderCheck = exportCheckModule.ExportCheck;
  let host!: Parameters<typeof create>[0], retained: (() => void) | undefined;
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return create(value);
  });
  vi.spyOn(exportCheckModule, "ExportCheck").mockImplementation((props) => {
    retained = props.onExport;
    return renderCheck(props);
  });
  const f = await open();
  check();
  await waitFor(() => expect(screen.getByRole("button", { name: "审核后发布" })).toBeEnabled());
  const callback = retained;
  const live = structuredClone(host.current()!);
  live.shots[0]!.picture = "同步到达的新编辑";
  act(() => {
    host.applyLive(live);
    callback?.();
  });
  expect(f.publish).not.toHaveBeenCalled();
});
