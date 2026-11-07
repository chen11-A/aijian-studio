import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import type { CanonicalGenerationProducer } from "./film-generation-compiler";
import { createNativeFilmGenerationExecutions } from "./film-generation-execution";
import { readProject, writeProject, type FilmRecord } from "./film-library";
import { filmHistoryRecordHash } from "./film-history";
import { generationRows } from "./film-generation-plan";
import { parseStoryFilmCreate } from "./story-film-client";
import { ffmpegOnPath, ffmpegSkipReason } from "./test-ffmpeg";
let producer: CanonicalGenerationProducer, compiledRoot: string;
const roots: string[] = [],
  releaseAll: (() => void)[] = [],
  pendingAll: Promise<unknown>[] = [];
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
  for (const release of releaseAll.splice(0)) release();
  await Promise.allSettled(pendingAll.splice(0));
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const sha = (raw: string) => createHash("sha256").update(raw).digest("hex");
async function fixture(
  privateFailure?: string,
  real?: { projectId: string; fetcher: typeof fetch },
  frameStage = false,
) {
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
  await writeProject(filmsRoot, record);
  let active = true;
  const owner = { id: 4, current: () => active },
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
      return Response.json({ data: [{ b64_json: (await readFile(frame)).toString("base64") }] });
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
    if (path.endsWith("/lineages")) return Response.json({ items: [] });
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
  const factory = createNativeFilmGenerationExecutions({
    filmsRoot: () => filmsRoot,
    storyFilmsRoot: () => storyRoot,
    session: () => session,
    mediaDispatchLease: async () => ({ account, current: () => active }),
    storySourceOwner: async () => false,
    fetcher,
    producer: async () => producer,
  });
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
    frame,
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
async function preparedVideo(f: Awaited<ReturnType<typeof fixture>>, versions: 1 | 2 = 1) {
  const prepared = await f.factory.prepare(f.owner, {
    ...f.input,
    targets: [{ shotId: "shot-one", versions }],
  });
  expect(prepared.kind, "code" in prepared ? prepared.code : "").toBe("PREPARED");
  if (prepared.kind !== "PREPARED") throw Error(prepared.code);
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

it("rejects unsupported planned-image, cache-eligible and pipeline scopes before private registration", async () => {
  for (const kind of ["image", "cache", "pipeline"] as const) {
    const f = await fixture();
    const changed = structuredClone(f.record),
      shot = generationRows(changed.shots)[0]!;
    if (kind === "image") {
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

it.skipIf(!ffmpegOnPath()).each([false, true])(
  `crosses actual Python signed routes and original consumer with fixed frame stage=%s (${ffmpegSkipReason})`,
  async (frameStage) => {
    const root = await mkdtemp(join(tmpdir(), "native-prepared-sidecar-"));
    roots.push(root);
    const repositoryRoot = resolve("../..");
    type Reply = {
      projectId: string;
      status: number;
      body: unknown;
      sent: string[];
      attempts: string[];
    };
    const request = (command: unknown): Reply => {
      const response = spawnSync(
        "uv",
        ["run", "python", "services/api/tests/prepared_native_test_sidecar.py", root],
        {
          cwd: repositoryRoot,
          input: JSON.stringify(command),
          encoding: "utf8",
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
        },
      );
      expect(response.status, response.stderr).toBe(0);
      return JSON.parse(response.stdout) as Reply;
    };
    const { projectId } = request({ kind: "init" });
    const replies: Reply[] = [];
    const realFetch: typeof fetch = async (url, init) => {
      const reply = request({
        kind: "request",
        path: new URL(String(url)).pathname,
        body: String(init?.body),
        headers: Object.fromEntries(new Headers(init?.headers)),
      });
      replies.push(reply);
      return Response.json(reply.body, { status: reply.status });
    };
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
