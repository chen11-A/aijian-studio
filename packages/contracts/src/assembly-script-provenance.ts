import type { components } from "./generated.js";

export type ScriptProvenance = NonNullable<
  components["schemas"]["EpisodeMediaAssemblyContentV1"]["script_provenance"]
>;
export type SubtitleScriptRef = components["schemas"]["AssemblyScriptRefV1"];
export type ScriptSourceStatus = components["schemas"]["AssemblyScriptSourceStatusV1"];
type Content = Pick<
  components["schemas"]["EpisodeMediaAssemblyContentV1"],
  "project_id" | "episode_id" | "script_provenance" | "audio_segments" | "subtitle_segments"
>;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const id = (v: unknown, prefix: string) =>
  typeof v === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(v);
const hash = (v: unknown) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
export function subtitleScriptRef(v: unknown): v is SubtitleScriptRef {
  return (
    exact(v, ["script_version_id", "script_block_id", "script_content_hash"]) &&
    id(v.script_version_id, "ver") &&
    id(v.script_block_id, "sblk") &&
    hash(v.script_content_hash)
  );
}
export function scriptProvenance(v: unknown): v is ScriptProvenance {
  return (
    (exact(v, ["mode"]) && v.mode === "DRAFT") ||
    (exact(v, ["mode", "confirmation_id", "script_version_id", "script_content_hash"]) &&
      v.mode === "CONFIRMED" &&
      id(v.confirmation_id, "esc") &&
      id(v.script_version_id, "ver") &&
      hash(v.script_content_hash))
  );
}
export function assemblyScriptSources(c: Content): Array<{
  kind: "DIALOGUE" | "SUBTITLE";
  segmentId: string;
  versionId: string;
}> {
  return [
    ...c.audio_segments
      .filter((s) => s.track_kind === "DIALOGUE" && s.script_version_id)
      .map((s) => ({
        kind: "DIALOGUE" as const,
        segmentId: s.segment_id,
        versionId: s.script_version_id!,
      })),
    ...c.subtitle_segments.flatMap((s) => {
      const versionId = "text" in s ? s.script_ref?.script_version_id : s.script_version_id;
      return versionId ? [{ kind: "SUBTITLE" as const, segmentId: s.segment_id, versionId }] : [];
    }),
  ];
}
export function scriptSourceStatus(v: unknown, c: Content): v is ScriptSourceStatus {
  if (
    !scriptProvenance(c.script_provenance) ||
    !exact(v, [
      "state",
      "latest_confirmation",
      "newer_draft_available",
      "dialogue_segment_ids",
      "subtitle_segment_ids",
    ]) ||
    typeof v.newer_draft_available !== "boolean"
  )
    return false;
  const sources = assemblyScriptSources(c);
  if (
    JSON.stringify(v.dialogue_segment_ids) !==
      JSON.stringify(sources.filter((s) => s.kind === "DIALOGUE").map((s) => s.segmentId)) ||
    JSON.stringify(v.subtitle_segment_ids) !==
      JSON.stringify(sources.filter((s) => s.kind === "SUBTITLE").map((s) => s.segmentId))
  )
    return false;
  const latest = v.latest_confirmation;
  if (
    latest !== null &&
    (!exact(latest, [
      "confirmation_id",
      "project_id",
      "episode_id",
      "artifact_id",
      "version_id",
      "content_hash",
      "head_revision",
      "actor_id",
      "confirmed_at",
    ]) ||
      latest.project_id !== c.project_id ||
      latest.episode_id !== c.episode_id ||
      !id(latest.confirmation_id, "esc") ||
      !id(latest.artifact_id, "art") ||
      !id(latest.version_id, "ver") ||
      !hash(latest.content_hash) ||
      !Number.isSafeInteger(latest.head_revision) ||
      Number(latest.head_revision) < 1 ||
      typeof latest.actor_id !== "string" ||
      !latest.actor_id ||
      latest.actor_id.length > 240 ||
      typeof latest.confirmed_at !== "string" ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(latest.confirmed_at) ||
      !Number.isFinite(Date.parse(latest.confirmed_at)))
  )
    return false;
  if (latest === null && v.newer_draft_available) return false;
  const pin = c.script_provenance;
  if (pin.mode === "DRAFT") return v.state === "DRAFT_UNCONFIRMED";
  if (!sources.length || sources.some((s) => s.versionId !== pin.script_version_id)) return false;
  if (latest === null) return v.state === "AUTHORITY_UNKNOWN";
  const same =
    (latest as Record<string, unknown>).version_id === pin.script_version_id &&
    (latest as Record<string, unknown>).content_hash === pin.script_content_hash;
  return v.state === (same ? "CONFIRMED_CURRENT" : "CONFIRMATION_SUPERSEDED");
}
