import { webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../film/project";
import type {
  CleanCopyRecoveryInput,
  CleanCopyRecoveryResult,
} from "@aijian/contracts/clean-copy-recovery";
import { ProWorkspace } from "./ProWorkspace";
import { cleanCopySelectionHash } from "./actions/clean-copy-recovery";
async function open() {
  const film = sampleFilm();
  film.scenes = [film.scenes[0]!];
  film.shots = film.shots.slice(0, 1);
  film.audioClips = [];
  const shot = film.shots[0]!;
  shot.sceneId = film.scenes[0]!.id;
  shot.selectedTakeId = "chosen";
  shot.takes = [
    {
      id: "chosen",
      shotId: shot.id,
      index: 1,
      status: "done",
      videoPath: "/story/original.mp4",
      cleanVideoPath: "/story/old-clean.mp4",
      videoUrl: "",
      stillUrl: "",
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  const other = structuredClone(film);
  other.id = "film_recoveryother001";
  other.episodeTitle = "第 2 集";
  other.episodeNo = 2;
  other.scenes[0]!.text = "第二个作品的独立正文";
  const stored = new Map([
    [film.id, structuredClone(film)],
    [other.id, other],
  ]);
  let finish!: (value: CleanCopyRecoveryResult) => void;
  const recover = vi.fn(
    (_input: CleanCopyRecoveryInput) =>
      new Promise<CleanCopyRecoveryResult>((resolve) => {
        finish = resolve;
      }),
  );
  const old = vi.fn(),
    generate = vi.fn();
  const write = vi.fn(async (value: FilmProject) => {
    stored.set(value.id, structuredClone(value));
    return structuredClone(value);
  });
  window.aijian = {
    listFilmSeries: vi.fn(async () => [
      { id: film.seriesId, title: film.title, path: "", savedAt: "" },
    ]),
    listFilmEpisodes: vi.fn(async () =>
      [...stored.values()].map((value) => ({
        id: value.id,
        seriesId: value.seriesId,
        title: value.episodeTitle,
        no: value.episodeNo,
        shots: 1,
        done: 1,
        savedAt: "",
      })),
    ),
    readFilmProject: vi.fn(async (id: string) => structuredClone(stored.get(id) ?? null)),
    writeFilmProject: write,
    prepareFilmExport: vi.fn(async () => ({ kind: "FAILED", code: "SOURCE_UNVERIFIED" })),
    recoverFilmCleanCopy: recover,
    remakeStoryFilmCleanCopy: old,
    createStoryFilm: generate,
    exportFilmCut: old,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  fireEvent.click(screen.getByRole("button", { name: "检查成片" }));
  const button = await screen.findByRole("button", {
    name: /第 1 场第 1 个镜头：重建可核验的无字幕副本/,
  });
  return {
    film,
    other,
    stored,
    recover,
    old,
    generate,
    write,
    button,
    start: async () => {
      fireEvent.click(button);
      await waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
    },
    complete: async (kind: "RECOVERED" | "REUSED_ORIGINAL" | "EVIDENCE_FAILED" = "RECOVERED") => {
      await act(async () => {
        if (kind === "EVIDENCE_FAILED") finish({ kind: "FAILED", code: kind });
        else {
          const restored = structuredClone(stored.get(film.id)!);
          restored.shots[0]!.takes[0]!.cleanVideoPath =
            kind === "REUSED_ORIGINAL" ? "/story/original.mp4" : "/story/new-proof-clean.mp4";
          stored.set(film.id, restored);
          finish({ kind, project: restored });
        }
      });
    },
  };
}
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
  delete window.aijianGrok;
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());
it("requires an explicit local action and sends only fixed project/selection identities", async () => {
  const f = await open();
  expect(f.recover).not.toHaveBeenCalled();
  await f.start();
  expect(f.recover).toHaveBeenCalledWith({
    projectId: f.film.id,
    shotId: f.film.shots[0]!.id,
    takeId: "chosen",
    selectionHash: await cleanCopySelectionHash("/story/original.mp4", "/story/old-clean.mp4"),
  });
  fireEvent.click(f.button);
  expect(f.recover).toHaveBeenCalledTimes(1);
  await f.complete();
  await waitFor(() =>
    expect(f.stored.get(f.film.id)!.shots[0]!.takes[0]!.cleanVideoPath).toBe(
      "/story/new-proof-clean.mp4",
    ),
  );
  expect(f.stored.get(f.film.id)!.shots[0]!.takes[0]!.videoPath).toBe("/story/original.mp4");
  expect(f.old).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
});
it("preserves new edits instead of applying a late recovered snapshot", async () => {
  const f = await open();
  await f.start();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.change(screen.getByLabelText("这一场"), {
    target: { value: "用户在等待期间的新编辑" },
  });
  await f.complete();
  expect(screen.getByLabelText("这一场")).toHaveValue("用户在等待期间的新编辑");
  await waitFor(() =>
    expect(f.stored.get(f.film.id)!.scenes[0]!.text).toBe("用户在等待期间的新编辑"),
  );
  expect(f.stored.get(f.film.id)!.shots[0]!.takes[0]!.cleanVideoPath).toBe("/story/old-clean.mp4");
  expect(f.old).not.toHaveBeenCalled();
});
it("retains saved recovery in its original project without applying it to a newly opened project", async () => {
  const f = await open();
  await f.start();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByRole("button", { name: "作品" }));
  fireEvent.click(await screen.findByRole("button", { name: "第 2 集" }));
  await screen.findByText(/已打开第 2 集/);
  await f.complete();
  expect(screen.getByLabelText("这一场")).toHaveValue("第二个作品的独立正文");
  expect(f.stored.get(f.other.id)!.shots[0]!.takes[0]!.cleanVideoPath).toBe("/story/old-clean.mp4");
  expect(f.stored.get(f.film.id)!.shots[0]!.takes[0]!.cleanVideoPath).toBe(
    "/story/new-proof-clean.mp4",
  );
  expect(f.generate).not.toHaveBeenCalled();
});
it("keeps the old copy on missing final evidence and does not announce success", async () => {
  const f = await open();
  await f.start();
  await f.complete("EVIDENCE_FAILED");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /第 1 场第 1 个镜头：重建可核验/ })).toBeEnabled(),
  );
  expect(f.stored.get(f.film.id)!.shots[0]!.takes[0]!.cleanVideoPath).toBe("/story/old-clean.mp4");
  expect(screen.queryByText("不带字幕的版本补好了。")).toBeNull();
  expect(f.old).not.toHaveBeenCalled();
});
it("does not dispatch recovery when the current project could not first be saved", async () => {
  const f = await open();
  f.write.mockRejectedValueOnce(new Error("private/write"));
  fireEvent.click(f.button);
  await waitFor(() => expect(f.write).toHaveBeenCalled());
  expect(await screen.findByText("修改没存上，可以再试一次。")).toBeInTheDocument();
  expect(f.recover).not.toHaveBeenCalled();
  expect(f.old).not.toHaveBeenCalled();
});
it("clearly reuses a proven subtitle-free original without calling it a newly rebuilt copy", async () => {
  const f = await open();
  await f.start();
  await f.complete("REUSED_ORIGINAL");
  await waitFor(() =>
    expect(f.stored.get(f.film.id)!.shots[0]!.takes[0]!.cleanVideoPath).toBe("/story/original.mp4"),
  );
  expect(await screen.findByText("没有需要补做的镜头。")).toBeInTheDocument();
  expect(screen.queryByText("不带字幕的版本补好了。")).toBeNull();
  expect(f.generate).not.toHaveBeenCalled();
});
