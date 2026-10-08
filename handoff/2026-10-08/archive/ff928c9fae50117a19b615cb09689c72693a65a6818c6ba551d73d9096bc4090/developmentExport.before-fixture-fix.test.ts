import { afterEach, describe, expect, test, vi } from "vitest";

import {
  closeRejectedDevelopmentExportOperation,
  createDevelopmentExportOperation,
  getDevelopmentExportOperation,
  readDevelopmentExportJournalState,
} from "./developmentExport";

const identity = {
  projectId: `prj_${"a".repeat(32)}`,
  timelineVersionId: `ver_${"b".repeat(32)}`,
  contentHash: `sha256:${"c".repeat(64)}`,
  revision: 1,
};
const firstId = "00000000-0000-4000-8000-000000000401";
const secondId = "00000000-0000-4000-8000-000000000402";

function setup() {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    get length() { return entries.size; },
  };
  const createDevelopmentExport = vi.fn();
  const getDevelopmentExport = vi.fn();
  const transport = { createDevelopmentExport, getDevelopmentExport } as unknown as
    Parameters<typeof createDevelopmentExportOperation>[0];
  return { entries, storage, createDevelopmentExport, getDevelopmentExport, transport };
}

function rejection(overrides: Record<string, unknown> = {}) {
  return {
    kind: "DEFINITE_REJECTION",
    project_id: identity.projectId,
    operation_id: firstId,
    timeline_version_id: identity.timelineVersionId,
    expected_revision: identity.revision,
    status: 422,
    code: "DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED",
    request_id: "request-export-0401",
    disposition: "REVIEW_INPUT",
    request_effect: "NO_EXPORT_CLAIM",
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("development export rejection and recovery journal", () => {
  test("exact first preflight rejection needs explicit closure and retains audit before a new POST", async () => {
    const { entries, storage, createDevelopmentExport, getDevelopmentExport, transport } = setup();
    const randomUUID = vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId);
    vi.stubGlobal("crypto", { randomUUID });
    createDevelopmentExport.mockResolvedValueOnce(rejection()).mockResolvedValueOnce({
      kind: "REMOTE_UNKNOWN", project_id: identity.projectId, operation_id: secondId,
    });

    const first = await createDevelopmentExportOperation(transport, storage, identity);
    expect(first.kind).toBe("REJECTED");
    if (first.kind !== "REJECTED") throw new Error("expected proven rejection");
    expect(first.operation).toMatchObject({
      operationId: firstId, status: "REJECTED", exportId: null,
      rejection: { outcome: "SAFE_FIRST_REJECTION", requestEffect: "NO_EXPORT_CLAIM" },
    });
    const held = await createDevelopmentExportOperation(transport, storage, identity);
    expect(held).toMatchObject({ kind: "TRACKED", operation: { operationId: firstId } });
    expect(createDevelopmentExport).toHaveBeenCalledTimes(1);
    await expect(getDevelopmentExportOperation(transport, storage, first.operation))
      .resolves.toMatchObject({ kind: "UNAVAILABLE" });
    expect(getDevelopmentExport).not.toHaveBeenCalled();

    const closed = closeRejectedDevelopmentExportOperation(storage, first.operation);
    expect(closed).toMatchObject({ operationId: firstId, status: "CLOSED_REJECTED" });
    const audit = Array.from(entries.entries()).find(([key]) =>
      key.includes("development-export.rejection.v1"));
    expect(audit).toBeDefined();
    expect(JSON.parse(audit![1])).toMatchObject({
      operationId: firstId,
      rejection: { code: "DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED", requestId: "request-export-0401" },
    });

    const next = await createDevelopmentExportOperation(transport, storage, identity);
    expect(next).toMatchObject({ kind: "UNKNOWN", operation: { operationId: secondId } });
    expect(createDevelopmentExport).toHaveBeenCalledTimes(2);
    expect(createDevelopmentExport.mock.calls[1][1]).toMatchObject({ operation_id: secondId });
    expect(randomUUID).toHaveBeenCalledTimes(2);
    expect(audit && entries.get(audit[0])).toBe(audit?.[1]);
  });

  test.each([
    { name: "revision conflict", response: rejection({ status: 409, code: "DEVELOPMENT_EXPORT_CONFLICT",
      disposition: "RECONCILE_OPERATION", request_effect: undefined }) },
    { name: "ordinary validation error", response: rejection({ code: "DEVELOPMENT_EXPORT_INVALID",
      request_effect: undefined }) },
    { name: "wrong operation identity", response: rejection({ operation_id: secondId }) },
    { name: "remote unknown", response: { kind: "REMOTE_UNKNOWN", project_id: identity.projectId,
      operation_id: firstId } },
  ])("keeps UNKNOWN locked after $name", async ({ response }) => {
    const { storage, createDevelopmentExport, transport } = setup();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => firstId) });
    createDevelopmentExport.mockResolvedValue(response);
    const first = await createDevelopmentExportOperation(transport, storage, identity);
    expect(first).toMatchObject({ kind: "UNKNOWN", operation: { operationId: firstId, status: "UNKNOWN" } });
    expect(readDevelopmentExportJournalState(storage, identity.projectId))
      .toMatchObject({ kind: "VALID", operation: { operationId: firstId, status: "UNKNOWN" } });
    if (first.kind !== "UNKNOWN") throw new Error("expected unknown outcome");
    expect(closeRejectedDevelopmentExportOperation(storage, first.operation)).toBeNull();
    const repeat = await createDevelopmentExportOperation(transport, storage, identity);
    expect(repeat.kind).toBe("TRACKED");
    expect(createDevelopmentExport).toHaveBeenCalledTimes(1);
  });

  test("transport failure leaves the first operation UNKNOWN and blocks another POST", async () => {
    const { storage, createDevelopmentExport, transport } = setup();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => firstId) });
    createDevelopmentExport.mockRejectedValue(new Error("connection lost"));
    const first = await createDevelopmentExportOperation(transport, storage, identity);
    expect(first).toMatchObject({ kind: "UNKNOWN", operation: { operationId: firstId } });
    expect((await createDevelopmentExportOperation(transport, storage, identity)).kind).toBe("TRACKED");
    expect(createDevelopmentExport).toHaveBeenCalledOnce();
  });
});
