import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createLocalApiClient } from "./api-client";
import {
  isSub2APIQueueCommand,
  isSub2APIOperationResponse,
  isSub2APIApprovalResponse,
  sub2APIRunId,
  sub2APIApprovalIdempotencyKey,
  sub2APIQueueIdempotencyKey,
  type Sub2APIApprovalCommand,
} from "./remote-source-extract-v2-contract";

const rows: {
  mode: string;
  projectId: string;
  command: unknown;
  operation: unknown;
  approval: unknown;
}[] = JSON.parse(readFileSync(resolve(__dirname, "fixtures/sub2api-wire.json"), "utf8"));
const requestId = "00000000-0000-4000-8000-000000000001";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const fixtures = rows.map((row) => {
  const { projectId, command, operation, approval } = row;
  if (
    !isSub2APIQueueCommand(command) ||
    !isSub2APIOperationResponse(operation, projectId, command, requestId) ||
    !isSub2APIApprovalResponse(approval, projectId, command, requestId)
  )
    throw new Error("Invalid real-store wire fixture");
  const scope = operation.data.scope;
  const approvalCommand: Sub2APIApprovalCommand = {
    operation_id: "123e4567-e89b-42d3-a456-426614174000",
    input: {
      task_id: scope.task_id,
      attempt_id: scope.attempt_id,
      expected_attempt_fingerprint: scope.attempt_fingerprint,
      unknown_cost_accepted: true,
      allowed_calls: 1,
    },
  };
  return { ...row, projectId, command, operation, approval, approvalCommand };
});
function wire(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "X-Request-ID": requestId } });
}
function rejection(code: string, status: number) {
  return wire(
    {
      request_id: requestId,
      error: { code, message: "Synthetic rejection", retryable: false, details: {} },
    },
    status,
  );
}

describe.each(fixtures)("$mode Sub2API one-call approval boundary", (fixture) => {
  const { projectId, command, operation, approval, approvalCommand } = fixture;
  const runId = sub2APIRunId(projectId, command);

  test("reads operation and approval under the original identity without submitting", async () => {
    const fetcher = vi
      .fn(async (_url: string, _init?: RequestInit) => wire(operation))
      .mockResolvedValueOnce(wire(operation))
      .mockResolvedValueOnce(wire(approval));
    const client = createLocalApiClient(fetcher, session);
    expect(await client.readOriginalSub2APISourceExtractOperation(projectId, command)).toEqual({
      kind: "FOUND",
      runId,
      receipt: operation,
    });
    expect(await client.getSub2APISourceExtractApproval(projectId, command)).toEqual({
      kind: "FOUND",
      receipt: approval,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${session.origin}/api/v1/projects/${projectId}/sub2api-source-extract-runs/${runId}/operation`,
      `${session.origin}/api/v1/projects/${projectId}/sub2api-source-extract-runs/${runId}/approval`,
    ]);
    expect(fetcher.mock.calls.every(([, init]) => init?.body === undefined)).toBe(true);
  });

  test.each(["APPROVED_ONE_CALL", "CONSUMED", "EXPIRED"] as const)(
    "handles approval receipt %s with one bounded POST",
    async (status) => {
      const receipt = { ...approval, data: { ...approval.data, status } };
      const fetcher = vi
        .fn(async (_url: string, _init?: RequestInit) => wire(operation))
        .mockResolvedValueOnce(wire(operation))
        .mockResolvedValueOnce(wire(receipt));
      const result = await createLocalApiClient(fetcher, session).approveSub2APISourceExtractCall(
        projectId,
        command,
        approvalCommand,
      );
      expect(result).toEqual(
        status === "EXPIRED"
          ? { kind: "REMOTE_UNKNOWN" }
          : {
              kind: status === "CONSUMED" ? "CONSUMED" : "APPROVED",
              receipt,
            },
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls[1]![1]).toMatchObject({
        method: "POST",
        headers: {
          "Idempotency-Key": sub2APIApprovalIdempotencyKey(approvalCommand),
        },
      });
      expect(JSON.parse(String(fetcher.mock.calls[1]![1]?.body))).toEqual(approvalCommand.input);
    },
  );

  test.each(["mismatched attempt", "already approved", "not found", "forbidden", "unknown"])(
    "does not POST approval when the current operation is %s",
    async (outcome) => {
      const changed = structuredClone(operation);
      if (outcome === "mismatched attempt") changed.data.scope.attempt_id = `att_${"9".repeat(32)}`;
      if (outcome === "already approved") changed.data.approval_id = approval.data.approval_id;
      const fetcher = vi.fn(async () => {
        if (outcome === "not found") return rejection("SUB2API_RUN_NOT_FOUND", 404);
        if (outcome === "forbidden") return rejection("SIDECAR_REQUEST_REJECTED", 403);
        if (outcome === "unknown") throw new Error("lost readback");
        return wire(changed);
      });
      expect(
        await createLocalApiClient(fetcher, session).approveSub2APISourceExtractCall(
          projectId,
          command,
          approvalCommand,
        ),
      ).toMatchObject({
        kind: ["not found", "forbidden"].includes(outcome)
          ? "DEFINITE_SERVER_ERROR"
          : "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );

  test.each(["network", "JSON", "bad receipt", "definite", "untrusted"])(
    "does not repeat approval after %s reply",
    async (outcome) => {
      const fetcher = vi
        .fn(async () => wire(operation))
        .mockResolvedValueOnce(wire(operation))
        .mockImplementationOnce(async () => {
          if (outcome === "network") throw new Error("lost approval reply");
          if (outcome === "JSON") return new Response("{");
          if (outcome === "definite") return rejection("SUB2API_APPROVAL_CONFLICT", 409);
          return wire({}, outcome === "untrusted" ? 500 : 200);
        });
      expect(
        await createLocalApiClient(fetcher, session).approveSub2APISourceExtractCall(
          projectId,
          command,
          approvalCommand,
        ),
      ).toMatchObject({
        kind: outcome === "definite" ? "DEFINITE_SERVER_ERROR" : "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  test.each(["operation", "approval"] as const)(
    "%s read classifies absence and transport failures without writes",
    async (kind) => {
      for (const outcome of ["network", "JSON", "receipt", "not found", "forbidden", "untrusted"]) {
        const fetcher = vi.fn(async () => {
          if (outcome === "network") throw new Error("lost read reply");
          if (outcome === "JSON") return new Response("{");
          if (outcome === "not found")
            return rejection(
              kind === "operation" ? "SUB2API_RUN_NOT_FOUND" : "SUB2API_APPROVAL_NOT_FOUND",
              404,
            );
          if (outcome === "forbidden") return rejection("SIDECAR_REQUEST_REJECTED", 403);
          return wire({}, outcome === "untrusted" ? 500 : 200);
        });
        const client = createLocalApiClient(fetcher, session);
        expect(
          await (kind === "operation"
            ? client.readOriginalSub2APISourceExtractOperation(projectId, command)
            : client.getSub2APISourceExtractApproval(projectId, command)),
        ).toMatchObject({
          kind:
            outcome === "not found"
              ? "NOT_FOUND"
              : outcome === "forbidden"
                ? "DEFINITE_SERVER_ERROR"
                : "REMOTE_UNKNOWN",
        });
        expect(fetcher).toHaveBeenCalledOnce();
      }
    },
  );

  test.each(["network", "JSON", "receipt", "definite", "untrusted"])(
    "queue creation retains identity after %s without replay",
    async (outcome) => {
      const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => {
        if (outcome === "network") throw new Error("lost queue reply");
        if (outcome === "JSON") return new Response("{");
        if (outcome === "definite") return rejection("SUB2API_QUEUE_CONFLICT", 409);
        return wire({}, outcome === "untrusted" ? 500 : 201);
      });
      expect(
        await createLocalApiClient(fetcher, session).createSub2APISourceExtractRun(
          projectId,
          command,
        ),
      ).toMatchObject({
        kind: outcome === "definite" ? "DEFINITE_SERVER_ERROR" : "REMOTE_UNKNOWN",
      });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(fetcher.mock.calls[0]![1]).toMatchObject({
        method: "POST",
        headers: { "Idempotency-Key": sub2APIQueueIdempotencyKey(command) },
      });
      expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toEqual(command.input);
    },
  );

  test("rejects noncanonical command and project before any HTTP", async () => {
    const fetcher = vi.fn();
    const client = createLocalApiClient(fetcher, session);
    await expect(
      client.createSub2APISourceExtractRun(projectId, { ...command, operation_id: "invalid" }),
    ).rejects.toThrow();
    await expect(
      client.readOriginalSub2APISourceExtractOperation("../project", command),
    ).rejects.toThrow();
    await expect(client.getSub2APISourceExtractApproval("../project", command)).rejects.toThrow();
    await expect(
      client.approveSub2APISourceExtractCall(projectId, command, {
        ...approvalCommand,
        operation_id: "invalid",
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
