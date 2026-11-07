import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm, symlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createFilmAudioLibrary } from "./film-audio-library";
import { readProject, writeProject, type FilmRecord } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import {
  loadQcRunner,
  verifiedQcTools,
  type QcRunner,
  type QcTools,
} from "./film-export-qc-runtime";
const folders: string[] = [];
let tools: QcTools, run: QcRunner;
function tool(name: string) {
  const configured = process.env[name === "ffmpeg" ? "AIVORA_FFMPEG" : "AIVORA_FFPROBE"];
  if (configured && isAbsolute(configured) && existsSync(configured)) return configured;
  for (const root of (process.env.PATH ?? "").split(delimiter)) {
    const path = resolve(root, name + (process.platform === "win32" ? ".exe" : ""));
    if (existsSync(path)) return path;
  }
  throw Error("Pinned media tools unavailable");
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
  run = await loadQcRunner(resolve("../../packages/aivora-qc"));
});
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture(clean = false, alias = false) {
  const container = await mkdtemp(join(tmpdir(), "只读单镜时钟 "));
  folders.push(container);
  let root = container;
  if (alias) {
    const actual = join(container, "actual");
    await mkdir(actual);
    root = join(container, "alias");
    await symlink(actual, root, process.platform === "win32" ? "junction" : "dir");
  }
  const filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story");
  const id = "film_aaaaaaaaaaaaaaaa",
    seriesId = "film_bbbbbbbbbbbbbbbb",
    media = join(filmsRoot, seriesId, "episodes", id, "media");
  await mkdir(media, { recursive: true });
  await mkdir(storyFilmsRoot);
  const native = join(media, "原片 native.mp4"),
    cleanPath = join(media, "净画面 clean.mp4");
  const generate = (path: string, seconds: number, changed = false) =>
    run(tools.ffmpegPath, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      changed ? `color=c=blue:s=160x90:r=24:d=${seconds}` : `testsrc2=s=160x90:r=24:d=${seconds}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
  await generate(native, 2);
  if (clean) await generate(cleanPath, 1);
  const record = await writeProject(filmsRoot, {
    id,
    seriesId,
    title: "只读时基",
    shots: [
      {
        id: "shot",
        line: "",
        seconds: 15,
        selectedTakeId: "take",
        takes: [
          {
            id: "take",
            shotId: "shot",
            status: "done",
            videoPath: native,
            ...(clean ? { cleanVideoPath: cleanPath } : {}),
          },
        ],
      },
      { id: "unmade", line: "", takes: [], selectedTakeId: "" },
    ],
    audioClips: [
      {
        id: "broken-old-audio",
        lane: "score",
        path: "/does-not-exist.ogg",
        shotId: "",
        takeId: "",
        durationSeconds: 0,
        offsetSeconds: 0,
        startSeconds: 0,
        gainDb: 0,
      },
    ],
  });
  let effect: ((path: string, count: number) => Promise<void>) | undefined;
  const counts = new Map<string, number>();
  const observed: QcRunner = vi.fn(async (binary, args, options) => {
    const result = await run(binary, args, options),
      path = args.at(-1)!;
    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    await effect?.(path, count);
    return result;
  });
  const catalog = vi.fn(() => {
      throw Error("inspection must not read the library");
    }),
    beforeCommit = vi.fn(async () => undefined),
    pinned = vi.fn(async () => tools);
  const host = {
    filmsRoot,
    storyFilmsRoot,
    libraryRoot: catalog,
    tools: pinned,
    run: observed,
    videoOwner: vi.fn(async () => false),
    beforeCommit,
  };
  const api = createFilmAudioLibrary(host);
  const input = {
    projectId: id,
    expectedProjectHash: filmHistoryRecordHash(record),
    shotId: "shot",
    takeId: "take",
  };
  return {
    root,
    record,
    media,
    native,
    cleanPath,
    host,
    api,
    input,
    generate,
    effect: (next: typeof effect) => {
      effect = next;
    },
    current: async () => (await readProject(filmsRoot, id))!,
    save: (next: FilmRecord) => writeProject(filmsRoot, next),
  };
}
it.each([false, true])(
  "returns only the actual target visual clock (clean=%s), ignores unfinished shots/broken old audio and writes nothing",
  async (clean) => {
    const f = await fixture(clean),
      before = await readFile(join(dirname(f.media), "project.json")),
      native = await readFile(f.native),
      entries = await readdir(f.media);
    expect(await f.api.inspectBundledFilmAudioTarget(f.input)).toEqual({
      kind: "TARGET",
      projectId: f.input.projectId,
      shotId: "shot",
      takeId: "take",
      projectHash: f.input.expectedProjectHash,
      durationSeconds: clean ? 1 : 2,
    });
    expect(await readFile(join(dirname(f.media), "project.json"))).toEqual(before);
    expect(await readFile(f.native)).toEqual(native);
    expect(await readdir(f.media)).toEqual(entries);
    expect(f.host.libraryRoot).not.toHaveBeenCalled();
    expect(f.host.beforeCommit).not.toHaveBeenCalled();
    expect(f.host.run).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(["/does-not-exist.ogg"]),
      expect.anything(),
    );
  },
);
it("rejects exact-shape violations, series fallback, wrong version or hash before running a child", async () => {
  const f = await fixture();
  for (const change of [
    { path: f.native },
    { takeId: "wrong" },
    { projectId: f.record.seriesId },
    { expectedProjectHash: "0".repeat(64) },
    { shotId: "unmade" },
  ])
    expect((await f.api.inspectBundledFilmAudioTarget({ ...f.input, ...change })).kind).toBe(
      "FAILED",
    );
  expect(f.host.run).not.toHaveBeenCalled();
  expect(f.host.tools).not.toHaveBeenCalled();
  expect(f.host.libraryRoot).not.toHaveBeenCalled();
});
it.each(["project", "take"])(
  "rejects a canonical %s change during the actual probe",
  async (kind) => {
    const f = await fixture();
    f.effect(async (_path, count) => {
      if (count !== 1) return;
      const next = structuredClone(f.record);
      if (kind === "project") next.title = "new edit";
      else {
        const shot = next.shots![0] as { selectedTakeId: string; takes: Record<string, unknown>[] };
        shot.takes.push({ ...shot.takes[0], id: "replacement" });
        shot.selectedTakeId = "replacement";
      }
      await f.save(next);
    });
    expect(await f.api.inspectBundledFilmAudioTarget(f.input)).toMatchObject({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
      unchanged: true,
    });
    expect(f.host.beforeCommit).not.toHaveBeenCalled();
    expect(await readdir(f.media)).toEqual(["原片 native.mp4"]);
  },
);
it.each([
  { kind: "native", alias: false },
  { kind: "clean", alias: false },
  { kind: "native", alias: true },
  { kind: "clean", alias: true },
])(
  "rejects changed $kind bytes after its final probe (path alias=$alias)",
  async ({ kind, alias }) => {
    const f = await fixture(true, alias),
      before = await readFile(join(dirname(f.media), "project.json"));
    const source = kind === "native" ? f.native : f.cleanPath;
    const sourceHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const originalHash = sourceHash(await readFile(source));
    let injected = 0,
      sawAlias = false;
    f.effect(async (path, count) => {
      if (count !== 2) return;
      const [actual, expected] = await Promise.all([
        stat(path, { bigint: true }),
        stat(source, { bigint: true }),
      ]);
      if (actual.dev !== expected.dev || actual.ino !== expected.ino) return;
      expect(await readFile(path)).toEqual(await readFile(source));
      sawAlias ||= path !== source;
      injected++;
      await f.generate(source, kind === "native" ? 2 : 1, true);
      expect(sourceHash(await readFile(path))).not.toBe(originalHash);
    });
    expect(await f.api.inspectBundledFilmAudioTarget(f.input)).toMatchObject({
      kind: "FAILED",
      code: "PROJECT_CHANGED",
    });
    expect(injected).toBe(1);
    if (alias) expect(sawAlias).toBe(true);
    expect(sourceHash(await readFile(source))).not.toBe(originalHash);
    expect(await readFile(join(dirname(f.media), "project.json"))).toEqual(before);
    expect(f.host.beforeCommit).not.toHaveBeenCalled();
  },
);
it("keeps one same-project inspection active across duplicate BUSY calls and releases it when done", async () => {
  const f = await fixture();
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
      enter = resolve;
    }),
    wait = new Promise<void>((resolve) => {
      release = resolve;
    });
  f.effect(async (_path, count) => {
    if (count === 1) {
      enter();
      await wait;
    }
  });
  const pending = f.api.inspectBundledFilmAudioTarget(f.input);
  await started;
  for (let i = 0; i < 2; i++)
    expect(await f.api.inspectBundledFilmAudioTarget(f.input)).toMatchObject({
      kind: "FAILED",
      code: "BUSY",
    });
  release();
  expect((await pending).kind).toBe("TARGET");
  f.effect(undefined);
  expect((await f.api.inspectBundledFilmAudioTarget(f.input)).kind).toBe("TARGET");
});
it("rejects an unowned or unprobeable target and an unverified tool without producing a library copy", async () => {
  const f = await fixture();
  f.host.tools.mockRejectedValueOnce(Error("pinned tool mismatch"));
  expect(await f.api.inspectBundledFilmAudioTarget(f.input)).toMatchObject({
    kind: "FAILED",
    code: "TOOLS_UNAVAILABLE",
  });
  expect(f.host.run).not.toHaveBeenCalled();
  await writeFile(f.native, "not media");
  expect(await f.api.inspectBundledFilmAudioTarget(f.input)).toMatchObject({
    kind: "FAILED",
    code: "SOURCE_UNVERIFIED",
  });
  const next = structuredClone(f.record);
  (next.shots![0] as { takes: Record<string, unknown>[] }).takes[0]!.videoPath = join(
    f.root,
    "foreign.mp4",
  );
  await f.generate(join(f.root, "foreign.mp4"), 2);
  const stored = await f.save(next);
  vi.mocked(f.host.run).mockClear();
  expect(
    await f.api.inspectBundledFilmAudioTarget({
      ...f.input,
      expectedProjectHash: filmHistoryRecordHash(stored),
    }),
  ).toMatchObject({ kind: "FAILED", code: "SOURCE_UNVERIFIED" });
  expect(f.host.run).not.toHaveBeenCalled();
  expect(f.host.libraryRoot).not.toHaveBeenCalled();
});

it("does not let an earlier target response authorize an add after the canonical input changes", async () => {
  const f = await fixture();
  const target = await f.api.inspectBundledFilmAudioTarget(f.input);
  expect(target.kind).toBe("TARGET");
  await f.save({ ...f.record, title: "later input" });
  expect(
    await f.api.addBundledFilmAudio({
      ...f.input,
      catalogSha256: "a".repeat(64),
      expectedAssetSha256: "b".repeat(64),
      assetId: "must-not-load",
      lane: "sfx",
      placement: {
        startSeconds: 0,
        durationSeconds: 0.2,
        offsetSeconds: 0,
        gainDb: 0,
        loop: false,
      },
    }),
  ).toMatchObject({ kind: "FAILED", code: "PROJECT_CHANGED" });
  expect(f.host.libraryRoot).not.toHaveBeenCalled();
  expect(f.host.beforeCommit).not.toHaveBeenCalled();
  expect(await readdir(f.media)).toEqual(["原片 native.mp4"]);
});
