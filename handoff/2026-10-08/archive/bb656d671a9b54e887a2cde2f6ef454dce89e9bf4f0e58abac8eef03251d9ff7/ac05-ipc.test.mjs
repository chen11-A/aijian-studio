import { expect, test, vi } from "vitest";
import {
  registerSub2APISourceExtractHandlers,
  registerVersionedSourceExtractionProposalHandler,
} from "@qa-desktop/remote-source-extract-v2-ipc.ts";
import {
  isSub2APIQueueCommand,
  isSub2APIApprovalCommand,
  SUB2API_CHANNELS,
  VERSIONED_SOURCE_EXTRACTION_PROPOSAL_CHANNEL,
} from "@qa-desktop/remote-source-extract-v2-contract.ts";

const projectId = "prj_" + "a".repeat(32);
const proposalId = "prp_" + "b".repeat(32);
const queue = {
  operation_id: "88ed7974-adc3-4e35-a5c8-38b9674fc45c",
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
function setup() {
  const handlers = new Map();
  const frame = {};
  const client = {
    createSub2APISourceExtractRun: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" })),
    readOriginalSub2APISourceExtractOperation: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" })),
    approveSub2APISourceExtractCall: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" })),
    getSub2APISourceExtractApproval: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" })),
    readVersionedSourceExtractionProposal: vi.fn(async () => ({ kind: "REMOTE_UNKNOWN" })),
  };
  const handle = (channel, listener) => handlers.set(channel, listener);
  const clientFor = () => client;
  const isTopLevelFrame = (event) => event.frame === frame;
  registerSub2APISourceExtractHandlers(handle, clientFor, isTopLevelFrame);
  registerVersionedSourceExtractionProposalHandler(handle, clientFor, isTopLevelFrame);
  return { handlers, frame, client };
}

test("top-frame V2 commands forward canonical identities once", async () => {
  expect(isSub2APIQueueCommand(queue)).toBe(true);
  expect(isSub2APIApprovalCommand(approval)).toBe(true);
  const { handlers, frame, client } = setup();
  expect(handlers.size).toBe(5);
  await handlers.get(SUB2API_CHANNELS.queue)({ frame }, projectId, queue);
  await handlers.get(SUB2API_CHANNELS.operation)({ frame }, projectId, queue);
  await handlers.get(SUB2API_CHANNELS.approve)({ frame }, projectId, queue, approval);
  await handlers.get(SUB2API_CHANNELS.approval)({ frame }, projectId, queue);
  await handlers.get(VERSIONED_SOURCE_EXTRACTION_PROPOSAL_CHANNEL)({ frame }, projectId, proposalId);
  expect(client.createSub2APISourceExtractRun).toHaveBeenCalledWith(projectId, queue);
  expect(client.readOriginalSub2APISourceExtractOperation).toHaveBeenCalledWith(projectId, queue);
  expect(client.approveSub2APISourceExtractCall).toHaveBeenCalledWith(projectId, queue, approval);
  expect(client.getSub2APISourceExtractApproval).toHaveBeenCalledWith(projectId, queue);
  expect(client.readVersionedSourceExtractionProposal).toHaveBeenCalledWith(projectId, proposalId);
  for (const method of Object.values(client)) expect(method).toHaveBeenCalledTimes(1);
});

test("child frame and malformed V2 commands cannot reach the client", async () => {
  const { handlers, frame, client } = setup();
  await expect(handlers.get(SUB2API_CHANNELS.queue)({ frame: {} }, projectId, queue))
    .rejects.toThrow(/sender frame is not authorized/);
  await expect(handlers.get(SUB2API_CHANNELS.queue)({ frame }, projectId, queue, "extra"))
    .rejects.toThrow(/canonical arguments/);
  await expect(handlers.get(SUB2API_CHANNELS.approve)({ frame }, projectId, queue,
    { ...approval, input: { ...approval.input, allowed_calls: 2 } }))
    .rejects.toThrow(/canonical arguments/);
  await expect(handlers.get(VERSIONED_SOURCE_EXTRACTION_PROPOSAL_CHANNEL)({ frame: {} }, projectId, proposalId))
    .rejects.toThrow(/sender frame is not authorized/);
  await expect(handlers.get(VERSIONED_SOURCE_EXTRACTION_PROPOSAL_CHANNEL)({ frame }, projectId, "invalid"))
    .rejects.toThrow(/canonical arguments/);
  for (const method of Object.values(client)) expect(method).not.toHaveBeenCalled();
});
