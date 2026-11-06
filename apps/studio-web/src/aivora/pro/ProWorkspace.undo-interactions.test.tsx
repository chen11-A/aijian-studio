import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { readSaved, saveFilm } from "../film/library";
import { sampleFilm, upgradeFilm, type FilmProject } from "../film/project";
import { applyContinuityChecks } from "../film/continuity-rules";
import { ProWorkspace } from "./ProWorkspace";

function fixture() {
  const film = sampleFilm();
  film.scenes = [film.scenes[1]!, ...film.scenes.filter((scene) => scene.id !== "02")];
  const shot = film.shots[1]!;
  shot.poster = "https://example.test/still.png";
  shot.stills = [{ id: "still-retained", prompt: "原画面", url: shot.poster }];
  shot.takes = [1, 2].map((index) => ({
    id: `take-${index}`,
    shotId: shot.id,
    index,
    status: "done" as const,
    stillUrl: shot.poster,
    videoPath: `/story/take-${index}.mp4`,
    cleanVideoPath: `/story/take-${index}-clean.mp4`,
    videoUrl: `aivora-media://local/?path=${encodeURIComponent(`/story/take-${index}.mp4`)}`,
    prompt: "原提示词",
    createdAt: "",
    reason: "",
  }));
  shot.selectedTakeId = "take-2";
  film.audioClips = [
    {
      id: "voice-retained",
      lane: "dialogue",
      shotId: shot.id,
      takeId: "take-2",
      label: "配音",
      startSeconds: 3,
      durationSeconds: 2,
      offsetSeconds: 0,
      gainDb: 0,
      path: "/story/voice.wav",
    },
  ];
  return applyContinuityChecks(upgradeFilm(film)!);
}
async function open(film: FilmProject, page: string) {
  await saveFilm(film);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    [...document.querySelectorAll<HTMLButtonElement>("nav.tabs button")].find((item) =>
      item.textContent?.includes(page),
    )!,
  );
}
const cards = () => [...document.querySelectorAll<HTMLElement>(".grid .card")];
const clips = () => [...document.querySelectorAll<HTMLElement>(".clip.v")];
const undo = () => fireEvent.keyDown(window, { key: "z", ctrlKey: true });
async function restored(film: FilmProject) {
  await waitFor(async () => {
    const saved = await readSaved(film.id);
    expect(saved?.shots).toEqual(film.shots);
    expect(saved?.audioClips).toEqual(film.audioClips);
  });
  expect(document.querySelector(".status-note")?.textContent).toMatch(/^已撤销：/);
}
describe("5-3 workspace undo interactions", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.aijian;
    delete window.aijianGrok;
  });
  it("undoes a card drag in its scene and retains every take, still and voice", async () => {
    const film = fixture();
    await open(film, "分镜");
    const carried: Record<string, string> = {};
    const transfer = {
      types: ["application/x-aivora-shot"],
      effectAllowed: "",
      dropEffect: "",
      setData: (type: string, value: string) => {
        carried[type] = value;
      },
      getData: (type: string) => carried[type] ?? "",
    };
    fireEvent.dragStart(cards()[1]!, { dataTransfer: transfer });
    fireEvent.dragOver(cards()[3]!, { dataTransfer: transfer });
    fireEvent.drop(cards()[3]!, { dataTransfer: transfer });
    await waitFor(async () =>
      expect((await readSaved(film.id))?.shots[3]?.id).toBe(film.shots[1]!.id),
    );
    undo();
    await restored(film);
    carried["application/x-aivora-shot"] = JSON.stringify({
      scope: "other:scene",
      id: film.shots[0]!.id,
    });
    fireEvent.drop(cards()[2]!, { dataTransfer: transfer });
    expect(cards()).toHaveLength(film.shots.length);
    await restored(film);
  });
  it("deletes nonadjacent selected cards once and restores their media with Ctrl+Z", async () => {
    const film = fixture();
    await open(film, "分镜");
    fireEvent.click(cards()[1]!);
    fireEvent.click(cards()[3]!, { ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "删除这 2 个" }));
    expect(cards()).toHaveLength(film.shots.length - 2);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("已删除 2 个镜头，可按 Ctrl+Z 撤销。")).toBeInTheDocument();
    undo();
    await restored(film);
    expect(cards()).toHaveLength(film.shots.length);
  });
  for (const action of ["Delete", "Backspace", "剪掉"]) {
    it(`cuts with ${action} once and restores both old versions and audio with Ctrl+Z`, async () => {
      const film = fixture();
      await open(film, "剪辑");
      fireEvent.click(clips()[1]!);
      if (action === "剪掉") fireEvent.click(screen.getByRole("button", { name: "剪掉" }));
      else fireEvent.keyDown(window, { key: action });
      expect(clips()).toHaveLength(film.shots.length - 1);
      expect(document.querySelector(".cut-ask")).toBeNull();
      undo();
      await restored(film);
      expect(clips()).toHaveLength(film.shots.length);
    });
  }
  it("keeps Delete for fields, menus and dialogs, and requires a picked clip", async () => {
    const film = fixture();
    await open(film, "剪辑");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(clips()).toHaveLength(film.shots.length);
    fireEvent.click(clips()[1]!);
    const field = screen.getByLabelText("改这一镜的描述");
    field.focus();
    fireEvent.keyDown(field, { key: "Backspace" });
    field.blur();
    for (const role of ["dialog", "menu"]) {
      const overlay = document.createElement("div");
      overlay.setAttribute("role", role);
      document.body.append(overlay);
      fireEvent.keyDown(window, { key: "Delete" });
      overlay.remove();
    }
    fireEvent.keyDown(window, { key: "Delete", ctrlKey: true });
    expect(clips()).toHaveLength(film.shots.length);
    expect((await readSaved(film.id))?.shots).toEqual(film.shots);
  });
});
