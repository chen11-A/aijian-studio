import type { components } from "./generated.js";
import { SCRIPT_IMPACT_SCHEMAS } from "./script-confirmation-impact-schema.ts";

export type ScriptImpactReport = components["schemas"]["ScriptConfirmationImpactReportV1"];
export type ScriptImpactPage = components["schemas"]["ScriptConfirmationImpactPageData"];
export type ScriptImpactLookup = components["schemas"]["ScriptConfirmationImpactLookupData"];
export type ScriptConfirmationInput = {
  version_id: string;
  expected_content_hash: string;
  expected_head_revision: number;
  confirm: true;
};
export type ScriptConfirmationOperation = {
  operation_id: string;
  project_id: string;
  episode_id: string;
  payload: ScriptConfirmationInput;
  lookup: ScriptImpactLookup;
};
export type ImpactRead<T> =
  { kind: "FOUND"; receipt: { data: T; request_id: string } } | { kind: "REMOTE_UNKNOWN" };
export type ScriptImpactGateway = {
  listScriptConfirmationImpacts(
    projectId: string,
    cursor?: string,
  ): Promise<ImpactRead<ScriptImpactPage>>;
  getScriptConfirmationImpact(
    projectId: string,
    reportId: string,
  ): Promise<ImpactRead<ScriptImpactReport>>;
  getEpisodeScriptConfirmationOperation(
    projectId: string,
    episodeId: string,
    operationId: string,
    payload: ScriptConfirmationInput,
  ): Promise<ImpactRead<ScriptConfirmationOperation>>;
};
export const IMPACT_CHANNELS = Object.freeze({
  list: "script-confirmation-impact:list",
  detail: "script-confirmation-impact:detail",
  operation: "script-confirmation-impact:original-operation",
});
export const impactProject = (v: unknown): v is string =>
  typeof v === "string" && /^prj_[0-9a-f]{32}$/.test(v);
export const impactEpisode = (v: unknown): v is string =>
  typeof v === "string" && /^ep_(?:prj_)?[0-9a-f]{32}$/.test(v);
export const impactId = (v: unknown): v is string =>
  typeof v === "string" && /^sci_[0-9a-f]{32}$/.test(v);
export const impactUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
// Only these actual POST-route / pre-dispatch middleware errors prove rejection.
// A GET-only missing operation, unrelated code or wrong status cannot settle intent.
export function isScriptConfirmationMutationRejection(value: unknown): boolean {
  if (!record(value) || Object.keys(value).length !== 4) return false;
  if (
    value.kind !== "DEFINITE_SERVER_ERROR" ||
    !impactUuid(value.request_id) ||
    typeof value.code !== "string"
  )
    return false;
  const statuses: Readonly<Record<string, number>> = {
    SIDECAR_AUTH_REQUIRED: 401,
    SIDECAR_REQUEST_REJECTED: 403,
    SCRIPT_NOT_FOUND: 404,
    SCRIPT_CONFIRMATION_CONFLICT: 409,
    SCRIPT_CONFIRMATION_INPUT_REJECTED: 422,
    VALIDATION_ERROR: 422,
    PRECONDITION_REQUIRED: 428,
  };
  return Object.hasOwn(statuses, value.code) && statuses[value.code] === value.status;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function impactCanonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(impactCanonical).join(",")}]`;
  if (record(v))
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${impactCanonical(v[k])}`)
      .join(",")}}`;
  const encoded = JSON.stringify(v);
  if (encoded === undefined) throw new Error("Impact evidence must be JSON");
  return encoded;
}
export const sameImpactValue = (a: unknown, b: unknown): boolean =>
  impactCanonical(a) === impactCanonical(b);
export async function verifyImpactHash(report: ScriptImpactReport): Promise<boolean> {
  try {
    const bytes = new TextEncoder().encode(impactCanonical(report.assessment));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return (
      report.assessment_hash ===
      `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`
    );
  } catch {
    return false;
  }
}

// This bounded reader supports only the keywords emitted by these four closed DTOs.
// Unknown validation keywords fail closed instead of weakening a future schema.
function model(v: unknown, name: string): boolean {
  let remaining = 1_000_000;
  const definitions: Record<string, unknown> = SCRIPT_IMPACT_SCHEMAS;
  const metadata = new Set(["title", "description", "default", "discriminator"]);
  const supported = new Set([
    "$ref",
    "anyOf",
    "oneOf",
    "type",
    "const",
    "enum",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
  ]);
  function visit(value: unknown, schema: unknown, depth: number): boolean {
    if (--remaining < 0 || depth > 80 || !record(schema)) return false;
    if (Object.keys(schema).some((k) => !metadata.has(k) && !supported.has(k))) return false;
    if (typeof schema.$ref === "string") {
      if (!schema.$ref.startsWith("#/$defs/")) return false;
      return visit(value, definitions[schema.$ref.slice(8)], depth + 1);
    }
    for (const union of ["anyOf", "oneOf"] as const) {
      if (Array.isArray(schema[union])) {
        const valid = schema[union].filter((s) => visit(value, s, depth + 1)).length;
        return union === "oneOf" ? valid === 1 : valid >= 1;
      }
    }
    if ("const" in schema && value !== schema.const) return false;
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
    if (schema.type === "null") return value === null;
    if (schema.type === "boolean") return typeof value === "boolean";
    if (schema.type === "string") {
      if (typeof value !== "string" || /\p{Surrogate}/u.test(value)) return false;
      const length = [...value].length;
      if (typeof schema.minLength === "number" && length < schema.minLength) return false;
      if (typeof schema.maxLength === "number" && length > schema.maxLength) return false;
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value))
        return false;
      if (schema.format === "uuid" && !impactUuid(value)) return false;
      if (
        schema.format === "date-time" &&
        (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
          !Number.isFinite(Date.parse(value)))
      )
        return false;
      if (schema.format !== undefined && schema.format !== "uuid" && schema.format !== "date-time")
        return false;
      return true;
    }
    if (schema.type === "integer" || schema.type === "number") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (schema.type === "integer" && !Number.isSafeInteger(value))
      )
        return false;
      return !(
        (typeof schema.minimum === "number" && value < schema.minimum) ||
        (typeof schema.maximum === "number" && value > schema.maximum) ||
        (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) ||
        (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum)
      );
    }
    if (schema.type === "array")
      return (
        Array.isArray(value) &&
        !(typeof schema.minItems === "number" && value.length < schema.minItems) &&
        !(typeof schema.maxItems === "number" && value.length > schema.maxItems) &&
        value.every((item) => visit(item, schema.items, depth + 1))
      );
    if (schema.type === "object") {
      if (!record(value) || !record(schema.properties) || schema.additionalProperties !== false)
        return false;
      const props = schema.properties;
      return (
        (!Array.isArray(schema.required) ||
          schema.required.every((k) => typeof k === "string" && Object.hasOwn(value, k))) &&
        Object.keys(value).every(
          (k) => Object.hasOwn(props, k) && visit(value[k], props[k], depth + 1),
        )
      );
    }
    return false;
  }
  try {
    return (
      new TextEncoder().encode(impactCanonical(v)).byteLength <= 16 * 1024 * 1024 &&
      visit(v, definitions[name], 0)
    );
  } catch {
    return false;
  }
}
export function impactInput(v: unknown): v is ScriptConfirmationInput {
  return model(v, "CreateEpisodeScriptConfirmationRequest");
}
const strength = { advisory: 0, render_only: 1, blocking: 2 } as const;
export function impactReport(v: unknown, projectId: string): v is ScriptImpactReport {
  if (!model(v, "ScriptConfirmationImpactReportV1")) return false;
  const report = v as ScriptImpactReport;
  const a = report.assessment,
    old = a.old_confirmation,
    next = a.new_confirmation;
  if (
    a.project_id !== projectId ||
    next.project_id !== projectId ||
    next.episode_id !== a.episode_id ||
    report.created_at !== next.confirmed_at ||
    new TextEncoder().encode(impactCanonical(a)).byteLength > 12 * 1024 * 1024
  )
    return false;
  if (
    old &&
    (old.project_id !== projectId ||
      old.episode_id !== a.episode_id ||
      old.artifact_id !== next.artifact_id ||
      old.confirmation_id === next.confirmation_id)
  )
    return false;
  const kind = !old
    ? "BASELINE"
    : old.version_id === next.version_id && old.content_hash === next.content_hash
      ? "SAME_SOURCE"
      : "SOURCE_REPLACED";
  if (a.event_kind !== kind || (kind !== "SOURCE_REPLACED" && a.targets.length)) return false;
  let paths = 0,
    previous = "";
  return a.targets.every((target) => {
    const identity = `${target.artifact_id}/${target.version_id}`;
    if (!old || identity <= previous || (paths += target.reasons.length) > 10000) return false;
    previous = identity;
    const signatures = new Set<string>();
    if (
      !target.reasons.every((reason) => {
        const signature = impactCanonical(reason);
        if (signatures.has(signature)) return false;
        signatures.add(signature);
        if (reason.origin === "LEGACY_CONTENT_REFERENCE")
          return (
            reason.edges.length === 0 &&
            reason.effective_impact === "advisory" &&
            target.episode_id === a.episode_id &&
            target.context.kind === "ASSEMBLY" &&
            target.context.script_provenance === null &&
            target.context.segments.length > 0
          );
        const edges = reason.edges;
        if (
          !edges.length ||
          edges[0]?.downstream_version_id !== target.version_id ||
          edges[0].downstream_artifact_id !== target.artifact_id ||
          edges.at(-1)?.upstream_version_id !== old.version_id ||
          edges.at(-1)?.upstream_artifact_id !== old.artifact_id
        )
          return false;
        const nodes = new Set([target.version_id]);
        if (
          !edges.every((edge, index) => {
            if (
              edge.project_id !== projectId ||
              nodes.has(edge.upstream_version_id) ||
              (index &&
                (edges[index - 1]?.upstream_version_id !== edge.downstream_version_id ||
                  edges[index - 1]?.upstream_artifact_id !== edge.downstream_artifact_id))
            )
              return false;
            nodes.add(edge.upstream_version_id);
            return true;
          })
        )
          return false;
        return (
          strength[reason.effective_impact] ===
          Math.min(...edges.map((edge) => strength[edge.impact]))
        );
      })
    )
      return false;
    if (
      strength[target.aggregate_impact] !==
      Math.max(...target.reasons.map((r) => strength[r.effective_impact]))
    )
      return false;
    const classification = target.reasons.every((r) => r.origin === "LEGACY_CONTENT_REFERENCE")
      ? "ADVISORY_LEGACY_REVIEW"
      : target.aggregate_impact === "blocking"
        ? "SOURCE_SUPERSEDED"
        : "REVIEW_REQUIRED";
    if (target.classification !== classification) return false;
    const context = target.context;
    if (context.kind === "STORYBOARD")
      return target.artifact_type === "episode_storyboard" && target.episode_id !== null;
    if (context.kind === "OTHER")
      return !["episode_storyboard", "episode_media_assembly"].includes(target.artifact_type);
    if (target.artifact_type !== "episode_media_assembly" || target.episode_id === null)
      return false;
    const rate = context.sequence_timebase.frame_rate;
    if (
      ![
        [24000, 1001],
        [24, 1],
        [25, 1],
        [30000, 1001],
      ].some(([num, den]) => rate.num === num && rate.den === den) ||
      (context.sequence_timebase.timecode_mode === "DROP_FRAME" &&
        !(rate.num === 30000 && rate.den === 1001))
    )
      return false;
    const segmentIds = new Set<string>();
    return (
      context.segments.every((item) => {
        const segment = item.segment;
        if (
          segmentIds.has(segment.segment_id) ||
          segment.end_frame <= segment.start_frame ||
          item.script_content_hash !== old.content_hash
        )
          return false;
        segmentIds.add(segment.segment_id);
        if (item.kind === "TEXT_SUBTITLE")
          return (
            item.segment.script_ref?.script_version_id === old.version_id &&
            item.segment.script_ref.script_content_hash === old.content_hash
          );
        if (item.segment.script_version_id !== old.version_id) return false;
        return (
          item.kind !== "DIALOGUE_AUDIO" ||
          (item.segment.track_kind === "DIALOGUE" &&
            !!item.segment.script_block_id &&
            !!item.segment.speaker_id &&
            !!item.segment.delivery)
        );
      }) && context.storyboard_references.every((ref) => ref.end_frame > ref.start_frame)
    );
  });
}
export function impactPage(v: unknown, projectId: string): v is ScriptImpactPage {
  if (!model(v, "ScriptConfirmationImpactPageData")) return false;
  const page = v as ScriptImpactPage;
  return (
    page.project_id === projectId &&
    page.items.every((i) => i.project_id === projectId) &&
    new Set(page.items.map((i) => i.report_id)).size === page.items.length &&
    (!page.next_cursor || page.items.at(-1)?.report_id === page.next_cursor)
  );
}
export function impactOperation(
  v: unknown,
  projectId: string,
  episodeId: string,
  operationId: string,
  payload: ScriptConfirmationInput,
  trustedActor = "local-user",
): v is ScriptConfirmationOperation {
  if (!model(v, "ScriptConfirmationOperationData")) return false;
  const data = v as ScriptConfirmationOperation,
    c = data.lookup.confirmation;
  return (
    data.operation_id === operationId &&
    data.project_id === projectId &&
    data.episode_id === episodeId &&
    sameImpactValue(data.payload, payload) &&
    c.project_id === projectId &&
    c.episode_id === episodeId &&
    c.actor_id === trustedActor &&
    c.version_id === payload.version_id &&
    c.content_hash === payload.expected_content_hash &&
    c.head_revision === payload.expected_head_revision &&
    (data.lookup.coverage === "UNCOVERED_LEGACY"
      ? data.lookup.report === null
      : data.lookup.report !== null &&
        impactReport(data.lookup.report, projectId) &&
        sameImpactValue(data.lookup.report.assessment.new_confirmation, c))
  );
}
export function impactEnvelope(
  v: unknown,
  requestId: string | null,
): v is { data: unknown; request_id: string } {
  return (
    record(v) &&
    Object.keys(v).length === 2 &&
    Object.hasOwn(v, "data") &&
    impactUuid(v.request_id) &&
    v.request_id === requestId
  );
}
