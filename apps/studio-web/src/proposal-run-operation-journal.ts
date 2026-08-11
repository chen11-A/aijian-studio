import type {
  ProposalRunCapability,
  ProposalRunCreateInput,
  ProposalRunCreateResult,
} from "./api/studio";

const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const VERSION_ID = /^ver_[0-9a-f]{32}$/;
const SOURCE_ID = /^src_[0-9a-f]{32}$/;
const SOURCE_BLOCK_ID = /^srcb_[0-9a-f]{32}$/;
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOURNAL_PREFIX = "aijian.proposal-run.pending.v1:";

type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PendingProposalRunOperation {
  schema_version: 1;
  state: "PENDING_SUBMIT";
  project_id: string;
  operation_id: string;
  input: ProposalRunCreateInput;
  created_at: string;
}

export interface ProposalRunOperationJournal {
  load(projectId: string): PendingProposalRunOperation | null;
  begin(projectId: string, input: ProposalRunCreateInput): PendingProposalRunOperation;
  complete(projectId: string, operationId: string): void;
}

export type ProposalRunSubmissionResult = ProposalRunCreateResult & {
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

function isDefinitionRef(value: unknown, definitionId: string): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["definition_id", "version"]) &&
    value.definition_id === definitionId &&
    value.version === "1.0.0"
  );
}

function isProposalRunInput(value: unknown): value is ProposalRunCreateInput {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "agent_definition",
      "skill_definition",
      "source_manifest_version_id",
      "source_document_id",
      "source_block_id",
      "start_byte",
      "end_byte",
    ])
  ) {
    return false;
  }
  return (
    isDefinitionRef(value.agent_definition, "writer.source-analyst") &&
    isDefinitionRef(value.skill_definition, "source.extract") &&
    typeof value.source_manifest_version_id === "string" &&
    VERSION_ID.test(value.source_manifest_version_id) &&
    typeof value.source_document_id === "string" &&
    SOURCE_ID.test(value.source_document_id) &&
    typeof value.source_block_id === "string" &&
    SOURCE_BLOCK_ID.test(value.source_block_id) &&
    Number.isSafeInteger(value.start_byte) &&
    Number(value.start_byte) >= 0 &&
    Number.isSafeInteger(value.end_byte) &&
    Number(value.end_byte) > Number(value.start_byte) &&
    Number(value.end_byte) - Number(value.start_byte) <= 64 * 1024
  );
}

function isUtcDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isPendingOperation(
  value: unknown,
  expectedProjectId: string,
): value is PendingProposalRunOperation {
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
    isProposalRunInput(value.input) &&
    isUtcDateTime(value.created_at)
  );
}

function sameInput(left: ProposalRunCreateInput, right: ProposalRunCreateInput): boolean {
  return (
    left.agent_definition.definition_id === right.agent_definition.definition_id &&
    left.agent_definition.version === right.agent_definition.version &&
    left.skill_definition.definition_id === right.skill_definition.definition_id &&
    left.skill_definition.version === right.skill_definition.version &&
    left.source_manifest_version_id === right.source_manifest_version_id &&
    left.source_document_id === right.source_document_id &&
    left.source_block_id === right.source_block_id &&
    left.start_byte === right.start_byte &&
    left.end_byte === right.end_byte
  );
}

function journalKey(projectId: string): string {
  if (!PROJECT_ID.test(projectId))
    throw new Error("proposal run journal requires a valid project id");
  return `${JOURNAL_PREFIX}${projectId}`;
}

export function createProposalRunOperationJournal(
  storage: StoragePort,
  dependencies: JournalDependencies = {
    operationId: () => globalThis.crypto.randomUUID().toLowerCase(),
    now: () => new Date().toISOString(),
  },
): ProposalRunOperationJournal {
  const load = (projectId: string): PendingProposalRunOperation | null => {
    const raw = storage.getItem(journalKey(projectId));
    if (raw === null) return null;
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error("proposal run journal is corrupt");
    }
    if (!isPendingOperation(decoded, projectId)) {
      throw new Error("proposal run journal is corrupt");
    }
    return decoded;
  };

  return {
    load,
    begin(projectId, input) {
      if (!isProposalRunInput(input)) throw new Error("proposal run input is invalid");
      const pending = load(projectId);
      if (pending) {
        if (!sameInput(pending.input, input)) {
          throw new Error("pending proposal run input does not match");
        }
        return pending;
      }
      const operation: PendingProposalRunOperation = {
        schema_version: 1,
        state: "PENDING_SUBMIT",
        project_id: projectId,
        operation_id: dependencies.operationId(),
        input,
        created_at: dependencies.now(),
      };
      if (!isPendingOperation(operation, projectId)) {
        throw new Error("proposal run operation identity is invalid");
      }
      storage.setItem(journalKey(projectId), JSON.stringify(operation));
      const persisted = load(projectId);
      if (!persisted || persisted.operation_id !== operation.operation_id) {
        throw new Error("proposal run journal did not persist the operation");
      }
      return persisted;
    },
    complete(projectId, operationId) {
      const pending = load(projectId);
      if (!pending || pending.operation_id !== operationId) {
        throw new Error("proposal run journal completion does not match");
      }
      storage.removeItem(journalKey(projectId));
      if (storage.getItem(journalKey(projectId)) !== null) {
        throw new Error("proposal run journal cleanup was not confirmed");
      }
    },
  };
}

export async function submitProposalRunOperation(
  journal: ProposalRunOperationJournal,
  capability: ProposalRunCapability,
  projectId: string,
  input: ProposalRunCreateInput,
): Promise<ProposalRunSubmissionResult> {
  const pending = journal.begin(projectId, input);
  let result: ProposalRunCreateResult;
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
