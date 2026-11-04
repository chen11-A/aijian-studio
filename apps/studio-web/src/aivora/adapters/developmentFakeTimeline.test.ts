import { describe, expect, test, vi } from "vitest";
import type {
  FakeTimelineRunCapability,
  SourceDocumentResponse,
  SourceManifestResponse,
  TaskQueueResponse,
  TimelineResponse,
} from "../../api/studio";
import { createFakeTimelineRunOperationJournal } from "../../fake-timeline-run-operation-journal";
import { createDevelopmentFakeTimelineAdapter } from "./developmentFakeTimeline";

const projectId = `prj_${"1".repeat(32)}`;
const otherProject = `prj_${"2".repeat(32)}`;
const version = `ver_${"3".repeat(32)}`;
const sourceId = `src_${"4".repeat(32)}`;
const operationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = `task_${"5".repeat(32)}`;
const pendingKey = `aijian.fake-timeline-run.pending.v1:${projectId}`;
const recoveryKey = `aijian.fake-timeline-run.recovered.v1:${projectId}`;
const project = { id: projectId };
// Upstream transport validation owns the remaining DTO fields. These fixtures
// contain the exact identity and lifecycle fields consumed by this adapter.
const source = { data: { id: sourceId, project_id: projectId } } as SourceDocumentResponse;
const manifest = {
  data: {
    project_id: projectId,
    head: { accepted_version_id: version },
    accepted_version: { id: version, content: { documents: [{ source_document_id: sourceId }] } },
  },
} as SourceManifestResponse;
const identity = {
  project_id: projectId,
  operation_id: operationId,
  source_manifest_version_id: version,
  source_document_id: sourceId,
  workflow_run_id: `wfr_${"6".repeat(32)}`,
  node_run_id: `node_${"7".repeat(32)}`,
  attempt_id: `att_${"8".repeat(32)}`,
  task_id: taskId,
};
const association = { schema_version: 1, ...identity };
type Query = NonNullable<FakeTimelineRunCapability["query"]>;
type QueryResult = Awaited<ReturnType<Query>>;
const found = {
  kind: "FOUND",
  receipt: { data: identity, request_id: operationId },
} as QueryResult;

function setup(pending = false) {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  const journal = createFakeTimelineRunOperationJournal(storage, {
    operationId: () => operationId,
    now: () => "2026-10-10T00:00:00.000Z",
  });
  if (pending)
    journal.begin(projectId, {
      source_manifest_version_id: version,
      source_document_id: sourceId,
    });
  const studio = {
    fakeTimelineRuns: {
      create: vi
        .fn<FakeTimelineRunCapability["create"]>()
        .mockResolvedValue({ kind: "REMOTE_UNKNOWN" }),
      query: vi.fn<Query>().mockResolvedValue(found),
    },
    getSourceManifest: vi.fn().mockResolvedValue(manifest),
    listProjectTasks: vi.fn().mockResolvedValue({ data: { project_id: projectId, tasks: [] } }),
    getProjectTimeline: vi.fn().mockResolvedValue(null),
  };
  const adapter = createDevelopmentFakeTimelineAdapter(studio, storage);
  return { values, storage, journal, studio, adapter, scope: adapter.activate(projectId) };
}

describe("development Fake recovery preserves operation identity", () => {
  test("queries once, persists association before cleanup, and reopens without submission", async () => {
    const h = setup(true);
    expect(h.adapter.readRecovery(h.scope)).toMatchObject({ kind: "pending" });
    const first = h.adapter.recoverPending(h.scope);
    expect(h.adapter.recoverPending(h.scope)).toBe(first);
    await expect(first).resolves.toEqual({
      kind: "recovered",
      association,
      projectId,
      deliver: true,
    });
    expect(h.studio.fakeTimelineRuns.query).toHaveBeenCalledExactlyOnceWith(projectId, {
      operation_id: operationId,
      input: { source_manifest_version_id: version, source_document_id: sourceId },
    });
    expect(h.values.has(pendingKey)).toBe(false);
    expect(JSON.parse(h.values.get(recoveryKey)!)).toEqual(association);
    const reopened = createDevelopmentFakeTimelineAdapter(h.studio, h.storage);
    const scope = reopened.activate(projectId);
    await expect(reopened.recoverPending(scope)).resolves.toMatchObject({
      kind: "recovered",
      association,
    });
    expect(h.studio.fakeTimelineRuns.query).toHaveBeenCalledTimes(1);
    expect(h.studio.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });

  test("pending submit remains blocked until read-only recovery resolves it", async () => {
    const h = setup(true);
    const before = h.values.get(pendingKey);
    await expect(h.adapter.submit(h.scope, project, source)).resolves.toMatchObject({
      kind: "pending-operation",
    });
    expect(h.values.get(pendingKey)).toBe(before);
    expect(h.studio.getSourceManifest).not.toHaveBeenCalled();
    expect(h.studio.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });

  test.each(["NOT_FOUND", "REMOTE_UNKNOWN"] as const)(
    "keeps %s pending without retry",
    async (kind) => {
      const h = setup(true);
      h.studio.fakeTimelineRuns.query.mockResolvedValue({
        kind,
        project_id: projectId,
        operation_id: operationId,
      } as QueryResult);
      await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
        kind: kind === "NOT_FOUND" ? "not-found" : "remote-unknown",
      });
      expect(h.journal.load(projectId)?.operation_id).toBe(operationId);
      expect(h.values.has(recoveryKey)).toBe(false);
      expect(h.studio.fakeTimelineRuns.create).not.toHaveBeenCalled();
    },
  );

  test("preserves definite server error details and the pending record", async () => {
    const h = setup(true);
    h.studio.fakeTimelineRuns.query.mockResolvedValue({
      kind: "DEFINITE_SERVER_ERROR",
      project_id: projectId,
      operation_id: operationId,
      status: 409,
      code: "CONFLICT",
      request_id: operationId,
    } as QueryResult);
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
      kind: "server-error",
      status: 409,
      code: "CONFLICT",
      request_id: operationId,
    });
    expect(h.journal.load(projectId)).not.toBeNull();
  });

  test.each([null, "bad", {}, { kind: "FOUND" }, { kind: "FOUND", receipt: {} }])(
    "rejects malformed query response %j",
    async (response) => {
      const h = setup(true);
      h.studio.fakeTimelineRuns.query.mockResolvedValue(response as QueryResult);
      const result = await h.adapter.recoverPending(h.scope);
      expect(["query-unavailable", "identity-mismatch"]).toContain(result.kind);
      expect(h.journal.load(projectId)).not.toBeNull();
      expect(h.values.has(recoveryKey)).toBe(false);
    },
  );

  test.each(Object.keys(identity))("rejects a mismatched recovered %s", async (field) => {
    const h = setup(true);
    h.studio.fakeTimelineRuns.query.mockResolvedValue({
      kind: "FOUND",
      receipt: { data: { ...identity, [field]: "bad" } },
    } as QueryResult);
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
      kind: "identity-mismatch",
    });
    expect(h.journal.load(projectId)).not.toBeNull();
  });

  test("rejects a non-found response belonging to a different operation", async () => {
    const h = setup(true);
    h.studio.fakeTimelineRuns.query.mockResolvedValue({
      kind: "NOT_FOUND",
      project_id: otherProject,
      operation_id: operationId,
    } as QueryResult);
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
      kind: "identity-mismatch",
    });
  });

  test("missing query capability never falls back to create", async () => {
    const h = setup(true);
    const adapter = createDevelopmentFakeTimelineAdapter(
      { ...h.studio, fakeTimelineRuns: { create: h.studio.fakeTimelineRuns.create } },
      h.storage,
    );
    await expect(adapter.recoverPending(adapter.activate(projectId))).resolves.toMatchObject({
      kind: "capability-unavailable",
    });
    expect(h.studio.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });

  test.each([false, true])(
    "query failure stays unavailable; scope switched=%s",
    async (switchScope) => {
      const h = setup(true);
      h.studio.fakeTimelineRuns.query.mockImplementation(async () => {
        if (switchScope) h.adapter.activate(otherProject);
        throw new Error("offline");
      });
      await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
        kind: switchScope ? "scope-unavailable" : "query-unavailable",
        deliver: !switchScope,
      });
      expect(h.journal.load(projectId)).not.toBeNull();
    },
  );

  test.each(["missing", "changed", "corrupt"] as const)(
    "does not erase a %s journal after query dispatch",
    async (change) => {
      const h = setup(true);
      h.studio.fakeTimelineRuns.query.mockImplementation(async () => {
        if (change === "missing") h.values.delete(pendingKey);
        else if (change === "corrupt") h.values.set(pendingKey, "{");
        else
          h.values.set(
            pendingKey,
            JSON.stringify({
              ...h.journal.load(projectId),
              created_at: "2026-10-10T00:01:00.000Z",
            }),
          );
        return found;
      });
      await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
        kind: change === "corrupt" ? "journal-corrupt" : "pending-changed",
      });
      expect(h.values.has(recoveryKey)).toBe(false);
    },
  );

  test.each(["throw", "drop", "rewrite"] as const)(
    "retains pending when association storage will %s",
    async (fault) => {
      const h = setup(true);
      h.storage.setItem.mockImplementation((key, value) => {
        if (fault === "throw") throw new Error("full");
        if (fault === "rewrite") h.values.set(key, value + " ");
      });
      await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
        kind: "storage-unavailable",
      });
      expect(h.journal.load(projectId)).not.toBeNull();
      expect(h.studio.fakeTimelineRuns.create).not.toHaveBeenCalled();
    },
  );

  test("cleanup failure is recoverable locally without another query", async () => {
    const h = setup(true);
    h.storage.removeItem.mockImplementation(() => {
      throw new Error("locked");
    });
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
      kind: "cleanup-pending",
    });
    expect(h.adapter.readRecovery(h.scope)).toMatchObject({ kind: "cleanup-pending" });
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
      kind: "cleanup-pending",
    });
    h.storage.removeItem.mockImplementation((key) => {
      h.values.delete(key);
    });
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({ kind: "recovered" });
    expect(h.studio.fakeTimelineRuns.query).toHaveBeenCalledTimes(1);
    expect(h.journal.load(projectId)).toBeNull();
  });

  test.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ ...association, extra: true }),
    JSON.stringify({ ...association, schema_version: 2 }),
  ])("keeps corrupt association %s untouched", async (raw) => {
    const h = setup();
    h.values.set(recoveryKey, raw);
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
      kind: "recovery-corrupt",
    });
    expect(h.values.get(recoveryKey)).toBe(raw);
    expect(h.studio.fakeTimelineRuns.query).not.toHaveBeenCalled();
  });

  test("corrupt pending blocks read, recovery and submission", async () => {
    const h = setup();
    h.values.set(pendingKey, "{");
    expect(h.adapter.readPending(h.scope)).toMatchObject({ kind: "journal-corrupt" });
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({
      kind: "journal-corrupt",
    });
    await expect(h.adapter.submit(h.scope, project, source)).resolves.toMatchObject({
      kind: "journal-corrupt",
    });
    expect(h.studio.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });
});

describe("development Fake adapter scope and media readiness", () => {
  test("empty state is readable and preparation does not dispatch", async () => {
    const h = setup();
    expect(h.adapter.readPending(h.scope)).toMatchObject({ kind: "none" });
    await expect(h.adapter.recoverPending(h.scope)).resolves.toMatchObject({ kind: "none" });
    await expect(h.adapter.prepare(h.scope, project, source)).resolves.toMatchObject({
      kind: "preflight",
      preflight: { kind: "ready" },
    });
    expect(h.studio.fakeTimelineRuns.create).not.toHaveBeenCalled();
  });

  test("same-tick submission is coalesced and UNKNOWN blocks a second submission", async () => {
    const h = setup();
    const first = h.adapter.submit(h.scope, project, source);
    expect(h.adapter.submit(h.scope, project, source)).toBe(first);
    await expect(first).resolves.toMatchObject({
      kind: "submission",
      submission: { kind: "REMOTE_UNKNOWN" },
    });
    await expect(h.adapter.submit(h.scope, project, source)).resolves.toMatchObject({
      kind: "pending-operation",
    });
    expect(h.studio.fakeTimelineRuns.create).toHaveBeenCalledTimes(1);
  });

  test("stale scopes perform no reads or writes", async () => {
    const h = setup();
    h.adapter.activate(otherProject);
    expect(h.adapter.readPending(h.scope)).toMatchObject({
      kind: "scope-unavailable",
      deliver: false,
    });
    expect(h.adapter.readRecovery(h.scope)).toMatchObject({ kind: "scope-unavailable" });
    for (const action of [
      h.adapter.recoverPending(h.scope),
      h.adapter.prepare(h.scope, project, source),
      h.adapter.submit(h.scope, project, source),
      h.adapter.refreshTask(h.scope, taskId),
    ]) {
      await expect(action).resolves.toMatchObject({ kind: "scope-unavailable", deliver: false });
    }
    expect(h.studio.getSourceManifest).not.toHaveBeenCalled();
    expect(h.studio.listProjectTasks).not.toHaveBeenCalled();
    expect(h.storage.getItem).not.toHaveBeenCalled();
  });

  test("project mismatch is rejected before loading a manifest", async () => {
    const h = setup();
    await expect(h.adapter.prepare(h.scope, { id: otherProject }, source)).resolves.toMatchObject({
      reason: "scope-project-mismatch",
    });
    await expect(h.adapter.submit(h.scope, { id: otherProject }, source)).resolves.toMatchObject({
      reason: "scope-project-mismatch",
    });
    expect(h.studio.getSourceManifest).not.toHaveBeenCalled();
  });

  test.each([false, true])("manifest failure distinguishes stale scope=%s", async (stale) => {
    const h = setup();
    h.studio.getSourceManifest.mockImplementation(async () => {
      if (stale) h.adapter.activate(otherProject);
      throw new Error("offline");
    });
    await expect(h.adapter.prepare(h.scope, project, source)).resolves.toMatchObject({
      kind: stale ? "scope-unavailable" : "manifest-unavailable",
    });
  });

  test("manifest or successful recovery completing after navigation is not delivered", async () => {
    const h = setup(true);
    h.studio.getSourceManifest.mockImplementation(async () => {
      h.adapter.activate(otherProject);
      return manifest;
    });
    await expect(h.adapter.prepare(h.scope, project, source)).resolves.toMatchObject({
      kind: "scope-unavailable",
    });
    const scope = h.adapter.activate(projectId);
    h.studio.fakeTimelineRuns.query.mockImplementation(async () => {
      h.adapter.activate(otherProject);
      return found;
    });
    await expect(h.adapter.recoverPending(scope)).resolves.toMatchObject({
      kind: "scope-unavailable",
    });
    expect(h.journal.load(projectId)).not.toBeNull();
  });

  function ready(h: ReturnType<typeof setup>) {
    const task = {
      task: { task_id: taskId, kind: "local.timeline.assemble.fake.media.v1", status: "COMPLETED" },
      attempt: { execution_mode: "local", status: "SUCCEEDED" },
      node: { status: "SUCCEEDED", output_version_id: version },
    };
    const queue = {
      data: { project_id: projectId, tasks: [task] },
    } as unknown as TaskQueueResponse;
    const timeline = {
      data: { project_id: projectId, version_id: version, timeline: { media_package: {} } },
    } as TimelineResponse;
    h.studio.listProjectTasks.mockResolvedValue(queue);
    h.studio.getProjectTimeline.mockResolvedValue(timeline);
    return { task, queue, timeline };
  }

  test("only a current completed local task exposes its media timeline", async () => {
    const h = setup();
    const { task, timeline } = ready(h);
    await expect(h.adapter.refreshTask(h.scope, taskId)).resolves.toMatchObject({
      kind: "task",
      task,
      output: { kind: "media", timeline },
    });
    expect(h.studio.getProjectTimeline).toHaveBeenCalledExactlyOnceWith(projectId);
  });

  test.each(["task-status", "attempt-status", "node-status", "no-output"])(
    "%s cannot expose output",
    async (fault) => {
      const h = setup();
      const { task } = ready(h);
      if (fault === "task-status") task.task.status = "QUEUED";
      if (fault === "attempt-status") task.attempt.status = "RUNNING";
      if (fault === "node-status") task.node.status = "RUNNING";
      if (fault === "no-output") task.node.output_version_id = "";
      await expect(h.adapter.refreshTask(h.scope, taskId)).resolves.toMatchObject({
        kind: "task",
        output: { kind: "not-ready" },
      });
      expect(h.studio.getProjectTimeline).not.toHaveBeenCalled();
    },
  );

  test.each(["id", "kind", "remote"])("does not associate task with wrong %s", async (fault) => {
    const h = setup();
    const { task } = ready(h);
    if (fault === "id") task.task.task_id = "other";
    if (fault === "kind") task.task.kind = "remote.generate";
    if (fault === "remote") task.attempt.execution_mode = "remote";
    await expect(h.adapter.refreshTask(h.scope, taskId)).resolves.toMatchObject({
      kind: "task-unavailable",
    });
  });

  test.each(["project", "version", "no-package", "missing"])(
    "timeline with %s mismatch is not current",
    async (fault) => {
      const h = setup();
      const { timeline } = ready(h);
      if (fault === "project") timeline.data.project_id = otherProject;
      if (fault === "version") timeline.data.version_id = `ver_${"9".repeat(32)}`;
      if (fault === "no-package") delete timeline.data.timeline.media_package;
      if (fault === "missing") h.studio.getProjectTimeline.mockResolvedValue(null);
      await expect(h.adapter.refreshTask(h.scope, taskId)).resolves.toMatchObject({
        kind: "task",
        output: { kind: "not-current" },
      });
    },
  );

  test.each([
    "queue-error",
    "queue-project",
    "queue-stale",
    "queue-error-stale",
    "timeline-error",
    "timeline-stale",
    "timeline-error-stale",
  ])("fails closed for %s", async (fault) => {
    const h = setup();
    const { queue, timeline } = ready(h);
    if (fault.startsWith("queue"))
      h.studio.listProjectTasks.mockImplementation(async () => {
        if (fault.endsWith("stale")) h.adapter.activate(otherProject);
        if (fault.includes("error")) throw new Error("offline");
        if (fault === "queue-project") queue.data.project_id = otherProject;
        return queue;
      });
    else
      h.studio.getProjectTimeline.mockImplementation(async () => {
        if (fault.endsWith("stale")) h.adapter.activate(otherProject);
        if (fault.includes("error")) throw new Error("offline");
        return timeline;
      });
    const kind = fault.endsWith("stale")
      ? "scope-unavailable"
      : fault.startsWith("queue")
        ? "queue-unavailable"
        : "timeline-unavailable";
    await expect(h.adapter.refreshTask(h.scope, taskId)).resolves.toMatchObject({ kind });
  });
});
