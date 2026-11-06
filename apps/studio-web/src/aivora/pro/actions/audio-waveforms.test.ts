import { describe, expect, it, vi } from "vitest";
import { sampleFilm, upgradeFilm } from "../../film/project";
import { audioSourceKey, refreshAudioWaveforms, invalidateAudioWaveforms } from "./audio-waveforms";
import type { FilmAudioWaveformResult } from "@aijian/contracts/film-audio-waveform";
import { filmAudioSourceIdentity } from "../../film/audio-waveform-data";
import { normalizeAudioClips } from "../../film/audio";
function fixture() {
  const film = sampleFilm();
  const shot = film.shots[0]!;
  shot.selectedTakeId = "take1";
  shot.takes = [
    {
      id: "take1",
      shotId: shot.id,
      index: 1,
      status: "done",
      videoPath: "/synthetic/video.mp4",
      videoUrl: "",
      stillUrl: "",
      prompt: "",
      reason: "",
      createdAt: "",
    },
  ];
  film.audioClips = [
    {
      id: "voice1",
      lane: "dialogue",
      shotId: shot.id,
      takeId: "take1",
      label: "配音",
      path: "/synthetic/voice.wav",
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: 1,
      gainDb: 0,
    },
  ];
  return film;
}
async function ready(film: ReturnType<typeof fixture>): Promise<FilmAudioWaveformResult> {
  return {
    kind: "READY",
    waveform: {
      schemaVersion: 1,
      sourceKey: await audioSourceKey(film, film.audioClips[0]!),
      sourceSha256: "a".repeat(64),
      offsetSeconds: 0,
      durationSeconds: 1,
      analyzedSeconds: 1,
      peaks: [0, 0.125, 0.25, 0],
    },
  };
}
describe("actual waveform merge and persisted boundaries", () => {
  it("persists bounded source peaks through normalize/restart without changing clips, gain or media", async () => {
    let film = fixture();
    const base = structuredClone(film),
      result = await ready(film),
      verified = vi.fn();
    await refreshAudioWaveforms(base, {
      current: () => film,
      read: vi.fn(async () => result),
      apply: (next) => {
        film = next;
      },
      verified,
      currentRun: () => true,
    });
    expect(film.audioClips[0]!.waveform).toEqual(
      result.kind === "READY"
        ? { ...result.waveform, identity: filmAudioSourceIdentity(base, base.audioClips[0]!) }
        : undefined,
    );
    expect(verified).toHaveBeenCalledOnce();
    const restart = upgradeFilm(JSON.parse(JSON.stringify(film)))!;
    expect(restart.audioClips[0]!.waveform).toEqual(film.audioClips[0]!.waveform);
    expect(restart.shots[0]!.takes).toEqual(base.shots[0]!.takes);
    expect(restart.audioClips[0]!.gainDb).toBe(0);
    expect(
      normalizeAudioClips([{ ...film.audioClips[0], offsetSeconds: 0.5 }])[0]!.waveform,
    ).toBeUndefined();
  });
  it.each(["project", "take", "path", "trim", "run"])(
    "rejects a late %s result without replacing live edits",
    async (kind) => {
      let film = fixture();
      const base = structuredClone(film),
        reply = await ready(film),
        verified = vi.fn(),
        apply = vi.fn();
      await refreshAudioWaveforms(base, {
        current: () => film,
        read: async () => {
          film = structuredClone(film);
          if (kind === "project") film.id = "film_other000000000000";
          if (kind === "take") film.shots[0]!.selectedTakeId = "take2";
          if (kind === "path") film.audioClips[0]!.path = "/new.wav";
          if (kind === "trim") film.audioClips[0]!.offsetSeconds = 0.5;
          return reply;
        },
        apply,
        verified,
        currentRun: () => kind !== "run",
      });
      expect(apply).not.toHaveBeenCalled();
      expect(verified).not.toHaveBeenCalled();
      expect(film.audioClips[0]!.waveform).toBeUndefined();
    },
  );
  it("keeps later unrelated media and discards missing/failed/stale peaks instead of inventing them", async () => {
    let film = fixture();
    const valid = await ready(film);
    if (valid.kind !== "READY") throw Error();
    film.audioClips[0]!.waveform = {
      ...valid.waveform,
      identity: filmAudioSourceIdentity(film, film.audioClips[0]!),
    };
    const base = structuredClone(film);
    await refreshAudioWaveforms(base, {
      current: () => film,
      read: async () => {
        film = { ...film, title: "后来编辑的标题" };
        return { kind: "EMPTY", code: "NO_AUDIO" };
      },
      apply: (next) => {
        film = next;
      },
      verified: vi.fn(),
      currentRun: () => true,
    });
    expect(film.title).toBe("后来编辑的标题");
    expect(film.audioClips[0]!.waveform).toBeUndefined();
  });
  it.each([NaN, Infinity, -0.1, 1.1])("drops malformed stored peak %s", async (peak) => {
    const film = fixture(),
      reply = await ready(film);
    if (reply.kind !== "READY") throw Error();
    reply.waveform.peaks[0] = peak;
    expect(
      normalizeAudioClips([
        {
          ...film.audioClips[0],
          waveform: {
            ...reply.waveform,
            identity: filmAudioSourceIdentity(film, film.audioClips[0]!),
          },
        },
      ])[0]!.waveform,
    ).toBeUndefined();
  });
  it("does not request files for unavailable source placeholders", async () => {
    const film = fixture();
    film.audioClips[0]!.path = "";
    const read = vi.fn();
    await refreshAudioWaveforms(film, {
      current: () => film,
      read,
      apply: vi.fn(),
      verified: vi.fn(),
      currentRun: () => true,
    });
    expect(read).not.toHaveBeenCalled();
  });
});

it.each(["path", "take", "trim"])(
  "clears stored old peaks synchronously on %s changes",
  async (kind) => {
    const film = fixture(),
      result = await ready(film);
    if (result.kind !== "READY") throw Error();
    film.audioClips[0]!.waveform = {
      ...result.waveform,
      identity: filmAudioSourceIdentity(film, film.audioClips[0]!),
    };
    if (kind === "path") film.audioClips[0]!.path = "/changed.wav";
    if (kind === "take") film.shots[0]!.selectedTakeId = "new-take";
    if (kind === "trim") film.audioClips[0]!.offsetSeconds = 0.5;
    expect(invalidateAudioWaveforms(film).audioClips[0]!.waveform).toBeUndefined();
  },
);
