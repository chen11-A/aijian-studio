import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import { beginTaskBatch, runTask, taskSnapshot } from "../film/task-progress";
import * as editorModule from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";
const createHost = editorModule.createEditorHost;
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
});
afterEach(() => vi.restoreAllMocks());
it("does not treat historical completed portrait tasks as current media, then shows actual current URLs as done", async () => {
  const film = sampleFilm();
  film.id = "film_portraitstatus0001";
  const views = ["正面", "侧面", "背面", "脸部"];
  const batchId = `portraits:${film.id}:previous-run`;
  beginTaskBatch({ projectId: film.id, batchId, label: "定妆照", total: 4 });
  for (const view of views)
    await runTask(
      {
        projectId: film.id,
        batchId,
        id: `${batchId}:lin:${view}`,
        kind: "image",
        title: "历史定妆照任务",
      },
      async () => undefined,
    );
  let host!: Parameters<typeof createHost>[0];
  vi.spyOn(editorModule, "createEditorHost").mockImplementation((value) => {
    host = value;
    return createHost(value);
  });
  let stored = structuredClone(film);
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(stored)),
    writeFilmProject: vi.fn(async (value: FilmProject) => {
      stored = structuredClone(value);
      return structuredClone(stored);
    }),
    createStoryFilm: vi.fn(),
    generateFilmStill: vi.fn(),
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /角色与场景/,
    }),
  );
  expect(
    taskSnapshot().tasks.filter((task) => task.id.startsWith(batchId) && task.status === "done"),
  ).toHaveLength(4);
  expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(0);
  for (const view of views) expect(screen.getByLabelText(`${view}还没有`)).toBeInTheDocument();
  const current = structuredClone(host.current()!);
  current.characters[0]!.portraits = views.map((view, index) => ({
    view,
    prompt: "当前素材",
    url: `/media/current-${index}.png`,
  }));
  act(() => host.applyLive(current));
  await waitFor(() =>
    expect(document.querySelectorAll(".refs4 .slot[data-state=done]")).toHaveLength(4),
  );
  for (const view of views) expect(screen.queryByLabelText(`${view}还没有`)).toBeNull();
  expect(
    taskSnapshot().tasks.filter((task) => task.id.startsWith(batchId) && task.status === "done"),
  ).toHaveLength(4);
  expect(window.aijian!.createStoryFilm).not.toHaveBeenCalled();
  expect(window.aijian!.generateFilmStill).not.toHaveBeenCalled();
});
