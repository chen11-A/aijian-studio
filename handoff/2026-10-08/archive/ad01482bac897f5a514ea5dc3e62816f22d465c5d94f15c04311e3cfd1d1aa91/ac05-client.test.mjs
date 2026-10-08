import { expect, test, vi } from "vitest";
import { createLocalApiClient } from "@qa-desktop/api-client.ts";
import {
  isSub2APIQueueCommand,
  sub2APIQueueIdempotencyKey,
} from "@qa-desktop/remote-source-extract-v2-contract.ts";

const projectId = "prj_" + "a".repeat(32);
const proposalId = "prp_" + "b".repeat(32);
const requestId = "88ed7974-adc3-4e35-a5c8-38b9674fc45c";
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };
const queue = {
  operation_id: requestId,
  input: {
    source: {
      agent_definition: { definition_id: "writer.source-analyst-sub2api", version: "1.0.0" },
      skill_definition: { definition_id: "source.extract-sub2api", version: "1.0.0" },
      source_manifest_version_id: "ver_" + "c".repeat(32),
      source_document_id: "src_" + "d".repeat(32),
      source_block_id: "srcb_" + "e".repeat(32),
      start_byte: 0, end_byte: 8,
    },
    selection: { connection_id: "pcn_" + "f".repeat(32), connection_revision: 1, model_id: "text-model" },
  },
};
const approval = {
  operation_id: "0cd71673-fdd4-4bee-8a8d-4e535940bc91",
  input: {
    task_id: "task_" + "a".repeat(32), attempt_id: "att_" + "b".repeat(32),
    expected_attempt_fingerprint: "sha256:" + "c".repeat(64),
    unknown_cost_accepted: true, allowed_calls: 1,
  },
};
function reply(body, status) {
  return new Response(JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId } });
}

test("V2 queue rejects an invalid command before network IO", async () => {
  const fetcher = vi.fn();
  await expect(createLocalApiClient(fetcher, session)
    .createSub2APISourceExtractRun(projectId, { ...queue, input: { ...queue.input, extra: true } }))
    .rejects.toThrow(/exact Sub2API queue command/);
  expect(fetcher).not.toHaveBeenCalled();
});

test("V2 queue sends one scoped POST and treats network failure as UNKNOWN", async () => {
  expect(isSub2APIQueueCommand(queue)).toBe(true);
  const fetcher = vi.fn(async () => { throw new Error("offline"); });
  const result = await createLocalApiClient(fetcher, session).createSub2APISourceExtractRun(projectId, queue);
  expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe(session.origin + "/api/v1/projects/" + projectId + "/sub2api-source-extract-runs");
  expect(options.method).toBe("POST");
  expect(options.headers["Idempotency-Key"]).toBe(sub2APIQueueIdempotencyKey(queue));
  expect(JSON.parse(options.body)).toEqual(queue.input);
});

test("exact 503 is definite, malformed success stays UNKNOWN, and neither auto-retries", async () => {
  const error = { request_id: requestId,
    error: { code: "SUB2API_EXECUTION_UNAVAILABLE", message: "unavailable",
      details: {}, retryable: false } };
  const unavailable = vi.fn(async () => reply(error, 503));
  expect(await createLocalApiClient(unavailable, session).createSub2APISourceExtractRun(projectId, queue))
    .toEqual({ kind: "DEFINITE_SERVER_ERROR", status: 503,
      code: "SUB2API_EXECUTION_UNAVAILABLE", request_id: requestId });
  expect(unavailable).toHaveBeenCalledTimes(1);
  const malformed = vi.fn(async () => reply({ request_id: requestId, data: {} }, 201));
  expect(await createLocalApiClient(malformed, session).createSub2APISourceExtractRun(projectId, queue))
    .toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(malformed).toHaveBeenCalledTimes(1);
});

test("one-call approval reads original operation before mutation and does not POST on UNKNOWN", async () => {
  const fetcher = vi.fn(async () => { throw new Error("read failed"); });
  expect(await createLocalApiClient(fetcher, session)
    .approveSub2APISourceExtractCall(projectId, queue, approval))
    .toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
});

test("versioned proposal read distinguishes exact 404 from network UNKNOWN", async () => {
  const missing = { request_id: requestId,
    error: { code: "ARTIFACT_PROPOSAL_NOT_FOUND", message: "missing",
      details: {}, retryable: false } };
  const fetcher = vi.fn(async () => reply(missing, 404));
  expect(await createLocalApiClient(fetcher, session)
    .readVersionedSourceExtractionProposal(projectId, proposalId))
    .toEqual({ kind: "NOT_FOUND", request_id: requestId });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const offline = vi.fn(async () => { throw new Error("offline"); });
  expect(await createLocalApiClient(offline, session)
    .readVersionedSourceExtractionProposal(projectId, proposalId))
    .toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(offline).toHaveBeenCalledTimes(1);
});
