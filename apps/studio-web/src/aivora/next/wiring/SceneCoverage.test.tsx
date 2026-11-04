import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { sampleFilm } from "../../film/project";
import { SceneCoverage } from "./SceneCoverage";

it("repairs the selected empty scene and shows only its unassigned actions", async () => {
  const film = sampleFilm();
  const scene = film.scenes[1]!;
  scene.coverage = {
    sceneId: scene.id,
    ok: false,
    lastLine: "别走。",
    missingLines: ["别走。"],
    missingTail: "警笛响起。",
  };
  film.unassignedBeats = [
    { sceneId: scene.id, text: "未分配抬手" },
    { sceneId: film.scenes[0]!.id, text: "另一场动作" },
  ];
  const repair = vi
    .fn()
    .mockRejectedValueOnce(new Error("disk unavailable"))
    .mockResolvedValue(null);
  render(<SceneCoverage film={film} sceneId={scene.id} onRepair={repair} />);
  expect(screen.getByText(/警笛响起/)).toBeInTheDocument();
  expect(screen.queryByText("另一场动作")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "补上结尾" }));
  expect(repair).toHaveBeenCalledWith(scene.id);
  expect(await screen.findByRole("alert")).toHaveTextContent("未完成");
  await waitFor(() => expect(screen.getByRole("button", { name: "补上结尾" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "补上结尾" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
