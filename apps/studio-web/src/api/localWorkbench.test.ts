import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { localWorkbenchTransport } from "./localWorkbench";
import type { UpdateProjectCommand } from "./studio";

const projectId = `prj_${"a".repeat(32)}`;
const episodeId = `ep_${"b".repeat(32)}`;
const requestId = "e6225937-1243-427b-bc98-56eda28e9dd3";
const date = "2026-09-14T00:00:00Z";
const base = `/api/v1/projects/${projectId}`;
const transport = localWorkbenchTransport();
const fetchMock = vi.fn<typeof fetch>();
const project = {
  id: projectId,
  name: "新名称",
  aspect_ratio: "9:16",
  target_duration_seconds: 90,
  source_language: "zh-CN",
  status: "active",
  revision: 2,
  created_at: date,
  updated_at: date,
};
const episode = {
  id: episodeId,
  project_id: projectId,
  position: "1",
  title: "第一集",
  is_default: false,
  target_duration_seconds: null,
  revision: "1",
  created_at: date,
  updated_at: date,
};
function response(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ data, request_id: requestId }), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId, ...headers },
  });
}
function errorResponse(status: number, code: string, patch = {}) {
  return new Response(
    JSON.stringify({
      error: { code, message: "rejected", retryable: false, details: {}, ...patch },
      request_id: requestId,
    }),
    { status, headers: { "Content-Type": "application/json", "X-Request-ID": requestId } },
  );
}
const update = () => transport.updateProject(projectId, { expectedRevision: 1, name: "新名称" });
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("local workbench project updates", () => {
  test.each([1, 2])("accepts exact revision %i for no-op or changed writes", async (revision) => {
    const data = { ...project, revision };
    fetchMock.mockResolvedValue(response(data, 200, { ETag: `"revision-${revision}"` }));
    expect(
      await transport.updateProject(projectId, { expectedRevision: 1, name: " 新名称 " }),
    ).toEqual({ kind: "SUCCEEDED", receipt: { data, request_id: requestId } });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      base,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "新名称" }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "If-Match": '"revision-1"',
        },
        redirect: "error",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
  });
  test("updates only the requested status", async () => {
    fetchMock.mockResolvedValue(
      response({ ...project, status: "archived" }, 200, { ETag: '"revision-2"' }),
    );
    expect(
      await transport.updateProject(projectId, { expectedRevision: 1, status: "archived" }),
    ).toMatchObject({ kind: "SUCCEEDED" });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe('{"status":"archived"}');
  });
  test.each([
    {},
    { expectedRevision: 1 },
    { expectedRevision: 0, name: "name" },
    { expectedRevision: Number.MAX_SAFE_INTEGER, name: "name" },
    { expectedRevision: 1, name: " " },
    { expectedRevision: 1, name: "a\nb" },
    { expectedRevision: 1, name: "a".repeat(81) },
    { expectedRevision: 1, status: "deleted" },
    { expectedRevision: 1, name: "name", extra: true },
  ])("rejects invalid commands before HTTP: %j", async (command) => {
    expect(await transport.updateProject(projectId, command as UpdateProjectCommand)).toEqual({
      kind: "INVALID_INPUT",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("rejects a noncanonical project before HTTP", async () => {
    expect(
      await transport.updateProject("../project", { expectedRevision: 1, name: "name" }),
    ).toEqual({ kind: "INVALID_INPUT" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each([
    { id: `prj_${"c".repeat(32)}` },
    { revision: 3 },
    { name: "another command" },
    { aspect_ratio: "16:9" },
    { target_duration_seconds: 0 },
    { status: "deleted" },
    { created_at: "invalid" },
    { extra: true },
  ])("does not acknowledge a mismatched receipt: %j", async (patch) => {
    fetchMock.mockResolvedValue(response({ ...project, ...patch }, 200, { ETag: '"revision-2"' }));
    expect(await update()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test.each([
    [401, "SIDECAR_AUTH_REQUIRED"],
    [403, "SIDECAR_REQUEST_REJECTED"],
    [404, "PROJECT_NOT_FOUND"],
    [409, "PROJECT_CONFLICT"],
    [412, "PROJECT_PRECONDITION_FAILED"],
    [422, "VALIDATION_ERROR"],
    [428, "PROJECT_PRECONDITION_REQUIRED"],
  ] as const)("preserves verified rejection %i %s without retry", async (status, code) => {
    fetchMock.mockResolvedValue(errorResponse(status, code));
    expect(await update()).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code,
      request_id: requestId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test.each([
    [409, "UNKNOWN_ERROR", {}],
    [500, "PROJECT_CONFLICT", {}],
    [409, "PROJECT_CONFLICT", { retryable: true }],
    [409, "PROJECT_CONFLICT", { details: { unsafe: 4 } }],
    [409, "PROJECT_CONFLICT", { extra: true }],
  ] as const)("does not trust ambiguous rejection %i %s %j", async (status, code, patch) => {
    fetchMock.mockResolvedValue(errorResponse(status, code, patch));
    expect(await update()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("bounded and identity-bound responses", () => {
  test.each<Record<string, string>>([
    { "Content-Type": "text/html" },
    { "Content-Length": "4000001" },
    { "X-Request-ID": "not-a-uuid" },
    { "X-Request-ID": "e6225937-1243-427b-bc98-56eda28e9dd4" },
    { ETag: '"revision-8"' },
  ])("refuses incompatible response headers: %j", async (headers) => {
    fetchMock.mockResolvedValue(response(project, 200, { ETag: '"revision-2"', ...headers }));
    expect(await update()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test.each([null, "{", "[]", '{"data":{},"request_id":"invalid"}'])(
    "refuses absent or malformed envelopes: %s",
    async (body) => {
      fetchMock.mockResolvedValue(
        new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": requestId,
          },
        }),
      );
      expect(await update()).toEqual({ kind: "REMOTE_UNKNOWN" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  test("lost response never replays the PATCH", async () => {
    fetchMock.mockRejectedValue(new TypeError("connection lost"));
    expect(await update()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("cancels an oversized stream even without Content-Length", async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4_000_001));
          },
          cancel,
        }),
        { headers: { "Content-Type": "application/json", "X-Request-ID": requestId } },
      ),
    );
    expect(await update()).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  test("rejects invalid UTF-8 instead of substituting replacement characters", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
      }),
    );
    expect(await update()).toEqual({ kind: "REMOTE_UNKNOWN" });
  });
});

describe("episode identity, ordering and decimal boundaries", () => {
  test("lists canonical decimal positions beyond Number precision without reordering", async () => {
    const data = [
      { ...episode, position: "9007199254740992" },
      { ...episode, id: `ep_${"c".repeat(32)}`, position: "9007199254740993" },
    ];
    fetchMock.mockResolvedValue(response(data));
    expect(
      await transport.episodes.list(projectId, { limit: 2, offset: "9007199254740991" }),
    ).toEqual({ data, request_id: requestId });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      `${base}/episodes?limit=2&offset=9007199254740991`,
      expect.objectContaining({ method: "GET" }),
    );
  });
  test("allows a verified empty default page", async () => {
    fetchMock.mockResolvedValue(response([]));
    expect(await transport.episodes.list(projectId)).toEqual({ data: [], request_id: requestId });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${base}/episodes`);
  });
  test.each([
    { limit: 0 },
    { limit: 101 },
    { offset: "01" },
    { offset: "-1" },
    { offset: "9223372036854775808" },
    { offset: "1".repeat(20) },
    { extra: true },
  ])("rejects invalid pagination before HTTP: %j", async (query) => {
    await expect(transport.episodes.list(projectId, query)).rejects.toThrow(
      "Invalid episode list query",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test.each([
    [episode, episode],
    [
      { ...episode, position: "2" },
      { ...episode, id: `ep_${"c".repeat(32)}`, position: "1" },
    ],
    [{ ...episode, project_id: `prj_${"c".repeat(32)}` }],
    [{ ...episode, position: "0" }],
    [{ ...episode, revision: 1 }],
    [{ ...episode, target_duration_seconds: "0" }],
    [{ ...episode, updated_at: "invalid" }],
  ])("refuses invalid or unordered lists: %j", async (...data) => {
    fetchMock.mockResolvedValue(response(data));
    await expect(transport.episodes.list(projectId)).rejects.toThrow(/could not be verified/);
  });
  test("refuses more items than the requested limit", async () => {
    fetchMock.mockResolvedValue(
      response([episode, { ...episode, id: `ep_${"c".repeat(32)}`, position: "2" }]),
    );
    await expect(transport.episodes.list(projectId, { limit: 1 })).rejects.toThrow(
      "Episode list could not be verified",
    );
  });
  test("gets only the requested episode", async () => {
    fetchMock
      .mockResolvedValueOnce(response(episode))
      .mockResolvedValueOnce(response({ ...episode, id: `ep_${"c".repeat(32)}` }));
    expect(await transport.episodes.get(projectId, episodeId)).toEqual({
      data: episode,
      request_id: requestId,
    });
    await expect(transport.episodes.get(projectId, episodeId)).rejects.toThrow(
      "Episode read could not be verified",
    );
  });
  test.each(["第一集", "\u001c第一集\u0085", "\ufeff第一集\ufeff"])(
    "creates with Python whitespace semantics: %s",
    async (title) => {
      const normalized = title.includes("\ufeff") ? title : "第一集";
      fetchMock.mockResolvedValue(response({ ...episode, title: normalized }, 201));
      expect(await transport.episodes.create(projectId, { title })).toMatchObject({
        kind: "SUCCEEDED",
      });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${base}/episodes`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ title: normalized }),
        }),
      );
    },
  );
  test.each([
    { title: " " },
    { title: "a\nb" },
    { title: "a".repeat(81) },
    { title: "第一集", target_duration_seconds: "01" },
    { title: "第一集", extra: true },
  ])("rejects invalid episode input: %j", async (input) => {
    await expect(transport.episodes.create(projectId, input)).rejects.toThrow(
      "Invalid episode input",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  test("does not confirm a response with another title or duration", async () => {
    fetchMock.mockImplementation(async () => response(episode, 201));
    expect(await transport.episodes.create(projectId, { title: "另一集" })).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(
      await transport.episodes.create(projectId, {
        title: "第一集",
        target_duration_seconds: "90",
      }),
    ).toEqual({ kind: "REMOTE_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  test("returns verified create conflicts without retry", async () => {
    fetchMock.mockResolvedValue(errorResponse(409, "EPISODE_CREATE_CONFLICT"));
    expect(await transport.episodes.create(projectId, { title: "第一集" })).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status: 409,
      code: "EPISODE_CREATE_CONFLICT",
      request_id: requestId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
