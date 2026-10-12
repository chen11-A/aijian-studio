/** Closed visual/G5 boundaries. Hash computation is performed in trusted main. */
import { visualEnvironmentScope, visualEnvironmentProjection } from "./visual-environment.js";
export {
  visualEnvironmentScope,
  visualEnvironmentProjection,
  visualEnvironmentEvidenceMatches,
  visualEnvironmentChoicesWithinScope,
} from "./visual-environment.js";
const POLICY_SNAPSHOTS = {
  1: "sha256:3fc41a93028d6e11532d2896c6b9d16fbd4e56681b5f7a5999f99a12f0c7244d",
  2: "sha256:9507704a4dab6fcbe7b171fde7002ff7ce6296e765f85f9c86046daa734c5361",
};
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** @param {unknown} v @param {readonly string[]} keys @returns {v is Record<string, unknown>} */
const exact = (v, keys) =>
  record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
/** @param {unknown} v @param {string} prefix */
const id = (v, prefix) => typeof v === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(v);
/** @param {unknown} v */
const hash = (v) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
/** @param {unknown} v */
const rawHash = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
/** @param {unknown} v @param {number} max @param {boolean} [required] */
const text = (v, max, required = false) =>
  typeof v === "string" &&
  [...v].length <= max &&
  !/\p{Surrogate}/u.test(v) &&
  (!required || v.trim().length > 0);
/** @param {unknown} v @param {number} [min] @param {number} [max] */
const int = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
/** @param {unknown} v */
const date = (v) =>
  typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v));
/** @param {unknown} v @param {string} p */
const nullableId = (v, p) => v === null || id(v, p);
/** @param {unknown} v */
const unique = (v) => Array.isArray(v) && new Set(v).size === v.length;
/** @param {unknown} v */
export const visualProjectId = (v) => id(v, "prj");
/** @param {unknown} v */
export const visualVersionId = (v) => id(v, "ver");

/** @param {unknown} v @param {string} p @param {string | null} cursor @param {number} [limit] */
export function visualHistoryData(v, p, cursor, limit = 20) {
  if (
    !exact(v, ["project_id", "head", "cursor", "limit", "items", "next_cursor"]) ||
    v.project_id !== p ||
    !visualHead(v.head) ||
    !record(v.head) ||
    v.cursor !== cursor ||
    v.limit !== limit ||
    !int(limit, 1, 20) ||
    !Array.isArray(v.items) ||
    v.items.length > limit ||
    !nullableId(v.next_cursor, "ver")
  )
    return false;
  let previous = Number.MAX_SAFE_INTEGER;
  const ids = new Set();
  for (const item of v.items) {
    if (
      !exact(item, [
        "id",
        "artifact_id",
        "version_number",
        "content_hash",
        "parent_version_id",
        "creative_library_version_id",
        "creative_library_content_hash",
        "author_actor_id",
        "change_summary",
        "change_reason",
        "created_at",
      ]) ||
      !id(item.id, "ver") ||
      item.id === cursor ||
      ids.has(item.id) ||
      item.artifact_id !== v.head.artifact_id ||
      !int(item.version_number, 1, previous - 1) ||
      !hash(item.content_hash) ||
      !nullableId(item.parent_version_id, "ver") ||
      !id(item.creative_library_version_id, "ver") ||
      !hash(item.creative_library_content_hash) ||
      !text(item.author_actor_id, 240, true) ||
      !text(item.change_summary, 1000, true) ||
      !text(item.change_reason, 1000, true) ||
      !date(item.created_at)
    )
      return false;
    previous = Number(item.version_number);
    ids.add(item.id);
  }
  return (
    (cursor !== null || (v.items.length > 0 && v.items[0].id === v.head.latest_version_id)) &&
    (v.next_cursor === null || (v.items.length === limit && v.items.at(-1).id === v.next_cursor))
  );
}
/** @param {unknown} v */
export function visualAssetReference(v) {
  return (
    exact(v, ["asset_id", "asset_version_id", "sha256"]) &&
    id(v.asset_id, "asset") &&
    id(v.asset_version_id, "asv") &&
    rawHash(v.sha256)
  );
}
/** @param {unknown} v */
const assets = (v) =>
  Array.isArray(v) &&
  v.length <= 2000 &&
  v.every(visualAssetReference) &&
  new Set(v.map((x) => `${x.asset_id}:${x.asset_version_id}`)).size === v.length;
/** @param {unknown} v @param {string} p */
export function visualContent(v, p) {
  if (
    !record(v) ||
    !exact(v, [
      "schema_version",
      "project_id",
      "creative_library_version_id",
      "creative_library_content_hash",
      "character_reference_ids",
      "scenes",
      "props",
      "safe_area",
      "effective_scope",
      "change_reason",
      ...(v.schema_version === "1.1.0" ? ["environment_scope"] : []),
    ]) ||
    !["1.0.0", "1.1.0"].includes(String(v.schema_version)) ||
    (v.schema_version === "1.1.0" && !visualEnvironmentScope(v.environment_scope)) ||
    v.project_id !== p ||
    !visualProjectId(p) ||
    !id(v.creative_library_version_id, "ver") ||
    !hash(v.creative_library_content_hash) ||
    v.effective_scope !== "PROJECT" ||
    !text(v.change_reason, 1000, true) ||
    !Array.isArray(v.character_reference_ids) ||
    v.character_reference_ids.length > 2000 ||
    !unique(v.character_reference_ids) ||
    !v.character_reference_ids.every((x) => id(x, "crf")) ||
    !Array.isArray(v.scenes) ||
    v.scenes.length > 500 ||
    !Array.isArray(v.props) ||
    v.props.length > 2000
  )
    return false;
  if (
    !v.scenes.every(
      (x) => exact(x, ["scene_id", "assets"]) && id(x.scene_id, "loc") && assets(x.assets),
    ) ||
    new Set(v.scenes.map((x) => x.scene_id)).size !== v.scenes.length ||
    !v.props.every(
      (x, i) =>
        exact(x, ["prop_id", "ordinal", "name", "description", "assets"]) &&
        id(x.prop_id, "prop") &&
        x.ordinal === i + 1 &&
        text(x.name, 120, true) &&
        text(x.description, 20000) &&
        assets(x.assets),
    ) ||
    new Set(v.props.map((x) => x.prop_id)).size !== v.props.length
  )
    return false;
  const a = v.safe_area;
  return (
    exact(a, ["canvas_width", "canvas_height", "x", "y", "width", "height"]) &&
    int(a.canvas_width, 9, 32768) &&
    int(a.canvas_height, 16, 32768) &&
    int(a.x) &&
    int(a.y) &&
    int(a.width, 1) &&
    int(a.height, 1) &&
    Number(a.canvas_width) * 16 === Number(a.canvas_height) * 9 &&
    Number(a.x) + Number(a.width) <= Number(a.canvas_width) &&
    Number(a.y) + Number(a.height) <= Number(a.canvas_height)
  );
}
/** @param {unknown} v @param {string} p */
export function visualWriteInput(v, p) {
  return (
    exact(v, ["content", "parent_version_id", "expected_revision", "change_summary"]) &&
    visualContent(v.content, p) &&
    nullableId(v.parent_version_id, "ver") &&
    (v.parent_version_id === null
      ? v.expected_revision === null
      : int(v.expected_revision, 1, Number.MAX_SAFE_INTEGER - 1)) &&
    text(v.change_summary, 1000, true)
  );
}
/** @param {unknown} v */
export function visualReviewInput(v) {
  if (
    !exact(v, ["action", "roles", "decision", "rationale", "readiness_report_id"]) ||
    !Array.isArray(v.roles) ||
    !unique(v.roles) ||
    !v.roles.every((x) => x === "continuity_reviewer" || x === "producer") ||
    !nullableId(v.readiness_report_id, "rpt")
  )
    return false;
  if (v.action === "submit")
    return (
      v.roles.length === 0 &&
      v.decision === null &&
      v.rationale === null &&
      v.readiness_report_id === null
    );
  if (v.action === "signoff")
    return v.roles.length > 0 && v.decision === null && v.rationale === null;
  return (
    v.action === "decision" &&
    v.roles.length === 0 &&
    (v.decision === "approved" || v.decision === "rejected") &&
    text(v.rationale, 1000, true) &&
    typeof v.rationale === "string" &&
    v.rationale.trim() === v.rationale
  );
}
/** @param {unknown} v */
export function visualHead(v) {
  return (
    exact(v, [
      "artifact_id",
      "latest_version_id",
      "review_version_id",
      "review_submission_id",
      "accepted_version_id",
      "revision",
      "review_evidence_revision",
      "updated_at",
    ]) &&
    id(v.artifact_id, "art") &&
    id(v.latest_version_id, "ver") &&
    nullableId(v.review_version_id, "ver") &&
    nullableId(v.review_submission_id, "sub") &&
    nullableId(v.accepted_version_id, "ver") &&
    (v.review_version_id === null) === (v.review_submission_id === null) &&
    int(v.revision, 1) &&
    int(v.review_evidence_revision) &&
    date(v.updated_at)
  );
}
/** @param {unknown} v @param {string} p */
export function visualVersion(v, p) {
  return (
    exact(v, [
      "id",
      "artifact_id",
      "version_number",
      "content",
      "content_hash",
      "parent_version_id",
      "author_actor_id",
      "change_summary",
      "created_at",
    ]) &&
    id(v.id, "ver") &&
    id(v.artifact_id, "art") &&
    int(v.version_number, 1) &&
    visualContent(v.content, p) &&
    hash(v.content_hash) &&
    nullableId(v.parent_version_id, "ver") &&
    text(v.author_actor_id, 240, true) &&
    text(v.change_summary, 1000, true) &&
    date(v.created_at)
  );
}
/** @param {unknown} v @param {string} p */
export function visualReadData(v, p) {
  return (
    exact(v, ["project_id", "head", "version"]) &&
    v.project_id === p &&
    visualHead(v.head) &&
    visualVersion(v.version, p) &&
    record(v.head) &&
    record(v.version) &&
    v.head.artifact_id === v.version.artifact_id
  );
}
/** @param {unknown} v @param {string} p */
export function visualIndexData(v, p) {
  if (
    !exact(v, ["project_id", "head", "latest_version", "review_version", "accepted_version"]) ||
    v.project_id !== p ||
    !visualHead(v.head) ||
    !visualVersion(v.latest_version, p) ||
    !record(v.head) ||
    !record(v.latest_version) ||
    v.latest_version.id !== v.head.latest_version_id ||
    v.latest_version.artifact_id !== v.head.artifact_id
  )
    return false;
  return [
    [v.review_version, v.head.review_version_id],
    [v.accepted_version, v.head.accepted_version_id],
  ].every(([version, pin]) =>
    version === null
      ? pin === null
      : visualVersion(version, p) &&
        record(version) &&
        version.id === pin &&
        record(v.head) &&
        version.artifact_id === v.head.artifact_id,
  );
}
/** @param {unknown} v @param {string} [requestId] */
export function visualEnvelope(v, requestId) {
  return (
    exact(v, ["data", "request_id"]) &&
    typeof v.request_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.request_id) &&
    (requestId === undefined || requestId === v.request_id)
  );
}
/** @param {unknown} v @param {unknown} versionId */
function visualReadinessReport(v, versionId) {
  return (
    record(v) &&
    ["1", "2"].includes(String(v.policy_version)) &&
    exact(v, [
      "ready",
      "blocking",
      "version_id",
      "content_hash",
      "creative_library_version_id",
      "creative_library_content_hash",
      "effective_scope",
      "props_declared_empty",
      "originals",
      "policy_code",
      "policy_version",
      "policy_snapshot_hash",
      ...(v.policy_version === "2" ? ["environment_projection"] : []),
    ]) &&
    (v.policy_version !== "2" || visualEnvironmentProjection(v.environment_projection)) &&
    v.version_id === versionId &&
    hash(v.content_hash) &&
    id(v.creative_library_version_id, "ver") &&
    hash(v.creative_library_content_hash) &&
    v.effective_scope === "PROJECT" &&
    typeof v.props_declared_empty === "boolean" &&
    v.policy_code === "g5.visual-bible" &&
    Array.isArray(v.originals) &&
    v.originals.length <= 6000 &&
    v.originals.every(
      (x) =>
        exact(x, [
          "asset_id",
          "asset_version_id",
          "sha256",
          "byte_size",
          "rights_decision_id",
          "rights_revision",
          "rights_evidence_sha256",
          "technical_evidence_hash",
        ]) &&
        id(x.asset_id, "asset") &&
        id(x.asset_version_id, "asv") &&
        rawHash(x.sha256) &&
        int(x.byte_size, 1) &&
        nullableId(x.rights_decision_id, "ard") &&
        int(x.rights_revision) &&
        (x.rights_evidence_sha256 === null || rawHash(x.rights_evidence_sha256)) &&
        (x.technical_evidence_hash === null || hash(x.technical_evidence_hash)),
    ) &&
    typeof v.ready === "boolean" &&
    Array.isArray(v.blocking) &&
    v.blocking.every((x) => text(x, 500, true)) &&
    v.policy_snapshot_hash === POLICY_SNAPSHOTS[String(v.policy_version)]
  );
}
/** @param {unknown} v */
export function visualReport(v) {
  return (
    exact(v, [
      "id",
      "artifact_id",
      "version_id",
      "gate",
      "submission_id",
      "policy_code",
      "policy_version",
      "head_revision",
      "review_evidence_revision",
      "report",
      "report_hash",
      "expires_at",
      "created_at",
    ]) &&
    id(v.id, "rpt") &&
    id(v.artifact_id, "art") &&
    id(v.version_id, "ver") &&
    v.gate === "G5" &&
    nullableId(v.submission_id, "sub") &&
    v.policy_code === "g5.visual-bible" &&
    ["1", "2"].includes(String(v.policy_version)) &&
    int(v.head_revision, 1) &&
    int(v.review_evidence_revision) &&
    visualReadinessReport(v.report, v.version_id) &&
    record(v.report) &&
    v.report.policy_version === v.policy_version &&
    hash(v.report_hash) &&
    date(v.expires_at) &&
    date(v.created_at)
  );
}
/** @param {unknown} v */
export function visualChallenge(v) {
  return (
    exact(v, [
      "id",
      "artifact_id",
      "version_id",
      "gate",
      "action",
      "readiness_report_id",
      "head_revision",
      "review_evidence_revision",
      "expires_at",
      "consumed_at",
      "created_at",
    ]) &&
    id(v.id, "chg") &&
    id(v.artifact_id, "art") &&
    id(v.version_id, "ver") &&
    v.gate === "G5" &&
    ["submit", "signoff", "decision"].includes(String(v.action)) &&
    id(v.readiness_report_id, "rpt") &&
    int(v.head_revision, 1) &&
    int(v.review_evidence_revision) &&
    date(v.expires_at) &&
    (v.consumed_at === null || date(v.consumed_at)) &&
    date(v.created_at)
  );
}
/** @param {unknown} v */
export function visualPreparedData(v) {
  return (
    exact(v, ["report", "challenge", "confirmation_token"]) &&
    visualReport(v.report) &&
    visualChallenge(v.challenge) &&
    record(v.report) &&
    record(v.challenge) &&
    v.report.id === v.challenge.readiness_report_id &&
    v.report.artifact_id === v.challenge.artifact_id &&
    v.report.version_id === v.challenge.version_id &&
    v.report.review_evidence_revision === v.challenge.review_evidence_revision &&
    v.challenge.consumed_at === null &&
    text(v.confirmation_token, 256, true) &&
    typeof v.confirmation_token === "string" &&
    v.confirmation_token.length >= 20
  );
}
/** @param {unknown} v @param {string} p @param {string} versionId */
export function visualOperationData(v, p, versionId) {
  if (
    !exact(v, [
      "project_id",
      "content_hash",
      "challenge",
      "action_payload_hash",
      "actor_id",
      "actor_roles",
      "policy_snapshot_hash",
      "report",
      "state",
      "terminal_no_write",
      "result_revision",
      "head",
      "submission",
      "signoffs",
      "decision",
    ]) ||
    v.project_id !== p ||
    !hash(v.content_hash) ||
    !visualChallenge(v.challenge) ||
    !visualReport(v.report) ||
    !visualHead(v.head) ||
    !record(v.challenge) ||
    !record(v.report) ||
    !record(v.head) ||
    v.challenge.version_id !== versionId ||
    v.report.version_id !== versionId ||
    v.challenge.artifact_id !== v.head.artifact_id ||
    v.report.artifact_id !== v.head.artifact_id ||
    v.challenge.readiness_report_id !== v.report.id ||
    !hash(v.action_payload_hash) ||
    !hash(v.policy_snapshot_hash) ||
    !record(v.report.report) ||
    v.policy_snapshot_hash !== v.report.report.policy_snapshot_hash ||
    !text(v.actor_id, 240, true) ||
    !Array.isArray(v.actor_roles) ||
    !unique(v.actor_roles) ||
    !v.actor_roles.every((x) => ["writer", "continuity_reviewer", "producer"].includes(x)) ||
    typeof v.terminal_no_write !== "boolean" ||
    !Array.isArray(v.signoffs) ||
    v.signoffs.length > 2
  )
    return false;
  const challenge = v.challenge;
  const report = v.report;
  if (v.state === "NOT_CONSUMED")
    return (
      challenge.consumed_at === null &&
      v.result_revision === null &&
      v.submission === null &&
      v.signoffs.length === 0 &&
      v.decision === null
    );
  if (
    v.terminal_no_write !== false ||
    v.state !== "COMPLETED" ||
    !date(challenge.consumed_at) ||
    v.result_revision !== Number(challenge.head_revision) + 1
  )
    return false;
  /** @param {unknown} x */
  const bound = (x) =>
    record(x) &&
    x.artifact_id === challenge.artifact_id &&
    x.version_id === versionId &&
    x.gate === "G5" &&
    x.readiness_report_id === report.id;
  if (challenge.action === "submit")
    return (
      v.decision === null &&
      v.signoffs.length === 0 &&
      exact(v.submission, [
        "id",
        "artifact_id",
        "version_id",
        "gate",
        "readiness_report_id",
        "supersedes_submission_id",
        "submitted_by_actor_id",
        "submitted_at",
      ]) &&
      bound(v.submission) &&
      id(v.submission.id, "sub") &&
      nullableId(v.submission.supersedes_submission_id, "sub") &&
      v.submission.submitted_by_actor_id === v.actor_id &&
      date(v.submission.submitted_at)
    );
  if (challenge.action === "signoff")
    return (
      v.submission === null &&
      v.decision === null &&
      v.signoffs.length > 0 &&
      new Set(v.signoffs.map((x) => x.role)).size === v.signoffs.length &&
      v.signoffs.every(
        (x) =>
          exact(x, [
            "id",
            "artifact_id",
            "version_id",
            "submission_id",
            "gate",
            "role",
            "actor_id",
            "review_evidence_revision",
            "readiness_report_id",
            "self_review",
            "supersedes_signoff_id",
            "signed_at",
          ]) &&
          bound(x) &&
          id(x.id, "sig") &&
          id(x.submission_id, "sub") &&
          ["continuity_reviewer", "producer"].includes(String(x.role)) &&
          x.actor_id === v.actor_id &&
          x.review_evidence_revision === report.review_evidence_revision &&
          typeof x.self_review === "boolean" &&
          nullableId(x.supersedes_signoff_id, "sig") &&
          date(x.signed_at),
      )
    );
  return (
    v.submission === null &&
    v.signoffs.length === 0 &&
    exact(v.decision, [
      "id",
      "artifact_id",
      "version_id",
      "submission_id",
      "gate",
      "decision",
      "readiness_report_id",
      "actor_id",
      "actor_role",
      "self_review",
      "rationale",
      "decided_at",
    ]) &&
    bound(v.decision) &&
    id(v.decision.id, "dec") &&
    id(v.decision.submission_id, "sub") &&
    ["approved", "rejected"].includes(String(v.decision.decision)) &&
    v.decision.actor_id === v.actor_id &&
    v.decision.actor_role === "producer" &&
    typeof v.decision.self_review === "boolean" &&
    text(v.decision.rationale, 1000, true) &&
    date(v.decision.decided_at)
  );
}

/** Match the persisted outcome as well as the original challenge's payload hash.
 * @param {unknown} input @param {unknown} result
 */
export function visualActionOutcomeMatches(input, result) {
  if (
    !visualReviewInput(input) ||
    !record(input) ||
    !record(result) ||
    typeof result.project_id !== "string" ||
    !record(result.challenge) ||
    typeof result.challenge.version_id !== "string" ||
    !visualOperationData(result, result.project_id, result.challenge.version_id) ||
    result.challenge.action !== input.action ||
    (input.readiness_report_id !== null &&
      (!record(result.report) || result.report.id !== input.readiness_report_id))
  )
    return false;
  if (result.state === "NOT_CONSUMED") return true;
  if (input.action === "decision")
    return (
      record(result.decision) &&
      result.decision.decision === input.decision &&
      result.decision.rationale === input.rationale &&
      result.decision.actor_role === "producer"
    );
  const roles = input.roles;
  if (input.action === "signoff")
    return (
      Array.isArray(roles) &&
      Array.isArray(result.signoffs) &&
      result.signoffs.length === roles.length &&
      result.signoffs.every((s) => record(s) && roles.includes(s.role))
    );
  return input.action === "submit";
}

/** Bind settlement to the existing native local review subject, never a renderer choice.
 * @param {unknown} result
 */
export function visualLocalReviewActorMatches(result) {
  const roles = ["writer", "continuity_reviewer", "producer"];
  return (
    record(result) &&
    result.actor_id === "local-user" &&
    Array.isArray(result.actor_roles) &&
    result.actor_roles.length === roles.length &&
    result.actor_roles.every((role, i) => role === roles[i])
  );
}

/** @param {unknown} v @param {string} p @param {string} versionId */
export function visualReadinessData(v, p, versionId) {
  return (
    exact(v, ["project_id", "version_id", "content_hash", "head", "report", "report_hash"]) &&
    v.project_id === p &&
    v.version_id === versionId &&
    hash(v.content_hash) &&
    visualHead(v.head) &&
    visualReadinessReport(v.report, versionId) &&
    record(v.report) &&
    hash(v.report_hash) &&
    v.report.content_hash === v.content_hash
  );
}
/** @param {unknown} v @param {string} p @param {string} versionId */
export function visualAuthorityData(v, p, versionId) {
  return (
    exact(v, [
      "project_id",
      "version_id",
      "content_hash",
      "status",
      "gate_decision_id",
      "blocking",
    ]) &&
    v.project_id === p &&
    v.version_id === versionId &&
    hash(v.content_hash) &&
    ["CURRENT", "SUPERSEDED", "UNAPPROVED", "EVIDENCE_CHANGED", "UNAVAILABLE"].includes(
      String(v.status),
    ) &&
    nullableId(v.gate_decision_id, "dec") &&
    Array.isArray(v.blocking) &&
    v.blocking.every((x) => text(x, 500, true)) &&
    (v.status !== "CURRENT" || (v.blocking.length === 0 && id(v.gate_decision_id, "dec")))
  );
}
/** @param {unknown} v @param {string} p */
export function visualInspectionData(v, p) {
  if (
    !exact(v, [
      "id",
      "project_id",
      "asset_id",
      "asset_version_id",
      "actor_id",
      "evidence",
      "evidence_hash",
      "created_at",
    ]) ||
    !id(v.id, "vin") ||
    v.project_id !== p ||
    !id(v.asset_id, "asset") ||
    !id(v.asset_version_id, "asv") ||
    !text(v.actor_id, 240, true) ||
    !hash(v.evidence_hash) ||
    !date(v.created_at)
  )
    return false;
  const e = v.evidence;
  return (
    exact(e, [
      "operation_id",
      "asset_sha256",
      "byte_size",
      "mime_type",
      "width",
      "height",
      "pixel_sha256",
      "decoder",
      "decoder_version",
    ]) &&
    id(e.operation_id, "vinop") &&
    rawHash(e.asset_sha256) &&
    int(e.byte_size, 1, 33554432) &&
    ["image/png", "image/jpeg", "image/webp"].includes(String(e.mime_type)) &&
    int(e.width, 1, 32768) &&
    int(e.height, 1, 32768) &&
    Number(e.width) * Number(e.height) <= 16777216 &&
    rawHash(e.pixel_sha256) &&
    e.decoder === "ELECTRON_NATIVE_IMAGE" &&
    text(e.decoder_version, 120, true)
  );
}
/** @param {unknown} v @param {string} p */
export function visualSaveOperationData(v, p) {
  return (
    exact(v, ["idempotency_key_hash", "request_hash", "result"]) &&
    hash(v.idempotency_key_hash) &&
    hash(v.request_hash) &&
    visualReadData(v.result, p)
  );
}
/** @param {unknown} v @param {string} p @param {string} versionId */
export function visualReviewStateData(v, p, versionId) {
  if (
    !exact(v, ["project_id", "version_id", "content_hash", "head", "signoffs", "reports"]) ||
    v.project_id !== p ||
    v.version_id !== versionId ||
    !hash(v.content_hash) ||
    !visualHead(v.head) ||
    !record(v.head) ||
    !Array.isArray(v.signoffs) ||
    v.signoffs.length > 2000 ||
    !Array.isArray(v.reports) ||
    v.reports.length > 2000
  )
    return false;
  const head = v.head;
  const reports = v.reports;
  if (
    !reports.every(
      (x) =>
        visualReport(x) &&
        record(x) &&
        x.version_id === versionId &&
        x.artifact_id === head.artifact_id,
    ) ||
    new Set(reports.map((x) => x.id)).size !== reports.length
  )
    return false;
  return (
    v.signoffs.every(
      (x) =>
        exact(x, [
          "id",
          "artifact_id",
          "version_id",
          "submission_id",
          "gate",
          "role",
          "actor_id",
          "review_evidence_revision",
          "readiness_report_id",
          "self_review",
          "supersedes_signoff_id",
          "signed_at",
        ]) &&
        id(x.id, "sig") &&
        x.artifact_id === head.artifact_id &&
        x.version_id === versionId &&
        id(x.submission_id, "sub") &&
        x.gate === "G5" &&
        ["continuity_reviewer", "producer"].includes(String(x.role)) &&
        text(x.actor_id, 240, true) &&
        int(x.review_evidence_revision) &&
        reports.some(
          (r) =>
            r.id === x.readiness_report_id &&
            r.review_evidence_revision === x.review_evidence_revision,
        ) &&
        typeof x.self_review === "boolean" &&
        nullableId(x.supersedes_signoff_id, "sig") &&
        date(x.signed_at),
    ) && new Set(v.signoffs.map((x) => x.id)).size === v.signoffs.length
  );
}
/** @param {unknown} v @returns {string} */
export function visualJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(visualJson).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${visualJson(/** @type {Record<string,unknown>} */ (v)[k])}`)
    .join(",")}}`;
}
/** @param {unknown} v */
export function visualTicketData(v) {
  return (
    exact(v, [
      "project_id",
      "version_id",
      "content_hash",
      "expected_revision",
      "challenge_id",
      "report_id",
      "report_hash",
      "input",
    ]) &&
    visualProjectId(v.project_id) &&
    visualVersionId(v.version_id) &&
    hash(v.content_hash) &&
    int(v.expected_revision, 1, Number.MAX_SAFE_INTEGER - 1) &&
    id(v.challenge_id, "chg") &&
    id(v.report_id, "rpt") &&
    hash(v.report_hash) &&
    visualReviewInput(v.input)
  );
}
