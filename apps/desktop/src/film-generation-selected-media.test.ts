import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { generationSelectedMedia } from "./film-generation-selected-media";
import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import type { FilmRecord } from "./film-library";
import { verifiedQcTools, type QcRunner, type QcTools } from "./film-export-qc-runtime";
const execute = promisify(execFile);
const roots: string[] = [];
let shared: string, tools: QcTools, producer: CanonicalGenerationProducer;
const run: QcRunner = (binary, args, options) =>
  execute(binary, args, {
    encoding: "utf8",
    maxBuffer: options?.maxBuffer ?? 65536,
    timeout: options?.timeoutMs ?? 30000,
    signal: options?.signal,
  });
function tool(name: string) {
  const configured = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (configured && isAbsolute(configured) && existsSync(configured)) return configured;
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const file = resolve(root, `${name}${process.platform === "win32" ? ".exe" : ""}`);
    if (existsSync(file)) return file;
  }
  throw Error("Pinned media tools unavailable");
}
beforeAll(async () => {
  shared = await mkdtemp(join(tmpdir(), "selected-media-compiled-"));
  tools = await verifiedQcTools(
    dirname(tool("ffmpeg")),
    resolve(
      "../../config",
      process.platform === "win32"
        ? "media-toolchain-lock.json"
        : "draft-media-toolchain-linux-dev-lock.json",
    ),
  );
  const output = join(shared, "producer");
  await execute(process.execPath, [
    resolve("../../scripts/build-generation-input-runtime.mjs"),
    "--out-dir",
    output,
  ]);
  producer = createRequire(join(shared, "native-test.cjs"))(
    join(output, "film-generation-producer.js"),
  );
  for (const [name, seconds] of [
    ["native", 1],
    ["clean", 0.5],
  ] as const) {
    await run(tools.ffmpegPath, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=s=128x72:r=${name === "native" ? 25 : 30}:d=${seconds}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      join(shared, `${name}.mp4`),
    ]);
  }
});
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
afterAll(async () => {
  if (shared) await rm(shared, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "可信所选视频 "));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story");
  const id = "film_aaaaaaaaaaaaaaaa",
    seriesId = "film_bbbbbbbbbbbb";
  const media = join(filmsRoot, seriesId, "episodes", id, "media");
  await mkdir(media, { recursive: true });
  await mkdir(storyFilmsRoot);
  const native = join(media, "source native.mp4"),
    clean = join(media, "clean visual.mp4");
  await copyFile(join(shared, "native.mp4"), native);
  await copyFile(join(shared, "clean.mp4"), clean);
  const record: FilmRecord = {
    id,
    seriesId,
    backendProjectId: "prj_" + "a".repeat(32),
    audioClips: [{ id: "unrelated-old-track", path: "/foreign/missing.wav" }],
    audioMix: { invalidOldSetting: true },
    shots: [
      {
        id: "shot",
        line: "",
        selectedTakeId: "take",
        takes: [{ id: "take", status: "done", videoPath: native, cleanVideoPath: clean }],
      },
    ],
  };
  const videoOwner = vi.fn(async () => true);
  const observedRun = vi.fn(run);
  const host = { filmsRoot, storyFilmsRoot, tools, run: observedRun, videoOwner };
  return { root, media, native, clean, record, host };
}
const shot = (record: FilmRecord) =>
  record.shots![0] as {
    id: string;
    selectedTakeId: string;
    takes: { id: string; status: string; videoPath: string; cleanVideoPath?: string }[];
  };

it("uses the actual compiled selector and role-bound native/clean clock without reading stale audio", async () => {
  const f = await fixture();
  const bytes = await readFile(f.native);
  const result = await generationSelectedMedia(producer, f.record, ["shot"], f.host);
  expect([...result.pendingShotIds]).toEqual([]);
  expect(result.selected).toHaveLength(1);
  expect(result.selected[0]).toMatchObject({
    shotId: "shot",
    takeId: "take",
    verification: "OWNED_STREAM_AND_SHA",
    native: { path: await realpath(f.native), durationSeconds: 1 },
    visual: { path: await realpath(f.clean), durationSeconds: 0.5 },
  });
  await result.verify({ ...f.record, savedAt: "new metadata", title: "unrelated title" });
  expect(await readFile(f.native)).toEqual(bytes);
  expect(f.host.videoOwner).not.toHaveBeenCalled();
});
it("distinguishes a planned empty target from an unreadable or ambiguous selection", async () => {
  const f = await fixture();
  f.record.shots!.push({ id: "new-shot", selectedTakeId: "", takes: [] });
  const result = await generationSelectedMedia(producer, f.record, ["shot", "new-shot"], f.host);
  expect([...result.pendingShotIds]).toEqual(["new-shot"]);
  const unknown = structuredClone(f.record);
  shot(unknown).selectedTakeId = "unknown-take";
  await expect(generationSelectedMedia(producer, unknown, ["shot"], f.host)).rejects.toThrow(
    "SOURCE_UNVERIFIABLE",
  );
  const ambiguous = structuredClone(f.record);
  shot(ambiguous).selectedTakeId = "";
  shot(ambiguous).takes.push({ ...shot(ambiguous).takes[0]!, id: "other" });
  await expect(generationSelectedMedia(producer, ambiguous, ["shot"], f.host)).rejects.toThrow(
    "SOURCE_UNVERIFIABLE",
  );
  await rm(f.native);
  await expect(result.verify(f.record)).rejects.toThrow("SOURCE_UNVERIFIABLE");
});
it("rejects late source bytes, selection and project changes instead of issuing a reuse fact", async () => {
  const f = await fixture();
  const result = await generationSelectedMedia(producer, f.record, ["shot"], f.host);
  const changed = structuredClone(f.record);
  shot(changed).takes.push({ ...shot(changed).takes[0]!, id: "new-selected" });
  shot(changed).selectedTakeId = "new-selected";
  await expect(result.verify(changed)).rejects.toThrow("SOURCE_UNVERIFIABLE");
  await expect(result.verify({ ...f.record, id: "film_foreign" })).rejects.toThrow(
    "SOURCE_UNVERIFIABLE",
  );
  await copyFile(join(shared, "clean.mp4"), f.native);
  await expect(result.verify(f.record)).rejects.toThrow("SOURCE_UNVERIFIABLE");
});
it("keeps exact episode roots and rechecks the existing story owner before every observation", async () => {
  const f = await fixture();
  const foreign = join(f.host.filmsRoot, f.record.seriesId, "episodes", "foreign", "other.mp4");
  await mkdir(dirname(foreign), { recursive: true });
  await copyFile(f.native, foreign);
  shot(f.record).takes[0]!.videoPath = foreign;
  await expect(generationSelectedMedia(producer, f.record, ["shot"], f.host)).rejects.toThrow(
    "SOURCE_UNVERIFIABLE",
  );
  expect(f.host.run).not.toHaveBeenCalled();
  const owned = join(f.host.storyFilmsRoot, "owned.mp4");
  await copyFile(f.native, owned);
  shot(f.record).takes[0]!.videoPath = owned;
  const result = await generationSelectedMedia(producer, f.record, ["shot"], f.host);
  expect(f.host.videoOwner).toHaveBeenCalled();
  f.host.videoOwner.mockResolvedValue(false);
  await expect(result.verify(f.record)).rejects.toThrow("SOURCE_UNVERIFIABLE");
});
it("does not substitute equal SHA sets when a selected alias changes canonical identity", async () => {
  const f = await fixture();
  const first = join(f.media, "first"),
    second = join(f.media, "second"),
    alias = join(f.media, "alias");
  await mkdir(first);
  await mkdir(second);
  await copyFile(f.native, join(first, "same.mp4"));
  await copyFile(f.native, join(second, "same.mp4"));
  await symlink(first, alias, process.platform === "win32" ? "junction" : "dir");
  shot(f.record).takes[0]!.videoPath = join(alias, "same.mp4");
  const result = await generationSelectedMedia(producer, f.record, ["shot"], f.host);
  await rm(alias);
  await symlink(second, alias, process.platform === "win32" ? "junction" : "dir");
  await expect(result.verify(f.record)).rejects.toThrow("SOURCE_UNVERIFIABLE");
});

it("refuses an audio-only file instead of borrowing its format duration as video time", async () => {
  const f = await fixture();
  const audioOnly = join(f.media, "audio-only.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=0.2",
    "-c:a",
    "aac",
    audioOnly,
  ]);
  shot(f.record).takes[0]!.videoPath = audioOnly;
  await expect(generationSelectedMedia(producer, f.record, ["shot"], f.host)).rejects.toThrow(
    "SOURCE_UNVERIFIABLE",
  );
});
