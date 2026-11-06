import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { historyRecordHash } from "./actions/persistent-history";
import * as editorModule from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";
const createHost = editorModule.createEditorHost;
async function open() {
  let host!: Parameters<typeof createHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return createHost(value);
  });
  const film = sampleFilm(),
    imported = {
      ...structuredClone(film),
      id: "film_imported0000000001",
      seriesId: "film_newseries000000001",
      title: "导入的新作品",
      seriesTitle: "导入的新作品",
      backendProjectId: "",
    };
  let disk = structuredClone(film);
  const read = vi.fn(async (id: string) => structuredClone(id === imported.id ? imported : disk)),
    write = vi.fn(async (value: FilmProject) => {
      disk = structuredClone(value);
      return structuredClone(value);
    });
  const exportPackage = vi.fn(async (input: { projectId: string; expectedHash: string }) => {
    expect(Object.keys(input).sort()).toEqual(["expectedHash", "projectId"]);
    expect(input.projectId).toBe(film.id);
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    return { kind: "EXPORTED", mediaCount: 4 };
  });
  const importPackage = vi.fn(async () => ({
    kind: "IMPORTED",
    projectId: imported.id,
    mediaCount: 4,
  }));
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: read,
    writeFilmProject: write,
    exportFilmProjectArchive: exportPackage,
    importFilmProjectArchive: importPackage,
    createStoryFilm: vi.fn(),
    exportFilmCut: vi.fn(),
  } as unknown as Window["aijian"];
  window.localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  return { film, imported, host: () => host, exportPackage, importPackage, read, write };
}
beforeEach(() => {
  window.localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());
it("exports through the real work menu and a saved canonical identity, without paid/old export calls", async () => {
  const env = await open();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "导出工程包" }));
  const dialog = screen.getByRole("dialog", { name: "导出工程包" });
  expect(env.exportPackage).not.toHaveBeenCalled();
  expect(dialog).toHaveTextContent("不包含历史版本");
  fireEvent.click(within(dialog).getByRole("button", { name: "选择保存位置并打包" }));
  await within(dialog).findByText("工程包已写入所选位置，包含 4 份引用素材。");
  expect(env.exportPackage).toHaveBeenCalledOnce();
  expect(window.aijian?.createStoryFilm).not.toHaveBeenCalled();
  expect(window.aijian?.exportFilmCut).not.toHaveBeenCalled();
});
it("imports through the real menu and reads the new identity from the library before opening", async () => {
  const env = await open();
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "打开工程包" }));
  fireEvent.click(screen.getByRole("button", { name: "选择工程包" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "打开工程包" })).toBeNull());
  expect(env.importPackage).toHaveBeenCalledExactlyOnceWith();
  expect(env.read).toHaveBeenCalledWith(env.imported.id);
  expect(screen.getByRole("button", { name: "作品" })).toHaveTextContent("导入的新作品");
  expect(window.aijian?.createStoryFilm).not.toHaveBeenCalled();
});

it("ignores native import completing after the actual host moved to another work", async () => {
  const env = await open();
  let finish!: (value: { kind: "IMPORTED"; projectId: string; mediaCount: number }) => void;
  env.importPackage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(screen.getByRole("button", { name: "打开工程包" }));
  fireEvent.click(screen.getByRole("button", { name: "选择工程包" }));
  const other = {
    ...structuredClone(env.film),
    id: "film_otherwork00000001",
    seriesTitle: "稍后打开的作品",
  };
  act(() => env.host().applyLive(other));
  await act(async () => finish({ kind: "IMPORTED", projectId: env.imported.id, mediaCount: 4 }));
  expect(env.read.mock.calls.some(([id]) => id === env.imported.id)).toBe(false);
  expect(screen.getByRole("button", { name: "作品" })).toHaveTextContent("稍后打开的作品");
  expect(screen.queryByText("工程包已导入为独立新作品。")).toBeNull();
});
