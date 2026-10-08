import type {
  ProjectData,
  StudioTransport,
  UpdateProjectCommand,
  UpdateProjectResult,
} from "../../api/studio";
import { hasAsciiControlCharacter } from "../textValidation";

export type ProjectManagementGateway = Pick<StudioTransport, "updateProject" | "getProject">;

export type ProjectUpdateIntent = {
  projectId: string;
  operationId: string;
  expectedRevision: number;
  name: string | null;
  status: "active" | "archived" | null;
};

export type ProjectJournalState =
  | { kind: "EMPTY" }
  | { kind: "PENDING"; intent: ProjectUpdateIntent }
  | { kind: "BLOCKED" };

export type ProjectUpdateOutcome =
  | { kind: "APPLIED"; project: ProjectData }
  | { kind: "REJECTED"; project: ProjectData | null; status: number; code: string }
  | { kind: "UNKNOWN"; current: ProjectData | null; targetReached: boolean }
  | { kind: "TRACKED"; intent: ProjectUpdateIntent }
  | { kind: "UNAVAILABLE"; message: string };

export type ProjectReadOutcome =
  | { kind: "CURRENT"; project: ProjectData; targetReached: boolean }
  | { kind: "UNKNOWN" }
  | { kind: "UNAVAILABLE"; message: string };

type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PROJECT_ID = /^prj_[0-9a-f]{32}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_JOURNAL_CHARACTERS = 1024;
const key = (projectId: string) => `aivora.project-update.v1.${projectId}`;

function validIntent(value: unknown, projectId: string): value is ProjectUpdateIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ProjectUpdateIntent>;
  const fields = ["projectId", "operationId", "expectedRevision", "name", "status"];
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field)) &&
    item.projectId === projectId && PROJECT_ID.test(projectId) &&
    typeof item.operationId === "string" && UUID_V4.test(item.operationId) &&
    Number.isSafeInteger(item.expectedRevision) && (item.expectedRevision ?? 0) > 0 &&
    (item.name === null || (typeof item.name === "string" && [...item.name].length > 0 &&
      [...item.name].length <= 80 && item.name === item.name.trim() &&
      !hasAsciiControlCharacter(item.name))) &&
    (item.status === null || item.status === "active" || item.status === "archived") &&
    (item.name !== null || item.status !== null);
}

export function readProjectUpdateJournal(
  storage: JournalStorage,
  projectId: string,
): ProjectJournalState {
  try {
    if (!PROJECT_ID.test(projectId)) return { kind: "BLOCKED" };
    const raw = storage.getItem(key(projectId));
    if (raw === null) return { kind: "EMPTY" };
    if (raw.length > MAX_JOURNAL_CHARACTERS) return { kind: "BLOCKED" };
    const parsed: unknown = JSON.parse(raw);
    return validIntent(parsed, projectId)
      ? { kind: "PENDING", intent: parsed } : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}

function persistIntent(storage: JournalStorage, intent: ProjectUpdateIntent): boolean {
  try {
    const raw = JSON.stringify(intent);
    if (raw.length > MAX_JOURNAL_CHARACTERS) return false;
    storage.setItem(key(intent.projectId), raw);
    const saved = readProjectUpdateJournal(storage, intent.projectId);
    return saved.kind === "PENDING" && JSON.stringify(saved.intent) === raw;
  } catch {
    return false;
  }
}

function sameIntent(storage: JournalStorage, intent: ProjectUpdateIntent): boolean {
  const saved = readProjectUpdateJournal(storage, intent.projectId);
  return saved.kind === "PENDING" &&
    JSON.stringify(saved.intent) === JSON.stringify(intent);
}

function clearIntent(storage: JournalStorage, intent: ProjectUpdateIntent): boolean {
  if (!sameIntent(storage, intent)) return false;
  try {
    storage.removeItem(key(intent.projectId));
    return readProjectUpdateJournal(storage, intent.projectId).kind === "EMPTY";
  } catch {
    return false;
  }
}

function validCurrent(value: unknown, projectId: string, expectedRevision: number):
  value is ProjectData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ProjectData>;
  return item.id === projectId && typeof item.name === "string" &&
    (item.status === "active" || item.status === "archived") &&
    Number.isSafeInteger(item.revision) && (item.revision ?? 0) >= expectedRevision &&
    typeof item.updated_at === "string";
}

function reached(current: ProjectData, intent: ProjectUpdateIntent): boolean {
  return (intent.name === null || current.name === intent.name) &&
    (intent.status === null || current.status === intent.status);
}

async function readCurrent(
  gateway: ProjectManagementGateway,
  intent: ProjectUpdateIntent,
): Promise<ProjectData | null> {
  try {
    const response = await gateway.getProject(intent.projectId);
    return validCurrent(response.data, intent.projectId, intent.expectedRevision)
      ? response.data : null;
  } catch {
    return null;
  }
}

/** Persist the operation identity before PATCH. Ambiguous responses never trigger another PATCH. */
export async function updateManagedProject(
  gateway: ProjectManagementGateway,
  storage: JournalStorage,
  projectId: string,
  command: UpdateProjectCommand,
): Promise<ProjectUpdateOutcome> {
  if (!gateway.updateProject || !PROJECT_ID.test(projectId) ||
    !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 ||
    (command.name === undefined && command.status === undefined) ||
    (command.name !== undefined && (typeof command.name !== "string" ||
      [...command.name].length < 1 || [...command.name].length > 80 ||
      command.name !== command.name.trim() || hasAsciiControlCharacter(command.name))) ||
    (command.status !== undefined && command.status !== "active" &&
      command.status !== "archived") || typeof crypto === "undefined" ||
    typeof crypto.randomUUID !== "function")
    return { kind: "UNAVAILABLE", message: "项目更新接口或输入不可用；未提交更改。" };
  const prior = readProjectUpdateJournal(storage, projectId);
  if (prior.kind === "BLOCKED")
    return { kind: "UNAVAILABLE", message: "本地更新记录无法读取；已阻止提交。" };
  if (prior.kind === "PENDING") return { kind: "TRACKED", intent: prior.intent };
  const intent: ProjectUpdateIntent = {
    projectId, operationId: crypto.randomUUID(),
    expectedRevision: command.expectedRevision,
    name: command.name ?? null, status: command.status ?? null,
  };
  if (!persistIntent(storage, intent))
    return { kind: "UNAVAILABLE", message: "更新身份未能保存并回读；未提交。" };
  let result: UpdateProjectResult;
  try {
    result = await gateway.updateProject(projectId, command);
  } catch {
    result = { kind: "REMOTE_UNKNOWN" };
  }
  if (!sameIntent(storage, intent))
    return { kind: "UNAVAILABLE", message: "更新记录期间发生变化；旧回包已丢弃。" };
  const current = await readCurrent(gateway, intent);
  if (!sameIntent(storage, intent))
    return { kind: "UNAVAILABLE", message: "读回期间更新记录发生变化；旧回包已丢弃。" };
  if (result.kind === "SUCCEEDED" && current &&
    validCurrent(result.receipt.data, projectId, command.expectedRevision) &&
    JSON.stringify(result.receipt.data) === JSON.stringify(current) &&
    reached(current, intent) && current.revision <= command.expectedRevision + 1 &&
    clearIntent(storage, intent))
    return { kind: "APPLIED", project: current };
  if (result.kind === "INVALID_INPUT" && clearIntent(storage, intent))
    return { kind: "UNAVAILABLE", message: "桌面桥拒绝了项目更新输入；未提交。" };
  if (result.kind === "DEFINITE_SERVER_ERROR" &&
    [401, 403, 404, 409, 412, 422, 428].includes(result.status) &&
    typeof result.code === "string" && clearIntent(storage, intent))
    return { kind: "REJECTED", project: current,
      status: result.status, code: result.code };
  return { kind: "UNKNOWN", current, targetReached: !!current && reached(current, intent) };
}

export async function readPendingProjectUpdate(
  gateway: ProjectManagementGateway,
  storage: JournalStorage,
  projectId: string,
): Promise<ProjectReadOutcome> {
  const journal = readProjectUpdateJournal(storage, projectId);
  if (journal.kind === "BLOCKED")
    return { kind: "UNAVAILABLE", message: "本地更新记录不可读取。" };
  if (journal.kind !== "PENDING")
    return { kind: "UNAVAILABLE", message: "没有待核对的原项目操作。" };
  const current = await readCurrent(gateway, journal.intent);
  if (!sameIntent(storage, journal.intent))
    return { kind: "UNAVAILABLE", message: "读取期间原操作已变化。" };
  return current ? { kind: "CURRENT", project: current,
    targetReached: reached(current, journal.intent) } : { kind: "UNKNOWN" };
}

/** A deliberate reconciliation ends the local lock; it never proves which PATCH set the state. */
export async function closePendingProjectUpdate(
  gateway: ProjectManagementGateway,
  storage: JournalStorage,
  projectId: string,
): Promise<ProjectReadOutcome> {
  const journal = readProjectUpdateJournal(storage, projectId);
  if (journal.kind !== "PENDING")
    return { kind: "UNAVAILABLE", message: "原操作记录不可用，未解除锁定。" };
  const current = await readCurrent(gateway, journal.intent);
  if (!current || !sameIntent(storage, journal.intent)) return { kind: "UNKNOWN" };
  if (!clearIntent(storage, journal.intent))
    return { kind: "UNAVAILABLE", message: "本地锁未能删除并回读，仍保持锁定。" };
  return { kind: "CURRENT", project: current,
    targetReached: reached(current, journal.intent) };
}
