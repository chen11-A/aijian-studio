import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, delimiter } from "node:path";
import { resolveAudioMix } from "./film-audio-mix-sources";
import { renderAudioMix, probeMixSource } from "./film-audio-mix";
import {
  loadQcRunner,
  verifiedQcTools,
  type QcRunner,
  type QcTools,
} from "./film-export-qc-runtime";
const roots: string[] = [];
let tools: QcTools, run: QcRunner;
beforeAll(async () => {
  const binary =
    process.env.AIVORA_FFMPEG ??
    (process.env.PATH ?? "")
      .split(delimiter)
      .map((dir) => join(dir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))
      .find(existsSync)!;
  tools = await verifiedQcTools(
    dirname(binary),
    resolve(
      "../../config",
      process.platform === "win32"
        ? "media-toolchain-lock.json"
        : "draft-media-toolchain-linux-dev-lock.json",
    ),
  );
  run = await loadQcRunner(resolve("../../packages/aivora-qc"));
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "shared-source-"));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    id = "film_aaaaaaaaaaaaaaaa",
    seriesId = "film_bbbbbbbbbbbbbbbb";
  const media = join(filmsRoot, seriesId, "episodes", id, "media"),
    story = join(root, "story");
  await mkdir(media, { recursive: true });
  await mkdir(story);
  const video = join(media, "video.mp4"),
    sound = join(story, "mono.wav");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=160x90:r=24:d=2",
    "-c:v",
    "libx264",
    "-an",
    video,
  ]);
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:duration=2",
    "-ac",
    "1",
    sound,
  ]);
  const clips = [0, 1].map((index) => ({
    id: `part-${index}`,
    lane: "sfx",
    shotId: "shot",
    takeId: "take",
    label: "片段",
    path: sound,
    startSeconds: index,
    durationSeconds: 0.5,
    offsetSeconds: index * 0.5,
    gainDb: 0,
  }));
  const record = {
    id,
    seriesId,
    backendProjectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shots: [
      {
        id: "shot",
        line: "",
        selectedTakeId: "take",
        takes: [{ id: "take", shotId: "shot", status: "done", videoPath: video }],
      },
    ],
    audioClips: clips,
  };
  const selected = [{ shotId: "shot", takeId: "take", videoPath: video }];
  const counted = vi.fn(run),
    owner = vi.fn(async () => true);
  const host = { filmsRoot, storyFilmsRoot: story, tools, run: counted, audioOwner: owner };
  return { root, video, sound, record, selected, host, counted, owner };
}
it("reuses one canonical mono source/probe across independent segments and renders real audio without touching sources", async () => {
  const f = await fixture(),
    before = await readFile(f.sound),
    video = await readFile(f.video);
  const result = await resolveAudioMix(f.record, f.selected, f.host);
  expect(f.owner).toHaveBeenCalledTimes(2);
  const audioProbes = [];
  for (const [, args] of f.counted.mock.calls) {
    const path = args.at(-1)!;
    const info = await stat(path, { bigint: true }).catch(() => null),
      actual = await stat(f.sound, { bigint: true });
    if (info?.dev === actual.dev && info.ino === actual.ino) audioProbes.push(path);
  }
  expect(audioProbes).toHaveLength(1);
  expect(result.plan.tracks.map((track) => track.key)).toEqual(["part-0", "part-1"]);
  expect(new Set(result.plan.tracks.map((track) => track.sourceKey)).size).toBe(1);
  expect(Object.keys(result.paths)).toHaveLength(2);
  const output = join(f.root, "out.mp4");
  await renderAudioMix(f.video, output, result.plan, result.paths, tools, run);
  expect((await probeMixSource(output, tools, run)).hasAudio).toBe(true);
  const decoded = await run(tools.ffmpegPath, [
    "-v",
    "info",
    "-i",
    output,
    "-af",
    "astats=metadata=0:reset=0",
    "-f",
    "null",
    "-",
  ]);
  expect(decoded.stderr).toMatch(/Number of samples: [1-9]\d*/);
  expect(await readFile(f.sound)).toEqual(before);
  expect(await readFile(f.video)).toEqual(video);
});
it("does not let a cached source bypass a later clip owner rejection or source replacement", async () => {
  for (const mode of ["owner", "bytes"] as const) {
    const f = await fixture();
    let calls = 0;
    f.owner.mockImplementation(async () => {
      if (++calls === 2) {
        if (mode === "owner") return false;
        await writeFile(f.sound, "replaced");
      }
      return true;
    });
    await expect(resolveAudioMix(f.record, f.selected, f.host)).rejects.toThrow(
      mode === "owner" ? "SOURCE_UNVERIFIED" : "SOURCE_CHANGED",
    );
    expect(f.owner).toHaveBeenCalledTimes(2);
  }
});
it("still excludes stale/unbound dubs and keeps one native source without reprobe", async () => {
  const f = await fixture();
  const original = {
    id: "original",
    lane: "dialogue",
    shotId: "shot",
    takeId: "take",
    label: "原声",
    path: f.video,
    startSeconds: 0,
    durationSeconds: 0,
    offsetSeconds: 0,
    gainDb: 0,
  };
  const result = await resolveAudioMix(
    {
      ...f.record,
      audioClips: [
        original,
        ...f.record.audioClips.map((clip, index) => ({
          ...clip,
          lane: "dialogue",
          label: "配音",
          takeId: index ? "" : "old-take",
        })),
      ],
    },
    f.selected,
    f.host,
  );
  expect(f.counted).toHaveBeenCalledOnce();
  expect(f.owner).not.toHaveBeenCalled();
  expect(Object.keys(result.paths)).toEqual(["video:shot:take"]);
  expect(result.plan.tracks).toHaveLength(0);
});
