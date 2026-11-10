import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { blankFilm, type FilmShot } from "../film/project";
import { StillAcceptanceControls, guardBlockedVideo } from "./StillAcceptanceDialog";

function shot(): FilmShot {
  return {
    id: "s2",
    sceneId: "scene-1",
    no: 2,
    size: "中景",
    angle: "平视",
    move: "固定",
    seconds: 3,
    picture: "",
    action: "",
    performance: "",
    characters: [],
    line: "",
    sound: { source: "native", ambience: "", sfx: [], musicMood: "" },
    source: "test",
    userFields: [],
    poster: "/still.png",
    posterPosition: "",
    takes: [],
    stills: [],
    selectedTakeId: "",
  };
}

it("blocks video until every checklist row matches, and a mismatch cannot adopt", () => {
  const film = blankFilm();
  film.scenes[0] = { ...film.scenes[0]!, where: "旧书店" };
  film.shots = [shot()];
  const onFilm = vi.fn();
  const onRestill = vi.fn();
  const onGenerate = vi.fn();
  const view = render(
    <>
      <StillAcceptanceControls
        film={film}
        shot={film.shots[0]!}
        onFilm={onFilm}
        onRestill={onRestill}
      />
      <button type="button" {...guardBlockedVideo(false, onGenerate)}>
        生成视频
      </button>
    </>,
  );
  const video = screen.getByRole("button", { name: "生成视频" });
  expect(video).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(video);
  fireEvent.keyDown(video, { key: "Enter" });
  fireEvent.keyDown(video, { key: " " });
  expect(onGenerate).not.toHaveBeenCalled();
  expect(screen.getByText("镜头 2 的画面还没核对")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "去核对镜头 2" }));
  expect(screen.getByRole("dialog", { name: "核对并采用 · 镜头 2" })).toBeInTheDocument();
  expect(screen.getByText("画面里没有人物")).toBeInTheDocument();
  for (const row of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(row);
  fireEvent.click(screen.getAllByRole("button", { name: "不符合" })[1]!);
  expect(screen.getByRole("button", { name: "采用" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "重出这一镜" }));
  expect(onRestill).toHaveBeenCalledOnce();
  expect(onFilm.mock.calls[0]![0].shots[0].stills[0].acceptance.adopted).toBe(false);
  view.rerender(
    <>
      <StillAcceptanceControls
        film={onFilm.mock.calls[0]![0]}
        shot={onFilm.mock.calls[0]![0].shots[0]}
        onFilm={onFilm}
        onRestill={onRestill}
      />
      <button type="button" {...guardBlockedVideo(false, onGenerate)}>
        生成视频
      </button>
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "核对并采用" }));
  for (const button of screen.getAllByRole("button", { name: "符合" })) fireEvent.click(button);
  fireEvent.click(screen.getByRole("button", { name: "采用" }));
  expect(onFilm.mock.calls.at(-1)![0].shots[0].stills[0].acceptance.adopted).toBe(true);
});
