import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  DevelopmentExportDefiniteRejection,
  DevelopmentExportResponse,
  StudioTransport,
} from "../../api/studio";
import {
  accessDevelopmentExport,
  clearSucceededDevelopmentExportOperation,
  closeRejectedDevelopmentExportOperation,
  createDevelopmentExportOperation,
  getDevelopmentExportOperation,
  isMatchingReceipt,
  readDevelopmentExportJournalState,
  readDevelopmentExportOperation,
  type DevelopmentExportOperation,
} from "./developmentExport";

const identity = {
  projectId: `prj_${"1".repeat(32)}`,
  timelineVersionId: `ver_${"2".repeat(32)}`,
  contentHash: `sha256:${"3".repeat(64)}`,
  revision: 7,
};
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const journalKey = `aivora.development-export.v2.${identity.projectId}`;
const auditPrefix = `aivora.development-export.rejection.v1.${identity.projectId}.`;
const auditKey = auditPrefix + operationId;
const operation: DevelopmentExportOperation = {
  ...identity,
  operationId,
  status: "UNKNOWN",
  exportId: null,
  receipt: null,
  rejection: null,
};

function receipt(status: "SUCCEEDED" | "UNKNOWN" = "SUCCEEDED"): DevelopmentExportResponse {
  // The desktop transport separately validates media metadata. This adapter
  // consumes only the pinned timeline identity, status and fixed output profile.
  return {
    request_id: operationId,
    data: {
      project_id: identity.projectId,
      operation_id: operationId,
      timeline_version_id: identity.timelineVersionId,
      timeline_content_hash: identity.contentHash,
      timeline_revision: identity.revision,
      purpose: "DEVELOPMENT_EVIDENCE",
      status,
      ...(status === "UNKNOWN"
        ? { error_code: "REMOTE_UNKNOWN" }
        : {
            export_id: "export-1",
            output: { width: 1080, height: 1920, frame_rate_num: 25, frame_rate_den: 1 },
          }),
    },
  } as DevelopmentExportResponse;
}
function rejection(): DevelopmentExportDefiniteRejection {
  return {
    kind: "DEFINITE_REJECTION",
    project_id: identity.projectId,
    operation_id: operationId,
    timeline_version_id: identity.timelineVersionId,
    expected_revision: identity.revision,
    code: "DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED",
    status: 422,
    request_id: operationId,
    disposition: "REVIEW_INPUT",
    request_effect: "NO_EXPORT_CLAIM",
  };
}
function setup(saved?: DevelopmentExportOperation) {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(operationId);
  const values = new Map<string, string>();
  if (saved) values.set(journalKey, JSON.stringify(saved));
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    get length() {
      return values.size;
    },
  };
  const transport = {
    createDevelopmentExport: vi
      .fn<NonNullable<StudioTransport["createDevelopmentExport"]>>()
      .mockResolvedValue(receipt()),
    getDevelopmentExport: vi
      .fn<NonNullable<StudioTransport["getDevelopmentExport"]>>()
      .mockResolvedValue(receipt()),
    openDevelopmentExport: vi
      .fn<NonNullable<StudioTransport["openDevelopmentExport"]>>()
      .mockResolvedValue({ kind: "OPENED", export_id: "export-1" }),
    saveDevelopmentExport: vi
      .fn<NonNullable<StudioTransport["saveDevelopmentExport"]>>()
      .mockResolvedValue({ kind: "SAVED", export_id: "export-1" }),
  };
  return { values, storage, transport };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("development export identity and journal", () => {
  test("persists identity before dispatch, stores no output paths, and reads success back", async () => {
    const h = setup();
    h.transport.createDevelopmentExport.mockImplementation(async (project, input) => {
      expect(project).toBe(identity.projectId);
      expect(input).toEqual({
        operation_id: operationId,
        timeline_version_id: identity.timelineVersionId,
        expected_revision: 7,
        purpose: "DEVELOPMENT_EVIDENCE",
      });
      expect(readDevelopmentExportOperation(h.storage, project)).toEqual(operation);
      return receipt();
    });
    const result = await createDevelopmentExportOperation(h.transport, h.storage, identity);
    expect(result).toMatchObject({
      kind: "SUCCEEDED",
      operation: { exportId: "export-1", receipt: receipt() },
    });
    expect(readDevelopmentExportOperation(h.storage, identity.projectId)).toEqual({
      ...operation,
      status: "SUCCEEDED",
      exportId: "export-1",
    });
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, identity),
    ).resolves.toMatchObject({ kind: "TRACKED" });
    expect(h.transport.createDevelopmentExport).toHaveBeenCalledTimes(1);
  });

  test.each([
    null,
    [],
    "x",
    { ...identity, projectId: "bad" },
    { ...identity, timelineVersionId: "bad" },
    { ...identity, contentHash: "bad" },
    { ...identity, revision: 0 },
    { ...identity, revision: 1.5 },
  ])("rejects invalid identity %j before writing", async (input) => {
    const h = setup();
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, input as typeof identity),
    ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    expect(h.storage.setItem).not.toHaveBeenCalled();
    expect(h.transport.createDevelopmentExport).not.toHaveBeenCalled();
  });

  test.each(["capability", "crypto", "randomUUID"])(
    "missing %s blocks dispatch",
    async (missing) => {
      const h = setup();
      if (missing === "crypto") vi.stubGlobal("crypto", undefined);
      if (missing === "randomUUID") vi.stubGlobal("crypto", {});
      await expect(
        createDevelopmentExportOperation(
          missing === "capability" ? {} : h.transport,
          h.storage,
          identity,
        ),
      ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
      expect(h.transport.createDevelopmentExport).not.toHaveBeenCalled();
    },
  );

  test.each([
    "",
    "{",
    "null",
    "[]",
    JSON.stringify({ ...operation, extra: true }),
    JSON.stringify({ ...operation, receipt: receipt() }),
    JSON.stringify({ ...operation, operationId: "bad" }),
    JSON.stringify({ ...operation, status: "SUCCEEDED" }),
    JSON.stringify({ ...operation, status: "REJECTED" }),
  ])("preserves unreadable journal %s and blocks create", async (raw) => {
    const h = setup();
    h.values.set(journalKey, raw);
    expect(readDevelopmentExportJournalState(h.storage, identity.projectId)).toEqual({
      kind: "BLOCKED",
    });
    expect(readDevelopmentExportOperation(h.storage, identity.projectId)).toBeNull();
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, identity),
    ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    expect(h.values.get(journalKey)).toBe(raw);
    expect(h.transport.createDevelopmentExport).not.toHaveBeenCalled();
  });

  test.each(["get", "set", "drop"])("storage %s failure blocks first dispatch", async (fault) => {
    const h = setup();
    if (fault === "get")
      h.storage.getItem.mockImplementation(() => {
        throw new Error("locked");
      });
    if (fault === "set")
      h.storage.setItem.mockImplementation(() => {
        throw new Error("full");
      });
    if (fault === "drop") h.storage.setItem.mockImplementation(() => {});
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, identity),
    ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    expect(h.transport.createDevelopmentExport).not.toHaveBeenCalled();
  });

  test.each(["throw", "unknown", "transport-unknown", "bad-receipt", "persist-fail"])(
    "%s remains tracked UNKNOWN and never POSTs again",
    async (fault) => {
      const h = setup();
      h.transport.createDevelopmentExport.mockImplementation(async () => {
        if (fault === "throw") throw new Error("lost response");
        if (fault === "unknown") return receipt("UNKNOWN");
        if (fault === "transport-unknown")
          return {
            kind: "REMOTE_UNKNOWN",
            project_id: identity.projectId,
            operation_id: operationId,
          };
        if (fault === "bad-receipt") return {} as DevelopmentExportResponse;
        h.storage.setItem.mockImplementation(() => {
          throw new Error("full");
        });
        return receipt();
      });
      await expect(
        createDevelopmentExportOperation(h.transport, h.storage, identity),
      ).resolves.toMatchObject({ kind: "UNKNOWN", operation: { operationId } });
      await expect(
        createDevelopmentExportOperation(h.transport, h.storage, identity),
      ).resolves.toMatchObject({ kind: "TRACKED" });
      expect(h.transport.createDevelopmentExport).toHaveBeenCalledTimes(1);
    },
  );

  test("concurrent journal changes are not overwritten by a late POST response", async () => {
    const h = setup();
    h.transport.createDevelopmentExport.mockImplementation(async () => {
      h.values.set(journalKey, JSON.stringify({ ...operation, operationId: otherId }));
      return receipt();
    });
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, identity),
    ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    expect(readDevelopmentExportOperation(h.storage, identity.projectId)?.operationId).toBe(
      otherId,
    );
  });

  test.each([null, "x", {}, { data: null }])("invalid receipt %j is not matching", (value) => {
    expect(isMatchingReceipt(value, operation)).toBe(false);
  });

  test.each([
    "project_id",
    "operation_id",
    "timeline_version_id",
    "timeline_content_hash",
    "timeline_revision",
    "purpose",
    "status",
  ])("receipt must match %s", (field) => {
    const value = receipt();
    expect(
      isMatchingReceipt({ ...value, data: { ...value.data, [field]: "wrong" } }, operation),
    ).toBe(false);
  });
  test.each(["width", "height", "frame_rate_num", "frame_rate_den"])(
    "receipt profile requires exact %s",
    (field) => {
      const value = receipt();
      if (value.data.status !== "SUCCEEDED") throw new Error("fixture");
      expect(
        isMatchingReceipt(
          { ...value, data: { ...value.data, output: { ...value.data.output, [field]: 2 } } },
          operation,
        ),
      ).toBe(false);
    },
  );
});

describe("development export explicit rejection closure", () => {
  async function rejected() {
    const h = setup();
    h.transport.createDevelopmentExport.mockResolvedValue(rejection());
    const result = await createDevelopmentExportOperation(h.transport, h.storage, identity);
    if (result.kind !== "REJECTED") throw new Error("expected first-dispatch rejection");
    return { ...h, rejected: result.operation };
  }

  test("first safe rejection closes with a durable audit before a new explicit operation", async () => {
    const h = await rejected();
    expect(h.rejected.rejection).toMatchObject({ outcome: "SAFE_FIRST_REJECTION" });
    const closed = closeRejectedDevelopmentExportOperation(h.storage, h.rejected);
    expect(closed?.status).toBe("CLOSED_REJECTED");
    expect(JSON.parse(h.values.get(auditKey)!)).toMatchObject({
      schemaVersion: 1,
      operationId,
      rejection: h.rejected.rejection,
    });
    await expect(
      getDevelopmentExportOperation(h.transport, h.storage, h.rejected),
    ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    await expect(
      getDevelopmentExportOperation(h.transport, h.storage, closed!),
    ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    vi.mocked(crypto.randomUUID).mockReturnValue(otherId);
    h.transport.createDevelopmentExport.mockRejectedValue(new Error("lost"));
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, identity),
    ).resolves.toMatchObject({ kind: "UNKNOWN", operation: { operationId: otherId } });
    expect(h.values.has(auditKey)).toBe(true);
    expect(h.transport.createDevelopmentExport).toHaveBeenCalledTimes(2);
  });

  test.each([
    { project_id: "other" },
    { operation_id: otherId },
    { timeline_version_id: "other" },
    { expected_revision: 8 },
    { status: 409 },
    { status: 200 },
    { code: "OTHER_REJECTION" },
    { code: "unsafe text!" },
    { disposition: "RESTORE_AUTH" },
    { disposition: "RECONCILE_OPERATION" },
    { disposition: "bad" },
    { request_id: "x" },
    { request_effect: undefined },
  ])("ambiguous rejection %j must remain UNKNOWN", async (change) => {
    const h = setup();
    h.transport.createDevelopmentExport.mockResolvedValue({
      ...rejection(),
      ...change,
    } as DevelopmentExportDefiniteRejection);
    const result = await createDevelopmentExportOperation(h.transport, h.storage, identity);
    expect(result).toMatchObject({
      kind: "UNKNOWN",
      operation: { rejection: { outcome: "KEEP_UNKNOWN" } },
    });
    const saved = readDevelopmentExportOperation(h.storage, identity.projectId)!;
    expect(saved.status).toBe("UNKNOWN");
    expect(closeRejectedDevelopmentExportOperation(h.storage, saved)).toBeNull();
    expect(h.values.has(auditKey)).toBe(false);
  });

  test("failure to persist rejection does not invent a definite outcome", async () => {
    const h = setup();
    h.transport.createDevelopmentExport.mockImplementation(async () => {
      h.storage.setItem.mockImplementation(() => {
        throw new Error("full");
      });
      return rejection();
    });
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, identity),
    ).resolves.toMatchObject({ kind: "UNKNOWN", operation: { rejection: null } });
  });

  test.each([
    "full",
    "no-enumeration",
    "corrupt-audit",
    "oversized-audit",
    "audit-write",
    "audit-drop",
    "journal-changed",
    "closed-write",
  ])("%s cannot silently close or erase rejection", async (fault) => {
    const h = await rejected();
    if (fault === "full") for (let n = 0; n < 64; n++) h.values.set(auditPrefix + n, "audit");
    if (fault === "corrupt-audit") h.values.set(auditKey, "{");
    if (fault === "oversized-audit") h.values.set(auditKey, "x".repeat(1025));
    if (fault === "audit-write")
      h.storage.setItem.mockImplementation(() => {
        throw new Error("full");
      });
    if (fault === "audit-drop") h.storage.setItem.mockImplementation(() => {});
    if (fault === "journal-changed")
      h.storage.setItem.mockImplementation((key, value) => {
        h.values.set(key, value);
        h.values.set(journalKey, JSON.stringify({ ...h.rejected, operationId: otherId }));
      });
    if (fault === "closed-write")
      h.storage.setItem.mockImplementation((key, value) => {
        if (key === journalKey) throw new Error("locked");
        h.values.set(key, value);
      });
    const storage =
      fault === "no-enumeration"
        ? {
            getItem: h.storage.getItem,
            setItem: h.storage.setItem,
            removeItem: h.storage.removeItem,
          }
        : h.storage;
    expect(closeRejectedDevelopmentExportOperation(storage, h.rejected)).toBeNull();
    expect(readDevelopmentExportOperation(h.storage, identity.projectId)?.status).toBe("REJECTED");
    expect(h.transport.createDevelopmentExport).toHaveBeenCalledTimes(1);
  });

  test("a previously saved matching audit permits retrying closure without rewriting evidence", async () => {
    const h = await rejected();
    h.storage.setItem.mockImplementation((key, value) => {
      if (key === journalKey) throw new Error("locked");
      h.values.set(key, value);
    });
    expect(closeRejectedDevelopmentExportOperation(h.storage, h.rejected)).toBeNull();
    const audit = h.values.get(auditKey);
    h.storage.setItem.mockImplementation((key, value) => {
      h.values.set(key, value);
    });
    expect(closeRejectedDevelopmentExportOperation(h.storage, h.rejected)?.status).toBe(
      "CLOSED_REJECTED",
    );
    expect(h.values.get(auditKey)).toBe(audit);
    h.values.delete(auditKey);
    await expect(
      createDevelopmentExportOperation(h.transport, h.storage, identity),
    ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    expect(h.transport.createDevelopmentExport).toHaveBeenCalledTimes(1);
  });
});

describe("development export readback, access and explicit clearing", () => {
  test("GET recovers exact UNKNOWN identity and is the only recovery network action", async () => {
    const h = setup(operation);
    const result = await getDevelopmentExportOperation(h.transport, h.storage, operation);
    expect(result).toMatchObject({
      kind: "SUCCEEDED",
      operation: { exportId: "export-1", receipt: receipt() },
    });
    expect(h.transport.getDevelopmentExport).toHaveBeenCalledExactlyOnceWith(
      identity.projectId,
      operationId,
      identity.timelineVersionId,
      7,
    );
    expect(h.transport.createDevelopmentExport).not.toHaveBeenCalled();
  });

  test.each(["missing-api", "missing-journal", "changed-id", "changed-after-query"])(
    "%s blocks stale GET results",
    async (fault) => {
      const h = setup(operation);
      if (fault === "missing-journal") h.values.clear();
      if (fault === "changed-id")
        h.values.set(journalKey, JSON.stringify({ ...operation, operationId: otherId }));
      if (fault === "changed-after-query")
        h.transport.getDevelopmentExport.mockImplementation(async () => {
          h.values.clear();
          return receipt();
        });
      await expect(
        getDevelopmentExportOperation(
          fault === "missing-api" ? {} : h.transport,
          h.storage,
          operation,
        ),
      ).resolves.toMatchObject({ kind: "UNAVAILABLE" });
    },
  );

  test.each(["throw", "unknown", "wrong-id", "persist-fail", "changed-export"])(
    "GET %s leaves original tracking intact",
    async (fault) => {
      const initial: DevelopmentExportOperation =
        fault === "changed-export"
          ? { ...operation, status: "SUCCEEDED", exportId: "original-export" }
          : operation;
      const h = setup(initial);
      h.transport.getDevelopmentExport.mockImplementation(async () => {
        if (fault === "throw") throw new Error("offline");
        if (fault === "unknown") return receipt("UNKNOWN");
        if (fault === "wrong-id")
          return { ...receipt(), data: { ...receipt().data, operation_id: otherId } };
        if (fault === "persist-fail")
          h.storage.setItem.mockImplementation(() => {
            throw new Error("full");
          });
        return receipt();
      });
      await expect(
        getDevelopmentExportOperation(h.transport, h.storage, initial),
      ).resolves.toMatchObject({ kind: "UNKNOWN" });
      expect(readDevelopmentExportOperation(h.storage, identity.projectId)).toEqual(initial);
    },
  );

  test.each(["open", "save"] as const)(
    "%s requires an exact current in-memory receipt",
    async (action) => {
      const h = setup(operation);
      await expect(accessDevelopmentExport(h.transport, operation, action)).resolves.toBe(
        "UNAVAILABLE",
      );
      const succeeded: DevelopmentExportOperation = {
        ...operation,
        status: "SUCCEEDED",
        exportId: "export-1",
        receipt: receipt(),
      };
      await expect(accessDevelopmentExport({}, succeeded, action)).resolves.toBe("UNAVAILABLE");
      await expect(
        accessDevelopmentExport(h.transport, { ...succeeded, receipt: receipt("UNKNOWN") }, action),
      ).resolves.toBe("UNAVAILABLE");
      await expect(accessDevelopmentExport(h.transport, succeeded, action)).resolves.toBe(
        action === "open" ? "OPENED" : "SAVED",
      );
      const method =
        action === "open" ? h.transport.openDevelopmentExport : h.transport.saveDevelopmentExport;
      expect(method).toHaveBeenCalledExactlyOnceWith(
        identity.projectId,
        operationId,
        identity.timelineVersionId,
        7,
      );
    },
  );

  test.each(["CANCELLED", "REMOTE_UNKNOWN", "UNAVAILABLE", "WRONG_EXPORT", "THROW"])(
    "save %s does not invent output access",
    async (kind) => {
      const h = setup();
      h.transport.saveDevelopmentExport.mockImplementation(async () => {
        if (kind === "THROW") throw new Error("offline");
        if (kind === "WRONG_EXPORT") return { kind: "SAVED", export_id: "other" };
        return { kind, operation_id: operationId } as Awaited<
          ReturnType<NonNullable<StudioTransport["saveDevelopmentExport"]>>
        >;
      });
      const result = await accessDevelopmentExport(
        h.transport,
        { ...operation, status: "SUCCEEDED", exportId: "export-1", receipt: receipt() },
        "save",
      );
      expect(result).toBe(
        kind === "THROW" || kind === "REMOTE_UNKNOWN"
          ? "UNKNOWN"
          : kind === "CANCELLED"
            ? "CANCELLED"
            : "UNAVAILABLE",
      );
    },
  );

  test.each(["unknown", "changed", "throw", "drop", "success"])(
    "clearing %s preserves other operations",
    (fault) => {
      const saved: DevelopmentExportOperation = {
        ...operation,
        status: "SUCCEEDED",
        exportId: "export-1",
      };
      const h = setup(saved);
      if (fault === "changed")
        h.values.set(journalKey, JSON.stringify({ ...saved, operationId: otherId }));
      if (fault === "throw")
        h.storage.removeItem.mockImplementation(() => {
          throw new Error("locked");
        });
      if (fault === "drop") h.storage.removeItem.mockImplementation(() => {});
      expect(
        clearSucceededDevelopmentExportOperation(
          h.storage,
          fault === "unknown" ? operation : saved,
        ),
      ).toBe(fault === "success");
      expect(h.values.has(journalKey)).toBe(fault !== "success");
    },
  );
});
