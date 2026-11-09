import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { verifiedQcTools, type QcRunner } from "./film-export-qc-runtime";
import type { generationSelectedMedia } from "./film-generation-selected-media";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import ts from "typescript";
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import { createNativeFilmGenerationExecutions } from "./film-generation-execution";
import type { FixedInputLedger } from "./film-generation-fixed-input";
import { registerFilmLibraryHandlers } from "./film-library-ipc";
import { readProject, writeProject as writeProjectNative, type FilmRecord } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import { generationRows } from "./film-generation-plan";
import { parseStoryFilmCreate } from "./story-film-client";
import { ffmpegOnPath, ffmpegSkipReason } from "./test-ffmpeg";
let producer: CanonicalGenerationProducer, compiledRoot: string;
const roots: string[] = [],
  releaseAll: (() => void)[] = [],
  pendingAll: Promise<unknown>[] = [],
  sidecarClosures: (() => Promise<void>)[] = [];
let testEpoch = Symbol("fixture");
beforeEach(() => {
  testEpoch = Symbol("fixture");
});
function track<T>(promise: Promise<T>): Promise<T> {
  pendingAll.push(promise);
  return promise;
}
function writeProject(...args: Parameters<typeof writeProjectNative>) {
  return track(writeProjectNative(...args));
}
beforeAll(async () => {
  compiledRoot = await mkdtemp(join(tmpdir(), "execution-real-producer-"));
  const built = spawnSync(
    process.execPath,
    [resolve("../../scripts/build-generation-input-runtime.mjs"), "--out-dir", compiledRoot],
    { encoding: "utf8" },
  );
  expect(built.status, built.stderr).toBe(0);
  producer = createRequire(resolve("package.json"))(
    join(compiledRoot, "film-generation-producer.js"),
  ) as CanonicalGenerationProducer;
});
afterAll(async () => {
  await rm(compiledRoot, { recursive: true, force: true });
});
afterEach(async () => {
  testEpoch = Symbol("closed-fixture");
  for (const release of releaseAll.splice(0)) release();
  while (pendingAll.length) await Promise.allSettled(pendingAll.splice(0));
  for (const close of sidecarClosures.splice(0)) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function responsePromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
async function createFixture(
  privateFailure?: string,
  real?: { projectId: string; fetcher: typeof fetch; uniqueImage?: boolean },
  frameStage = false,
  plannedLocation = false,
  extras?: { fixedInputs?: Pick<FixedInputLedger, "matches">; lineageItems?: unknown[] },
) {
  const epoch = testEpoch;
  const root = await mkdtemp(join(tmpdir(), "native-execution-factory-"));
  roots.push(root);
  const filmsRoot = join(root, "films"),
    storyRoot = join(root, "story");
  const id = `film_${"a".repeat(16)}`,
    seriesId = `film_${"b".repeat(16)}`,
    backend = real?.projectId ?? `prj_${"c".repeat(32)}`;
  const episode = join(filmsRoot, seriesId, "episodes", id),
    frame = join(episode, "frame.png");
  await mkdir(episode, { recursive: true });
  await mkdir(storyRoot);
  await writeFile(
    frame,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const scene = {
    id: "scene-one",
    no: 1,
    title: "雨后空街",
    where: "空街",
    text: "雨水在空街反光。",
    source: "native",
    userFields: [],
  };
  const record: FilmRecord = {
    id,
    seriesId,
    title: "真实原稿",
    seriesTitle: "真实原稿",
    episodeTitle: "第1集",
    episodeNo: 1,
    backendProjectId: backend,
    schemaVersion: 1,
    draft: false,
    aspectRatio: "16:9",
    styleZh: "写实",
    styleRevision: 0,
    stylePreset: "写实",
    sourceText: scene.text,
    narrationVoiceId: real ? "eve" : "",
    characters: [],
    props: [],
    audioClips: [],
    jobs: [],
    locations: [
      {
        id: "place",
        sceneId: scene.id,
        name: scene.where,
        prompt: scene.where,
        layout: "",
        ambience: "",
        referenceImage: frame,
        referenceStyleRevision: 0,
        referenceLayout: "",
        referenceSceneSignature: JSON.stringify([scene.id, scene.title, scene.where, scene.text]),
      },
    ],
    scenes: [scene],
    shots: [
      {
        id: "shot-one",
        no: 1,
        sceneId: scene.id,
        picture: "雨水在空街反光。",
        action: "雨水缓缓流动。",
        performance: "",
        size: "全景",
        angle: "平视",
        move: "固定",
        seconds: 3,
        characters: [],
        line: real ? "雨停了。" : "",
        lines: [],
        speaker: "",
        sound: { ambience: "", sfx: [], musicMood: "", source: "native" },
        poster: frameStage ? "" : frame,
        stills: [],
        selectedTakeId: "old",
        userFields: [],
        source: "native",
        takes: [
          {
            id: "old",
            shotId: "shot-one",
            index: 1,
            status: "done",
            stillUrl: frameStage ? "" : frame,
            videoPath: "",
            videoUrl: "",
            prompt: "",
            createdAt: "",
            reason: "",
          },
        ],
      },
    ],
  };
  if (plannedLocation) record.locations = [];
  await writeProject(filmsRoot, record);
  let active = true;
  const owner = { id: 4, current: () => active && testEpoch === epoch },
    session = { origin: "http://127.0.0.1:51234", token: "s".repeat(43) },
    account = { bearer: "native-bearer", accountSha256: "d".repeat(64) };
  const registrations: unknown[] = [],
    arms: unknown[] = [],
    submissions: string[] = [];
  let holdArm: (() => Promise<void>) | undefined;
  let observationFailure = false;
  let reservationFailure: string | undefined;
  let reservationUnknown = false;
  let imageCalls = 0;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (new URL(String(url)).hostname === "api.x.ai") {
      expect(new URL(String(url)).pathname).toMatch(/^\/v1\/images\/(?:edits|generations)$/);
      expect(init?.method).toBe("POST");
      imageCalls++;
      const bytes = await readFile(frame);
      return Response.json({
        data: [
          {
            b64_json: (plannedLocation || real?.uniqueImage
              ? Buffer.concat([bytes, Buffer.from(String(imageCalls))])
              : bytes
            ).toString("base64"),
          },
        ],
      });
    }
    const path = new URL(String(url)).pathname,
      raw = String(init?.body),
      headers = new Headers(init?.headers);
    const assertion = JSON.parse(
      Buffer.from(headers.get("X-Aivora-Generation-Account")!, "base64url").toString(),
    ) as { account: string; expires: number; signature: string };
    const arm = headers.get("X-Aivora-Prepared-Generation");
    expect(assertion.account).toBe(account.accountSha256);
    expect(assertion.signature).toBe(
      createHmac("sha256", session.token)
        .update(
          [
            arm ? "aivora-video-account-v2" : "aivora-video-account-v1",
            backend,
            headers.get("Idempotency-Key"),
            sha(raw),
            sha(account.bearer),
            account.accountSha256,
            assertion.expires,
            ...(arm ? [arm] : []),
          ].join("\n"),
        )
        .digest("hex"),
    );
    if (real) return real.fetcher(url, init);
    if (privateFailure) return Response.json({ detail: privateFailure }, { status: 409 });
    if (path.endsWith("/lineages")) return Response.json({ items: extras?.lineageItems ?? [] });
    if (path.endsWith("/video-arm")) {
      arms.push(JSON.parse(raw));
      await holdArm?.();
      return Response.json({ arm_id: "f".repeat(32) });
    }
    if (path.endsWith("/image-dispatch")) {
      if (reservationUnknown) throw Error("controlled lost reservation acknowledgement");
      if (reservationFailure) return Response.json({ detail: reservationFailure }, { status: 409 });
      await holdArm?.();
      return Response.json({ kind: "RECORDED" });
    }
    if (path.endsWith("/image-observation") && observationFailure)
      throw Error("controlled lost observation acknowledgement");
    if (path.endsWith("/image-unsent") || path.endsWith("/image-observation"))
      return Response.json({ kind: "RECORDED" });
    if (path.endsWith("/retire")) return Response.json({ kind: "RECORDED" });
    if (path.endsWith("/prepared-generation-executions")) {
      registrations.push(JSON.parse(raw));
      return Response.json({ execution_id: "e".repeat(32) });
    }
    if (path.endsWith("/story-film")) {
      expect(arm).toBe("f".repeat(32));
      submissions.push(raw);
      return Response.json({
        request_id: "controlled-sidecar",
        data: { status: "BLOCKED", message: "controlled API only" },
      });
    }
    throw Error("UNEXPECTED_ROUTE");
  });
  const mediaDispatchLease = vi.fn<
    Parameters<typeof createNativeFilmGenerationExecutions>[0]["mediaDispatchLease"]
  >(async () => ({ account, current: () => active }));
  const factoryHost: Parameters<typeof createNativeFilmGenerationExecutions>[0] = {
    filmsRoot: () => filmsRoot,
    storyFilmsRoot: () => storyRoot,
    session: () => session,
    mediaDispatchLease,
    storySourceOwner: async () => false,
    fetcher,
    producer: async () => producer,
    ...(extras?.fixedInputs ? { fixedInputs: extras.fixedInputs } : {}),
  };
  const implementation = createNativeFilmGenerationExecutions(factoryHost);
  const factory = {
    ...implementation,
    prepare: (...args: Parameters<typeof implementation.prepare>) =>
      track(implementation.prepare(...args)),
    retire: (...args: Parameters<typeof implementation.retire>) =>
      track(implementation.retire(...args)),
    still: (...args: Parameters<typeof implementation.still>) =>
      track(implementation.still(...args)),
    video: (...args: Parameters<typeof implementation.video>) =>
      track(implementation.video(...args)),
  };
  const stored = (await readProject(filmsRoot, id))!;
  const input = {
    projectId: id,
    expectedProjectHash: filmHistoryRecordHash(stored),
    mode: "video" as const,
    targets: [{ shotId: "shot-one", versions: 1 as const }],
  };
  return {
    root,
    filmsRoot,
    storyRoot,
    frame,
    mediaDispatchLease,
    useOtherAccount: () => {
      account.accountSha256 = "e".repeat(64);
    },
    useLocalMedia: (host: Parameters<typeof generationSelectedMedia>[3]) => {
      factoryHost.selectedMediaHost = async () => host;
    },
    record: stored,
    owner,
    factory,
    input,
    registrations,
    arms,
    submissions,
    fetcher,
    imageCalls: () => imageCalls,
    loseReservation: () => {
      reservationUnknown = true;
    },
    refuseImage: (code: string) => {
      reservationFailure = code;
    },
    loseObservation: () => {
      observationFailure = true;
    },
    stop: () => {
      active = false;
    },
    setHold: (action: () => Promise<void>) => {
      holdArm = action;
    },
  };
}
function fixture(...args: Parameters<typeof createFixture>) {
  return track(createFixture(...args));
}
async function preparedVideo(f: Awaited<ReturnType<typeof fixture>>, versions: 1 | 2 = 1) {
  const prepared = await f.factory.prepare(f.owner, {
    ...f.input,
    targets: [{ shotId: "shot-one", versions }],
  });
  expect(prepared.kind, "code" in prepared ? prepared.code : "").toBe("PREPARED");
  if (prepared.kind !== "PREPARED")
    throw Error(prepared.kind === "FAILED" ? prepared.code : "UNEXPECTED_NOT_NEEDED");
  const shot = generationRows(f.record.shots)[0]!;
  const queued = producer.prepareVideoQueue(f.record, [shot], versions, false);
  const newTakes = queued.groups[0]!.takes;
  await writeProject(f.filmsRoot, queued.film as FilmRecord);
  const live = (await readProject(f.filmsRoot, f.record.id))!;
  const body = parseStoryFilmCreate(
    producer.generationVideoBody(live, generationRows(live.shots)[0], shot, undefined, false),
  );
  body.regenerate = producer.generationHadTakes(shot);
  const target = prepared.targets[0]!;
  return {
    prepared,
    newTakes,
    canonical: structuredClone(live),
    body,
    execution: {
      executionId: prepared.executionId,
      videoSlotId: target.videoSlotIds[0]!,
      shotId: target.shotId,
      takeId: newTakes[0]!.id,
    },
  };
}
it("prepares real canonical fixed-frame bytes and enters the actual signed client callback once", async () => {
  const f = await fixture();
  expect(f.fetcher).not.toHaveBeenCalled();
  const p = await preparedVideo(f);
  expect(JSON.stringify(p.prepared)).not.toContain(f.frame);
  expect(f.submissions).toHaveLength(0);
  const result = await f.factory.video(
    f.owner,
    String(f.record.backendProjectId),
    p.body,
    undefined,
    p.execution,
  );
  expect(result.data.status).toBe("BLOCKED");
  expect(f.registrations).toHaveLength(1);
  expect(f.arms).toHaveLength(1);
  expect(f.submissions).toHaveLength(1);
  expect(JSON.parse(f.submissions[0]!).regenerate).toBe(true);
  const shot = p.body.shots![0]!,
    expectedRoles: { role: string; index: number; source: string }[] = [];
  if (shot.still) expectedRoles.push({ role: "still", index: 0, source: shot.still });
  if (shot.reference) expectedRoles.push({ role: "reference", index: 0, source: shot.reference });
  for (const [index, source] of (shot.references ?? []).entries())
    expectedRoles.push({ role: "references", index, source });
  const canonical = await realpath(f.frame),
    outputSha = createHash("sha256")
      .update(await readFile(f.frame))
      .digest("hex");
  expect(f.arms[0]).toMatchObject({
    wire_body: f.submissions[0],
    body_sha256: sha(f.submissions[0]!),
    sources: expectedRoles.map((role) => ({
      ...role,
      canonical_path: canonical,
      sha256: outputSha,
      mime: "image/png",
    })),
  });
  expect(f.registrations[0]).toMatchObject({
    targets: [{ versions: 1, first_regenerate: true }],
    stages: [],
  });
  await expect(
    f.factory.video(f.owner, String(f.record.backendProjectId), p.body, undefined, p.execution),
  ).rejects.toMatchObject({ code: "CREATION_ATTEMPT_ALREADY_RESERVED" });
  expect(f.submissions).toHaveLength(1);
  expect(await readProject(f.filmsRoot, f.record.id)).toEqual(p.canonical);
});
it("retirement while real arm is held prevents the signed StoryFilm request", async () => {
  const f = await fixture(),
    p = await preparedVideo(f),
    entered = deferred(),
    release = deferred();
  releaseAll.push(release.resolve);
  f.setHold(async () => {
    entered.resolve();
    await release.promise;
  });
  const pending = f.factory.video(
    f.owner,
    String(f.record.backendProjectId),
    p.body,
    undefined,
    p.execution,
  );
  pendingAll.push(pending);
  const rejected = expect(pending).rejects.toMatchObject({ code: "EXECUTION_UNAVAILABLE" });
  await entered.promise;
  expect(
    await f.factory.retire(f.owner, {
      executionId: p.execution.executionId,
      videoSlotId: p.execution.videoSlotId,
    }),
  ).toEqual({ kind: "RETIRED" });
  release.resolve();
  await rejected;
  expect(f.submissions).toHaveLength(0);
});
it("same-path byte replacement after actual arm admission reaches no StoryFilm transport", async () => {
  const f = await fixture(),
    p = await preparedVideo(f),
    entered = deferred(),
    release = deferred();
  releaseAll.push(release.resolve);
  f.setHold(async () => {
    entered.resolve();
    await release.promise;
  });
  const pending = f.factory.video(
    f.owner,
    String(f.record.backendProjectId),
    p.body,
    undefined,
    p.execution,
  );
  pendingAll.push(pending);
  const rejected = expect(pending).rejects.toMatchObject({ code: "SOURCE_UNVERIFIABLE" });
  await entered.promise;
  await writeFile(f.frame, "changed original frame bytes");
  release.resolve();
  await rejected;
  expect(f.submissions).toHaveLength(0);
});

it("rejects unsupported continuity, cache-eligible and pipeline scopes before private registration", async () => {
  for (const kind of ["continuity", "cache", "pipeline"] as const) {
    const f = await fixture();
    const changed = structuredClone(f.record),
      shot = generationRows(changed.shots)[0]!;
    if (kind === "continuity") {
      shot.continuityFromShotId = "unverified-previous-shot";
      shot.poster = "";
      generationRows(shot.takes)[0]!.stillUrl = "";
      generationRows(changed.locations)[0]!.referenceImage = "";
    }
    if (kind === "cache") generationRows(shot.takes)[0]!.status = "failed";
    await writeProject(f.filmsRoot, changed);
    const actual = (await readProject(f.filmsRoot, changed.id))!;
    expect(
      await f.factory.prepare(f.owner, {
        ...f.input,
        mode: kind === "pipeline" ? "pipeline" : "video",
        expectedProjectHash: filmHistoryRecordHash(actual),
      }),
    ).toEqual({ kind: "FAILED", code: "UNSUPPORTED_SCOPE" });
    expect(f.registrations).toEqual([]);
    expect(f.arms).toEqual([]);
    expect(f.submissions).toEqual([]);
  }
});
it("preserves a later canonical creative edit while refusing the old armed request", async () => {
  const f = await fixture(),
    p = await preparedVideo(f),
    entered = deferred(),
    release = deferred();
  releaseAll.push(release.resolve);
  f.setHold(async () => {
    entered.resolve();
    await release.promise;
  });
  const pending = f.factory.video(
    f.owner,
    String(f.record.backendProjectId),
    p.body,
    undefined,
    p.execution,
  );
  pendingAll.push(pending);
  const rejected = expect(pending).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
  await entered.promise;
  const current = (await readProject(f.filmsRoot, f.record.id))!;
  const written = await writeProject(f.filmsRoot, {
    ...current,
    shots: generationRows(current.shots).map((shot) => ({
      ...shot,
      picture: "用户后来修改的画面。",
    })),
  });
  release.resolve();
  await rejected;
  expect(f.submissions).toHaveLength(0);
  expect(await readProject(f.filmsRoot, f.record.id)).toEqual(written);
});
it("rejects stale raw preparation without register, arm, source copies or StoryFilm submission", async () => {
  const f = await fixture();
  expect(
    await f.factory.prepare(f.owner, { ...f.input, expectedProjectHash: "0".repeat(64) }),
  ).toEqual({ kind: "FAILED", code: "PROJECT_CHANGED" });
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(await readProject(f.filmsRoot, f.record.id)).toEqual(f.record);
});

it("binds each issued slot to the corresponding actual queue append, not another slot's take", async () => {
  const f = await fixture(),
    p = await preparedVideo(f, 2);
  const call = (execution: typeof p.execution) =>
    f.factory.video(f.owner, String(f.record.backendProjectId), p.body, undefined, execution);
  await expect(call({ ...p.execution, takeId: p.newTakes[1]!.id })).rejects.toMatchObject({
    code: "PROJECT_CHANGED",
  });
  expect(f.arms).toHaveLength(0);
  await call(p.execution);
  const second = { ...p.execution, videoSlotId: p.prepared.targets[0]!.videoSlotIds[1]! };
  await expect(call(second)).rejects.toMatchObject({ code: "EXECUTION_UNAVAILABLE" });
  expect(f.arms).toHaveLength(1);
  expect(f.submissions).toHaveLength(1);
  await call({ ...second, takeId: p.newTakes[1]!.id });
  expect(f.arms).toHaveLength(2);
  expect(f.submissions).toHaveLength(2);
  expect(await readProject(f.filmsRoot, f.record.id)).toEqual(p.canonical);
});

it("rejects old takes, reordered appends and replacement IDs after the queue has been pinned", async () => {
  const f = await fixture(),
    p = await preparedVideo(f, 2);
  const call = (execution: typeof p.execution) =>
    f.factory.video(f.owner, String(f.record.backendProjectId), p.body, undefined, execution);
  const changed = structuredClone(p.canonical),
    shot = generationRows(changed.shots)[0]!;
  const takes = generationRows(shot.takes);
  takes[0]!.status = "running";
  await writeProject(f.filmsRoot, changed);
  await expect(call({ ...p.execution, takeId: String(takes[0]!.id) })).rejects.toMatchObject({
    code: "PROJECT_CHANGED",
  });
  shot.takes = [takes[0], takes[2], takes[1]];
  await writeProject(f.filmsRoot, changed);
  await expect(call(p.execution)).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
  expect(f.arms).toHaveLength(0);
  await writeProject(f.filmsRoot, p.canonical);
  await call(p.execution);
  const replacement = structuredClone(p.canonical),
    replacementShot = generationRows(replacement.shots)[0]!;
  generationRows(replacementShot.takes)[2]!.id = "replacement-new-take";
  await writeProject(f.filmsRoot, replacement);
  const replacementStored = await readProject(f.filmsRoot, f.record.id);
  await expect(
    call({
      ...p.execution,
      videoSlotId: p.prepared.targets[0]!.videoSlotIds[1]!,
      takeId: "replacement-new-take",
    }),
  ).rejects.toMatchObject({ code: "PROJECT_CHANGED" });
  expect(f.arms).toHaveLength(1);
  expect(f.submissions).toHaveLength(1);
  expect(await readProject(f.filmsRoot, f.record.id)).toEqual(replacementStored);
});

it.each(["VIDEO_UNCONFIGURED", "VIDEO_INPUT_FAILURE_LIMIT"])(
  "keeps actual private %s gates fixed before registration or video",
  async (code) => {
    const f = await fixture(code);
    await expect(f.factory.prepare(f.owner, f.input)).resolves.toMatchObject({
      kind: "FAILED",
      code,
    });
    expect(f.registrations).toHaveLength(0);
    expect(f.arms).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
  },
);

async function createSignedSidecar() {
  const root = await mkdtemp(join(tmpdir(), "native-prepared-sidecar-"));
  roots.push(root);
  const repositoryRoot = resolve("../..");
  type Reply = {
    requestId: number;
    requestSha256: string;
    status: number;
    body: unknown;
    sent: string[];
    attempts: string[];
  };
  const child = spawn(
    "uv",
    ["run", "python", "services/api/tests/prepared_native_test_sidecar.py", root],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONPATH: [
          resolve(repositoryRoot, "services/api/src"),
          resolve(repositoryRoot, "services/api/tests"),
          process.env.PYTHONPATH,
        ]
          .filter(Boolean)
          .join(delimiter),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const ready = responsePromise<string>();
  let projectId: string | undefined,
    stderr = "";
  let sequence = 0;
  const pending = new Map<
    number,
    { expectedSha256: string; response: ReturnType<typeof responsePromise<Reply>> }
  >();
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-16000);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    try {
      const value = JSON.parse(line) as Reply & { projectId?: string };
      if (!projectId) {
        if (typeof value.projectId !== "string" || !/^prj_[a-f0-9]{32}$/.test(value.projectId))
          throw Error("SIDECAR_TEST_INVALID_READY");
        projectId = value.projectId;
        ready.resolve(projectId);
      } else {
        const item = pending.get(value.requestId);
        if (
          !Number.isInteger(value.requestId) ||
          value.requestId < 1 ||
          value.requestId > 4096 ||
          !item ||
          value.requestSha256 !== item.expectedSha256 ||
          !Number.isInteger(value.status) ||
          value.status < 100 ||
          value.status > 599 ||
          !Array.isArray(value.sent) ||
          !Array.isArray(value.attempts)
        )
          throw Error("SIDECAR_TEST_INVALID_REPLY");
        pending.delete(value.requestId);
        item.response.resolve(value);
      }
    } catch {
      ready.reject(Error("SIDECAR_TEST_INVALID_REPLY"));
      for (const item of pending.values())
        item.response.reject(Error("SIDECAR_TEST_INVALID_REPLY"));
      pending.clear();
    }
  });
  child.on("error", () => {
    ready.reject(Error("SIDECAR_TEST_SPAWN_FAILED"));
  });
  const exited = new Promise<number | null>((resolveExit) =>
    child.on("close", (code) => {
      ready.reject(Error("SIDECAR_TEST_EXITED"));
      for (const item of pending.values()) item.response.reject(Error("SIDECAR_TEST_EXITED"));
      pending.clear();
      resolveExit(code);
    }),
  );
  sidecarClosures.push(async () => {
    child.stdin.end();
    expect(await exited, stderr).toBe(0);
    lines.close();
  });
  child.stdin.write(JSON.stringify({ kind: "serve" }) + "\n");
  const actualProjectId = await ready.promise;
  const replies: Reply[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const item = responsePromise<Reply>();
    const requestId = ++sequence;
    const body = String(init?.body);
    pending.set(requestId, { response: item, expectedSha256: sha(body) });
    child.stdin.write(
      JSON.stringify({
        kind: "request",
        requestId,
        path: new URL(String(url)).pathname,
        body,
        headers: Object.fromEntries(new Headers(init?.headers)),
      }) + "\n",
    );
    const reply = await item.promise;
    replies.push(reply);
    return Response.json(reply.body, { status: reply.status });
  };
  return { projectId: actualProjectId, replies, fetcher, root };
}

function signedSidecar() {
  return track(createSignedSidecar());
}

it.skipIf(!ffmpegOnPath()).each([false, true])(
  `crosses actual Python signed routes and original consumer with fixed frame stage=%s (${ffmpegSkipReason})`,
  async (frameStage) => {
    const { projectId, replies, fetcher: realFetch } = await signedSidecar();
    const f = await fixture(undefined, { projectId, fetcher: realFetch }, frameStage),
      p = await preparedVideo(f);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    if (frameStage) {
      const shot = generationRows(p.canonical.shots)[0]!;
      const actual = producer.shotStillInput(
        p.canonical,
        shot,
        producer.keyframePrompt(shot, p.canonical),
      ) as { kind: string; prompt: string; references: string[]; aspectRatio: "16:9" | "9:16" };
      expect(actual.kind).toBe("READY");
      const input = {
        seriesId: String(f.record.seriesId),
        prompt: actual.prompt,
        references: actual.references,
        aspectRatio: actual.aspectRatio,
        execution: { executionId: p.prepared.executionId, stageId: p.prepared.stages[0]!.stageId },
      };
      const made = await f.factory.still(f.owner, input);
      expect(made.code).toBeUndefined();
      expect(made.path).not.toBe("");
      expect(f.imageCalls()).toBe(1);
      expect((await f.factory.still(f.owner, input)).code).toBe(
        "CREATION_ATTEMPT_ALREADY_RESERVED",
      );
      expect(f.imageCalls()).toBe(1);
      const next = structuredClone(p.canonical);
      generationRows(next.shots)[0]!.poster = made.path;
      await writeProject(f.filmsRoot, next);
      p.canonical = (await readProject(f.filmsRoot, f.record.id))!;
      p.body = parseStoryFilmCreate(
        producer.generationVideoBody(
          p.canonical,
          generationRows(p.canonical.shots)[0],
          generationRows(f.record.shots)[0],
          undefined,
          false,
        ),
      );
      p.body.regenerate = true;
    }
    const outcome = await f.factory.video(f.owner, projectId, p.body, undefined, p.execution);
    expect(
      outcome.data.status,
      JSON.stringify({
        provider: p.body.provider,
        sent: replies.flatMap((reply) => reply.sent),
        attempts: replies.at(-1)?.attempts,
      }),
    ).toBe("FAILED");
    expect(replies.map((reply) => reply.status)).toEqual(Array(frameStage ? 9 : 4).fill(200));
    expect(replies.flatMap((reply) => reply.sent)).toEqual(["tts"]);
    expect(replies.at(-1)!.attempts).toEqual(["UNKNOWN"]);
    await expect(
      f.factory.video(f.owner, projectId, p.body, undefined, p.execution),
    ).rejects.toMatchObject({ code: "CREATION_ATTEMPT_ALREADY_RESERVED" });
    expect(replies).toHaveLength(frameStage ? 9 : 4);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(p.canonical);
  },
  30_000,
);

it.each(["retired", "owner", "changed-bytes"])(
  "stops a fixed-reference frame before actual image POST when %s after reservation",
  async (change) => {
    const f = await fixture(undefined, undefined, true),
      p = await preparedVideo(f),
      entered = deferred(),
      release = deferred();
    releaseAll.push(release.resolve);
    f.setHold(async () => {
      entered.resolve();
      await release.promise;
    });
    const shot = generationRows(p.canonical.shots)[0]!;
    const actual = producer.shotStillInput(
      p.canonical,
      shot,
      producer.keyframePrompt(shot, p.canonical),
    ) as { prompt: string; references: string[]; aspectRatio: "16:9" | "9:16" };
    const input = {
      seriesId: String(f.record.seriesId),
      prompt: actual.prompt,
      references: actual.references,
      aspectRatio: actual.aspectRatio,
      execution: { executionId: p.prepared.executionId, stageId: p.prepared.stages[0]!.stageId },
    };
    expect(
      (await f.factory.still(f.owner, { ...input, prompt: input.prompt + " changed" })).code,
    ).toBe("PROJECT_CHANGED");
    expect(f.imageCalls()).toBe(0);
    const pending = f.factory.still(f.owner, input);
    pendingAll.push(pending);
    await entered.promise;
    if (change === "retired")
      await f.factory.retire(f.owner, { executionId: p.prepared.executionId });
    else if (change === "owner") f.stop();
    else await writeFile(f.frame, "changed bytes at the original source path");
    release.resolve();
    const made = await pending;
    expect(made.path).toBe("");
    expect(made.code).toBe(
      change === "changed-bytes" ? "SOURCE_UNVERIFIABLE" : "EXECUTION_UNAVAILABLE",
    );
    expect(f.imageCalls()).toBe(0);
    expect(f.submissions).toHaveLength(0);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(p.canonical);
  },
);

it("retains the actual frame file when its lineage acknowledgement is unknown without repeating an image", async () => {
  const f = await fixture(undefined, undefined, true),
    p = await preparedVideo(f);
  const shot = generationRows(p.canonical.shots)[0]!;
  const actual = producer.shotStillInput(
    p.canonical,
    shot,
    producer.keyframePrompt(shot, p.canonical),
  ) as { prompt: string; references: string[]; aspectRatio: "16:9" | "9:16" };
  const input = {
    seriesId: String(f.record.seriesId),
    prompt: actual.prompt,
    references: actual.references,
    aspectRatio: actual.aspectRatio,
    execution: { executionId: p.prepared.executionId, stageId: p.prepared.stages[0]!.stageId },
  };
  f.loseObservation();
  const made = await f.factory.still(f.owner, input);
  expect(made.code).toBe("WRITE_UNCONFIRMED");
  expect(made.path).not.toBe("");
  expect(await readFile(made.path)).toEqual(await readFile(f.frame));
  expect((await f.factory.still(f.owner, input)).code).toBe("CREATION_ATTEMPT_ALREADY_RESERVED");
  expect(f.imageCalls()).toBe(1);
  expect(f.submissions).toHaveLength(0);
  expect(await readProject(f.filmsRoot, f.record.id)).toEqual(p.canonical);
});

it.each(["VIDEO_UNCONFIGURED", "VIDEO_INPUT_FAILURE_LIMIT"])(
  "does not release someone else's hold or hide an explicit %s image gate",
  async (code) => {
    const f = await fixture(undefined, undefined, true),
      p = await preparedVideo(f);
    const shot = generationRows(p.canonical.shots)[0]!;
    const actual = producer.shotStillInput(
      p.canonical,
      shot,
      producer.keyframePrompt(shot, p.canonical),
    ) as { prompt: string; references: string[]; aspectRatio: "16:9" | "9:16" };
    f.refuseImage(code);
    const made = await f.factory.still(f.owner, {
      seriesId: String(f.record.seriesId),
      prompt: actual.prompt,
      references: actual.references,
      aspectRatio: actual.aspectRatio,
      execution: { executionId: p.prepared.executionId, stageId: p.prepared.stages[0]!.stageId },
    });
    expect(made.code).toBe(code);
    expect(f.imageCalls()).toBe(0);
    expect(
      f.fetcher.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith("/image-unsent"),
      ),
    ).toHaveLength(0);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(p.canonical);
  },
);

it("preserves an unacknowledged image reservation without calling unsent or provider", async () => {
  const f = await fixture(undefined, undefined, true),
    p = await preparedVideo(f);
  const shot = generationRows(p.canonical.shots)[0]!;
  const actual = producer.shotStillInput(
    p.canonical,
    shot,
    producer.keyframePrompt(shot, p.canonical),
  ) as { prompt: string; references: string[]; aspectRatio: "16:9" | "9:16" };
  f.loseReservation();
  const input = {
    seriesId: String(f.record.seriesId),
    prompt: actual.prompt,
    references: actual.references,
    aspectRatio: actual.aspectRatio,
    execution: { executionId: p.prepared.executionId, stageId: p.prepared.stages[0]!.stageId },
  };
  expect((await f.factory.still(f.owner, input)).code).toBe("WRITE_UNCONFIRMED");
  expect((await f.factory.still(f.owner, input)).code).toBe("CREATION_ATTEMPT_ALREADY_RESERVED");
  expect(f.imageCalls()).toBe(0);
  expect(
    f.fetcher.mock.calls.filter(([url]) => new URL(String(url)).pathname.endsWith("/image-unsent")),
  ).toHaveLength(0);
  expect(await readProject(f.filmsRoot, f.record.id)).toEqual(p.canonical);
});

it.skipIf(!ffmpegOnPath())(
  "uses actual planned-location lineage through the original frame and video consumers",
  async () => {
    const { projectId, replies, fetcher } = await signedSidecar();
    const f = await fixture(undefined, { projectId, fetcher }, true, true),
      p = await preparedVideo(f);
    expect(p.prepared.stages.map((stage) => stage.kind)).toEqual([
      "location-reference",
      "shot-frame",
    ]);
    // The renderer's original pure materialization, not a seed or manually invented row.
    await writeProject(f.filmsRoot, producer.prepareSceneLocations(p.canonical) as FilmRecord);
    let live = (await readProject(f.filmsRoot, f.record.id))!;
    for (const stage of p.prepared.stages) {
      const shot = generationRows(live.shots)[0]!;
      const place = generationRows(live.locations).find((place) => place.id === stage.targetId);
      const frame =
        stage.kind === "shot-frame"
          ? (producer.shotStillInput(live, shot, producer.keyframePrompt(shot, live)) as {
              prompt: string;
              references: string[];
            })
          : undefined;
      const prompt =
        frame?.prompt ??
        producer.withStyleBible(
          producer.locationGenerationPrompt(live, place),
          String(live.styleZh),
        );
      const made = await f.factory.still(f.owner, {
        seriesId: String(f.record.seriesId),
        prompt,
        references: frame?.references ?? [],
        aspectRatio: "16:9",
        execution: { executionId: p.prepared.executionId, stageId: stage.stageId },
      });
      expect(made.code).toBeUndefined();
      expect(made.path).not.toBe("");
      if (stage.kind === "location-reference")
        Object.assign(place!, producer.locationImageFields(live, place, made.path));
      else shot.poster = made.path;
      await writeProject(f.filmsRoot, live);
      live = (await readProject(f.filmsRoot, f.record.id))!;
    }
    expect(f.imageCalls()).toBe(2);
    const body = parseStoryFilmCreate(
      producer.generationVideoBody(
        live,
        generationRows(live.shots)[0],
        generationRows(f.record.shots)[0],
        undefined,
        false,
      ),
    );
    body.regenerate = true;
    const outcome = await f.factory.video(f.owner, projectId, body, undefined, p.execution);
    expect(outcome.data.status).toBe("FAILED");
    expect(replies.every((reply) => reply.status === 200)).toBe(true);
    expect(replies.flatMap((reply) => reply.sent)).toEqual(["tts"]);
    expect(replies.at(-1)!.attempts).toEqual(["UNKNOWN"]);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(live);
  },
  30_000,
);

it.skipIf(!ffmpegOnPath()).each(["line", "unproved-reference"])(
  "refuses planned media before POST when the captured intent changes: %s",
  async (change) => {
    const { projectId, replies, fetcher } = await signedSidecar();
    const f = await fixture(undefined, { projectId, fetcher }, true, true),
      p = await preparedVideo(f);
    const changed = producer.prepareSceneLocations(p.canonical) as FilmRecord;
    const place = generationRows(changed.locations)[0]!;
    if (change === "line") generationRows(changed.shots)[0]!.line = "这是后来修改的另一句台词。";
    else Object.assign(place, producer.locationImageFields(changed, place, f.frame));
    await writeProject(f.filmsRoot, changed);
    const stored = (await readProject(f.filmsRoot, f.record.id))!;
    const prompt = producer.withStyleBible(
      producer.locationGenerationPrompt(stored, generationRows(stored.locations)[0]),
      String(stored.styleZh),
    );
    const made = await f.factory.still(f.owner, {
      seriesId: String(f.record.seriesId),
      prompt,
      references: [],
      aspectRatio: "16:9",
      execution: { executionId: p.prepared.executionId, stageId: p.prepared.stages[0]!.stageId },
    });
    expect(made.code).toBe("PROJECT_CHANGED");
    expect(made.path).toBe("");
    expect(f.imageCalls()).toBe(0);
    expect(
      f.fetcher.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith("/image-dispatch"),
      ),
    ).toHaveLength(0);
    expect(replies.flatMap((reply) => reply.sent)).toEqual([]);
    expect(replies.every((reply) => reply.attempts.length === 0)).toBe(true);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(stored);
  },
  30_000,
);

async function localSelectedFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  beforeProbe?: () => Promise<void>,
) {
  const configured = process.env.AIVORA_FFMPEG;
  const ffmpeg =
    configured ??
    (process.env.PATH ?? "")
      .split(delimiter)
      .map((root) => join(root, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))
      .find((path) => existsSync(path));
  if (!ffmpeg) throw Error("TEST_MEDIA_TOOLS_UNAVAILABLE");
  const tools = await verifiedQcTools(
    dirname(ffmpeg),
    resolve(
      "../../config",
      process.platform === "win32"
        ? "media-toolchain-lock.json"
        : "draft-media-toolchain-linux-dev-lock.json",
    ),
  );
  const execute = promisify(execFile);
  const run: QcRunner = async (binary, args, options) => {
    if (binary === tools.ffprobePath) await beforeProbe?.();
    return execute(binary, args, {
      encoding: "utf8",
      maxBuffer: options?.maxBuffer ?? 65536,
      timeout: options?.timeoutMs ?? 30000,
      signal: options?.signal,
    });
  };
  const path = join(dirname(f.frame), "selected.mp4");
  await run(tools.ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=128x72:r=25:d=0.64",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path,
  ]);
  const record = structuredClone(f.record);
  generationRows(generationRows(record.shots)[0]!.takes)[0]!.videoPath = path;
  await writeProject(f.filmsRoot, record);
  const stored = (await readProject(f.filmsRoot, f.record.id))!;
  f.useLocalMedia({
    filmsRoot: f.filmsRoot,
    storyFilmsRoot: f.storyRoot,
    tools,
    run,
    videoOwner: async () => false,
  });
  f.mediaDispatchLease.mockResolvedValue(null);
  return {
    path,
    stored,
    input: {
      ...f.input,
      mode: "pipeline" as const,
      expectedProjectHash: filmHistoryRecordHash(stored),
    },
  };
}
it.skipIf(!ffmpegOnPath())(
  "returns local NOT_NEEDED from real owned stream/SHA verification without account, slots, API or writes",
  async () => {
    const f = await fixture(),
      local = await localSelectedFixture(f);
    const made = await f.factory.prepare(f.owner, local.input);
    expect(made).toEqual({
      kind: "NOT_NEEDED",
      projectId: f.record.id,
      projectHash: local.input.expectedProjectHash,
      reason: "LOCAL_SELECTED_MEDIA",
      selected: [{ shotId: "shot-one", takeId: "old" }],
    });
    expect(f.mediaDispatchLease).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(local.stored);
  },
  30_000,
);
it.skipIf(!ffmpegOnPath())(
  "does not call an absent selected file reusable or turn it into an unconfirmed new paid slot",
  async () => {
    const f = await fixture(),
      local = await localSelectedFixture(f);
    await rm(local.path);
    await expect(f.factory.prepare(f.owner, local.input)).resolves.toEqual({
      kind: "FAILED",
      code: "SOURCE_UNVERIFIABLE",
    });
    expect(f.mediaDispatchLease).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(local.stored);
  },
  30_000,
);
it.skipIf(!ffmpegOnPath()).each(["owner", "canonical"] as const)(
  "rejects a late %s change during actual local stream verification without issuing an execution",
  async (change) => {
    const f = await fixture();
    let changed = false;
    const local = await localSelectedFixture(f, async () => {
      if (changed) return;
      changed = true;
      if (change === "owner") f.stop();
      else {
        const edited = (await readProject(f.filmsRoot, f.record.id))!;
        edited.title = "late creative edit";
        await writeProject(f.filmsRoot, edited);
      }
    });
    await expect(f.factory.prepare(f.owner, local.input)).resolves.toEqual({
      kind: "FAILED",
      code: change === "owner" ? "EXECUTION_UNAVAILABLE" : "PROJECT_CHANGED",
    });
    expect(changed).toBe(true);
    expect(f.mediaDispatchLease).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    const final = (await readProject(f.filmsRoot, f.record.id))!;
    if (change === "owner") expect(final).toEqual(local.stored);
    else expect(final.title).toBe("late creative edit");
  },
  30_000,
);

async function compiledFixedInputLedger(): Promise<FixedInputLedger> {
  const source = await readFile(resolve("src/film-generation-fixed-input.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(tmpdir(), `fixed-input-${sha(js).slice(0, 12)}.cjs`);
  await writeFile(file, js);
  return createRequire(file)(file).createFixedInputLedger() as FixedInputLedger;
}

function targetInputHashes(database: string): string[] {
  const script = [
    "import json, sqlite3, sys",
    "con = sqlite3.connect(sys.argv[1], timeout=5)",
    "rows = [row[0] for row in con.execute(",
    "'SELECT input_sha256 FROM prepared_generation_target ORDER BY rowid')]",
    "print(json.dumps(rows))",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script, database], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const rows = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(rows) || rows.some((row) => typeof row !== "string"))
    throw Error("INPUT_HASH_QUERY_INVALID");
  return rows as string[];
}

it.skipIf(!ffmpegOnPath())(
  "keeps an explicit fixed-input receipt from opening the accepted NOT_NEEDED path",
  async () => {
    const ledger = await compiledFixedInputLedger();
    const f = await fixture(undefined, undefined, false, false, { fixedInputs: ledger });
    const picked = join(f.root, "picked.png");
    await writeFile(picked, await readFile(f.frame));
    const imported = await ledger.importPickedFile({
      pickedPath: picked,
      accountSha256: "d".repeat(64),
      projectId: f.record.id,
      backendProjectId: String(f.record.backendProjectId),
      seriesId: String(f.record.seriesId),
      filmsRoot: f.filmsRoot,
      isAutomaticOutput: async () => false,
    });
    expect(imported.ok).toBe(true);
    const local = await localSelectedFixture(f);
    const made = await f.factory.prepare(f.owner, local.input);
    expect(made).toEqual({
      kind: "NOT_NEEDED",
      projectId: f.record.id,
      projectHash: local.input.expectedProjectHash,
      reason: "LOCAL_SELECTED_MEDIA",
      selected: [{ shotId: "shot-one", takeId: "old" }],
    });
    expect(f.mediaDispatchLease).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.imageCalls()).toBe(0);
    expect(f.registrations).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(local.stored);
  },
  30_000,
);

async function manualStill(f: Awaited<ReturnType<typeof fixture>>, ledger?: FixedInputLedger) {
  const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
  registerFilmLibraryHandlers(
    (channel, callback) => handlers.set(channel, callback),
    (event: boolean) => event,
    {
      filmsRoot: () => f.filmsRoot,
      storyFilmsRoot: () => f.storyRoot,
      mediaToken: async () => "native-manual-token",
      fetcher: f.fetcher,
      ...(ledger
        ? {
            noteManualStill: (seriesId: string, path: string) =>
              ledger.noteManualStill(f.filmsRoot, seriesId, path),
          }
        : {}),
      runFfmpeg: async () => undefined,
      pickDirectory: async () => null,
      copyFile: async () => undefined,
      reveal: () => undefined,
      open: async () => "",
    },
  );
  const before = await readFile(
    join(f.filmsRoot, String(f.record.seriesId), "episodes", f.record.id, "project.json"),
  );
  const made = (await handlers.get("film:still")!(
    true,
    f.record.seriesId,
    "用户明确手工出图",
    "16:9",
    [],
  )) as { path: string; fixedInputOfferId?: string };
  expect(made.path).not.toBe("");
  expect(await readFile(made.path)).toEqual(await readFile(f.frame));
  expect(
    await readFile(
      join(f.filmsRoot, String(f.record.seriesId), "episodes", f.record.id, "project.json"),
    ),
  ).toEqual(before);
  return made;
}

it.skipIf(!ffmpegOnPath())(
  "accepts a compiled fixed-input confirm for a real manual still and still refuses the unconfirmed file",
  async () => {
    const unconfirmed = await fixture(undefined, undefined, true);
    const bare = await manualStill(unconfirmed);
    expect(bare.fixedInputOfferId).toBeUndefined();
    const updated = structuredClone(unconfirmed.record);
    generationRows(updated.shots)[0]!.poster = bare.path;
    await writeProject(unconfirmed.filmsRoot, updated);
    const raw = (await readProject(unconfirmed.filmsRoot, unconfirmed.record.id))!;
    await expect(
      unconfirmed.factory.prepare(unconfirmed.owner, {
        ...unconfirmed.input,
        expectedProjectHash: filmHistoryRecordHash(raw),
      }),
    ).resolves.toEqual({ kind: "FAILED", code: "UNSUPPORTED_SCOPE" });
    expect(unconfirmed.registrations).toHaveLength(0);
    expect(unconfirmed.imageCalls()).toBe(1);
    expect(unconfirmed.submissions).toHaveLength(0);
    expect(await readProject(unconfirmed.filmsRoot, unconfirmed.record.id)).toEqual(raw);

    const confirmedLedger = await compiledFixedInputLedger();
    const f = await fixture(undefined, undefined, true, false, { fixedInputs: confirmedLedger });
    const made = await manualStill(f, confirmedLedger);
    if (!made.fixedInputOfferId) throw Error("EXPECTED_OFFER");
    expect(made.fixedInputOfferId).toMatch(/^fio_/);
    const saved = await readFile(
      join(f.filmsRoot, String(f.record.seriesId), "episodes", f.record.id, "project.json"),
    );
    const confirmed = await confirmedLedger.confirmOffer({
      offerId: made.fixedInputOfferId,
      accountSha256: "d".repeat(64),
      projectId: f.record.id,
      backendProjectId: String(f.record.backendProjectId),
      seriesId: String(f.record.seriesId),
      filmsRoot: f.filmsRoot,
      isAutomaticOutput: async () => false,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw Error("EXPECTED_CONFIRM");
    expect(
      await readFile(
        join(f.filmsRoot, String(f.record.seriesId), "episodes", f.record.id, "project.json"),
      ),
    ).toEqual(saved);
    const next = structuredClone(f.record);
    generationRows(next.shots)[0]!.poster = confirmed.path;
    await writeProject(f.filmsRoot, next);
    const stored = (await readProject(f.filmsRoot, f.record.id))!;
    const prepared = await f.factory.prepare(f.owner, {
      ...f.input,
      expectedProjectHash: filmHistoryRecordHash(stored),
    });
    expect(prepared.kind).toBe("PREPARED");
    if (prepared.kind !== "PREPARED") throw Error("EXPECTED_PREPARED");
    expect(prepared.stages).toEqual([]);
    expect(f.registrations).toHaveLength(1);
    expect(JSON.stringify(f.registrations)).not.toContain(made.fixedInputOfferId);
    expect(f.imageCalls()).toBe(1);
    expect(f.submissions).toHaveLength(0);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(stored);
  },
  30_000,
);

it.skipIf(!ffmpegOnPath())(
  "does not let a fixed-input receipt downgrade a known automatic output",
  async () => {
    const lineageItems: unknown[] = [];
    const ledger = await compiledFixedInputLedger();
    const f = await fixture(undefined, undefined, true, false, {
      fixedInputs: ledger,
      lineageItems,
    });
    const made = await manualStill(f, ledger);
    if (!made.fixedInputOfferId) throw Error("EXPECTED_OFFER");
    const confirmed = await ledger.confirmOffer({
      offerId: made.fixedInputOfferId,
      accountSha256: "d".repeat(64),
      projectId: f.record.id,
      backendProjectId: String(f.record.backendProjectId),
      seriesId: String(f.record.seriesId),
      filmsRoot: f.filmsRoot,
      isAutomaticOutput: async () => false,
    });
    expect(confirmed.ok).toBe(true);
    const next = structuredClone(f.record);
    generationRows(next.shots)[0]!.poster = made.path;
    await writeProject(f.filmsRoot, next);
    const raw = (await readProject(f.filmsRoot, f.record.id))!;
    lineageItems.push({
      output_sha256: createHash("sha256")
        .update(await readFile(made.path))
        .digest("hex"),
      stage: {
        kind: "shot-frame",
        target_id: "shot-one",
        origin: {
          imageModel: "grok-imagine-image-2.0",
          aspectRatio: "16:9",
          prompt: "not-the-live-frame-prompt",
          previousPoster: "",
          references: [],
        },
      },
    });
    await expect(
      f.factory.prepare(f.owner, {
        ...f.input,
        expectedProjectHash: filmHistoryRecordHash(raw),
      }),
    ).resolves.toEqual({ kind: "FAILED", code: "UNSUPPORTED_SCOPE" });
    expect(f.registrations).toHaveLength(0);
    expect(f.submissions).toHaveLength(0);
    expect(f.imageCalls()).toBe(1);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(raw);
  },
  30_000,
);

async function readableAutomaticFrame() {
  const { projectId, replies, fetcher, root } = await signedSidecar();
  const f = await fixture(undefined, { projectId, fetcher, uniqueImage: true }, true);
  const first = await f.factory.prepare(f.owner, f.input);
  expect(first.kind).toBe("PREPARED");
  if (first.kind !== "PREPARED") throw Error("EXPECTED_PREPARED");
  const stage = first.stages.find((item) => item.kind === "shot-frame");
  if (!stage) throw Error("EXPECTED_FRAME");
  const shot = generationRows(f.record.shots)[0]!;
  const frame = producer.shotStillInput(
    f.record,
    shot,
    producer.keyframePrompt(shot, f.record),
  ) as { prompt: string; references: string[] };
  const made = await f.factory.still(f.owner, {
    seriesId: String(f.record.seriesId),
    prompt: frame.prompt,
    references: frame.references,
    aspectRatio: "16:9",
    execution: { executionId: first.executionId, stageId: stage.stageId },
  });
  expect(made.code).toBeUndefined();
  expect(made.path).not.toBe("");
  const updated = structuredClone(f.record);
  generationRows(updated.shots)[0]!.poster = made.path;
  await writeProject(f.filmsRoot, updated);
  const raw = (await readProject(f.filmsRoot, f.record.id))!;
  await f.factory.retire(f.owner, { executionId: first.executionId });
  return { f, replies, first, raw, root };
}

it.skipIf(!ffmpegOnPath())(
  "restores a readable automatic frame to the same original input hash on a new execution",
  async () => {
    const { f, replies, first, raw, root } = await readableAutomaticFrame();
    const again = await f.factory.prepare(f.owner, {
      ...f.input,
      expectedProjectHash: filmHistoryRecordHash(raw),
    });
    expect(again.kind, JSON.stringify(again)).toBe("PREPARED");
    if (again.kind !== "PREPARED") throw Error("EXPECTED_RESTORED_PREPARED");
    expect(again.executionId).not.toBe(first.executionId);
    expect(again.stages).toEqual([]);
    const inputHashes = targetInputHashes(join(root, "workspace.db"));
    expect(inputHashes).toHaveLength(2);
    expect(new Set(inputHashes).size).toBe(1);
    expect(f.imageCalls()).toBe(1);
    expect(replies.flatMap((reply) => reply.sent)).toEqual([]);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(raw);
  },
  30_000,
);

it.skipIf(!ffmpegOnPath()).each(["creative", "account", "bytes"] as const)(
  "never reclassifies old automatic output as a fixed new input after %s changes",
  async (change) => {
    const { f, replies, raw, root } = await readableAutomaticFrame();
    const updated = structuredClone(raw);
    if (change === "creative") generationRows(updated.shots)[0]!.picture += " real changed intent";
    if (change === "account") f.useOtherAccount();
    if (change === "bytes") {
      const path = String(generationRows(updated.shots)[0]!.poster);
      await writeFile(path, Buffer.concat([await readFile(path), Buffer.from("replaced bytes")]));
    }
    await writeProject(f.filmsRoot, updated);
    const before = (await readProject(f.filmsRoot, f.record.id))!;
    const count = targetInputHashes(join(root, "workspace.db")).length;
    const result = await f.factory.prepare(f.owner, {
      ...f.input,
      expectedProjectHash: filmHistoryRecordHash(before),
    });
    expect(result).toEqual({ kind: "FAILED", code: "UNSUPPORTED_SCOPE" });
    expect(targetInputHashes(join(root, "workspace.db"))).toHaveLength(count);
    expect(f.imageCalls()).toBe(1);
    expect(replies.flatMap((reply) => reply.sent)).toEqual([]);
    expect(await readProject(f.filmsRoot, f.record.id)).toEqual(before);
  },
  30_000,
);
