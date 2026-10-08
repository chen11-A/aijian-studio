import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevelopmentExportAdapter } from "./developmentExport";
import { createRealTimelineDevelopment } from "./realTimelineDevelopment";
import { createFakeTimelineRunOperationJournal } from "../../fake-timeline-run-operation-journal";

const project = `prj_${"a".repeat(32)}`;
const versionA = `ver_${"b".repeat(32)}`;
const versionB = `ver_${"c".repeat(32)}`;
const source = `src_${"d".repeat(32)}`;
afterEach(() => localStorage.clear());

describe("K01 persistent adapter recovery", () => {
  it.each(["REMOTE_UNKNOWN", "DEFINITE_SERVER_ERROR"] as const)(
    "remounted Fake operation only GETs and preserves pending on %s",
    async (kind) => {
      const pending = createFakeTimelineRunOperationJournal(localStorage).begin(project, {
        source_manifest_version_id: versionA,
        source_document_id: source,
      });
      const create = vi.fn();
      const get = vi
        .fn()
        .mockResolvedValue(
          kind === "REMOTE_UNKNOWN"
            ? { kind }
            : { kind, status: 404, code: "NOT_FOUND", request_id: "qa-request" },
        );
      const bridge = { getSourceManifest: vi.fn(), fakeTimelineRuns: { create, get } };
      const first = createRealTimelineDevelopment(bridge, localStorage)!;
      first.activate(project);
      const reopened = createRealTimelineDevelopment(bridge, localStorage)!;
      reopened.activate(project);
      expect((await reopened.recoverPending(project, pending.operation_id)).kind).toBe(kind);
      expect(get).toHaveBeenCalledExactlyOnceWith(project, pending.operation_id, versionA, source);
      expect(create).not.toHaveBeenCalled();
      expect(reopened.loadPending(project)).toEqual(pending);
    },
  );

  it("Fake query exception preserves pending and never submits", async () => {
    const pending = createFakeTimelineRunOperationJournal(localStorage).begin(project, {
      source_manifest_version_id: versionA,
      source_document_id: source,
    });
    const create = vi.fn();
    const adapter = createRealTimelineDevelopment(
      {
        getSourceManifest: vi.fn(),
        fakeTimelineRuns: { create, get: vi.fn().mockRejectedValue(new Error("offline")) },
      },
      localStorage,
    )!;
    await expect(adapter.recoverPending(project, pending.operation_id)).rejects.toThrow("offline");
    expect(adapter.loadPending(project)).toEqual(pending);
    expect(create).not.toHaveBeenCalled();
  });

  it("export pending A cannot be overwritten by B and read recovery enables a later B", async () => {
    const create = vi
      .fn()
      .mockImplementation(async (projectId, input) => ({
        kind: "REMOTE_UNKNOWN",
        project_id: projectId,
        operation_id: input.operation_id,
      }));
    const get = vi.fn();
    const transport = {
      createDevelopmentExport: create,
      getDevelopmentExport: get,
      openDevelopmentExport: vi.fn(),
    };
    const first = createDevelopmentExportAdapter(transport, localStorage)!;
    expect((await first.create(project, versionA, 1)).kind).toBe("UNKNOWN");
    const original = first.load(project)!;
    const reopened = createDevelopmentExportAdapter(transport, localStorage)!;
    expect(await reopened.create(project, versionB, 2)).toEqual({
      kind: "EXISTING_CONFLICT",
      operationId: original.operation_id,
    });
    expect(reopened.load(project)).toEqual(original);
    expect(create).toHaveBeenCalledOnce();
    get.mockRejectedValueOnce(new Error("404"));
    await expect(reopened.recover(project)).rejects.toThrow("404");
    expect(reopened.load(project)).toEqual(original);
    const response = {
      data: {
        status: "SUCCEEDED",
        project_id: project,
        operation_id: original.operation_id,
        timeline_version_id: versionA,
        timeline_revision: 1,
      },
    };
    get.mockResolvedValueOnce(response);
    const recovered = await reopened.recover(project);
    expect(recovered.kind).toBe("SUCCEEDED");
    if (recovered.kind !== "SUCCEEDED") throw new Error("missing success");
    reopened.markSucceeded(project, recovered.response);
    expect(get).toHaveBeenLastCalledWith(project, original.operation_id, versionA, 1);
    expect((await reopened.create(project, versionB, 2)).kind).toBe("UNKNOWN");
    expect(create).toHaveBeenCalledTimes(2);
    expect(reopened.load(project)!.operation_id).not.toBe(original.operation_id);
  });

  it("storage unavailable blocks both adapters", () => {
    expect(
      createRealTimelineDevelopment(
        { getSourceManifest: vi.fn(), fakeTimelineRuns: { create: vi.fn() } },
        null,
      ),
    ).toBeNull();
    expect(createDevelopmentExportAdapter({}, null)).toBeNull();
  });
});
