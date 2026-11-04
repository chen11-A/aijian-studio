import {
  impactInput,
  impactOperation,
  sameImpactValue,
  impactCanonical,
  verifyImpactHash,
  isScriptConfirmationMutationRejection,
  type ScriptImpactGateway,
  type ScriptConfirmationOperation,
} from "@aijian/contracts/script-confirmation-impact";
import {
  scriptWriteOperationShape,
  verifyScriptWriteOperation,
  scriptWriteMutationRejection,
  type ScriptWriteOperationResult,
} from "@aijian/contracts/script-write-recovery";
export type ScriptBlock = {
  block_id: string;
  ordinal: number;
  kind: "ACTION" | "DIALOGUE";
  text: string;
  speaker: string | null;
  delivery?: "ON_SCREEN" | "OFF_SCREEN" | null;
};
export type ScriptScene = {
  scene_id: string;
  ordinal: number;
  heading: string;
  blocks: ScriptBlock[];
};
export type ScriptContent = {
  schema_version: "1.0.0";
  project_id: string;
  episode_id: string;
  production_brief_version_id?: string | null;
  story_bible_version_id?: string | null;
  source_extraction_version_id?: string | null;
  source_proposal_acceptance_id?: string | null;
  scenes: ScriptScene[];
};
export type ScriptWriteBlock = ScriptBlock & {
  delivery: "ON_SCREEN" | "OFF_SCREEN" | null;
};
export type ScriptWriteScene = Omit<ScriptScene, "blocks"> & {
  blocks: ScriptWriteBlock[];
};
export type ScriptWriteContent = ScriptContent & {
  production_brief_version_id: string | null;
  story_bible_version_id: string | null;
  source_extraction_version_id: string | null;
  source_proposal_acceptance_id: string | null;
  scenes: ScriptWriteScene[];
};
export type ScriptVersion = {
  version_id: string;
  project_id: string;
  episode_id: string;
  version_number: number;
  head_revision: number;
  parent_version_id: string | null;
  content: ScriptContent;
  content_hash: string;
  author_actor_id: string;
  change_summary: string;
  created_at: string;
};
export type ScriptResponse = { data: ScriptVersion; request_id: string };
export type ScriptCreatedResponse = {
  data: { version: ScriptVersion; replayed: boolean };
  request_id: string;
};
export type ScriptWriteCommand = {
  operation_id: string;
  payload: {
    content: ScriptWriteContent;
    parent_version_id: string | null;
    expected_revision: number | null;
    change_summary: string;
  };
};
type DefiniteError = {
  kind: "DEFINITE_SERVER_ERROR";
  status: number;
  code: string;
  request_id: string;
};
export type ScriptGateway = {
  getEpisodeScriptWriteOperation?(
    projectId: string,
    episodeId: string,
    operationId: string,
    payload: ScriptWriteCommand["payload"],
  ): Promise<ScriptWriteOperationResult<ScriptVersion>>;
  getEpisodeScript(
    projectId: string,
    episodeId: string,
  ): Promise<
    | { kind: "FOUND"; receipt: ScriptResponse }
    | { kind: "EMPTY" }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
  getEpisodeScriptVersion(
    projectId: string,
    episodeId: string,
    versionId: string,
  ): Promise<
    { kind: "FOUND"; receipt: ScriptResponse } | DefiniteError | { kind: "REMOTE_UNKNOWN" }
  >;
  createEpisodeScriptVersion(
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: ScriptWriteCommand["payload"],
  ): Promise<
    { kind: "CREATED"; receipt: ScriptCreatedResponse } | DefiniteError | { kind: "REMOTE_UNKNOWN" }
  >;
};
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PendingScriptWrite = {
  project_id: string;
  episode_id: string;
  command: ScriptWriteCommand;
};
type Pending = PendingScriptWrite;
export type ScriptJournal =
  { kind: "EMPTY" } | { kind: "PENDING"; pending: Pending } | { kind: "BLOCKED" };
export type ScriptRead =
  | { kind: "FOUND"; version: ScriptVersion }
  | { kind: "EMPTY" }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" };
export type ScriptWrite =
  | { kind: "SAVED"; version: ScriptVersion }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" }
  | { kind: "BLOCKED"; message: string };

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const ACCEPTANCE = /^pda_[0-9a-f]{32}$/;
const SCENE = /^scn_[0-9a-f]{32}$/;
const BLOCK = /^sblk_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const journalKey = (projectId: string, episodeId: string) =>
  `aivora.episode-script.pending.v1.${projectId}.${episodeId}`;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const knownKeys = (value: Record<string, unknown>, required: string[], optional: string[]) =>
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

function validContent(
  value: unknown,
  projectId: string,
  episodeId: string,
  requireDelivery = false,
): value is ScriptContent {
  if (
    !record(value) ||
    !knownKeys(
      value,
      ["schema_version", "project_id", "episode_id", "scenes"],
      [
        "production_brief_version_id",
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
      ],
    ) ||
    value.schema_version !== "1.0.0" ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !Array.isArray(value.scenes) ||
    value.scenes.length > 1_000
  )
    return false;
  for (const field of [
    "production_brief_version_id",
    "story_bible_version_id",
    "source_extraction_version_id",
  ] as const) {
    const fieldValue = value[field];
    if (
      fieldValue !== null &&
      fieldValue !== undefined &&
      (typeof fieldValue !== "string" || !VERSION.test(fieldValue))
    )
      return false;
  }
  const acceptance = value.source_proposal_acceptance_id;
  if (acceptance != null && (typeof acceptance !== "string" || !ACCEPTANCE.test(acceptance)))
    return false;
  if (requireDelivery && (value.source_extraction_version_id == null) !== (acceptance == null))
    return false;
  const ids = new Set<string>();
  return value.scenes.every((scene, index) => {
    if (
      !record(scene) ||
      !exactKeys(scene, ["scene_id", "ordinal", "heading", "blocks"]) ||
      typeof scene.scene_id !== "string" ||
      !SCENE.test(scene.scene_id) ||
      ids.has(scene.scene_id) ||
      scene.ordinal !== index + 1 ||
      typeof scene.heading !== "string" ||
      !scene.heading.trim() ||
      [...scene.heading].length > 240 ||
      !Array.isArray(scene.blocks) ||
      scene.blocks.length > 500
    )
      return false;
    ids.add(scene.scene_id);
    return scene.blocks.every((block, blockIndex) => {
      if (
        !record(block) ||
        !knownKeys(block, ["block_id", "ordinal", "kind", "text", "speaker"], ["delivery"]) ||
        typeof block.block_id !== "string" ||
        !BLOCK.test(block.block_id) ||
        ids.has(block.block_id) ||
        block.ordinal !== blockIndex + 1 ||
        (block.kind !== "ACTION" && block.kind !== "DIALOGUE") ||
        typeof block.text !== "string" ||
        !block.text.trim() ||
        [...block.text].length > 20_000
      )
        return false;
      ids.add(block.block_id);
      return block.kind === "ACTION"
        ? block.speaker == null && block.delivery == null
        : typeof block.speaker === "string" &&
            !!block.speaker.trim() &&
            [...block.speaker].length <= 120 &&
            ((!requireDelivery && block.delivery == null) ||
              block.delivery === "ON_SCREEN" ||
              block.delivery === "OFF_SCREEN");
    });
  });
}

export function validScriptVersion(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is ScriptVersion {
  if (
    !record(value) ||
    !exactKeys(value, [
      "version_id",
      "project_id",
      "episode_id",
      "version_number",
      "head_revision",
      "parent_version_id",
      "content",
      "content_hash",
      "author_actor_id",
      "change_summary",
      "created_at",
    ]) ||
    typeof value.version_id !== "string" ||
    !VERSION.test(value.version_id) ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !positive(value.version_number) ||
    !positive(value.head_revision) ||
    value.head_revision < value.version_number ||
    !(
      value.parent_version_id === null ||
      (typeof value.parent_version_id === "string" && VERSION.test(value.parent_version_id))
    ) ||
    typeof value.author_actor_id !== "string" ||
    !value.author_actor_id.trim() ||
    [...value.author_actor_id].length > 240 ||
    typeof value.change_summary !== "string" ||
    !value.change_summary.trim() ||
    [...value.change_summary].length > 240 ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.content_hash !== "string" ||
    !HASH.test(value.content_hash)
  )
    return false;
  return validContent(value.content, projectId, episodeId);
}

export async function readLatestScript(
  gateway: ScriptGateway,
  projectId: string,
  episodeId: string,
): Promise<ScriptRead> {
  try {
    const result = await gateway.getEpisodeScript(projectId, episodeId);
    if (result.kind === "EMPTY") return { kind: "EMPTY" };
    if (result.kind === "DEFINITE_SERVER_ERROR")
      return result.status === 404 && result.code === "SCRIPT_NOT_FOUND"
        ? { kind: "EMPTY" }
        : { kind: "REJECTED", status: result.status, code: result.code };
    if (result.kind === "FOUND" && validScriptVersion(result.receipt.data, projectId, episodeId))
      return { kind: "FOUND", version: result.receipt.data };
  } catch {
    /* An unsettled read does not establish state. */
  }
  return { kind: "UNKNOWN" };
}

function validPending(value: unknown, projectId: string, episodeId: string): value is Pending {
  if (
    !record(value) ||
    !exactKeys(value, ["project_id", "episode_id", "command"]) ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !record(value.command)
  )
    return false;
  const command = value.command;
  if (
    typeof command.operation_id !== "string" ||
    !UUID.test(command.operation_id) ||
    !exactKeys(command, ["operation_id", "payload"]) ||
    !record(command.payload)
  )
    return false;
  const input = command.payload;
  return (
    exactKeys(input, ["content", "parent_version_id", "expected_revision", "change_summary"]) &&
    validContent(input.content, projectId, episodeId, true) &&
    typeof input.change_summary === "string" &&
    input.change_summary.trim().length > 0 &&
    [...input.change_summary].length <= 240 &&
    (input.parent_version_id === null ||
      (typeof input.parent_version_id === "string" && VERSION.test(input.parent_version_id))) &&
    (input.expected_revision === null || positive(input.expected_revision)) &&
    (input.parent_version_id === null) === (input.expected_revision === null)
  );
}

export function readScriptJournal(
  storage: StoragePort,
  projectId: string,
  episodeId: string,
): ScriptJournal {
  if (!PROJECT.test(projectId) || !EPISODE.test(episodeId)) return { kind: "BLOCKED" };
  try {
    const raw = storage.getItem(journalKey(projectId, episodeId));
    if (raw === null) return { kind: "EMPTY" };
    if (raw.length > 2_500_000) return { kind: "BLOCKED" };
    const parsed: unknown = JSON.parse(raw);
    return validPending(parsed, projectId, episodeId)
      ? { kind: "PENDING", pending: parsed }
      : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}

function writeJournal(storage: StoragePort, pending: Pending): boolean {
  try {
    const raw = JSON.stringify(pending);
    if (raw.length > 2_500_000) return false;
    storage.setItem(journalKey(pending.project_id, pending.episode_id), raw);
    const read = readScriptJournal(storage, pending.project_id, pending.episode_id);
    return read.kind === "PENDING" && JSON.stringify(read.pending) === raw;
  } catch {
    return false;
  }
}

function closeScriptJournal(storage: StoragePort, pending: Pending): boolean {
  const { project_id: projectId, episode_id: episodeId } = pending;
  const current = readScriptJournal(storage, projectId, episodeId);
  if (current.kind !== "PENDING" || !sameScriptJson(current.pending, pending)) return false;
  try {
    storage.removeItem(journalKey(projectId, episodeId));
    return readScriptJournal(storage, projectId, episodeId).kind === "EMPTY";
  } catch {
    return false;
  }
}

/** Retain an owned unresolved command if storage is lost; never overwrite other evidence. */
export function preserveScriptJournal(storage: StoragePort, pending: Pending): boolean {
  if (!validPending(pending, pending.project_id, pending.episode_id)) return false;
  const current = readScriptJournal(storage, pending.project_id, pending.episode_id);
  if (current.kind === "EMPTY") return writeJournal(storage, pending);
  return current.kind === "PENDING" && sameScriptJson(current.pending, pending);
}

export async function recoverScriptWrite(
  gateway: ScriptGateway,
  storage: StoragePort,
  pending: Pending,
  canFinalize: () => boolean = () => true,
): Promise<ScriptWrite> {
  if (!validPending(pending, pending.project_id, pending.episode_id)) return { kind: "UNKNOWN" };
  const captured: Pending = JSON.parse(JSON.stringify(pending));
  const { project_id: projectId, episode_id: episodeId, command } = captured;
  if (
    !gateway.getEpisodeScriptWriteOperation ||
    !canFinalize() ||
    !preserveScriptJournal(storage, captured)
  )
    return { kind: "UNKNOWN" };
  try {
    const result = await gateway.getEpisodeScriptWriteOperation(
      projectId,
      episodeId,
      command.operation_id,
      command.payload,
    );
    if (
      !canFinalize() ||
      result.kind !== "FOUND" ||
      !scriptWriteOperationShape(
        result.receipt.data,
        projectId,
        episodeId,
        command.operation_id,
        (v): v is ScriptVersion => validScriptVersion(v, projectId, episodeId),
      ) ||
      !(await verifyScriptWriteOperation(result.receipt.data, command.payload))
    )
      return { kind: "UNKNOWN" };
    if (!canFinalize()) return { kind: "UNKNOWN" };
    const original = result.receipt.data.version;
    const exact = await gateway.getEpisodeScriptVersion(projectId, episodeId, original.version_id);
    if (
      !canFinalize() ||
      exact.kind !== "FOUND" ||
      !validScriptVersion(exact.receipt.data, projectId, episodeId) ||
      !sameScriptJson({ ...exact.receipt.data, head_revision: original.head_revision }, original) ||
      exact.receipt.data.head_revision < original.head_revision ||
      !closeScriptJournal(storage, captured)
    )
      return { kind: "UNKNOWN" };
    return { kind: "SAVED", version: exact.receipt.data };
  } catch {
    return { kind: "UNKNOWN" };
  }
}

/** JSON object key order may differ between the write receipt and stored readback. */
function sameScriptJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => sameScriptJson(item, right[index]))
    );
  }
  if (!record(left) || !record(right)) return false;
  const fields = Object.keys(left);
  return (
    fields.length === Object.keys(right).length &&
    fields.every(
      (field) => Object.hasOwn(right, field) && sameScriptJson(left[field], right[field]),
    )
  );
}

export async function saveScriptVersion(
  gateway: ScriptGateway,
  storage: StoragePort,
  projectId: string,
  episodeId: string,
  command: ScriptWriteCommand,
  options: { canFinalize?: () => boolean; onPrepared?: (pending: Pending) => void } = {},
): Promise<ScriptWrite> {
  const canFinalize = options.canFinalize ?? (() => true);
  if (
    !PROJECT.test(projectId) ||
    !EPISODE.test(episodeId) ||
    !canFinalize() ||
    !validPending({ project_id: projectId, episode_id: episodeId, command }, projectId, episodeId)
  )
    return { kind: "BLOCKED", message: "剧本范围或保存身份无效。" };
  const captured: ScriptWriteCommand = JSON.parse(JSON.stringify(command));
  if (readScriptJournal(storage, projectId, episodeId).kind !== "EMPTY")
    return { kind: "BLOCKED", message: "已有待核对的剧本提交，未重复发送。" };
  const pending = { project_id: projectId, episode_id: episodeId, command: captured };
  if (!writeJournal(storage, pending))
    return { kind: "BLOCKED", message: "无法持久记录提交身份，未发送剧本。" };
  try {
    options.onPrepared?.(JSON.parse(JSON.stringify(pending)) as Pending);
    if (!canFinalize()) return { kind: "UNKNOWN" };
    const result = await gateway.createEpisodeScriptVersion(
      projectId,
      episodeId,
      captured.operation_id,
      captured.payload,
    );
    if (!canFinalize()) return { kind: "UNKNOWN" };
    if (result.kind === "DEFINITE_SERVER_ERROR") {
      if (scriptWriteMutationRejection(result)) {
        if (!closeScriptJournal(storage, pending)) return { kind: "UNKNOWN" };
        return { kind: "REJECTED", status: result.status, code: result.code };
      }
      return { kind: "UNKNOWN" };
    }
    if (
      result.kind !== "CREATED" ||
      !validScriptVersion(result.receipt.data.version, projectId, episodeId)
    )
      return { kind: "UNKNOWN" };
    const version = result.receipt.data.version;
    if (
      version.parent_version_id !== captured.payload.parent_version_id ||
      version.version_number !== (captured.payload.expected_revision ?? 0) + 1 ||
      version.head_revision !== version.version_number ||
      version.change_summary !== captured.payload.change_summary ||
      !sameScriptJson(version.content, captured.payload.content)
    )
      return { kind: "UNKNOWN" };
    const exact = await gateway.getEpisodeScriptVersion(projectId, episodeId, version.version_id);
    if (
      !canFinalize() ||
      exact.kind !== "FOUND" ||
      !validScriptVersion(exact.receipt.data, projectId, episodeId) ||
      exact.receipt.data.version_id !== version.version_id ||
      exact.receipt.data.head_revision !== version.head_revision ||
      exact.receipt.data.content_hash !== version.content_hash ||
      !sameScriptJson(exact.receipt.data, version)
    )
      return { kind: "UNKNOWN" };
    if (!closeScriptJournal(storage, pending)) return { kind: "UNKNOWN" };
    return { kind: "SAVED", version: exact.receipt.data };
  } catch {
    return { kind: "UNKNOWN" };
  }
}

export function newScriptId(prefix: "scn" | "sblk"): string | null {
  try {
    return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
  } catch {
    return null;
  }
}

export type AcceptedSourceBinding = {
  sourceVersionId: string;
  acceptanceId: string;
};
export type SourceBindingRead =
  { kind: "BOUND"; binding: AcceptedSourceBinding } | { kind: "UNBOUND" } | { kind: "UNKNOWN" };
export type SourceBindingGateway = {
  getSourceExtraction(projectId: string): Promise<
    | {
        kind: "FOUND";
        receipt: {
          data: {
            project_id: string;
            head: { latest_version_id: string };
            version: { id: string; content_hash: string };
          };
        };
      }
    | { kind: "NOT_FOUND" | "REMOTE_UNKNOWN" }
    | { kind: "INCONSISTENT"; request_id: string }
  >;
  getSourceProposalAcceptanceForVersion(
    projectId: string,
    versionId: string,
  ): Promise<
    | {
        kind: "FOUND";
        receipt: {
          data: {
            acceptance_id: string;
            project_id: string;
            source_extraction_version_id: string;
            source_extraction_content_hash: string;
            latest_version_id: string;
            current: boolean;
          };
        };
      }
    | { kind: "NOT_FOUND" }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
};

export async function readAcceptedSourceBinding(
  gateway: SourceBindingGateway,
  projectId: string,
): Promise<SourceBindingRead> {
  try {
    const latest = await gateway.getSourceExtraction(projectId);
    if (latest.kind === "NOT_FOUND") return { kind: "UNBOUND" };
    if (latest.kind !== "FOUND" || latest.receipt.data.project_id !== projectId)
      return { kind: "UNKNOWN" };
    const source = latest.receipt.data;
    if (
      !VERSION.test(source.version.id) ||
      !HASH.test(source.version.content_hash) ||
      source.head.latest_version_id !== source.version.id
    )
      return { kind: "UNKNOWN" };
    const result = await gateway.getSourceProposalAcceptanceForVersion(
      projectId,
      source.version.id,
    );
    if (
      result.kind === "NOT_FOUND" ||
      (result.kind === "DEFINITE_SERVER_ERROR" && result.status === 404)
    )
      return { kind: "UNBOUND" };
    if (result.kind !== "FOUND") return { kind: "UNKNOWN" };
    const data = result.receipt.data;
    if (
      data.project_id !== projectId ||
      !data.current ||
      data.source_extraction_version_id !== source.version.id ||
      data.latest_version_id !== source.version.id ||
      data.source_extraction_content_hash !== source.version.content_hash ||
      !ACCEPTANCE.test(data.acceptance_id)
    )
      return { kind: "UNKNOWN" };
    return {
      kind: "BOUND",
      binding: {
        sourceVersionId: source.version.id,
        acceptanceId: data.acceptance_id,
      },
    };
  } catch {
    return { kind: "UNKNOWN" };
  }
}

export type ScriptConfirmation = {
  confirmation_id: string;
  project_id: string;
  episode_id: string;
  artifact_id: string;
  version_id: string;
  content_hash: string;
  head_revision: number;
  actor_id: string;
  confirmed_at: string;
};
export type ScriptConfirmationStatus = {
  project_id: string;
  episode_id: string;
  latest_version_id: string;
  latest_head_revision: number;
  confirmation: ScriptConfirmation | null;
  current: boolean;
};
export type ScriptConfirmationResponse = {
  data: ScriptConfirmationStatus;
  request_id: string;
};
export type ScriptConfirmationCreatedResponse = {
  data: { status: ScriptConfirmationStatus; replayed: boolean };
  request_id: string;
};
export type ScriptConfirmationPayload = {
  version_id: string;
  expected_content_hash: string;
  expected_head_revision: number;
  confirm: true;
};
export type ConfirmationGateway = Pick<
  ScriptImpactGateway,
  "getEpisodeScriptConfirmationOperation"
> & {
  getEpisodeScriptConfirmation(
    projectId: string,
    episodeId: string,
  ): Promise<
    | { kind: "FOUND"; receipt: ScriptConfirmationResponse }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
  getEpisodeScriptConfirmationReceipt(
    projectId: string,
    episodeId: string,
    confirmationId: string,
  ): Promise<
    | { kind: "FOUND"; receipt: ScriptConfirmationResponse }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
  createEpisodeScriptConfirmation(
    projectId: string,
    episodeId: string,
    idempotencyKey: string,
    payload: ScriptConfirmationPayload,
  ): Promise<
    | { kind: "CREATED"; receipt: ScriptConfirmationCreatedResponse }
    | DefiniteError
    | { kind: "REMOTE_UNKNOWN" }
  >;
};
export type PendingConfirmation = {
  project_id: string;
  episode_id: string;
  operation_id: string;
  payload: ScriptConfirmationPayload;
};
export type ConfirmationJournal =
  { kind: "EMPTY" } | { kind: "PENDING"; pending: PendingConfirmation } | { kind: "BLOCKED" };
export type ConfirmationRead =
  | { kind: "FOUND"; status: ScriptConfirmationStatus }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" };
export type ConfirmationWrite =
  | { kind: "CONFIRMED"; status: ScriptConfirmationStatus }
  | { kind: "REJECTED"; status: number; code: string }
  | { kind: "UNKNOWN" }
  | { kind: "BLOCKED"; message: string };
const CONFIRMATION = /^esc_[0-9a-f]{32}$/;
const ARTIFACT = /^art_[0-9a-f]{32}$/;
const confirmationKey = (projectId: string, episodeId: string) =>
  `aivora.episode-script.confirmation.pending.v1.${projectId}.${episodeId}`;

function validConfirmationStatus(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is ScriptConfirmationStatus {
  if (
    !record(value) ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    typeof value.latest_version_id !== "string" ||
    !VERSION.test(value.latest_version_id) ||
    !positive(value.latest_head_revision) ||
    typeof value.current !== "boolean"
  )
    return false;
  const confirmation = value.confirmation;
  if (confirmation === null) return value.current === false;
  if (
    !record(confirmation) ||
    confirmation.project_id !== projectId ||
    confirmation.episode_id !== episodeId ||
    typeof confirmation.confirmation_id !== "string" ||
    !CONFIRMATION.test(confirmation.confirmation_id) ||
    typeof confirmation.artifact_id !== "string" ||
    !ARTIFACT.test(confirmation.artifact_id) ||
    typeof confirmation.version_id !== "string" ||
    !VERSION.test(confirmation.version_id) ||
    typeof confirmation.content_hash !== "string" ||
    !HASH.test(confirmation.content_hash) ||
    !positive(confirmation.head_revision) ||
    typeof confirmation.actor_id !== "string" ||
    !confirmation.actor_id ||
    typeof confirmation.confirmed_at !== "string"
  )
    return false;
  return (
    !value.current ||
    (confirmation.version_id === value.latest_version_id &&
      confirmation.head_revision === value.latest_head_revision)
  );
}

export async function readScriptConfirmation(
  gateway: Pick<ConfirmationGateway, "getEpisodeScriptConfirmation">,
  projectId: string,
  episodeId: string,
): Promise<ConfirmationRead> {
  try {
    const result = await gateway.getEpisodeScriptConfirmation(projectId, episodeId);
    if (result.kind === "DEFINITE_SERVER_ERROR")
      return { kind: "REJECTED", status: result.status, code: result.code };
    if (
      result.kind === "FOUND" &&
      validConfirmationStatus(result.receipt.data, projectId, episodeId)
    )
      return { kind: "FOUND", status: result.receipt.data };
  } catch {
    /* A failed GET does not establish confirmation state. */
  }
  return { kind: "UNKNOWN" };
}

function validPendingConfirmation(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is PendingConfirmation {
  if (
    !record(value) ||
    Object.keys(value).length !== 4 ||
    !["project_id", "episode_id", "operation_id", "payload"].every((k) =>
      Object.hasOwn(value, k),
    ) ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    typeof value.operation_id !== "string" ||
    !UUID.test(value.operation_id) ||
    !record(value.payload)
  )
    return false;
  return impactInput(value.payload);
}

export function readConfirmationJournal(
  storage: StoragePort,
  projectId: string,
  episodeId: string,
): ConfirmationJournal {
  if (!PROJECT.test(projectId) || !EPISODE.test(episodeId)) return { kind: "BLOCKED" };
  try {
    const raw = storage.getItem(confirmationKey(projectId, episodeId));
    if (raw === null) return { kind: "EMPTY" };
    if (raw.length > 2_000) return { kind: "BLOCKED" };
    const parsed: unknown = JSON.parse(raw);
    return validPendingConfirmation(parsed, projectId, episodeId)
      ? { kind: "PENDING", pending: parsed }
      : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}

export function preserveConfirmationJournal(
  storage: StoragePort,
  pending: PendingConfirmation,
): boolean {
  if (!validPendingConfirmation(pending, pending.project_id, pending.episode_id)) return false;
  try {
    let current = readConfirmationJournal(storage, pending.project_id, pending.episode_id);
    if (current.kind === "EMPTY") {
      storage.setItem(
        confirmationKey(pending.project_id, pending.episode_id),
        impactCanonical(pending),
      );
      current = readConfirmationJournal(storage, pending.project_id, pending.episode_id);
    }
    return current.kind === "PENDING" && sameImpactValue(current.pending, pending);
  } catch {
    return false;
  }
}
export function closeConfirmationJournal(
  storage: StoragePort,
  projectId: string,
  episodeId: string,
  pending: PendingConfirmation,
): boolean {
  if (
    pending.project_id !== projectId ||
    pending.episode_id !== episodeId ||
    !preserveConfirmationJournal(storage, pending)
  )
    return false;
  try {
    storage.removeItem(confirmationKey(projectId, episodeId));
    return readConfirmationJournal(storage, projectId, episodeId).kind === "EMPTY";
  } catch {
    return false;
  }
}
export type ConfirmationRecovery =
  { kind: "RECOVERED"; operation: ScriptConfirmationOperation } | { kind: "UNKNOWN" };
export async function recoverScriptConfirmation(
  gateway: Pick<ConfirmationGateway, "getEpisodeScriptConfirmationOperation">,
  storage: StoragePort,
  pending: PendingConfirmation,
  expected?: ScriptConfirmation,
  canFinalize?: () => boolean,
): Promise<ConfirmationRecovery> {
  if (!preserveConfirmationJournal(storage, pending)) return { kind: "UNKNOWN" };
  try {
    const result = await gateway.getEpisodeScriptConfirmationOperation(
      pending.project_id,
      pending.episode_id,
      pending.operation_id,
      pending.payload,
    );
    if (
      result.kind !== "FOUND" ||
      !impactOperation(
        result.receipt.data,
        pending.project_id,
        pending.episode_id,
        pending.operation_id,
        pending.payload,
      )
    )
      return { kind: "UNKNOWN" };
    const report = result.receipt.data.lookup.report;
    if (report && !(await verifyImpactHash(report))) return { kind: "UNKNOWN" };
    if (
      (expected && !sameImpactValue(result.receipt.data.lookup.confirmation, expected)) ||
      (canFinalize && !canFinalize())
    )
      return { kind: "UNKNOWN" };
    if (!closeConfirmationJournal(storage, pending.project_id, pending.episode_id, pending))
      return { kind: "UNKNOWN" };
    return { kind: "RECOVERED", operation: result.receipt.data };
  } catch {
    return { kind: "UNKNOWN" };
  }
}

export async function confirmScriptVersion(
  gateway: ConfirmationGateway,
  storage: StoragePort,
  projectId: string,
  episodeId: string,
  version: ScriptVersion,
  operationId: string,
  onPrepared?: (pending: PendingConfirmation) => void,
  canFinalize?: () => boolean,
): Promise<ConfirmationWrite> {
  const pending: PendingConfirmation = {
    project_id: projectId,
    episode_id: episodeId,
    operation_id: operationId,
    payload: {
      version_id: version.version_id,
      expected_content_hash: version.content_hash,
      expected_head_revision: version.head_revision,
      confirm: true,
    },
  };
  if (
    !validPendingConfirmation(pending, projectId, episodeId) ||
    !validScriptVersion(version, projectId, episodeId) ||
    !validContent(version.content, projectId, episodeId, true)
  )
    return { kind: "BLOCKED", message: "待确认剧本身份无效。" };
  if (readConfirmationJournal(storage, projectId, episodeId).kind !== "EMPTY")
    return { kind: "BLOCKED", message: "已有待核对的确认操作，未重复发送。" };
  try {
    const raw = JSON.stringify(pending);
    storage.setItem(confirmationKey(projectId, episodeId), raw);
    const persisted = readConfirmationJournal(storage, projectId, episodeId);
    if (persisted.kind !== "PENDING" || JSON.stringify(persisted.pending) !== raw)
      return { kind: "BLOCKED", message: "无法持久记录确认身份，未发送。" };
    onPrepared?.(pending);
    if (canFinalize && !canFinalize()) return { kind: "UNKNOWN" };
    const result = await gateway.createEpisodeScriptConfirmation(
      projectId,
      episodeId,
      operationId,
      pending.payload,
    );
    if (result.kind === "DEFINITE_SERVER_ERROR") {
      if (isScriptConfirmationMutationRejection(result)) {
        if (canFinalize && !canFinalize()) return { kind: "UNKNOWN" };
        if (!closeConfirmationJournal(storage, projectId, episodeId, pending))
          return { kind: "UNKNOWN" };
        return { kind: "REJECTED", status: result.status, code: result.code };
      }
      return { kind: "UNKNOWN" };
    }
    if (
      result.kind !== "CREATED" ||
      !validConfirmationStatus(result.receipt.data.status, projectId, episodeId)
    )
      return { kind: "UNKNOWN" };
    const status = result.receipt.data.status;
    const confirmed = status.confirmation;
    if (
      !confirmed ||
      confirmed.actor_id !== "local-user" ||
      confirmed.version_id !== version.version_id ||
      confirmed.content_hash !== version.content_hash ||
      confirmed.head_revision !== version.head_revision
    )
      return { kind: "UNKNOWN" };
    const recovered = await recoverScriptConfirmation(
      gateway,
      storage,
      pending,
      confirmed,
      canFinalize,
    );
    if (recovered.kind !== "RECOVERED") return { kind: "UNKNOWN" };
    return { kind: "CONFIRMED", status };
  } catch {
    return { kind: "UNKNOWN" };
  }
}
