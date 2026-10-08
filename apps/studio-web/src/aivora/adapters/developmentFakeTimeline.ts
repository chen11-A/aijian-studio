import type {
  FakeTimelineRunCapability,
  FakeTimelineRunOperationResponse,
  ProjectData,
  SourceDocumentResponse,
  StudioTransport,
  TaskQueueResponse,
  TimelineResponse,
} from "../../api/studio";
import {
  createFakeTimelineDevelopmentCoordinator,
  type FakeTimelineDevelopmentResult,
  type FakeTimelineDevelopmentScope,
} from "../../fake-timeline-run-development";
import {
  createFakeTimelineRunOperationJournal,
  type PendingFakeTimelineRunOperation,
} from "../../fake-timeline-run-operation-journal";
import { prepareFakeTimelineRun, type FakeTimelinePreflight } from "../../fake-timeline-run-preflight";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type FakeTask = TaskQueueResponse["data"]["tasks"][number];
type FakeStudio = Pick<
  StudioTransport,
  "getSourceManifest" | "listProjectTasks" | "getProjectTimeline"
> & { fakeTimelineRuns: FakeTimelineRunCapability };

type Scoped = { projectId: string; deliver: boolean };
type ScopeUnavailable = Scoped & {
  kind: "scope-unavailable";
  reason: "scope-project-mismatch" | "stale-scope";
  deliver: false;
};
type RecoveredIdentity = FakeTimelineRunOperationResponse["data"];
const RECOVERY_PREFIX = "aijian.fake-timeline-run.recovered.v1:";
const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const SOURCE_ID = /^src_[0-9a-f]{32}$/;
const WORKFLOW_ID = /^wfr_[0-9a-f]{32}$/;
const NODE_ID = /^node_[0-9a-f]{32}$/;
const ATTEMPT_ID = /^att_[0-9a-f]{32}$/;
const TASK_ID = /^task_[0-9a-f]{32}$/;

export type RecoveredFakeTimelineRun = RecoveredIdentity & { schema_version: 1 };

function isRecovered(value: unknown, projectId: string): value is RecoveredFakeTimelineRun {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = [
    "schema_version", "project_id", "operation_id", "source_manifest_version_id",
    "source_document_id", "workflow_run_id", "node_run_id", "attempt_id", "task_id",
  ];
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(record, key)) &&
    record.schema_version === 1 &&
    record.project_id === projectId && PROJECT_ID.test(projectId) &&
    typeof record.operation_id === "string" && OPERATION_ID.test(record.operation_id) &&
    typeof record.source_manifest_version_id === "string" && VERSION_ID.test(record.source_manifest_version_id) &&
    typeof record.source_document_id === "string" && SOURCE_ID.test(record.source_document_id) &&
    typeof record.workflow_run_id === "string" && WORKFLOW_ID.test(record.workflow_run_id) &&
    typeof record.node_run_id === "string" && NODE_ID.test(record.node_run_id) &&
    typeof record.attempt_id === "string" && ATTEMPT_ID.test(record.attempt_id) &&
    typeof record.task_id === "string" && TASK_ID.test(record.task_id)
  );
}

function matchesPending(identity: RecoveredIdentity, pending: PendingFakeTimelineRunOperation) {
  return (
    identity.project_id === pending.project_id &&
    identity.operation_id === pending.operation_id &&
    identity.source_manifest_version_id === pending.input.source_manifest_version_id &&
    identity.source_document_id === pending.input.source_document_id
  );
}

export const DEVELOPMENT_FAKE_TIMELINE_PURPOSE = "DEVELOPMENT_EVIDENCE" as const;
export const DEVELOPMENT_FAKE_TIMELINE_LABEL = "Fake / DEVELOPMENT_EVIDENCE" as const;

export type DevelopmentFakeTimelinePending =
  | ScopeUnavailable
  | (Scoped & { kind: "none" })
  | (Scoped & { kind: "pending"; operation: PendingFakeTimelineRunOperation })
  | (Scoped & { kind: "journal-corrupt" });

export type DevelopmentFakeTimelinePreparation =
  | ScopeUnavailable
  | (Scoped & { kind: "manifest-unavailable" })
  | (Scoped & { kind: "preflight"; preflight: FakeTimelinePreflight });

export type DevelopmentFakeTimelineSubmission =
  | FakeTimelineDevelopmentResult
  | (Scoped & { kind: "pending-operation"; operation: PendingFakeTimelineRunOperation });

export type DevelopmentFakeTimelineTaskRefresh =
  | ScopeUnavailable
  | (Scoped & { kind: "queue-unavailable" | "task-unavailable" })
  | (Scoped & { kind: "timeline-unavailable"; task: FakeTask })
  | (Scoped & {
      kind: "task";
      task: FakeTask;
      output:
        | { kind: "not-ready" | "not-current" }
        | { kind: "media"; timeline: TimelineResponse };
    });

export type DevelopmentFakeTimelineRecoveryState =
  | ScopeUnavailable
  | (Scoped & { kind: "none" | "journal-corrupt" | "recovery-corrupt" })
  | (Scoped & { kind: "pending"; operation: PendingFakeTimelineRunOperation })
  | (Scoped & {
      kind: "cleanup-pending";
      operation: PendingFakeTimelineRunOperation;
      association: RecoveredFakeTimelineRun;
    })
  | (Scoped & { kind: "recovered"; association: RecoveredFakeTimelineRun });

export type DevelopmentFakeTimelineRecoveryResult =
  | DevelopmentFakeTimelineRecoveryState
  | (Scoped & {
      kind:
        | "capability-unavailable" | "query-unavailable" | "not-found"
        | "remote-unknown" | "identity-mismatch" | "pending-changed"
        | "storage-unavailable";
      operation: PendingFakeTimelineRunOperation;
    })
  | (Scoped & {
      kind: "server-error";
      operation: PendingFakeTimelineRunOperation;
      status: number;
      code: string;
      request_id: string;
    });

/** A renderer adapter for local Fake development evidence, never provider generation. */
export function createDevelopmentFakeTimelineAdapter(studio: FakeStudio, storage: StoragePort) {
  const journal = createFakeTimelineRunOperationJournal(storage);
  const coordinator = createFakeTimelineDevelopmentCoordinator({
    journal,
    capability: studio.fakeTimelineRuns,
    loadManifest: (projectId) => studio.getSourceManifest(projectId),
  });
  const inFlight = new Map<string, Promise<DevelopmentFakeTimelineSubmission>>();
  const recovering = new Map<string, Promise<DevelopmentFakeTimelineRecoveryResult>>();
  let activeScope: FakeTimelineDevelopmentScope | null = null;

  const isCurrent = (scope: FakeTimelineDevelopmentScope) =>
    activeScope?.projectId === scope.projectId && activeScope.token === scope.token;
  const scoped = (scope: FakeTimelineDevelopmentScope): Scoped => ({
    projectId: scope.projectId,
    deliver: isCurrent(scope),
  });
  const unavailable = (
    scope: FakeTimelineDevelopmentScope,
    projectId = scope.projectId,
  ): ScopeUnavailable => ({
    kind: "scope-unavailable",
    reason: projectId === scope.projectId ? "stale-scope" : "scope-project-mismatch",
    projectId: scope.projectId,
    deliver: false,
  });
  const readPending = (scope: FakeTimelineDevelopmentScope): DevelopmentFakeTimelinePending => {
    if (!isCurrent(scope)) return unavailable(scope);
    try {
      const operation = journal.load(scope.projectId);
      return operation
        ? { kind: "pending", operation, ...scoped(scope) }
        : { kind: "none", ...scoped(scope) };
    } catch {
      return { kind: "journal-corrupt", ...scoped(scope) };
    }
  };
  const recoveryKey = (projectId: string) => {
    if (!PROJECT_ID.test(projectId)) throw new Error("invalid recovery project id");
    return `${RECOVERY_PREFIX}${projectId}`;
  };
  const readAssociation = (projectId: string): RecoveredFakeTimelineRun | null => {
    const raw = storage.getItem(recoveryKey(projectId));
    if (raw === null) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error("fake timeline recovery record is corrupt");
    }
    if (!isRecovered(decoded, projectId)) {
      throw new Error("fake timeline recovery record is corrupt");
    }
    return decoded;
  };
  const persistAssociation = (association: RecoveredFakeTimelineRun) => {
    readAssociation(association.project_id);
    const key = recoveryKey(association.project_id);
    const serialized = JSON.stringify(association);
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized || !readAssociation(association.project_id)) {
      throw new Error("fake timeline recovery record did not persist");
    }
  };
  const readRecovery = (
    scope: FakeTimelineDevelopmentScope,
  ): DevelopmentFakeTimelineRecoveryState => {
    if (!isCurrent(scope)) return unavailable(scope);
    let operation: PendingFakeTimelineRunOperation | null;
    try {
      operation = journal.load(scope.projectId);
    } catch {
      return { kind: "journal-corrupt", ...scoped(scope) };
    }
    let association: RecoveredFakeTimelineRun | null;
    try {
      association = readAssociation(scope.projectId);
    } catch {
      return { kind: "recovery-corrupt", ...scoped(scope) };
    }
    if (operation && association && matchesPending(association, operation)) {
      return { kind: "cleanup-pending", operation, association, ...scoped(scope) };
    }
    if (operation) return { kind: "pending", operation, ...scoped(scope) };
    if (association) return { kind: "recovered", association, ...scoped(scope) };
    return { kind: "none", ...scoped(scope) };
  };
  const recoverPending = (
    scope: FakeTimelineDevelopmentScope,
  ): Promise<DevelopmentFakeTimelineRecoveryResult> => {
    if (!isCurrent(scope)) return Promise.resolve(unavailable(scope));
    const existing = recovering.get(scope.projectId);
    if (existing) return existing;
    const request = (async (): Promise<DevelopmentFakeTimelineRecoveryResult> => {
      const state = readRecovery(scope);
      if (state.kind === "cleanup-pending") {
        try {
          journal.complete(scope.projectId, state.operation.operation_id);
        } catch {
          return { ...state, ...scoped(scope) };
        }
        return { kind: "recovered", association: state.association, ...scoped(scope) };
      }
      if (state.kind !== "pending") return state;
      const operation = state.operation;
      const query = studio.fakeTimelineRuns.query;
      if (!query) return { kind: "capability-unavailable", operation, ...scoped(scope) };

      let response: Awaited<ReturnType<NonNullable<FakeTimelineRunCapability["query"]>>>;
      try {
        response = await query(scope.projectId, {
          operation_id: operation.operation_id,
          input: operation.input,
        });
      } catch {
        if (!isCurrent(scope)) return unavailable(scope);
        return { kind: "query-unavailable", operation, ...scoped(scope) };
      }
      if (!isCurrent(scope)) return unavailable(scope);
      if (!response || typeof response !== "object" || !("kind" in response)) {
        return { kind: "query-unavailable", operation, ...scoped(scope) };
      }
      if (response.kind !== "FOUND") {
        if (
          response.project_id !== operation.project_id ||
          response.operation_id !== operation.operation_id
        ) {
          return { kind: "identity-mismatch", operation, ...scoped(scope) };
        }
        if (response.kind === "DEFINITE_SERVER_ERROR") {
          return {
            kind: "server-error", operation, status: response.status,
            code: response.code, request_id: response.request_id, ...scoped(scope),
          };
        }
        return {
          kind: response.kind === "NOT_FOUND" ? "not-found" : "remote-unknown",
          operation,
          ...scoped(scope),
        };
      }
      if (!response.receipt || typeof response.receipt !== "object" || !response.receipt.data) {
        return { kind: "identity-mismatch", operation, ...scoped(scope) };
      }
      const association: RecoveredFakeTimelineRun = {
        schema_version: 1,
        ...response.receipt.data,
      };
      if (!matchesPending(association, operation) || !isRecovered(association, scope.projectId)) {
        return { kind: "identity-mismatch", operation, ...scoped(scope) };
      }
      let current: PendingFakeTimelineRunOperation | null;
      try {
        current = journal.load(scope.projectId);
      } catch {
        return { kind: "journal-corrupt", ...scoped(scope) };
      }
      if (
        !current ||
        current.operation_id !== operation.operation_id ||
        current.created_at !== operation.created_at ||
        current.input.source_manifest_version_id !== operation.input.source_manifest_version_id ||
        current.input.source_document_id !== operation.input.source_document_id
      ) {
        return { kind: "pending-changed", operation, ...scoped(scope) };
      }
      try {
        persistAssociation(association);
      } catch {
        return { kind: "storage-unavailable", operation, ...scoped(scope) };
      }
      try {
        journal.complete(scope.projectId, operation.operation_id);
      } catch {
        return { kind: "cleanup-pending", operation, association, ...scoped(scope) };
      }
      return { kind: "recovered", association, ...scoped(scope) };
    })();
    recovering.set(scope.projectId, request);
    void request.then(
      () => { if (recovering.get(scope.projectId) === request) recovering.delete(scope.projectId); },
      () => { if (recovering.get(scope.projectId) === request) recovering.delete(scope.projectId); },
    );
    return request;
  };

  return {
    activate(projectId: string): FakeTimelineDevelopmentScope {
      activeScope = coordinator.activate(projectId);
      return activeScope;
    },

    async prepare(
      scope: FakeTimelineDevelopmentScope,
      project: Pick<ProjectData, "id">,
      source: Pick<SourceDocumentResponse, "data">,
    ): Promise<DevelopmentFakeTimelinePreparation> {
      if (project.id !== scope.projectId || !isCurrent(scope)) {
        return unavailable(scope, project.id);
      }
      try {
        const manifest = await studio.getSourceManifest(project.id);
        if (!isCurrent(scope)) return unavailable(scope);
        return {
          kind: "preflight",
          preflight: prepareFakeTimelineRun(project, source, manifest),
          ...scoped(scope),
        };
      } catch {
        if (!isCurrent(scope)) return unavailable(scope);
        return { kind: "manifest-unavailable", ...scoped(scope) };
      }
    },

    readPending,
    readRecovery,
    recoverPending,

    submit(
      scope: FakeTimelineDevelopmentScope,
      project: Pick<ProjectData, "id">,
      source: Pick<SourceDocumentResponse, "data">,
    ): Promise<DevelopmentFakeTimelineSubmission> {
      if (project.id !== scope.projectId || !isCurrent(scope)) {
        return Promise.resolve(unavailable(scope, project.id));
      }
      const existing = inFlight.get(scope.projectId);
      if (existing) return existing;

      const pending = readPending(scope);
      if (pending.kind === "pending") {
        return Promise.resolve({ kind: "pending-operation", operation: pending.operation, ...scoped(scope) });
      }
      if (pending.kind === "journal-corrupt" || pending.kind === "scope-unavailable") {
        return Promise.resolve(pending);
      }

      const request = coordinator.submit(scope, project, source);
      inFlight.set(scope.projectId, request);
      void request.then(
        () => {
          if (inFlight.get(scope.projectId) === request) inFlight.delete(scope.projectId);
        },
        () => {
          if (inFlight.get(scope.projectId) === request) inFlight.delete(scope.projectId);
        },
      );
      return request;
    },

    async refreshTask(
      scope: FakeTimelineDevelopmentScope,
      taskId: string,
    ): Promise<DevelopmentFakeTimelineTaskRefresh> {
      if (!isCurrent(scope)) return unavailable(scope);
      let queue: TaskQueueResponse;
      try {
        queue = await studio.listProjectTasks(scope.projectId);
      } catch {
        if (!isCurrent(scope)) return unavailable(scope);
        return { kind: "queue-unavailable", ...scoped(scope) };
      }
      if (!isCurrent(scope)) return unavailable(scope);
      if (queue.data.project_id !== scope.projectId) {
        return { kind: "queue-unavailable", ...scoped(scope) };
      }
      const task = queue.data.tasks.find(
        (item) =>
          item.task.task_id === taskId &&
          item.task.kind === "local.timeline.assemble.fake.media.v1" &&
          item.attempt.execution_mode === "local",
      );
      if (!task) return { kind: "task-unavailable", ...scoped(scope) };
      const outputVersionId = task.node.output_version_id;
      if (
        task.node.status !== "SUCCEEDED" ||
        task.attempt.status !== "SUCCEEDED" ||
        task.task.status !== "COMPLETED" ||
        !outputVersionId
      ) {
        return { kind: "task", task, output: { kind: "not-ready" }, ...scoped(scope) };
      }

      let timeline: TimelineResponse | null;
      try {
        timeline = await studio.getProjectTimeline(scope.projectId);
      } catch {
        if (!isCurrent(scope)) return unavailable(scope);
        return { kind: "timeline-unavailable", task, ...scoped(scope) };
      }
      if (!isCurrent(scope)) return unavailable(scope);
      if (
        !timeline ||
        timeline.data.project_id !== scope.projectId ||
        timeline.data.version_id !== outputVersionId ||
        !timeline.data.timeline.media_package
      ) {
        return { kind: "task", task, output: { kind: "not-current" }, ...scoped(scope) };
      }
      return { kind: "task", task, output: { kind: "media", timeline }, ...scoped(scope) };
    },
  };
}
