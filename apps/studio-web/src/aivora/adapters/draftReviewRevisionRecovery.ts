import {
  revisionText,
  type DraftReviewRevisionSource,
  type PendingRevision,
} from "./draftReviewRevision";

export function revisionRecoveryKey(job: DraftReviewRevisionSource): string {
  return `aivora:draft-review-revision:pending:${job.project_id}:${job.episode_id}:${job.operation_id}:${job.assembly_version_id}:${job.assembly_content_hash}:${job.output_sha256}:${job.output_bytes}`;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const id = (value: unknown, prefix: string) =>
  typeof value === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(value);
const hash = (value: unknown) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const identityKeys = [
  "assembly_version_id",
  "assembly_content_hash",
  "output_sha256",
  "output_bytes",
];
function identity(value: Record<string, unknown>) {
  return (
    id(value.assembly_version_id, "ver") &&
    hash(value.assembly_content_hash) &&
    typeof value.output_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.output_sha256) &&
    typeof value.output_bytes === "number" &&
    Number.isSafeInteger(value.output_bytes) &&
    value.output_bytes > 0
  );
}
function ids(value: unknown, pattern: RegExp, maximum: number) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    new Set(value).size === value.length &&
    value.every((item) => typeof item === "string" && pattern.test(item))
  );
}
export function parsePendingRevision(value: unknown): PendingRevision | undefined {
  if (!record(value) || !record(value.command)) return undefined;
  const command = value.command;
  if (
    value.kind === "create" &&
    exact(value, ["kind", "command"]) &&
    exact(command, [
      ...identityKeys,
      "plan_id",
      "note_ids",
      "affected_segment_ids",
      "instruction",
    ]) &&
    identity(command) &&
    id(command.plan_id, "drp") &&
    ids(command.note_ids, /^drn_[0-9a-f]{32}$/, 50) &&
    ids(command.affected_segment_ids, /^seg_[a-z0-9._-]{1,80}$/, 100) &&
    revisionText(command.instruction)
  )
    return value as PendingRevision;
  if (!id(value.planId, "drp")) return undefined;
  if (
    value.kind === "approve" &&
    exact(value, ["kind", "planId", "command"]) &&
    exact(command, ["approval_id", "expected_plan_hash"]) &&
    id(command.approval_id, "dra") &&
    hash(command.expected_plan_hash)
  )
    return value as PendingRevision;
  if (
    value.kind === "attach" &&
    exact(value, ["kind", "planId", "command"]) &&
    exact(command, [
      ...identityKeys,
      "candidate_id",
      "expected_plan_hash",
      "approval_id",
      "candidate_operation_id",
      "change_summary",
    ]) &&
    identity(command) &&
    id(command.candidate_id, "drc") &&
    hash(command.expected_plan_hash) &&
    id(command.approval_id, "dra") &&
    id(command.candidate_operation_id, "dmp") &&
    revisionText(command.change_summary)
  )
    return value as PendingRevision;
  if (
    value.kind === "recheck" &&
    exact(value, ["kind", "planId", "candidateId", "command"]) &&
    id(value.candidateId, "drc") &&
    exact(command, ["recheck_id", "expected_candidate_hash", "outcome", "reason"]) &&
    id(command.recheck_id, "drk") &&
    hash(command.expected_candidate_hash) &&
    (command.outcome === "NEEDS_MORE_WORK" || command.outcome === "MANUALLY_CHECKED") &&
    revisionText(command.reason)
  )
    return value as PendingRevision;
  return undefined;
}
/** Missing is null; malformed/unavailable is undefined and must block all mutations. */
export function readPendingRevision(key: string): PendingRevision | null | undefined {
  try {
    const text = localStorage.getItem(key);
    if (text === null) return null;
    if (text.length > 30000) return undefined;
    return parsePendingRevision(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export type SetAsideRevision = {
  source: {
    project_id: string;
    episode_id: string;
    operation_id: string;
    assembly_version_id: string;
    assembly_content_hash: string;
    output_sha256: string;
    output_bytes: number;
  };
  pending: PendingRevision;
  set_aside_at: string;
};
export function setAsideRevisionKey(job: DraftReviewRevisionSource): string {
  return revisionRecoveryKey(job).replace(":pending:", ":set-aside:");
}
function archiveSource(job: DraftReviewRevisionSource): SetAsideRevision["source"] | null {
  const source = {
    project_id: job.project_id,
    episode_id: job.episode_id,
    operation_id: job.operation_id,
    assembly_version_id: job.assembly_version_id,
    assembly_content_hash: job.assembly_content_hash,
    output_sha256: job.output_sha256,
    output_bytes: job.output_bytes,
  };
  if (
    !id(source.project_id, "prj") ||
    !id(source.episode_id, "ep") ||
    !id(source.operation_id, "dmp") ||
    !identity(source)
  )
    return null;
  return source as SetAsideRevision["source"];
}
function asideCommandKey(job: DraftReviewRevisionSource, pending: PendingRevision): string {
  const eventId =
    pending.kind === "create"
      ? pending.command.plan_id
      : pending.kind === "approve"
        ? pending.command.approval_id
        : pending.kind === "attach"
          ? pending.command.candidate_id
          : pending.command.recheck_id;
  return `${setAsideRevisionKey(job)}:${eventId}`;
}
function parseAsideEntry(
  value: unknown,
  source: SetAsideRevision["source"],
): SetAsideRevision | undefined {
  if (!record(value) || !exact(value, ["source", "pending", "set_aside_at"])) return undefined;
  const savedSource = value.source;
  if (
    !record(savedSource) ||
    !exact(savedSource, Object.keys(source)) ||
    Object.entries(source).some(([key, value]) => savedSource[key] !== value) ||
    !parsePendingRevision(value.pending) ||
    typeof value.set_aside_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.set_aside_at) ||
    !Number.isFinite(Date.parse(value.set_aside_at))
  )
    return undefined;
  return value as SetAsideRevision;
}
/** One immutable key per command prevents an array read/write from losing another window's evidence. */
export function readSetAsideRevisions(
  job: DraftReviewRevisionSource,
): SetAsideRevision[] | undefined {
  try {
    const source = archiveSource(job);
    if (!source) return undefined;
    const prefix = setAsideRevisionKey(job);
    // A malformed legacy/base marker is never silently overwritten.
    if (localStorage.getItem(prefix) !== null) return undefined;
    const entries: SetAsideRevision[] = [];
    const storageCount = localStorage.length;
    if (!Number.isSafeInteger(storageCount) || storageCount < 0) return undefined;
    for (let index = 0; index < storageCount; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`${prefix}:`)) continue;
      if (entries.length >= 50) return undefined;
      const text = localStorage.getItem(key);
      if (!text || text.length > 35000) return undefined;
      const entry = parseAsideEntry(JSON.parse(text), source);
      if (!entry || key !== asideCommandKey(job, entry.pending)) return undefined;
      entries.push(entry);
    }
    return entries.sort((a, b) => a.set_aside_at.localeCompare(b.set_aside_at));
  } catch {
    return undefined;
  }
}
/** Archive write + exact readback must succeed before clearing the active command. */
export function setAsidePendingRevision(
  job: DraftReviewRevisionSource,
  pending: PendingRevision,
): boolean {
  const source = archiveSource(job);
  if (!source || !parsePendingRevision(pending)) return false;
  const activeKey = revisionRecoveryKey(job);
  const stored = readPendingRevision(activeKey);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(pending)) return false;
  const entries = readSetAsideRevisions(job);
  if (!entries) return false;
  try {
    const archiveKey = asideCommandKey(job, pending);
    const previous = localStorage.getItem(archiveKey);
    let exactText: string;
    if (previous !== null) {
      const known = parseAsideEntry(JSON.parse(previous), source);
      if (!known || JSON.stringify(known.pending) !== JSON.stringify(pending)) return false;
      exactText = previous;
    } else {
      if (entries.length >= 50) return false;
      exactText = JSON.stringify({ source, pending, set_aside_at: new Date().toISOString() });
      localStorage.setItem(archiveKey, exactText);
    }
    if (localStorage.getItem(archiveKey) !== exactText || !readSetAsideRevisions(job)) return false;
    const current = readPendingRevision(activeKey);
    if (!current || JSON.stringify(current) !== JSON.stringify(pending)) return false;
    localStorage.removeItem(activeKey);
    return localStorage.getItem(activeKey) === null;
  } catch {
    return false;
  }
}
