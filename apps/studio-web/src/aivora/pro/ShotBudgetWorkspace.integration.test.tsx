import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { blankFilm, parseDirectorShots, type FilmProject } from "../film/project";
import { ProWorkspace } from "./ProWorkspace";

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete window.aijian;
});

it("shows the specific unsafe merge pairs without claiming a covered ending is missing", async () => {
  const film = blankFilm();
  film.title = "已手改的十七镜";
  film.scenes[0]!.text = "雨停了。";
  film.scenes[0]!.coverage = {
    sceneId: film.scenes[0]!.id,
    ok: true,
    lastLine: "",
    missingLines: [],
    missingTail: null,
  };
  const template = parseDirectorShots(
    JSON.stringify({ shots: [{ picture: "雨停了。", seconds: 3 }] }),
    film.scenes[0]!.id,
  )![0]!;
  film.shots = Array.from({ length: 17 }, (_, index) => ({
    ...structuredClone(template),
    id: `${film.scenes[0]!.id}-shot-${index + 1}`,
    no: index + 1,
    userFields: ["picture"],
  }));
  window.aijian = {
    readFilmProject: vi.fn(async () => film),
    writeFilmProject: vi.fn(async (value: FilmProject) => value),
    listFilmSeries: vi.fn(async () => []),
    listFilmEpisodes: vi.fn(async () => []),
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findAllByText(film.title);
  fireEvent.click(
    screen.getAllByRole("button", { name: /分镜/ }).find((item) => item.className.includes("tab"))!,
  );
  expect(screen.getByText(/这一场共17镜，最多16镜/)).toHaveTextContent(
    "第1镜、第2镜：已有手动修改",
  );
  expect(screen.queryByText(/结尾还没拍到/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "补上结尾" })).not.toBeInTheDocument();
});
