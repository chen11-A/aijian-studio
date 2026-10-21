import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { SourceManifestResponse, StudioTransport } from "../api/studio";
import type * as StudioModule from "../api/studio";
import { SourceExtractionPanel } from "./SourceExtractionPanel";
import {
  originalRemoteSourceExtractCommand,
  type RemoteSourceExtractOperation,
} from "./adapters/remoteSourceExtract";

let transport: Partial<StudioTransport>;
vi.mock("../api/studio", async (original) => ({
  ...(await original<typeof StudioModule>()),
  createStudioTransport: () => transport,
}));
const projectId = `prj_${"1".repeat(32)}`;
const versionId = `ver_${"2".repeat(32)}`;
const sourceId = `src_${"3".repeat(32)}`;
const blockId = `srcb_${"4".repeat(32)}`;
const connectionId = `pcn_${"5".repeat(32)}`;
const runId = `agr_${"6".repeat(32)}`;
const proposalId = `prp_${"7".repeat(32)}`;
const attemptId = `att_${"8".repeat(32)}`;
const artifactId = `art_${"9".repeat(32)}`;
const draftId = `ver_${"a".repeat(32)}`;
const hash = `sha256:${"b".repeat(64)}`;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const date = "2026-10-10T00:00:00Z";
const operation: RemoteSourceExtractOperation = {
  projectId,
  manifestVersionId: versionId,
  manifestContentHash: hash,
  sourceDocumentId: sourceId,
  sourceBlockId: blockId,
  sourceBlockHash: hash,
  startByte: 0,
  endByte: 12,
  connectionId,
  connectionRevision: 1,
  modelId: "fixture-model",
  operationId,
  status: "QUEUED",
  runId,
  rejection: null,
};
const queueKey = `aivora.remote-source-extract.v1.${projectId}`;
function manifest(): SourceManifestResponse {
  const version: SourceManifestResponse["data"]["latest_version"] = {
    id: versionId,
    artifact_id: artifactId,
    version_number: 1,
    schema_version: "1.0.0",
    content_hash: hash,
    parent_version_id: null,
    change_summary: "fixture",
    created_at: date,
    content: {
      scope_type: "full_work",
      documents: [
        {
          source_document_id: sourceId,
          filename: "source.txt",
          raw_sha256: hash,
          normalized_sha256: hash,
          byte_size: 12,
          media_type: "text/plain",
          encoding: "utf-8",
          import_order: 0,
          chapter_count: 1,
          blocks: [
            {
              source_block_id: blockId,
              kind: "paragraph",
              ordinal: 0,
              chapter_index: 0,
              content_sha256: hash,
              start_byte: 0,
              end_byte: 12,
            },
          ],
        },
      ],
    },
  };
  return {
    request_id: operationId,
    data: {
      project_id: projectId,
      latest_version: version,
      accepted_version: structuredClone(version),
      review_version: null,
      head: {
        artifact_id: artifactId,
        latest_version_id: versionId,
        accepted_version_id: versionId,
        review_version_id: null,
        review_submission_id: null,
        revision: 1,
        review_evidence_revision: 0,
        updated_at: date,
      },
    },
  };
}
function props() {
  return {
    projectId,
    sourceDocumentId: sourceId,
    sourceApproved: true,
    sourceManifest: manifest(),
  };
}
function setup(saved = false, providerKind: "CPA_LOOPBACK" | "XAI" = "CPA_LOOPBACK") {
  if (saved) localStorage.setItem(queueKey, JSON.stringify(operation));
  const command = originalRemoteSourceExtractCommand(operation);
  const receipt = {
    request_id: operationId,
    data: {
      project_id: projectId,
      run_id: runId,
      agent_run: {
        agent_run_id: runId,
        project_id: projectId,
        agent_definition: command.input.source.agent_definition,
      },
      skill_run: {
        agent_run_id: runId,
        project_id: projectId,
        skill_definition: command.input.source.skill_definition,
        proposal_id: proposalId,
      },
    },
  };
  const span = {
    source_document_id: sourceId,
    source_block_id: blockId,
    start_byte: 0,
    end_byte: 12,
  };
  const proposal = {
    request_id: operationId,
    data: {
      project_id: projectId,
      proposal_id: proposalId,
      producer_attempt_id: attemptId,
      proposal: {
        schema_version: "1.0.0",
        target_artifact_type: "SourceExtraction",
        producer_agent_run_id: runId,
        source_spans: [span],
        payload_hash: hash,
        payload: { summary: "Fixture summary" },
      },
    },
  };
  const draft = {
    request_id: operationId,
    data: {
      project_id: projectId,
      version: {
        id: draftId,
        artifact_id: artifactId,
        content_hash: hash,
        content: { summary: "Fixture summary" },
      },
      head: {
        artifact_id: artifactId,
        latest_version_id: draftId,
        accepted_version_id: null as string | null,
        revision: 2,
      },
      provenance: { proposal_id: proposalId, producer_attempt_id: attemptId },
      source_spans: [span],
      dependencies: [
        { upstream_version_id: versionId, relationship: "derived_from", impact: "blocking" },
      ],
    },
  };
  const api = {
    listProviderConnections: vi.fn().mockResolvedValue({
      request_id: operationId,
      data: [
        {
          id: connectionId,
          provider_kind: providerKind,
          enabled: true,
          credential_status: "CONFIGURED",
          models: [
            {
              model_id: providerKind === "XAI" ? "grok-4.7" : "fixture-model",
              capabilities: ["TEXT"],
            },
          ],
          revision: 1,
          display_name: providerKind === "XAI" ? "Grok" : "Test connection",
        },
      ],
    }),
    remoteSourceExtract: {
      create: vi.fn().mockResolvedValue({ kind: "QUEUED", receipt }),
      readOriginal: vi.fn().mockResolvedValue({ kind: "FOUND_RUN", receipt }),
    },
    getArtifactProposal: vi.fn().mockResolvedValue(proposal),
    getSourceExtraction: vi.fn().mockResolvedValue({ kind: "NOT_FOUND" }),
    getSourceExtractionVersion: vi.fn().mockResolvedValue({ kind: "FOUND", receipt: draft }),
    proposalDecisions: {
      acceptAsDraft: vi.fn().mockResolvedValue({
        kind: "SUCCEEDED",
        receipt: {
          data: { project_id: projectId, proposal_id: proposalId, draft_version_id: draftId },
        },
      }),
      reject: vi.fn(),
    },
  };
  transport = api;
  const input = props();
  return { api, input, receipt, proposal, draft, ...render(<SourceExtractionPanel {...input} />) };
}
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
async function choose() {
  await screen.findByRole("option", { name: /Test connection/ });
  fireEvent.change(screen.getByLabelText("来源块"), { target: { value: blockId } });
  fireEvent.change(screen.getByLabelText("文本连接"), { target: { value: connectionId } });
  fireEvent.change(screen.getByLabelText("TEXT 模型"), { target: { value: "fixture-model" } });
}
async function readProposal() {
  click("查询原 run");
  await screen.findByText(/已按原操作读到 run 与提案 ID/);
  click("读取来源抽取提案");
  await screen.findByText(/已读回来源抽取提案/);
}
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("source extraction panel queue and original read", () => {
  test("explicit queue stores identity but never authorizes a provider", async () => {
    const h = setup();
    await choose();
    expect(h.api.remoteSourceExtract.create).not.toHaveBeenCalled();
    click("仅入队原来源抽取");
    expect(await screen.findByText(/服务端已创建待授权任务/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "仅入队原来源抽取" })).toBeDisabled();
    expect(h.api.remoteSourceExtract.create).toHaveBeenCalledTimes(1);
    expect(h.api.proposalDecisions.acceptAsDraft).not.toHaveBeenCalled();
    expect(h.api.remoteSourceExtract.create.mock.calls[0]?.[1].input.billing_account_kind).toBe(
      "gpt_login",
    );
    expect(screen.queryByRole("button", { name: /Sub2API/ })).not.toBeInTheDocument();
  });
  test("queues a Grok text connection with grok_login and does not claim a live call", async () => {
    const h = setup(false, "XAI");
    await screen.findByRole("option", { name: /Grok/ });
    fireEvent.change(screen.getByLabelText("来源块"), { target: { value: blockId } });
    fireEvent.change(screen.getByLabelText("文本连接"), { target: { value: connectionId } });
    fireEvent.change(screen.getByLabelText("TEXT 模型"), { target: { value: "grok-4.7" } });
    click("仅入队原来源抽取");
    expect(await screen.findByText(/grok_login/)).toBeInTheDocument();
    expect(screen.getByText(/不会调用 xAI/)).toBeInTheDocument();
    expect(h.api.remoteSourceExtract.create.mock.calls[0]?.[1].input.billing_account_kind).toBe(
      "grok_login",
    );
  });
  test.each(["unknown", "rejected", "storage"])(
    "queue %s does not report success",
    async (fault) => {
      const h = setup();
      await choose();
      if (fault === "unknown")
        h.api.remoteSourceExtract.create.mockRejectedValue(new Error("lost"));
      if (fault === "rejected")
        h.api.remoteSourceExtract.create.mockResolvedValue({
          kind: "DEFINITE_SERVER_ERROR",
          status: 409,
          code: "PROPOSAL_RUN_INPUT_REJECTED",
          request_id: operationId,
        });
      if (fault === "storage")
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("full");
        });
      click("仅入队原来源抽取");
      expect(
        await screen.findByText(
          fault === "unknown"
            ? /排队结果未知；原操作已锁定/
            : fault === "rejected"
              ? /服务端明确拒绝入队/
              : /原操作身份未能保存并回读/,
        ),
      ).toBeInTheDocument();
      expect(h.api.remoteSourceExtract.create).toHaveBeenCalledTimes(fault === "storage" ? 0 : 1);
    },
  );
  test.each(["unapproved", "manifest", "document", "project", "head", "hash"])(
    "%s blocks new queue",
    async (fault) => {
      const h = setup();
      await choose();
      const input = structuredClone(h.input);
      if (fault === "unapproved") input.sourceApproved = false;
      if (fault === "manifest") input.sourceManifest.data.accepted_version = null;
      if (fault === "document") input.sourceDocumentId = "different";
      if (fault === "project") input.sourceManifest.data.project_id = "different";
      if (fault === "head") input.sourceManifest.data.head.latest_version_id = "different";
      if (fault === "hash") input.sourceManifest.data.latest_version.content_hash = "different";
      h.rerender(<SourceExtractionPanel {...input} />);
      expect(screen.getByRole("button", { name: "仅入队原来源抽取" })).toBeDisabled();
      expect(h.api.remoteSourceExtract.create).not.toHaveBeenCalled();
    },
  );
  test.each(["NOT_FOUND", "REMOTE_UNKNOWN", "throw", "no-proposal"])(
    "original read %s keeps queue lock",
    async (kind) => {
      const h = setup(true);
      if (kind === "throw")
        h.api.remoteSourceExtract.readOriginal.mockRejectedValue(new Error("offline"));
      else if (kind === "no-proposal") h.receipt.data.skill_run.proposal_id = "";
      else h.api.remoteSourceExtract.readOriginal.mockResolvedValue({ kind });
      click("查询原 run");
      expect(
        await screen.findByText(
          kind === "NOT_FOUND"
            ? /未找到原 run/
            : kind === "no-proposal"
              ? /尚无可核对的提案/
              : /原 run 查询未知/,
        ),
      ).toBeInTheDocument();
      expect(h.api.remoteSourceExtract.create).not.toHaveBeenCalled();
      expect(localStorage.getItem(queueKey)).toBe(JSON.stringify(operation));
    },
  );
  test("UNKNOWN original read cannot promote a found run to an accepted queue", async () => {
    localStorage.setItem(
      queueKey,
      JSON.stringify({ ...operation, status: "UNKNOWN", runId: null }),
    );
    const h = setup();
    click("查询原 run");
    expect(await screen.findByText(/发现原 run，但排队绑定尚未核实/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取来源抽取提案" })).toBeDisabled();
    expect(h.api.remoteSourceExtract.create).not.toHaveBeenCalled();
  });
  test("project navigation discards a late queue reply", async () => {
    const h = setup();
    await choose();
    let finish!: () => void;
    h.api.remoteSourceExtract.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ kind: "QUEUED", receipt: h.receipt });
        }),
    );
    click("仅入队原来源抽取");
    h.rerender(<SourceExtractionPanel {...h.input} projectId={null} />);
    await act(async () => {
      finish();
    });
    expect(screen.queryByText(/服务端已创建待授权任务/)).not.toBeInTheDocument();
    expect(screen.getByText("请先选择真实项目。")).toBeInTheDocument();
  });
});

describe("source proposal and draft are independent receipts", () => {
  test("requires latest head before human acceptance and exact version after it", async () => {
    const h = setup(true);
    await readProposal();
    expect(screen.getByRole("button", { name: "人工接纳为草稿" })).toBeDisabled();
    click("读取 SourceExtraction 最新状态");
    await screen.findByText(/权威读回确认尚无/);
    click("人工接纳为草稿");
    await screen.findByText(/已精确读回与原提案/);
    expect(h.api.proposalDecisions.acceptAsDraft).toHaveBeenCalledExactlyOnceWith(
      projectId,
      proposalId,
      { parent_version_id: null, expected_head_revision: null },
    );
    expect(h.api.getSourceExtractionVersion).toHaveBeenCalledExactlyOnceWith(projectId, draftId);
    expect(screen.getByText(/此版本仅为草稿，未接受/)).toBeInTheDocument();
  });
  test.each(["project", "proposal", "run", "type", "span", "throw", "V2", "missing"])(
    "proposal %s fails closed",
    async (fault) => {
      const h = setup(true);
      if (fault === "project") h.proposal.data.project_id = "wrong";
      if (fault === "proposal") h.proposal.data.proposal_id = "wrong";
      if (fault === "run") h.proposal.data.proposal.producer_agent_run_id = "wrong";
      if (fault === "type") h.proposal.data.proposal.target_artifact_type = "Other";
      if (fault === "span") h.proposal.data.proposal.source_spans = [];
      if (fault === "throw") h.api.getArtifactProposal.mockRejectedValue(new Error("offline"));
      if (fault === "V2" || fault === "missing")
        transport.readVersionedSourceExtractionProposal = vi.fn().mockResolvedValue({
          kind: fault === "V2" ? "FOUND_V2" : "NOT_FOUND",
          receipt: h.proposal,
        });
      click("查询原 run");
      await screen.findByText(/已按原操作读到 run 与提案 ID/);
      click("读取来源抽取提案");
      expect(
        await screen.findByText(
          fault === "throw"
            ? /提案读取失败/
            : fault === "V2"
              ? /原操作读到另一版本的提案/
              : fault === "missing"
                ? /原 CPA 提案未找到/
                : /提案身份或来源证据不匹配/,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "人工接纳为草稿" })).not.toBeInTheDocument();
      expect(h.api.proposalDecisions.acceptAsDraft).not.toHaveBeenCalled();
    },
  );
  test.each(["current", "project", "head", "artifact", "revision", "throw"])(
    "latest head %s controls acceptance preconditions",
    async (fault) => {
      const h = setup(true);
      await readProposal();
      if (fault === "project") h.draft.data.project_id = "wrong";
      if (fault === "head") h.draft.data.head.latest_version_id = "wrong";
      if (fault === "artifact") h.draft.data.head.artifact_id = "wrong";
      if (fault === "revision") h.draft.data.head.revision = 0;
      h.api.getSourceExtraction.mockResolvedValue({ kind: "FOUND", receipt: h.draft });
      if (fault === "throw") h.api.getSourceExtraction.mockRejectedValue(new Error("offline"));
      click("读取 SourceExtraction 最新状态");
      await screen.findByText(
        fault === "current" ? /已读取现有 SourceExtraction head/ : /SourceExtraction head 读取未知/,
      );
      if (fault === "current") {
        click("人工接纳为草稿");
        await screen.findByText(/已精确读回与原提案/);
        expect(h.api.proposalDecisions.acceptAsDraft).toHaveBeenCalledWith(projectId, proposalId, {
          parent_version_id: draftId,
          expected_head_revision: 2,
        });
      } else expect(screen.getByRole("button", { name: "人工接纳为草稿" })).toBeDisabled();
    },
  );
  test.each([
    "project",
    "version",
    "proposal",
    "attempt",
    "hash",
    "artifact",
    "dependency",
    "span",
    "throw",
  ])("exact draft %s does not claim acceptance proof", async (fault) => {
    const h = setup(true);
    await readProposal();
    click("读取 SourceExtraction 最新状态");
    await screen.findByText(/权威读回确认尚无/);
    if (fault === "project") h.draft.data.project_id = "wrong";
    if (fault === "version") h.draft.data.version.id = "wrong";
    if (fault === "proposal") h.draft.data.provenance.proposal_id = "wrong";
    if (fault === "attempt") h.draft.data.provenance.producer_attempt_id = "wrong";
    if (fault === "hash") h.draft.data.version.content_hash = "wrong";
    if (fault === "artifact") h.draft.data.head.artifact_id = "wrong";
    if (fault === "dependency") h.draft.data.dependencies = [];
    if (fault === "span") h.draft.data.source_spans = [];
    if (fault === "throw") h.api.getSourceExtractionVersion.mockRejectedValue(new Error("offline"));
    click("人工接纳为草稿");
    await screen.findByText(/草稿精确读回失败或身份不符/);
    expect(screen.queryByText(/草稿摘要：/)).not.toBeInTheDocument();
    expect(h.api.proposalDecisions.acceptAsDraft).toHaveBeenCalledTimes(1);
  });
  test.each(["unknown", "rejected"])(
    "acceptance %s remains locked after failed response",
    async (fault) => {
      const h = setup(true);
      await readProposal();
      click("读取 SourceExtraction 最新状态");
      await screen.findByText(/权威读回确认尚无/);
      h.api.proposalDecisions.acceptAsDraft.mockResolvedValue(
        fault === "unknown"
          ? { kind: "REMOTE_UNKNOWN" }
          : { kind: "DEFINITE_SERVER_ERROR", status: 409, code: "CONFLICT" },
      );
      click("人工接纳为草稿");
      await screen.findByText(
        fault === "unknown" ? /人工接纳结果未知或已有接纳记录/ : /人工接纳收到 409/,
      );
      expect(screen.getByRole("button", { name: "人工接纳为草稿" })).toBeDisabled();
      expect(h.api.getSourceExtractionVersion).not.toHaveBeenCalled();
    },
  );
});
