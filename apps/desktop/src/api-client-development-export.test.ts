import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import type { DevelopmentExportCreateInput } from "./development-export-contract";

const project = `prj_${"a".repeat(32)}`;
const exportId = `dex_${"b".repeat(32)}`;
const requestId = "123e4567-e89b-42d3-a456-426614174000";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const input: DevelopmentExportCreateInput = {
  operation_id: requestId,
  timeline_version_id: `ver_${"c".repeat(32)}`,
  expected_revision: 2,
  purpose: "DEVELOPMENT_EVIDENCE",
};
const unknown = { kind: "REMOTE_UNKNOWN", project_id: project, operation_id: input.operation_id };
function receipt(status: "SUCCEEDED" | "UNKNOWN") {
  return {
    request_id: requestId,
    data: {
      project_id: project,
      export_id: exportId,
      operation_id: input.operation_id,
      timeline_version_id: input.timeline_version_id,
      timeline_content_hash: `sha256:${"d".repeat(64)}`,
      timeline_revision: 2,
      purpose: "DEVELOPMENT_EVIDENCE",
      status,
      ...(status === "UNKNOWN"
        ? { error_code: "REMOTE_UNKNOWN", message: "Pending readback" }
        : {
            output: {
              workspace_scope: "SIDECAR_WORKSPACE",
              relative_path: `exports/development-timeline/${project}/${exportId}.mp4`,
              mime_type: "video/mp4",
              sha256: `sha256:${"e".repeat(64)}`,
              byte_length: 1024,
              width: 1080,
              height: 1920,
              frame_rate_num: 24,
              frame_rate_den: 1,
              duration_frames: 48,
              duration_seconds: 2,
              has_audio: false,
            },
          }),
    },
  };
}
function error(code: string, details = {}, retryable = false) {
  return {
    request_id: requestId,
    error: { code, message: "Synthetic rejection", retryable, details },
  };
}

describe("development export identity and readback transport", () => {
  test.each(["SUCCEEDED", "UNKNOWN"] as const)(
    "retains exact %s receipts for create and read",
    async (status) => {
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) =>
        Response.json(receipt(status)),
      );
      const client = createLocalApiClient(fetcher, session);
      expect(await client.createDevelopmentExport(project, input)).toEqual(receipt(status));
      expect(
        await client.getDevelopmentExport(
          project,
          input.operation_id,
          input.timeline_version_id,
          2,
        ),
      ).toEqual(receipt(status));
      expect(fetcher).toHaveBeenCalledTimes(2);
      const [createUrl, createInit] = fetcher.mock.calls[0]!;
      expect(createUrl).toBe(`${session.origin}/api/v1/projects/${project}/development-exports`);
      expect(createInit?.method).toBe("POST");
      expect(JSON.parse(String(createInit?.body))).toEqual(input);
      const [readUrl, readInit] = fetcher.mock.calls[1]!;
      expect(readUrl).toBe(`${createUrl}/${input.operation_id}`);
      expect(readInit?.body).toBeUndefined();
    },
  );

  test.each(["network", "503", "bad JSON", "bad receipt", "untrusted error", "non-JSON error"])(
    "does not replay create after %s",
    async (outcome) => {
      const fetcher = vi.fn(async () => {
        if (outcome === "network") throw new Error("lost connection");
        if (outcome === "503") return new Response("unavailable", { status: 503 });
        if (outcome === "bad JSON") return new Response("{");
        if (outcome === "bad receipt") return Response.json({ ...receipt("SUCCEEDED"), data: {} });
        if (outcome === "non-JSON error") return new Response("{", { status: 409 });
        return Response.json({ error: "untrusted" }, { status: 409 });
      });
      expect(
        await createLocalApiClient(fetcher, session).createDevelopmentExport(project, input),
      ).toEqual(unknown);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  test.each([
    [401, "SIDECAR_AUTH_REQUIRED", "RESTORE_AUTH"],
    [403, "SIDECAR_REQUEST_REJECTED", "RESTORE_AUTH"],
    [404, "PROJECT_NOT_FOUND", "REVIEW_INPUT"],
    [404, "TIMELINE_NOT_FOUND", "REVIEW_INPUT"],
    [404, "DEVELOPMENT_EXPORT_NOT_FOUND", "REVIEW_INPUT"],
    [409, "DEVELOPMENT_EXPORT_CONFLICT", "RECONCILE_OPERATION"],
    [422, "VALIDATION_ERROR", "REVIEW_INPUT"],
    [422, "DEVELOPMENT_EXPORT_INVALID", "REVIEW_INPUT"],
  ] as const)("retains a definite %s %s rejection", async (status, code, disposition) => {
    const fetcher = vi.fn(async () => Response.json(error(code), { status }));
    expect(
      await createLocalApiClient(fetcher, session).createDevelopmentExport(project, input),
    ).toEqual({
      kind: "DEFINITE_REJECTION",
      project_id: project,
      operation_id: input.operation_id,
      timeline_version_id: input.timeline_version_id,
      expected_revision: 2,
      status,
      code,
      request_id: requestId,
      disposition,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each([true, false])(
    "accepts preflight no-claim only with exact operation binding: %s",
    async (matching) => {
      const fetcher = vi.fn(async () =>
        Response.json(
          error("DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED", {
            project_id: project,
            operation_id: matching ? input.operation_id : "other",
            timeline_version_id: input.timeline_version_id,
            expected_revision: "2",
            request_effect: "NO_EXPORT_CLAIM",
          }),
          { status: 422 },
        ),
      );
      const result = await createLocalApiClient(fetcher, session).createDevelopmentExport(
        project,
        input,
      );
      expect(result).toMatchObject(
        matching
          ? {
              kind: "DEFINITE_REJECTION",
              disposition: "REVIEW_INPUT",
              request_effect: "NO_EXPORT_CLAIM",
            }
          : unknown,
      );
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  test.each([
    [409, error("UNRECOGNIZED")],
    [500, error("DEVELOPMENT_EXPORT_CONFLICT")],
    [409, error("DEVELOPMENT_EXPORT_CONFLICT", { unexpected: "value" })],
    [409, error("DEVELOPMENT_EXPORT_CONFLICT", {}, true)],
  ] as const)("keeps unmatched error contract unknown %#", async (status, body) => {
    const fetcher = vi.fn(async () => Response.json(body, { status }));
    expect(
      await createLocalApiClient(fetcher, session).createDevelopmentExport(project, input),
    ).toEqual(unknown);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  test.each(["network", "503", "JSON", "receipt", "definite", "non-JSON error"])(
    "classifies read failure %s without submitting an export",
    async (outcome) => {
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
        if (outcome === "network") throw new Error("lost connection");
        if (outcome === "503") return new Response("", { status: 503 });
        if (outcome === "JSON") return new Response("{");
        if (outcome === "receipt") return Response.json({});
        if (outcome === "non-JSON error") return new Response("{", { status: 404 });
        return Response.json(error("DEVELOPMENT_EXPORT_NOT_FOUND"), { status: 404 });
      });
      await expect(
        createLocalApiClient(fetcher, session).getDevelopmentExport(
          project,
          input.operation_id,
          input.timeline_version_id,
          2,
        ),
      ).rejects.toMatchObject({
        kind: ["definite", "non-JSON error"].includes(outcome) ? "UNAVAILABLE" : "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]![1]?.body).toBeUndefined();
    },
  );

  test("rejects invalid create and read identities before HTTP", async () => {
    const fetcher = vi.fn();
    const client = createLocalApiClient(fetcher, session);
    await expect(client.createDevelopmentExport("../project", input)).rejects.toThrow();
    await expect(
      client.createDevelopmentExport(project, { ...input, expected_revision: 0 }),
    ).rejects.toThrow();
    await expect(
      client.getDevelopmentExport(project, "bad", input.timeline_version_id, 2),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
