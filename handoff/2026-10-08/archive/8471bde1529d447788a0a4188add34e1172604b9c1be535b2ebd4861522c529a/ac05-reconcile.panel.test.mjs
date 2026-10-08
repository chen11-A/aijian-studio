import { readFileSync } from "node:fs";
import React from "react";
import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

test("Panel restores a tracked CONSUMED run only after explicit read clicks", async () => {
  const ids = [queue.command.operation_id];
  vi.stubGlobal("crypto", { randomUUID: () => ids.shift() });
  const identity = {
    projectId,
    manifestVersionId: source.source_manifest_version_id,
    manifestContentHash: approvedSource.content_hash,
    sourceDocumentId: source.source_document_id,
    sourceBlockId: source.source_block_id,
    sourceBlockHash: sourceSpan.content_hash,
    startByte: source.start_byte, endByte: source.end_byte,
    connectionId: selection.connection_id,
    connectionRevision: selection.connection_revision,
    modelId: selection.model_id,
  };
  const seeded = await queueSub2APISourceExtract({
    create: async () => ({ kind: "QUEUED", receipt: queue.body, replayed: false }),
  }, window.localStorage, identity);
  expect(seeded.kind).toBe("QUEUED");
  const bridge = {
    listProviderConnections: vi.fn(async () => ({ data: [] })),
    createSub2APISourceExtractRun: vi.fn(),
    readOriginalSub2APISourceExtractOperation: vi.fn(async () => ({
      kind: "FOUND", runId: queue.body.data.run_id,
      receipt: steps.operation_before_approval_200.body,
    })),
    approveSub2APISourceExtractCall: vi.fn(),
    getSub2APISourceExtractApproval: vi.fn(async () => ({
      kind: "FOUND", receipt: steps.approval_consumed_readback_200.body,
    })),
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
        blocks: [] }] } },
  } };
  render(React.createElement(SourceExtractionPanel, {
    projectId, sourceManifest: manifest,
    sourceDocumentId: identity.sourceDocumentId, sourceApproved: true,
  }));
  await screen.findByText(/当前执行方式：Sub2API/);
  expect(bridge.readOriginalSub2APISourceExtractOperation).not.toHaveBeenCalled();
  expect(bridge.getSub2APISourceExtractApproval).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查询原 run" }));
  await waitFor(() => expect(bridge.readOriginalSub2APISourceExtractOperation)
    .toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "查询原任务许可" }));
  await waitFor(() => expect(bridge.getSub2APISourceExtractApproval)
    .toHaveBeenCalledTimes(1));
  expect(bridge.approveSub2APISourceExtractCall).not.toHaveBeenCalled();
  expect(screen.getByText(/状态 CONSUMED/)).toBeTruthy();
});
