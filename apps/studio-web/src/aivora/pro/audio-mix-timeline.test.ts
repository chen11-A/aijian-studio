import { expect, it } from "vitest";
import { buildAudioMixPlan } from "@aijian/contracts/film-audio-mix-plan";
import { sampleFilm } from "../film/project";
import { audioTimelineBox } from "./audio-mix-timeline";
it("projects the actual probed audio window through the shot clock instead of storyboard seconds", () => {
  const film = sampleFilm();
  film.shots = film.shots.slice(0, 2).map((shot, i) => ({
    ...shot,
    selectedTakeId: `v${i}`,
    takes: [
      {
        id: `v${i}`,
        shotId: shot.id,
        status: "done",
        index: 1,
        videoPath: "/video.mp4",
        prompt: "",
        reason: "",
        createdAt: "",
        stillUrl: "",
        videoUrl: "",
      },
    ],
  }));
  const clip = {
    id: "clip",
    shotId: film.shots[1]!.id,
    takeId: "v1",
    lane: "ambience" as const,
    label: "" as const,
    startSeconds: 1,
    durationSeconds: 2,
    offsetSeconds: 0.5,
    gainDb: 0,
    path: "/a.wav",
  };
  const plan = buildAudioMixPlan({
    projectId: film.id,
    durationSeconds: 10,
    shots: film.shots.map((shot, i) => ({
      shotId: shot.id,
      takeId: `v${i}`,
      nativeSourceKey: "silent",
      startSeconds: i ? 4 : 0,
      durationSeconds: i ? 6 : 4,
      hasDialogue: false,
    })),
    sources: {
      audio: { durationSeconds: 2, hasAudio: true },
      silent: { durationSeconds: 10, hasAudio: false },
    },
    clips: [{ ...clip, sourceKey: "audio" }],
  });
  const boxes = [
    { id: film.shots[0]!.id, left: 0, width: 80 },
    { id: film.shots[1]!.id, left: 100, width: 120 },
  ];
  // Source has 1.5s left after offset; 20px per actual second in this shot.
  expect(audioTimelineBox(film, clip, film.shots, boxes, 99, plan)).toEqual({
    left: 120,
    width: 30,
  });
  expect(
    audioTimelineBox(film, { ...clip, takeId: "old" }, film.shots, boxes, 99, plan),
  ).toBeNull();
});
