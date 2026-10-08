import type {
  DevelopmentExportDefiniteRejection,
  DevelopmentExportResponse,
  StudioTransport,
} from "../../api/studio";

export type DevelopmentTimelineIdentity = Readonly<{
  projectId: string;
  timelineVersionId: string;
  contentHash: string;
  revision: number;
}>;

export type DevelopmentExportOperation = DevelopmentTimelineIdentity & Readonly<{
  operationId: string;
  status: "UNKNOWN" | "SUCCEEDED" | "REJECTED" | "CLOSED_REJECTED";
  exportId: string | null;
  receipt: DevelopmentExportResponse | null;
  rejection?: DevelopmentExportRejection | null;
}>;

export type DevelopmentExportRejection = Readonly<{
  kind: "DEFINITE_REJECTION";
  code: string;
  status: number | null;
  requestId: string | null;
  disposition: "REVIEW_INPUT" | "RECONCILE_OPERATION" | "RESTORE_AUTH" | "UNCLASSIFIED";
  requestEffect: "NO_EXPORT_CLAIM" | null;
  outcome: "SAFE_FIRST_REJECTION" | "KEEP_UNKNOWN";
  observedAt: string;
}>;

type ExportTransport = Pick<
  StudioTransport,
  | "createDevelopmentExport"
  | "getDevelopmentExport"
  | "openDevelopmentExport"
  | "saveDevelopmentExport"
>;
type JournalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem"> &
  Partial<Pick<Storage, "key" | "length">>;
export type ExportOutcome =
  | { kind: "SUCCEEDED"; operation: DevelopmentExportOperation }
  | { kind: "REJECTED"; operation: DevelopmentExportOperation }
  | { kind: "UNKNOWN"; operation: DevelopmentExportOperation }
  | { kind: "TRACKED"; operation: DevelopmentExportOperation }
  | { kind: "UNAVAILABLE"; message: string };

const key = (projectId: string) => `aivora.development-export.v2.${projectId}`;
const auditPrefix = (projectId: string) => `aivora.development-export.rejection.v1.${projectId}.`;
const auditKey = (operation: DevelopmentExportOperation) =>
  `${auditPrefix(operation.projectId)}${operation.operationId}`;
const MAX_AUDITS_PER_PROJECT = 64;
const MAX_AUDIT_CHARACTERS = 1024;
const projectIdPattern = /^prj_[0-9a-f]{32}$/;
const versionId = /^ver_[0-9a-f]{32}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const codePattern = /^[A-Z][A-Z0-9_]{0,79}$/;
const requestIdPattern = /^[A-Za-z0-9_-]{8,256}$/;
const isoTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRejection(value: unknown): value is DevelopmentExportRejection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const fields = ["kind", "code", "status", "requestId", "disposition",
    "requestEffect", "outcome", "observedAt"];
  return Object.keys(record).length === fields.length &&
    fields.every((field) => Object.hasOwn(record, field)) &&
    record.kind === "DEFINITE_REJECTION" &&
    typeof record.code === "string" && codePattern.test(record.code) &&
    (record.status === null ||
      (typeof record.status === "number" && Number.isInteger(record.status) &&
        record.status >= 400 && record.status <= 599)) &&
    (record.requestId === null ||
      (typeof record.requestId === "string" && requestIdPattern.test(record.requestId))) &&
    ["REVIEW_INPUT", "RECONCILE_OPERATION", "RESTORE_AUTH", "UNCLASSIFIED"]
      .includes(String(record.disposition)) &&
    (record.requestEffect === null || record.requestEffect === "NO_EXPORT_CLAIM") &&
    (record.outcome === "SAFE_FIRST_REJECTION" || record.outcome === "KEEP_UNKNOWN") &&
    typeof record.observedAt === "string" && isoTimePattern.test(record.observedAt) &&
    !Number.isNaN(Date.parse(record.observedAt)) &&
    (record.outcome !== "SAFE_FIRST_REJECTION" ||
      (record.code === "DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED" &&
        record.status === 422 && record.disposition === "REVIEW_INPUT" &&
        record.requestEffect === "NO_EXPORT_CLAIM" && record.requestId !== null));
}

function isIdentity(value: unknown): value is DevelopmentTimelineIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<DevelopmentTimelineIdentity>;
  return typeof identity.projectId === "string" && projectIdPattern.test(identity.projectId) &&
    typeof identity.timelineVersionId === "string" && versionId.test(identity.timelineVersionId) &&
    typeof identity.contentHash === "string" && /^sha256:[0-9a-f]{64}$/.test(identity.contentHash) &&
    Number.isSafeInteger(identity.revision) && (identity.revision ?? 0) > 0;
}

function sameOperation(left: DevelopmentExportOperation, right: DevelopmentExportOperation): boolean {
  return left.projectId === right.projectId && left.operationId === right.operationId &&
    left.timelineVersionId === right.timelineVersionId &&
    left.contentHash === right.contentHash && left.revision === right.revision;
}

function rejectionObservation(
  result: DevelopmentExportDefiniteRejection,
  operation: DevelopmentExportOperation,
  firstDispatch: boolean,
): DevelopmentExportRejection {
  const identityMatches = result.project_id === operation.projectId &&
    result.operation_id === operation.operationId &&
    result.timeline_version_id === operation.timelineVersionId &&
    result.expected_revision === operation.revision;
  const code = typeof result.code === "string" && codePattern.test(result.code)
    ? result.code : "MALFORMED_REJECTION";
  const status = Number.isInteger(result.status) && result.status >= 400 && result.status <= 599
    ? result.status : null;
  const disposition = result.disposition === "REVIEW_INPUT" ||
    result.disposition === "RECONCILE_OPERATION" || result.disposition === "RESTORE_AUTH"
    ? result.disposition : "UNCLASSIFIED";
  const requestId = typeof result.request_id === "string" && requestIdPattern.test(result.request_id)
    ? result.request_id : null;
  const requestEffect = result.request_effect === "NO_EXPORT_CLAIM" ? result.request_effect : null;
  const safe = firstDispatch && identityMatches && status === 422 &&
    code === "DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED" &&
    disposition === "REVIEW_INPUT" && requestEffect === "NO_EXPORT_CLAIM" && !!requestId;
  return {
    kind: "DEFINITE_REJECTION",
    code: identityMatches ? code : "REJECTION_IDENTITY_MISMATCH",
    status,
    requestId,
    disposition,
    requestEffect,
    outcome: safe ? "SAFE_FIRST_REJECTION" : "KEEP_UNKNOWN",
    observedAt: new Date().toISOString(),
  };
}

function isOperation(value: unknown, projectId: string): value is DevelopmentExportOperation {
  if (!isIdentity(value) || value.projectId !== projectId) return false;
  const expected = ["projectId", "timelineVersionId", "contentHash", "revision",
    "operationId", "status", "exportId", "receipt"];
  const keys = Object.keys(value);
  if (!expected.every((field) => Object.hasOwn(value, field)) ||
    !((keys.length === expected.length && !Object.hasOwn(value, "rejection")) ||
      (keys.length === expected.length + 1 && Object.hasOwn(value, "rejection")))) return false;
  const operation = value as Partial<DevelopmentExportOperation>;
  return typeof operation.operationId === "string" && uuid.test(operation.operationId) &&
    ["UNKNOWN", "SUCCEEDED", "REJECTED", "CLOSED_REJECTED"].includes(String(operation.status)) &&
    operation.receipt === null &&
    (operation.rejection === undefined || operation.rejection === null ||
      isRejection(operation.rejection)) &&
    (operation.status === "SUCCEEDED"
      ? typeof operation.exportId === "string" && operation.exportId.length > 0 &&
        (operation.rejection === undefined || operation.rejection === null ||
          (isRejection(operation.rejection) && operation.rejection.outcome === "KEEP_UNKNOWN"))
      : operation.exportId === null &&
        ((operation.status === "UNKNOWN" &&
          (!isRejection(operation.rejection) ||
            operation.rejection.outcome === "KEEP_UNKNOWN")) ||
          ((operation.status === "REJECTED" || operation.status === "CLOSED_REJECTED") &&
            isRejection(operation.rejection) &&
            operation.rejection.outcome === "SAFE_FIRST_REJECTION")));
}

export function isMatchingReceipt(
  value: unknown,
  identity: DevelopmentTimelineIdentity & { operationId: string },
): value is DevelopmentExportResponse {
  if (!value || typeof value !== "object" || !("data" in value)) return false;
  const receipt = value as DevelopmentExportResponse;
  const data = receipt.data;
  return !!data && typeof data === "object" &&
    data.project_id === identity.projectId &&
    data.operation_id === identity.operationId &&
    data.timeline_version_id === identity.timelineVersionId &&
    data.timeline_content_hash === identity.contentHash &&
    data.timeline_revision === identity.revision &&
    data.purpose === "DEVELOPMENT_EVIDENCE" &&
    ((data.status === "UNKNOWN" && "error_code" in data &&
      data.error_code === "REMOTE_UNKNOWN") ||
      (data.status === "SUCCEEDED" && "output" in data && !!data.output &&
        data.output.width === 1080 && data.output.height === 1920 &&
        data.output.frame_rate_num === 25 && data.output.frame_rate_den === 1));
}

export function readDevelopmentExportOperation(
  storage: JournalStorage,
  projectId: string,
): DevelopmentExportOperation | null {
  try {
    const raw = storage.getItem(key(projectId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isOperation(parsed, projectId) ? parsed : null;
  } catch {
    return null;
  }
}

export function readDevelopmentExportJournalState(storage: JournalStorage, projectId: string):
  | { kind: "EMPTY" }
  | { kind: "VALID"; operation: DevelopmentExportOperation }
  | { kind: "BLOCKED" } {
  try {
    const raw = storage.getItem(key(projectId));
    if (raw === null) return { kind: "EMPTY" };
    const parsed: unknown = JSON.parse(raw);
    return isOperation(parsed, projectId)
      ? { kind: "VALID", operation: parsed }
      : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}

function persist(storage: JournalStorage, operation: DevelopmentExportOperation): boolean {
  try {
    // Keep only bounded identity and receipt ID on disk; GET restores current output metadata.
    storage.setItem(key(operation.projectId), JSON.stringify({
      projectId: operation.projectId,
      timelineVersionId: operation.timelineVersionId,
      contentHash: operation.contentHash,
      revision: operation.revision,
      operationId: operation.operationId,
      status: operation.status,
      exportId: operation.exportId,
      receipt: null,
      rejection: operation.rejection ?? null,
    }));
    const saved = readDevelopmentExportJournalState(storage, operation.projectId);
    return saved.kind === "VALID" &&
      saved.operation.operationId === operation.operationId &&
      saved.operation.timelineVersionId === operation.timelineVersionId &&
      saved.operation.contentHash === operation.contentHash &&
      saved.operation.revision === operation.revision &&
      saved.operation.status === operation.status &&
      saved.operation.exportId === operation.exportId &&
      JSON.stringify(saved.operation.rejection ?? null) === JSON.stringify(operation.rejection ?? null);
  } catch {
    return false;
  }
}

export function clearSucceededDevelopmentExportOperation(
  storage: JournalStorage,
  operation: DevelopmentExportOperation,
): boolean {
  if (operation.status !== "SUCCEEDED") return false;
  try {
    const current = readDevelopmentExportOperation(storage, operation.projectId);
    if (current?.operationId !== operation.operationId) return false;
    storage.removeItem(key(operation.projectId));
    return storage.getItem(key(operation.projectId)) === null;
  } catch {
    return false;
  }
}

function matchingAudit(storage: JournalStorage, operation: DevelopmentExportOperation): boolean {
  try {
    const raw = storage.getItem(auditKey(operation));
    if (!raw || raw.length > MAX_AUDIT_CHARACTERS || !isRejection(operation.rejection) ||
      operation.rejection.outcome !== "SAFE_FIRST_REJECTION") return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const audit = parsed as Record<string, unknown>;
    const fields = ["schemaVersion", "projectId", "operationId", "timelineVersionId",
      "contentHash", "revision", "rejection", "closedAt"];
    return Object.keys(audit).length === fields.length &&
      fields.every((field) => Object.hasOwn(audit, field)) &&
      audit.schemaVersion === 1 && audit.projectId === operation.projectId &&
      audit.operationId === operation.operationId &&
      audit.timelineVersionId === operation.timelineVersionId &&
      audit.contentHash === operation.contentHash && audit.revision === operation.revision &&
      isRejection(audit.rejection) &&
      JSON.stringify(audit.rejection) === JSON.stringify(operation.rejection) &&
      typeof audit.closedAt === "string" && isoTimePattern.test(audit.closedAt) &&
      !Number.isNaN(Date.parse(audit.closedAt));
  } catch {
    return false;
  }
}

function auditCount(storage: JournalStorage, projectId: string): number | null {
  try {
    const length = storage.length;
    const keyAt = storage.key;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 ||
      typeof keyAt !== "function") return null;
    let count = 0;
    for (let index = 0; index < length; index += 1) {
      if (keyAt.call(storage, index)?.startsWith(auditPrefix(projectId))) count += 1;
      if (count >= MAX_AUDITS_PER_PROJECT) return count;
    }
    return count;
  } catch {
    return null;
  }
}

/** Close a proven first-request rejection without deleting its original evidence. */
export function closeRejectedDevelopmentExportOperation(
  storage: JournalStorage,
  operation: DevelopmentExportOperation,
): DevelopmentExportOperation | null {
  if (operation.status !== "REJECTED" || !isRejection(operation.rejection) ||
    operation.rejection.outcome !== "SAFE_FIRST_REJECTION") return null;
  try {
    const state = readDevelopmentExportJournalState(storage, operation.projectId);
    if (state.kind !== "VALID" || state.operation.status !== "REJECTED" ||
      !sameOperation(state.operation, operation) ||
      JSON.stringify(state.operation.rejection) !== JSON.stringify(operation.rejection)) return null;
    const existingAudit = storage.getItem(auditKey(operation));
    if (existingAudit !== null && !matchingAudit(storage, operation)) return null;
    if (existingAudit === null) {
      const count = auditCount(storage, operation.projectId);
      if (count === null || count >= MAX_AUDITS_PER_PROJECT) return null;
      const audit = JSON.stringify({
        schemaVersion: 1,
        projectId: operation.projectId,
        operationId: operation.operationId,
        timelineVersionId: operation.timelineVersionId,
        contentHash: operation.contentHash,
        revision: operation.revision,
        rejection: operation.rejection,
        closedAt: new Date().toISOString(),
      });
      if (audit.length > MAX_AUDIT_CHARACTERS) return null;
      storage.setItem(auditKey(operation), audit);
      if (storage.getItem(auditKey(operation)) !== audit ||
        !matchingAudit(storage, operation)) return null;
    }
    const latest = readDevelopmentExportJournalState(storage, operation.projectId);
    if (latest.kind !== "VALID" || latest.operation.status !== "REJECTED" ||
      !sameOperation(latest.operation, operation) ||
      JSON.stringify(latest.operation.rejection) !== JSON.stringify(operation.rejection)) return null;
    const closed: DevelopmentExportOperation = { ...latest.operation, status: "CLOSED_REJECTED" };
    if (!persist(storage, closed)) return null;
    const verified = readDevelopmentExportJournalState(storage, operation.projectId);
    return verified.kind === "VALID" && verified.operation.status === "CLOSED_REJECTED" &&
      sameOperation(verified.operation, closed) && matchingAudit(storage, verified.operation)
      ? verified.operation : null;
  } catch {
    return null;
  }
}

export async function createDevelopmentExportOperation(
  transport: ExportTransport,
  storage: JournalStorage,
  identity: DevelopmentTimelineIdentity,
): Promise<ExportOutcome> {
  if (!isIdentity(identity) || !transport.createDevelopmentExport ||
    typeof crypto === "undefined" || typeof crypto.randomUUID !== "function")
    return { kind: "UNAVAILABLE", message: "当前桌面版本没有可用的开发导出接口或时间线版本。" };
  const journal = readDevelopmentExportJournalState(storage, identity.projectId);
  if (journal.kind === "BLOCKED")
    return { kind: "UNAVAILABLE", message: "已有导出记录无法读取，已阻止重复提交。" };
  if (journal.kind === "VALID") {
    if (journal.operation.status !== "CLOSED_REJECTED")
      return { kind: "TRACKED", operation: journal.operation };
    if (!matchingAudit(storage, journal.operation))
      return { kind: "UNAVAILABLE", message: "已结案记录缺少匹配审计，已阻止新提交。" };
  }
  const operation: DevelopmentExportOperation = {
    ...identity,
    operationId: crypto.randomUUID(),
    status: "UNKNOWN",
    exportId: null,
    receipt: null,
    rejection: null,
  };
  // Write the operation identity before POST. If the outcome is ambiguous, GET is the only recovery path.
  if (!persist(storage, operation))
    return { kind: "UNAVAILABLE", message: "无法保存导出操作身份，已阻止提交。" };
  try {
    const response = await transport.createDevelopmentExport(identity.projectId, {
      operation_id: operation.operationId,
      timeline_version_id: identity.timelineVersionId,
      expected_revision: identity.revision,
      purpose: "DEVELOPMENT_EVIDENCE",
    });
    const current = readDevelopmentExportJournalState(storage, operation.projectId);
    if (current.kind !== "VALID" || current.operation.status !== "UNKNOWN" ||
      !sameOperation(current.operation, operation) || current.operation.rejection)
      return { kind: "UNAVAILABLE", message: "导出操作已变化，旧提交结果未写入。" };
    if ("kind" in response && response.kind === "DEFINITE_REJECTION") {
      const rejection = rejectionObservation(response, operation, true);
      const rejected: DevelopmentExportOperation = {
        ...operation,
        status: rejection.outcome === "SAFE_FIRST_REJECTION" ? "REJECTED" : "UNKNOWN",
        rejection,
      };
      if (!persist(storage, rejected)) return { kind: "UNKNOWN", operation };
      return rejected.status === "REJECTED"
        ? { kind: "REJECTED", operation: rejected }
        : { kind: "UNKNOWN", operation: rejected };
    }
    if ("kind" in response || !isMatchingReceipt(response, operation) ||
      response.data.status === "UNKNOWN")
      return { kind: "UNKNOWN", operation };
    const succeeded = { ...operation, status: "SUCCEEDED" as const,
      exportId: response.data.export_id, receipt: response };
    if (!persist(storage, succeeded)) return { kind: "UNKNOWN", operation };
    return { kind: "SUCCEEDED", operation: succeeded };
  } catch {
    return { kind: "UNKNOWN", operation };
  }
}

export async function getDevelopmentExportOperation(
  transport: ExportTransport,
  storage: JournalStorage,
  operation: DevelopmentExportOperation,
): Promise<ExportOutcome> {
  if (operation.status === "REJECTED" || operation.status === "CLOSED_REJECTED")
    return { kind: "UNAVAILABLE", message: "此操作已有明确拒绝结论，不以 GET 改写结案状态。" };
  if (!transport.getDevelopmentExport)
    return { kind: "UNAVAILABLE", message: "当前桌面版本不支持查询开发导出。" };
  const tracked = readDevelopmentExportOperation(storage, operation.projectId);
  if (!tracked || tracked.operationId !== operation.operationId ||
    tracked.status === "REJECTED" || tracked.status === "CLOSED_REJECTED")
    return { kind: "UNAVAILABLE", message: "本地导出操作身份已变化，请重新读取。" };
  try {
    const response = await transport.getDevelopmentExport(
      operation.projectId, operation.operationId, operation.timelineVersionId, operation.revision,
    );
    const current = readDevelopmentExportJournalState(storage, operation.projectId);
    if (current.kind !== "VALID" || !sameOperation(current.operation, operation) ||
      (current.operation.status !== "UNKNOWN" && current.operation.status !== "SUCCEEDED"))
      return { kind: "UNAVAILABLE", message: "导出操作已变化，旧查询结果未写入。" };
    if (!isMatchingReceipt(response, operation) || response.data.status === "UNKNOWN" ||
      (current.operation.exportId !== null && response.data.export_id !== current.operation.exportId))
      return { kind: "UNKNOWN", operation: current.operation };
    const succeeded = { ...current.operation, status: "SUCCEEDED" as const,
      exportId: response.data.export_id, receipt: response };
    if (!persist(storage, succeeded)) return { kind: "UNKNOWN", operation: current.operation };
    return { kind: "SUCCEEDED", operation: succeeded };
  } catch {
    return { kind: "UNKNOWN", operation: tracked };
  }
}

export async function accessDevelopmentExport(
  transport: ExportTransport,
  operation: DevelopmentExportOperation,
  action: "open" | "save",
): Promise<"OPENED" | "SAVED" | "CANCELLED" | "UNKNOWN" | "UNAVAILABLE"> {
  if (operation.status !== "SUCCEEDED" || operation.receipt?.data.status !== "SUCCEEDED" ||
    !isMatchingReceipt(operation.receipt, operation)) return "UNAVAILABLE";
  const method = action === "open"
    ? transport.openDevelopmentExport
    : transport.saveDevelopmentExport;
  if (!method) return "UNAVAILABLE";
  try {
    const result = await method(
      operation.projectId, operation.operationId, operation.timelineVersionId, operation.revision,
    );
    if ((result.kind === "OPENED" || result.kind === "SAVED") &&
      result.export_id === operation.receipt.data.export_id) return result.kind;
    if (result.kind === "CANCELLED") return "CANCELLED";
    return result.kind === "REMOTE_UNKNOWN" ? "UNKNOWN" : "UNAVAILABLE";
  } catch {
    return "UNKNOWN";
  }
}
