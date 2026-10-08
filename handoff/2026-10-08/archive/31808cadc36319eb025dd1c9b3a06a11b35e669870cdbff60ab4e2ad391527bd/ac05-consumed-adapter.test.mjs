import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import {
  approveSub2APIOneCall,
  queueSub2APISourceExtract,
  readOriginalSub2APISourceExtract,
  readSub2APICallApprovalJournal,
  readSub2APIOneCallApproval,
} from "@qa-web/adapters/remoteSourceExtract.ts";

const path = process.env.AC05_RACE_HTTP_CHAIN;
if (!path) throw new Error("AC05_RACE_HTTP_CHAIN must name QA01's real POST CONSUMED capture");
const { steps } = JSON.parse(readFileSync(path, "utf8"));
const queue = steps.queue_201;
const pending = steps.operation_before_approval_200;
const consumedPost = steps.approval_consumed_race_post_200;
const consumedRead = steps.approval_consumed_readback_200;
const ready = steps.operation_proposal_ready_200;
const source = queue.command.input.source;
const selection = queue.command.input.selection;
const context = queue.body.data.context_manifest.entries;
const approvedSource = context.find((entry) => entry.kind === "APPROVED_ARTIFACT");
const sourceSpan = context.find((entry) => entry.kind === "SOURCE_SPAN");
const projectId = queue.body.data.project_id;
const runId = queue.body.data.run_id;

function storage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

test("real CONSUMED POST persists a locked approval and only reads thereafter", async () => {
  expect(approvedSource).toBeDefined();
  expect(sourceSpan).toBeDefined();
  const ids = [queue.command.operation_id, consumedPost.command.operation_id];
  vi.stubGlobal("crypto", { randomUUID: () => {
    const id = ids.shift();
    if (!id) throw new Error("unexpected new operation identity");
    return id;
  } });
  try {
    const journal = storage();
    const identity = {
      projectId,
      manifestVersionId: source.source_manifest_version_id,
      manifestContentHash: approvedSource.content_hash,
      sourceDocumentId: source.source_document_id,
      sourceBlockId: source.source_block_id,
      sourceBlockHash: sourceSpan.content_hash,
      startByte: source.start_byte,
      endByte: source.end_byte,
      connectionId: selection.connection_id,
      connectionRevision: selection.connection_revision,
      modelId: selection.model_id,
    };
    const operationResponses = [pending.body, ready.body];
    const capability = {
      create: vi.fn(async (givenProject, command) => {
        expect(givenProject).toBe(projectId);
        expect(command).toEqual(queue.command);
        return { kind: "QUEUED", receipt: queue.body, replayed: false };
      }),
      readOriginal: vi.fn(async (givenProject, command) => {
        expect(givenProject).toBe(projectId);
        expect(command).toEqual(queue.command);
        const receipt = operationResponses.shift();
        expect(receipt, "unexpected operation read").toBeDefined();
        return { kind: "FOUND", runId, receipt };
      }),
      approve: vi.fn(async (givenProject, original, command) => {
        expect(givenProject).toBe(projectId);
        expect(original).toEqual(queue.command);
        expect(command).toEqual(consumedPost.command);
        return { kind: "CONSUMED", receipt: consumedPost.body };
      }),
      readApproval: vi.fn(async (givenProject, original) => {
        expect(givenProject).toBe(projectId);
        expect(original).toEqual(queue.command);
        return { kind: "FOUND", receipt: consumedRead.body };
      }),
    };
    const created = await queueSub2APISourceExtract(capability, journal, identity);
    expect(created.kind).toBe("QUEUED");
    const original = created.operation;
    const before = await readOriginalSub2APISourceExtract(capability, journal, original);
    expect(before.kind).toBe("FOUND");
    expect(before.queueBinding).toBe("VERIFIED");
    const approved = await approveSub2APIOneCall(capability, journal, original, before, true);
    expect(approved.kind).toBe("CONSUMED");
    expect(approved.response).toEqual(consumedPost.body);
    const locked = readSub2APICallApprovalJournal(journal, projectId, runId);
    expect(locked.kind).toBe("VALID");
    expect(locked.approval.status).toBe("CONSUMED");
    expect(locked.approval.approvalId).toBe(consumedPost.body.data.approval_id);
    const again = await approveSub2APIOneCall(capability, journal, original, before, true);
    expect(again.kind).toBe("TRACKED");
    const readback = await readSub2APIOneCallApproval(capability, journal, original, before);
    expect(readback.kind).toBe("FOUND");
    expect(readback.response.data.status).toBe("CONSUMED");
    const result = await readOriginalSub2APISourceExtract(capability, journal, original);
    expect(result.kind).toBe("FOUND");
    expect(result.response.data.content_status).toBe("PROPOSAL_READY");
    expect(result.response.data.cost.status).toBe("UNKNOWN");
    expect(capability.create).toHaveBeenCalledTimes(1);
    expect(capability.approve).toHaveBeenCalledTimes(1);
    expect(capability.readApproval).toHaveBeenCalledTimes(1);
    expect(capability.readOriginal).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});
