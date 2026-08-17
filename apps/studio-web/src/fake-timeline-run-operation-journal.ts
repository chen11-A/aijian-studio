import type {
  FakeTimelineRunCapability,
  FakeTimelineRunCreateInput,
  FakeTimelineRunCreateResult,
} from "./api/studio";

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const SOURCE_ID = /^src_[0-9a-f]{32}$/;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOURNAL_PREFIX = "aijian.fake-timeline-run.pending.v1:";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PendingFakeTimelineRunOperation {
  schema_version: 1;
  state: "PENDING_SUBMIT";
  project_id: string;
  operation_id: string;
  input: FakeTimelineRunCreateInput;
  created_at: string;
}

export interface FakeTimelineRunOperationJournal {
  load(projectId: string): PendingFakeTimelineRunOperation | null;
  begin(projectId: string, input: FakeTimelineRunCreateInput): PendingFakeTimelineRunOperation;
  complete(projectId: string, operationId: string): void;
}

export type FakeTimelineRunSubmissionResult = FakeTimelineRunCreateResult & {
  operation_id: string;
  journal_cleanup_pending: boolean;
};

interface JournalDependencies {
  operationId(): string;
  now(): string;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFakeTimelineRunInput(value: unknown): value is FakeTimelineRunCreateInput {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["source_manifest_version_id", "source_document_id"]) &&
    typeof value.source_manifest_version_id === "string" &&
    VERSION_ID.test(value.source_manifest_version_id) &&
    typeof value.source_document_id === "string" &&
    SOURCE_ID.test(value.source_document_id)
  );
}

const UTC_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

function isUtcDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_DATE_TIME.exec(value);
  if (!match) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  const date = new Date(parsed);
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3]) &&
    date.getUTCHours() === Number(match[4]) &&
    date.getUTCMinutes() === Number(match[5]) &&
    date.getUTCSeconds() === Number(match[6])
  );
}

function isPendingOperation(
  value: unknown,
  expectedProjectId: string,
): value is PendingFakeTimelineRunOperation {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "schema_version",
      "state",
      "project_id",
      "operation_id",
      "input",
      "created_at",
    ]) &&
    value.schema_version === 1 &&
    value.state === "PENDING_SUBMIT" &&
    value.project_id === expectedProjectId &&
    typeof value.operation_id === "string" &&
    OPERATION_ID.test(value.operation_id) &&
    isFakeTimelineRunInput(value.input) &&
    isUtcDateTime(value.created_at)
  );
}

function sameInput(left: FakeTimelineRunCreateInput, right: FakeTimelineRunCreateInput): boolean {
  return (
    left.source_manifest_version_id === right.source_manifest_version_id &&
    left.source_document_id === right.source_document_id
  );
}

function samePendingOperation(
  left: PendingFakeTimelineRunOperation,
  right: PendingFakeTimelineRunOperation,
): boolean {
  return (
    left.schema_version === right.schema_version &&
    left.state === right.state &&
    left.project_id === right.project_id &&
    left.operation_id === right.operation_id &&
    sameInput(left.input, right.input) &&
    left.created_at === right.created_at
  );
}

function journalKey(projectId: string): string {
  if (!PROJECT_ID.test(projectId)) {
    throw new Error("fake timeline run journal requires a valid project id");
  }
  return `${JOURNAL_PREFIX}${projectId}`;
}

export function createFakeTimelineRunOperationJournal(
  storage: StoragePort,
  dependencies: JournalDependencies = {
    operationId: () => globalThis.crypto.randomUUID().toLowerCase(),
    now: () => new Date().toISOString(),
  },
): FakeTimelineRunOperationJournal {
  const load = (projectId: string): PendingFakeTimelineRunOperation | null => {
    const raw = storage.getItem(journalKey(projectId));
    if (raw === null) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error("fake timeline run journal is corrupt");
    }
    if (!isPendingOperation(decoded, projectId)) {
      throw new Error("fake timeline run journal is corrupt");
    }
    return decoded;
  };

  return {
    load,
    begin(projectId, input) {
      if (!isFakeTimelineRunInput(input)) throw new Error("fake timeline run input is invalid");
      const pending = load(projectId);
      if (pending) {
        if (!sameInput(pending.input, input)) {
          throw new Error("pending fake timeline run input does not match");
        }
        return pending;
      }
      const operation: PendingFakeTimelineRunOperation = {
        schema_version: 1,
        state: "PENDING_SUBMIT",
        project_id: projectId,
        operation_id: dependencies.operationId(),
        input,
        created_at: dependencies.now(),
      };
      if (!isPendingOperation(operation, projectId)) {
        throw new Error("fake timeline run operation identity is invalid");
      }
      storage.setItem(journalKey(projectId), JSON.stringify(operation));
      const persisted = load(projectId);
      if (!persisted || !samePendingOperation(persisted, operation)) {
        throw new Error("fake timeline run journal did not persist the operation");
      }
      return persisted;
    },
    complete(projectId, operationId) {
      const pending = load(projectId);
      if (!pending || pending.operation_id !== operationId) {
        throw new Error("fake timeline run journal completion does not match");
      }
      storage.removeItem(journalKey(projectId));
      if (storage.getItem(journalKey(projectId)) !== null) {
        throw new Error("fake timeline run journal cleanup was not confirmed");
      }
    },
  };
}

export async function submitFakeTimelineRunOperation(
  journal: FakeTimelineRunOperationJournal,
  capability: FakeTimelineRunCapability,
  projectId: string,
  input: FakeTimelineRunCreateInput,
): Promise<FakeTimelineRunSubmissionResult> {
  const pending = journal.begin(projectId, input);
  let result: FakeTimelineRunCreateResult;
  try {
    result = await capability.create(projectId, {
      operation_id: pending.operation_id,
      input: pending.input,
    });
  } catch {
    result = { kind: "REMOTE_UNKNOWN" };
  }
  let journalCleanupPending = false;
  if (result.kind !== "REMOTE_UNKNOWN") {
    try {
      journal.complete(projectId, pending.operation_id);
    } catch {
      journalCleanupPending = true;
    }
  }
  return {
    ...result,
    operation_id: pending.operation_id,
    journal_cleanup_pending: journalCleanupPending,
  };
}
