import { beforeEach, describe, expect, test, vi } from "vitest";

import type { FakeTimelineRunCapability, FakeTimelineRunCreateInput } from "./api/studio";
import {
  createFakeTimelineRunOperationJournal,
  submitFakeTimelineRunOperation,
} from "./fake-timeline-run-operation-journal";

const projectId = `prj_${"1".repeat(32)}`;
const input: FakeTimelineRunCreateInput = {
  source_manifest_version_id: `ver_${"2".repeat(32)}`,
  source_document_id: `src_${"3".repeat(32)}`,
};
const operationId = "7e0df32e-299a-4bb7-b77e-b85f20c41d61";
const otherOperationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const createdAt = "2026-08-11T10:00:00.000Z";
const journalKey = `aijian.fake-timeline-run.pending.v1:${projectId}`;
const replayReceipt = {
  data: {
    project_id: projectId,
    source_manifest_version_id: input.source_manifest_version_id,
    source_document_id: input.source_document_id,
    workflow_run_id: `wfr_${"4".repeat(32)}`,
    node_run_id: `node_${"5".repeat(32)}`,
    attempt_id: `att_${"6".repeat(32)}`,
    task_id: `task_${"7".repeat(32)}`,
    attempt_status: "SUCCEEDED",
    task_status: "COMPLETED",
    capability_losses: [
      "FAKE_IMAGE_NO_SEMANTIC_GENERATION",
      "STATIC_FRAME_NO_MOTION_GENERATION",
      "PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY",
    ],
  },
  request_id: "123e4567-e89b-42d3-a456-426614174000",
};
const conflictResult = {
  kind: "DEFINITE_SERVER_ERROR" as const,
  status: 409,
  code: "FAKE_TIMELINE_RUN_CONFLICT",
  request_id: "123e4567-e89b-42d3-a456-426614174000",
};

function journal(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
  operation = operationId,
  now = createdAt,
) {
  return createFakeTimelineRunOperationJournal(storage, {
    operationId: () => operation,
    now: () => now,
  });
}

beforeEach(() => localStorage.clear());

describe("fake timeline run operation journal", () => {
  test("persists the exact pending command before invoking the capability", async () => {
    const pending = journal();
    const create = vi.fn(async (_projectId: string, command: { operation_id: string }) => {
      expect(pending.load(projectId)).toEqual({
        schema_version: 1,
        state: "PENDING_SUBMIT",
        project_id: projectId,
        operation_id: command.operation_id,
        input,
        created_at: createdAt,
      });
      expect(Object.keys(pending.load(projectId) ?? {})).toEqual([
        "schema_version",
        "state",
        "project_id",
        "operation_id",
        "input",
        "created_at",
      ]);
      return { kind: "REMOTE_UNKNOWN" } as const;
    });

    await expect(
      submitFakeTimelineRunOperation(pending, { create }, projectId, input),
    ).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
      operation_id: operationId,
      journal_cleanup_pending: false,
    });

    expect(create).toHaveBeenCalledWith(projectId, { operation_id: operationId, input });
    expect(pending.load(projectId)).toEqual({
      schema_version: 1,
      state: "PENDING_SUBMIT",
      project_id: projectId,
      operation_id: operationId,
      input,
      created_at: createdAt,
    });
  });

  test("retains the same operation and input across reload after REMOTE_UNKNOWN or a rejected bridge", async () => {
    const first = journal();
    await submitFakeTimelineRunOperation(
      first,
      { create: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }) },
      projectId,
      input,
    );

    const afterUnknown = journal(localStorage, otherOperationId, "2026-08-11T10:01:00.000Z");
    expect(afterUnknown.load(projectId)).toMatchObject({
      operation_id: operationId,
      input,
    });

    await expect(
      submitFakeTimelineRunOperation(
        afterUnknown,
        { create: vi.fn().mockRejectedValue(new Error("ipc destroyed")) },
        projectId,
        input,
      ),
    ).resolves.toEqual({
      kind: "REMOTE_UNKNOWN",
      operation_id: operationId,
      journal_cleanup_pending: false,
    });

    const afterReject = journal(localStorage, otherOperationId, "2026-08-11T10:02:00.000Z");
    expect(afterReject.load(projectId)).toEqual({
      schema_version: 1,
      state: "PENDING_SUBMIT",
      project_id: projectId,
      operation_id: operationId,
      input,
      created_at: createdAt,
    });
    expect(afterReject.begin(projectId, input).operation_id).toBe(operationId);
  });

  test("clears the journal on exact 200 replay success and preserves replayed=true", async () => {
    await submitFakeTimelineRunOperation(
      journal(),
      { create: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }) },
      projectId,
      input,
    );
    const reloaded = journal(localStorage, otherOperationId, "2026-08-11T10:01:00.000Z");
    const create = vi.fn().mockResolvedValue({
      kind: "SUCCEEDED",
      receipt: replayReceipt,
      replayed: true,
    });

    await expect(
      submitFakeTimelineRunOperation(reloaded, { create }, projectId, input),
    ).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt: replayReceipt,
      replayed: true,
      operation_id: operationId,
      journal_cleanup_pending: false,
    });
    expect(create).toHaveBeenCalledWith(projectId, { operation_id: operationId, input });
    expect(reloaded.load(projectId)).toBeNull();
    expect(localStorage.getItem(journalKey)).toBeNull();
  });

  test("clears the journal on a definite 409 without generating another identity", async () => {
    await submitFakeTimelineRunOperation(
      journal(),
      { create: vi.fn().mockResolvedValue({ kind: "REMOTE_UNKNOWN" }) },
      projectId,
      input,
    );
    const reloaded = journal(localStorage, otherOperationId, "2026-08-11T10:01:00.000Z");
    const create = vi.fn().mockResolvedValue(conflictResult);

    await expect(
      submitFakeTimelineRunOperation(reloaded, { create }, projectId, input),
    ).resolves.toEqual({
      ...conflictResult,
      operation_id: operationId,
      journal_cleanup_pending: false,
    });
    expect(create).toHaveBeenCalledWith(projectId, { operation_id: operationId, input });
    expect(reloaded.load(projectId)).toBeNull();
  });

  test("fails closed on drift, malformed ids, extra keys, corrupt JSON, and storage faults", async () => {
    const create = vi.fn();
    const pending = journal();

    await expect(
      submitFakeTimelineRunOperation(pending, { create }, projectId, {
        ...input,
        extra: true,
      } as FakeTimelineRunCreateInput),
    ).rejects.toThrow("fake timeline run input is invalid");
    await expect(
      submitFakeTimelineRunOperation(pending, { create }, "PRJ_not-a-project", input),
    ).rejects.toThrow("valid project id");
    await expect(
      submitFakeTimelineRunOperation(pending, { create }, projectId, {
        ...input,
        source_manifest_version_id: `VER_${"2".repeat(32)}`,
      }),
    ).rejects.toThrow("fake timeline run input is invalid");
    await expect(
      submitFakeTimelineRunOperation(pending, { create }, projectId, {
        source_manifest_version_id: input.source_manifest_version_id,
      } as FakeTimelineRunCreateInput),
    ).rejects.toThrow("fake timeline run input is invalid");
    await expect(
      submitFakeTimelineRunOperation(pending, { create }, projectId, {
        ...input,
        source_document_id: `src_${"3".repeat(31)}g`,
      }),
    ).rejects.toThrow("fake timeline run input is invalid");

    expect(create).not.toHaveBeenCalled();
    expect(localStorage.getItem(journalKey)).toBeNull();

    const written = pending.begin(projectId, input);
    const frozen = localStorage.getItem(journalKey);
    await expect(
      submitFakeTimelineRunOperation(pending, { create }, projectId, {
        ...input,
        source_document_id: `src_${"9".repeat(32)}`,
      }),
    ).rejects.toThrow("pending fake timeline run input does not match");
    expect(localStorage.getItem(journalKey)).toBe(frozen);
    expect(pending.load(projectId)).toEqual(written);

    expect(() => pending.complete(projectId, otherOperationId)).toThrow(
      "fake timeline run journal completion does not match",
    );
    expect(localStorage.getItem(journalKey)).toBe(frozen);

    localStorage.setItem(journalKey, "{not-json");
    expect(() => pending.load(projectId)).toThrow("fake timeline run journal is corrupt");
    expect(() => pending.begin(projectId, input)).toThrow("fake timeline run journal is corrupt");
    expect(() => pending.complete(projectId, operationId)).toThrow(
      "fake timeline run journal is corrupt",
    );
    expect(localStorage.getItem(journalKey)).toBe("{not-json");

    const extraKeyed = {
      schema_version: 1,
      state: "PENDING_SUBMIT",
      project_id: projectId,
      operation_id: operationId,
      input,
      created_at: createdAt,
      unexpected: true,
    };
    localStorage.setItem(journalKey, JSON.stringify(extraKeyed));
    expect(() => pending.load(projectId)).toThrow("fake timeline run journal is corrupt");
    expect(JSON.parse(localStorage.getItem(journalKey) ?? "{}")).toEqual(extraKeyed);

    localStorage.setItem(
      journalKey,
      JSON.stringify({
        schema_version: 1,
        state: "PENDING_SUBMIT",
        project_id: projectId,
        operation_id: "7E0DF32E-299A-4BB7-B77E-B85F20C41D61",
        input,
        created_at: createdAt,
      }),
    );
    expect(() => pending.load(projectId)).toThrow("fake timeline run journal is corrupt");
    expect(localStorage.getItem(journalKey)).not.toBeNull();

    localStorage.setItem(
      journalKey,
      JSON.stringify({
        schema_version: 1,
        state: "PENDING_SUBMIT",
        project_id: projectId,
        operation_id: operationId,
        input,
        created_at: "2026-08-11T10:00:00+00:00",
      }),
    );
    expect(() => pending.begin(projectId, input)).toThrow("fake timeline run journal is corrupt");
    expect(localStorage.getItem(journalKey)).not.toBeNull();

    expect(create).not.toHaveBeenCalled();
  });

  test("rejects invalid generated identity and no-op writes without calling the capability", async () => {
    const create = vi.fn();
    const invalidIdentity = createFakeTimelineRunOperationJournal(localStorage, {
      operationId: () => "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa",
      now: () => createdAt,
    });
    await expect(
      submitFakeTimelineRunOperation(invalidIdentity, { create }, projectId, input),
    ).rejects.toThrow("fake timeline run operation identity is invalid");
    expect(localStorage.getItem(journalKey)).toBeNull();

    const invalidTimestamp = createFakeTimelineRunOperationJournal(localStorage, {
      operationId: () => operationId,
      now: () => "2026-08-11 10:00:00Z",
    });
    await expect(
      submitFakeTimelineRunOperation(invalidTimestamp, { create }, projectId, input),
    ).rejects.toThrow("fake timeline run operation identity is invalid");
    expect(localStorage.getItem(journalKey)).toBeNull();

    const noOpStorage = {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    await expect(
      submitFakeTimelineRunOperation(journal(noOpStorage), { create }, projectId, input),
    ).rejects.toThrow("fake timeline run journal did not persist the operation");
    expect(noOpStorage.setItem).toHaveBeenCalledOnce();

    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    await expect(
      submitFakeTimelineRunOperation(journal(throwingStorage), { create }, projectId, input),
    ).rejects.toThrow("storage unavailable");
    expect(throwingStorage.setItem).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("rejects a same-id substituted persist without calling the capability", async () => {
    const create = vi.fn();
    const substituted = {
      schema_version: 1 as const,
      state: "PENDING_SUBMIT" as const,
      project_id: projectId,
      operation_id: operationId,
      input: {
        source_manifest_version_id: `ver_${"9".repeat(32)}`,
        source_document_id: `src_${"8".repeat(32)}`,
      },
      created_at: "2026-08-11T11:00:00.000Z",
    };
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string) => {
        memory.set(key, JSON.stringify(substituted));
      },
      removeItem: vi.fn((key: string) => {
        memory.delete(key);
      }),
    };

    await expect(
      submitFakeTimelineRunOperation(journal(storage), { create }, projectId, input),
    ).rejects.toThrow("fake timeline run journal did not persist the operation");
    expect(create).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(JSON.parse(memory.get(journalKey) ?? "null")).toEqual(substituted);
  });

  test("fails closed on generated and persisted impossible UTC calendar dates", async () => {
    const create = vi.fn();
    const impossible = "2026-02-30T10:00:00Z";
    const generated = createFakeTimelineRunOperationJournal(localStorage, {
      operationId: () => operationId,
      now: () => impossible,
    });
    await expect(
      submitFakeTimelineRunOperation(generated, { create }, projectId, input),
    ).rejects.toThrow("fake timeline run operation identity is invalid");
    expect(localStorage.getItem(journalKey)).toBeNull();

    const persistedImpossible = {
      schema_version: 1,
      state: "PENDING_SUBMIT",
      project_id: projectId,
      operation_id: operationId,
      input,
      created_at: impossible,
    };
    const frozen = JSON.stringify(persistedImpossible);
    localStorage.setItem(journalKey, frozen);
    const pending = journal();
    expect(() => pending.load(projectId)).toThrow("fake timeline run journal is corrupt");
    await expect(
      submitFakeTimelineRunOperation(pending, { create }, projectId, input),
    ).rejects.toThrow("fake timeline run journal is corrupt");
    expect(localStorage.getItem(journalKey)).toBe(frozen);
    expect(create).not.toHaveBeenCalled();
  });

  test("preserves a known success when journal cleanup throws", async () => {
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    };
    const capability: FakeTimelineRunCapability = {
      create: vi.fn().mockResolvedValue({
        kind: "SUCCEEDED",
        receipt: replayReceipt,
        replayed: false,
      }),
    };

    await expect(
      submitFakeTimelineRunOperation(journal(storage), capability, projectId, input),
    ).resolves.toEqual({
      kind: "SUCCEEDED",
      receipt: replayReceipt,
      replayed: false,
      operation_id: operationId,
      journal_cleanup_pending: true,
    });
    expect(journal(storage).load(projectId)?.operation_id).toBe(operationId);
  });

  test("preserves a definite server error when journal cleanup is a no-op", async () => {
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      removeItem: vi.fn(),
    };
    const capability: FakeTimelineRunCapability = {
      create: vi.fn().mockResolvedValue(conflictResult),
    };

    await expect(
      submitFakeTimelineRunOperation(journal(storage), capability, projectId, input),
    ).resolves.toEqual({
      ...conflictResult,
      operation_id: operationId,
      journal_cleanup_pending: true,
    });
    expect(storage.removeItem).toHaveBeenCalledOnce();
    expect(journal(storage).load(projectId)?.operation_id).toBe(operationId);
  });

  test("keeps project journals isolated when one operation completes", () => {
    const otherProjectId = `prj_${"a".repeat(32)}`;
    const pending = createFakeTimelineRunOperationJournal(localStorage, {
      operationId: vi.fn().mockReturnValueOnce(operationId).mockReturnValueOnce(otherOperationId),
      now: () => createdAt,
    });
    const first = pending.begin(projectId, input);
    const second = pending.begin(otherProjectId, input);

    pending.complete(projectId, first.operation_id);

    expect(pending.load(projectId)).toBeNull();
    expect(pending.load(otherProjectId)).toEqual(second);
    expect(() => pending.complete(otherProjectId, first.operation_id)).toThrow(
      "fake timeline run journal completion does not match",
    );
    expect(pending.load(otherProjectId)).toEqual(second);
  });
});
