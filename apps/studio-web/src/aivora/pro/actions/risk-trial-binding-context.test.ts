import { filmAudioSourceIdentity } from "../../film/audio-waveform-data";
import { expect, it } from "vitest";
import {
  riskTrialCreative,
  riskTrialShots,
  riskTrialTarget,
} from "@aijian/contracts/film-risk-trial-context";
import { sampleFilm, type FilmShot, type FilmTake } from "../../film/project";
import { applyVideoResponse } from "./generation-run";
const target = (film: ReturnType<typeof sampleFilm>, shot: FilmShot) =>
  riskTrialTarget(film, shot as unknown as Record<string, unknown>);

it("keeps the next independent target fixed across the actual producer's new take, poster, dub and duration output", () => {
  const film = sampleFilm();
  const shot = {
    ...film.shots[0]!,
    line: "甲：这句话完整保留。",
    lines: [{ speaker: "甲", text: "这句话完整保留。" }],
    seconds: 2,
    selectedTakeId: "",
  };
  const take: FilmTake = {
    id: "new-paid-result",
    shotId: shot.id,
    index: 1,
    status: "running",
    videoPath: "",
    videoUrl: "",
    stillUrl: "",
    prompt: "fixed input",
    reason: "",
    createdAt: "",
  };
  film.shots[0] = { ...shot, takes: [take] };
  const beforeGlobal = riskTrialCreative(film),
    beforeNext = target(film, film.shots[1]!);
  const result = applyVideoResponse(film, film.shots[0]!, take, {
    status: "SUCCEEDED",
    output_path: "/trusted/actual.mp4",
    preview_image: "data:image/png;base64,AA==",
    voice_path: "/trusted/actual-voice.wav",
    duration_seconds: 5,
  });
  expect(result.done).toBe(true);
  const produced = result.film.shots[0]!;
  expect(produced.selectedTakeId).toBe(take.id);
  expect(produced.poster).toBe("data:image/png;base64,AA==");
  expect(produced.sound?.source).toBe("dub");
  expect(produced.seconds).toBe(5);
  expect(result.film.audioClips).toContainEqual(
    expect.objectContaining({
      shotId: shot.id,
      takeId: take.id,
      label: "配音",
      path: "/trusted/actual-voice.wav",
    }),
  );
  expect(riskTrialCreative(result.film)).toEqual(beforeGlobal);
  expect(target(result.film, result.film.shots[1]!)).toEqual(beforeNext);
  expect(target(result.film, produced)).not.toEqual(target(film, film.shots[0]!));
  expect(film.shots[0]!.selectedTakeId).toBe("");
  expect(film.shots[0]!.seconds).toBe(2);
});

it("still binds the actual pending target poster and first-frame references instead of globally ignoring output-looking fields", () => {
  const film = sampleFilm(),
    before = target(film, film.shots[1]!);
  const changed = structuredClone(film);
  changed.shots[1]!.poster = "/trusted/user-replaced-first.png";
  expect(target(changed, changed.shots[1]!)).not.toEqual(before);
  const replaced = structuredClone(film);
  replaced.shots[1]!.stills = [
    { id: "first", url: "/trusted/user-replaced-second.png", prompt: "first frame" },
  ];
  expect(target(replaced, replaced.shots[1]!)).not.toEqual(before);
});

it("keeps user creative edits, voice/settings and ordered scope bound", () => {
  const film = sampleFilm();
  const changed = structuredClone(film);
  changed.shots[1]!.line += "新台词";
  expect(target(changed, changed.shots[1]!)).not.toEqual(target(film, film.shots[1]!));
  changed.narrationVoiceId = "new-voice";
  expect(riskTrialCreative(changed)).not.toEqual(riskTrialCreative(film));
  const reordered = structuredClone(film);
  reordered.shots.reverse();
  expect(riskTrialCreative(reordered)).not.toEqual(riskTrialCreative(film));
});

it("does not re-review saved time, assembly output or waveform analysis metadata", () => {
  const film = sampleFilm();
  const changed = structuredClone(film);
  changed.savedAt = "later";
  changed.assemblyPath = "/trusted/new-assembly.mp4";
  changed.audioClips = [
    {
      id: "score",
      lane: "score",
      path: "/trusted/music.wav",
      shotId: "",
      takeId: "",
      label: "Music",
      startSeconds: 0,
      durationSeconds: 2,
      offsetSeconds: 0,
      gainDb: 0,
    },
  ];
  const before = riskTrialCreative(changed);
  changed.audioClips[0]!.waveform = {
    schemaVersion: 1,
    sourceKey: "a".repeat(64),
    identity: filmAudioSourceIdentity(changed, changed.audioClips[0]),
    sourceSha256: "a".repeat(64),
    offsetSeconds: 0,
    durationSeconds: 2,
    analyzedSeconds: 2,
    peaks: [0.1],
  };
  expect(riskTrialCreative(changed)).toEqual(before);
  changed.audioClips[0]!.gainDb = -6;
  expect(riskTrialCreative(changed)).not.toEqual(before);
});

it("rejects ambiguous or malformed scope and unreviewed prior-shot frame dependencies", () => {
  const film = sampleFilm();
  expect(() => riskTrialShots({ ...film, shots: [film.shots[0], null] })).toThrow(
    "UNSUPPORTED_SCOPE",
  );
  expect(() => riskTrialShots({ ...film, shots: [film.shots[0], film.shots[0]] })).toThrow(
    "UNSUPPORTED_SCOPE",
  );
  const chained = structuredClone(film);
  chained.shots[1]!.continuityFromShotId = chained.shots[0]!.id;
  expect(() => riskTrialShots(chained)).toThrow("UNSUPPORTED_SCOPE");
});
