// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";

const mock = vi.hoisted(() => ({ transport: null }));
vi.mock("@qa-studio/studio.ts", () => ({ createStudioTransport: () => mock.transport }));

import { SourceExtractionPanel } from "@qa-h87/SourceExtractionPanel.tsx";

const a = `prj_${"a".repeat(32)}`;
const b = `prj_${"b".repeat(32)}`;
const connection = `pcn_${"c".repeat(32)}`;
const sourceId = `src_${"d".repeat(32)}`;
const blockId = `srcb_${"e".repeat(32)}`;
const manifestVersion = `ver_${"f".repeat(32)}`;
const proposalId = `prp_${"1".repeat(32)}`;
const runId = `agr_${"2".repeat(32)}`;
const attemptId = `att_${"3".repeat(32)}`;
const draftId = `ver_${"4".repeat(32)}`;
const artifactId = `art_${"5".repeat(32)}`;
const proposalHash = `sha256:${"6".repeat(64)}`;
function manifest(projectId) {
  const accepted = {
    id: manifestVersion,
    content_hash: `sha256:${"1".repeat(64)}`,
    content: { documents: [{
      source_document_id: sourceId,
      blocks: [{ source_block_id: blockId, ordinal: 0, kind: "paragraph",
        start_byte: 0, end_byte: 20, content_sha256: `sha256:${"2".repeat(64)}` }],
    }] },
  };
  return { data: {
    project_id: projectId,
    head: { latest_version_id: manifestVersion, accepted_version_id: manifestVersion },
    latest_version: accepted,
    accepted_version: accepted,
  } };
}
function connectionResponse() {
  return { data: [{
    id: connection, display_name: "QA CPA TEXT", revision: 2,
    provider_kind: "CPA_LOOPBACK", enabled: true, credential_status: "CONFIGURED",
    models: [{ model_id: "qa03-text", capabilities: ["TEXT"] }],
  }] };
}
function panel(projectId) {
  return React.createElement(SourceExtractionPanel, {
    projectId, sourceManifest: manifest(projectId), sourceDocumentId: sourceId,
    sourceApproved: true,
  });
}

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals(); });

test("switching projects discards an old asynchronous queue response from the visible page", async () => {
  vi.stubGlobal("crypto", { randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" });
  let resolveCreate;
  const create = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
  mock.transport = {
    listProviderConnections: vi.fn(async () => connectionResponse()),
    remoteSourceExtract: { create, readOriginal: vi.fn() },
  };
  const view = render(panel(a));
  await waitFor(() => expect(screen.getByLabelText("CPA 文本连接").options.length).toBe(2));
  fireEvent.change(screen.getByLabelText("来源块"), { target: { value: blockId } });
  fireEvent.change(screen.getByLabelText("CPA 文本连接"), { target: { value: connection } });
  fireEvent.change(screen.getByLabelText("TEXT 模型"), { target: { value: "qa03-text" } });
  fireEvent.click(screen.getByRole("button", { name: "仅入队原来源抽取" }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(create.mock.calls[0][0]).toBe(a);

  view.rerender(panel(b));
  await waitFor(() => expect(screen.getByLabelText("CPA 文本连接").options.length).toBe(2));
  await act(async () => { resolveCreate({ kind: "REMOTE_UNKNOWN" }); });
  expect(screen.queryByText(/排队结果未知：保留本地锁/)).toBeNull();
  expect(screen.queryByText(/原操作 ID/)).toBeNull();
  expect(screen.getByText(/已接受来源版本/)).toBeTruthy();
  expect(create).toHaveBeenCalledTimes(1);
});

function queuedOperation(projectId) {
  return {
    projectId, manifestVersionId: manifestVersion,
    manifestContentHash: `sha256:${"1".repeat(64)}`,
    sourceDocumentId: sourceId, sourceBlockId: blockId,
    sourceBlockHash: `sha256:${"2".repeat(64)}`,
    startByte: 0, endByte: 20, connectionId: connection,
    connectionRevision: 2, modelId: "qa03-text",
    operationId: "123e4567-e89b-42d3-a456-426614174000",
    status: "QUEUED", runId, rejection: null,
  };
}
function readRun(projectId) {
  return { kind: "FOUND_RUN", receipt: { data: {
    project_id: projectId, run_id: runId,
    agent_run: { agent_run_id: runId,
      agent_definition: { definition_id: "writer.source-analyst", version: "1.1.0" } },
    skill_run: { agent_run_id: runId, proposal_id: proposalId,
      skill_definition: { definition_id: "source.extract", version: "1.1.0" } },
  } } };
}
function proposal(projectId) {
  return { data: {
    project_id: projectId, proposal_id: proposalId, producer_attempt_id: attemptId,
    proposal: {
      target_artifact_type: "SourceExtraction", producer_agent_run_id: runId,
      payload_hash: proposalHash, payload: { summary: "经人工核对的摘要" },
      source_spans: [{ source_document_id: sourceId, source_block_id: blockId,
        start_byte: 0, end_byte: 20 }],
    },
  } };
}
function draft(projectId, producerAttemptId = attemptId) {
  return { data: {
    project_id: projectId,
    head: { artifact_id: artifactId, latest_version_id: draftId,
      accepted_version_id: null, revision: 1 },
    version: { id: draftId, artifact_id: artifactId,
      content_hash: proposalHash, content: { summary: "经人工核对的摘要" } },
    provenance: { proposal_id: proposalId, producer_attempt_id: producerAttemptId },
    dependencies: [{ upstream_version_id: manifestVersion,
      relationship: "derived_from", impact: "blocking" }],
    source_spans: [{ source_document_id: sourceId, source_block_id: blockId,
      start_byte: 0, end_byte: 20 }],
  } };
}

test.each([
  ["matching producer", attemptId, true],
  ["wrong producer", `att_${"9".repeat(32)}`, false],
])("human accept triggers exact draft GET and gates %s", async (_name, producer, shouldShow) => {
  window.localStorage.setItem(
    `aivora.remote-source-extract.v1.${a}`, JSON.stringify(queuedOperation(a)),
  );
  const acceptAsDraft = vi.fn(async () => ({ kind: "SUCCEEDED", receipt: { data: {
    project_id: a, proposal_id: proposalId, draft_version_id: draftId,
  } } }));
  const getSourceExtractionVersion = vi.fn(async () => ({ kind: "FOUND", receipt: draft(a, producer) }));
  mock.transport = {
    listProviderConnections: vi.fn(async () => connectionResponse()),
    remoteSourceExtract: { create: vi.fn(), readOriginal: vi.fn(async () => readRun(a)) },
    getArtifactProposal: vi.fn(async () => proposal(a)),
    getSourceExtraction: vi.fn(async () => ({ kind: "NOT_FOUND" })),
    getSourceExtractionVersion,
    proposalDecisions: { acceptAsDraft },
  };
  render(panel(a));
  await waitFor(() => expect(screen.getByRole("button", { name: "查询原 run" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "查询原 run" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "读取来源抽取提案" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "读取来源抽取提案" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "读取 SourceExtraction 最新状态" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "读取 SourceExtraction 最新状态" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "人工接纳为草稿" }).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "人工接纳为草稿" }));
  await waitFor(() => expect(getSourceExtractionVersion).toHaveBeenCalledWith(a, draftId));
  if (shouldShow) {
    await waitFor(() => expect(screen.getByText(/已读回 SourceExtraction 草稿版本/)).toBeTruthy());
  } else {
    await waitFor(() => expect(screen.getByText(/草稿精确读回失败或身份不符/)).toBeTruthy());
    expect(screen.queryByText(/已读回 SourceExtraction 草稿版本/)).toBeNull();
  }
  expect(acceptAsDraft).toHaveBeenCalledTimes(1);
  expect(acceptAsDraft).toHaveBeenCalledWith(a, proposalId, {
    parent_version_id: null, expected_head_revision: null,
  });
});
