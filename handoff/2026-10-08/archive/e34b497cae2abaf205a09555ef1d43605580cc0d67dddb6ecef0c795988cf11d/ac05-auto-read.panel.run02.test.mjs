import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SourceExtractionPanel } from "@qa-web/SourceExtractionPanel.tsx";
import { queueSub2APISourceExtract, readSub2APICallApprovalJournal } from "@qa-web/adapters/remoteSourceExtract.ts";

const path = process.env.AC05_RACE_HTTP_CHAIN;
if (!path) throw new Error("AC05_RACE_HTTP_CHAIN must name QA01's real POST CONSUMED capture");
const fixtureBytes = readFileSync(path);
const fixtureSha256 = createHash("sha256").update(fixtureBytes).digest("hex").toUpperCase();
if (fixtureSha256 !== "B8570FE14FCF774BAAB7688AF5E4887E5307102BD468AEB4E6DBFCC4078F1251")
  throw new Error(`AC05 race fixture SHA drift: ${fixtureSha256}`);
const { steps } = JSON.parse(fixtureBytes.toString("utf8"));
const queue = steps.queue_201;
const pending = steps.operation_before_approval_200;
const consumedPost = steps.approval_consumed_race_post_200;
const ready = steps.operation_proposal_ready_200;
if (queue.http_status !== 201 || pending.http_status !== 200 ||
    consumedPost.method !== "POST" || consumedPost.http_status !== 200 ||
    consumedPost.body.data.status !== "CONSUMED" || ready.http_status !== 200 ||
    ready.body.data.content_status !== "PROPOSAL_READY" ||
    typeof ready.body.data.proposal_id !== "string" ||
    consumedPost.body.data.scope.project_id !== queue.body.data.project_id ||
    ready.body.data.scope.project_id !== queue.body.data.project_id ||
    consumedPost.body.data.scope.attempt_fingerprint !== pending.body.data.scope.attempt_fingerprint ||
    ready.body.data.scope.attempt_fingerprint !== pending.body.data.scope.attempt_fingerprint)
  throw new Error("AC05 race fixture is not one matching 201/200/CONSUMED/READY HTTP chain");
const source = queue.command.input.source;
const selection = queue.command.input.selection;
const context = queue.body.data.context_manifest.entries;
const approvedSource = context.find((entry) => entry.kind === "APPROVED_ARTIFACT");
const sourceSpan = context.find((entry) => entry.kind === "SOURCE_SPAN");
const projectId = queue.body.data.project_id;
const runId = queue.body.data.run_id;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete window.aijian;
  vi.unstubAllGlobals();
});

async function setup(autoRead) {
  const ids = [queue.command.operation_id, consumedPost.command.operation_id];
  vi.stubGlobal("crypto", { randomUUID: () => {
    const id = ids.shift();
    if (!id) throw new Error("unexpected third operation identity");
    return id;
  } });
  const identity = {
    projectId, manifestVersionId: source.source_manifest_version_id,
    manifestContentHash: approvedSource.content_hash,
    sourceDocumentId: source.source_document_id,
    sourceBlockId: source.source_block_id,
    sourceBlockHash: sourceSpan.content_hash,
    startByte: source.start_byte, endByte: source.end_byte,
    connectionId: selection.connection_id,
    connectionRevision: selection.connection_revision,
    modelId: selection.model_id,
  };
  expect((await queueSub2APISourceExtract({
    create: async (givenProject, command) => {
      expect(givenProject).toBe(projectId);
      expect(command).toEqual(queue.command);
      return { kind: "QUEUED", receipt: queue.body, replayed: false };
    },
  }, window.localStorage, identity)).kind).toBe("QUEUED");
  let reads = 0;
  const bridge = {
    listProviderConnections: vi.fn(async () => ({ data: [] })),
    createSub2APISourceExtractRun: vi.fn(),
    readOriginalSub2APISourceExtractOperation: vi.fn(async (givenProject, command) => {
      expect(givenProject).toBe(projectId);
      expect(command).toEqual(queue.command);
      reads += 1;
      if (reads === 1) return { kind: "FOUND", runId, receipt: pending.body };
      if (reads === 2) return autoRead();
      throw new Error("unexpected third original-task GET");
    }),
    approveSub2APISourceExtractCall: vi.fn(async (givenProject, original, command) => {
      expect(givenProject).toBe(projectId);
      expect(original).toEqual(queue.command);
      expect(command).toEqual(consumedPost.command);
      return { kind: "CONSUMED", receipt: consumedPost.body };
    }),
    getSub2APISourceExtractApproval: vi.fn(),
  };
  window.aijian = bridge;
  const manifest = { data: {
    project_id: projectId,
    head: { accepted_version_id: identity.manifestVersionId,
      latest_version_id: identity.manifestVersionId },
    latest_version: { id: identity.manifestVersionId,
      content_hash: identity.manifestContentHash },
    accepted_version: { id: identity.manifestVersionId,
      content_hash: identity.manifestContentHash,
      content: { documents: [{ source_document_id: identity.sourceDocumentId,
        blocks: [{ source_block_id: identity.sourceBlockId,
          content_sha256: identity.sourceBlockHash,
          start_byte: identity.startByte, end_byte: identity.endByte,
          ordinal: 0, kind: "paragraph" }] }] } },
  } };
  const props = { projectId, sourceManifest: manifest,
    sourceDocumentId: identity.sourceDocumentId, sourceApproved: true };
  const view = render(React.createElement(SourceExtractionPanel, props));
  await screen.findByText(/当前执行方式：Sub2API/);
  fireEvent.click(screen.getByRole("button", { name: "查询原 run" }));
  await screen.findByText("原任务范围与单次调用许可");
  fireEvent.click(screen.getByLabelText(/明确接受本次最多一次调用的未知费用/));
  fireEvent.click(screen.getByRole("button", { name: "明确授权一次 Sub2API 调用" }));
  await waitFor(() => expect(bridge.readOriginalSub2APISourceExtractOperation)
    .toHaveBeenCalledTimes(2));
  expect(bridge.approveSub2APISourceExtractCall).toHaveBeenCalledTimes(1);
  expect(bridge.getSub2APISourceExtractApproval).not.toHaveBeenCalled();
  expect(bridge.readOriginalSub2APISourceExtractOperation.mock.invocationCallOrder[0])
    .toBeLessThan(bridge.approveSub2APISourceExtractCall.mock.invocationCallOrder[0]);
  expect(bridge.approveSub2APISourceExtractCall.mock.invocationCallOrder[0])
    .toBeLessThan(bridge.readOriginalSub2APISourceExtractOperation.mock.invocationCallOrder[1]);
  return { bridge, view, props };
}

test("CONSUMED automatically reads the same original run once without another POST", async () => {
  const { bridge } = await setup(async () => ({ kind: "FOUND",
    runId, receipt: ready.body }));
  await screen.findByText(/已只读取得原任务提案引用/);
  expect(screen.getByText(/内容状态：PROPOSAL_READY/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "读取来源抽取提案" }).disabled).toBe(false);
  const locked = readSub2APICallApprovalJournal(window.localStorage, projectId, runId);
  expect(locked.kind).toBe("VALID");
  expect(locked.approval.status).toBe("CONSUMED");
  expect(locked.approval.approvalId).toBe(consumedPost.body.data.approval_id);
  expect(bridge.approveSub2APISourceExtractCall).toHaveBeenCalledTimes(1);
  expect(bridge.readOriginalSub2APISourceExtractOperation).toHaveBeenCalledTimes(2);
  expect(bridge.getSub2APISourceExtractApproval).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "明确授权一次 Sub2API 调用" }).disabled).toBe(true);
  expect(screen.getAllByText(/费用仍未知/).length).toBeGreaterThan(0);
});

test.each([
  ["REMOTE_UNKNOWN", async () => ({ kind: "REMOTE_UNKNOWN" })],
  ["NOT_FOUND", async () => ({ kind: "NOT_FOUND", request_id: "request-not-found" })],
  ["wrong run", async () => ({ kind: "FOUND", runId: "agr_" + "f".repeat(32),
    receipt: ready.body })],
  ["wrong project scope", async () => {
    const receipt = structuredClone(ready.body);
    receipt.data.scope.project_id = "prj_" + "f".repeat(32);
    return { kind: "FOUND", runId, receipt };
  }],
])("CONSUMED %s read stays locked with no proposal claim", async (_name, read) => {
  const { bridge } = await setup(read);
  await screen.findByText(/请手动查询原任务，不得再次授权或重试/);
  expect(bridge.approveSub2APISourceExtractCall).toHaveBeenCalledTimes(1);
  expect(bridge.readOriginalSub2APISourceExtractOperation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "明确授权一次 Sub2API 调用" }).disabled).toBe(true);
  expect(screen.getByRole("button", { name: "读取来源抽取提案" }).disabled).toBe(true);
  expect(screen.queryByText(/已只读取得原任务提案引用/)).toBeNull();
});

test("source context change during automatic GET discards the stale proposal", async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const { bridge, view, props } = await setup(() => pending);
  view.rerender(React.createElement(SourceExtractionPanel,
    { ...props, sourceApproved: false }));
  await act(async () => {
    complete({ kind: "FOUND", runId, receipt: ready.body });
    await pending;
  });
  expect(screen.queryByText(/已只读取得原任务提案引用/)).toBeNull();
  expect(bridge.approveSub2APISourceExtractCall).toHaveBeenCalledTimes(1);
  expect(bridge.readOriginalSub2APISourceExtractOperation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "明确授权一次 Sub2API 调用" }).disabled).toBe(true);
});

test("project change during automatic GET discards the stale proposal", async () => {
  let complete;
  const pendingRead = new Promise((resolve) => { complete = resolve; });
  const { bridge, view, props } = await setup(() => pendingRead);
  view.rerender(React.createElement(SourceExtractionPanel,
    { ...props, projectId: "prj_" + "e".repeat(32) }));
  await act(async () => {
    complete({ kind: "FOUND", runId, receipt: ready.body });
    await pendingRead;
  });
  expect(screen.queryByText(/已只读取得原任务提案引用/)).toBeNull();
  expect(bridge.approveSub2APISourceExtractCall).toHaveBeenCalledTimes(1);
  expect(bridge.readOriginalSub2APISourceExtractOperation).toHaveBeenCalledTimes(2);
});
