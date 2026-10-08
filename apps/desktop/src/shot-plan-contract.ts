import { createHash } from "node:crypto";
import type { components } from "@aijian/contracts";
import type {
  HumanShotPlanRequest,
  ShotPlanAdoption,
  ShotPlanAdoptionRequest,
  ShotPlanContent,
  ShotPlanProposal,
} from "@aijian/contracts/shot-plan";
import { hasRequestId, isRecord } from "./api-contract-guards";
import {
  episodeScriptDefiniteError,
  isEpisodeScriptContent,
  isEpisodeScriptEpisodeId,
  isEpisodeScriptProjectId,
  isEpisodeScriptVersionId,
} from "./episode-script-contract";
import { normalizeProductionBriefCreateCommand } from "./production-brief-contract";

export type { ShotPlanGateway } from "@aijian/contracts/shot-plan";
export const SHOT_PLAN_CHANNELS = Object.freeze({
  prepare: "shot-plan:prepare",
  latest: "shot-plan:latest",
  version: "shot-plan:version",
  writeStatus: "shot-plan:write-status",
  adoptionStatus: "shot-plan:adoption-status",
  create: "shot-plan:create-human",
  adopt: "shot-plan:adopt-human",
} as const);
export const isShotPlanProjectId = isEpisodeScriptProjectId;
export const isShotPlanEpisodeId = isEpisodeScriptEpisodeId;
export const isShotPlanVersionId = isEpisodeScriptVersionId;
// Server/storage ambiguity must not turn into automatic mutation retries.
export const shotPlanDefiniteError = episodeScriptDefiniteError;

const HASH = /^sha256:[0-9a-f]{64}$/;
const SHOT = /^shp_[0-9a-f]{32}$/;
const SCENE = /^scn_[0-9a-f]{32}$/;
const BLOCK = /^sblk_[0-9a-f]{32}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CONTENT_BYTES = 2_000_000;
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function id(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}
function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function text(value: unknown, max = 4_000): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= max &&
    !value.includes("\0") &&
    Buffer.from(value, "utf8").toString("utf8") === value
  );
}
function array(value: unknown, max: number, min = 0): value is unknown[] {
  return (
    Array.isArray(value) &&
    value.length >= min &&
    value.length <= max &&
    Array.from(value).every((item) => item !== undefined)
  );
}
function unique(value: unknown[]): boolean {
  return new Set(value).size === value.length;
}
function subset(value: unknown[], of: unknown[]): boolean {
  return value.every((item) => of.includes(item));
}
function date(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key])]),
  );
}
function canonical(value: unknown): string {
  return JSON.stringify(sorted(value));
}
function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}
// Reject non-JSON values, holes, cycles, malformed Unicode and deep renderer objects before hashing.
function json(value: unknown, ancestors = new Set<object>(), depth = 0): boolean {
  if (depth > 20) return false;
  if (typeof value === "string")
    return !value.includes("\0") && Buffer.from(value, "utf8").toString("utf8") === value;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false;
  ancestors.add(value);
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(value)).every((item) =>
    json(item, ancestors, depth + 1),
  );
  ancestors.delete(value);
  return valid;
}
function versionPin(
  value: unknown,
  extra: readonly string[] = [],
): value is Record<string, unknown> {
  return (
    exact(value, ["version_id", "content_hash", ...extra]) &&
    isShotPlanVersionId(value.version_id) &&
    id(value.content_hash, HASH)
  );
}
function storyboardBase(value: unknown): boolean {
  return value === null || (versionPin(value, ["head_revision"]) && integer(value.head_revision));
}
function authority(value: unknown): value is ShotPlanContent["authority"] {
  if (
    !isRecord(value) ||
    !versionPin(value.script, ["confirmation_id", "head_revision"]) ||
    !id(value.script.confirmation_id, /^esc_[0-9a-f]{32}$/) ||
    !integer(value.script.head_revision) ||
    !versionPin(value.production_brief)
  )
    return false;
  if (value.mode === "ORIGINAL") return exact(value, ["mode", "script", "production_brief"]);
  return (
    value.mode === "ADAPTED" &&
    exact(value, [
      "mode",
      "script",
      "production_brief",
      "source_extraction",
      "source_proposal_acceptance_id",
      "source_span_ids",
    ]) &&
    versionPin(value.source_extraction) &&
    id(value.source_proposal_acceptance_id, /^pda_[0-9a-f]{32}$/) &&
    array(value.source_span_ids, 10_000, 1) &&
    unique(value.source_span_ids) &&
    value.source_span_ids.every((span) => id(span, /^spn_[0-9a-f]{32}$/))
  );
}
function timebase(value: unknown): boolean {
  if (!exact(value, ["frame_rate", "timecode_mode"]) || !exact(value.frame_rate, ["num", "den"]))
    return false;
  const { num, den } = value.frame_rate;
  const supported =
    ((num === 24 || num === 25) && den === 1) ||
    ((num === 24_000 || num === 30_000) && den === 1_001);
  return (
    supported &&
    (value.timecode_mode === "NON_DROP_FRAME" ||
      (value.timecode_mode === "DROP_FRAME" && num === 30_000 && den === 1_001))
  );
}
function shot(value: unknown, ordinal: number): boolean {
  if (
    !exact(value, [
      "shot_id",
      "ordinal",
      "script_scene_id",
      "script_block_ids",
      "title",
      "narrative_purpose",
      "coverage",
      "framing",
      "composition",
      "performance",
      "movement",
      "start_state",
      "end_state",
      "duration_frames",
      "handle_in_frames",
      "handle_out_frames",
      "safe_cut_window",
      "rhythm",
      "sound_intent",
      "dialogue_block_ids",
    ]) ||
    !id(value.shot_id, SHOT) ||
    value.ordinal !== ordinal ||
    !id(value.script_scene_id, SCENE) ||
    !array(value.script_block_ids, 500, 1) ||
    !unique(value.script_block_ids) ||
    !value.script_block_ids.every((block) => id(block, BLOCK)) ||
    !array(value.dialogue_block_ids, 500) ||
    !unique(value.dialogue_block_ids) ||
    !subset(value.dialogue_block_ids, value.script_block_ids) ||
    !text(value.title, 240) ||
    !array(value.coverage, 5, 1) ||
    !unique(value.coverage) ||
    !value.coverage.every(
      (entry) =>
        typeof entry === "string" &&
        ["ACTION", "DIALOGUE", "ESTABLISHING", "REACTION", "TRANSITION"].includes(entry),
    ) ||
    typeof value.framing !== "string" ||
    !["EXTREME_WIDE", "WIDE", "MEDIUM", "CLOSE_UP", "EXTREME_CLOSE_UP"].includes(value.framing) ||
    ![
      value.narrative_purpose,
      value.composition,
      value.performance,
      value.start_state,
      value.end_state,
      value.rhythm,
      value.sound_intent,
    ].every((entry) => text(entry)) ||
    !exact(value.movement, ["subject", "environment", "camera"]) ||
    !text(value.movement.subject) ||
    !text(value.movement.environment) ||
    !text(value.movement.camera, 160) ||
    !integer(value.duration_frames, 1, 864_000) ||
    !integer(value.handle_in_frames, 0, 864_000) ||
    !integer(value.handle_out_frames, 0, 864_000) ||
    !exact(value.safe_cut_window, ["start_frame", "end_frame"]) ||
    !integer(value.safe_cut_window.start_frame, 0, 864_000) ||
    !integer(value.safe_cut_window.end_frame, 1, 864_000)
  )
    return false;
  return (
    value.handle_in_frames + value.handle_out_frames < value.duration_frames &&
    value.safe_cut_window.start_frame >= value.handle_in_frames &&
    value.safe_cut_window.end_frame <= value.duration_frames - value.handle_out_frames &&
    value.safe_cut_window.end_frame > value.safe_cut_window.start_frame
  );
}
function issues(value: unknown, shotIds: Set<unknown>): boolean {
  return (
    array(value, 1_000) &&
    value.every(
      (issue) =>
        exact(issue, ["code", "severity", "shot_id", "message"]) &&
        id(issue.code, /^[A-Z][A-Z0-9_]{0,79}$/) &&
        (issue.severity === "WARNING" || issue.severity === "BLOCKING") &&
        (issue.shot_id === null || (id(issue.shot_id, SHOT) && shotIds.has(issue.shot_id))) &&
        text(issue.message),
    )
  );
}
export function isShotPlanOperationId(value: unknown): value is string {
  return id(value, UUID_V4);
}
export function isShotPlanContent(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is ShotPlanContent {
  if (
    !isShotPlanProjectId(projectId) ||
    !isShotPlanEpisodeId(episodeId) ||
    !json(value) ||
    !exact(value, [
      "schema_version",
      "provenance",
      "project_id",
      "episode_id",
      "authority",
      "storyboard_base",
      "timebase",
      "visual_constraints",
      "shots",
      "issues",
    ]) ||
    value.schema_version !== "1.0.0" ||
    value.provenance !== "HUMAN" ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId ||
    !authority(value.authority) ||
    !storyboardBase(value.storyboard_base) ||
    !timebase(value.timebase) ||
    !array(value.visual_constraints, 32) ||
    !unique(value.visual_constraints) ||
    !value.visual_constraints.every((constraint) => text(constraint)) ||
    !array(value.shots, 1_000, 1) ||
    !value.shots.every((item, index) => shot(item, index + 1))
  )
    return false;
  const ids = new Set(value.shots.map((item) => (isRecord(item) ? item.shot_id : null)));
  return (
    ids.size === value.shots.length &&
    issues(value.issues, ids) &&
    Buffer.byteLength(canonical(value), "utf8") <= MAX_CONTENT_BYTES
  );
}
export function isHumanShotPlanRequest(
  value: unknown,
  projectId: string,
  episodeId: string,
): value is HumanShotPlanRequest {
  return (
    exact(value, ["content", "parent_version_id", "expected_revision", "change_summary"]) &&
    isShotPlanContent(value.content, projectId, episodeId) &&
    (value.parent_version_id === null || isShotPlanVersionId(value.parent_version_id)) &&
    (value.expected_revision === null || integer(value.expected_revision)) &&
    (value.parent_version_id === null) === (value.expected_revision === null) &&
    text(value.change_summary, 240)
  );
}
export function isShotPlanAdoptionRequest(value: unknown): value is ShotPlanAdoptionRequest {
  return (
    exact(value, ["proposal_content_hash", "confirm"]) &&
    id(value.proposal_content_hash, HASH) &&
    value.confirm === true
  );
}
function adoption(
  value: unknown,
  versionId: string,
  contentHash?: string,
): value is ShotPlanAdoption {
  return (
    exact(value, [
      "proposal_version_id",
      "proposal_content_hash",
      "storyboard_version_id",
      "storyboard_content_hash",
      "actor_id",
      "adopted_at",
    ]) &&
    value.proposal_version_id === versionId &&
    id(value.proposal_content_hash, HASH) &&
    (contentHash === undefined || value.proposal_content_hash === contentHash) &&
    isShotPlanVersionId(value.storyboard_version_id) &&
    id(value.storyboard_content_hash, HASH) &&
    text(value.actor_id, 240) &&
    date(value.adopted_at)
  );
}
function proposal(
  value: unknown,
  projectId: string,
  episodeId: string,
  versionId?: string,
): value is ShotPlanProposal {
  if (
    !exact(value, [
      "version_id",
      "content_hash",
      "version_number",
      "head_revision",
      "parent_version_id",
      "content",
      "author_actor_id",
      "created_at",
      "generation_status",
      "capability_losses",
      "adoption",
    ]) ||
    !isShotPlanVersionId(value.version_id) ||
    (versionId !== undefined && value.version_id !== versionId) ||
    !integer(value.version_number) ||
    !integer(value.head_revision) ||
    value.head_revision < value.version_number ||
    !(value.parent_version_id === null || isShotPlanVersionId(value.parent_version_id)) ||
    (value.parent_version_id === null) !== (value.version_number === 1) ||
    !isShotPlanContent(value.content, projectId, episodeId) ||
    value.content_hash !== hash(value.content) ||
    !text(value.author_actor_id, 240) ||
    !date(value.created_at) ||
    value.generation_status !== "UNAVAILABLE"
  )
    return false;
  const ids = new Set(value.content.shots.map((item) => item.shot_id));
  return (
    issues(value.capability_losses, ids) &&
    (value.adoption === null || adoption(value.adoption, value.version_id, value.content_hash))
  );
}
function envelope(value: unknown, requestId: string | null): value is Record<string, unknown> {
  return (
    json(value) &&
    exact(value, ["data", "request_id"]) &&
    hasRequestId(value) &&
    value.request_id === requestId
  );
}
function known(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function normalizeStoredScript(value: unknown, projectId: string, episodeId: string): unknown {
  if (
    !known(
      value,
      ["project_id", "episode_id"],
      [
        "schema_version",
        "production_brief_version_id",
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
        "scenes",
      ],
    ) ||
    value.project_id !== projectId ||
    value.episode_id !== episodeId
  )
    return null;
  const scenes = Object.hasOwn(value, "scenes") ? value.scenes : [];
  if (!array(scenes, 1_000)) return null;
  const normalizedScenes = [];
  for (const scene of scenes) {
    if (!known(scene, ["scene_id", "ordinal", "heading"], ["blocks"])) return null;
    const blocks = Object.hasOwn(scene, "blocks") ? scene.blocks : [];
    if (!array(blocks, 500)) return null;
    const normalizedBlocks = [];
    for (const block of blocks) {
      if (!known(block, ["block_id", "ordinal", "kind", "text"], ["speaker", "delivery"]))
        return null;
      normalizedBlocks.push({
        ...block,
        speaker: block.speaker ?? null,
        delivery: block.delivery ?? null,
      });
    }
    normalizedScenes.push({ ...scene, blocks: normalizedBlocks });
  }
  return {
    ...value,
    schema_version: Object.hasOwn(value, "schema_version") ? value.schema_version : "1.0.0",
    production_brief_version_id: value.production_brief_version_id ?? null,
    story_bible_version_id: value.story_bible_version_id ?? null,
    source_extraction_version_id: value.source_extraction_version_id ?? null,
    source_proposal_acceptance_id: value.source_proposal_acceptance_id ?? null,
    scenes: normalizedScenes,
  };
}
export function isShotPlanPreparationResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
): value is components["schemas"]["ShotPlanPreparationResponse"] {
  if (
    !envelope(value, requestId) ||
    !exact(value.data, [
      "project_id",
      "episode_id",
      "authority",
      "script_content",
      "production_brief_content",
      "script_stored_content",
      "production_brief_stored_content",
      "storyboard_base",
      "generation_status",
    ]) ||
    !isShotPlanProjectId(projectId) ||
    !isShotPlanEpisodeId(episodeId) ||
    value.data.project_id !== projectId ||
    value.data.episode_id !== episodeId ||
    !authority(value.data.authority) ||
    !isEpisodeScriptContent(value.data.script_content, projectId, episodeId, true) ||
    !storyboardBase(value.data.storyboard_base) ||
    value.data.generation_status !== "UNAVAILABLE"
  )
    return false;
  const data = value.data,
    pin = value.data.authority,
    script = value.data.script_content;
  // Hash exact stored JSON first. Normalized views cannot rewrite the authority proof.
  const normalizedScript = normalizeStoredScript(data.script_stored_content, projectId, episodeId);
  const normalizedBrief = normalizeProductionBriefCreateCommand({
    operation_id: "00000000-0000-4000-8000-000000000001",
    input: {
      content: data.production_brief_stored_content,
      change_summary: "Validate preparation",
    },
  });
  if (
    !isEpisodeScriptContent(normalizedScript, projectId, episodeId, true) ||
    normalizedBrief === null ||
    canonical(normalizedScript) !== canonical(script) ||
    canonical(normalizedBrief.input.content) !== canonical(data.production_brief_content) ||
    pin.script.content_hash !== hash(data.script_stored_content) ||
    pin.production_brief.content_hash !== hash(data.production_brief_stored_content) ||
    Buffer.byteLength(canonical(data.script_stored_content), "utf8") > 2_000_000 ||
    Buffer.byteLength(canonical(data.production_brief_stored_content), "utf8") > 1_000_000 ||
    Buffer.byteLength(canonical(normalizedBrief.input.content), "utf8") > 1_000_000 ||
    Buffer.byteLength(canonical(value), "utf8") > 9_000_000 ||
    script.production_brief_version_id !== pin.production_brief.version_id
  )
    return false;
  if (pin.mode === "ORIGINAL")
    return (
      normalizedBrief.input.content.creative_entry.kind === "original_idea" &&
      script.source_extraction_version_id === null &&
      script.source_proposal_acceptance_id === null &&
      script.story_bible_version_id === null
    );
  return (
    normalizedBrief.input.content.creative_entry.kind === "source_adaptation" &&
    script.source_extraction_version_id === pin.source_extraction.version_id &&
    script.source_proposal_acceptance_id === pin.source_proposal_acceptance_id
  );
}
export function isShotPlanProposalResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  versionId?: string,
): value is components["schemas"]["ShotPlanProposalResponse"] {
  return envelope(value, requestId) && proposal(value.data, projectId, episodeId, versionId);
}
export function isShotPlanWriteStatusResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
): value is components["schemas"]["ShotPlanWriteStatusResponse"] {
  return (
    envelope(value, requestId) &&
    exact(value.data, ["proposal"]) &&
    (value.data.proposal === null || proposal(value.data.proposal, projectId, episodeId))
  );
}
export function isShotPlanAdoptionStatusResponse(
  value: unknown,
  versionId: string,
  requestId: string | null,
): value is components["schemas"]["ShotPlanAdoptionStatusResponse"] {
  return (
    envelope(value, requestId) &&
    exact(value.data, ["proposal_version_id", "adoption"]) &&
    isShotPlanVersionId(versionId) &&
    value.data.proposal_version_id === versionId &&
    (value.data.adoption === null || adoption(value.data.adoption, versionId))
  );
}
function mutation(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  versionId?: string,
): value is components["schemas"]["ShotPlanMutationResponse"] {
  return (
    envelope(value, requestId) &&
    exact(value.data, ["proposal", "replayed"]) &&
    typeof value.data.replayed === "boolean" &&
    proposal(value.data.proposal, projectId, episodeId, versionId)
  );
}
export function isShotPlanCreatedResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  requestId: string | null,
  payload: HumanShotPlanRequest,
): value is components["schemas"]["ShotPlanMutationResponse"] {
  if (
    !isHumanShotPlanRequest(payload, projectId, episodeId) ||
    !mutation(value, projectId, episodeId, requestId)
  )
    return false;
  const receipt = value.data.proposal,
    revision = (payload.expected_revision ?? 0) + 1;
  return (
    receipt.parent_version_id === payload.parent_version_id &&
    (value.data.replayed
      ? receipt.head_revision >= revision
      : receipt.head_revision === revision) &&
    canonical(receipt.content) === canonical(payload.content)
  );
}
export function isShotPlanAdoptedResponse(
  value: unknown,
  projectId: string,
  episodeId: string,
  versionId: string,
  requestId: string | null,
  payload: ShotPlanAdoptionRequest,
): value is components["schemas"]["ShotPlanMutationResponse"] {
  return (
    isShotPlanAdoptionRequest(payload) &&
    mutation(value, projectId, episodeId, requestId, versionId) &&
    value.data.proposal.content.timebase.frame_rate.den === 1 &&
    value.data.proposal.adoption !== null &&
    value.data.proposal.content_hash === payload.proposal_content_hash &&
    ![...value.data.proposal.content.issues, ...value.data.proposal.capability_losses].some(
      (issue) => issue.severity === "BLOCKING",
    )
  );
}
