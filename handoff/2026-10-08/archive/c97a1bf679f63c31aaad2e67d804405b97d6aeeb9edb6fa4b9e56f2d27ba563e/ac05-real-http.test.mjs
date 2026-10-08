import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { createLocalApiClient } from "@qa-desktop/api-client.ts";
import {
  isSub2APIQueueCommand,
  sub2APIApprovalIdempotencyKey,
  sub2APIQueueIdempotencyKey,
} from "@qa-desktop/remote-source-extract-v2-contract.ts";

const fixturePath = process.env.AC05_HTTP_CHAIN;
if (!fixturePath) throw new Error("AC05_HTTP_CHAIN must name QA01's captured real-route HTTP-CHAIN.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const steps = fixture.steps;
const queue = steps.queue_201.command;
const approval = steps.approval_approved_one_call_200.command;
const projectId = steps.queue_201.body.data.project_id;
const proposalId = steps.operation_proposal_ready_200.body.data.proposal_id;
const draftId = steps.acceptance_201.body.data.draft_version_id;
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };

function reply(step) {
  const headers = { "Content-Type": "application/json", "X-Request-ID": step.x_request_id };
  if (step.etag !== null && step.etag !== undefined) headers.ETag = step.etag;
  return new Response(JSON.stringify(step.body), { status: step.http_status, headers });
}

function scriptedFetch(...expectedSteps) {
  let next = 0;
  const fetcher = vi.fn(async (url, options = {}) => {
    const step = expectedSteps[next++];
    expect(step, "unexpected additional HTTP request").toBeDefined();
    expect(new URL(url).pathname).toBe(step.path);
    expect(options.method ?? "GET").toBe(step.method);
    return reply(step);
  });
  return { fetcher, consumed: () => expect(next).toBe(expectedSteps.length) };
}

test("real backend HTTP 201 queue receipt is accepted with the original desktop identity", async () => {
  expect(isSub2APIQueueCommand(queue)).toBe(true);
  expect(steps.queue_201.http_status).toBe(201);
  expect(steps.queue_201.idempotency_key).toBe(sub2APIQueueIdempotencyKey(queue));
  const script = scriptedFetch(steps.queue_201);
  const result = await createLocalApiClient(script.fetcher, session)
    .createSub2APISourceExtractRun(projectId, queue);
  expect(result).toEqual({ kind: "QUEUED", receipt: steps.queue_201.body, replayed: false });
  expect(script.fetcher.mock.calls[0][1].headers["Idempotency-Key"])
    .toBe(steps.queue_201.idempotency_key);
  script.consumed();
});

test("real pending operation authorizes exactly one POST with the server scope", async () => {
  expect(steps.approval_approved_one_call_200.http_status).toBe(200);
  expect(steps.approval_approved_one_call_200.idempotency_key)
    .toBe(sub2APIApprovalIdempotencyKey(approval));
  const script = scriptedFetch(
    steps.operation_before_approval_200,
    steps.approval_approved_one_call_200,
  );
  const result = await createLocalApiClient(script.fetcher, session)
    .approveSub2APISourceExtractCall(projectId, queue, approval);
  expect(result).toEqual({ kind: "APPROVED", receipt: steps.approval_approved_one_call_200.body });
  expect(script.fetcher).toHaveBeenCalledTimes(2);
  expect(script.fetcher.mock.calls[0][1].method).toBeUndefined();
  expect(script.fetcher.mock.calls[1][1].headers["Idempotency-Key"])
    .toBe(steps.approval_approved_one_call_200.idempotency_key);
  expect(JSON.parse(script.fetcher.mock.calls[1][1].body)).toEqual(approval.input);
  script.consumed();
});

test("consumed approval is queryable with the same identity and no new POST", async () => {
  const script = scriptedFetch(
    steps.operation_before_approval_200,
    steps.approval_approved_one_call_200,
    steps.approval_consumed_readback_200,
  );
  const client = createLocalApiClient(script.fetcher, session);
  expect((await client.approveSub2APISourceExtractCall(projectId, queue, approval)).kind)
    .toBe("APPROVED");
  const result = await client.getSub2APISourceExtractApproval(projectId, queue);
  expect(result).toEqual({ kind: "FOUND", receipt: steps.approval_consumed_readback_200.body });
  expect(result.receipt.data.status).toBe("CONSUMED");
  expect(script.fetcher).toHaveBeenCalledTimes(3);
  expect(script.fetcher.mock.calls.map(([, options]) => options.method ?? "GET"))
    .toEqual(["GET", "POST", "GET"]);
  script.consumed();
});

test("V2 proposal and operation retain UNKNOWN cost without numeric replacement", async () => {
  const operation = scriptedFetch(steps.operation_proposal_ready_200);
  const read = await createLocalApiClient(operation.fetcher, session)
    .readOriginalSub2APISourceExtractOperation(projectId, queue);
  expect(read.kind).toBe("FOUND");
  expect(read.receipt.data.content_status).toBe("PROPOSAL_READY");
  expect(read.receipt.data.cost.status).toBe("UNKNOWN");
  expect(read.receipt.data.cost.actual_micros).toBeNull();
  expect(read.receipt.data.automatic_retry_allowed).toBe(false);
  operation.consumed();

  const proposal = scriptedFetch(steps.proposal_v2_200);
  const result = await createLocalApiClient(proposal.fetcher, session)
    .readVersionedSourceExtractionProposal(projectId, proposalId);
  expect(result.kind).toBe("FOUND_V2");
  expect(result.receipt.data.proposal.schema_version).toBe("2.0.0");
  expect(result.receipt.data.proposal.cost.status).toBe("UNKNOWN");
  expect(result.receipt.data.proposal.cost.actual_micros).toBeNull();
  proposal.consumed();
});

test("human acceptance 201 and exact reopened draft preserve distinct schema versions", async () => {
  const acceptance = scriptedFetch(steps.acceptance_201);
  const accepted = await createLocalApiClient(acceptance.fetcher, session)
    .acceptArtifactProposalAsDraft(projectId, proposalId, steps.acceptance_201.command);
  expect(accepted).toEqual({ kind: "SUCCEEDED", receipt: steps.acceptance_201.body });
  expect(accepted.receipt.data.draft_version_id).toBe(draftId);
  acceptance.consumed();

  const reopened = scriptedFetch(steps.draft_reopen_200);
  const draft = await createLocalApiClient(reopened.fetcher, session)
    .getSourceExtractionVersion(projectId, draftId);
  expect(draft.kind).toBe("FOUND");
  expect(draft.receipt.data.version.schema_version).toBe("1.0.0");
  expect(draft.receipt.data.version.id).toBe(draftId);
  reopened.consumed();
});

test("a real receipt cannot be rebound to another project", async () => {
  const otherProject = "prj_" + (projectId.endsWith("a".repeat(32)) ? "b" : "a").repeat(32);
  const fetcher = vi.fn(async () => reply(steps.queue_201));
  const result = await createLocalApiClient(fetcher, session)
    .createSub2APISourceExtractRun(otherProject, queue);
  expect(result).toEqual({ kind: "REMOTE_UNKNOWN" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
