import type {
  HumanShotPlanRequest,
  ShotPlanAdoption,
  ShotPlanAdoptionRequest,
  ShotPlanContent,
  ShotPlanGateway,
  ShotPlanPreparation,
  ShotPlanProposal,
  ShotPlanShot,
} from "@aijian/contracts/shot-plan";
import { sameStoryboardJson } from "./episodeStoryboard";

/** Ordered calls in one renderer are serialized by the journal; Storage is not cross-window CAS. */
export type HumanShotPlanStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Called again immediately before transmission, so live dirty state cannot be bypassed. */
export type HumanShotPlanCommitGuard = () => boolean;
export type HumanShotPlanCommand =
  | { kind: "CREATE"; operation_id: string; content_hash: string; payload: HumanShotPlanRequest }
  | {
      kind: "ADOPT";
      operation_id: string;
      proposal: ShotPlanProposal;
      payload: ShotPlanAdoptionRequest;
    };
export type HumanShotPlanJournal =
  { kind: "EMPTY" } | { kind: "BLOCKED" } | { kind: "PENDING"; command: HumanShotPlanCommand };
type Rejected = { kind: "REJECTED"; status: number; code: string };
type Unknown = { kind: "UNKNOWN" };
type Blocked = { kind: "BLOCKED"; message: string };
export type HumanShotPlanRead =
  { kind: "FOUND"; proposal: ShotPlanProposal } | { kind: "EMPTY" } | Rejected | Unknown;
export type HumanShotPlanPreparationRead =
  { kind: "PREPARED"; preparation: ShotPlanPreparation } | Rejected | Unknown;
export type HumanShotPlanWrite =
  { kind: "SAVED" | "ADOPTED"; proposal: ShotPlanProposal } | Rejected | Unknown | Blocked;
export type HumanShotPlanTemplate = { kind: "READY"; content: ShotPlanContent } | Blocked;

const PROJECT = /^prj_[0-9a-f]{32}$/;
const EPISODE = /^ep_(?:prj_)?[0-9a-f]{32}$/;
const VERSION = /^ver_[0-9a-f]{32}$/;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SHOT = /^shp_[0-9a-f]{32}$/;
const SCENE = /^scn_[0-9a-f]{32}$/;
const BLOCK = /^sblk_[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONFIRMATION = /^esc_[0-9a-f]{32}$/;
const ACCEPTANCE = /^pda_[0-9a-f]{32}$/;
const SPAN = /^spn_[0-9a-f]{32}$/;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(value).length === fields.length &&
  fields.every((field) => Object.hasOwn(value, field));
const fields = (value: Record<string, unknown>, names: string) => keys(value, names.split(" "));
const onlyFields = (value: Record<string, unknown>, names: string) =>
  Object.keys(value).every((name) => names.split(" ").includes(name));
const integer = (value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value: unknown, max = 4000): value is string =>
  typeof value === "string" &&
  !!value.trim() &&
  [...value].length <= max &&
  !value.includes("\0") &&
  new TextDecoder().decode(new TextEncoder().encode(value)) === value;
const id = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const date = (value: unknown) =>
  text(value, 80) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const scope = (project: string, episode: string) => PROJECT.test(project) && EPISODE.test(episode);
const list = (value: unknown, min: number, max: number): value is unknown[] =>
  Array.isArray(value) && value.length >= min && value.length <= max;
const unique = (value: readonly unknown[]) => new Set(value).size === value.length;
const unknown = (): Unknown => ({ kind: "UNKNOWN" });
const blocked = (message: string): Blocked => ({ kind: "BLOCKED", message });
const keyFor = (project: string, episode: string) =>
  `aivora.human-shot-plan.pending.v1.${project}.${episode}`;

function exactPin(value: unknown, extra: "script" | "base" | null = null): boolean {
  return (
    record(value) &&
    keys(
      value,
      extra === "script"
        ? ["version_id", "content_hash", "confirmation_id", "head_revision"]
        : extra === "base"
          ? ["version_id", "content_hash", "head_revision"]
          : ["version_id", "content_hash"],
    ) &&
    id(value.version_id, VERSION) &&
    id(value.content_hash, HASH) &&
    (extra === null || integer(value.head_revision)) &&
    (extra !== "script" || id(value.confirmation_id, CONFIRMATION))
  );
}
function authority(value: unknown): value is ShotPlanContent["authority"] {
  if (!record(value) || !exactPin(value.script, "script") || !exactPin(value.production_brief))
    return false;
  if (value.mode === "ORIGINAL") return fields(value, "mode script production_brief");
  return (
    value.mode === "ADAPTED" &&
    fields(
      value,
      "mode script production_brief source_extraction source_proposal_acceptance_id source_span_ids",
    ) &&
    exactPin(value.source_extraction) &&
    id(value.source_proposal_acceptance_id, ACCEPTANCE) &&
    list(value.source_span_ids, 1, 10000) &&
    unique(value.source_span_ids) &&
    value.source_span_ids.every((span) => id(span, SPAN))
  );
}
function timebase(value: unknown): value is ShotPlanContent["timebase"] {
  if (
    !record(value) ||
    !fields(value, "frame_rate timecode_mode") ||
    !record(value.frame_rate) ||
    !fields(value.frame_rate, "num den")
  )
    return false;
  const { num, den } = value.frame_rate;
  return (
    (((num === 24 || num === 25) && den === 1) ||
      ((num === 24000 || num === 30000) && den === 1001)) &&
    (value.timecode_mode === "NON_DROP_FRAME" ||
      (value.timecode_mode === "DROP_FRAME" && num === 30000 && den === 1001))
  );
}
function issues(value: unknown, shotIds: Set<string>): boolean {
  return (
    list(value, 0, 1000) &&
    value.every(
      (issue) =>
        record(issue) &&
        fields(issue, "code severity shot_id message") &&
        id(issue.code, /^[A-Z][A-Z0-9_]{0,79}$/) &&
        (issue.severity === "WARNING" || issue.severity === "BLOCKING") &&
        text(issue.message) &&
        (issue.shot_id === null || (id(issue.shot_id, SHOT) && shotIds.has(issue.shot_id))),
    )
  );
}
function validShot(value: unknown, ordinal: number): value is ShotPlanShot {
  if (
    !record(value) ||
    !fields(
      value,
      "shot_id ordinal script_scene_id script_block_ids title narrative_purpose coverage framing composition performance movement start_state end_state duration_frames handle_in_frames handle_out_frames safe_cut_window rhythm sound_intent dialogue_block_ids",
    ) ||
    !id(value.shot_id, SHOT) ||
    value.ordinal !== ordinal ||
    !id(value.script_scene_id, SCENE) ||
    !list(value.script_block_ids, 1, 500) ||
    !unique(value.script_block_ids) ||
    !value.script_block_ids.every((block) => id(block, BLOCK)) ||
    !list(value.dialogue_block_ids, 0, 500) ||
    !unique(value.dialogue_block_ids) ||
    !value.dialogue_block_ids.every(
      (block) => value.script_block_ids instanceof Array && value.script_block_ids.includes(block),
    ) ||
    !list(value.coverage, 1, 5) ||
    !unique(value.coverage) ||
    !value.coverage.every(
      (kind) =>
        typeof kind === "string" &&
        ["ACTION", "DIALOGUE", "ESTABLISHING", "REACTION", "TRANSITION"].includes(kind),
    ) ||
    typeof value.framing !== "string" ||
    !["EXTREME_WIDE", "WIDE", "MEDIUM", "CLOSE_UP", "EXTREME_CLOSE_UP"].includes(value.framing) ||
    !text(value.title, 240) ||
    ![
      value.narrative_purpose,
      value.composition,
      value.performance,
      value.start_state,
      value.end_state,
      value.rhythm,
      value.sound_intent,
    ].every((field) => text(field)) ||
    !record(value.movement) ||
    !fields(value.movement, "subject environment camera") ||
    !text(value.movement.subject) ||
    !text(value.movement.environment) ||
    !text(value.movement.camera, 160) ||
    !integer(value.duration_frames, 1, 864000) ||
    !integer(value.handle_in_frames, 0, 864000) ||
    !integer(value.handle_out_frames, 0, 864000) ||
    !record(value.safe_cut_window) ||
    !fields(value.safe_cut_window, "start_frame end_frame") ||
    !integer(value.safe_cut_window.start_frame, 0, 864000) ||
    !integer(value.safe_cut_window.end_frame, 1, 864000)
  )
    return false;
  return (
    value.handle_in_frames + value.handle_out_frames < value.duration_frames &&
    value.safe_cut_window.start_frame >= value.handle_in_frames &&
    value.safe_cut_window.end_frame <= value.duration_frames - value.handle_out_frames &&
    value.safe_cut_window.start_frame < value.safe_cut_window.end_frame
  );
}

export function validHumanShotPlanContent(
  value: unknown,
  project: string,
  episode: string,
  preparation?: ShotPlanPreparation,
): value is ShotPlanContent {
  if (
    !scope(project, episode) ||
    !record(value) ||
    !fields(
      value,
      "schema_version provenance project_id episode_id authority storyboard_base timebase visual_constraints shots issues",
    ) ||
    value.schema_version !== "1.0.0" ||
    value.provenance !== "HUMAN" ||
    value.project_id !== project ||
    value.episode_id !== episode ||
    !authority(value.authority) ||
    !(value.storyboard_base === null || exactPin(value.storyboard_base, "base")) ||
    !timebase(value.timebase) ||
    !list(value.visual_constraints, 0, 32) ||
    !unique(value.visual_constraints) ||
    !value.visual_constraints.every((constraint) => text(constraint)) ||
    !list(value.shots, 1, 1000) ||
    !value.shots.every((shot, i) => validShot(shot, i + 1))
  )
    return false;
  const shots = value.shots;
  const shotIds = new Set(shots.map((shot) => shot.shot_id));
  if (shotIds.size !== shots.length || !issues(value.issues, shotIds)) return false;
  if (!preparation) return true;
  if (
    !sameStoryboardJson(value.authority, preparation.authority) ||
    !sameStoryboardJson(value.storyboard_base, preparation.storyboard_base)
  )
    return false;
  const covered = new Set<string>();
  for (const shot of shots) {
    const scene = preparation.script_content.scenes.find(
      (item) => item.scene_id === shot.script_scene_id,
    );
    if (!scene) return false;
    const blocks = scene.blocks.filter((block) => shot.script_block_ids.includes(block.block_id));
    if (
      blocks.length !== shot.script_block_ids.length ||
      blocks.some((block) => !shot.coverage.includes(block.kind)) ||
      !sameStoryboardJson(
        [...shot.dialogue_block_ids].sort(),
        blocks
          .filter((block) => block.kind === "DIALOGUE")
          .map((block) => block.block_id)
          .sort(),
      )
    )
      return false;
    blocks.forEach((block) => covered.add(block.block_id));
  }
  return preparation.script_content.scenes.every((scene) =>
    scene.blocks.every((block) => covered.has(block.block_id)),
  );
}

function validScript(
  value: unknown,
  project: string,
  episode: string,
): value is ShotPlanPreparation["script_content"] {
  if (
    !record(value) ||
    !onlyFields(
      value,
      "schema_version project_id episode_id production_brief_version_id story_bible_version_id source_extraction_version_id source_proposal_acceptance_id scenes",
    ) ||
    value.schema_version !== "1.0.0" ||
    value.project_id !== project ||
    value.episode_id !== episode ||
    !list(value.scenes, 1, 1000) ||
    !id(value.production_brief_version_id, VERSION) ||
    ![value.story_bible_version_id, value.source_extraction_version_id].every(
      (pin) => pin === undefined || pin === null || id(pin, VERSION),
    ) ||
    !(
      value.source_proposal_acceptance_id === undefined ||
      value.source_proposal_acceptance_id === null ||
      id(value.source_proposal_acceptance_id, ACCEPTANCE)
    )
  )
    return false;
  const scenes = new Set<string>();
  const blocks = new Set<string>();
  return value.scenes.every((scene, i) => {
    if (
      !record(scene) ||
      !fields(scene, "scene_id ordinal heading blocks") ||
      !id(scene.scene_id, SCENE) ||
      scenes.has(scene.scene_id) ||
      scene.ordinal !== i + 1 ||
      !text(scene.heading, 240) ||
      !list(scene.blocks, 1, 500)
    )
      return false;
    scenes.add(scene.scene_id);
    return scene.blocks.every((block, j) => {
      if (
        !record(block) ||
        !onlyFields(block, "block_id ordinal kind text speaker delivery") ||
        !id(block.block_id, BLOCK) ||
        blocks.has(block.block_id) ||
        block.ordinal !== j + 1 ||
        !text(block.text, 20000)
      )
        return false;
      blocks.add(block.block_id);
      return block.kind === "ACTION"
        ? (block.speaker === null || block.speaker === undefined) &&
            (block.delivery === null || block.delivery === undefined)
        : block.kind === "DIALOGUE" &&
            text(block.speaker, 120) &&
            (block.delivery === undefined ||
              block.delivery === null ||
              block.delivery === "ON_SCREEN" ||
              block.delivery === "OFF_SCREEN");
    });
  });
}
function rational(value: unknown): value is { num: number; den: number } {
  if (
    !record(value) ||
    !fields(value, "num den") ||
    !integer(value.num) ||
    !integer(value.den, 1, 2147483647)
  )
    return false;
  let left = value.num;
  let right = value.den;
  while (right) [left, right] = [right, left % right];
  return left === 1;
}
function validBrief(value: unknown): value is ShotPlanPreparation["production_brief_content"] {
  if (
    !record(value) ||
    !fields(
      value,
      "schema_version creative_entry creative delivery duration_intent budget_intent rights_declaration",
    ) ||
    value.schema_version !== "1.0.0" ||
    !record(value.creative_entry) ||
    !record(value.creative) ||
    !record(value.delivery) ||
    !record(value.duration_intent) ||
    !record(value.budget_intent) ||
    !record(value.rights_declaration)
  )
    return false;
  const entry = value.creative_entry;
  const creative = value.creative;
  const delivery = value.delivery;
  const duration = value.duration_intent;
  const budget = value.budget_intent;
  const rights = value.rights_declaration;
  if (entry.kind === "original_idea") {
    if (
      !fields(entry, "kind origin_statement references") ||
      !text(entry.origin_statement) ||
      !list(entry.references, 0, 32) ||
      !entry.references.every(
        (ref) =>
          record(ref) &&
          fields(ref, "reference_kind description") &&
          typeof ref.reference_kind === "string" &&
          ["inspiration", "research", "other"].includes(ref.reference_kind) &&
          text(ref.description),
      )
    )
      return false;
  } else if (
    entry.kind !== "source_adaptation" ||
    !fields(
      entry,
      "kind adaptation_statement source_document_id source_manifest_version_id source_block_ids",
    ) ||
    !text(entry.adaptation_statement) ||
    !id(entry.source_document_id, /^src_[0-9a-f]{32}$/) ||
    !id(entry.source_manifest_version_id, VERSION) ||
    !list(entry.source_block_ids, 1, 100) ||
    !unique(entry.source_block_ids) ||
    !entry.source_block_ids.every((block) => id(block, /^srcb_[0-9a-f]{32}$/))
  )
    return false;
  return (
    fields(creative, "premise intent audience genre style constraints") &&
    text(creative.premise) &&
    text(creative.intent) &&
    [creative.audience, creative.genre, creative.style].every(
      (field) => field === null || text(field, 240),
    ) &&
    list(creative.constraints, 0, 32) &&
    unique(creative.constraints) &&
    creative.constraints.every((constraint) => text(constraint, 240)) &&
    fields(delivery, "language display_aspect_ratio width_px height_px frame_rate") &&
    text(delivery.language) &&
    rational(delivery.display_aspect_ratio) &&
    rational(delivery.frame_rate) &&
    integer(delivery.width_px) &&
    integer(delivery.height_px) &&
    BigInt(delivery.width_px) * BigInt(delivery.display_aspect_ratio.den) ===
      BigInt(delivery.height_px) * BigInt(delivery.display_aspect_ratio.num) &&
    fields(duration, "work_seconds episode_mode episode_seconds") &&
    (duration.work_seconds === null || integer(duration.work_seconds)) &&
    (duration.episode_mode === "unspecified"
      ? duration.episode_seconds === null
      : duration.episode_mode === "per_episode" && integer(duration.episode_seconds)) &&
    fields(budget, "state currency amount_micros") &&
    (budget.state === "unknown"
      ? budget.currency === null && budget.amount_micros === null
      : budget.state === "declared" &&
        id(budget.currency, /^[A-Z]{3}$/) &&
        integer(budget.amount_micros, 0)) &&
    fields(rights, "state statement") &&
    (rights.state === "unknown"
      ? rights.statement === null
      : rights.state === "user_declared" && text(rights.statement))
  );
}
/** Fill only schema-declared defaults. Raw proofs stay untouched for canonical hashing. */
function defaults(
  value: unknown,
  names: string,
  optional: Record<string, unknown> = {},
): Record<string, unknown> | null {
  return record(value) && onlyFields(value, names) ? { ...optional, ...value } : null;
}
function normalizedScriptProof(value: unknown): unknown {
  const script = defaults(
    value,
    "schema_version project_id episode_id production_brief_version_id story_bible_version_id source_extraction_version_id source_proposal_acceptance_id scenes",
    {
      schema_version: "1.0.0",
      production_brief_version_id: null,
      story_bible_version_id: null,
      source_extraction_version_id: null,
      source_proposal_acceptance_id: null,
      scenes: [],
    },
  );
  if (!script || !Array.isArray(script.scenes)) return null;
  const scenes = script.scenes.map((value) => {
    const scene = defaults(value, "scene_id ordinal heading blocks", { blocks: [] });
    if (!scene || !Array.isArray(scene.blocks)) return null;
    return {
      ...scene,
      blocks: scene.blocks.map((block) =>
        defaults(block, "block_id ordinal kind text speaker delivery", {
          speaker: null,
          delivery: null,
        }),
      ),
    };
  });
  return { ...script, scenes };
}
function normalizedBriefProof(value: unknown): unknown {
  const brief = defaults(
    value,
    "schema_version creative_entry creative delivery duration_intent budget_intent rights_declaration",
    { schema_version: "1.0.0" },
  );
  if (!brief || !record(brief.creative_entry)) return null;
  const entry =
    brief.creative_entry.kind === "original_idea"
      ? defaults(brief.creative_entry, "kind origin_statement references", { references: [] })
      : defaults(
          brief.creative_entry,
          "kind adaptation_statement source_document_id source_manifest_version_id source_block_ids",
        );
  const creative = defaults(brief.creative, "premise intent audience genre style constraints", {
    audience: null,
    genre: null,
    style: null,
    constraints: [],
  });
  return { ...brief, creative_entry: entry, creative };
}
function equivalentInputProofs(preparation: Record<string, unknown>): boolean {
  try {
    const script = normalizedScriptProof(preparation.script_stored_content);
    const brief = normalizedBriefProof(preparation.production_brief_stored_content);
    if (
      !sameStoryboardJson(script, preparation.script_content) ||
      !sameStoryboardJson(brief, preparation.production_brief_content)
    )
      return false;
    canonicalContentBytes(preparation.script_stored_content, MAX_SCRIPT_BYTES);
    canonicalContentBytes(
      preparation.production_brief_stored_content,
      MAX_PRODUCTION_BRIEF_PROOF_BYTES,
    );
    canonicalContentBytes(preparation.production_brief_content, MAX_PRODUCTION_BRIEF_PROOF_BYTES);
    return true;
  } catch {
    return false;
  }
}

export function validHumanShotPlanPreparation(
  value: unknown,
  project: string,
  episode: string,
): value is ShotPlanPreparation {
  if (
    !scope(project, episode) ||
    !record(value) ||
    !fields(
      value,
      "project_id episode_id authority script_content production_brief_content script_stored_content production_brief_stored_content storyboard_base generation_status",
    ) ||
    value.project_id !== project ||
    value.episode_id !== episode ||
    value.generation_status !== "UNAVAILABLE" ||
    !authority(value.authority) ||
    !(value.storyboard_base === null || exactPin(value.storyboard_base, "base")) ||
    !validScript(value.script_content, project, episode) ||
    !validBrief(value.production_brief_content) ||
    !record(value.script_stored_content) ||
    !record(value.production_brief_stored_content)
  )
    return false;
  const pin = value.authority;
  const script = value.script_content;
  const entry = value.production_brief_content.creative_entry;
  return (
    equivalentInputProofs(value) &&
    script.production_brief_version_id === pin.production_brief.version_id &&
    (pin.mode === "ORIGINAL"
      ? entry.kind === "original_idea" &&
        !script.story_bible_version_id &&
        !script.source_extraction_version_id &&
        !script.source_proposal_acceptance_id
      : entry.kind === "source_adaptation" &&
        script.source_extraction_version_id === pin.source_extraction.version_id &&
        script.source_proposal_acceptance_id === pin.source_proposal_acceptance_id)
  );
}
function validAdoption(value: unknown, version: string, hash: string): value is ShotPlanAdoption {
  return (
    record(value) &&
    fields(
      value,
      "proposal_version_id proposal_content_hash storyboard_version_id storyboard_content_hash actor_id adopted_at",
    ) &&
    value.proposal_version_id === version &&
    value.proposal_content_hash === hash &&
    id(value.storyboard_version_id, VERSION) &&
    id(value.storyboard_content_hash, HASH) &&
    text(value.actor_id, 240) &&
    date(value.adopted_at)
  );
}
export function validHumanShotPlanProposal(
  value: unknown,
  project: string,
  episode: string,
): value is ShotPlanProposal {
  if (
    !record(value) ||
    !fields(
      value,
      "version_id content_hash version_number head_revision parent_version_id content author_actor_id created_at generation_status capability_losses adoption",
    ) ||
    !id(value.version_id, VERSION) ||
    !id(value.content_hash, HASH) ||
    !integer(value.version_number) ||
    !integer(value.head_revision) ||
    value.head_revision < value.version_number ||
    !(value.parent_version_id === null || id(value.parent_version_id, VERSION)) ||
    !text(value.author_actor_id, 240) ||
    !date(value.created_at) ||
    value.generation_status !== "UNAVAILABLE" ||
    !validHumanShotPlanContent(value.content, project, episode)
  )
    return false;
  return (
    issues(value.capability_losses, new Set(value.content.shots.map((shot) => shot.shot_id))) &&
    (value.adoption === null || validAdoption(value.adoption, value.version_id, value.content_hash))
  );
}

const MAX_SCRIPT_BYTES = 2_000_000;
// Read-only ceiling derived from the closed ProductionBrief field/count limits.
const MAX_PRODUCTION_BRIEF_PROOF_BYTES = 1_000_000;
function canonicalContentBytes(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(",")}]`;
    if (record(item))
      return `{${Object.keys(item)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
        .join(",")}}`;
    const encoded = JSON.stringify(item);
    if (encoded === undefined) throw new Error("Non-JSON immutable content");
    return encoded;
  };
  const bytes = new TextEncoder().encode(canonical(value));
  if (bytes.length > maximum) throw new Error("Immutable content exceeds limit");
  return bytes;
}
async function exactContentHash(content: unknown, maximum: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", canonicalContentBytes(content, maximum));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
/** Integer-only director content uses the backend's sorted-key UTF-8 JSON encoding. */
export const humanShotPlanContentHash = (content: ShotPlanContent): Promise<string> =>
  exactContentHash(content, 2_000_000);
async function verifiedProposal(
  value: unknown,
  project: string,
  episode: string,
): Promise<ShotPlanProposal | null> {
  if (!validHumanShotPlanProposal(value, project, episode)) return null;
  return (await humanShotPlanContentHash(value.content)) === value.content_hash ? value : null;
}
const responseData = (value: unknown, kind: string): unknown =>
  record(value) &&
  value.kind === kind &&
  record(value.receipt) &&
  fields(value.receipt, "data request_id") &&
  id(value.receipt.request_id, UUID)
    ? value.receipt.data
    : undefined;
function rejection(value: unknown): Rejected | null {
  return record(value) &&
    value.kind === "DEFINITE_SERVER_ERROR" &&
    integer(value.status, 400, 599) &&
    id(value.code, /^[A-Z][A-Z0-9_]{0,79}$/) &&
    id(value.request_id, UUID)
    ? { kind: "REJECTED", status: value.status, code: value.code }
    : null;
}
export async function readHumanShotPlanPreparation(
  gateway: ShotPlanGateway,
  project: string,
  episode: string,
): Promise<HumanShotPlanPreparationRead> {
  if (!scope(project, episode)) return unknown();
  try {
    const response = await gateway.prepareHumanShotPlan(project, episode);
    const rejected = rejection(response);
    if (rejected) return rejected;
    const preparation = responseData(response, "PREPARED");
    if (
      validHumanShotPlanPreparation(preparation, project, episode) &&
      (await exactContentHash(preparation.script_stored_content, MAX_SCRIPT_BYTES)) ===
        preparation.authority.script.content_hash &&
      (await exactContentHash(
        preparation.production_brief_stored_content,
        MAX_PRODUCTION_BRIEF_PROOF_BYTES,
      )) === preparation.authority.production_brief.content_hash
    )
      return { kind: "PREPARED", preparation };
  } catch {
    /* A failed preparation does not establish authority. */
  }
  return unknown();
}
export async function readHumanShotPlanProposal(
  gateway: ShotPlanGateway,
  project: string,
  episode: string,
): Promise<HumanShotPlanRead> {
  if (!scope(project, episode)) return unknown();
  try {
    const response = await gateway.getShotPlanProposal(project, episode);
    if (response.kind === "EMPTY") return { kind: "EMPTY" };
    const rejected = rejection(response);
    if (rejected) return rejected;
    const proposal = await verifiedProposal(responseData(response, "FOUND"), project, episode);
    if (proposal) return { kind: "FOUND", proposal };
  } catch {
    /* Digest/read failure is unknown, never an empty proposal. */
  }
  return unknown();
}

export const cloneHumanShotPlanContent = (content: ShotPlanContent): ShotPlanContent =>
  structuredClone(content);
export function humanShotPlanRequest(
  content: ShotPlanContent,
  latest: ShotPlanProposal | null,
  summary: string,
): HumanShotPlanRequest {
  return {
    content: cloneHumanShotPlanContent(content),
    parent_version_id: latest?.version_id ?? null,
    expected_revision: latest?.head_revision ?? null,
    change_summary: summary,
  };
}
export function reorderHumanShotPlanShots(
  shots: ShotPlanShot[],
  index: number,
  offset: number,
): ShotPlanShot[] {
  const target = index + offset;
  if (!integer(index, 0) || !integer(target, 0) || index >= shots.length || target >= shots.length)
    return shots;
  const next = [...shots];
  const [shot] = next.splice(index, 1);
  if (shot) next.splice(target, 0, shot);
  return next.map((item, i) => ({ ...item, ordinal: i + 1 }));
}
export function buildHumanShotPlanTemplate(
  preparation: ShotPlanPreparation,
  count: number,
): HumanShotPlanTemplate {
  if (
    !validHumanShotPlanPreparation(preparation, preparation.project_id, preparation.episode_id) ||
    !integer(count, 1, 1000) ||
    count < preparation.script_content.scenes.length
  )
    return blocked("镜头数须为 1 至 1000 的整数且不少于场景数；每个场景须有已确认的剧本块。");
  const brief = preparation.production_brief_content;
  const candidate = {
    frame_rate: { ...brief.delivery.frame_rate },
    timecode_mode: "NON_DROP_FRAME",
  };
  if (!timebase(candidate)) return blocked("制作简报帧率不受支持；请先修订简报，不会取整或改速。");
  const scenes = preparation.script_content.scenes;
  const seconds = brief.duration_intent.episode_seconds ?? count * 3;
  const totalFrames = Math.round((seconds * candidate.frame_rate.num) / candidate.frame_rate.den);
  if (
    !Number.isSafeInteger(totalFrames) ||
    totalFrames < count ||
    Math.ceil(totalFrames / count) > 864000
  )
    return blocked("时长不足以分配整数帧，或超过单镜头时长限制。");
  const allocations = scenes.map(() => Math.floor(count / scenes.length));
  for (let i = 0; i < count % scenes.length; i++) allocations[i] = (allocations[i] ?? 0) + 1;
  const shots: ShotPlanShot[] = [];
  try {
    scenes.forEach((scene, sceneIndex) => {
      const slots = allocations[sceneIndex] ?? 0;
      for (let slot = 0; slot < slots; slot++) {
        const from = Math.floor((slot * scene.blocks.length) / slots);
        const to = Math.max(from + 1, Math.floor(((slot + 1) * scene.blocks.length) / slots));
        const blocks = scene.blocks.slice(from, to);
        const ordinal = shots.length + 1;
        const duration =
          Math.floor((ordinal * totalFrames) / count) -
          Math.floor(((ordinal - 1) * totalFrames) / count);
        const handle = Math.min(
          Math.round(candidate.frame_rate.num / candidate.frame_rate.den / 4),
          Math.floor((duration - 1) / 2),
        );
        shots.push({
          shot_id: `shp_${crypto.randomUUID().replaceAll("-", "")}`,
          ordinal,
          script_scene_id: scene.scene_id,
          script_block_ids: blocks.map((block) => block.block_id),
          title: [...`${scene.heading} · 人工镜头 ${slot + 1}`].slice(0, 240).join(""),
          narrative_purpose: "待人工审阅：根据所引用剧本块填写本镜头的叙事目的。",
          coverage: [...new Set(blocks.map((block) => block.kind))],
          framing: "MEDIUM",
          composition: "待人工审阅：默认中景占位，确认构图与画幅安全区。",
          performance: "待人工审阅：填写表演意图，不表示表演已实现。",
          movement: {
            subject: "待人工审阅：确认主体运动。",
            environment: "待人工审阅：确认环境运动。",
            camera: "待人工审阅：默认静机占位。",
          },
          start_state: "待人工审阅：填写连续性起始状态。",
          end_state: "待人工审阅：填写连续性结束状态。",
          duration_frames: duration,
          handle_in_frames: handle,
          handle_out_frames: handle,
          safe_cut_window: { start_frame: handle, end_frame: duration - handle },
          rhythm: "待人工审阅：时长按简报均分，确认节奏与安全切点。",
          sound_intent: "待人工审阅：填写声音意图，尚未生成声音。",
          dialogue_block_ids: blocks
            .filter((block) => block.kind === "DIALOGUE")
            .map((block) => block.block_id),
        });
      }
    });
    const content: ShotPlanContent = {
      schema_version: "1.0.0",
      provenance: "HUMAN",
      project_id: preparation.project_id,
      episode_id: preparation.episode_id,
      authority: structuredClone(preparation.authority),
      storyboard_base: structuredClone(preparation.storyboard_base),
      timebase: candidate,
      visual_constraints: [...brief.creative.constraints],
      shots,
      issues: [
        {
          code: "HUMAN_REVIEW_PENDING",
          severity: "WARNING",
          shot_id: null,
          message: "这是确定性人工编辑模板；全部镜头意图与时长须人工审阅，不代表制作完成。",
        },
      ],
    };
    return validHumanShotPlanContent(content, content.project_id, content.episode_id, preparation)
      ? { kind: "READY", content }
      : blocked("无法构建完整且准确的剧本覆盖。");
  } catch {
    return blocked("无法创建可靠的镜头身份；本次未创建模板。");
  }
}

function validRequest(
  value: unknown,
  project: string,
  episode: string,
): value is HumanShotPlanRequest {
  return (
    record(value) &&
    fields(value, "content parent_version_id expected_revision change_summary") &&
    validHumanShotPlanContent(value.content, project, episode) &&
    text(value.change_summary, 240) &&
    (value.parent_version_id === null
      ? value.expected_revision === null
      : id(value.parent_version_id, VERSION) && integer(value.expected_revision))
  );
}
function validCommand(
  value: unknown,
  project: string,
  episode: string,
): value is HumanShotPlanCommand {
  if (!record(value) || !id(value.operation_id, UUID)) return false;
  if (value.kind === "CREATE")
    return (
      fields(value, "kind operation_id content_hash payload") &&
      id(value.content_hash, HASH) &&
      validRequest(value.payload, project, episode)
    );
  return (
    value.kind === "ADOPT" &&
    fields(value, "kind operation_id proposal payload") &&
    validHumanShotPlanProposal(value.proposal, project, episode) &&
    record(value.payload) &&
    fields(value.payload, "confirm proposal_content_hash") &&
    value.payload.confirm === true &&
    value.payload.proposal_content_hash === value.proposal.content_hash
  );
}
export function readHumanShotPlanJournal(
  storage: HumanShotPlanStorage,
  project: string,
  episode: string,
): HumanShotPlanJournal {
  if (!scope(project, episode)) return { kind: "BLOCKED" };
  try {
    const raw = storage.getItem(keyFor(project, episode));
    if (raw === null) return { kind: "EMPTY" };
    if (raw.length > 2500000) return { kind: "BLOCKED" };
    const command: unknown = JSON.parse(raw);
    return validCommand(command, project, episode)
      ? { kind: "PENDING", command }
      : { kind: "BLOCKED" };
  } catch {
    return { kind: "BLOCKED" };
  }
}
function persist(
  storage: HumanShotPlanStorage,
  project: string,
  episode: string,
  command: HumanShotPlanCommand,
): boolean {
  if (readHumanShotPlanJournal(storage, project, episode).kind !== "EMPTY") return false;
  try {
    const raw = JSON.stringify(command);
    if (raw.length > 2500000) return false;
    storage.setItem(keyFor(project, episode), raw);
    const saved = readHumanShotPlanJournal(storage, project, episode);
    return saved.kind === "PENDING" && sameStoryboardJson(saved.command, command);
  } catch {
    return false;
  }
}
function close(
  storage: HumanShotPlanStorage,
  project: string,
  episode: string,
  command: HumanShotPlanCommand,
): boolean {
  const saved = readHumanShotPlanJournal(storage, project, episode);
  if (saved.kind !== "PENDING" || !sameStoryboardJson(saved.command, command)) return false;
  try {
    storage.removeItem(keyFor(project, episode));
    return readHumanShotPlanJournal(storage, project, episode).kind === "EMPTY";
  } catch {
    return false;
  }
}
function guarded(guard: HumanShotPlanCommitGuard): boolean {
  try {
    return guard() === true;
  } catch {
    return false;
  }
}
function matchesCreate(
  proposal: ShotPlanProposal,
  command: Extract<HumanShotPlanCommand, { kind: "CREATE" }>,
): boolean {
  return (
    proposal.content_hash === command.content_hash &&
    sameStoryboardJson(proposal.content, command.payload.content) &&
    proposal.parent_version_id === command.payload.parent_version_id &&
    proposal.version_number === (command.payload.expected_revision ?? 0) + 1 &&
    proposal.head_revision >= proposal.version_number
  );
}
function sameImmutable(left: ShotPlanProposal, right: ShotPlanProposal): boolean {
  return (
    right.head_revision >= left.head_revision &&
    sameStoryboardJson(
      { ...left, head_revision: 0, adoption: null },
      { ...right, head_revision: 0, adoption: null },
    ) &&
    (left.adoption === null || sameStoryboardJson(left.adoption, right.adoption))
  );
}
async function exactProposal(
  gateway: ShotPlanGateway,
  project: string,
  episode: string,
  proposal: ShotPlanProposal,
): Promise<ShotPlanProposal | null> {
  const response = await gateway.getShotPlanProposalVersion(project, episode, proposal.version_id);
  const exact = await verifiedProposal(responseData(response, "FOUND"), project, episode);
  return exact && exact.version_id === proposal.version_id && sameImmutable(proposal, exact)
    ? exact
    : null;
}
function safelyRejected(response: unknown): Rejected | null {
  const rejected = rejection(response);
  return rejected &&
    [401, 403, 404, 409, 413, 422, 428].includes(rejected.status) &&
    rejected.code !== "SHOT_PLAN_STORAGE_FAILED"
    ? rejected
    : null;
}
export async function createHumanShotPlan(
  gateway: ShotPlanGateway,
  storage: HumanShotPlanStorage,
  project: string,
  episode: string,
  operationId: string,
  payload: HumanShotPlanRequest,
  guard: HumanShotPlanCommitGuard,
): Promise<HumanShotPlanWrite> {
  if (!guarded(guard) || !id(operationId, UUID) || !validRequest(payload, project, episode))
    return blocked("剧本、分镜或提案有未保存/待核对更改，或提交字段无效；本次未发送。");
  if (readHumanShotPlanJournal(storage, project, episode).kind !== "EMPTY")
    return blocked("已有待核对的原操作；请只读核对，未重复提交。");
  let command: Extract<HumanShotPlanCommand, { kind: "CREATE" }>;
  try {
    const original = structuredClone(payload);
    command = {
      kind: "CREATE",
      operation_id: operationId,
      payload: original,
      content_hash: await humanShotPlanContentHash(original.content),
    };
  } catch {
    return blocked("无法验证内容或保存恢复身份；本次未发送。");
  }
  if (!guarded(guard) || !persist(storage, project, episode, command))
    return blocked("存在未保存更改，或无法持久保存原操作；本次未发送。");
  if (!guarded(guard)) {
    close(storage, project, episode, command);
    return blocked("提交前状态已变化；本次未发送。");
  }
  try {
    const response = await gateway.createHumanShotPlanProposal(
      project,
      episode,
      command.operation_id,
      structuredClone(command.payload),
    );
    const rejected = safelyRejected(response);
    if (rejected) return close(storage, project, episode, command) ? rejected : unknown();
    const mutation = responseData(response, "CREATED");
    if (
      !record(mutation) ||
      !fields(mutation, "proposal replayed") ||
      typeof mutation.replayed !== "boolean"
    )
      return unknown();
    const proposal = await verifiedProposal(mutation.proposal, project, episode);
    if (!proposal || !matchesCreate(proposal, command)) return unknown();
    const exact = await exactProposal(gateway, project, episode, proposal);
    if (!exact || !matchesCreate(exact, command) || !close(storage, project, episode, command))
      return unknown();
    return { kind: "SAVED", proposal: exact };
  } catch {
    return unknown();
  }
}
export async function adoptHumanShotPlan(
  gateway: ShotPlanGateway,
  storage: HumanShotPlanStorage,
  project: string,
  episode: string,
  proposal: ShotPlanProposal,
  operationId: string,
  draftContent: ShotPlanContent,
  guard: HumanShotPlanCommitGuard,
): Promise<HumanShotPlanWrite> {
  if (
    !guarded(guard) ||
    !id(operationId, UUID) ||
    !validHumanShotPlanProposal(proposal, project, episode) ||
    !sameStoryboardJson(draftContent, proposal.content) ||
    [...proposal.content.issues, ...proposal.capability_losses].some(
      (issue) => issue.severity === "BLOCKING",
    )
  )
    return blocked("请先保存更改并处理阻断问题；只能采纳精确已保存的人工提案。");
  if (readHumanShotPlanJournal(storage, project, episode).kind !== "EMPTY")
    return blocked("已有待核对的原操作；请只读核对，未重复采纳。");
  let command: Extract<HumanShotPlanCommand, { kind: "ADOPT" }>;
  try {
    const original = structuredClone(proposal);
    if (!(await verifiedProposal(original, project, episode)))
      return blocked("无法验证提案内容；本次未发送。");
    command = {
      kind: "ADOPT",
      operation_id: operationId,
      proposal: original,
      payload: { proposal_content_hash: original.content_hash, confirm: true },
    };
  } catch {
    return blocked("无法验证提案内容；本次未发送。");
  }
  if (
    !guarded(guard) ||
    !sameStoryboardJson(draftContent, command.proposal.content) ||
    !persist(storage, project, episode, command)
  )
    return blocked("存在未保存更改，或无法持久保存原操作；本次未发送。");
  if (!guarded(guard)) {
    close(storage, project, episode, command);
    return blocked("提交前状态已变化；本次未发送。");
  }
  try {
    const response = await gateway.adoptHumanShotPlanProposal(
      project,
      episode,
      command.proposal.version_id,
      command.operation_id,
      structuredClone(command.payload),
    );
    const rejected = safelyRejected(response);
    if (rejected) return close(storage, project, episode, command) ? rejected : unknown();
    const mutation = responseData(response, "ADOPTED");
    if (
      !record(mutation) ||
      !fields(mutation, "proposal replayed") ||
      typeof mutation.replayed !== "boolean"
    )
      return unknown();
    const accepted = await verifiedProposal(mutation.proposal, project, episode);
    if (!accepted || !accepted.adoption || !sameImmutable(command.proposal, accepted))
      return unknown();
    const exact = await exactProposal(gateway, project, episode, accepted);
    if (!exact?.adoption || !close(storage, project, episode, command)) return unknown();
    return { kind: "ADOPTED", proposal: exact };
  } catch {
    return unknown();
  }
}
/** Recovery is strictly GET-only. Missing status cannot prove that an operation did not commit. */
export async function recoverHumanShotPlan(
  gateway: ShotPlanGateway,
  storage: HumanShotPlanStorage,
  project: string,
  episode: string,
): Promise<HumanShotPlanWrite> {
  const journal = readHumanShotPlanJournal(storage, project, episode);
  if (journal.kind !== "PENDING")
    return blocked(
      journal.kind === "EMPTY"
        ? "没有待核对的原操作。"
        : "恢复记录不可读；请保留记录并检查本地存储。",
    );
  const command = journal.command;
  try {
    if (command.kind === "CREATE") {
      if ((await humanShotPlanContentHash(command.payload.content)) !== command.content_hash)
        return unknown();
      const response = await gateway.getHumanShotPlanWriteStatus(
        project,
        episode,
        command.operation_id,
      );
      const status = responseData(response, "STATUS");
      if (!record(status) || !fields(status, "proposal")) return unknown();
      const proposal = await verifiedProposal(status.proposal, project, episode);
      if (!proposal || !matchesCreate(proposal, command)) return unknown();
      const exact = await exactProposal(gateway, project, episode, proposal);
      if (!exact || !matchesCreate(exact, command) || !close(storage, project, episode, command))
        return unknown();
      return { kind: "SAVED", proposal: exact };
    }
    if (!(await verifiedProposal(command.proposal, project, episode))) return unknown();
    const response = await gateway.getShotPlanAdoptionStatus(
      project,
      episode,
      command.proposal.version_id,
    );
    const status = responseData(response, "STATUS");
    if (
      !record(status) ||
      !fields(status, "proposal_version_id adoption") ||
      status.proposal_version_id !== command.proposal.version_id ||
      !validAdoption(status.adoption, command.proposal.version_id, command.proposal.content_hash)
    )
      return unknown();
    const exact = await exactProposal(gateway, project, episode, command.proposal);
    if (
      !exact?.adoption ||
      !sameStoryboardJson(exact.adoption, status.adoption) ||
      !close(storage, project, episode, command)
    )
      return unknown();
    return { kind: "ADOPTED", proposal: exact };
  } catch {
    return unknown();
  }
}
