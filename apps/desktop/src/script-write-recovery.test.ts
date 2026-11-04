import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
import { impactCanonical } from "@aijian/contracts/script-confirmation-impact";
import { SCRIPT_WRITE_OPERATION_CHANNEL } from "@aijian/contracts/script-write-recovery";
import { createLocalApiClient } from "./api-client";
import { registerEpisodeScriptHandlers } from "./episode-script-ipc";
import type {
  CreateEpisodeScriptVersionRequest,
  EpisodeScriptVersion,
} from "./episode-script-contract";
const project = `prj_${"a".repeat(32)}`,
  episode = `ep_${"b".repeat(32)}`;
const operation = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const hash = (v: unknown) =>
  `sha256:${createHash("sha256").update(impactCanonical(v)).digest("hex")}`;
const session = { origin: "http://127.0.0.1:43139", token: "x".repeat(43) };
const payload: CreateEpisodeScriptVersionRequest = {
  content: {
    schema_version: "1.0.0",
    project_id: project,
    episode_id: episode,
    production_brief_version_id: null,
    story_bible_version_id: null,
    source_extraction_version_id: null,
    source_proposal_acceptance_id: null,
    scenes: [],
  },
  parent_version_id: null,
  expected_revision: null,
  change_summary: "Exact original synthetic body",
};
function data() {
  const version: EpisodeScriptVersion = {
    version_id: `ver_${"c".repeat(32)}`,
    project_id: project,
    episode_id: episode,
    version_number: 1,
    head_revision: 2,
    parent_version_id: null,
    content: structuredClone(payload.content),
    content_hash: hash(payload.content),
    author_actor_id: "local-user",
    change_summary: payload.change_summary,
    created_at: "2026-10-11T00:00:00Z",
  };
  return {
    operation_id: operation,
    project_id: project,
    episode_id: episode,
    idempotency_key_hash: hash({ value: operation }),
    request_hash: hash({
      project_id: project,
      episode_id: episode,
      actor_id: "local-user",
      payload,
    }),
    version,
  };
}
function wire(value: unknown, status = 200, header = requestId) {
  return Response.json(
    { data: value, request_id: requestId },
    { status, headers: { "X-Request-ID": header } },
  );
}
test("native original getter sends only scoped GET and checks full body, receipt and immutable commit", async () => {
  const fetcher = vi.fn(async () => wire(data()));
  const result = await createLocalApiClient(fetcher, session).getEpisodeScriptWriteOperation(
    project,
    episode,
    operation,
    payload,
  );
  expect(result.kind).toBe("FOUND");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toEqual([
    `${session.origin}/api/v1/projects/${project}/episodes/${episode}/script/write-operations/${operation}`,
    expect.objectContaining({ headers: expect.any(Object) }),
  ]);
});
test.each([
  "operation",
  "project",
  "episode",
  "key",
  "request",
  "content",
  "hash",
  "revision",
  "parent",
  "summary",
  "actor",
  "extra",
  "header",
])("native original getter rejects %s evidence without mutation or replay", async (damage) => {
  const value = data();
  if (damage === "operation") value.operation_id = requestId;
  if (damage === "project") value.project_id = `prj_${"d".repeat(32)}`;
  if (damage === "episode") value.episode_id = `ep_${"d".repeat(32)}`;
  if (damage === "key") value.idempotency_key_hash = hash({ value: "wrong" });
  if (damage === "request") value.request_hash = hash({ wrong: true });
  if (damage === "content")
    value.version.content.production_brief_version_id = `ver_${"d".repeat(32)}`;
  if (damage === "hash") value.version.content_hash = hash({ wrong: true });
  if (damage === "revision") value.version.version_number = 2;
  if (damage === "parent") value.version.parent_version_id = `ver_${"d".repeat(32)}`;
  if (damage === "summary") value.version.change_summary = "Other";
  if (damage === "actor") value.version.author_actor_id = "other-user";
  if (damage === "extra") Object.assign(value, { not_executed: true });
  const fetcher = vi.fn(async () => wire(value, 200, damage === "header" ? operation : requestId));
  expect(
    await createLocalApiClient(fetcher, session).getEpisodeScriptWriteOperation(
      project,
      episode,
      operation,
      payload,
    ),
  ).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(fetcher).toHaveBeenCalledOnce();
});
test.each([404, 401, 403, 500, "throw", "malformed"])(
  "native GET %s remains UNKNOWN",
  async (fault) => {
    const fetcher = vi.fn(async () => {
      if (fault === "throw") throw new Error("Synthetic read failed");
      if (fault === "malformed")
        return new Response("{", { status: 200, headers: { "X-Request-ID": requestId } });
      return Response.json(
        {
          error: {
            code: "SCRIPT_WRITE_OPERATION_UNKNOWN",
            message: "Unattributed",
            details: {},
            retryable: false,
          },
          request_id: requestId,
        },
        { status: fault as number, headers: { "X-Request-ID": requestId } },
      );
    });
    expect(
      await createLocalApiClient(fetcher, session).getEpisodeScriptWriteOperation(
        project,
        episode,
        operation,
        payload,
      ),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
test("original input is captured before asynchronous GET", async () => {
  const mutable = structuredClone(payload);
  const fetcher = vi.fn(async () => {
    mutable.change_summary = "Mutated";
    return wire(data());
  });
  expect(
    (
      await createLocalApiClient(fetcher, session).getEpisodeScriptWriteOperation(
        project,
        episode,
        operation,
        mutable,
      )
    ).kind,
  ).toBe("FOUND");
});
test.each(["id", "scope", "input"])("invalid %s fails before any HTTP request", async (damage) => {
  const fetcher = vi.fn();
  const client = createLocalApiClient(fetcher, session);
  await expect(
    client.getEpisodeScriptWriteOperation(
      damage === "scope" ? "../project" : project,
      episode,
      damage === "id" ? "../operation" : operation,
      damage === "input" ? { ...payload, expected_revision: 1 } : payload,
    ),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
test("original recovery IPC enforces current top frame, exact arity and original payload", async () => {
  type Event = { top: boolean; authorized: boolean };
  const listeners = new Map<string, (event: Event, ...args: unknown[]) => Promise<unknown>>();
  const client = {
    getEpisodeScript: vi.fn(),
    getEpisodeScriptVersion: vi.fn(),
    createEpisodeScriptVersion: vi.fn(),
    getEpisodeScriptWriteOperation: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
  };
  registerEpisodeScriptHandlers<Event>(
    (channel, listener) => listeners.set(channel, listener),
    (event) => {
      if (!event.authorized) throw new Error("Unauthorized window");
      return client;
    },
    (event) => event.top,
  );
  const handler = listeners.get(SCRIPT_WRITE_OPERATION_CHANNEL)!;
  const args = [project, episode, operation, payload];
  await expect(handler({ top: false, authorized: true }, ...args)).rejects.toThrow("frame");
  await expect(handler({ top: true, authorized: false }, ...args)).rejects.toThrow("Unauthorized");
  for (const invalid of [
    args.slice(0, 3),
    [...args, "extra"],
    [project, episode, "wrong", payload],
    [project, episode, operation, { ...payload, extra: true }],
  ]) {
    await expect(handler({ top: true, authorized: true }, ...invalid)).rejects.toThrow();
  }
  expect(client.getEpisodeScriptWriteOperation).not.toHaveBeenCalled();
  expect(await handler({ top: true, authorized: true }, ...args)).toEqual({
    kind: "REMOTE_UNKNOWN",
  });
  expect(client.getEpisodeScriptWriteOperation).toHaveBeenCalledWith(...args);
  expect(client.createEpisodeScriptVersion).not.toHaveBeenCalled();
});
