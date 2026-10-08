import { describe, expect, test, vi } from "vitest";

import { createDevelopmentFakeTimelineAdapter } from "./developmentFakeTimeline";

const projectId = `prj_${"1".repeat(32)}`;
const otherProjectId = `prj_${"2".repeat(32)}`;
const versionId = `ver_${"3".repeat(32)}`;
const sourceId = `src_${"4".repeat(32)}`;
const operationId = "00000000-0000-4000-8000-000000000301";
const journalKey = `aijian.fake-timeline-run.pending.v1:${projectId}`;

function setup() {
  const entries = new Map<string, string>();
  entries.set(journalKey, JSON.stringify({
    schema_version: 1,
    state: "PENDING_SUBMIT",
    project_id: projectId,
    operation_id: operationId,
    input: { source_manifest_version_id: versionId, source_document_id: sourceId },
    created_at: "2026-09-24T01:00:00.000Z",
  }));
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); },
  };
  const create = vi.fn();
  const query = vi.fn();
  const studio = {
    getSourceManifest: vi.fn(),
    listProjectTasks: vi.fn(),
    getProjectTimeline: vi.fn(),
    fakeTimelineRuns: { create, query },
  } as unknown as Parameters<typeof createDevelopmentFakeTimelineAdapter>[0];
  return { adapter: createDevelopmentFakeTimelineAdapter(studio, storage), entries, create, query };
}

const found = {
  kind: "FOUND",
  receipt: {
    data: {
      project_id: projectId,
      operation_id: operationId,
      source_manifest_version_id: versionId,
      source_document_id: sourceId,
      workflow_run_id: `wfr_${"5".repeat(32)}`,
      node_run_id: `node_${"6".repeat(32)}`,
      attempt_id: `att_${"7".repeat(32)}`,
      task_id: `task_${"8".repeat(32)}`,
    },
    request_id: "00000000-0000-4000-8000-000000000302",
  },
} as const;

describe("durable Fake Timeline operation recovery", () => {
  test.each([
    { kind: "NOT_FOUND", project_id: projectId, operation_id: operationId },
    { kind: "DEFINITE_SERVER_ERROR", project_id: projectId, operation_id: operationId,
      status: 409, code: "FAKE_TIMELINE_OPERATION_CONFLICT", request_id: found.receipt.request_id },
    { kind: "REMOTE_UNKNOWN", project_id: projectId, operation_id: operationId },
    { ...found, receipt: { ...found.receipt,
      data: { ...found.receipt.data, source_document_id: `src_${"9".repeat(32)}` } } },
  ])("keeps the pending lock for nonmatching or unresolved GET %#", async (response) => {
    const { adapter, entries, create, query } = setup();
    query.mockResolvedValue(response);
    const scope = adapter.activate(projectId);
    const result = await adapter.recoverPending(scope);
    expect(["not-found", "server-error", "remote-unknown", "identity-mismatch"])
      .toContain(result.kind);
    expect(entries.has(journalKey)).toBe(true);
    const submit = await adapter.submit(
      scope, { id: projectId }, { data: { id: sourceId, project_id: projectId } },
    );
    expect(submit.kind).toBe("pending-operation");
    expect(create).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
  });

  test("only exact FOUND identity clears the original pending journal", async () => {
    const { adapter, entries, create, query } = setup();
    query.mockResolvedValue(found);
    const scope = adapter.activate(projectId);
    await expect(adapter.recoverPending(scope)).resolves.toMatchObject({ kind: "recovered" });
    expect(entries.has(journalKey)).toBe(false);
    expect(adapter.readRecovery(scope)).toMatchObject({ kind: "recovered" });
    expect(create).not.toHaveBeenCalled();
  });

  test("a late GET after project switch cannot clear the earlier project lock", async () => {
    const { adapter, entries, create, query } = setup();
    let complete!: (response: typeof found) => void;
    query.mockImplementation(() => new Promise<typeof found>((resolve) => { complete = resolve; }));
    const oldScope = adapter.activate(projectId);
    const pending = adapter.recoverPending(oldScope);
    adapter.activate(otherProjectId);
    complete(found);
    await expect(pending).resolves.toMatchObject({ kind: "scope-unavailable", deliver: false });
    expect(entries.has(journalKey)).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
});
