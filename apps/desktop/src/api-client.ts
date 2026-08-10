import type { components } from "@aijian/contracts";

import {
  hasControlCharacter,
  hasOnlyKeys,
  hasRequestId,
  isIdArray,
  isNullableId,
  isRecord,
  isStringArray,
} from "./api-contract-guards";
import { isHealthResponse, type HealthResponse } from "./health-contract";
import {
  isCreateProviderConnectionInput,
  isProviderConnectionId,
  isProviderConnectionListResponse,
  isProviderConnectionResponse,
  type CreateProviderConnectionInput,
  type ProviderConnectionListResponse,
  type ProviderConnectionResponse,
} from "./provider-connection-contract";
import type { SidecarSession } from "./sidecar-protocol";
import { canonicalLoopbackOrigin } from "./sidecar-origin";
import { isTaskQueueResponse, type TaskQueueResponse } from "./task-queue-contract";
import {
  isReorderTimelineClipInput,
  isReplaceTimelineClipInput,
  isTimelineResponse,
  isTrimTimelineClipInput,
  type ReorderTimelineClipInput,
  type ReplaceTimelineClipInput,
  type TimelineResponse,
  type TrimTimelineClipInput,
} from "./timeline-contract";

export type {
  CreateProviderConnectionInput,
  ProviderConnectionListResponse,
  ProviderConnectionResponse,
} from "./provider-connection-contract";
export type { TaskQueueResponse } from "./task-queue-contract";
export type {
  ReorderTimelineClipInput,
  ReplaceTimelineClipInput,
  TimelineResponse,
  TrimTimelineClipInput,
} from "./timeline-contract";

export type CreateProjectInput = components["schemas"]["CreateProjectRequest"];
export type ImportTextSourceInput = components["schemas"]["ImportTextSourceRequest"];
export type ProjectListResponse = components["schemas"]["ProjectListResponse"];
export type ProjectResponse = components["schemas"]["ProjectResponse"];
export type SourceDocumentListResponse = components["schemas"]["SourceDocumentListResponse"];
export type SourceDocumentResponse = components["schemas"]["SourceDocumentResponse"];
export type SourceManifestResponse = components["schemas"]["SourceManifestResponse"];
export type StoryBibleIndexResponse = components["schemas"]["StoryBibleIndexResponse"];
export type StoryBibleVersionResponse = components["schemas"]["StoryBibleVersionResponse"];
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type SidecarApiSession = Pick<SidecarSession, "origin" | "token">;

export interface LocalApiClient {
  getHealth(): Promise<HealthResponse>;
  listProjects(): Promise<ProjectListResponse>;
  createProject(input: CreateProjectInput): Promise<ProjectResponse>;
  getProject(projectId: string): Promise<ProjectResponse>;
  listSources(projectId: string): Promise<SourceDocumentListResponse>;
  getSource(projectId: string, sourceId: string): Promise<SourceDocumentResponse>;
  importTextSource(
    projectId: string,
    input: ImportTextSourceInput,
  ): Promise<SourceDocumentResponse>;
  getSourceManifest(projectId: string): Promise<SourceManifestResponse | null>;
  getStoryBibleIndex(projectId: string): Promise<StoryBibleIndexResponse | null>;
  getStoryBibleVersion(projectId: string, versionId: string): Promise<StoryBibleVersionResponse>;
  listProjectTasks(projectId: string): Promise<TaskQueueResponse>;
  getProjectTimeline(projectId: string): Promise<TimelineResponse | null>;
  trimTimelineClip(projectId: string, input: TrimTimelineClipInput): Promise<TimelineResponse>;
  reorderTimelineClip(
    projectId: string,
    input: ReorderTimelineClipInput,
  ): Promise<TimelineResponse>;
  replaceTimelineClip(
    projectId: string,
    input: ReplaceTimelineClipInput,
  ): Promise<TimelineResponse>;
  listProviderConnections(): Promise<ProviderConnectionListResponse>;
  createProviderConnection(
    input: CreateProviderConnectionInput,
  ): Promise<ProviderConnectionResponse>;
  deleteProviderConnection(connectionId: string): Promise<void>;
}

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{32}$/;
const SOURCE_BLOCK_ID_PATTERN = /^srcb_[0-9a-f]{32}$/;
const ARTIFACT_ID_PATTERN = /^art_[0-9a-f]{32}$/;
const VERSION_ID_PATTERN = /^ver_[0-9a-f]{32}$/;
const SUBMISSION_ID_PATTERN = /^sub_[0-9a-f]{32}$/;
const ENTITY_ID_PATTERN = /^ent_[0-9a-f]{32}$/;
const FACT_ID_PATTERN = /^fact_[0-9a-f]{32}$/;
const QUESTION_ID_PATTERN = /^qst_[0-9a-f]{32}$/;
const CONFLICT_ID_PATTERN = /^cfl_[0-9a-f]{32}$/;
const SOURCE_SPAN_ID_PATTERN = /^spn_[0-9a-f]{32}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_SOURCE_BASE64_LENGTH = Math.ceil((5 * 1024 * 1024) / 3) * 4;
const MAX_LOCAL_API_JSON_BYTES = 16 * 1024 * 1024;

function isProject(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "name",
      "aspect_ratio",
      "target_duration_seconds",
      "source_language",
      "status",
      "revision",
      "created_at",
      "updated_at",
    ]) &&
    typeof value.id === "string" &&
    PROJECT_ID_PATTERN.test(value.id) &&
    typeof value.name === "string" &&
    value.aspect_ratio === "9:16" &&
    Number.isInteger(value.target_duration_seconds) &&
    value.source_language === "zh-CN" &&
    (value.status === "active" || value.status === "archived") &&
    Number.isInteger(value.revision) &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function isErrorResponse(value: unknown): value is {
  error: { code: string; message: string; retryable: boolean; details: Record<string, string> };
  request_id: string;
} {
  if (!isRecord(value) || !hasRequestId(value) || !isRecord(value.error)) return false;
  const { error } = value;
  return (
    typeof error.code === "string" &&
    typeof error.message === "string" &&
    typeof error.retryable === "boolean" &&
    isRecord(error.details) &&
    Object.values(error.details).every((detail) => typeof detail === "string")
  );
}

function isProjectResponse(value: unknown): value is ProjectResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    isProject(value.data)
  );
}

function isProjectListResponse(value: unknown): value is ProjectListResponse {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    Array.isArray(value.data) &&
    value.data.every(isProject)
  );
}

function isSourceBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "id",
      "ordinal",
      "kind",
      "chapter_index",
      "text",
      "normalized_start_byte",
      "normalized_end_byte",
      "content_sha256",
    ]) &&
    typeof value.id === "string" &&
    SOURCE_BLOCK_ID_PATTERN.test(value.id) &&
    Number.isInteger(value.ordinal) &&
    (value.kind === "chapter_heading" || value.kind === "paragraph") &&
    Number.isInteger(value.chapter_index) &&
    typeof value.text === "string" &&
    Number.isInteger(value.normalized_start_byte) &&
    Number.isInteger(value.normalized_end_byte) &&
    typeof value.content_sha256 === "string" &&
    SHA256_PATTERN.test(value.content_sha256)
  );
}

function isSourceDocumentSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    SOURCE_ID_PATTERN.test(value.id) &&
    typeof value.project_id === "string" &&
    PROJECT_ID_PATTERN.test(value.project_id) &&
    typeof value.filename === "string" &&
    value.media_type === "text/plain" &&
    value.encoding === "utf-8" &&
    Number.isInteger(value.byte_size) &&
    typeof value.raw_sha256 === "string" &&
    SHA256_PATTERN.test(value.raw_sha256) &&
    typeof value.imported_at === "string" &&
    Number.isInteger(value.chapter_count) &&
    Number.isInteger(value.block_count)
  );
}

function isSourceDocumentListResponse(
  value: unknown,
  expectedProjectId?: string,
): value is SourceDocumentListResponse {
  const summaryKeys = [
    "id",
    "project_id",
    "filename",
    "media_type",
    "encoding",
    "byte_size",
    "raw_sha256",
    "imported_at",
    "chapter_count",
    "block_count",
  ];
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    Array.isArray(value.data) &&
    value.data.every(
      (summary) =>
        isRecord(summary) &&
        hasOnlyKeys(summary, summaryKeys) &&
        isSourceDocumentSummary(summary) &&
        (expectedProjectId === undefined || summary.project_id === expectedProjectId),
    )
  );
}

function isSourceDocumentResponse(
  value: unknown,
  expectedProjectId?: string,
  expectedSourceId?: string,
): value is SourceDocumentResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data)
  ) {
    return false;
  }
  const data = value.data;
  return (
    hasOnlyKeys(data, [
      "id",
      "project_id",
      "filename",
      "media_type",
      "encoding",
      "byte_size",
      "raw_sha256",
      "imported_at",
      "chapter_count",
      "block_count",
      "blocks",
    ]) &&
    isSourceDocumentSummary(data) &&
    (expectedProjectId === undefined || data.project_id === expectedProjectId) &&
    (expectedSourceId === undefined || data.id === expectedSourceId) &&
    Array.isArray(data.blocks) &&
    data.block_count === data.blocks.length &&
    data.blocks.every(isSourceBlock)
  );
}

function isArtifactHead(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "artifact_id",
      "latest_version_id",
      "review_version_id",
      "review_submission_id",
      "accepted_version_id",
      "revision",
      "review_evidence_revision",
      "updated_at",
    ]) &&
    typeof value.artifact_id === "string" &&
    ARTIFACT_ID_PATTERN.test(value.artifact_id) &&
    typeof value.latest_version_id === "string" &&
    VERSION_ID_PATTERN.test(value.latest_version_id) &&
    isNullableId(value.review_version_id ?? null, VERSION_ID_PATTERN) &&
    isNullableId(value.review_submission_id, SUBMISSION_ID_PATTERN) &&
    isNullableId(value.accepted_version_id ?? null, VERSION_ID_PATTERN) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    Number.isInteger(value.review_evidence_revision) &&
    Number(value.review_evidence_revision) >= 0 &&
    typeof value.updated_at === "string"
  );
}

function isArtifactVersion(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    typeof value.artifact_id === "string" &&
    ARTIFACT_ID_PATTERN.test(value.artifact_id) &&
    typeof value.id === "string" &&
    VERSION_ID_PATTERN.test(value.id) &&
    isNullableId(value.parent_version_id ?? null, VERSION_ID_PATTERN) &&
    Number.isInteger(value.version_number) &&
    Number(value.version_number) >= 1 &&
    value.schema_version === "1.0.0" &&
    typeof value.content_hash === "string" &&
    CONTENT_HASH_PATTERN.test(value.content_hash) &&
    typeof value.change_summary === "string" &&
    typeof value.created_at === "string" &&
    isRecord(value.content)
  );
}

function isManifestBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "source_block_id",
      "ordinal",
      "kind",
      "chapter_index",
      "start_byte",
      "end_byte",
      "content_sha256",
    ]) &&
    typeof value.source_block_id === "string" &&
    SOURCE_BLOCK_ID_PATTERN.test(value.source_block_id) &&
    Number.isInteger(value.ordinal) &&
    (value.kind === "chapter_heading" || value.kind === "paragraph") &&
    Number.isInteger(value.chapter_index) &&
    Number.isInteger(value.start_byte) &&
    Number.isInteger(value.end_byte) &&
    Number(value.end_byte) >= Number(value.start_byte) &&
    typeof value.content_sha256 === "string" &&
    SHA256_PATTERN.test(value.content_sha256)
  );
}

function isManifestDocument(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "source_document_id",
      "filename",
      "media_type",
      "encoding",
      "byte_size",
      "chapter_count",
      "raw_sha256",
      "normalized_sha256",
      "import_order",
      "blocks",
    ]) &&
    typeof value.source_document_id === "string" &&
    SOURCE_ID_PATTERN.test(value.source_document_id) &&
    typeof value.filename === "string" &&
    value.media_type === "text/plain" &&
    value.encoding === "utf-8" &&
    Number.isInteger(value.byte_size) &&
    Number.isInteger(value.chapter_count) &&
    typeof value.raw_sha256 === "string" &&
    SHA256_PATTERN.test(value.raw_sha256) &&
    typeof value.normalized_sha256 === "string" &&
    SHA256_PATTERN.test(value.normalized_sha256) &&
    Number.isInteger(value.import_order) &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isManifestBlock)
  );
}

function isSourceManifestResponse(
  value: unknown,
  expectedProjectId: string,
): value is SourceManifestResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "project_id",
      "head",
      "latest_version",
      "review_version",
      "accepted_version",
    ])
  ) {
    return false;
  }
  if (value.data.project_id !== expectedProjectId) return false;
  const {
    head,
    latest_version: latest,
    review_version: review,
    accepted_version: accepted,
  } = value.data;
  if (!isArtifactHead(head)) return false;
  const isManifestVersion = (candidate: unknown): candidate is Record<string, unknown> => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "id",
        "artifact_id",
        "version_number",
        "schema_version",
        "content",
        "content_hash",
        "parent_version_id",
        "change_summary",
        "created_at",
      ]) ||
      !isArtifactVersion(candidate) ||
      !isRecord(candidate.content)
    ) {
      return false;
    }
    const content = candidate.content;
    return (
      hasOnlyKeys(content, ["scope_type", "documents", "exclusions"]) &&
      content.scope_type === "full_work" &&
      Array.isArray(content.documents) &&
      content.documents.every(isManifestDocument) &&
      (content.exclusions === undefined || isStringArray(content.exclusions))
    );
  };
  if (!isManifestVersion(latest)) return false;
  const roleMatches = (candidate: unknown, expectedVersionId: unknown): boolean =>
    expectedVersionId === null
      ? candidate === null
      : isManifestVersion(candidate) &&
        candidate.id === expectedVersionId &&
        candidate.artifact_id === head.artifact_id;
  return (
    latest.artifact_id === head.artifact_id &&
    latest.id === head.latest_version_id &&
    roleMatches(review, head.review_version_id) &&
    roleMatches(accepted, head.accepted_version_id)
  );
}

function isStoryEntity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, ["entity_id", "kind", "name", "aliases"]) &&
    typeof value.entity_id === "string" &&
    ENTITY_ID_PATTERN.test(value.entity_id) &&
    ["character", "location", "organization", "prop", "costume"].includes(String(value.kind)) &&
    typeof value.name === "string" &&
    (value.aliases === undefined ||
      (Array.isArray(value.aliases) && value.aliases.every((item) => typeof item === "string")))
  );
}

const COMMON_STORY_FACT_KEYS = [
  "fact_id",
  "importance",
  "origin",
  "canon_status",
  "extraction_confidence_bps",
  "canon_certainty",
  "viewpoint_entity_id",
  "source_reliability",
  "decision_reason",
  "impact_scope",
  "supersedes_fact_ids",
  "derived_from_fact_ids",
  "kind",
] as const;

function hasCommonStoryFactFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.fact_id === "string" &&
    FACT_ID_PATTERN.test(value.fact_id) &&
    ["core", "supporting", "detail"].includes(String(value.importance)) &&
    [
      "source_explicit_assertion",
      "source_interpretation",
      "user_decision",
      "ai_inference",
    ].includes(String(value.origin)) &&
    ["proposed", "confirmed", "contested", "rejected"].includes(String(value.canon_status)) &&
    (value.extraction_confidence_bps === undefined ||
      value.extraction_confidence_bps === null ||
      (Number.isInteger(value.extraction_confidence_bps) &&
        Number(value.extraction_confidence_bps) >= 0 &&
        Number(value.extraction_confidence_bps) <= 10_000)) &&
    ["certain", "likely", "ambiguous", "intentionally_unreliable"].includes(
      String(value.canon_certainty),
    ) &&
    (value.viewpoint_entity_id === undefined ||
      isNullableId(value.viewpoint_entity_id, ENTITY_ID_PATTERN)) &&
    ["reliable", "uncertain", "unreliable", "not_applicable"].includes(
      String(value.source_reliability),
    ) &&
    (value.decision_reason === undefined ||
      value.decision_reason === null ||
      typeof value.decision_reason === "string") &&
    (value.impact_scope === undefined || isStringArray(value.impact_scope)) &&
    (value.supersedes_fact_ids === undefined ||
      isIdArray(value.supersedes_fact_ids, FACT_ID_PATTERN)) &&
    (value.derived_from_fact_ids === undefined ||
      isIdArray(value.derived_from_fact_ids, FACT_ID_PATTERN))
  );
}

function isStoryValidity(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["starts_after_event_fact_id", "ends_after_event_fact_id"])
  ) {
    return false;
  }
  return (
    (value.starts_after_event_fact_id === undefined ||
      isNullableId(value.starts_after_event_fact_id, FACT_ID_PATTERN)) &&
    (value.ends_after_event_fact_id === undefined ||
      isNullableId(value.ends_after_event_fact_id, FACT_ID_PATTERN))
  );
}

function isStoryStateValue(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "text":
      return hasOnlyKeys(value, ["kind", "value"]) && typeof value.value === "string";
    case "entity_ref":
      return (
        hasOnlyKeys(value, ["kind", "entity_id"]) &&
        typeof value.entity_id === "string" &&
        ENTITY_ID_PATTERN.test(value.entity_id)
      );
    case "boolean":
      return hasOnlyKeys(value, ["kind", "value"]) && typeof value.value === "boolean";
    case "number":
      return (
        hasOnlyKeys(value, ["kind", "value"]) &&
        typeof value.value === "number" &&
        Number.isFinite(value.value)
      );
    default:
      return false;
  }
}

function isTemporalRelation(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["relation", "other_event_fact_id"]) &&
    ["before", "after", "simultaneous"].includes(String(value.relation)) &&
    typeof value.other_event_fact_id === "string" &&
    FACT_ID_PATTERN.test(value.other_event_fact_id)
  );
}

function isStoryStateChange(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["entity_id", "property_key", "before", "after"])) {
    return false;
  }
  return (
    typeof value.entity_id === "string" &&
    ENTITY_ID_PATTERN.test(value.entity_id) &&
    [
      "holder",
      "wearer",
      "location",
      "condition",
      "possession",
      "relationship_status",
      "alive",
      "appearance",
    ].includes(String(value.property_key)) &&
    (value.before === undefined || isStoryStateValue(value.before)) &&
    (value.after === undefined || isStoryStateValue(value.after))
  );
}

function isStoryFact(value: unknown): boolean {
  if (!isRecord(value) || !hasCommonStoryFactFields(value)) return false;
  const keysFor = (specific: readonly string[]) =>
    hasOnlyKeys(value, [...COMMON_STORY_FACT_KEYS, ...specific]);
  const validAttributeFact = (entityKey: string) =>
    typeof value[entityKey] === "string" &&
    ENTITY_ID_PATTERN.test(String(value[entityKey])) &&
    typeof value.attribute === "string" &&
    typeof value.value === "string" &&
    isStoryValidity(value.validity);
  switch (value.kind) {
    case "character_fact":
      return (
        keysFor(["character_id", "attribute", "value", "validity"]) &&
        validAttributeFact("character_id")
      );
    case "location_fact":
      return (
        keysFor(["location_id", "attribute", "value", "validity"]) &&
        validAttributeFact("location_id")
      );
    case "organization_fact":
      return (
        keysFor(["organization_id", "attribute", "value", "validity"]) &&
        validAttributeFact("organization_id")
      );
    case "relationship_fact":
      return (
        keysFor(["subject_entity_id", "predicate", "object_entity_id", "validity"]) &&
        typeof value.subject_entity_id === "string" &&
        ENTITY_ID_PATTERN.test(value.subject_entity_id) &&
        typeof value.predicate === "string" &&
        typeof value.object_entity_id === "string" &&
        ENTITY_ID_PATTERN.test(value.object_entity_id) &&
        isStoryValidity(value.validity)
      );
    case "event_fact":
      return (
        keysFor([
          "participants",
          "location_id",
          "source_narrative_order",
          "story_time_order",
          "temporal_relations",
          "caused_by_fact_ids",
          "state_changes",
        ]) &&
        isIdArray(value.participants, ENTITY_ID_PATTERN) &&
        (value.location_id === undefined || isNullableId(value.location_id, ENTITY_ID_PATTERN)) &&
        Number.isInteger(value.source_narrative_order) &&
        Number.isInteger(value.story_time_order) &&
        (value.temporal_relations === undefined ||
          (Array.isArray(value.temporal_relations) &&
            value.temporal_relations.every(isTemporalRelation))) &&
        (value.caused_by_fact_ids === undefined ||
          isIdArray(value.caused_by_fact_ids, FACT_ID_PATTERN)) &&
        (value.state_changes === undefined ||
          (Array.isArray(value.state_changes) && value.state_changes.every(isStoryStateChange)))
      );
    case "world_rule_fact":
      return (
        keysFor(["rule_scope", "rule", "exceptions"]) &&
        typeof value.rule_scope === "string" &&
        typeof value.rule === "string" &&
        (value.exceptions === undefined || isStringArray(value.exceptions))
      );
    case "prop_fact":
    case "costume_fact": {
      const entityKey = value.kind === "prop_fact" ? "prop_id" : "costume_id";
      return (
        keysFor([entityKey, "property_key", "value", "validity"]) &&
        typeof value[entityKey] === "string" &&
        ENTITY_ID_PATTERN.test(String(value[entityKey])) &&
        ["holder", "wearer", "location", "condition", "appearance"].includes(
          String(value.property_key),
        ) &&
        isStoryStateValue(value.value) &&
        isStoryValidity(value.validity)
      );
    }
    default:
      return false;
  }
}

function isStoryQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "question_id",
      "scope_type",
      "scope_id",
      "question",
      "severity",
      "responsible_role",
      "blocking",
      "status",
      "resolution",
    ]) &&
    typeof value.question_id === "string" &&
    QUESTION_ID_PATTERN.test(value.question_id) &&
    typeof value.question === "string" &&
    typeof value.blocking === "boolean" &&
    typeof value.responsible_role === "string" &&
    ["artifact", "entity", "fact", "source_document"].includes(String(value.scope_type)) &&
    (value.scope_id === undefined ||
      value.scope_id === null ||
      typeof value.scope_id === "string") &&
    ["blocking", "major", "minor", "note"].includes(String(value.severity)) &&
    ["open", "resolved"].includes(String(value.status)) &&
    (value.resolution === undefined ||
      value.resolution === null ||
      typeof value.resolution === "string")
  );
}

function isStoryConflict(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
      "conflict_id",
      "conflict_type",
      "fact_ids",
      "severity",
      "responsible_role",
      "status",
      "resolution_reason",
      "resolution_fact_id",
    ]) &&
    typeof value.conflict_id === "string" &&
    CONFLICT_ID_PATTERN.test(value.conflict_id) &&
    typeof value.conflict_type === "string" &&
    Array.isArray(value.fact_ids) &&
    value.fact_ids.every((item) => typeof item === "string" && FACT_ID_PATTERN.test(item)) &&
    ["blocking", "major", "minor", "note"].includes(String(value.severity)) &&
    typeof value.responsible_role === "string" &&
    ["unresolved", "resolved_as_source_ambiguity", "resolved_by_user_decision"].includes(
      String(value.status),
    ) &&
    (value.resolution_reason === undefined ||
      value.resolution_reason === null ||
      typeof value.resolution_reason === "string") &&
    (value.resolution_fact_id === undefined ||
      isNullableId(value.resolution_fact_id, FACT_ID_PATTERN))
  );
}

function isStorySourceSpan(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, [
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
    typeof value.id === "string" &&
    SOURCE_SPAN_ID_PATTERN.test(value.id) &&
    typeof value.fact_id === "string" &&
    FACT_ID_PATTERN.test(value.fact_id) &&
    typeof value.source_document_id === "string" &&
    SOURCE_ID_PATTERN.test(value.source_document_id) &&
    typeof value.source_block_id === "string" &&
    SOURCE_BLOCK_ID_PATTERN.test(value.source_block_id) &&
    ["supports", "contradicts", "context"].includes(String(value.role)) &&
    Number.isInteger(value.start_byte) &&
    Number(value.start_byte) >= 0 &&
    Number.isInteger(value.end_byte) &&
    Number(value.end_byte) > Number(value.start_byte) &&
    typeof value.claim === "string" &&
    value.claim.length > 0 &&
    typeof value.quote_hash === "string" &&
    CONTENT_HASH_PATTERN.test(value.quote_hash)
  );
}

function isStoryBibleIndexResponse(
  value: unknown,
  expectedProjectId: string,
): value is StoryBibleIndexResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, [
      "project_id",
      "head",
      "latest_version",
      "review_version",
      "accepted_version",
    ]) ||
    value.data.project_id !== expectedProjectId
  ) {
    return false;
  }
  const {
    head,
    latest_version: latest,
    review_version: review,
    accepted_version: accepted,
  } = value.data;
  const isSummary = (candidate: unknown): candidate is Record<string, unknown> =>
    isRecord(candidate) &&
    hasOnlyKeys(candidate, [
      "id",
      "artifact_id",
      "version_number",
      "schema_version",
      "content_hash",
      "parent_version_id",
      "change_summary",
      "created_at",
    ]) &&
    typeof candidate.artifact_id === "string" &&
    ARTIFACT_ID_PATTERN.test(candidate.artifact_id) &&
    typeof candidate.id === "string" &&
    VERSION_ID_PATTERN.test(candidate.id) &&
    isNullableId(candidate.parent_version_id ?? null, VERSION_ID_PATTERN) &&
    Number.isInteger(candidate.version_number) &&
    Number(candidate.version_number) >= 1 &&
    candidate.schema_version === "1.0.0" &&
    typeof candidate.content_hash === "string" &&
    CONTENT_HASH_PATTERN.test(candidate.content_hash) &&
    typeof candidate.change_summary === "string" &&
    typeof candidate.created_at === "string";
  if (!isArtifactHead(head) || !isSummary(latest)) return false;
  const roleMatches = (candidate: unknown, expectedVersionId: unknown): boolean =>
    expectedVersionId === null
      ? candidate === null
      : isSummary(candidate) &&
        candidate.id === expectedVersionId &&
        candidate.artifact_id === head.artifact_id;
  return (
    latest.id === head.latest_version_id &&
    latest.artifact_id === head.artifact_id &&
    roleMatches(review, head.review_version_id) &&
    roleMatches(accepted, head.accepted_version_id)
  );
}

function isStoryBibleVersionResponse(
  value: unknown,
  expectedProjectId: string,
  expectedVersionId: string,
): value is StoryBibleVersionResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data", "request_id"]) ||
    !hasRequestId(value) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["project_id", "head", "version"]) ||
    value.data.project_id !== expectedProjectId
  ) {
    return false;
  }
  const { head, version } = value.data;
  if (!isArtifactHead(head)) return false;

  const isStoryVersion = (candidate: unknown): candidate is Record<string, unknown> => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "id",
        "artifact_id",
        "version_number",
        "schema_version",
        "content",
        "source_spans",
        "content_hash",
        "parent_version_id",
        "change_summary",
        "created_at",
      ]) ||
      !isArtifactVersion(candidate) ||
      !Array.isArray(candidate.source_spans) ||
      !isRecord(candidate.content) ||
      !hasOnlyKeys(candidate.content, [
        "title",
        "logline",
        "source_scope",
        "entities",
        "facts",
        "questions",
        "conflicts",
      ])
    ) {
      return false;
    }
    const content = candidate.content;
    if (
      typeof content.title !== "string" ||
      content.title.trim().length === 0 ||
      [...content.title].length > 120 ||
      typeof content.logline !== "string" ||
      content.logline.trim().length === 0 ||
      [...content.logline].length > 500 ||
      !isRecord(content.source_scope) ||
      !hasOnlyKeys(content.source_scope, [
        "source_manifest_version_id",
        "scope_type",
        "documents",
        "exclusions",
      ]) ||
      !["full_work", "selected_range"].includes(String(content.source_scope.scope_type)) ||
      typeof content.source_scope.source_manifest_version_id !== "string" ||
      !VERSION_ID_PATTERN.test(content.source_scope.source_manifest_version_id) ||
      !Array.isArray(content.source_scope.documents) ||
      !content.source_scope.documents.every(
        (document) =>
          isRecord(document) &&
          hasOnlyKeys(document, [
            "source_document_id",
            "raw_sha256",
            "source_block_ids",
            "chapter_indices",
          ]) &&
          typeof document.source_document_id === "string" &&
          SOURCE_ID_PATTERN.test(document.source_document_id) &&
          typeof document.raw_sha256 === "string" &&
          SHA256_PATTERN.test(document.raw_sha256) &&
          isIdArray(document.source_block_ids, SOURCE_BLOCK_ID_PATTERN) &&
          Array.isArray(document.chapter_indices) &&
          document.chapter_indices.every(
            (chapter) => Number.isInteger(chapter) && Number(chapter) >= 1,
          ),
      ) ||
      !isStringArray(content.source_scope.exclusions) ||
      !Array.isArray(content.entities) ||
      content.entities.length < 1 ||
      content.entities.length > 2000 ||
      !content.entities.every(isStoryEntity) ||
      !Array.isArray(content.facts) ||
      content.facts.length < 1 ||
      content.facts.length > 20000 ||
      !content.facts.every(isStoryFact) ||
      !Array.isArray(content.questions) ||
      content.questions.length > 2000 ||
      !content.questions.every(isStoryQuestion) ||
      !Array.isArray(content.conflicts) ||
      content.conflicts.length > 2000 ||
      !content.conflicts.every(isStoryConflict) ||
      candidate.source_spans.length > 20000 ||
      !candidate.source_spans.every(isStorySourceSpan)
    ) {
      return false;
    }
    const factIds = new Set(
      content.facts.map((fact) => (fact as Record<string, unknown>).fact_id as string),
    );
    const entityIds = new Set(
      content.entities.map((entity) => (entity as Record<string, unknown>).entity_id as string),
    );
    if (factIds.size !== content.facts.length || entityIds.size !== content.entities.length) {
      return false;
    }
    const documentIds = new Set(
      content.source_scope.documents.map(
        (document) => (document as Record<string, unknown>).source_document_id as string,
      ),
    );
    return candidate.source_spans.every((span) => {
      const checked = span as Record<string, unknown>;
      return (
        factIds.has(checked.fact_id as string) &&
        documentIds.has(checked.source_document_id as string)
      );
    });
  };

  return (
    isStoryVersion(version) &&
    version.artifact_id === head.artifact_id &&
    version.id === expectedVersionId
  );
}

function isCreateProjectInput(value: unknown): value is CreateProjectInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const validKeys = ["aspect_ratio", "name", "source_language", "target_duration_seconds"];
  const nameLength = typeof value.name === "string" ? [...value.name].length : 0;
  return (
    keys.length === validKeys.length &&
    validKeys.every((key, index) => keys[index] === key) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    nameLength <= 80 &&
    !hasControlCharacter(value.name) &&
    value.aspect_ratio === "9:16" &&
    Number.isInteger(value.target_duration_seconds) &&
    Number(value.target_duration_seconds) >= 30 &&
    Number(value.target_duration_seconds) <= 180 &&
    value.source_language === "zh-CN"
  );
}

function isImportTextSourceInput(value: unknown): value is ImportTextSourceInput {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const validKeys = ["content_base64", "filename", "media_type"];
  return (
    keys.length === validKeys.length &&
    validKeys.every((key, index) => keys[index] === key) &&
    typeof value.filename === "string" &&
    value.filename.length > 0 &&
    value.filename.length <= 255 &&
    value.filename.toLowerCase().endsWith(".txt") &&
    !value.filename.includes("/") &&
    !value.filename.includes("\\") &&
    !hasControlCharacter(value.filename) &&
    value.media_type === "text/plain" &&
    typeof value.content_base64 === "string" &&
    value.content_base64.length >= 4 &&
    value.content_base64.length <= MAX_SOURCE_BASE64_LENGTH &&
    BASE64_PATTERN.test(value.content_base64)
  );
}

export function createLocalApiClient(fetcher: Fetcher, session: SidecarApiSession): LocalApiClient {
  const origin = canonicalLoopbackOrigin(session.origin);
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(session.token)) {
    throw new Error("Local API client requires a valid sidecar session");
  }
  const authorization = `Bearer ${session.token}`;
  const headers = {
    Accept: "application/json",
    Authorization: authorization,
    Origin: "app://aijian",
  };

  async function readJsonWithLimit(response: Response): Promise<unknown> {
    const contentLength = response.headers.get("Content-Length");
    if (contentLength && /^\d+$/.test(contentLength)) {
      const declaredBytes = Number(contentLength);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > MAX_LOCAL_API_JSON_BYTES) {
        throw new Error("Local API response exceeds the desktop safety limit");
      }
    }
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > MAX_LOCAL_API_JSON_BYTES) {
        throw new Error("Local API response exceeds the desktop safety limit");
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_LOCAL_API_JSON_BYTES) {
          await reader.cancel("response too large");
          throw new Error("Local API response exceeds the desktop safety limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }

  async function requestJson<T>(
    path: string,
    validator: (value: unknown) => value is T,
    init?: RequestInit,
  ): Promise<T> {
    const response = await fetcher(`${origin}${path}`, init);
    if (!response.ok) {
      let errorPayload: unknown;
      try {
        errorPayload = await readJsonWithLimit(response);
      } catch {
        throw new Error(`Local API request failed with status ${response.status}`);
      }
      const code = isErrorResponse(errorPayload) ? ` (${errorPayload.error.code})` : "";
      throw new Error(`Local API request failed with status ${response.status}${code}`);
    }
    const payload = await readJsonWithLimit(response);
    if (!validator(payload)) {
      throw new Error("Local API response does not match the published contract");
    }
    return payload;
  }

  async function requestOptionalJson<T>(
    path: string,
    validator: (value: unknown) => value is T,
    absentCode: "SOURCE_MANIFEST_NOT_FOUND" | "STORY_BIBLE_NOT_FOUND" | "TIMELINE_NOT_FOUND",
  ): Promise<T | null> {
    const response = await fetcher(`${origin}${path}`, { headers });
    if (response.status === 404) {
      let errorPayload: unknown;
      try {
        errorPayload = await readJsonWithLimit(response);
      } catch {
        throw new Error("Local API 404 response does not match the published error contract");
      }
      if (!isErrorResponse(errorPayload)) {
        throw new Error("Local API 404 response does not match the published error contract");
      }
      if (errorPayload.error.code === absentCode) return null;
      throw new Error(`Local API request failed with status 404 (${errorPayload.error.code})`);
    }
    if (!response.ok) {
      throw new Error(`Local API request failed with status ${response.status}`);
    }
    const payload = await readJsonWithLimit(response);
    if (!validator(payload)) {
      throw new Error("Local API response does not match the published contract");
    }
    return payload;
  }

  function postInit(payload: unknown): RequestInit {
    return {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };
  }

  return {
    async getHealth(): Promise<HealthResponse> {
      const response = await fetcher(`${origin}/api/v1/health`, {
        headers: {
          Accept: "application/json",
          Authorization: authorization,
          Origin: "app://aijian",
        },
      });
      if (!response.ok) {
        throw new Error(`Local API health request failed with status ${response.status}`);
      }
      const payload = await readJsonWithLimit(response);
      if (!isHealthResponse(payload)) {
        throw new Error("Local API health response does not match the published contract");
      }
      return payload;
    },
    listProjects: () =>
      requestJson("/api/v1/projects", isProjectListResponse, {
        headers,
      }),
    async createProject(input: CreateProjectInput): Promise<ProjectResponse> {
      if (!isCreateProjectInput(input)) {
        throw new Error("Local API client requires valid project input");
      }
      return requestJson("/api/v1/projects", isProjectResponse, postInit(input));
    },
    async getProject(projectId: string): Promise<ProjectResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(`/api/v1/projects/${projectId}`, isProjectResponse, { headers });
    },
    async listSources(projectId: string): Promise<SourceDocumentListResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/sources`,
        (payload): payload is SourceDocumentListResponse =>
          isSourceDocumentListResponse(payload, projectId),
        { headers },
      );
    },
    async getSource(projectId: string, sourceId: string): Promise<SourceDocumentResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!SOURCE_ID_PATTERN.test(sourceId)) {
        throw new Error("Local API client requires a valid source id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/sources/${sourceId}`,
        (payload): payload is SourceDocumentResponse =>
          isSourceDocumentResponse(payload, projectId, sourceId),
        { headers },
      );
    },
    async importTextSource(
      projectId: string,
      input: ImportTextSourceInput,
    ): Promise<SourceDocumentResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!isImportTextSourceInput(input)) {
        throw new Error("Local API client requires valid text source input");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/sources`,
        (payload): payload is SourceDocumentResponse =>
          isSourceDocumentResponse(payload, projectId),
        postInit(input),
      );
    },
    async getSourceManifest(projectId: string): Promise<SourceManifestResponse | null> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestOptionalJson(
        `/api/v1/projects/${projectId}/source-manifest`,
        (payload): payload is SourceManifestResponse =>
          isSourceManifestResponse(payload, projectId),
        "SOURCE_MANIFEST_NOT_FOUND",
      );
    },
    async getStoryBibleIndex(projectId: string): Promise<StoryBibleIndexResponse | null> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestOptionalJson(
        `/api/v1/projects/${projectId}/story-bible`,
        (payload): payload is StoryBibleIndexResponse =>
          isStoryBibleIndexResponse(payload, projectId),
        "STORY_BIBLE_NOT_FOUND",
      );
    },
    async getStoryBibleVersion(
      projectId: string,
      versionId: string,
    ): Promise<StoryBibleVersionResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      if (!VERSION_ID_PATTERN.test(versionId)) {
        throw new Error("Local API client requires a valid version id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/story-bible/versions/${versionId}`,
        (payload): payload is StoryBibleVersionResponse =>
          isStoryBibleVersionResponse(payload, projectId, versionId),
        { headers },
      );
    },
    async listProjectTasks(projectId: string): Promise<TaskQueueResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/tasks`,
        (payload): payload is TaskQueueResponse => isTaskQueueResponse(payload, projectId),
        { headers },
      );
    },
    async getProjectTimeline(projectId: string): Promise<TimelineResponse | null> {
      if (!PROJECT_ID_PATTERN.test(projectId)) {
        throw new Error("Local API client requires a valid project id");
      }
      return requestOptionalJson(
        `/api/v1/projects/${projectId}/timeline`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        "TIMELINE_NOT_FOUND",
      );
    },
    async trimTimelineClip(
      projectId: string,
      input: TrimTimelineClipInput,
    ): Promise<TimelineResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isTrimTimelineClipInput(input)) {
        throw new Error("Local API client requires a valid timeline trim command");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/timeline/trim`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        postInit(input),
      );
    },
    async reorderTimelineClip(
      projectId: string,
      input: ReorderTimelineClipInput,
    ): Promise<TimelineResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isReorderTimelineClipInput(input)) {
        throw new Error("Local API client requires a valid timeline reorder command");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/timeline/reorder`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        postInit(input),
      );
    },
    async replaceTimelineClip(
      projectId: string,
      input: ReplaceTimelineClipInput,
    ): Promise<TimelineResponse> {
      if (!PROJECT_ID_PATTERN.test(projectId) || !isReplaceTimelineClipInput(input)) {
        throw new Error("Local API client requires a valid timeline replace command");
      }
      return requestJson(
        `/api/v1/projects/${projectId}/timeline/replace`,
        (payload): payload is TimelineResponse => isTimelineResponse(payload, projectId),
        postInit(input),
      );
    },
    listProviderConnections: () =>
      requestJson("/api/v1/provider-connections", isProviderConnectionListResponse, { headers }),
    async createProviderConnection(
      input: CreateProviderConnectionInput,
    ): Promise<ProviderConnectionResponse> {
      if (!isCreateProviderConnectionInput(input)) {
        throw new Error("Local API client requires valid provider connection input");
      }
      return requestJson(
        "/api/v1/provider-connections",
        isProviderConnectionResponse,
        postInit(input),
      );
    },
    async deleteProviderConnection(connectionId: string): Promise<void> {
      if (!isProviderConnectionId(connectionId)) {
        throw new Error("Local API client requires a valid provider connection id");
      }
      const response = await fetcher(`${origin}/api/v1/provider-connections/${connectionId}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) {
        let code = "";
        try {
          const errorPayload = await readJsonWithLimit(response);
          code = isErrorResponse(errorPayload) ? ` (${errorPayload.error.code})` : "";
        } catch {
          // The stable HTTP status remains useful if an intermediary replaced the error body.
        }
        throw new Error(`Local API request failed with status ${response.status}${code}`);
      }
    },
  };
}
