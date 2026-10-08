import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ProposalRunCapability, ProposalRunCreateInput } from "./api/studio";
import {
  createProposalRunOperationJournal,
  submitProposalRunOperation,
} from "./proposal-run-operation-journal";

const projectId = `prj_${"1".repeat(32)}`;
const input: ProposalRunCreateInput = {
  agent_definition: { definition_id: "writer.source-analyst", version: "1.0.0" },
  skill_definition: { definition_id: "source.extract", version: "1.0.0" },
  source_manifest_version_id: `ver_${"2".repeat(32)}`,
  source_document_id: `src_${"3".repeat(32)}`,
  source_block_id: `srcb_${"4".repeat(32)}`,
  start_byte: 0,
  end_byte: 24,
};
const operationId = "87302cb8-71f8-4bb9-856a-162571f1ae6e";

beforeEach(() => localStorage.clear());

describe("proposal run operation journal", () => {
  test("persists the exact pending command before invoking Electron", async () => {
    const journal = createProposalRunOperationJournal(localStorage, {
      operationId: () => operationId,
      now: () => "2026-08-11T10:00:00.000Z",
    });
    const create = vi.fn(async (_projectId: string, command: { operation_id: string }) => {
      expect(journal.load(projectId)?.operation_id).toBe(command.operation_id);
      return { kind: "REMOTE_UNKNOWN" } as const;
    });

    await expect(
      submitProposalRunOperation(journal, { create }, projectId, input),
    ).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
      operation_id: operationId,
      journal_cleanup_pending: false,
    });

    expect(create).toHaveBeenCalledWith(projectId, { operation_id: operationId, input });
    expect(journal.load(projectId)).toMatchObject({
      schema_version: 1,
      state: "PENDING_SUBMIT",
      operation_id: operationId,
      project_id: projectId,
      input,
    });
  });

  test("reuses the frozen operation after reload and clears only on a definite result", async () => {
    const first = createProposalRunOperationJournal(localStorage, {
      operationId: () => operationId,
      now: () => "2026-08-11T10:00:00.000Z",
    });
    const unknownCapability: ProposalRunCapability = {
      create: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
    };
    await submitProposalRunOperation(first, unknownCapability, projectId, input);

    const reloaded = createProposalRunOperationJournal(localStorage, {
      operationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      now: () => "2026-08-11T10:01:00.000Z",
    });
    const definiteCapability: ProposalRunCapability = {
      create: vi.fn().mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status: 409,
        code: "PROPOSAL_RUN_CONFLICT",
        request_id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    };

    await expect(
      submitProposalRunOperation(reloaded, definiteCapability, projectId, input),
    ).resolves.toMatchObject({ kind: "DEFINITE_SERVER_ERROR", operation_id: operationId });
    expect(definiteCapability.create).toHaveBeenCalledWith(projectId, {
      operation_id: operationId,
      input,
    });
    expect(reloaded.load(projectId)).toBeNull();
  });

  test("preserves a pending operation when the bridge rejects and blocks input drift", async () => {
    const journal = createProposalRunOperationJournal(localStorage, {
      operationId: () => operationId,
      now: () => "2026-08-11T10:00:00.000Z",
    });
    await submitProposalRunOperation(
      journal,
      { create: vi.fn().mockRejectedValue(new Error("ipc destroyed")) },
      projectId,
      input,
    );

    expect(journal.load(projectId)?.operation_id).toBe(operationId);
    await expect(
      submitProposalRunOperation(journal, { create: vi.fn() }, projectId, {
        ...input,
        end_byte: 25,
      }),
    ).rejects.toThrow("pending proposal run input does not match");
  });

  test("preserves a known success when journal cleanup throws", async () => {
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };
    const journal = createProposalRunOperationJournal(storage, {
      operationId: () => operationId,
      now: () => "2026-08-11T10:00:00.000Z",
    });
    const receipt = { data: { task: { task_id: `tsk_${"a".repeat(32)}` } } };
    const capability = {
      create: vi.fn().mockResolvedValue({ kind: "SUCCEEDED", receipt, replayed: false }),
    } as unknown as ProposalRunCapability;

    await expect(
      submitProposalRunOperation(journal, capability, projectId, input),
    ).resolves.toMatchObject({
      kind: "SUCCEEDED",
      receipt,
      replayed: false,
      operation_id: operationId,
      journal_cleanup_pending: true,
    });
    expect(journal.load(projectId)?.operation_id).toBe(operationId);
  });

  test("preserves a definite server error when journal cleanup is a no-op", async () => {
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: vi.fn(),
    };
    const journal = createProposalRunOperationJournal(storage, {
      operationId: () => operationId,
      now: () => "2026-08-11T10:00:00.000Z",
    });
    const capability: ProposalRunCapability = {
      create: vi.fn().mockResolvedValue({
        kind: "DEFINITE_SERVER_ERROR",
        status: 409,
        code: "PROPOSAL_RUN_CONFLICT",
        request_id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    };

    await expect(
      submitProposalRunOperation(journal, capability, projectId, input),
    ).resolves.toMatchObject({
      kind: "DEFINITE_SERVER_ERROR",
      code: "PROPOSAL_RUN_CONFLICT",
      operation_id: operationId,
      journal_cleanup_pending: true,
    });
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(journal.load(projectId)?.operation_id).toBe(operationId);
  });

  test("fails closed without deleting corrupt or extra-key journal records", () => {
    const key = `aijian.proposal-run.pending.v1:${projectId}`;
    localStorage.setItem(key, JSON.stringify({ project_id: projectId, unexpected: true }));
    const journal = createProposalRunOperationJournal(localStorage, {
      operationId: () => operationId,
      now: () => "2026-08-11T10:00:00.000Z",
    });

    expect(() => journal.load(projectId)).toThrow("proposal run journal is corrupt");
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  test("keeps project journals isolated when one operation completes", () => {
    const otherProjectId = `prj_${"a".repeat(32)}`;
    const journal = createProposalRunOperationJournal(localStorage, {
      operationId: vi
        .fn()
        .mockReturnValueOnce(operationId)
        .mockReturnValueOnce("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      now: () => "2026-08-11T10:00:00.000Z",
    });
    const first = journal.begin(projectId, input);
    const second = journal.begin(otherProjectId, input);

    journal.complete(projectId, first.operation_id);

    expect(journal.load(projectId)).toBeNull();
    expect(journal.load(otherProjectId)).toEqual(second);
  });
});
