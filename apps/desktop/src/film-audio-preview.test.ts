import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, delimiter, resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createFilmAudioPreview } from "./film-audio-preview";
import { writeProject } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import { verifiedQcTools, type QcTools, type QcRunner } from "./film-export-qc-runtime";
const execute = promisify(execFile),
  roots: string[] = [];
let tools: QcTools;
const run: QcRunner = (path, args, options) =>
  execute(path, args, { encoding: "utf8", maxBuffer: 1024 * 1024, signal: options?.signal });
function tool(name: string) {
  const explicit = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (explicit && isAbsolute(explicit) && existsSync(explicit)) return explicit;
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(root, `${name}${process.platform === "win32" ? ".exe" : ""}`);
    if (existsSync(path)) return path;
  }
  throw new Error("Pinned test tool missing");
}
beforeAll(async () => {
  tools = await verifiedQcTools(
    dirname(tool("ffmpeg")),
    resolve(
      "../../config",
      process.platform === "win32"
        ? "media-toolchain-lock.json"
        : "draft-media-toolchain-linux-dev-lock.json",
    ),
  );
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mix-preview "));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    id = `film_${"a".repeat(16)}`,
    seriesId = `film_${"b".repeat(16)}`,
    folder = join(filmsRoot, seriesId, "episodes", id, "media");
  await mkdir(folder, { recursive: true });
  const video = join(folder, "native.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=24:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=2",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-shortest",
    video,
  ]);
  const record = await writeProject(filmsRoot, {
    id,
    seriesId,
    title: "主进程试听",
    shots: [
      {
        id: "shot",
        seconds: 1,
        line: "",
        selectedTakeId: "one",
        takes: [
          { id: "one", shotId: "shot", status: "done", videoPath: video, durationSeconds: 1 },
        ],
      },
    ],
    audioClips: [],
  });
  const toolsFn = vi.fn(async () => tools),
    runner = vi.fn(run),
    host = { filmsRoot, storyFilmsRoot: join(root, "story"), tools: toolsFn, run: runner };
  return {
    root,
    record,
    video,
    host,
    toolsFn,
    runner,
    prepare: createFilmAudioPreview(host),
    input: { projectId: id, expectedHash: filmHistoryRecordHash(record) },
  };
}
it("returns only trusted selected source bytes/hash and measured video time, rejecting series fallback and stale input", async () => {
  const f = await fixture(),
    before = await readFile(f.video);
  const ready = await f.prepare(f.input);
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw new Error(ready.code);
  expect(ready.plan.durationSeconds).toBeCloseTo(2, 2);
  expect(ready.plan.shots[0]!.takeId).toBe("one");
  expect(ready.plan.speech).toEqual([]);
  expect(ready.sourceSha256["video:shot:one"]).toBe(
    createHash("sha256").update(before).digest("hex"),
  );
  expect(ready.sourceInfo["video:shot:one"]!.byteLength).toBe(before.length);
  expect(await readFile(f.video)).toEqual(before);
  const calls = f.runner.mock.calls.length;
  expect(await f.prepare({ ...f.input, projectId: f.record.seriesId })).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
  expect(await f.prepare({ ...f.input, expectedHash: "0".repeat(64) })).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
  expect(f.runner).toHaveBeenCalledTimes(calls);
});
it("does not probe foreign-project audio, ignores obsolete take references, and fails closed on unverified tools", async () => {
  const f = await fixture();
  const stale = await writeProject(f.host.filmsRoot, {
    ...f.record,
    audioClips: [
      {
        id: "old",
        lane: "dialogue",
        shotId: "shot",
        takeId: "old-version",
        path: "/must-not-be-read/old.wav",
        startSeconds: 0,
        durationSeconds: 1,
        offsetSeconds: 0,
        gainDb: 0,
      },
    ],
  });
  const ready = await f.prepare({ ...f.input, expectedHash: filmHistoryRecordHash(stale) });
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw new Error(ready.code);
  expect(ready.plan.limitations).toContain("STALE_CLIP_IGNORED");
  expect(f.runner.mock.calls.some(([, args]) => args.includes("/must-not-be-read/old.wav"))).toBe(
    false,
  );
  const foreign = await writeProject(f.host.filmsRoot, {
    ...stale,
    audioClips: [
      {
        id: "foreign",
        lane: "score",
        shotId: "",
        takeId: "",
        path: "/outside/private.wav",
        startSeconds: 0,
        durationSeconds: 1,
        offsetSeconds: 0,
        gainDb: 0,
      },
    ],
  });
  expect(
    await f.prepare({ ...f.input, expectedHash: filmHistoryRecordHash(foreign) }),
  ).toMatchObject({ kind: "FAILED", code: "SOURCE_UNVERIFIED" });
  expect(f.runner.mock.calls.some(([, args]) => args.includes("/outside/private.wav"))).toBe(false);
  f.toolsFn.mockRejectedValueOnce(new Error("wrong lock"));
  expect(
    await f.prepare({ ...f.input, expectedHash: filmHistoryRecordHash(foreign) }),
  ).toMatchObject({ kind: "FAILED", code: "TOOLS_UNAVAILABLE" });
});
