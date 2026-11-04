import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import { createDraftReviewClient } from "./draft-review-client";
import {
  DRAFT_REVIEW_CHANNELS,
  isCreateDraftReviewNoteRequest,
  isDraftReviewResponse,
  isResolveDraftReviewNoteRequest,
  type CreateDraftReviewNoteRequest,
  type DraftReviewData,
  type DraftReviewGateway,
  type DraftReviewNote,
  type DraftReviewResponse,
  type ResolveDraftReviewNoteRequest,
} from "./draft-review-contract";
import { registerDraftReviewHandlers } from "./draft-review-ipc";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const operation = `dmp_${"c".repeat(32)}`;
const requestId = "00000000-0000-4000-8000-000000000001";
const proof = {
  assembly_version_id: `ver_${"d".repeat(32)}`,
  assembly_content_hash: `sha256:${"e".repeat(64)}`,
  output_sha256: "f".repeat(64),
  output_bytes: 1024,
};
const create: CreateDraftReviewNoteRequest = {
  ...proof,
  note_id: `drn_${"1".repeat(32)}`,
  frame_index: 24,
  text: "角色视线需要向左。\nCheck the cut.",
};
const resolution: ResolveDraftReviewNoteRequest = {
  ...proof,
  resolution_id: `drr_${"2".repeat(32)}`,
  expected_revision: 1,
  reason: "Reviewed against the source; the intentional eyeline is retained.",
};
const note: DraftReviewNote = {
  note_id: create.note_id,
  frame_index: create.frame_index,
  text: create.text,
  actor_id: "local-manual-reviewer",
  created_at: "2026-10-08T00:00:00+00:00",
  revision: 1,
  resolution: null,
};
const resolved: DraftReviewNote = {
  ...note,
  revision: 2,
  resolution: {
    resolution_id: resolution.resolution_id,
    reason: resolution.reason,
    actor_id: "local-manual-reviewer",
    created_at: "2026-10-08T00:01:00+00:00",
  },
};
const data: DraftReviewData = {
  target: {
    ...proof,
    project_id: project,
    episode_id: episode,
    operation_id: operation,
    assembly_version_number: 2,
    total_frames: 100,
    frame_rate_num: 25,
    frame_rate_den: 1,
  },
  output_verified: true,
  current_assembly_version_id: proof.assembly_version_id,
  current_assembly_content_hash: proof.assembly_content_hash,
  version_status: "CURRENT",
  notes: [note],
  manual_review_only: true,
};
function receipt(patch: Partial<DraftReviewData> = {}): DraftReviewResponse {
  return { data: { ...data, ...patch }, request_id: requestId };
}
function http(payload: unknown = receipt(), status = 200, header: string | null = requestId) {
  return { status, payload, requestId: header };
}
function error(status = 409, code = "DRAFT_REVIEW_ID_REUSED") {
  return http(
    {
      error: { code, message: "Unavailable", details: {}, retryable: false },
      request_id: requestId,
    },
    status,
  );
}
function fetchResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
  });
}
const base = `/api/v1/projects/${project}/episodes/${episode}/draft-exports/${operation}/review-notes`;

function setupIpc() {
  const client: DraftReviewGateway = {
    listDraftReviewNotes: vi.fn().mockResolvedValue({ kind: "FOUND", receipt: receipt() }),
    createDraftReviewNote: vi.fn().mockResolvedValue({ kind: "FOUND", receipt: receipt() }),
    resolveDraftReviewNote: vi
      .fn()
      .mockResolvedValue({ kind: "FOUND", receipt: receipt({ notes: [resolved] }) }),
  };
  const clientFor = vi.fn(() => client);
  const handlers = new Map<
    string,
    (event: { top: boolean }, ...args: unknown[]) => Promise<unknown>
  >();
  registerDraftReviewHandlers<{ top: boolean }>(
    (channel, listener) => handlers.set(channel, listener),
    clientFor,
    (event) => event.top,
  );
  const invoke = (action: keyof typeof DRAFT_REVIEW_CHANNELS, args: unknown[], top = true) =>
    handlers.get(DRAFT_REVIEW_CHANNELS[action])!({ top }, ...args);
  return { client, clientFor, invoke, handlers };
}

describe("manual DRAFT review closed contracts", () => {
  it("accepts generated request and full history DTOs including Unicode text", () => {
    expect(isCreateDraftReviewNoteRequest(create)).toBe(true);
    expect(isCreateDraftReviewNoteRequest({ ...create, text: "😀".repeat(2000) })).toBe(true);
    expect(isResolveDraftReviewNoteRequest(resolution)).toBe(true);
    expect(isDraftReviewResponse(receipt(), project, episode, operation, requestId)).toBe(true);
    expect(
      isDraftReviewResponse(receipt({ notes: [resolved] }), project, episode, operation, requestId),
    ).toBe(true);
    expect(
      isDraftReviewResponse(
        receipt({ output_verified: false }),
        project,
        episode,
        operation,
        requestId,
      ),
    ).toBe(true);
    expect(
      isDraftReviewResponse(
        receipt({
          version_status: "OLDER_VERSION",
          current_assembly_version_id: `ver_${"3".repeat(32)}`,
        }),
        project,
        episode,
        operation,
        requestId,
      ),
    ).toBe(true);
    expect(
      isDraftReviewResponse(
        receipt({
          version_status: "UNKNOWN",
          current_assembly_version_id: null,
          current_assembly_content_hash: null,
        }),
        project,
        episode,
        operation,
        requestId,
      ),
    ).toBe(true);
  });
  it.each([
    { output_path: "/tmp/injected.mp4" },
    { approved: true },
    { provider: "OpenAI" },
    { actor_id: "forged" },
    { publish: true },
    { note_id: "../../escape" },
    { assembly_version_id: "ver_wrong" },
    { assembly_content_hash: "bad" },
    { output_sha256: `sha256:${proof.output_sha256}` },
    { output_bytes: 0 },
    { output_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { frame_index: -1 },
    { frame_index: 1.5 },
    { frame_index: 1_000_000 },
    { text: " \n\t" },
    { text: "bad\0note" },
    { text: "x".repeat(2001) },
    { text: "\ud800" },
  ])("rejects unsafe create input %j", (patch) => {
    expect(isCreateDraftReviewNoteRequest({ ...create, ...patch })).toBe(false);
  });
  it.each([
    { expected_revision: 2 },
    { expected_revision: true },
    { note_id: create.note_id },
    { resolution_id: "../../escape" },
    { reason: "\0" },
    { reason: " " },
    { reason: "😀".repeat(2001) },
    { assembly_content_hash: "unknown" },
    { approval: true },
    { output_path: "C:\\secret.mp4" },
  ])("rejects unsafe resolution input %j", (patch) => {
    expect(isResolveDraftReviewNoteRequest({ ...resolution, ...patch })).toBe(false);
  });
  it("requires every request field and exact own keys", () => {
    for (const key of Object.keys(create)) {
      const value = { ...create } as Record<string, unknown>;
      delete value[key];
      expect(isCreateDraftReviewNoteRequest(value)).toBe(false);
    }
    for (const key of Object.keys(resolution)) {
      const value = { ...resolution } as Record<string, unknown>;
      delete value[key];
      expect(isResolveDraftReviewNoteRequest(value)).toBe(false);
    }
    expect(isCreateDraftReviewNoteRequest(null)).toBe(false);
    expect(isResolveDraftReviewNoteRequest([])).toBe(false);
  });
  it.each([
    { target: { ...data.target, project_id: `prj_${"4".repeat(32)}` } },
    { target: { ...data.target, episode_id: `ep_${"4".repeat(32)}` } },
    { target: { ...data.target, operation_id: `dmp_${"4".repeat(32)}` } },
    { target: { ...data.target, output_path: "/secret.mp4" } },
    { target: { ...data.target, output_bytes: 0 } },
    { target: { ...data.target, frame_rate_num: 0 } },
    { target: { ...data.target, frame_rate_den: 0 } },
    { target: { ...data.target, total_frames: 1_000_001 } },
    { target: { ...data.target, assembly_version_number: 0 } },
    { output_verified: "true" },
    { manual_review_only: false },
    { version_status: "APPROVED" },
    { version_status: "OLDER_VERSION" },
    { version_status: "UNKNOWN" },
    { current_assembly_version_id: null },
    { current_assembly_content_hash: null },
    { current_assembly_version_id: `ver_${"4".repeat(32)}` },
    { current_assembly_content_hash: `sha256:${"4".repeat(64)}` },
    { notes: [note, note] },
    { notes: Array(501).fill(note) },
    { notes: [{ ...note, frame_index: data.target.total_frames }] },
    { notes: [{ ...note, revision: 2 }] },
    { notes: [{ ...resolved, revision: 1 }] },
    { notes: [{ ...note, text: " " }] },
    { notes: [{ ...note, created_at: "tomorrow" }] },
    { notes: [{ ...note, actor_id: "" }] },
    { notes: [{ ...note, output_path: "/secret.mp4" }] },
    {
      notes: [
        { ...resolved, resolution: { ...resolved.resolution, created_at: "2026-10-07T00:00:00Z" } },
      ],
    },
    { notes: [resolved, { ...resolved, note_id: `drn_${"5".repeat(32)}` }] },
  ])("suppresses malformed or incoherent history %j", (patch) => {
    expect(
      isDraftReviewResponse(
        { data: { ...data, ...patch }, request_id: requestId },
        project,
        episode,
        operation,
        requestId,
      ),
    ).toBe(false);
  });
  it("rejects invalid envelope and mismatched header request IDs", () => {
    for (const payload of [
      null,
      [],
      { data },
      { ...receipt(), unexpected: true },
      { ...receipt(), request_id: "not-a-uuid" },
      { ...receipt(), data: { ...data, approved: true } },
    ])
      expect(isDraftReviewResponse(payload, project, episode, operation, requestId)).toBe(false);
    expect(isDraftReviewResponse(receipt(), project, episode, operation, null)).toBe(false);
    expect(
      isDraftReviewResponse(
        receipt(),
        project,
        episode,
        operation,
        "00000000-0000-4000-8000-000000000002",
      ),
    ).toBe(false);
  });
});

describe("manual DRAFT review IPC and sandbox preload", () => {
  it("routes only exact scoped list/create/resolve commands", async () => {
    const env = setupIpc();
    await env.invoke("list", [project, episode, operation]);
    await env.invoke("create", [project, episode, operation, create]);
    await env.invoke("resolve", [project, episode, operation, create.note_id, resolution]);
    expect(env.handlers.size).toBe(3);
    expect(env.client.listDraftReviewNotes).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
    );
    expect(env.client.createDraftReviewNote).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
      create,
    );
    expect(env.client.resolveDraftReviewNote).toHaveBeenCalledExactlyOnceWith(
      project,
      episode,
      operation,
      create.note_id,
      resolution,
    );
  });
  it("rejects subframes before retrieving the authenticated client", async () => {
    const env = setupIpc();
    for (const action of ["list", "create", "resolve"] as const)
      await expect(
        env.invoke(action, [project, episode, operation, create], false),
      ).rejects.toThrow("not authorized");
    expect(env.clientFor).not.toHaveBeenCalled();
  });
  it("rejects wrong counts, scope IDs, path injection and forged metadata", async () => {
    const env = setupIpc();
    for (const [action, args] of [
      ["list", [project, episode]],
      ["list", [project, episode, operation, "extra"]],
      ["list", ["../../project", episode, operation]],
      ["list", [project, "ep_bad", operation]],
      ["list", [project, episode, "../../output"]],
      ["create", [project, episode, operation, create, "extra"]],
      ["create", [project, episode, operation, { ...create, output_path: "/secret.mp4" }]],
      ["create", [project, episode, operation, { ...create, actor_id: "forged" }]],
      ["resolve", [project, episode, operation, "../../note", resolution]],
      [
        "resolve",
        [project, episode, operation, create.note_id, { ...resolution, expected_revision: 2 }],
      ],
      ["resolve", [project, episode, operation, create.note_id, resolution, "extra"]],
    ] as const)
      await expect(env.invoke(action, [...args])).rejects.toThrow("Draft review IPC requires");
    expect(env.client.listDraftReviewNotes).not.toHaveBeenCalled();
    expect(env.client.createDraftReviewNote).not.toHaveBeenCalled();
    expect(env.client.resolveDraftReviewNote).not.toHaveBeenCalled();
  });
  it("exposes literal sandbox channels and only electron as a runtime import", async () => {
    const source = readFileSync(resolve(__dirname, "preload.ts"), "utf8");
    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const invoke = vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" });
    let bridge: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    runInNewContext(js, {
      exports: {},
      require: (name: string) => {
        if (name !== "electron") throw new Error(`Unexpected sandbox import ${name}`);
        return {
          contextBridge: {
            exposeInMainWorld: (name: string, api: typeof bridge) => {
              if (name === "aijian") bridge = api;
            },
          },
          ipcRenderer: { invoke },
        };
      },
    });
    await bridge.listDraftReviewNotes!(project, episode, operation);
    expect(invoke).toHaveBeenLastCalledWith("draft-review:list", project, episode, operation);
    await bridge.createDraftReviewNote!(project, episode, operation, create);
    expect(invoke).toHaveBeenLastCalledWith(
      "draft-review:create-note",
      project,
      episode,
      operation,
      create,
    );
    await bridge.resolveDraftReviewNote!(project, episode, operation, create.note_id, resolution);
    expect(invoke).toHaveBeenLastCalledWith(
      "draft-review:resolve-note",
      project,
      episode,
      operation,
      create.note_id,
      resolution,
    );
    expect(bridge).not.toHaveProperty("approveDraftReview");
    expect(bridge).not.toHaveProperty("publishDraft");
    expect(bridge).not.toHaveProperty("openPath");
    expect(readFileSync(resolve(__dirname, "main.ts"), "utf8")).toContain(
      "registerDraftReviewHandlers<IpcMainInvokeEvent>(",
    );
  });
});

describe("manual DRAFT review authenticated API and readback", () => {
  it("integrates list/create/resolve through the existing authenticated local API client", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(fetchResponse(receipt()))
      .mockResolvedValueOnce(fetchResponse(receipt()))
      .mockResolvedValueOnce(fetchResponse(receipt()))
      .mockResolvedValueOnce(fetchResponse(receipt()))
      .mockResolvedValueOnce(fetchResponse(receipt({ notes: [resolved] })))
      .mockResolvedValueOnce(fetchResponse(receipt({ notes: [resolved] })));
    const client = createLocalApiClient(fetcher, {
      origin: "http://127.0.0.1:43124",
      token: "t".repeat(43),
    });
    expect((await client.listDraftReviewNotes(project, episode, operation)).kind).toBe("FOUND");
    expect((await client.createDraftReviewNote(project, episode, operation, create)).kind).toBe(
      "FOUND",
    );
    expect(
      (await client.resolveDraftReviewNote(project, episode, operation, create.note_id, resolution))
        .kind,
    ).toBe("FOUND");
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.map((call) => call[1].method ?? "GET")).toEqual([
      "GET",
      "POST",
      "GET",
      "GET",
      "POST",
      "GET",
    ]);
    expect(fetcher.mock.calls[1]![0]).toBe(`http://127.0.0.1:43124${base}`);
    expect(fetcher.mock.calls[4]![0]).toBe(
      `http://127.0.0.1:43124${base}/${create.note_id}/resolutions`,
    );
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual(create);
    expect(JSON.parse(fetcher.mock.calls[4]![1].body)).toEqual(resolution);
    expect(fetcher.mock.calls[1]![1].headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: `Bearer ${"t".repeat(43)}`,
    });
  });
  it("suppresses malformed reads and distinguishes only validated definite failures", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(http({ ...receipt(), request_id: "bad" }))
      .mockResolvedValueOnce(http(receipt(), 200, null))
      .mockResolvedValueOnce(error(404, "DRAFT_REVIEW_NOT_FOUND"))
      .mockResolvedValueOnce(error(503, "DRAFT_REVIEW_UNKNOWN"))
      .mockRejectedValueOnce(new Error("lost reply"));
    const client = createDraftReviewClient(request, {});
    expect(await client.listDraftReviewNotes(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.listDraftReviewNotes(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.listDraftReviewNotes(project, episode, operation)).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 404,
      code: "DRAFT_REVIEW_NOT_FOUND",
      request_id: requestId,
    });
    expect(await client.listDraftReviewNotes(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(await client.listDraftReviewNotes(project, episode, operation)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
  });
  it.each([null, http({}, 200), error(503, "DRAFT_REVIEW_UNKNOWN"), http(receipt(), 200, null)])(
    "reconciles unknown POST %j with one GET and no automatic resend",
    async (postResult) => {
      const request = vi.fn().mockResolvedValueOnce(postResult).mockResolvedValueOnce(http());
      const client = createDraftReviewClient(request, {});
      expect(await client.createDraftReviewNote(project, episode, operation, create)).toEqual({
        kind: "FOUND",
        receipt: receipt(),
      });
      expect(request.mock.calls.map((call) => call[1].method ?? "GET")).toEqual(["POST", "GET"]);
    },
  );
  it("never calls a successful POST durable until its GET readback confirms the exact note", async () => {
    let finish!: (value: ReturnType<typeof http> | null) => void;
    const request = vi
      .fn()
      .mockResolvedValueOnce(http())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const client = createDraftReviewClient(request, {});
    let settled = false;
    const pending = client
      .createDraftReviewNote(project, episode, operation, create)
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(settled).toBe(false);
    finish(null);
    expect(await pending).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it.each([
    receipt({ notes: [] }),
    receipt({ notes: [{ ...note, note_id: `drn_${"5".repeat(32)}` }] }),
    receipt({ notes: [{ ...note, text: "different" }] }),
    receipt({ notes: [{ ...note, frame_index: 25 }] }),
    receipt({ target: { ...data.target, output_sha256: "5".repeat(64) } }),
    receipt({ target: { ...data.target, output_bytes: 2048 } }),
    receipt({ target: { ...data.target, total_frames: 101 } }),
    receipt({ notes: [{ ...note, actor_id: "different" }] }),
  ])("keeps mismatched write/readback receipts unknown %j", async (readback) => {
    const request = vi.fn().mockResolvedValueOnce(http()).mockResolvedValueOnce(http(readback));
    expect(
      await createDraftReviewClient(request, {}).createDraftReviewNote(
        project,
        episode,
        operation,
        create,
      ),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it("does not treat unknown write followed by an empty list or definite read error as success", async () => {
    for (const readback of [
      http(receipt({ notes: [] })),
      error(404, "DRAFT_REVIEW_NOT_FOUND"),
      null,
    ]) {
      const request = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(readback);
      expect(
        await createDraftReviewClient(request, {}).createDraftReviewNote(
          project,
          episode,
          operation,
          create,
        ),
      ).toEqual({ kind: "REMOTE_UNKNOWN" });
    }
  });
  it("preserves caller IDs across explicit retries and returns definite conflicts without replay", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(http(receipt({ notes: [] })))
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(error());
    const client = createDraftReviewClient(request, {});
    expect((await client.createDraftReviewNote(project, episode, operation, create)).kind).toBe(
      "REMOTE_UNKNOWN",
    );
    expect((await client.createDraftReviewNote(project, episode, operation, create)).kind).toBe(
      "FOUND",
    );
    expect(
      (
        await client.createDraftReviewNote(project, episode, operation, {
          ...create,
          text: "changed",
        })
      ).kind,
    ).toBe("DEFINITE_SERVER_ERROR");
    expect(request).toHaveBeenCalledTimes(5);
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual(
      JSON.parse(request.mock.calls[2]![1].body),
    );
  });
  it("reconciles a dropped resolution response against the exact immutable original", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(http())
      .mockRejectedValueOnce(new Error("dropped"))
      .mockResolvedValueOnce(http(receipt({ notes: [resolved] })));
    expect(
      await createDraftReviewClient(request, {}).resolveDraftReviewNote(
        project,
        episode,
        operation,
        create.note_id,
        resolution,
      ),
    ).toEqual({ kind: "FOUND", receipt: receipt({ notes: [resolved] }) });
    expect(request.mock.calls.map((call) => call[1].method ?? "GET")).toEqual([
      "GET",
      "POST",
      "GET",
    ]);
  });
  it.each([
    { ...resolved, text: "silently altered original" },
    { ...resolved, frame_index: 25 },
    { ...resolved, actor_id: "different" },
    { ...resolved, created_at: "2026-10-08T00:00:30Z" },
    {
      ...resolved,
      resolution: { ...resolved.resolution!, resolution_id: `drr_${"5".repeat(32)}` },
    },
    { ...resolved, resolution: { ...resolved.resolution!, reason: "different" } },
    { ...resolved, note_id: `drn_${"5".repeat(32)}` },
    note,
  ])("suppresses mismatched resolution readback %j", async (changedNote) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(http())
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(http(receipt({ notes: [changedNote] })));
    expect(
      await createDraftReviewClient(request, {}).resolveDraftReviewNote(
        project,
        episode,
        operation,
        create.note_id,
        resolution,
      ),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
  it("requires a valid original before resolving and never silently targets another note", async () => {
    for (const original of [
      null,
      http(receipt({ notes: [] })),
      http(receipt({ target: { ...data.target, output_sha256: "5".repeat(64) } })),
    ]) {
      const request = vi.fn().mockResolvedValueOnce(original);
      expect(
        await createDraftReviewClient(request, {}).resolveDraftReviewNote(
          project,
          episode,
          operation,
          create.note_id,
          resolution,
        ),
      ).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it("validates direct client inputs before any HTTP call", async () => {
    const request = vi.fn();
    const client = createDraftReviewClient(request, {});
    await expect(client.listDraftReviewNotes(project, episode, "../operation")).rejects.toThrow(
      "canonical",
    );
    expect(() =>
      client.createDraftReviewNote(project, episode, operation, {
        ...create,
        output_path: "/secret",
      } as CreateDraftReviewNoteRequest),
    ).toThrow("path-free");
    await expect(
      client.resolveDraftReviewNote(project, episode, operation, "../note", resolution),
    ).rejects.toThrow("exact");
    await expect(
      client.resolveDraftReviewNote(project, episode, operation, create.note_id, {
        ...resolution,
        expected_revision: 2,
      } as unknown as ResolveDraftReviewNoteRequest),
    ).rejects.toThrow("exact");
    expect(request).not.toHaveBeenCalled();
  });
});
