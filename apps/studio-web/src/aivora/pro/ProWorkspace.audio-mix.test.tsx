import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildAudioMixPlan, audioMixSettings } from "@aijian/contracts/film-audio-mix-plan";
import { sampleFilm, type FilmProject } from "../film/project";
import { historyRecordHash } from "./actions/persistent-history";
import * as editor from "./actions/editor-host";
import { ProWorkspace } from "./ProWorkspace";
const originalHost = editor.createEditorHost;
beforeEach(() => {
  localStorage.clear();
  delete window.aijian;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function open() {
  let host!: Parameters<typeof originalHost>[0];
  vi.spyOn(editor, "createEditorHost").mockImplementation((value) => {
    host = value;
    return originalHost(value);
  });
  const film = sampleFilm();
  film.scenes = film.scenes.slice(0, 1);
  film.shots = film.shots.slice(0, 1).map((shot) => ({
    ...shot,
    selectedTakeId: "v1",
    takes: [1, 2].map((index) => ({
      id: `v${index}`,
      shotId: shot.id,
      index,
      status: "done" as const,
      videoPath: `/trusted/v${index}.mp4`,
      stillUrl: "",
      videoUrl: "",
      prompt: "",
      reason: "",
      createdAt: "",
    })),
  }));
  film.audioClips = [
    {
      id: "old-voice",
      lane: "dialogue",
      label: "配音",
      shotId: film.shots[0]!.id,
      takeId: "v1",
      startSeconds: 0,
      durationSeconds: 1,
      offsetSeconds: 0,
      gainDb: -6,
      path: "/trusted/voice.wav",
    },
  ];
  let disk = structuredClone(film);
  const create = vi.fn(),
    oldExport = vi.fn();
  const preview = vi.fn(async (input: { projectId: string; expectedHash: string }) => {
    expect(input.projectId).toBe(disk.id);
    expect(input.expectedHash).toBe(await historyRecordHash(disk));
    const shot = disk.shots[0]!,
      take = shot.selectedTakeId!;
    return {
      kind: "READY",
      plan: buildAudioMixPlan({
        projectId: disk.id,
        durationSeconds: 2,
        shots: [
          {
            shotId: shot.id,
            takeId: take,
            nativeSourceKey: take,
            startSeconds: 0,
            durationSeconds: 2,
            hasDialogue: false,
          },
        ],
        clips: [],
        sources: { [take]: { durationSeconds: 2, hasAudio: true } },
        controls: { lanes: audioMixSettings(disk.audioMix).lanes },
      }),
      sourcePaths: {},
      sourceSha256: {},
      sourceInfo: {},
      fingerprint: input.expectedHash,
    };
  });
  window.aijian = {
    listFilmSeries: vi.fn(async () => []),
    readFilmProject: vi.fn(async () => structuredClone(disk)),
    prepareFilmProject: vi.fn(async (v: FilmProject) => structuredClone(v)),
    writeFilmProject: vi.fn(async (v: FilmProject) => {
      disk = structuredClone(v);
      return structuredClone(v);
    }),
    getFilmAudioMixPreview: preview,
    createStoryFilm: create,
    exportFilmCut: oldExport,
  } as unknown as Window["aijian"];
  localStorage.setItem("aivora.film.activeId", film.id);
  render(<ProWorkspace />);
  await screen.findByLabelText("这一场");
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "创作阶段" })).getByRole("button", {
      name: /剪辑/,
    }),
  );
  await waitFor(() => expect(preview).toHaveBeenCalled());
  return { host: () => host, disk: () => disk, preview, create, oldExport };
}
it("persists a whole-lane mute across selected-version replacement without modifying old clip gains or dispatching", async () => {
  const env = await open();
  fireEvent.click(screen.getByRole("button", { name: "静音对白" }));
  await waitFor(() => expect(env.disk().audioMix?.lanes.dialogue.muted).toBe(true));
  expect(env.disk().audioClips[0]!.gainDb).toBe(-6);
  const current = env.host().current()!;
  await act(async () =>
    env.host().applyLive({
      ...current,
      shots: current.shots.map((shot) => ({ ...shot, selectedTakeId: "v2" })),
    }),
  );
  await waitFor(() => expect(env.disk().shots[0]!.selectedTakeId).toBe("v2"));
  await waitFor(() => expect(env.preview.mock.results.at(-1)?.type).toBe("return"));
  expect(screen.getByRole("button", { name: "静音对白" })).toHaveAttribute("aria-pressed", "true");
  expect(env.disk().audioMix?.lanes.dialogue.muted).toBe(true);
  expect(env.disk().audioClips[0]!.takeId).toBe("v1");
  expect(env.create).not.toHaveBeenCalled();
  expect(env.oldExport).not.toHaveBeenCalled();
});
it("keeps solo audition out of saved creative settings and exposes normalization as explicit default-off", async () => {
  const env = await open();
  fireEvent.click(screen.getByRole("button", { name: "单听环境音" }));
  expect(env.host().current()!.audioMix).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "导出成片" }));
  const checkbox = screen.getByRole("checkbox", { name: /自动调整音量/ });
  expect(checkbox).not.toBeChecked();
  fireEvent.click(checkbox);
  await waitFor(() => expect(env.disk().audioMix?.autoAdjustVolume).toBe(true));
  expect(env.disk().audioMix?.lanes.score.gainDb).toBe(0);
  expect(env.create).not.toHaveBeenCalled();
  expect(env.oldExport).not.toHaveBeenCalled();
});
