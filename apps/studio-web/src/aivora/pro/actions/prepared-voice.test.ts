import { expect, it } from "vitest";
import { sampleFilm } from "../../film/project";
import { bindPreparedVoice } from "./prepared-voice";
it("binds only an explicitly chosen current version, preserves every source and refuses replay or ambiguity and retains a competing dub disabled", () => {
  const film = sampleFilm(),
    shot = film.shots[0]!;
  shot.selectedTakeId = "take";
  shot.takes = [
    {
      id: "take",
      shotId: shot.id,
      status: "done",
      videoPath: "/selected.mp4",
      stillUrl: "",
      videoUrl: "",
      index: 1,
      prompt: "",
      createdAt: "",
      reason: "",
    },
  ];
  film.audioClips = [
    {
      id: "voice",
      lane: "dialogue",
      label: "配音",
      path: "/recorded.wav",
      shotId: shot.id,
      takeId: "",
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: 1,
      gainDb: 0,
    },
  ];
  const input = { projectId: film.id, clipId: "voice", shotId: shot.id, takeId: "take" },
    before = structuredClone(film);
  const bound = bindPreparedVoice(film, input)!;
  expect(film).toEqual(before);
  expect(bound.audioClips[0]).toEqual(film.audioClips[0]);
  expect(bound.audioClips[1]).toMatchObject({ path: "/recorded.wav", takeId: "take", gainDb: 0 });
  expect(bindPreparedVoice(bound, input)).toBeNull();
  expect(bindPreparedVoice(film, { ...input, projectId: "other" })).toBeNull();
  expect(bindPreparedVoice(film, { ...input, takeId: "old" })).toBeNull();
  const competing = {
    ...film,
    audioClips: [
      ...film.audioClips,
      { ...bound.audioClips[1]!, id: "other-dub", path: "/other.wav", gainDb: -3 },
    ],
  };
  const selected = bindPreparedVoice(competing, input)!;
  expect(selected.audioClips.find((clip) => clip.id === "other-dub")).toMatchObject({
    path: "/other.wav",
    gainDb: -3,
    enabled: false,
  });
  expect(
    selected.audioClips.filter((clip) => clip.takeId === "take" && clip.enabled !== false),
  ).toHaveLength(1);
  const restored = bindPreparedVoice(selected, { ...input, clipId: "other-dub" })!;
  expect(restored.audioClips.find((clip) => clip.id === "other-dub")?.enabled).toBe(true);
  expect(
    restored.audioClips.filter((clip) => clip.takeId === "take" && clip.enabled !== false),
  ).toHaveLength(1);
  expect(bindPreparedVoice({ ...film, shots: [...film.shots, shot] }, input)).toBeNull();
});
