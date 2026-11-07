import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilmRiskTrials } from "./film-risk-trial";
import { readProject, writeProject, type FilmRecord } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "可信试片 "));
  folders.push(root);
  const filmsRoot = join(root, "films"),
    storyFilmsRoot = join(root, "story");
  const project = "film_aaaaaaaaaaaaaaaa",
    series = "film_bbbbbbbbbbbbbbbb";
  const folder = join(filmsRoot, series, "episodes", project, "media");
  await mkdir(folder, { recursive: true });
  await mkdir(storyFilmsRoot);
  const native = join(folder, "actual.mp4"),
    image = join(folder, "first.png");
  await writeFile(native, "selected-video-bytes");
  await writeFile(image, "fixed-image-bytes");
  const record: FilmRecord = {
    id: project,
    seriesId: series,
    title: "试片绑定",
    backendProjectId: "prj_" + "c".repeat(32),
    sourceText: "雨落。",
    characters: [],
    locations: [],
    props: [],
    scenes: [{ id: "scene", no: 1, text: "雨落。" }],
    audioClips: [],
    shots: [
      {
        id: "trial",
        sceneId: "scene",
        no: 1,
        line: "",
        lines: [],
        picture: "雨落。",
        seconds: 9,
        characters: [],
        selectedTakeId: "take",
        poster: image,
        stills: [],
        takes: [{ id: "take", shotId: "trial", status: "done", index: 2, videoPath: native }],
      },
      {
        id: "next",
        sceneId: "scene",
        no: 2,
        line: "",
        lines: [],
        picture: "独立下一镜",
        seconds: 9,
        characters: [],
        selectedTakeId: "",
        poster: image,
        stills: [],
        takes: [],
      },
    ],
  };
  await writeProject(filmsRoot, record);
  const run = vi.fn(async () => ({
    stdout: JSON.stringify({
      streams: [
        { codec_type: "video", duration: "1.25" },
        { codec_type: "audio", duration: "1.25", channels: 2 },
      ],
      format: { duration: "1.25" },
    }),
    stderr: "",
  }));
  const host = {
    filmsRoot,
    storyFilmsRoot,
    tools: vi.fn(async () => ({ ffmpegPath: "pinned-ffmpeg", ffprobePath: "pinned-ffprobe" })),
    run,
    videoOwner: vi.fn(async () => true),
    beforeCommit: undefined as (() => Promise<void>) | undefined,
  };
  const trials = createFilmRiskTrials(host);
  const disk = async () => (await readProject(filmsRoot, project))!;
  const input = async () => ({
    projectId: project,
    expectedHash: filmHistoryRecordHash(await disk()),
    shotId: "trial",
    takeId: "take",
  });
  const ready = async () => {
    const result = await trials.prepare(1, await input());
    expect(result.kind).toBe("READY");
    if (result.kind !== "READY") throw Error("prepare failed");
    return result;
  };
  return { root, host, trials, disk, input, ready, native, image, project };
}
it("prepares actual selected identity and clock, reads only its bound bytes, and persists an explicit decision with original CAS", async () => {
  const f = await fixture(),
    before = await f.disk(),
    ready = await f.ready();
  expect(ready.durationSeconds).toBe(1.25);
  expect(ready.versionLabel).toBe("第 2 版");
  expect(ready.batchShotCount).toBe(2);
  expect(await f.disk()).toEqual(before);
  const media = await f.trials.readMedia(1, f.project, ready.reviewId);
  expect(media.kind).toBe("MEDIA");
  if (media.kind === "MEDIA")
    expect(Buffer.from(media.bytes).toString()).toBe("selected-video-bytes");
  const result = await f.trials.record(1, {
    projectId: f.project,
    expectedHash: (await f.input()).expectedHash,
    reviewId: ready.reviewId,
    decision: "accepted",
    note: "我决定接受此试片。",
  });
  expect(result.kind).toBe("RECORDED");
  if (result.kind !== "RECORDED") throw Error("record failed");
  const disk = await f.disk();
  expect(disk.shots).toEqual(before.shots);
  expect(disk.audioClips).toEqual(before.audioClips);
  expect(disk.riskTrialDecisions as unknown[]).toHaveLength(1);
  expect(JSON.stringify(disk.riskTrialDecisions)).not.toContain(ready.reviewId);
  const check = {
    projectId: f.project,
    expectedHash: filmHistoryRecordHash(disk),
    decisionId: result.decision.id,
  };
  expect(await f.trials.check(1, check)).toMatchObject({ kind: "ACCEPTED" });
  expect(await f.trials.check(1, { ...check, targetShotId: "next" })).toMatchObject({
    kind: "FAILED",
    code: "REVIEW_STALE",
  });
  const restarted = createFilmRiskTrials(f.host);
  expect(await restarted.readMedia(1, f.project, ready.reviewId)).toMatchObject({
    kind: "FAILED",
    code: "REVIEW_STALE",
  });
  expect(await restarted.check(1, check)).toMatchObject({ kind: "ACCEPTED" });
  expect((await readFile(f.native)).toString()).toBe("selected-video-bytes");
});
it.each(["picture", "selection", "video-bytes", "reference-bytes"])(
  "rejects a changed %s before recording and preserves all original bytes/records",
  async (mode) => {
    const f = await fixture(),
      ready = await f.ready();
    if (mode === "video-bytes") await writeFile(f.native, "replacement-video");
    else if (mode === "reference-bytes") await writeFile(f.image, "replacement-image");
    else {
      const record = await f.disk();
      const shot = record.shots![0] as Record<string, unknown>;
      if (mode === "picture") shot.picture = "用户新稿";
      else shot.selectedTakeId = "different";
      await writeProject(f.host.filmsRoot, record);
    }
    const before = await f.disk();
    expect(
      await f.trials.record(1, {
        projectId: f.project,
        expectedHash: filmHistoryRecordHash(before),
        reviewId: ready.reviewId,
        decision: "accepted",
        note: "",
      }),
    ).toMatchObject({ kind: "FAILED", unchanged: true });
    expect(await f.disk()).toEqual(before);
  },
);
it("records needs-changes without ever allowing batch continuation", async () => {
  const f = await fixture(),
    ready = await f.ready();
  const result = await f.trials.record(1, {
    projectId: f.project,
    expectedHash: ready.projectHash,
    reviewId: ready.reviewId,
    decision: "needs-changes",
    note: "需要修改。",
  });
  expect(result.kind).toBe("RECORDED");
  if (result.kind !== "RECORDED") throw Error("record failed");
  expect(
    await f.trials.check(1, {
      projectId: f.project,
      expectedHash: (await f.input()).expectedHash,
      decisionId: result.decision.id,
    }),
  ).toMatchObject({ kind: "FAILED", code: "REVIEW_STALE" });
});
it("rejects wrong owner, retired document, stale CAS and ambiguous records at zero writes", async () => {
  const f = await fixture(),
    ready = await f.ready();
  expect(await f.trials.readMedia(2, f.project, ready.reviewId)).toMatchObject({
    kind: "FAILED",
    code: "REVIEW_STALE",
  });
  const request = {
    projectId: f.project,
    expectedHash: "0".repeat(64),
    reviewId: ready.reviewId,
    decision: "accepted",
    note: "",
  };
  expect(await f.trials.record(1, request)).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
    unchanged: true,
  });
  f.trials.disposeOwner(1);
  expect(await f.trials.record(1, { ...request, expectedHash: ready.projectHash })).toMatchObject({
    kind: "FAILED",
    code: "REVIEW_STALE",
  });
  const record = await f.disk();
  record.shots!.push(record.shots![0]);
  await writeProject(f.host.filmsRoot, record);
  expect(await f.trials.prepare(1, await f.input())).toMatchObject({
    kind: "FAILED",
    code: "UNSUPPORTED_SCOPE",
  });
  expect((await f.disk()).riskTrialDecisions).toBeUndefined();
});
it("rechecks actual bytes and document ownership after the final asynchronous commit boundary", async () => {
  const f = await fixture(),
    ready = await f.ready(),
    before = await f.disk();
  f.host.beforeCommit = async () => {
    f.trials.disposeOwner(1);
  };
  const withHook = createFilmRiskTrials(f.host),
    view = await withHook.prepare(1, await f.input());
  if (view.kind !== "READY") throw Error("prepare failed");
  f.host.beforeCommit = async () => {
    withHook.disposeOwner(1);
  };
  expect(
    await withHook.record(1, {
      projectId: f.project,
      expectedHash: ready.projectHash,
      reviewId: view.reviewId,
      decision: "accepted",
      note: "",
    }),
  ).toMatchObject({ kind: "FAILED", code: "REVIEW_STALE", unchanged: true });
  expect(await f.disk()).toEqual(before);
});

it("keeps the full human history but retires an older acceptance after a later needs-changes decision", async () => {
  const f = await fixture(),
    first = await f.ready();
  const accepted = await f.trials.record(1, {
    projectId: f.project,
    expectedHash: first.projectHash,
    reviewId: first.reviewId,
    decision: "accepted",
    note: "先接受",
  });
  if (accepted.kind !== "RECORDED") throw Error("record failed");
  const second = await f.ready();
  const changed = await f.trials.record(1, {
    projectId: f.project,
    expectedHash: second.projectHash,
    reviewId: second.reviewId,
    decision: "needs-changes",
    note: "人工复看后需修改",
  });
  if (changed.kind !== "RECORDED") throw Error("record failed");
  expect((await f.disk()).riskTrialDecisions).toHaveLength(2);
  expect(
    await f.trials.check(1, {
      projectId: f.project,
      expectedHash: (await f.input()).expectedHash,
      decisionId: accepted.decision.id,
    }),
  ).toMatchObject({ kind: "FAILED", code: "REVIEW_STALE" });
  expect((await f.ready()).existingDecision?.id).toBe(changed.decision.id);
});

it("uses a real pinned native/clean video clock rather than planned seconds and preserves both original files", async () => {
  const { existsSync } = await import("node:fs");
  const { delimiter, dirname, isAbsolute, resolve } = await import("node:path");
  const { loadQcRunner, verifiedQcTools } = await import("./film-export-qc-runtime.js");
  const configured = process.env.AIVORA_FFMPEG;
  const ffmpeg =
    configured && isAbsolute(configured) && existsSync(configured)
      ? configured
      : (process.env.PATH ?? "")
          .split(delimiter)
          .map((root) => resolve(root, `ffmpeg${process.platform === "win32" ? ".exe" : ""}`))
          .find((path) => existsSync(path));
  if (!ffmpeg) throw Error("Pinned media tools unavailable");
  const tools = await verifiedQcTools(
    dirname(ffmpeg),
    resolve(
      "../../config",
      process.platform === "win32"
        ? "media-toolchain-lock.json"
        : "draft-media-toolchain-linux-dev-lock.json",
    ),
  );
  const run = await loadQcRunner(resolve("../../packages/aivora-qc"));
  const f = await fixture(),
    clean = join(dirname(f.native), "clean.mp4");
  for (const [path, duration] of [
    [f.native, "1.25"],
    [clean, "0.75"],
  ] as const) {
    await run(tools.ffmpegPath, [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=blue:s=160x90:r=24:d=${duration}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      path,
    ]);
  }
  const record = await f.disk();
  const shot = record.shots![0] as Record<string, unknown>;
  (shot.takes as Record<string, unknown>[])[0]!.cleanVideoPath = clean;
  shot.seconds = 99;
  await writeProject(f.host.filmsRoot, record);
  const originals = await Promise.all([readFile(f.native), readFile(clean)]);
  const trials = createFilmRiskTrials({ ...f.host, tools: async () => tools, run });
  const ready = await trials.prepare(1, await f.input());
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw Error("real inspection failed");
  expect(ready.durationSeconds).toBeCloseTo(0.75, 5);
  const media = await trials.readMedia(1, f.project, ready.reviewId);
  expect(media.kind).toBe("MEDIA");
  if (media.kind === "MEDIA") expect(Buffer.from(media.bytes)).toEqual(originals[1]);
  expect(
    await trials.record(1, {
      projectId: f.project,
      expectedHash: ready.projectHash,
      reviewId: ready.reviewId,
      decision: "accepted",
      note: "人工接受",
    }),
  ).toMatchObject({ kind: "RECORDED" });
  expect(await readFile(f.native)).toEqual(originals[0]);
  expect(await readFile(clean)).toEqual(originals[1]);
}, 30000);

it.each(["stale", "empty", "wrong-project"])(
  "preserves an actual human record when post-write readback is %s, returning unknown rather than unchanged",
  async (mode) => {
    const f = await fixture(),
      before = await f.disk();
    let after = false;
    const trials = createFilmRiskTrials({
      ...f.host,
      beforeCommit: async () => {
        after = true;
      },
      read: async (root, id) =>
        !after
          ? readProject(root, id)
          : mode === "empty"
            ? null
            : mode === "wrong-project"
              ? { ...before, id: "film_dddddddddddddddd" }
              : before,
    });
    const ready = await trials.prepare(1, await f.input());
    if (ready.kind !== "READY") throw Error("prepare failed");
    const result = await trials.record(1, {
      projectId: f.project,
      expectedHash: ready.projectHash,
      reviewId: ready.reviewId,
      decision: "accepted",
      note: "人工事实已写",
    });
    expect(result).toEqual({ kind: "FAILED", code: "WRITE_UNCONFIRMED", unchanged: false });
    expect((await f.disk()).riskTrialDecisions).toHaveLength(1);
    after = false;
    const observed = await trials.prepare(1, await f.input());
    expect(observed.kind).toBe("READY");
    if (observed.kind === "READY") expect(observed.existingDecision?.decision).toBe("accepted");
  },
);
it("keeps the factory BUSY through the actual decision write/readback and releases only its own reservation", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((done) => {
      release = done;
    }),
    started = new Promise<void>((done) => {
      entered = done;
    });
  const trials = createFilmRiskTrials({
    ...f.host,
    beforeCommit: async () => {
      entered();
      await held;
    },
  });
  const ready = await trials.prepare(1, await f.input());
  if (ready.kind !== "READY") throw Error("prepare failed");
  const pending = trials.record(1, {
    projectId: f.project,
    expectedHash: ready.projectHash,
    reviewId: ready.reviewId,
    decision: "accepted",
    note: "",
  });
  try {
    await Promise.race([
      started,
      pending.then(() => {
        throw Error("record settled before held commit");
      }),
    ]);
    expect(await trials.prepare(1, await f.input())).toMatchObject({
      kind: "FAILED",
      code: "BUSY",
    });
  } finally {
    release();
  }
  expect(await pending).toMatchObject({ kind: "RECORDED" });
  expect(await trials.prepare(1, await f.input())).toMatchObject({ kind: "READY" });
});
it("aborts the existing managed probe signal on owner retirement and cannot revive a late review", async () => {
  const f = await fixture();
  let entered!: () => void;
  const started = new Promise<void>((done) => {
    entered = done;
  });
  let signal: AbortSignal | undefined;
  const trials = createFilmRiskTrials({
    ...f.host,
    run: async (_binary, _args, options) => {
      signal = options?.signal;
      entered();
      return new Promise((_resolve, reject) => {
        if (!signal) throw Error("missing managed signal");
        signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
      });
    },
  });
  const pending = trials.prepare(1, await f.input());
  try {
    await started;
    trials.disposeOwner(1);
  } finally {
    trials.disposeOwner(1);
  }
  expect(signal?.aborted).toBe(true);
  expect(await pending).toMatchObject({ kind: "FAILED", code: "REVIEW_STALE" });
  expect((await f.disk()).riskTrialDecisions).toBeUndefined();
});
it("does not expand selected video ownership to another episode and fails closed before probing mismatched tools", async () => {
  const f = await fixture(),
    record = await f.disk();
  const foreign = join(
    f.host.filmsRoot,
    record.seriesId,
    "episodes",
    "film_ffffffffffffffff",
    "media",
    "other.mp4",
  );
  await mkdir(join(foreign, ".."), { recursive: true });
  await writeFile(foreign, "foreign video");
  ((record.shots![0] as Record<string, unknown>).takes as Record<string, unknown>[])[0]!.videoPath =
    foreign;
  await writeProject(f.host.filmsRoot, record);
  expect(await f.trials.prepare(1, await f.input())).toMatchObject({
    kind: "FAILED",
    code: "SOURCE_UNVERIFIED",
  });
  expect(f.host.run).not.toHaveBeenCalled();
  const unavailable = createFilmRiskTrials({
    ...f.host,
    tools: async () => {
      throw Error("fixed tool mismatch");
    },
  });
  expect(await unavailable.prepare(1, await f.input())).toMatchObject({
    kind: "FAILED",
    code: "TOOLS_UNAVAILABLE",
  });
  expect(f.host.run).not.toHaveBeenCalled();
});

it.each(["enum-array", "note-over-limit"])(
  "rejects exact record-shape violation %s before any write or probe",
  async (mode) => {
    const f = await fixture(),
      before = await f.disk();
    const result = await f.trials.record(1, {
      projectId: f.project,
      expectedHash: filmHistoryRecordHash(before),
      reviewId: `rtr_${"a".repeat(32)}`,
      decision: mode === "enum-array" ? ["accepted"] : "accepted",
      note: mode === "note-over-limit" ? "😀".repeat(251) : "",
    });
    expect(result).toEqual({ kind: "FAILED", code: "INVALID_INPUT", unchanged: true });
    expect(f.host.run).not.toHaveBeenCalled();
    expect(await f.disk()).toEqual(before);
  },
);
it("preserves exactly the full 500 UTF-16-unit user note without trimming or truncation", async () => {
  const f = await fixture(),
    ready = await f.ready(),
    note = "😀".repeat(250);
  const result = await f.trials.record(1, {
    projectId: f.project,
    expectedHash: ready.projectHash,
    reviewId: ready.reviewId,
    decision: "needs-changes",
    note,
  });
  expect(result.kind).toBe("RECORDED");
  if (result.kind === "RECORDED") expect(result.decision.note).toBe(note);
  expect(((await f.disk()).riskTrialDecisions as { note: string }[])[0]!.note).toBe(note);
});

it("preserves a late unselected take and its file while recording against the unchanged selected trial/input", async () => {
  const f = await fixture(),
    ready = await f.ready();
  const record = await f.disk(),
    shot = record.shots![0] as Record<string, unknown>,
    takes = shot.takes as Record<string, unknown>[];
  const late = join(f.root, "films", record.seriesId, "episodes", f.project, "media", "late.mp4");
  await writeFile(late, "late candidate bytes");
  takes.push({ ...takes[0], id: "late-unselected", index: 3, videoPath: late });
  await writeProject(f.host.filmsRoot, record);
  const accepted = await f.trials.record(1, {
    projectId: f.project,
    expectedHash: (await f.input()).expectedHash,
    reviewId: ready.reviewId,
    decision: "accepted",
    note: "只接受已选试片",
  });
  expect(accepted.kind).toBe("RECORDED");
  const actual = (await f.disk()).shots![0] as Record<string, unknown>;
  expect(actual.selectedTakeId).toBe("take");
  const kept = (actual.takes as Record<string, unknown>[]).find(
    (take) => take.id === "late-unselected",
  )?.videoPath;
  expect(typeof kept).toBe("string");
  const [expectedFile, actualFile] = await Promise.all([
    stat(late, { bigint: true }),
    stat(String(kept), { bigint: true }),
  ]);
  expect([actualFile.dev, actualFile.ino]).toEqual([expectedFile.dev, expectedFile.ino]);
  expect((await readFile(late)).toString()).toBe("late candidate bytes");
});
