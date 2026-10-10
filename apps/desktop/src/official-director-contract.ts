import { createHash } from "node:crypto";
import type {
  OfficialDirectorAdopt,
  OfficialDirectorGenerate,
  OfficialDirectorOperation,
  OfficialDirectorPrepared,
  OfficialDirectorReject,
} from "@aijian/contracts/official-director";
import {
  contentHash,
  episodeId,
  exact,
  operationId,
  projectId,
  record,
  versionId,
} from "./official-text-contract";
import {
  isShotPlanAdoption,
  isShotPlanAuthority,
  isShotPlanContent,
  isShotPlanIssues,
  isShotPlanStoryboardBase,
} from "./shot-plan-contract";
import { textRequestHash } from "./chatgpt-auth-generation";

export const OFFICIAL_DIRECTOR_CHANNELS = Object.freeze({
  list: "official-director:list",
  get: "official-director:get",
  generate: "official-director:generate",
  adopt: "official-director:adopt",
  reject: "official-director:reject",
} as const);
export { projectId, episodeId, operationId, exact, record };
export const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  [...value].length <= max &&
  !value.includes("\0") &&
  Buffer.from(value, "utf8").toString("utf8") === value;
const rawText = (value: unknown): value is string =>
  typeof value === "string" &&
  Buffer.byteLength(value, "utf8") <= 4 * 1024 * 1024 &&
  Buffer.byteLength(JSON.stringify(value), "utf8") <= 4 * 1024 * 1024 &&
  Buffer.from(value, "utf8").toString("utf8") === value;
function parsed(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
const timestamp = (value: unknown): boolean =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const code = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value);
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  return record(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, sorted(value[key])]),
      )
    : value;
}
export const canonical = (value: unknown): string => JSON.stringify(sorted(value));
export const hash = (value: unknown): string =>
  `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
export function validOptions(value: unknown): boolean {
  return (
    exact(value, ["target_shot_count", "pacing"]) &&
    (value.target_shot_count === null ||
      (typeof value.target_shot_count === "number" &&
        Number.isSafeInteger(value.target_shot_count) &&
        value.target_shot_count >= 1 &&
        value.target_shot_count <= 1000)) &&
    ["BALANCED", "FAST", "SLOW"].includes(String(value.pacing))
  );
}
export function validGenerate(value: unknown): value is OfficialDirectorGenerate {
  return (
    exact(value, [
      "projectId",
      "episodeId",
      "operationId",
      "model",
      "authority",
      "storyboardBase",
      "intent",
      "options",
    ]) &&
    projectId(value.projectId) &&
    episodeId(value.episodeId) &&
    operationId(value.operationId) &&
    text(value.model, 200) &&
    isShotPlanAuthority(value.authority) &&
    isShotPlanStoryboardBase(value.storyboardBase) &&
    text(value.intent, 4000) &&
    validOptions(value.options)
  );
}
export function validAdopt(value: unknown): value is OfficialDirectorAdopt {
  return (
    exact(value, ["proposal_version_id", "proposal_content_hash", "confirm"]) &&
    versionId(value.proposal_version_id) &&
    contentHash(value.proposal_content_hash) &&
    value.confirm === true
  );
}
export function validReject(value: unknown): value is OfficialDirectorReject {
  return (
    exact(value, ["proposal_version_id", "proposal_content_hash", "reason", "confirm"]) &&
    versionId(value.proposal_version_id) &&
    contentHash(value.proposal_content_hash) &&
    text(value.reason, 2000) &&
    value.confirm === true
  );
}
export function validPrepared(value: unknown): value is OfficialDirectorPrepared {
  if (
    !exact(value, [
      "operation_id",
      "profile_id",
      "model",
      "authority",
      "storyboard_base",
      "intent",
      "options",
      "input_text",
      "instructions",
      "request_hash",
      "script_stored_content",
      "production_brief_stored_content",
    ]) ||
    !operationId(value.operation_id) ||
    !operationId(value.profile_id) ||
    !text(value.model, 200) ||
    !isShotPlanAuthority(value.authority) ||
    !isShotPlanStoryboardBase(value.storyboard_base) ||
    !text(value.intent, 4000) ||
    !validOptions(value.options) ||
    !text(value.input_text, 100_000) ||
    !text(value.instructions, 20_000) ||
    !contentHash(value.request_hash) ||
    !record(value.script_stored_content) ||
    !record(value.production_brief_stored_content)
  )
    return false;
  const evidence = parsed(value.input_text);
  if (
    !exact(evidence, [
      "prompt_version",
      "project_id",
      "episode_id",
      "authority",
      "storyboard_base",
      "intent",
      "options",
      "confirmed_script",
      "production_brief",
    ]) ||
    evidence.prompt_version !== "official.director.plan.v1" ||
    evidence.project_id !== value.script_stored_content.project_id ||
    evidence.episode_id !== value.script_stored_content.episode_id ||
    canonical(evidence.authority) !== canonical(value.authority) ||
    canonical(evidence.storyboard_base) !== canonical(value.storyboard_base) ||
    evidence.intent !== value.intent ||
    canonical(evidence.options) !== canonical(value.options) ||
    canonical(evidence.confirmed_script) !== canonical(value.script_stored_content) ||
    canonical(evidence.production_brief) !== canonical(value.production_brief_stored_content)
  )
    return false;
  return (
    value.authority.script.content_hash === hash(value.script_stored_content) &&
    value.authority.production_brief.content_hash === hash(value.production_brief_stored_content) &&
    value.request_hash ===
      textRequestHash({
        operationId: value.operation_id,
        model: value.model,
        text: value.input_text,
        instructions: value.instructions,
      })
  );
}
export function sameIntent(
  request: OfficialDirectorPrepared,
  command: OfficialDirectorGenerate,
): boolean {
  return (
    request.operation_id === command.operationId &&
    request.model === command.model &&
    request.intent === command.intent &&
    canonical(request.options) === canonical(command.options) &&
    canonical(request.authority) === canonical(command.authority) &&
    canonical(request.storyboard_base) === canonical(command.storyboardBase)
  );
}
function completion(value: unknown, request: OfficialDirectorPrepared): boolean {
  return (
    exact(value, [
      "operation_id",
      "profile_id",
      "model",
      "request_hash",
      "response_id",
      "text",
      "completed_at",
    ]) &&
    value.operation_id === request.operation_id &&
    value.profile_id === request.profile_id &&
    value.model === request.model &&
    value.request_hash === request.request_hash &&
    text(value.response_id, 240) &&
    rawText(value.text) &&
    timestamp(value.completed_at)
  );
}
/** Validate closed DTOs plus immutable provenance; malformed backend output always remains unknown. */
export function validOperation(
  value: unknown,
  project: string,
  episode: string,
  operation?: string,
): value is OfficialDirectorOperation {
  if (
    !exact(value, [
      "project_id",
      "episode_id",
      "request",
      "status",
      "error_code",
      "created_at",
      "task_id",
      "attempt_id",
      "attempt_status",
      "proposal",
      "completion",
      "adoption",
      "rejection",
      "validation_issues",
    ]) ||
    value.project_id !== project ||
    value.episode_id !== episode ||
    !projectId(project) ||
    !episodeId(episode) ||
    !validPrepared(value.request) ||
    (operation !== undefined && value.request.operation_id !== operation) ||
    value.request.script_stored_content.project_id !== project ||
    value.request.script_stored_content.episode_id !== episode ||
    !timestamp(value.created_at) ||
    !/^task_[0-9a-f]{32}$/.test(String(value.task_id)) ||
    !/^att_[0-9a-f]{32}$/.test(String(value.attempt_id)) ||
    !["REMOTE_UNKNOWN", "COMPLETED", "NOT_SENT", "INVALID"].includes(String(value.status)) ||
    !Array.isArray(value.validation_issues) ||
    value.validation_issues.length > 100 ||
    !value.validation_issues.every(
      (issue) => exact(issue, ["code", "message"]) && code(issue.code) && text(issue.message, 1000),
    )
  )
    return false;
  const request = value.request;
  if (value.status === "REMOTE_UNKNOWN") {
    if (
      value.error_code !== null ||
      value.completion !== null ||
      value.proposal !== null ||
      value.attempt_status !== "REMOTE_UNKNOWN" ||
      value.validation_issues.length !== 0
    )
      return false;
  } else if (value.status === "NOT_SENT") {
    if (
      !code(value.error_code) ||
      value.completion !== null ||
      value.proposal !== null ||
      value.attempt_status !== "NOT_SUBMITTED" ||
      value.validation_issues.length !== 0
    )
      return false;
  } else {
    if (!completion(value.completion, request)) return false;
    if (value.status === "INVALID") {
      if (
        !code(value.error_code) ||
        value.proposal !== null ||
        value.attempt_status !== "FAILED" ||
        value.validation_issues.length === 0
      )
        return false;
    } else if (
      value.error_code !== null ||
      value.attempt_status !== "SUCCEEDED" ||
      value.validation_issues.length !== 0
    )
      return false;
  }
  if (value.proposal !== null) {
    const proposal = value.proposal;
    if (
      value.status !== "COMPLETED" ||
      !exact(proposal, ["version_id", "content_hash", "content", "capability_losses"]) ||
      !versionId(proposal.version_id) ||
      !contentHash(proposal.content_hash) ||
      !record(proposal.content) ||
      proposal.content.provenance !== "AI" ||
      !isShotPlanContent({ ...proposal.content, provenance: "HUMAN" }, project, episode) ||
      proposal.content_hash !== hash(proposal.content) ||
      !record(value.completion) ||
      typeof value.completion.text !== "string" ||
      canonical(parsed(value.completion.text)) !== canonical(proposal.content) ||
      canonical(proposal.content.authority) !== canonical(request.authority) ||
      canonical(proposal.content.storyboard_base) !== canonical(request.storyboard_base) ||
      !Array.isArray(proposal.content.shots) ||
      !isShotPlanIssues(
        proposal.capability_losses,
        new Set(proposal.content.shots.map((shot) => (record(shot) ? shot.shot_id : null))),
      )
    )
      return false;
  } else if (value.status === "COMPLETED") return false;
  if (
    value.adoption !== null &&
    (value.proposal === null ||
      value.rejection !== null ||
      !record(value.proposal) ||
      !isShotPlanAdoption(
        value.adoption,
        String(value.proposal.version_id),
        String(value.proposal.content_hash),
      ))
  )
    return false;
  return (
    value.rejection === null ||
    (value.proposal !== null &&
      value.adoption === null &&
      exact(value.rejection, ["actor_id", "rejected_at", "reason"]) &&
      text(value.rejection.actor_id, 240) &&
      timestamp(value.rejection.rejected_at) &&
      text(value.rejection.reason, 2000))
  );
}
