import type {
  OfficialTextBase,
  OfficialTextGenerate,
  OfficialTextAdopt,
  OfficialTextOperation,
} from "@aijian/contracts/official-text";
export const OFFICIAL_TEXT_CHANNELS = {
  list: "official-text:list",
  get: "official-text:get",
  generate: "official-text:generate",
  adopt: "official-text:adopt",
} as const;
export const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const exact = (value: unknown, fields: string[]): value is Record<string, unknown> =>
  record(value) &&
  fields.length === Object.keys(value).length &&
  fields.every((field) => Object.hasOwn(value, field));
const id = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
export const projectId = (value: unknown): value is string => id(value, /^prj_[0-9a-f]{32}$/);
export const episodeId = (value: unknown): value is string =>
  id(value, /^ep_(?:prj_)?[0-9a-f]{32}$/);
export const operationId = (value: unknown): value is string =>
  id(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const versionId = (value: unknown): value is string => id(value, /^ver_[0-9a-f]{32}$/);
export const contentHash = (value: unknown): value is string => id(value, /^sha256:[0-9a-f]{64}$/);
export const prose = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  value.length <= max &&
  !value.includes(String.fromCharCode(0));
const timestamp = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
export function validBase(value: unknown): value is OfficialTextBase | null {
  return (
    value === null ||
    (exact(value, ["version_id", "content_hash", "head_revision"]) &&
      versionId(value.version_id) &&
      contentHash(value.content_hash) &&
      typeof value.head_revision === "number" &&
      Number.isSafeInteger(value.head_revision) &&
      value.head_revision > 0)
  );
}
export function validGenerate(value: unknown): value is OfficialTextGenerate {
  return (
    record(value) &&
    Object.keys(value).every((key) =>
      [
        "projectId",
        "episodeId",
        "base",
        "operationId",
        "expectedProfileId",
        "model",
        "text",
        "instructions",
      ].includes(key),
    ) &&
    projectId(value.projectId) &&
    episodeId(value.episodeId) &&
    validBase(value.base) &&
    operationId(value.operationId) &&
    (!Object.hasOwn(value, "expectedProfileId") || operationId(value.expectedProfileId)) &&
    prose(value.model, 200) &&
    prose(value.text, 100_000) &&
    (value.instructions === undefined || prose(value.instructions, 20_000))
  );
}
export function validAdopt(value: unknown): value is OfficialTextAdopt {
  return (
    exact(value, ["proposal_version_id", "proposal_content_hash", "confirm"]) &&
    versionId(value.proposal_version_id) &&
    contentHash(value.proposal_content_hash) &&
    value.confirm === true
  );
}
export function validOperation(
  value: unknown,
  project: string,
  episode: string,
  operation?: string,
): value is OfficialTextOperation {
  if (
    !exact(value, [
      "project_id",
      "episode_id",
      "request",
      "status",
      "error_code",
      "created_at",
      "proposal",
      "adoption",
    ]) ||
    value.project_id !== project ||
    value.episode_id !== episode ||
    !projectId(project) ||
    !episodeId(episode) ||
    !timestamp(value.created_at) ||
    !exact(value.request, [
      "operation_id",
      "profile_id",
      "model",
      "input_text",
      "instructions",
      "request_hash",
      "base",
    ])
  )
    return false;
  const request = value.request;
  if (
    !operationId(request.operation_id) ||
    (operation !== undefined && request.operation_id !== operation) ||
    !operationId(request.profile_id) ||
    !prose(request.model, 200) ||
    !prose(request.input_text, 100_000) ||
    (request.instructions !== null && !prose(request.instructions, 20_000)) ||
    !contentHash(request.request_hash) ||
    !validBase(request.base)
  )
    return false;
  if (
    !["REMOTE_UNKNOWN", "NOT_SENT", "COMPLETED"].includes(String(value.status)) ||
    (value.status === "NOT_SENT"
      ? !id(value.error_code, /^[A-Z][A-Z0-9_]{0,79}$/)
      : value.error_code !== null)
  )
    return false;
  if (value.proposal !== null) {
    if (
      value.status !== "COMPLETED" ||
      !exact(value.proposal, ["version_id", "content_hash", "result"]) ||
      !versionId(value.proposal.version_id) ||
      !contentHash(value.proposal.content_hash) ||
      !exact(value.proposal.result, [
        "operation_id",
        "profile_id",
        "model",
        "request_hash",
        "text",
        "completed_at",
      ])
    )
      return false;
    const result = value.proposal.result;
    if (
      result.operation_id !== request.operation_id ||
      result.profile_id !== request.profile_id ||
      result.model !== request.model ||
      result.request_hash !== request.request_hash ||
      !prose(result.text, 100_000) ||
      !timestamp(result.completed_at)
    )
      return false;
  } else if (value.status === "COMPLETED") return false;
  return (
    value.adoption === null ||
    (value.proposal !== null &&
      exact(value.adoption, [
        "script_version_id",
        "script_content_hash",
        "actor_id",
        "adopted_at",
      ]) &&
      versionId(value.adoption.script_version_id) &&
      contentHash(value.adoption.script_content_hash) &&
      prose(value.adoption.actor_id, 240) &&
      timestamp(value.adoption.adopted_at))
  );
}
