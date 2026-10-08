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

function setup(entries = new Map<string, string>()) {
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

async function rejectFirst(context: ReturnType<typeof setup>) {
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => firstId) });
  context.createDevelopmentExport.mockResolvedValue(rejection());
  const result = await createDevelopmentExportOperation(context.transport, context.storage, identity);
  if (result.kind !== "REJECTED") throw new Error("expected proven first rejection");
  return result.operation;
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
    expect(createDevelopmentExport.mock.calls.at(1)?.[1]).toMatchObject({ operation_id: secondId });
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

  test.each(["write", "read"])("a failed first journal %s prevents POST", async (failure) => {
    const { entries, storage, createDevelopmentExport, transport } = setup();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => firstId) });
    if (failure === "write") {
      vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("disk unavailable"); });
    } else {
      vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("read unavailable"); });
    }
    const result = await createDevelopmentExportOperation(transport, storage, identity);
    expect(result.kind).toBe("UNAVAILABLE");
    expect(createDevelopmentExport).not.toHaveBeenCalled();
    if (failure === "write") expect(entries.size).toBe(0);
  });

  test.each(["audit-write", "audit-readback"])("failed %s keeps rejection locked", async (failure) => {
    const context = setup();
    const operation = await rejectFirst(context);
    if (failure === "audit-write") {
      vi.spyOn(context.storage, "setItem").mockImplementation((key, value) => {
        if (key.includes("development-export.rejection.v1")) throw new Error("audit write failed");
        context.entries.set(key, value);
      });
    } else {
      vi.spyOn(context.storage, "getItem").mockImplementation((key) =>
        key.includes("development-export.rejection.v1") ? null : context.entries.get(key) ?? null);
    }
    expect(closeRejectedDevelopmentExportOperation(context.storage, operation)).toBeNull();
    expect(readDevelopmentExportJournalState(context.storage, identity.projectId))
      .toMatchObject({ kind: "VALID", operation: { status: "REJECTED", operationId: firstId } });
    expect((await createDevelopmentExportOperation(context.transport, context.storage, identity)).kind)
      .toBe("TRACKED");
    expect(context.createDevelopmentExport).toHaveBeenCalledOnce();
  });

  test("64 existing audits prevent closure and leave the rejected operation locked", async () => {
    const context = setup();
    const operation = await rejectFirst(context);
    for (let index = 0; index < 64; index += 1) {
      context.entries.set(
        `aivora.development-export.rejection.v1.${identity.projectId}.${index}`, "retained",
      );
    }
    expect(closeRejectedDevelopmentExportOperation(context.storage, operation)).toBeNull();
    expect(readDevelopmentExportJournalState(context.storage, identity.projectId))
      .toMatchObject({ kind: "VALID", operation: { status: "REJECTED" } });
    expect((await createDevelopmentExportOperation(context.transport, context.storage, identity)).kind)
      .toBe("TRACKED");
    expect(context.createDevelopmentExport).toHaveBeenCalledOnce();
  });

  test.each(["missing", "corrupt"])("reopen blocks a new POST when closed audit is %s", async (fault) => {
    const context = setup();
    const operation = await rejectFirst(context);
    expect(closeRejectedDevelopmentExportOperation(context.storage, operation)?.status)
      .toBe("CLOSED_REJECTED");
    const auditKey = Array.from(context.entries.keys()).find((key) =>
      key.includes("development-export.rejection.v1"));
    if (!auditKey) throw new Error("expected persisted audit");
    if (fault === "missing") context.entries.delete(auditKey);
    else context.entries.set(auditKey, "{invalid-json");

    const reopened = setup(context.entries);
    expect(readDevelopmentExportJournalState(reopened.storage, identity.projectId))
      .toMatchObject({ kind: "VALID", operation: { status: "CLOSED_REJECTED" } });
    const result = await createDevelopmentExportOperation(reopened.transport, reopened.storage, identity);
    expect(result.kind).toBe("UNAVAILABLE");
    expect(reopened.createDevelopmentExport).not.toHaveBeenCalled();
  });

  test("reopen with an intact closed audit permits a distinct explicit operation", async () => {
    const context = setup();
    const operation = await rejectFirst(context);
    expect(closeRejectedDevelopmentExportOperation(context.storage, operation)?.status)
      .toBe("CLOSED_REJECTED");
    const reopened = setup(context.entries);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => secondId) });
    reopened.createDevelopmentExport.mockResolvedValue({
      kind: "REMOTE_UNKNOWN", project_id: identity.projectId, operation_id: secondId,
    });
    const result = await createDevelopmentExportOperation(reopened.transport, reopened.storage, identity);
    expect(result).toMatchObject({ kind: "UNKNOWN", operation: { operationId: secondId } });
    expect(reopened.createDevelopmentExport).toHaveBeenCalledOnce();
  });
});
