import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile, readFile, copyFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createFilmAudioWaveforms, registerFilmAudioWaveforms } from "./film-audio-waveform";
import { filmAudioSourceIdentity, validFilmAudioWaveform } from "./film-audio-waveform-data";
import { ffmpegOnPath, ffmpegSkipReason } from "./test-ffmpeg";
const run = promisify(execFile),
  roots: string[] = [];
const id = "film_aaaaaaaaaaaaaaaa",
  seriesId = "film_bbbbbbbbbbbbbbbb";
async function setup(filter = "sine=frequency=440:duration=1") {
  const root = await mkdtemp(join(tmpdir(), "waveform-"));
  roots.push(root);
  const folder = join(root, seriesId, "episodes", id);
  await mkdir(folder, { recursive: true });
  const source = join(folder, "voice.wav");
  await run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    filter,
    "-c:a",
    "pcm_s16le",
    source,
  ]);
  const clip = {
    id: "voice-1",
    lane: "dialogue",
    shotId: "shot1",
    takeId: "take1",
    label: "配音",
    offsetSeconds: 0,
    durationSeconds: 1,
    path: source,
  };
  const film = {
    id,
    seriesId,
    audioClips: [clip],
    shots: [
      {
        id: "shot1",
        selectedTakeId: "take1",
        takes: [
          { id: "take1", shotId: "shot1", status: "done", videoPath: join(folder, "video.mp4") },
        ],
      },
    ],
  };
  const tools = vi.fn(async () => ({ ffmpegPath: "ffmpeg", ffprobePath: "ffprobe" }));
  const read = vi.fn(async () => structuredClone(film));
  const produce = createFilmAudioWaveforms({
    filmsRoot: root,
    storyFilmsRoot: join(root, "story"),
    tools,
    read,
  });
  const request = () => ({
    projectId: id,
    clipId: clip.id,
    expectedSourceKey: createHash("sha256")
      .update(filmAudioSourceIdentity(film, clip))
      .digest("hex"),
  });
  return { root, source, clip, film, tools, read, produce, request };
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
describe.skipIf(!ffmpegOnPath())("trusted source waveform decode", () => {
  it("decodes real amplitude, silence and distinct sources without per-clip normalization", async () => {
    const env = await setup();
    const first = await env.produce(env.request());
    expect(first.kind).toBe("READY");
    if (first.kind !== "READY") return;
    expect(validFilmAudioWaveform(first.waveform)).toBe(true);
    expect(Math.max(...first.waveform.peaks)).toBeGreaterThan(0.1);
    expect(Math.max(...first.waveform.peaks)).toBeLessThan(0.2);
    const silent = await setup("anullsrc=r=44100:cl=mono:d=1");
    const zero = await silent.produce(silent.request());
    expect(zero.kind).toBe("READY");
    if (zero.kind !== "READY") return;
    expect(zero.waveform.peaks.every((p) => p === 0)).toBe(true);
    expect(zero.waveform.sourceSha256).not.toBe(first.waveform.sourceSha256);
  });
  it("binds the actual trim window and rejects a stale request after trim or version changes", async () => {
    const env = await setup("aevalsrc=if(lt(t\\,0.5)\\,0\\,0.5):d=1");
    env.clip.durationSeconds = 0.4;
    let result = await env.produce(env.request());
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;
    expect(Math.max(...result.waveform.peaks)).toBe(0);
    const old = env.request();
    env.clip.offsetSeconds = 0.6;
    result = await env.produce(env.request());
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;
    expect(Math.max(...result.waveform.peaks)).toBeCloseTo(0.5, 2);
    expect(result.waveform.offsetSeconds).toBe(0.6);
    expect(await env.produce(old)).toEqual({ kind: "FAILED", code: "SOURCE_CHANGED" });
    env.film.shots[0]!.selectedTakeId = "take2";
    expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "SOURCE_CHANGED" });
  });
  it("revalidates same-path bytes, preserves bytes, and rejects mutation during decode", async () => {
    const env = await setup();
    const bytes = await readFile(env.source);
    const first = await env.produce(env.request());
    expect(first.kind).toBe("READY");
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono:d=1",
      env.source,
    ]);
    const second = await env.produce(env.request());
    expect(second.kind).toBe("READY");
    if (first.kind !== "READY" || second.kind !== "READY") return;
    expect(second.waveform.sourceSha256).not.toBe(first.waveform.sourceSha256);
    expect(second.waveform.peaks.every((p) => p === 0)).toBe(true);
    await writeFile(env.source, bytes);
    env.read
      .mockImplementationOnce(async () => structuredClone(env.film))
      .mockImplementationOnce(async () => {
        await writeFile(env.source, "changed");
        return structuredClone(env.film);
      });
    expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "SOURCE_CHANGED" });
  });
  it("does not invent missing audio, leak errors, accept arbitrary renderer paths or cross-episode files", async () => {
    const env = await setup();
    expect(await env.produce({ ...env.request(), path: env.source })).toEqual({
      kind: "FAILED",
      code: "INVALID_INPUT",
    });
    env.tools.mockRejectedValueOnce(new Error("secret /private/tool"));
    expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "TOOLS_UNAVAILABLE" });
    env.clip.path = "";
    expect(await env.produce(env.request())).toEqual({ kind: "EMPTY", code: "NO_SOURCE" });
    const other = join(env.root, seriesId, "episodes", "film_cccccccccccccccc");
    await mkdir(other, { recursive: true });
    env.clip.path = join(other, "voice.wav");
    await writeFile(env.clip.path, await readFile(env.source));
    expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "SOURCE_UNVERIFIED" });
  });
  it("keeps short-source peaks on the declared window rather than stretching their timing", async () => {
    const env = await setup();
    env.clip.durationSeconds = 2;
    const result = await env.produce(env.request());
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") return;
    expect(Math.max(...result.waveform.peaks)).toBeGreaterThan(0.1);
    expect(result.waveform.durationSeconds).toBe(2);
    // Full bins describe only the one-second measured source; they do not claim a second of silence.
    expect(Math.max(...result.waveform.peaks.slice(128))).toBeGreaterThan(0.1);
    expect(result.waveform.analyzedSeconds).toBeCloseTo(1, 2);
  });
  it("returns empty for a real video with no audio stream", async () => {
    const env = await setup();
    const path = env.source.replace(".wav", ".mp4");
    await run("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=32x32:d=1",
      "-an",
      path,
    ]);
    env.clip.path = path;
    expect(await env.produce(env.request())).toEqual({ kind: "EMPTY", code: "NO_AUDIO" });
  });
  it("reads canonical series media/music but rejects symlink escapes and unowned story assets", async () => {
    const env = await setup();
    const original = env.source;
    const media = join(env.root, seriesId, "media");
    await mkdir(media, { recursive: true });
    env.clip.path = join(media, "voice.wav");
    await copyFile(original, env.clip.path);
    expect((await env.produce(env.request())).kind).toBe("READY");
    const story = join(env.root, "story");
    await mkdir(story, { recursive: true });
    const storyFile = join(story, "voice.wav");
    await copyFile(original, storyFile);
    env.clip.path = storyFile;
    expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "SOURCE_UNVERIFIED" });
    const owner = vi.fn(async () => true),
      owned = createFilmAudioWaveforms({
        filmsRoot: env.root,
        storyFilmsRoot: story,
        read: env.read,
        tools: env.tools,
        storyOwner: owner,
      });
    expect((await owned(env.request())).kind).toBe("READY");
    expect(owner).toHaveBeenCalledTimes(2);
    if (process.platform !== "win32") {
      const outside = await setup();
      const link = join(media, "escape.wav");
      await symlink(outside.source, link);
      env.clip.path = link;
      expect((await env.produce(env.request())).kind).toBe("FAILED");
    }
  });
  it("reads real imported music only for a defined trim window, without inventing timeline duration", async () => {
    const env = await setup();
    const directory = join(env.root, seriesId, "music");
    await mkdir(directory, { recursive: true });
    const music = join(directory, "bed.wav");
    await copyFile(env.source, music);
    Object.assign(env.clip, { lane: "score", shotId: "", takeId: "", label: "", path: music });
    expect((await env.produce(env.request())).kind).toBe("READY");
    env.clip.durationSeconds = 0;
    env.tools.mockClear();
    expect(await env.produce(env.request())).toEqual({ kind: "EMPTY", code: "WINDOW_UNKNOWN" });
    expect(env.tools).not.toHaveBeenCalled();
  });
  it("never treats renderer-persisted fake peaks as a trusted decode cache", async () => {
    const env = await setup();
    const first = await env.produce(env.request());
    if (first.kind !== "READY") throw Error();
    Object.assign(env.clip, { waveform: { ...first.waveform, peaks: new Array(256).fill(1) } });
    const verified = await env.produce(env.request());
    expect(verified.kind).toBe("READY");
    if (verified.kind !== "READY") return;
    expect(Math.max(...verified.waveform.peaks)).toBeLessThan(0.2);
    expect(verified.waveform.sourceSha256).toBe(first.waveform.sourceSha256);
  });
  it.each(["clip", "shot", "take"])(
    "rejects duplicate %s identity before touching tools",
    async (kind) => {
      const env = await setup();
      if (kind === "clip") env.film.audioClips.push(structuredClone(env.clip));
      if (kind === "shot") env.film.shots.push(structuredClone(env.film.shots[0]!));
      if (kind === "take")
        env.film.shots[0]!.takes.push(structuredClone(env.film.shots[0]!.takes[0]!));
      expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "SOURCE_CHANGED" });
      expect(env.tools).not.toHaveBeenCalled();
    },
  );
  it("caps trim requests and deduplicates concurrent decodes", async () => {
    const env = await setup();
    env.clip.durationSeconds = 1801;
    expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "LIMIT_EXCEEDED" });
    env.clip.durationSeconds = 1;
    const running = env.produce(env.request());
    expect(await env.produce(env.request())).toEqual({ kind: "FAILED", code: "BUSY" });
    expect((await running).kind).toBe("READY");
  });
});
// The suite's skip remains visible on machines without both real media tools.
void ffmpegSkipReason;
it("guards IPC sender and argument count before invoking source/tool access", async () => {
  let handler!: (event: boolean, ...args: unknown[]) => Promise<unknown>;
  const tools = vi.fn();
  registerFilmAudioWaveforms<boolean>(
    (_channel, fn) => {
      handler = fn;
    },
    (event) => event,
    { filmsRoot: "unused", storyFilmsRoot: "unused", tools },
  );
  expect(await handler(false, {})).toEqual({ kind: "FAILED", code: "INVALID_INPUT" });
  expect(await handler(true, {}, {})).toEqual({ kind: "FAILED", code: "INVALID_INPUT" });
  expect(tools).not.toHaveBeenCalled();
});
