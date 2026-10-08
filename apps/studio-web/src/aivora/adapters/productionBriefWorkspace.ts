import type {
  ProductionBriefCreateCommand,
  ProductionBriefCreateResult,
  ProductionBriefResponse,
  StudioTransport,
} from "../../api/studio";

const pendingKey = "aivora.production-brief.pending.v1";

type PendingCommands = Record<string, ProductionBriefCreateCommand>;
const projectId = /^prj_[0-9a-f]{32}$/;
const operationId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const versionId = /^ver_[0-9a-f]{32}$/;
const sourceDocumentId = /^src_[0-9a-f]{32}$/;
const sourceBlockId = /^srcb_[0-9a-f]{32}$/;
const positiveInteger = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const hasRequiredKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  keys.every((key) => Object.hasOwn(value, key));
const isText = (value: unknown, limit = 4000) =>
  typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= limit;
function isOriginalReferences(value: unknown) {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 32) return false;
  const pairs = new Set<string>();
  return value.every(
    (reference) =>
      isRecord(reference) &&
      hasRequiredKeys(reference, ["reference_kind", "description"]) &&
      hasOnlyKeys(reference, ["reference_kind", "description"]) &&
      ["inspiration", "research", "other"].includes(String(reference.reference_kind)) &&
      isText(reference.description) &&
      !pairs.has(`${reference.reference_kind}\0${reference.description}`) &&
      (pairs.add(`${reference.reference_kind}\0${reference.description}`), true),
  );
}
function isRational(value: unknown) {
  if (
    !isRecord(value) ||
    !hasRequiredKeys(value, ["num", "den"]) ||
    !hasOnlyKeys(value, ["num", "den"])
  )
    return false;
  if (!positiveInteger(value.num) || !positiveInteger(value.den)) return false;
  if (Number(value.den) > 2_147_483_647) return false;
  let left = Number(value.num);
  let right = Number(value.den);
  while (right) [left, right] = [right, left % right];
  return left === 1;
}
function isPendingCommand(value: unknown): value is ProductionBriefCreateCommand {
  if (
    !isRecord(value) ||
    !hasRequiredKeys(value, ["operation_id", "input"]) ||
    !hasOnlyKeys(value, ["operation_id", "input"])
  )
    return false;
  const command = value;
  if (typeof command.operation_id !== "string" || !operationId.test(command.operation_id))
    return false;
  if (!isRecord(command.input)) return false;
  const input = command.input;
  if (
    !hasRequiredKeys(input, ["content", "change_summary"]) ||
    !hasOnlyKeys(input, ["content", "parent_version_id", "expected_revision", "change_summary"]) ||
    !isRecord(input.content)
  )
    return false;
  const content = input.content;
  const creative = isRecord(content.creative) ? content.creative : null;
  const delivery = isRecord(content.delivery) ? content.delivery : null;
  const duration = isRecord(content.duration_intent) ? content.duration_intent : null;
  const budget = isRecord(content.budget_intent) ? content.budget_intent : null;
  const rights = isRecord(content.rights_declaration) ? content.rights_declaration : null;
  const entry = isRecord(content.creative_entry) ? content.creative_entry : null;
  const entryValid =
    !!entry &&
    (entry.kind === "original_idea"
      ? hasRequiredKeys(entry, ["kind", "origin_statement"]) &&
        hasOnlyKeys(entry, ["kind", "origin_statement", "references"]) &&
        isText(entry.origin_statement) &&
        isOriginalReferences(entry.references)
      : entry.kind === "source_adaptation" &&
        hasRequiredKeys(entry, [
          "kind",
          "adaptation_statement",
          "source_document_id",
          "source_manifest_version_id",
          "source_block_ids",
        ]) &&
        hasOnlyKeys(entry, [
          "kind",
          "adaptation_statement",
          "source_document_id",
          "source_manifest_version_id",
          "source_block_ids",
        ]) &&
        isText(entry.adaptation_statement) &&
        typeof entry.source_document_id === "string" &&
        sourceDocumentId.test(entry.source_document_id) &&
        typeof entry.source_manifest_version_id === "string" &&
        versionId.test(entry.source_manifest_version_id) &&
        Array.isArray(entry.source_block_ids) &&
        entry.source_block_ids.length > 0 &&
        entry.source_block_ids.length <= 100 &&
        entry.source_block_ids.every(
          (block) => typeof block === "string" && sourceBlockId.test(block),
        ) &&
        new Set(entry.source_block_ids).size === entry.source_block_ids.length);
  return (
    (input.parent_version_id === undefined ||
      input.parent_version_id === null ||
      (typeof input.parent_version_id === "string" && versionId.test(input.parent_version_id))) &&
    (input.expected_revision === undefined ||
      input.expected_revision === null ||
      positiveInteger(input.expected_revision)) &&
    isText(input.change_summary, 1000) &&
    hasRequiredKeys(content, [
      "creative_entry",
      "creative",
      "delivery",
      "duration_intent",
      "budget_intent",
      "rights_declaration",
    ]) &&
    hasOnlyKeys(content, [
      "schema_version",
      "creative_entry",
      "creative",
      "delivery",
      "duration_intent",
      "budget_intent",
      "rights_declaration",
    ]) &&
    (content.schema_version === undefined || content.schema_version === "1.0.0") &&
    entryValid &&
    !!creative &&
    hasRequiredKeys(creative, ["premise", "intent"]) &&
    hasOnlyKeys(creative, ["premise", "intent", "audience", "genre", "style", "constraints"]) &&
    isText(creative.premise) &&
    isText(creative.intent) &&
    [creative.audience, creative.genre, creative.style].every(
      (field) => field === undefined || field === null || isText(field, 240),
    ) &&
    (creative.constraints === undefined || Array.isArray(creative.constraints)) &&
    (!Array.isArray(creative.constraints) || creative.constraints.length <= 32) &&
    (creative.constraints ?? []).every((constraint) => isText(constraint, 240)) &&
    new Set(creative.constraints ?? []).size === (creative.constraints ?? []).length &&
    !!delivery &&
    hasRequiredKeys(delivery, [
      "width_px",
      "height_px",
      "language",
      "display_aspect_ratio",
      "frame_rate",
    ]) &&
    hasOnlyKeys(delivery, [
      "width_px",
      "height_px",
      "language",
      "display_aspect_ratio",
      "frame_rate",
    ]) &&
    positiveInteger(delivery.width_px) &&
    positiveInteger(delivery.height_px) &&
    isText(delivery.language) &&
    isRational(delivery.display_aspect_ratio) &&
    isRational(delivery.frame_rate) &&
    BigInt(Number(delivery.width_px)) *
      BigInt(Number((delivery.display_aspect_ratio as Record<string, unknown>).den)) ===
      BigInt(Number(delivery.height_px)) *
        BigInt(Number((delivery.display_aspect_ratio as Record<string, unknown>).num)) &&
    !!duration &&
    hasRequiredKeys(duration, ["episode_mode", "work_seconds", "episode_seconds"]) &&
    hasOnlyKeys(duration, ["episode_mode", "work_seconds", "episode_seconds"]) &&
    (duration.episode_mode === "unspecified" || duration.episode_mode === "per_episode") &&
    (duration.work_seconds === null || positiveInteger(duration.work_seconds)) &&
    (duration.episode_mode === "unspecified"
      ? duration.episode_seconds === null
      : positiveInteger(duration.episode_seconds)) &&
    !!budget &&
    hasRequiredKeys(budget, ["state", "amount_micros", "currency"]) &&
    hasOnlyKeys(budget, ["state", "amount_micros", "currency"]) &&
    (budget.state === "unknown"
      ? budget.amount_micros === null && budget.currency === null
      : budget.state === "declared" &&
        Number.isSafeInteger(budget.amount_micros) &&
        Number(budget.amount_micros) >= 0 &&
        typeof budget.currency === "string" &&
        /^[A-Z]{3}$/.test(budget.currency)) &&
    !!rights &&
    hasRequiredKeys(rights, ["state", "statement"]) &&
    hasOnlyKeys(rights, ["state", "statement"]) &&
    (rights.state === "unknown"
      ? rights.statement === null
      : rights.state === "user_declared" && isText(rights.statement))
  );
}
export type PendingProductionBriefRead =
  | { kind: "READY"; command: ProductionBriefCreateCommand | null }
  | { kind: "UNREADABLE" }
  | { kind: "CORRUPT" };
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
function pendingCommands(): PendingCommands | null {
  let saved: string | null;
  try {
    const target = storage();
    if (!target) return null;
    saved = target.getItem(pendingKey);
  } catch {
    return null;
  }
  if (!saved) return {};
  try {
    const parsed: unknown = JSON.parse(saved);
    return isRecord(parsed) && Object.keys(parsed).every((key) => projectId.test(key))
      ? (parsed as PendingCommands)
      : null;
  } catch {
    return null;
  }
}
function savePending(commands: PendingCommands) {
  const target = storage();
  if (!target) return false;
  try {
    target.setItem(pendingKey, JSON.stringify(commands));
    return true;
  } catch {
    return false;
  }
}
export function pendingProductionBriefCommand(
  projectId: string,
): ProductionBriefCreateCommand | null {
  return pendingCommands()?.[projectId] ?? null;
}
export function readPendingProductionBriefCommand(projectId: string): PendingProductionBriefRead {
  const commands = pendingCommands();
  if (!commands) return { kind: "UNREADABLE" };
  if (Object.values(commands).some((entry) => !isPendingCommand(entry))) return { kind: "CORRUPT" };
  const command = commands[projectId] ?? null;
  if (command && !isPendingCommand(command)) return { kind: "CORRUPT" };
  return { kind: "READY", command };
}
export function retainProductionBriefCommand(
  projectId: string,
  command: ProductionBriefCreateCommand,
) {
  const commands = pendingCommands();
  return commands ? savePending({ ...commands, [projectId]: command }) : false;
}
export function clearPendingProductionBriefCommand(projectId: string, operation?: string) {
  const commands = pendingCommands();
  if (!commands) return false;
  if (operation && commands[projectId]?.operation_id !== operation) return false;
  delete commands[projectId];
  return savePending(commands);
}

export type ProductionBriefReadOutcome =
  | { kind: "SUCCEEDED"; receipt: ProductionBriefResponse | null }
  | { kind: "UNAVAILABLE" }
  | { kind: "ERROR" };

export async function readProductionBrief(
  transport: StudioTransport,
  projectId: string,
): Promise<ProductionBriefReadOutcome> {
  if (!transport.getProductionBrief) return { kind: "UNAVAILABLE" };
  try {
    return { kind: "SUCCEEDED", receipt: await transport.getProductionBrief(projectId) };
  } catch {
    return { kind: "ERROR" };
  }
}
export async function writeProductionBrief(
  transport: StudioTransport,
  projectId: string,
  command: ProductionBriefCreateCommand,
): Promise<ProductionBriefCreateResult | { kind: "UNAVAILABLE" }> {
  if (!transport.createProductionBriefVersion) return { kind: "UNAVAILABLE" };
  try {
    return await transport.createProductionBriefVersion(projectId, command);
  } catch {
    return { kind: "REMOTE_UNKNOWN" };
  }
}
