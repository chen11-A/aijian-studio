import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { createLocalApiClient } from "@qa-desktop/api-client.ts";
import { sub2APIApprovalIdempotencyKey } from "@qa-desktop/remote-source-extract-v2-contract.ts";

const fixturePath = process.env.AC05_RACE_HTTP_CHAIN;
if (!fixturePath) throw new Error("AC05_RACE_HTTP_CHAIN must name QA01's real-route POST CONSUMED capture");
const { steps } = JSON.parse(readFileSync(fixturePath, "utf8"));
const queue = steps.queue_201.command;
const approval = steps.approval_consumed_race_post_200.command;
const projectId = steps.queue_201.body.data.project_id;
const session = { origin: "http://127.0.0.1:43123", token: "s".repeat(43) };

function reply(step) {
  return new Response(JSON.stringify(step.body), { status: step.http_status,
    headers: { "Content-Type": "application/json", "X-Request-ID": step.x_request_id } });
}

test("real POST 200 CONSUMED race reconciles by GET without another approval POST", async () => {
  const post = steps.approval_consumed_race_post_200;
  expect(post.method).toBe("POST");
  expect(post.http_status).toBe(200);
  expect(post.body.data.status).toBe("CONSUMED");
  expect(post.idempotency_key).toBe(sub2APIApprovalIdempotencyKey(approval));
  expect(post.body.data.scope).toEqual(steps.operation_before_approval_200.body.data.scope);
  const expected = [
    steps.operation_before_approval_200,
    post,
    steps.approval_consumed_readback_200,
    steps.operation_proposal_ready_200,
  ];
  let next = 0;
  const fetcher = vi.fn(async (url, options = {}) => {
    const step = expected[next++];
    expect(step, "unexpected retry or request").toBeDefined();
    expect(new URL(url).pathname).toBe(step.path);
    expect(options.method ?? "GET").toBe(step.method);
    return reply(step);
  });
  const client = createLocalApiClient(fetcher, session);
  const submitted = await client.approveSub2APISourceExtractCall(projectId, queue, approval);
  expect(submitted).toEqual({ kind: "REMOTE_UNKNOWN" });
  const readback = await client.getSub2APISourceExtractApproval(projectId, queue);
  expect(readback).toEqual({ kind: "FOUND", receipt: steps.approval_consumed_readback_200.body });
  expect(readback.receipt.data.status).toBe("CONSUMED");
  expect(readback.receipt.data.approval_id).toBe(post.body.data.approval_id);
  const operation = await client.readOriginalSub2APISourceExtractOperation(projectId, queue);
  expect(operation.kind).toBe("FOUND");
  expect(operation.receipt.data.content_status).toBe("PROPOSAL_READY");
  expect(operation.receipt.data.automatic_retry_allowed).toBe(false);
  expect(operation.receipt.data.cost.status).toBe("UNKNOWN");
  expect(fetcher.mock.calls.map(([, options]) => options.method ?? "GET"))
    .toEqual(["GET", "POST", "GET", "GET"]);
  expect(next).toBe(expected.length);
});
