import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_MEDIA_REVIEW_CHANNELS,
  localReviewCommand,
  localReviewOperation,
  localReviewPage,
  localReviewTarget,
  type LocalMediaReviewCommand,
  type LocalMediaReviewGateway,
  type LocalMediaReviewOperation,
  type LocalMediaReviewTarget,
} from "@aijian/contracts/local-media-review";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import { createLocalApiClient } from "./api-client";
import { registerLocalMediaReviewHandlers } from "./local-media-review-ipc";

const p = `prj_${"1".repeat(32)}`,
  e = `ep_${"2".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000009";
const operationId = "ABCD0000-0000-4000-8000-000000000001";
const sha = (v: unknown) =>
  `sha256:${createHash("sha256").update(impactCanonical(v)).digest("hex")}`;
function fixture(kind: "AUDIO" | "LITERAL_SUBTITLE" = "AUDIO") {
  const audio = {
    segment_id: "seg_bgm",
    track_kind: "BGM" as const,
    media: {
      asset_id: `asset_${"3".repeat(32)}`,
      asset_version_id: `asv_${"4".repeat(32)}`,
      sha256: "5".repeat(64),
    },
    start_frame: 0,
    end_frame: 75,
    source_in_sample: 0,
    script_version_id: null,
    script_block_id: null,
    speaker_id: null,
    delivery: null,
  };
  const subtitle = {
    segment_id: "seg_literal",
    start_frame: 25,
    end_frame: 75,
    text: "本地文字",
    render_profile: "noto-cjk-sc-bottom-v1" as const,
  };
  const snapshot: LocalMediaReviewTarget["snapshot"] = {
    project_id: p,
    episode_id: e,
    assembly_version_id: `ver_${"6".repeat(32)}`,
    assembly_content_hash: `sha256:${"7".repeat(64)}`,
    assembly_head_revision: 3,
    segment_kind: kind,
    segment_id: kind === "AUDIO" ? audio.segment_id : subtitle.segment_id,
    segment_content_hash: sha(kind === "AUDIO" ? audio : subtitle),
    sequence_timebase: { frame_rate: { num: 25, den: 1 }, timecode_mode: "NON_DROP_FRAME" },
    total_frames: 100,
    canvas_width: 1920,
    canvas_height: 1080,
    audio_segment: kind === "AUDIO" ? audio : null,
    subtitle_segment: kind === "LITERAL_SUBTITLE" ? subtitle : null,
    media_original:
      kind === "AUDIO"
        ? {
            ...audio.media,
            byte_size: 1200,
            mime_type: "audio/wav",
            filename: "owned.wav",
            origin: "LOCAL_IMPORT",
          }
        : null,
    script_source: null,
    script_provenance: null,
  };
  const target = { snapshot, snapshot_hash: sha(snapshot) };
  const command: LocalMediaReviewCommand = {
    operation_id: operationId,
    payload: {
      input: {
        schema_version: "1.0.0",
        project_id: p,
        episode_id: e,
        assembly_version_id: snapshot.assembly_version_id,
        assembly_content_hash: snapshot.assembly_content_hash,
        assembly_head_revision: snapshot.assembly_head_revision,
        segment_kind: kind,
        segment_id: snapshot.segment_id,
        segment_content_hash: snapshot.segment_content_hash,
        target_snapshot_hash: target.snapshot_hash,
        outcome: "NEEDS_CHANGES",
        observation: kind === "AUDIO" ? "背景录音起始有杂音" : "字幕末帧需要延后",
        self_review: true,
      },
      parent_version_id: null,
      expected_revision: null,
    },
  };
  const content = {
    schema_version: "1.0.0" as const,
    input: command.payload.input,
    target_snapshot: snapshot,
    observation_method:
      kind === "AUDIO"
        ? ("ORIGINAL_AUDIO_LISTENING" as const)
        : ("LITERAL_SUBTITLE_TEXT_AND_RANGE" as const),
    manual_review_only: true as const,
    formal_status: "BLOCKED" as const,
  };
  const version = {
    version_id: `ver_${"8".repeat(32)}`,
    version_number: 1,
    parent_version_id: null,
    author_actor_id: "local-user" as const,
    content,
    content_hash: sha(content),
    created_at: "2026-10-11T12:00:00.123456Z",
  };
  const operation: LocalMediaReviewOperation = {
    operation_id: operationId,
    payload: command.payload,
    version,
    result_revision: 1,
  };
  const query = {
    assembly_version_id: snapshot.assembly_version_id,
    assembly_content_hash: snapshot.assembly_content_hash,
    segment_kind: kind,
    segment_id: snapshot.segment_id,
  };
  return { target, command, operation, query };
}
function envelope(data: unknown) {
  return { data, request_id: requestId };
}
function response(data: unknown, status = 200, header = requestId) {
  return new Response(JSON.stringify(data), { status, headers: { "X-Request-ID": header } });
}
function client(...responses: Array<Response | Error>) {
  const fetcher = vi.fn();
  for (const value of responses) {
    if (value instanceof Error) fetcher.mockRejectedValueOnce(value);
    else fetcher.mockResolvedValueOnce(value);
  }
  return {
    fetcher,
    api: createLocalApiClient(fetcher, { origin: "http://127.0.0.1:43124", token: "t".repeat(43) }),
  };
}
const uri = `/api/v1/projects/${p}/episodes/${e}`;
describe("explicit local self observation desktop persistence", () => {
  it.each(["AUDIO", "LITERAL_SUBTITLE"] as const)(
    "reads and verifies exact %s snapshots then saves once and reads the same durable operation",
    async (kind) => {
      const f = fixture(kind);
      const c = client(
        response(envelope(f.target)),
        response(envelope(f.operation), 201),
        response(envelope(f.operation)),
      );
      expect((await c.api.getLocalMediaReviewTarget(p, e, f.query)).kind).toBe("FOUND");
      expect((await c.api.saveLocalMediaReview(p, e, f.command)).kind).toBe("FOUND");
      expect(c.fetcher.mock.calls.map((call) => call[1].method)).toEqual(["GET", "POST", "GET"]);
      expect(c.fetcher.mock.calls[1]![0]).toBe(`http://127.0.0.1:43124${uri}/local-media-reviews`);
      expect(c.fetcher.mock.calls[1]![1].headers["Idempotency-Key"]).toBe(operationId);
      expect(JSON.parse(c.fetcher.mock.calls[1]![1].body)).toEqual(f.command.payload);
      expect(c.fetcher.mock.calls[2]![0]).toBe(
        `http://127.0.0.1:43124${uri}/local-media-review-operations/${operationId}?payload_hash=${encodeURIComponent(sha(f.command.payload))}`,
      );
      expect(c.fetcher.mock.calls[2]![1].body).toBeUndefined();
      expect(f.operation.version.content.formal_status).toBe("BLOCKED");
    },
  );
  it.each([
    "lost",
    "header",
    "scope",
    "body-hash",
    "operation",
    "version-revision",
    "calendar",
    "unknown-error",
  ])(
    "keeps %s POST unknown with no automatic GET and recovers only by reading the complete original",
    async (kind) => {
      const f = fixture(),
        bad = structuredClone(f.operation);
      if (kind === "scope") bad.version.content.input.episode_id = `ep_${"a".repeat(32)}`;
      if (kind === "body-hash")
        bad.version.content.input.observation = "changed but unchanged hash";
      if (kind === "operation") bad.operation_id = "00000000-0000-4000-8000-000000000001";
      if (kind === "version-revision") bad.version.version_number = 2;
      if (kind === "calendar") bad.version.created_at = "2026-02-30T12:00:00Z";
      const first =
        kind === "lost"
          ? new Error("response lost")
          : kind === "unknown-error"
            ? response(
                {
                  request_id: requestId,
                  error: {
                    code: "LOCAL_MEDIA_REVIEW_WRITE_UNKNOWN",
                    message: "possibly committed",
                    retryable: false,
                    details: {},
                  },
                },
                500,
              )
            : response(
                envelope(bad),
                201,
                kind === "header" ? "00000000-0000-4000-8000-000000000001" : requestId,
              );
      const c = client(first, response(envelope(f.operation)));
      expect(await c.api.saveLocalMediaReview(p, e, f.command)).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(c.fetcher).toHaveBeenCalledOnce();
      expect((await c.api.getLocalMediaReviewOperation(p, e, f.command)).kind).toBe("FOUND");
      expect(c.fetcher.mock.calls.map((call) => call[1].method)).toEqual(["POST", "GET"]);
    },
  );
  it.each(["lost", "identity", "missing"])(
    "valid POST and %s original read remains UNKNOWN without resending",
    async (kind) => {
      const f = fixture(),
        other = structuredClone(f.operation);
      other.version.version_id = `ver_${"a".repeat(32)}`;
      const c = client(
        response(envelope(f.operation), 201),
        kind === "lost"
          ? new Error("read lost")
          : response(
              envelope(kind === "identity" ? other : f.operation),
              kind === "missing" ? 404 : 200,
            ),
      );
      expect(await c.api.saveLocalMediaReview(p, e, f.command)).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(c.fetcher.mock.calls.map((call) => call[1].method)).toEqual(["POST", "GET"]);
    },
  );
  it("captures the original full payload before awaits even if the caller edits the command", async () => {
    const f = fixture(),
      original = structuredClone(f.command),
      op = structuredClone(f.operation);
    let settle!: (value: Response) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((r) => {
            settle = r;
          }),
      )
      .mockResolvedValueOnce(response(envelope(op)));
    const api = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    const pending = api.saveLocalMediaReview(p, e, f.command);
    f.command.payload.input.observation = "new unsaved input";
    f.command.operation_id = "00000000-0000-4000-8000-000000000005";
    settle(response(envelope(op), 201));
    expect((await pending).kind).toBe("FOUND");
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual(original.payload);
    expect(fetcher.mock.calls[1]![0]).toContain(
      `${operationId}?payload_hash=${encodeURIComponent(sha(original.payload))}`,
    );
  });
  it.each(["extra", "scope", "blank", "paired", "coercion", "surrogate"])(
    "rejects %s original command before any HTTP dispatch",
    async (kind) => {
      const f = fixture();
      if (kind === "extra") Object.assign(f.command.payload, { actor_id: "admin" });
      if (kind === "scope") f.command.payload.input.episode_id = `ep_${"a".repeat(32)}`;
      if (kind === "blank") f.command.payload.input.observation = "\u0085\u001c";
      if (kind === "paired") f.command.payload.expected_revision = 1;
      if (kind === "coercion")
        Object.assign(f.command.payload.input, { assembly_head_revision: "3" });
      if (kind === "surrogate") f.command.payload.input.observation = "\ud800";
      expect(localReviewCommand(f.command, p, e)).toBe(false);
      const c = client();
      await expect(c.api.saveLocalMediaReview(p, e, f.command)).rejects.toThrow("Invalid original");
      expect(c.fetcher).not.toHaveBeenCalled();
    },
  );
  it.each(["original", "range", "text", "kind", "dialogue"])(
    "rejects rehashed forged %s target snapshot",
    async (kind) => {
      const f = fixture(kind === "text" ? "LITERAL_SUBTITLE" : "AUDIO"),
        s = f.target.snapshot;
      if (kind === "original") s.media_original!.asset_version_id = `asv_${"a".repeat(32)}`;
      if (kind === "range") s.audio_segment!.end_frame = 101;
      if (kind === "text") s.subtitle_segment!.text = "🙂";
      if (kind === "kind") Object.assign(s, { segment_kind: ["AUDIO"] });
      if (kind === "dialogue") s.audio_segment!.track_kind = "DIALOGUE";
      s.segment_content_hash = sha(s.audio_segment ?? s.subtitle_segment);
      f.target.snapshot_hash = sha(s);
      expect(await localReviewTarget(f.target, p, e, f.query)).toBe(false);
      const c = client(response(envelope(f.target)));
      expect(await c.api.getLocalMediaReviewTarget(p, e, f.query)).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(c.fetcher.mock.calls[0]![1].method).toBe("GET");
    },
  );
  it("reads bounded history and separate dynamic status without source rechecks or approval claims", async () => {
    const f = fixture();
    const page = {
      project_id: p,
      episode_id: e,
      head_version_id: f.operation.version.version_id,
      head_revision: 1,
      items: [f.operation.version],
      next_cursor: null,
    };
    const status = {
      review_version_id: f.operation.version.version_id,
      review_content_hash: f.operation.version.content_hash,
      applicability: "STALE",
      current_assembly: {
        version_id: `ver_${"a".repeat(32)}`,
        content_hash: `sha256:${"b".repeat(64)}`,
        head_revision: 4,
      },
      reasons: [{ code: "LOCAL_MEDIA_REVIEW_MEDIA_MISSING", message: "录音原件当前缺失" }],
      checked_at: "2026-10-11T12:00:00Z",
      formal_status: "BLOCKED",
    };
    const c = client(
      response(envelope(page)),
      response(envelope(f.operation.version)),
      response(envelope(status)),
    );
    expect((await c.api.listLocalMediaReviews(p, e)).kind).toBe("FOUND");
    expect((await c.api.getLocalMediaReview(p, e, f.operation.version.version_id)).kind).toBe(
      "FOUND",
    );
    expect(
      (
        await c.api.getLocalMediaReviewStatus(p, e, {
          version_id: status.review_version_id,
          content_hash: status.review_content_hash,
        })
      ).kind,
    ).toBe("FOUND");
    expect(c.fetcher.mock.calls.map((call) => call[1].method)).toEqual(["GET", "GET", "GET"]);
    expect(c.fetcher.mock.calls[0]![0]).toContain("local-media-reviews?limit=20");
    for (const kind of ["head", "duplicate", "scope", "empty"]) {
      const bad = structuredClone(page);
      if (kind === "head") bad.head_revision = 2;
      if (kind === "duplicate") bad.items.push(bad.items[0]!);
      if (kind === "scope") bad.episode_id = `ep_${"a".repeat(32)}`;
      if (kind === "empty")
        Object.assign(bad, {
          head_version_id: null,
          head_revision: null,
          next_cursor: f.operation.version.version_id,
          items: [],
        });
      expect(await localReviewPage(bad, p, e)).toBe(false);
    }
  });
  it.each(["offset", "calendar", "scope", "array", "approval", "reasons"])(
    "rejects %s dynamic status receipt",
    async (kind) => {
      const f = fixture(),
        q = {
          version_id: f.operation.version.version_id,
          content_hash: f.operation.version.content_hash,
        };
      const status = {
        review_version_id: q.version_id,
        review_content_hash: q.content_hash,
        applicability: "CURRENT",
        current_assembly: {
          version_id: f.query.assembly_version_id,
          content_hash: f.query.assembly_content_hash,
          head_revision: 3,
        },
        reasons: [],
        checked_at: "2026-10-11T12:00:00Z",
        formal_status: "BLOCKED",
      };
      if (kind === "offset") status.checked_at = "2026-10-11T12:00:00+08:00";
      if (kind === "calendar") status.checked_at = "2026-02-30T12:00:00Z";
      if (kind === "scope") status.review_content_hash = `sha256:${"b".repeat(64)}`;
      if (kind === "array") Object.assign(status, { applicability: ["CURRENT"] });
      if (kind === "approval") status.formal_status = "APPROVED";
      if (kind === "reasons") Object.assign(status, { applicability: "STALE" });
      const c = client(response(envelope(status)));
      expect(await c.api.getLocalMediaReviewStatus(p, e, q)).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(c.fetcher).toHaveBeenCalledOnce();
    },
  );
  it("requires matching original operation payload, input, parent and all content hashes", async () => {
    const f = fixture();
    expect(await localReviewOperation(f.operation, p, e, f.command)).toBe(true);
    for (const mutate of [
      (op: LocalMediaReviewOperation) => {
        op.payload.expected_revision = 2;
      },
      (op: LocalMediaReviewOperation) => {
        op.version.parent_version_id = `ver_${"c".repeat(32)}`;
      },
      (op: LocalMediaReviewOperation) => {
        op.version.content.target_snapshot.media_original!.filename = "other.wav";
      },
      (op: LocalMediaReviewOperation) => {
        op.result_revision = 2;
      },
    ]) {
      const op = structuredClone(f.operation);
      mutate(op);
      expect(await localReviewOperation(op, p, e, f.command)).toBe(false);
    }
  });
  it.each(["AUDIO", "LITERAL_SUBTITLE"] as const)(
    "accepts exact script-bound %s and rejects rehashed contradictory confirmed source",
    async (kind) => {
      const f = fixture(kind),
        s = f.target.snapshot;
      const source = {
        script_version_id: `ver_${"a".repeat(32)}`,
        script_content_hash: `sha256:${"b".repeat(64)}`,
        script_block_id: `sblk_${"c".repeat(32)}`,
        block_content_hash: `sha256:${"d".repeat(64)}`,
      };
      s.script_source = source;
      s.script_provenance = {
        mode: "CONFIRMED",
        confirmation_id: `esc_${"e".repeat(32)}`,
        script_version_id: source.script_version_id,
        script_content_hash: source.script_content_hash,
      };
      if (kind === "AUDIO")
        Object.assign(s.audio_segment!, {
          track_kind: "DIALOGUE",
          script_version_id: source.script_version_id,
          script_block_id: source.script_block_id,
          speaker_id: `spk_${"f".repeat(32)}`,
          delivery: "OFF_SCREEN",
        });
      else
        s.subtitle_segment!.script_ref = {
          script_version_id: source.script_version_id,
          script_block_id: source.script_block_id,
          script_content_hash: source.script_content_hash,
        };
      const rehash = () => {
        s.segment_content_hash = sha(s.audio_segment ?? s.subtitle_segment);
        f.target.snapshot_hash = sha(s);
        f.command.payload.input.segment_content_hash = s.segment_content_hash;
        f.command.payload.input.target_snapshot_hash = f.target.snapshot_hash;
        f.operation.version.content_hash = sha(f.operation.version.content);
      };
      rehash();
      expect(await localReviewTarget(f.target, p, e, f.query)).toBe(true);
      expect(await localReviewOperation(f.operation, p, e, f.command)).toBe(true);
      s.script_provenance.script_content_hash = `sha256:${"1".repeat(64)}`;
      rehash();
      expect(await localReviewTarget(f.target, p, e, f.query)).toBe(false);
      expect(await localReviewOperation(f.operation, p, e, f.command)).toBe(false);
    },
  );
  it("accepts only closed proven precommit rejection, keeps unknown/nonempty details attributable only by read", async () => {
    const f = fixture();
    const error = {
      request_id: requestId,
      error: {
        code: "LOCAL_MEDIA_REVIEW_CONFLICT",
        message: "Review CAS changed",
        retryable: false,
        details: {},
      },
    };
    const c = client(response(error, 409));
    expect(await c.api.saveLocalMediaReview(p, e, f.command)).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: error.error.code,
      request_id: requestId,
    });
    expect(c.fetcher).toHaveBeenCalledOnce();
    Object.assign(error.error.details, { side_effect: "unknown" });
    const bad = client(response(error, 409));
    expect(await bad.api.saveLocalMediaReview(p, e, f.command)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(bad.fetcher).toHaveBeenCalledOnce();
  });
  it("rejects oversized response through the actual bounded UTF8 local HTTP reader", async () => {
    const c = client(response({ padding: "x".repeat(1_500_001) }));
    expect(await c.api.listLocalMediaReviews(p, e)).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(c.fetcher).toHaveBeenCalledOnce();
  });
});

describe("owned top-frame local self observation bridge", () => {
  function nativeAuthorization() {
    const source = readFileSync(resolve(__dirname, "main.ts"), "utf8"),
      ast = ts.createSourceFile("main.ts", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const fn = ast.statements.find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === "nativePreviewAuthorized",
    )!;
    const registration = ast.statements.find(
      (node) =>
        ts.isExpressionStatement(node) &&
        ts.isCallExpression(node.expression) &&
        node.expression.expression.getText(ast) === "registerLocalMediaReviewHandlers",
    )!;
    expect(registration.getText(ast)).toContain("nativePreviewAuthorized");
    const sourceJs = ts.transpileModule(fn.getText(ast), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const frame = { isDestroyed: () => false, detached: false },
      contents = { isDestroyed: () => false, mainFrame: frame },
      window = { isDestroyed: () => false, webContents: contents };
    const context = { mainWindow: window, apiClient: {}, exports: {} };
    const check = runInNewContext(`${sourceJs}\nnativePreviewAuthorized`, context) as (
      event: unknown,
    ) => boolean;
    return { check, frame, contents, window, context };
  }
  it("runs actual main authorization before selecting clients for every fixed channel and rejects invalid args", async () => {
    const a = nativeAuthorization(),
      f = fixture(),
      handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
    const api = client().api,
      clientFor = vi.fn(() => api);
    registerLocalMediaReviewHandlers(
      (channel, fn) => handlers.set(channel, fn),
      clientFor,
      a.check,
    );
    expect([...handlers.keys()]).toEqual(Object.values(LOCAL_MEDIA_REVIEW_CHANNELS));
    const good = { sender: a.contents, senderFrame: a.frame };
    const bad = [
      { sender: {}, senderFrame: a.frame },
      { sender: a.contents, senderFrame: { ...a.frame } },
      { sender: a.contents, senderFrame: null },
      { sender: a.contents, senderFrame: { ...a.frame, detached: true } },
    ];
    for (const handler of handlers.values())
      for (const event of bad)
        await expect(handler(event, p, e, f.command)).rejects.toThrow("not authorized");
    await expect(
      handlers.get(LOCAL_MEDIA_REVIEW_CHANNELS.target)!(good, p, e, { ...f.query, approved: true }),
    ).rejects.toThrow("target");
    await expect(
      handlers.get(LOCAL_MEDIA_REVIEW_CHANNELS.save)!(good, p, e, f.command, "extra"),
    ).rejects.toThrow("scope");
    a.window.isDestroyed = () => true;
    await expect(
      handlers.get(LOCAL_MEDIA_REVIEW_CHANNELS.save)!(good, p, e, f.command),
    ).rejects.toThrow("not authorized");
    a.window.isDestroyed = () => false;
    a.contents.isDestroyed = () => true;
    await expect(
      handlers.get(LOCAL_MEDIA_REVIEW_CHANNELS.save)!(good, p, e, f.command),
    ).rejects.toThrow("not authorized");
    a.contents.isDestroyed = () => false;
    a.frame.isDestroyed = () => true;
    await expect(
      handlers.get(LOCAL_MEDIA_REVIEW_CHANNELS.save)!(good, p, e, f.command),
    ).rejects.toThrow("not authorized");
    a.frame.isDestroyed = () => false;
    Object.assign(a.context, { apiClient: null });
    await expect(
      handlers.get(LOCAL_MEDIA_REVIEW_CHANNELS.save)!(good, p, e, f.command),
    ).rejects.toThrow("not authorized");
    Object.assign(a.context, { apiClient: {}, mainWindow: null });
    await expect(
      handlers.get(LOCAL_MEDIA_REVIEW_CHANNELS.save)!(good, p, e, f.command),
    ).rejects.toThrow("not authorized");
    expect(clientFor).not.toHaveBeenCalled();
  });
  it("composes the actual Electron-only sandbox preload, fixed IPC and production HTTP client", async () => {
    const f = fixture(),
      c = client(
        response(envelope(f.target)),
        response(envelope(f.operation), 201),
        response(envelope(f.operation)),
        response(envelope(f.operation)),
      );
    const handlers = new Map<string, (event: boolean, ...args: unknown[]) => Promise<unknown>>();
    registerLocalMediaReviewHandlers(
      (channel, fn) => handlers.set(channel, fn),
      () => c.api,
      Boolean,
    );
    const source = readFileSync(resolve(__dirname, "preload.ts"), "utf8"),
      js = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText;
    let bridge!: LocalMediaReviewGateway & { invoke?: unknown };
    const invoke = vi.fn((channel: string, ...args: unknown[]) =>
      handlers.get(channel)!(true, ...args),
    );
    runInNewContext(js, {
      exports: {},
      require: (name: string) => {
        if (name !== "electron") throw new Error(`Unexpected runtime preload import ${name}`);
        return {
          contextBridge: {
            exposeInMainWorld: (_name: string, value: typeof bridge) => {
              bridge = value;
            },
          },
          ipcRenderer: { invoke },
        };
      },
    });
    expect((await bridge.getLocalMediaReviewTarget(p, e, f.query)).kind).toBe("FOUND");
    expect((await bridge.saveLocalMediaReview(p, e, f.command)).kind).toBe("FOUND");
    expect((await bridge.getLocalMediaReviewOperation(p, e, f.command)).kind).toBe("FOUND");
    expect(invoke.mock.calls.map((call) => call[0])).toEqual([
      LOCAL_MEDIA_REVIEW_CHANNELS.target,
      LOCAL_MEDIA_REVIEW_CHANNELS.save,
      LOCAL_MEDIA_REVIEW_CHANNELS.original,
    ]);
    expect(c.fetcher.mock.calls.map((call) => call[1].method)).toEqual([
      "GET",
      "POST",
      "GET",
      "GET",
    ]);
    expect(bridge.invoke).toBeUndefined();
  });
});
