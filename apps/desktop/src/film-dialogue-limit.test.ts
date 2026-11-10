import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { writeProject, readProject, type FilmRecord } from "./film-library";
import {
  createDialogueLimitRegistry,
  dialogueRequestSignature,
  parseStoryFilmLocalScope,
} from "./film-dialogue-limit";
import { createFilmDialogueSplits } from "./film-dialogue-split";
import { filmHistoryRecordHash } from "./film-history";
import {
  dialogueEvidenceContext,
  planDialogueSplit,
} from "@aijian/contracts/film-dialogue-split-plan";
import { registerStoryFilmHandlers } from "./story-film-ipc";
import type { StoryFilmCreateInput } from "./story-film-client";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function publicReply(result: { data: { dialogue_limit: Record<string, unknown> } }) {
  const copy = structuredClone(result);
  delete copy.data.dialogue_limit.request_sha256;
  delete copy.data.dialogue_limit.raw_audio_sha256;
  return copy;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "dialogue-limit-"));
  roots.push(root);
  const id = "film_aaaaaaaaaaaaaaaa",
    series = "film_bbbbbbbbbbbbbbbb",
    backend = `prj_${"a".repeat(32)}`;
  await mkdir(join(root, series, "episodes", id), { recursive: true });
  const scope = { projectId: id, shotId: "shot", takeId: "attempt", inputFingerprint: "" };
  const line = "慢一点。再慢一点。";
  const record = {
    id,
    seriesId: series,
    backendProjectId: backend,
    title: "原稿",
    savedAt: "a",
    draft: false,
    narrationVoiceId: "eve",
    characters: [
      {
        id: "person",
        name: "甲",
        voiceId: "orion",
        identity: "原角色",
        gender: "女",
        portraits: [],
      },
    ],
    scenes: [{ id: "scene", no: 1 }],
    jobs: [],
    shots: [
      {
        id: "shot",
        sceneId: "scene",
        no: 1,
        line,
        lines: [{ speaker: "", text: line }],
        characters: [],
        seconds: 3,
        selectedTakeId: "attempt",
        takes: [{ id: "attempt", shotId: "shot", status: "running" }],
      },
    ],
  } as unknown as FilmRecord;
  let stored = await writeProject(root, record);
  scope.inputFingerprint = filmHistoryRecordHash(
    dialogueEvidenceContext(stored, scope.shotId, scope.takeId),
  );
  const body: StoryFilmCreateInput = {
    scene_label: "场",
    narration: line,
    provider: "stub",
    confirmed: true,
    video_model: "grok-imagine-video-1.5",
    voice_id: "eve",
    shots: [
      {
        narration: line,
        prompt: "画面",
        duration_seconds: 3,
        voice_id: "eve",
        lines: [{ speaker: "", text: line, voice_id: "eve" }],
      },
    ],
  };
  const fact = {
    schema_version: 1,
    speech_window: 1,
    required_seconds: 16,
    max_seconds: 15,
    shot_index: 1,
    request_sha256: dialogueRequestSignature(body),
    target_video_submitted: false,
    raw_audio_saved: true,
    raw_audio_sha256: "a".repeat(64),
  };
  const result = {
    data: {
      status: "FAILED",
      user_message: { code: "DIALOGUE_VIDEO_LIMIT", text: "对白超过上限" },
      dialogue_limit: fact,
    },
    request_id: "real-reply",
  };
  const registry = createDialogueLimitRegistry({ filmsRoot: root });
  const settle = async () => {
    const current = structuredClone(stored);
    const shot = (current.shots as Record<string, unknown>[])[0]!;
    shot.selectedTakeId = "";
    (shot.takes as Record<string, unknown>[])[0]!.status = "failed";
    stored = await writeProject(root, current);
    return stored;
  };
  return { root, id, scope, backend, body, fact, result, registry, record: stored, settle };
}
it("mints only from exact real reply and applies a slow short-text split through canonical preview, history and CAS", async () => {
  const f = await fixture();
  expect(
    planDialogueSplit({
      lines: [{ speaker: "", text: f.body.narration }],
      maxVideoSeconds: 15,
      versions: 2,
    }),
  ).toMatchObject({ kind: "UNSUPPORTED", code: "WITHIN_CAP" });
  const before = await readProject(f.root, f.id);
  const id = await f.registry.mint(11, f.backend, f.body, f.scope, f.result);
  expect(id).toMatch(/^dle_[a-f0-9]{32}$/);
  expect(await readProject(f.root, f.id)).toEqual(before);
  const saved = await f.settle();
  const splits = createFilmDialogueSplits({
    filmsRoot: f.root,
    limitEvidence: f.registry.verify,
    consumeLimitEvidence: f.registry.consume,
  });
  const input = {
    projectId: f.id,
    shotId: f.scope.shotId,
    versions: 2,
    expectedHash: filmHistoryRecordHash(saved),
    limitEvidenceId: id!,
  };
  expect(await splits.prepare(input, 12)).toMatchObject({
    kind: "FAILED",
    code: "PROJECT_CHANGED",
  });
  const ready = await splits.prepare(input, 11);
  expect(ready.kind).toBe("READY");
  if (ready.kind !== "READY") throw Error(ready.code);
  expect(ready.plan.parts.map((p) => p.text).join("")).toBe(f.body.narration);
  expect(ready.plan.videoCount).toBe(4);
  expect(JSON.stringify(ready)).not.toContain(f.fact.raw_audio_sha256);
  const applied = await splits.apply({ ...input, reviewFingerprint: ready.reviewFingerprint }, 11);
  expect(applied.kind).toBe("APPLIED");
  if (applied.kind !== "APPLIED") throw Error(applied.code);
  expect(applied.childIds).toHaveLength(2);
  expect(f.registry.verify(11, id!, saved, f.scope.shotId)).toBeNull();
  expect(JSON.stringify(applied.project)).not.toContain(id!);
  expect(JSON.stringify(applied.backup)).not.toContain(id!);
  const historyFiles = await import("node:fs/promises")
    .then((fs) => fs.readdir(join(f.root, "film_bbbbbbbbbbbbbbbb", "episodes", f.id, "history")))
    .catch(() => []);
  expect(historyFiles.length).toBeGreaterThan(0);
  for (const name of historyFiles) {
    const bytes = await import("node:fs/promises").then((fs) =>
      fs.readFile(join(f.root, "film_bbbbbbbbbbbbbbbb", "episodes", f.id, "history", name), "utf8"),
    );
    expect(bytes).not.toContain(id!);
  }
});
it.each([
  "signature",
  "index",
  "post-video",
  "raw",
  "model-cap",
  "notice",
  "target",
  "backend",
  "duplicate",
])("refuses inconsistent %s without minting", async (mode) => {
  const f = await fixture(),
    body = structuredClone(f.body),
    scope = { ...f.scope },
    result = structuredClone(f.result);
  if (mode === "signature") result.data.dialogue_limit.request_sha256 = "b".repeat(64);
  if (mode === "index") result.data.dialogue_limit.shot_index = 2;
  if (mode === "post-video")
    Object.assign(result.data.dialogue_limit, { target_video_submitted: true });
  if (mode === "raw") result.data.dialogue_limit.raw_audio_sha256 = "bad";
  if (mode === "model-cap") result.data.dialogue_limit.max_seconds = 10;
  if (mode === "notice") result.data.user_message.code = "VIDEO_TOO_SHORT";
  if (mode === "target") scope.takeId = "foreign";
  if (mode === "duplicate") {
    const current = structuredClone(f.record);
    (current.shots as unknown[]).push((current.shots as unknown[])[0]);
    await writeProject(f.root, current);
  }
  expect(
    await f.registry.mint(
      1,
      mode === "backend" ? `prj_${"b".repeat(32)}` : f.backend,
      body,
      scope,
      result,
    ),
  ).toBeNull();
});
it("binds source creative input, failed target, selection, owner and session lifetime without persisting authority", async () => {
  const f = await fixture(),
    id = (await f.registry.mint(1, f.backend, f.body, f.scope, f.result))!;
  expect(f.registry.verify(1, id, f.record, f.scope.shotId)).toBeNull();
  const failed = await f.settle();
  expect(f.registry.verify(1, id, failed, f.scope.shotId)).toMatchObject({
    requiredSeconds: 16,
    maxSeconds: 15,
    rawAudioSaved: true,
  });
  expect(
    f.registry.verify(1, id, { ...failed, savedAt: "ordinary-save" }, f.scope.shotId),
  ).toMatchObject({ requiredSeconds: 16 });
  const edited = structuredClone(failed);
  (edited.shots as Record<string, unknown>[])[0]!.line = "改了";
  expect(f.registry.verify(1, id, edited, f.scope.shotId)).toBeNull();
  const selected = structuredClone(failed);
  (selected.shots as Record<string, unknown>[])[0]!.selectedTakeId = "old";
  expect(f.registry.verify(1, id, selected, f.scope.shotId)).toBeNull();
  expect(f.registry.verify(2, id, failed, f.scope.shotId)).toBeNull();
  expect(
    createDialogueLimitRegistry({ filmsRoot: f.root }).verify(1, id, failed, f.scope.shotId),
  ).toBeNull();
  f.registry.disposeOwner(1);
  expect(f.registry.verify(1, id, failed, f.scope.shotId)).toBeNull();
});
it("legacy HTTP body remains exact; optional scope is IPC-only, and late cancelled canonical target cannot mint", async () => {
  const f = await fixture(),
    handlers = new Map<string, (event: number, ...args: unknown[]) => Promise<unknown>>();
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    expect(JSON.parse(String(options?.body))).not.toHaveProperty("projectId");
    return new Response(JSON.stringify(f.result));
  });
  const mint = vi.fn(
    async (
      owner: number,
      backend: string,
      body: StoryFilmCreateInput,
      scope: typeof f.scope,
      result: unknown,
    ) => {
      entered();
      await hold;
      return f.registry.mint(owner, backend, body, scope, result);
    },
  );
  registerStoryFilmHandlers(
    (c, h) => handlers.set(c, h),
    (event: number) => event === 1,
    () => ({ origin: "http://127.0.0.1:5555", token: "s".repeat(43) }),
    async () => null,
    fetcher as typeof fetch,
    undefined,
    undefined,
    mint,
  );
  const handler = handlers.get("story-film:create")!;
  expect(await handler(1, f.backend, f.body)).toEqual(publicReply(f.result));
  expect(mint).not.toHaveBeenCalled();
  const pending = handler(1, f.backend, f.body, f.scope);
  try {
    await started;
    await f.settle();
    release();
    expect(await pending).toEqual(publicReply(f.result));
  } finally {
    release();
    await pending;
  }
  expect(fetcher).toHaveBeenCalledTimes(2);
  await expect(handler(2, f.backend, f.body, f.scope)).rejects.toThrow("not authorized");
  await expect(handler(1, f.backend, f.body, { ...f.scope, path: "/private" })).rejects.toThrow(
    "local scope",
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("service request digest is UTF-8 ordered arrays, not object order or local IDs", () => {
  const body: StoryFilmCreateInput = {
    provider: "stub",
    confirmed: true,
    scene_label: "场",
    narration: "你好。",
    voice_id: "eve",
  };
  const expected = createHash("sha256")
    .update(JSON.stringify(["grok-imagine-video-1.5", "eve", "", "你好。", [], "grok-tts"]))
    .digest("hex");
  expect(dialogueRequestSignature(body)).toBe(expected);
  expect(
    parseStoryFilmLocalScope({
      projectId: "film_aaaaaaaaaaaaaaaa",
      shotId: "a",
      takeId: "b",
      inputFingerprint: "a".repeat(64),
    }),
  ).toEqual({
    projectId: "film_aaaaaaaaaaaaaaaa",
    shotId: "a",
    takeId: "b",
    inputFingerprint: "a".repeat(64),
  });
});
it("runs the real generation queue persist → IPC reply → failure reducer → save → native review without serializing the session receipt", async () => {
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const load = async (file: string) =>
    (await import(pathToFileURL(resolve("../studio-web/src", file)).href)) as Record<
      string,
      unknown
    >;
  const project = await load("aivora/film/project.ts"),
    generation = await load("aivora/pro/actions/generation-run.ts"),
    acceptance = await load("aivora/pro/still-acceptance.ts"),
    queues = await load("aivora/film/generation-queue.ts"),
    session = await load("aivora/pro/actions/dialogue-limit-session.ts"),
    actions = await load("aivora/pro/actions/dialogue-split.ts");
  const f = await fixture();
  const base = (project.sampleFilm as () => FilmRecord)();
  Object.assign(base, {
    id: f.id,
    seriesId: "film_bbbbbbbbbbbbbbbb",
    backendProjectId: f.backend,
    narrationVoiceId: "eve",
    draft: false,
    jobs: [],
  });
  const shot = (base.shots as Record<string, unknown>[])[0]!;
  Object.assign(shot, {
    id: "shot",
    line: f.body.narration,
    lines: [{ speaker: "", text: f.body.narration }],
    speaker: "",
    characters: [],
    takes: [],
    selectedTakeId: "",
    seconds: 3,
    poster: "",
  });
  base.shots = [shot];
  const { writeFile } = await import("node:fs/promises");
  const frame = join(f.root, "film_bbbbbbbbbbbbbbbb", "episodes", f.id, "frame.png");
  await writeFile(frame, Buffer.from("png-fixture"));
  shot.poster = frame;
  const checklist = (
    acceptance.stillChecklist as (
      film: FilmRecord,
      shot: Record<string, unknown>,
    ) => { id: string }[]
  )(base, shot);
  const adopted = (
    acceptance.saveStillReview as (
      film: FilmRecord,
      shotId: string,
      verdicts: Record<string, "match">,
      at: string,
    ) => { film: FilmRecord }
  )(
    base,
    "shot",
    Object.fromEntries(checklist.map((item) => [item.id, "match" as const])),
    "2026-11-10T00:00:00.000Z",
  ).film;
  const queue = (
    queues.prepareVideoQueue as (
      film: FilmRecord,
      shots: unknown[],
      versions: number,
      draft: boolean,
    ) => { film: FilmRecord }
  )(adopted, [(adopted.shots as unknown[])[0]], 1, false);
  let live = queue.film;
  const events: string[] = [];
  const handlers = new Map<string, (event: number, ...args: unknown[]) => Promise<unknown>>();
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    events.push("http");
    const body = JSON.parse(String(options?.body)) as StoryFilmCreateInput;
    return new Response(
      JSON.stringify({
        ...f.result,
        data: {
          ...f.result.data,
          dialogue_limit: { ...f.fact, request_sha256: dialogueRequestSignature(body) },
        },
      }),
    );
  });
  registerStoryFilmHandlers(
    (c, h) => handlers.set(c, h),
    (owner: number) => owner === 7,
    () => ({ origin: "http://127.0.0.1:5555", token: "s".repeat(43) }),
    async () => null,
    fetcher as typeof fetch,
    undefined,
    undefined,
    (owner, backend, body, scope, result) => f.registry.mint(owner, backend, body, scope, result),
  );
  const run = generation.runPreparedGeneration as (
    queue: unknown,
    host: Record<string, unknown>,
  ) => Promise<void>;
  await run(queue, {
    current: () => live,
    valid: () => true,
    stopped: () => false,
    paused: () => false,
    cancelled: () => false,
    apply: async (next: FilmRecord) => {
      live = next;
    },
    persist: async (next: FilmRecord) => {
      await writeProject(f.root, next);
      events.push(
        `saved:${String(((next.shots as Record<string, unknown>[])[0]!.takes as Record<string, unknown>[])[0]?.status)}`,
      );
    },
    request: (body: StoryFilmCreateInput, scope: typeof f.scope) =>
      handlers.get("story-film:create")!(7, f.backend, body, scope),
    frame: async (_film: unknown, current: unknown) => current,
    continuity: async (_film: unknown, current: unknown) => current,
    notice: () => undefined,
    completed: () => undefined,
  });
  expect(events.indexOf("saved:running")).toBeLessThan(events.indexOf("http"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const failed = (live.shots as Record<string, unknown>[])[0]!;
  expect((failed.takes as Record<string, unknown>[])[0]!.status).toBe("failed");
  const evidence = (
    session.dialogueLimitEvidence as (film: FilmRecord, shotId: string) => string | undefined
  )(live, "shot");
  expect(evidence).toMatch(/^dle_[a-f0-9]{32}$/);
  const stored = await writeProject(f.root, live);
  expect(JSON.stringify(stored)).not.toContain(evidence!);
  const split = createFilmDialogueSplits({ filmsRoot: f.root, limitEvidence: f.registry.verify });
  const input = (
    actions.nativeDialogueSplitInput as (
      film: FilmRecord,
      shotId: string,
      hash: string,
      versions: number,
    ) => unknown
  )(live, "shot", filmHistoryRecordHash(stored), 1);
  const ready = await split.prepare(input, 7);
  expect(ready).toMatchObject({
    kind: "READY",
    plan: { timing: "estimate", newShotCount: 2, videoCount: 2 },
  });
});
it.each(["picture", "voice", "selection", "cancel", "traits", "reference"])(
  "does not mint when %s changes while the real reply's evidence verification is delayed",
  async (change) => {
    const f = await fixture();
    let release!: () => void, entered!: () => void;
    const hold = new Promise<void>((r) => (release = r)),
      started = new Promise<void>((r) => (entered = r));
    const handlers = new Map<string, (event: number, ...args: unknown[]) => Promise<unknown>>();
    const fetcher = vi.fn(async () => new Response(JSON.stringify(f.result)));
    registerStoryFilmHandlers(
      (c, h) => handlers.set(c, h),
      (owner: number) => owner === 1,
      () => ({ origin: "http://127.0.0.1:5555", token: "s".repeat(43) }),
      async () => null,
      fetcher as typeof fetch,
      undefined,
      undefined,
      async (owner, backend, body, scope, result) => {
        entered();
        await hold;
        return f.registry.mint(owner, backend, body, scope, result);
      },
    );
    const pending = handlers.get("story-film:create")!(1, f.backend, f.body, f.scope);
    try {
      await started;
      expect(fetcher).toHaveBeenCalledTimes(1);
      const current = structuredClone(f.record),
        shot = (current.shots as Record<string, unknown>[])[0]!;
      if (change === "picture") shot.picture = "新的画面";
      if (change === "traits") (current.characters as Record<string, unknown>[])[0]!.gender = "男";
      if (change === "reference") shot.poster = "/different-reference.png";
      if (change === "voice") current.narrationVoiceId = "orion";
      if (change === "selection") shot.selectedTakeId = "different";
      if (change === "cancel") (shot.takes as Record<string, unknown>[])[0]!.status = "failed";
      const written = await writeProject(f.root, current);
      release();
      expect(await pending).toEqual(publicReply(f.result));
      expect(await readProject(f.root, f.id)).toEqual(written);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await pending;
    }
  },
);
it("verifies nullable single-target index and refuses ambiguous multi-shot scopes, even identical text", async () => {
  const f = await fixture(),
    body = { ...f.body, shots: undefined };
  const result = structuredClone(f.result);
  Object.assign(result.data.dialogue_limit, {
    shot_index: null,
    request_sha256: dialogueRequestSignature(body),
  });
  expect(await f.registry.mint(1, f.backend, body, f.scope, result)).toMatch(/^dle_/);
  const multi = { ...f.body, shots: [f.body.shots![0]!, f.body.shots![0]!] };
  expect(await f.registry.mint(1, f.backend, multi, f.scope, f.result)).toBeNull();
});
it("expires transient receipts and never turns raw saved=false into a claim that audio was kept", async () => {
  const f = await fixture();
  let now = 1;
  const registry = createDialogueLimitRegistry({ filmsRoot: f.root, now: () => now });
  const result = structuredClone(f.result);
  Object.assign(result.data.dialogue_limit, { raw_audio_saved: false, raw_audio_sha256: null });
  const id = (await registry.mint(1, f.backend, f.body, f.scope, result))!,
    failed = await f.settle();
  expect(registry.verify(1, id, failed, f.scope.shotId)).toMatchObject({ rawAudioSaved: false });
  now += 30 * 60_000;
  expect(registry.verify(1, id, failed, f.scope.shotId)).toBeNull();
});
it("navigation/owner disposal during an actual canonical read cannot resurrect a late document receipt", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const registry = createDialogueLimitRegistry({
    filmsRoot: f.root,
    read: async (root, id) => {
      const actual = await readProject(root, id);
      entered();
      await hold;
      return actual;
    },
  });
  const pending = registry.mint(1, f.backend, f.body, f.scope, f.result);
  try {
    await started;
    registry.disposeOwner(1);
    release();
    expect(await pending).toBeNull();
  } finally {
    release();
    await pending;
  }
  // A genuinely new request by the current document can still mint after disposal.
  const current = await registry.mint(1, f.backend, f.body, f.scope, f.result);
  expect(current).toMatch(/^dle_/);
});
it("captures the document epoch before the HTTP wait, so a late old document reply never starts minting", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const handlers = new Map<string, (event: number, ...args: unknown[]) => Promise<unknown>>(),
    mint = vi.fn(f.registry.mint);
  const fetcher = vi.fn(async () => {
    entered();
    await hold;
    return new Response(JSON.stringify(f.result));
  });
  registerStoryFilmHandlers(
    (c, h) => handlers.set(c, h),
    (owner: number) => owner === 1,
    () => ({ origin: "http://127.0.0.1:5555", token: "s".repeat(43) }),
    async () => null,
    fetcher as typeof fetch,
    undefined,
    undefined,
    mint,
    (owner) => f.registry.guardOwner(owner),
  );
  const pending = handlers.get("story-film:create")!(1, f.backend, f.body, f.scope);
  try {
    await started;
    f.registry.disposeOwner(1);
    release();
    expect(await pending).toEqual(publicReply(f.result));
  } finally {
    release();
    await pending;
  }
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(mint).not.toHaveBeenCalled();
});
