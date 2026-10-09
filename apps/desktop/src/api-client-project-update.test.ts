import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import type { ProjectUpdateCommand } from "./project-update-contract";

const projectId = `prj_${"a".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const command: ProjectUpdateCommand = {
  expectedRevision: 1,
  name: "Synthetic",
  status: "archived",
};
function receipt(change = {}) {
  return {
    request_id: requestId,
    data: {
      id: projectId,
      name: "Synthetic",
      status: "archived",
      revision: 2,
      aspect_ratio: "9:16",
      target_duration_seconds: 90,
      source_language: "zh-CN",
      created_at: "2026-09-14T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
      ...change,
    },
  };
}
function response(change = {}, headers = {}) {
  return Response.json(receipt(change), {
    headers: { "X-Request-ID": requestId, ETag: '"revision-2"', ...headers },
  });
}

describe("persistent project update API", () => {
  test.each([
    { expectedRevision: 1, name: "  Synthetic  " },
    { expectedRevision: 1, status: "archived" as const },
    command,
  ])("sends exactly one revision-bound PATCH %#", async (input) => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => response());
    expect(await createLocalApiClient(fetcher, session).updateProject(projectId, input)).toEqual({
      kind: "SUCCEEDED",
      receipt: receipt(),
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${session.origin}/api/v1/projects/${projectId}`);
    expect(init).toMatchObject({
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "If-Match": '"revision-1"',
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      ...("name" in input ? { name: "Synthetic" } : {}),
      ...("status" in input ? { status: "archived" } : {}),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("accepts a matching no-op receipt without requiring a new revision", async () => {
    const fetcher = vi.fn(async () => response({ revision: 1 }, { ETag: '"revision-1"' }));
    expect(await createLocalApiClient(fetcher, session).updateProject(projectId, command)).toEqual({
      kind: "SUCCEEDED",
      receipt: receipt({ revision: 1 }),
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each([
    { id: `prj_${"b".repeat(32)}` },
    { revision: 4 },
    { name: "Other" },
    { status: "active" },
    { unexpected: true },
  ])("does not call a mismatched receipt success or replay the write %#", async (change) => {
    const fetcher = vi.fn(async () => response(change));
    expect(await createLocalApiClient(fetcher, session).updateProject(projectId, command)).toEqual({
      kind: "REMOTE_UNKNOWN",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each(["network", "JSON", "receipt", "request ID", "ETag", "HTTP"])(
    "preserves unknown after %s failure without retry",
    async (kind) => {
      const fetcher = vi.fn(async () => {
        if (kind === "network") throw new Error("connection lost");
        if (kind === "JSON") return new Response("{");
        if (kind === "receipt") return Response.json(receipt());
        if (kind === "request ID") return response({}, { "X-Request-ID": "mismatch" });
        if (kind === "ETag") return response({}, { ETag: '"revision-99"' });
        return Response.json({ error: "not trusted" }, { status: 500 });
      });
      expect(
        await createLocalApiClient(fetcher, session).updateProject(projectId, command),
      ).toEqual({
        kind: "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  test.each([
    [401, "SIDECAR_AUTH_REQUIRED"],
    [403, "SIDECAR_REQUEST_REJECTED"],
    [404, "PROJECT_NOT_FOUND"],
    [409, "PROJECT_CONFLICT"],
    [412, "PROJECT_PRECONDITION_FAILED"],
    [422, "VALIDATION_ERROR"],
    [428, "PROJECT_PRECONDITION_REQUIRED"],
  ] as const)("retains definite server rejection %s", async (status, code) => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          request_id: requestId,
          error: { code, message: "Synthetic rejection", retryable: false, details: {} },
        },
        { status, headers: { "X-Request-ID": requestId } },
      ),
    );
    expect(await createLocalApiClient(fetcher, session).updateProject(projectId, command)).toEqual({
      kind: "DEFINITE_SERVER_ERROR",
      status,
      code,
      request_id: requestId,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each([
    { expectedRevision: 0, name: "Synthetic" },
    { expectedRevision: 1, name: " " },
    { expectedRevision: 1 },
    { expectedRevision: 1, name: "Synthetic", unexpected: true },
  ])("rejects invalid input before sending a write %#", async (input) => {
    const fetcher = vi.fn();
    expect(await createLocalApiClient(fetcher, session).updateProject(projectId, input)).toEqual({
      kind: "INVALID_INPUT",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("rejects a noncanonical project before HTTP", async () => {
    const fetcher = vi.fn();
    expect(
      await createLocalApiClient(fetcher, session).updateProject("../project", command),
    ).toEqual({
      kind: "INVALID_INPUT",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
