import { readFileSync } from "node:fs";
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SourceExtractionPanel } from "@qa-web/SourceExtractionPanel.tsx";
import { queueSub2APISourceExtract } from "@qa-web/adapters/remoteSourceExtract.ts";

const path = process.env.AC05_RACE_HTTP_CHAIN;
if (!path) throw new Error("AC05_RACE_HTTP_CHAIN must name QA01's real POST CONSUMED capture");
const { steps } = JSON.parse(readFileSync(path, "utf8"));
const queue = steps.queue_201;
const source = queue.command.input.source;
const selection = queue.command.input.selection;
const context = queue.body.data.context_manifest.entries;
const approvedSource = context.find((entry) => entry.kind === "APPROVED_ARTIFACT");
const sourceSpan = context.find((entry) => entry.kind === "SOURCE_SPAN");
const projectId = queue.body.data.project_id;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete window.aijian;
  vi.unstubAllGlobals();
});

async function setup(autoRead) {
  const ids = [queue.command.operation_id];
  vi.stubGlobal("crypto", { randomUUID: () => ids.shift() });
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
    create: async () => ({ kind: "QUEUED", receipt: queue.body, replayed: false }),
  }, window.localStorage, identity)).kind).toBe("QUEUED");
  const bridge = {
    listProviderConnections: vi.fn(async () => ({ data: [] })),
    createSub2APISourceExtractRun: vi.fn(),
    readOriginalSub2APISourceExtractOperation: vi.fn()
      .mockResolvedValueOnce({ kind: "FOUND", runId: queue.body.data.run_id,
        receipt: steps.operation_before_approval_200.body })
      .mockImplementationOnce(autoRead),
    approveSub2APISourceExtractCall: vi.fn(async () => ({
      kind: "CONSUMED", receipt: steps.approval_consumed_race_post_200.body,
    })),
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
  return { bridge, view, props };
}

test("CONSUMED automatically reads the same original run once without another POST", async () => {
  const { bridge } = await setup(async () => ({ kind: "FOUND",
    runId: queue.body.data.run_id, receipt: steps.operation_proposal_ready_200.body }));
  await screen.findByText(/已只读取得原任务提案引用/);
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
    receipt: steps.operation_proposal_ready_200.body })],
])("CONSUMED %s read stays locked with no proposal claim", async (_name, read) => {
  const { bridge } = await setup(read);
  await screen.findByText(/请手动查询原任务，不得再次授权或重试/);
  expect(bridge.approveSub2APISourceExtractCall).toHaveBeenCalledTimes(1);
  expect(bridge.readOriginalSub2APISourceExtractOperation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "明确授权一次 Sub2API 调用" }).disabled).toBe(true);
  expect(screen.queryByText(/已只读取得原任务提案引用/)).toBeNull();
});

test("source context change during automatic GET discards the stale proposal", async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const { bridge, view, props } = await setup(() => pending);
  view.rerender(React.createElement(SourceExtractionPanel,
    { ...props, sourceApproved: false }));
  await act(async () => {
    complete({ kind: "FOUND", runId: queue.body.data.run_id,
      receipt: steps.operation_proposal_ready_200.body });
    await pending;
  });
  expect(screen.queryByText(/已只读取得原任务提案引用/)).toBeNull();
  expect(bridge.approveSub2APISourceExtractCall).toHaveBeenCalledTimes(1);
  expect(bridge.readOriginalSub2APISourceExtractOperation).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "明确授权一次 Sub2API 调用" }).disabled).toBe(true);
});
