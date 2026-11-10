import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { blankFilm } from "../film/project";
import { ExportSoundChoice } from "./ExportSoundChoice";

it("asks for silence or sound work, and does not call a quiet track finished", () => {
  const film = blankFilm();
  film.audioClips = [
    {
      id: "aac",
      lane: "ambience",
      shotId: "",
      takeId: "",
      label: "静音轨",
      startSeconds: 0,
      durationSeconds: 1,
      offsetSeconds: 0,
      gainDb: -91,
      path: "/mix/silent.aac",
    },
  ];
  const onSilent = vi.fn();
  const onMakeSound = vi.fn();
  const view = render(
    <ExportSoundChoice film={film} onSilent={onSilent} onMakeSound={onMakeSound} />,
  );
  expect(
    screen.getByText("还没决定这部片子有没有声音。有音轨也不代表有声音。"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/都做好了|完成/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "先去做声音" }));
  expect(onMakeSound).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "本片静音" }));
  expect(onSilent).toHaveBeenCalledOnce();
  const chosen = { ...film, audioDecision: "SILENT_BY_USER" as const };
  view.rerender(<ExportSoundChoice film={chosen} onSilent={onSilent} onMakeSound={onMakeSound} />);
  expect(screen.getByText(/已选择本片静音/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "本片静音" })).toBeNull();
});
