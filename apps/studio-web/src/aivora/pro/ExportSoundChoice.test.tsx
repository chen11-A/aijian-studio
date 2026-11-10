import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { blankFilm } from "../film/project";
import { ExportSoundChoice } from "./ExportSoundChoice";

it("asks for an explicit sound decision even when there are no clips", () => {
  const film = blankFilm();
  const onSilent = vi.fn();
  const onWithAudio = vi.fn();
  const onMakeSound = vi.fn();
  const view = render(
    <ExportSoundChoice
      film={film}
      onSilent={onSilent}
      onWithAudio={onWithAudio}
      onMakeSound={onMakeSound}
    />,
  );
  expect(
    screen.getByText("还没决定这部片子有没有声音。有音轨也不代表有声音。"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/都做好了|可听声音|完成/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "先去做声音" }));
  fireEvent.click(screen.getByRole("button", { name: "确认有声导出" }));
  fireEvent.click(screen.getByRole("button", { name: "本片静音" }));
  expect(onMakeSound).toHaveBeenCalledOnce();
  expect(onWithAudio).toHaveBeenCalledOnce();
  expect(onSilent).toHaveBeenCalledOnce();
  view.rerender(
    <ExportSoundChoice
      film={{ ...film, audioDecision: "SILENT_BY_USER" }}
      onSilent={onSilent}
      onWithAudio={onWithAudio}
      onMakeSound={onMakeSound}
    />,
  );
  expect(screen.getByText(/已选择本片静音/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "本片静音" })).toBeNull();
});
