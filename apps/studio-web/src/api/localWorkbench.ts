import type { components } from "@aijian/contracts";
import { validScriptVersion, type ScriptVersion } from "../aivora/adapters/episodeScript";
import type {
  EpisodeResponse,
  EpisodeListResponse,
  EpisodeCreateResult,
  ProductionBriefCreateCommand,
  ProductionBriefResponse,
  ProjectResponse,
  SourceExtractionResponse,
  StudioTransport,
  UpdateProjectCommand,
  UpdateProjectResult,
} from "./studio";

/** Same-origin development transport only. Authentication remains in the local server/proxy. */
type LocalWorkbench = Required<
  Pick<
    StudioTransport,
    | "updateProject"
    | "episodes"
    | "getEpisodeScript"
    | "getEpisodeScriptVersion"
    | "createEpisodeScriptVersion"
    | "getSourceExtraction"
    | "getSourceExtractionVersion"
    | "getSourceProposalAcceptanceForVersion"
    | "getProductionBrief"
    | "getProductionBriefVersion"
    | "createProductionBriefVersion"
  >
>;
type HttpResult = { status: number; payload: Record<string, unknown>; etag: string | null };
const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const ARTIFACT = /^art_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const REQUEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN = { kind: "REMOTE_UNKNOWN" } as const;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const exact = (value: unknown, allowed: readonly string[]): value is Record<string, unknown> =>
  record(value) && keys(value, allowed) && allowed.every((key) => Object.hasOwn(value, key));
const id = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const optionalId = (value: unknown, pattern = VERSION) => value === null || id(value, pattern);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nonnegative = (value: unknown): value is number => value === 0 || positive(value);
const text = (value: unknown, max = 4000): value is string =>
  typeof value === "string" && !!value.trim() && [...value].length <= max;
const timestamp = (value: unknown) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));
const noControls = (value: string) =>
  [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  });
const pathFor = (projectId: string) => {
  if (!id(projectId, PROJECT)) throw new Error("Local workbench requires a canonical project id");
  return `/api/v1/projects/${projectId}`;
};
function episodePath(projectId: string, episodeId: string) {
  if (!id(episodeId, EPISODE)) throw new Error("Local workbench requires a canonical episode id");
  return `${pathFor(projectId)}/episodes/${episodeId}`;
}
function versionPath(path: string, versionId: string) {
  if (!id(versionId, VERSION)) throw new Error("Local workbench requires a canonical version id");
  return `${path}/versions/${versionId}`;
}
function canonicalJson(value: unknown): string {
  const sort = (entry: unknown): unknown =>
    Array.isArray(entry)
      ? entry.map(sort)
      : record(entry)
        ? Object.fromEntries(
            Object.keys(entry)
              .sort()
              .map((key) => [key, sort(entry[key])]),
          )
        : entry;
  return JSON.stringify(sort(value));
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Bounded reads and matched request identities keep truncated/lost replies unsettled. Never retry writes. */
async function request(
  path: string,
  input?: unknown,
  headers?: Record<string, string>,
  method = input === undefined ? "GET" : "POST",
): Promise<HttpResult | null> {
  try {
    const response = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(input === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      cache: "no-store",
    });
    if (
      !response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json") ||
      Number(response.headers.get("Content-Length") ?? 0) > 4_000_000 ||
      !response.body
    )
      return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let body = "";
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 4_000_000) {
          await reader.cancel();
          return null;
        }
        body += decoder.decode(next.value, { stream: true });
      }
      body += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const payload: unknown = JSON.parse(body);
    if (
      !record(payload) ||
      !id(payload.request_id, REQUEST) ||
      payload.request_id !== response.headers.get("X-Request-ID")
    )
      return null;
    return { status: response.status, payload, etag: response.headers.get("ETag") };
  } catch {
    return null;
  }
}
function definite(result: HttpResult | null, allowed: Readonly<Record<number, readonly string[]>>) {
  if (
    !result ||
    !exact(result.payload, ["error", "request_id"]) ||
    typeof result.payload.request_id !== "string"
  )
    return null;
  const error = result.payload.error;
  if (
    !exact(error, ["code", "message", "retryable", "details"]) ||
    typeof error.code !== "string" ||
    !allowed[result.status]?.includes(error.code) ||
    typeof error.message !== "string" ||
    error.retryable !== false ||
    !record(error.details) ||
    !Object.values(error.details).every((detail) => typeof detail === "string")
  )
    return null;
  return {
    kind: "DEFINITE_SERVER_ERROR" as const,
    status: result.status,
    code: error.code,
    request_id: result.payload.request_id,
  };
}
const AUTH_ERRORS = { 401: ["SIDECAR_AUTH_REQUIRED"], 403: ["SIDECAR_REQUEST_REJECTED"] };
const EPISODE_ERRORS = {
  ...AUTH_ERRORS,
  404: ["PROJECT_NOT_FOUND", "EPISODE_NOT_FOUND"],
  409: ["EPISODE_CREATE_CONFLICT"],
  422: ["VALIDATION_ERROR"],
};
const SCRIPT_ERRORS = {
  ...AUTH_ERRORS,
  404: ["PROJECT_NOT_FOUND", "EPISODE_NOT_FOUND", "SCRIPT_NOT_FOUND"],
  409: ["SCRIPT_CONFLICT"],
  413: ["SCRIPT_TOO_LARGE"],
  422: ["VALIDATION_ERROR", "SCRIPT_INPUT_REJECTED"],
  428: ["PRECONDITION_REQUIRED"],
};

function pythonStrip(value: string): string {
  const whitespace = new Set([
    9, 10, 11, 12, 13, 28, 29, 30, 31, 32, 133, 160, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
    0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
  ]);
  const characters = [...value];
  let start = 0;
  let end = characters.length;
  while (start < end && whitespace.has(characters[start]?.codePointAt(0) ?? -1)) start += 1;
  while (end > start && whitespace.has(characters[end - 1]?.codePointAt(0) ?? -1)) end -= 1;
  return characters.slice(start, end).join("");
}
function decimal(value: unknown, minimum = 0): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9][0-9]*)$/.test(value) &&
    value.length <= 19 &&
    BigInt(value) >= BigInt(minimum) &&
    BigInt(value) <= 9223372036854775807n
  );
}
function episodeData(value: unknown, projectId: string, episodeId?: string): boolean {
  return (
    exact(value, [
      "id",
      "project_id",
      "position",
      "title",
      "is_default",
      "target_duration_seconds",
      "revision",
      "created_at",
      "updated_at",
    ]) &&
    id(value.id, EPISODE) &&
    value.project_id === projectId &&
    (episodeId === undefined || value.id === episodeId) &&
    decimal(value.position, 1) &&
    typeof value.title === "string" &&
    typeof value.is_default === "boolean" &&
    (value.target_duration_seconds === null || decimal(value.target_duration_seconds, 1)) &&
    decimal(value.revision, 1) &&
    timestamp(value.created_at) &&
    timestamp(value.updated_at)
  );
}
function episodeReceipt(
  value: unknown,
  projectId: string,
  episodeId?: string,
): value is EpisodeResponse {
  return exact(value, ["data", "request_id"]) && episodeData(value.data, projectId, episodeId);
}
function projectReceipt(
  value: unknown,
  projectId: string,
  command: UpdateProjectCommand,
  etag: string | null,
): value is ProjectResponse {
  if (
    !exact(value, ["data", "request_id"]) ||
    !exact(value.data, [
      "id",
      "name",
      "aspect_ratio",
      "target_duration_seconds",
      "source_language",
      "status",
      "revision",
      "created_at",
      "updated_at",
    ])
  )
    return false;
  const data = value.data;
  return (
    data.id === projectId &&
    typeof data.name === "string" &&
    data.aspect_ratio === "9:16" &&
    positive(data.target_duration_seconds) &&
    data.source_language === "zh-CN" &&
    (data.status === "active" || data.status === "archived") &&
    (data.revision === command.expectedRevision ||
      data.revision === command.expectedRevision + 1) &&
    timestamp(data.created_at) &&
    timestamp(data.updated_at) &&
    (command.name === undefined || command.name === data.name) &&
    (command.status === undefined || command.status === data.status) &&
    etag === `"revision-${data.revision}"`
  );
}

function scriptVersion(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is ScriptVersion {
  return (
    exact(value, [
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
    ]) &&
    validScriptVersion(value, projectId, episodeId) &&
    optionalId(value.parent_version_id) &&
    text(value.author_actor_id, 240) &&
    text(value.change_summary, 240) &&
    timestamp(value.created_at) &&
    ((value.content.source_extraction_version_id ?? null) === null) ===
      ((value.content.source_proposal_acceptance_id ?? null) === null)
  );
}
async function readScript(projectId: string, episodeId: string, versionId?: string) {
  const base = `${episodePath(projectId, episodeId)}/script`;
  const result = await request(versionId === undefined ? base : versionPath(base, versionId));
  if (
    result?.status === 200 &&
    exact(result.payload, ["data", "request_id"]) &&
    typeof result.payload.request_id === "string" &&
    scriptVersion(result.payload.data, projectId, episodeId)
  ) {
    const version = result.payload.data;
    if (
      (versionId === undefined || version.version_id === versionId) &&
      result.etag ===
        (versionId === undefined
          ? `"revision-${version.head_revision}"`
          : `"${version.content_hash}"`)
    )
      return {
        kind: "FOUND" as const,
        receipt: { data: version, request_id: result.payload.request_id },
      };
  }
  return definite(result, SCRIPT_ERRORS) ?? UNKNOWN;
}

function rational(value: unknown): value is { num: number; den: number } {
  if (
    !exact(value, ["num", "den"]) ||
    !positive(value.num) ||
    !positive(value.den) ||
    value.den > 2147483647
  )
    return false;
  let left = value.num;
  let right = value.den;
  while (right) [left, right] = [right, left % right];
  return left === 1;
}
function briefContent(value: unknown): value is components["schemas"]["ProductionBriefContentV1"] {
  if (
    !exact(value, [
      "schema_version",
      "creative_entry",
      "creative",
      "delivery",
      "duration_intent",
      "budget_intent",
      "rights_declaration",
    ]) ||
    value.schema_version !== "1.0.0"
  )
    return false;
  const entry = value.creative_entry;
  if (!record(entry)) return false;
  if (entry.kind === "original_idea") {
    if (
      !exact(entry, ["kind", "origin_statement", "references"]) ||
      !text(entry.origin_statement) ||
      !Array.isArray(entry.references) ||
      entry.references.length > 32 ||
      !entry.references.every(
        (ref) =>
          exact(ref, ["reference_kind", "description"]) &&
          ["inspiration", "research", "other"].includes(String(ref.reference_kind)) &&
          text(ref.description),
      ) ||
      new Set(entry.references.map(canonicalJson)).size !== entry.references.length
    )
      return false;
  } else if (
    entry.kind !== "source_adaptation" ||
    !exact(entry, [
      "kind",
      "adaptation_statement",
      "source_document_id",
      "source_manifest_version_id",
      "source_block_ids",
    ]) ||
    !text(entry.adaptation_statement) ||
    !id(entry.source_document_id, /^src_[0-9a-f]{32}$/) ||
    !id(entry.source_manifest_version_id, VERSION) ||
    !Array.isArray(entry.source_block_ids) ||
    entry.source_block_ids.length < 1 ||
    entry.source_block_ids.length > 100 ||
    !entry.source_block_ids.every((block) => id(block, /^srcb_[0-9a-f]{32}$/)) ||
    new Set(entry.source_block_ids).size !== entry.source_block_ids.length
  )
    return false;
  const creative = value.creative;
  const delivery = value.delivery;
  const duration = value.duration_intent;
  const budget = value.budget_intent;
  const rights = value.rights_declaration;
  return (
    exact(creative, ["premise", "intent", "audience", "genre", "style", "constraints"]) &&
    text(creative.premise) &&
    text(creative.intent) &&
    [creative.audience, creative.genre, creative.style].every(
      (item) => item === null || text(item, 240),
    ) &&
    Array.isArray(creative.constraints) &&
    creative.constraints.length <= 32 &&
    creative.constraints.every((item) => text(item, 240)) &&
    new Set(creative.constraints).size === creative.constraints.length &&
    exact(delivery, ["language", "width_px", "height_px", "display_aspect_ratio", "frame_rate"]) &&
    text(delivery.language) &&
    positive(delivery.width_px) &&
    positive(delivery.height_px) &&
    rational(delivery.display_aspect_ratio) &&
    rational(delivery.frame_rate) &&
    BigInt(delivery.width_px) * BigInt(delivery.display_aspect_ratio.den) ===
      BigInt(delivery.height_px) * BigInt(delivery.display_aspect_ratio.num) &&
    exact(duration, ["work_seconds", "episode_mode", "episode_seconds"]) &&
    (duration.work_seconds === null || positive(duration.work_seconds)) &&
    ((duration.episode_mode === "unspecified" && duration.episode_seconds === null) ||
      (duration.episode_mode === "per_episode" && positive(duration.episode_seconds))) &&
    exact(budget, ["state", "currency", "amount_micros"]) &&
    ((budget.state === "unknown" && budget.currency === null && budget.amount_micros === null) ||
      (budget.state === "declared" &&
        id(budget.currency, /^[A-Z]{3}$/) &&
        nonnegative(budget.amount_micros))) &&
    exact(rights, ["state", "statement"]) &&
    ((rights.state === "unknown" && rights.statement === null) ||
      (rights.state === "user_declared" && text(rights.statement)))
  );
}
function normalizeBrief(
  command: ProductionBriefCreateCommand,
): ProductionBriefCreateCommand | null {
  if (
    !exact(command, ["operation_id", "input"]) ||
    !id(command.operation_id, OPERATION) ||
    !record(command.input) ||
    !keys(command.input, ["content", "parent_version_id", "expected_revision", "change_summary"]) ||
    !record(command.input.content)
  )
    return null;
  const input = command.input;
  const content = input.content;
  if (!record(content.creative_entry) || !record(content.creative)) return null;
  const normalized = {
    ...content,
    schema_version: content.schema_version ?? "1.0.0",
    creative_entry:
      content.creative_entry.kind === "original_idea"
        ? { ...content.creative_entry, references: content.creative_entry.references ?? [] }
        : content.creative_entry,
    creative: {
      ...content.creative,
      audience: content.creative.audience ?? null,
      genre: content.creative.genre ?? null,
      style: content.creative.style ?? null,
      constraints: content.creative.constraints ?? [],
    },
  };
  if (
    !briefContent(normalized) ||
    !optionalId(input.parent_version_id ?? null) ||
    !(input.expected_revision == null || positive(input.expected_revision)) ||
    !text(input.change_summary, 1000)
  )
    return null;
  return {
    operation_id: command.operation_id,
    input: {
      content: normalized,
      parent_version_id: input.parent_version_id ?? null,
      expected_revision: input.expected_revision ?? null,
      change_summary: input.change_summary,
    },
  };
}
function artifactData(value: unknown, projectId: string, versionId?: string): boolean {
  if (
    !record(value) ||
    value.project_id !== projectId ||
    !exact(value.head, [
      "artifact_id",
      "latest_version_id",
      "review_version_id",
      "review_submission_id",
      "accepted_version_id",
      "revision",
      "review_evidence_revision",
      "updated_at",
    ]) ||
    !exact(value.version, [
      "id",
      "artifact_id",
      "version_number",
      "schema_version",
      "content",
      "content_hash",
      "parent_version_id",
      "change_summary",
      "created_at",
    ])
  )
    return false;
  const head = value.head;
  const version = value.version;
  return (
    id(head.artifact_id, ARTIFACT) &&
    id(head.latest_version_id, VERSION) &&
    optionalId(head.review_version_id) &&
    optionalId(head.accepted_version_id) &&
    (head.review_submission_id === null || id(head.review_submission_id, /^sub_[0-9a-f]{32}$/)) &&
    positive(head.revision) &&
    nonnegative(head.review_evidence_revision) &&
    timestamp(head.updated_at) &&
    id(version.id, VERSION) &&
    version.id === (versionId ?? head.latest_version_id) &&
    version.artifact_id === head.artifact_id &&
    positive(version.version_number) &&
    version.schema_version === "1.0.0" &&
    id(version.content_hash, HASH) &&
    optionalId(version.parent_version_id) &&
    typeof version.change_summary === "string" &&
    timestamp(version.created_at)
  );
}
function briefReceipt(
  value: unknown,
  projectId: string,
  versionId?: string,
): value is ProductionBriefResponse {
  return (
    exact(value, ["data", "request_id"]) &&
    exact(value.data, ["project_id", "head", "version"]) &&
    artifactData(value.data, projectId, versionId) &&
    record(value.data.version) &&
    briefContent(value.data.version.content)
  );
}
async function readBrief(
  projectId: string,
  versionId?: string,
): Promise<ProductionBriefResponse | null> {
  const base = `${pathFor(projectId)}/production-brief`;
  const result = await request(versionId === undefined ? base : versionPath(base, versionId));
  if (versionId === undefined && definite(result, { 404: ["ARTIFACT_NOT_FOUND"] })) return null;
  if (
    result?.status === 200 &&
    briefReceipt(result.payload, projectId, versionId) &&
    result.etag ===
      (versionId === undefined
        ? `"revision-${result.payload.data.head.revision}"`
        : `"${result.payload.data.version.content_hash}"`)
  )
    return result.payload;
  throw new Error("Production brief read could not be verified");
}

async function sourceReceipt(
  value: unknown,
  projectId: string,
  versionId?: string,
): Promise<boolean> {
  if (
    !exact(value, ["data", "request_id"]) ||
    !exact(value.data, [
      "project_id",
      "head",
      "version",
      "source_spans",
      "dependencies",
      "provenance",
    ]) ||
    !artifactData(value.data, projectId, versionId)
  )
    return false;
  const data = value.data;
  if (
    !record(data.version) ||
    !exact(data.version.content, ["summary"]) ||
    !text(data.version.content.summary, 10000) ||
    data.version.content_hash !== `sha256:${await sha256(canonicalJson(data.version.content))}` ||
    !Array.isArray(data.source_spans) ||
    data.source_spans.length < 1 ||
    !Array.isArray(data.dependencies) ||
    data.dependencies.length !== 1 ||
    !exact(data.provenance, ["producer_attempt_id", "proposal_id"]) ||
    !id(data.provenance.producer_attempt_id, /^att_[0-9a-f]{32}$/) ||
    !id(data.provenance.proposal_id, /^prp_[0-9a-f]{32}$/)
  )
    return false;
  return (
    data.source_spans.every(
      (span) =>
        exact(span, [
          "id",
          "fact_id",
          "source_document_id",
          "source_block_id",
          "role",
          "start_byte",
          "end_byte",
          "claim",
          "quote_hash",
        ]) &&
        id(span.id, /^spn_[0-9a-f]{32}$/) &&
        id(span.fact_id, /^spn_[0-9a-f]{32}$/) &&
        id(span.source_document_id, /^src_[0-9a-f]{32}$/) &&
        id(span.source_block_id, /^srcb_[0-9a-f]{32}$/) &&
        ["supports", "contradicts", "context"].includes(String(span.role)) &&
        nonnegative(span.start_byte) &&
        positive(span.end_byte) &&
        span.end_byte > span.start_byte &&
        text(span.claim, 1000) &&
        id(span.quote_hash, HASH),
    ) &&
    data.dependencies.every(
      (dep) =>
        exact(dep, ["upstream_version_id", "relationship", "impact"]) &&
        id(dep.upstream_version_id, VERSION) &&
        dep.relationship === "derived_from" &&
        dep.impact === "blocking",
    )
  );
}
async function readSource(
  projectId: string,
  versionId?: string,
): Promise<Awaited<ReturnType<LocalWorkbench["getSourceExtraction"]>>> {
  const base = `${pathFor(projectId)}/source-extraction`;
  const result = await request(versionId === undefined ? base : versionPath(base, versionId));
  try {
    if (result?.status === 200 && (await sourceReceipt(result.payload, projectId, versionId))) {
      // The complete closed SourceExtraction shape was checked above, including its content hash.
      const receipt = result.payload as SourceExtractionResponse;
      if (
        result.etag ===
        (versionId === undefined
          ? `"revision-${receipt.data.head.revision}"`
          : `"${receipt.data.version.content_hash}"`)
      )
        return { kind: "FOUND", receipt };
    }
  } catch {
    return UNKNOWN;
  }
  const error = definite(result, {
    404: ["SOURCE_EXTRACTION_NOT_FOUND"],
    409: ["SOURCE_EXTRACTION_INCONSISTENT"],
  });
  return error?.status === 404
    ? { kind: "NOT_FOUND" }
    : error?.status === 409
      ? { kind: "INCONSISTENT", request_id: error.request_id }
      : UNKNOWN;
}

function scriptInput(value: unknown, projectId: string, episodeId: string): boolean {
  if (
    !exact(value, ["content", "parent_version_id", "expected_revision", "change_summary"]) ||
    !optionalId(value.parent_version_id) ||
    !(value.expected_revision === null || positive(value.expected_revision)) ||
    (value.parent_version_id === null) !== (value.expected_revision === null) ||
    !text(value.change_summary, 240) ||
    !exact(value.content, [
      "schema_version",
      "project_id",
      "episode_id",
      "production_brief_version_id",
      "story_bible_version_id",
      "source_extraction_version_id",
      "source_proposal_acceptance_id",
      "scenes",
    ])
  )
    return false;
  const content = value.content;
  if (
    content.schema_version !== "1.0.0" ||
    content.project_id !== projectId ||
    content.episode_id !== episodeId ||
    ![
      content.production_brief_version_id,
      content.story_bible_version_id,
      content.source_extraction_version_id,
    ].every((entry) => optionalId(entry)) ||
    !optionalId(content.source_proposal_acceptance_id, /^pda_[0-9a-f]{32}$/) ||
    (content.source_extraction_version_id === null) !==
      (content.source_proposal_acceptance_id === null) ||
    !Array.isArray(content.scenes) ||
    content.scenes.length > 1000
  )
    return false;
  const seen = new Set<string>();
  const unique = (value: unknown, pattern: RegExp) => {
    if (!id(value, pattern) || seen.has(value)) return false;
    seen.add(value);
    return true;
  };
  return (
    content.scenes.every(
      (scene, index) =>
        exact(scene, ["scene_id", "ordinal", "heading", "blocks"]) &&
        unique(scene.scene_id, /^scn_[0-9a-f]{32}$/) &&
        scene.ordinal === index + 1 &&
        text(scene.heading, 240) &&
        Array.isArray(scene.blocks) &&
        scene.blocks.length <= 500 &&
        scene.blocks.every(
          (block, ordinal) =>
            exact(block, ["block_id", "ordinal", "kind", "text", "speaker", "delivery"]) &&
            unique(block.block_id, /^sblk_[0-9a-f]{32}$/) &&
            block.ordinal === ordinal + 1 &&
            text(block.text, 20000) &&
            ((block.kind === "ACTION" && block.speaker === null && block.delivery === null) ||
              (block.kind === "DIALOGUE" &&
                text(block.speaker, 120) &&
                (block.delivery === "ON_SCREEN" || block.delivery === "OFF_SCREEN"))),
        ),
    ) && new TextEncoder().encode(JSON.stringify(content)).byteLength <= 2_000_000
  );
}

export function localWorkbenchTransport(): LocalWorkbench {
  return {
    async updateProject(projectId, command) {
      if (
        !id(projectId, PROJECT) ||
        !record(command) ||
        !keys(command, ["expectedRevision", "name", "status"]) ||
        !positive(command.expectedRevision) ||
        command.expectedRevision >= Number.MAX_SAFE_INTEGER ||
        (!Object.hasOwn(command, "name") && !Object.hasOwn(command, "status")) ||
        (Object.hasOwn(command, "name") &&
          (typeof command.name !== "string" ||
            !text(command.name.trim(), 80) ||
            !noControls(command.name.trim()))) ||
        (Object.hasOwn(command, "status") &&
          command.status !== "active" &&
          command.status !== "archived")
      )
        return { kind: "INVALID_INPUT" };
      const normalized = {
        ...command,
        ...(command.name === undefined ? {} : { name: command.name.trim() }),
      };
      const body = {
        ...(normalized.name === undefined ? {} : { name: normalized.name }),
        ...(normalized.status === undefined ? {} : { status: normalized.status }),
      };
      const result = await request(
        pathFor(projectId),
        body,
        { "If-Match": `"revision-${normalized.expectedRevision}"` },
        "PATCH",
      );
      if (
        result?.status === 200 &&
        projectReceipt(result.payload, projectId, normalized, result.etag)
      )
        return { kind: "SUCCEEDED", receipt: result.payload };
      const error = definite(result, {
        ...AUTH_ERRORS,
        404: ["PROJECT_NOT_FOUND"],
        409: ["PROJECT_CONFLICT"],
        412: ["PROJECT_PRECONDITION_FAILED"],
        422: ["VALIDATION_ERROR"],
        428: ["PROJECT_PRECONDITION_REQUIRED"],
      });
      return (
        (error as Extract<UpdateProjectResult, { kind: "DEFINITE_SERVER_ERROR" }> | null) ?? UNKNOWN
      );
    },
    episodes: {
      async list(projectId, query = {}) {
        const base = `${pathFor(projectId)}/episodes`;
        if (
          !record(query) ||
          !keys(query, ["limit", "offset"]) ||
          (query.limit !== undefined && (!positive(query.limit) || query.limit > 100)) ||
          (query.offset !== undefined && !decimal(query.offset))
        )
          throw new Error("Invalid episode list query");
        const search = new URLSearchParams();
        if (query.limit !== undefined) search.set("limit", String(query.limit));
        if (query.offset !== undefined) search.set("offset", query.offset);
        const result = await request(`${base}${search.size ? `?${search}` : ""}`);
        if (
          result?.status !== 200 ||
          !exact(result.payload, ["data", "request_id"]) ||
          !Array.isArray(result.payload.data) ||
          result.payload.data.length > (query.limit ?? 50) ||
          !result.payload.data.every((entry) => episodeData(entry, projectId))
        )
          throw new Error("Episode list could not be verified");
        const receipt = result.payload as EpisodeListResponse;
        if (
          new Set(receipt.data.map((item) => item.id)).size !== receipt.data.length ||
          receipt.data.some(
            (item, index) =>
              index > 0 &&
              BigInt(item.position) <= BigInt(receipt.data[index - 1]?.position ?? "0"),
          )
        )
          throw new Error("Episode list order could not be verified");
        return receipt;
      },
      async get(projectId, episodeId) {
        const result = await request(episodePath(projectId, episodeId));
        if (result?.status === 200 && episodeReceipt(result.payload, projectId, episodeId))
          return result.payload;
        throw new Error("Episode read could not be verified");
      },
      async create(projectId, input) {
        const path = `${pathFor(projectId)}/episodes`;
        if (
          !record(input) ||
          !keys(input, ["title", "target_duration_seconds"]) ||
          typeof input.title !== "string"
        )
          throw new Error("Invalid episode input");
        // Match Python str.strip rather than JavaScript's extra BOM whitespace handling.
        const title = pythonStrip(input.title);
        if (
          !title.length ||
          [...title].length > 80 ||
          !noControls(title) ||
          (Object.hasOwn(input, "target_duration_seconds") &&
            input.target_duration_seconds !== null &&
            !decimal(input.target_duration_seconds, 1))
        )
          throw new Error("Invalid episode input");
        const result = await request(path, { ...input, title });
        if (
          result?.status === 201 &&
          episodeReceipt(result.payload, projectId) &&
          result.payload.data.title === title &&
          result.payload.data.target_duration_seconds === (input.target_duration_seconds ?? null)
        )
          return { kind: "SUCCEEDED", receipt: result.payload };
        return (
          (definite(result, EPISODE_ERRORS) as Extract<
            EpisodeCreateResult,
            { kind: "DEFINITE_SERVER_ERROR" }
          > | null) ?? UNKNOWN
        );
      },
    },
    async getEpisodeScript(projectId, episodeId) {
      const result = await readScript(projectId, episodeId);
      return result.kind === "DEFINITE_SERVER_ERROR" &&
        result.status === 404 &&
        result.code === "SCRIPT_NOT_FOUND"
        ? { kind: "EMPTY" }
        : result;
    },
    getEpisodeScriptVersion: readScript,
    async createEpisodeScriptVersion(projectId, episodeId, operationId, payload) {
      const path = `${episodePath(projectId, episodeId)}/script/versions`;
      if (!id(operationId, /^[\x21-\x7e]{1,240}$/) || !scriptInput(payload, projectId, episodeId))
        throw new Error("Invalid script write identity or payload");
      const result = await request(path, payload, { "Idempotency-Key": operationId });
      if (
        result?.status === 201 &&
        exact(result.payload, ["data", "request_id"]) &&
        typeof result.payload.request_id === "string" &&
        exact(result.payload.data, ["version", "replayed"]) &&
        typeof result.payload.data.replayed === "boolean" &&
        scriptVersion(result.payload.data.version, projectId, episodeId)
      ) {
        const { version, replayed } = result.payload.data;
        if (
          version.parent_version_id === payload.parent_version_id &&
          version.head_revision === (payload.expected_revision ?? 0) + 1 &&
          version.change_summary === payload.change_summary &&
          result.etag === `"revision-${version.head_revision}"` &&
          canonicalJson(version.content) === canonicalJson(payload.content)
        )
          return {
            kind: "CREATED",
            receipt: { data: { version, replayed }, request_id: result.payload.request_id },
          };
      }
      return definite(result, SCRIPT_ERRORS) ?? UNKNOWN;
    },
    getProductionBrief: readBrief,
    async getProductionBriefVersion(projectId, versionId) {
      const receipt = await readBrief(projectId, versionId);
      if (!receipt) throw new Error("Production brief version could not be verified");
      return receipt;
    },
    async createProductionBriefVersion(projectId, command) {
      const path = `${pathFor(projectId)}/production-brief/versions`;
      const normalized = normalizeBrief(command);
      if (!normalized) throw new Error("Invalid production brief command");
      try {
        const key = `production-brief:create:v1:${await sha256(`${projectId}\0${normalized.operation_id}`)}`;
        const result = await request(path, normalized.input, { "Idempotency-Key": key });
        // Replays may return a historical version and a newer current head.
        if (
          result?.status === 201 &&
          record(result.payload.data) &&
          record(result.payload.data.version) &&
          typeof result.payload.data.version.id === "string" &&
          briefReceipt(result.payload, projectId, result.payload.data.version.id)
        ) {
          const version = result.payload.data.version;
          if (
            version.parent_version_id === normalized.input.parent_version_id &&
            version.change_summary === normalized.input.change_summary &&
            canonicalJson(version.content) === canonicalJson(normalized.input.content) &&
            result.etag === `"revision-${result.payload.data.head.revision}"`
          )
            return { kind: "SUCCEEDED", receipt: result.payload };
        }
        const error = definite(result, {
          409: ["ARTIFACT_DEPENDENCY_INVALID"],
          422: ["VALIDATION_ERROR"],
          428: ["PRECONDITION_REQUIRED"],
        });
        return error ? { ...error, status: error.status as 409 | 422 | 428 } : UNKNOWN;
      } catch {
        return UNKNOWN;
      }
    },
    getSourceExtraction: (projectId) => readSource(projectId),
    getSourceExtractionVersion: readSource,
    async getSourceProposalAcceptanceForVersion(projectId, versionId) {
      const path = `${versionPath(`${pathFor(projectId)}/source-extraction`, versionId)}/proposal-acceptance`;
      const result = await request(path);
      if (
        result?.status === 200 &&
        exact(result.payload, ["data", "request_id"]) &&
        exact(result.payload.data, [
          "acceptance_id",
          "project_id",
          "source_extraction_version_id",
          "source_extraction_content_hash",
          "proposal_id",
          "accepted_as_draft_at",
          "latest_version_id",
          "latest_head_revision",
          "current",
        ])
      ) {
        const data = result.payload.data;
        if (
          id(data.acceptance_id, /^pda_[0-9a-f]{32}$/) &&
          data.project_id === projectId &&
          data.source_extraction_version_id === versionId &&
          id(data.source_extraction_content_hash, HASH) &&
          result.etag === `"${data.source_extraction_content_hash}"` &&
          id(data.proposal_id, /^prp_[0-9a-f]{32}$/) &&
          timestamp(data.accepted_as_draft_at) &&
          id(data.latest_version_id, VERSION) &&
          positive(data.latest_head_revision) &&
          typeof data.current === "boolean" &&
          data.current === (data.latest_version_id === versionId)
        )
          return {
            kind: "FOUND",
            receipt: {
              data: {
                acceptance_id: data.acceptance_id,
                project_id: projectId,
                source_extraction_version_id: versionId,
                source_extraction_content_hash: data.source_extraction_content_hash,
                latest_version_id: data.latest_version_id,
                current: data.current,
              },
            },
          };
      }
      return (
        definite(result, {
          ...AUTH_ERRORS,
          404: ["SOURCE_PROPOSAL_ACCEPTANCE_NOT_FOUND"],
          409: ["SOURCE_PROPOSAL_ACCEPTANCE_INCONSISTENT"],
          422: ["VALIDATION_ERROR"],
        }) ?? UNKNOWN
      );
    },
  };
}
