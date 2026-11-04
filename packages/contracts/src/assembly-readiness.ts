import type { components } from "./generated.js";

export type AssemblyReadinessData = components["schemas"]["EpisodeAssemblyReadinessData"];
export type AssemblyReadinessTarget = { version_id: string; content_hash: string };
export type AssemblyReadinessResult =
  | { kind: "FOUND"; receipt: { data: AssemblyReadinessData; request_id: string } }
  | { kind: "REMOTE_UNKNOWN" };
export type AssemblyReadinessGateway = {
  getEpisodeAssemblyReadiness(
    projectId: string,
    episodeId: string,
    target: AssemblyReadinessTarget,
  ): Promise<AssemblyReadinessResult>;
};
export const ASSEMBLY_READINESS_CHANNEL = "episode-assembly-readiness:read";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const code = (v: unknown): v is string => typeof v === "string" && /^[A-Z][A-Z0-9_]{2,79}$/.test(v);
export function readinessTarget(v: unknown): v is AssemblyReadinessTarget {
  return (
    record(v) &&
    exact(v, ["version_id", "content_hash"]) &&
    typeof v.version_id === "string" &&
    /^ver_[0-9a-f]{32}$/.test(v.version_id) &&
    typeof v.content_hash === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(v.content_hash)
  );
}

/** Read observations must account for exactly the original versions in the saved tracks. */
function observedAssembly(a: Record<string, unknown>): boolean {
  if (
    !exact(a, [
      "artifact_id",
      "version_id",
      "content_hash",
      "head_revision",
      "parent_version_id",
      "content",
      "media_checks",
      "playback_status",
      "export_status",
      ...(Object.hasOwn(a, "script_source_status") ? ["script_source_status"] : []),
    ]) ||
    !record(a.content) ||
    !Array.isArray(a.content.visual_segments) ||
    !Array.isArray(a.content.audio_segments) ||
    !Array.isArray(a.media_checks)
  )
    return false;
  const expected = new Map<string, string>();
  const key = (v: Record<string, unknown>) => `${v.asset_id}/${v.asset_version_id}/${v.sha256}`;
  for (const [segments, audio] of [
    [a.content.visual_segments, false],
    [a.content.audio_segments, true],
  ] as const) {
    for (const segment of segments) {
      if (!record(segment) || !record(segment.media)) return false;
      const kind = audio ? "audio" : segment.media_kind;
      if (typeof kind !== "string") return false;
      const identity = key(segment.media);
      if (expected.has(identity) && expected.get(identity) !== kind) return false;
      expected.set(identity, kind);
    }
  }
  if (a.media_checks.length !== expected.size) return false;
  const seen = new Set<string>();
  for (const item of a.media_checks) {
    if (
      !record(item) ||
      !exact(item, [
        "media",
        "kind",
        "availability",
        "technical_status",
        "probe_evidence_id",
        "probed_video_frames",
        "probed_has_audio",
        "rights_status",
        "rights_decision_id",
      ]) ||
      !record(item.media) ||
      !exact(item.media, ["asset_id", "asset_version_id", "sha256"]) ||
      typeof item.kind !== "string" ||
      typeof item.availability !== "string" ||
      typeof item.technical_status !== "string" ||
      typeof item.rights_status !== "string" ||
      ![
        "VERIFIED",
        "MISSING",
        "CORRUPT",
        "UNVERIFIED_SIZE_LIMIT",
        "UNKNOWN_UNSAFE_PATH",
        "UNKNOWN_MEDIA_READ",
        "UNKNOWN_MEDIA_CHANGED",
      ].includes(item.availability) ||
      ![
        "STILL_HEADER_ONLY",
        "PENDING_MEDIA_PROBE",
        "PROBED_CFR_VIDEO",
        "INVALID_MEDIA_PROBE",
      ].includes(item.technical_status) ||
      !["PENDING_REVIEW", "CLEARED", "RESTRICTED"].includes(item.rights_status) ||
      !(
        item.probe_evidence_id === null ||
        (typeof item.probe_evidence_id === "string" &&
          /^mpe_[0-9a-f]{32}$/.test(item.probe_evidence_id))
      ) ||
      !(
        item.probed_video_frames === null ||
        (Number.isSafeInteger(item.probed_video_frames) && Number(item.probed_video_frames) > 0)
      ) ||
      !(item.probed_has_audio === null || typeof item.probed_has_audio === "boolean") ||
      !(item.rights_decision_id === null || typeof item.rights_decision_id === "string")
    )
      return false;
    const identity = key(item.media);
    if (seen.has(identity) || expected.get(identity) !== item.kind) return false;
    seen.add(identity);
  }
  return true;
}

/** Both native and renderer reuse their existing complete assembly reader. No approval is inferred. */
export function readinessData(
  v: unknown,
  target: AssemblyReadinessTarget,
  validAssembly: (assembly: unknown) => boolean,
): v is AssemblyReadinessData {
  if (
    !record(v) ||
    !exact(v, [
      "assembly",
      "is_current_head",
      "source_checks",
      "blockers",
      "checked_at",
      "picture_lock_status",
      "export_status",
      "formal_status",
    ]) ||
    !record(v.assembly) ||
    v.assembly.version_id !== target.version_id ||
    v.assembly.content_hash !== target.content_hash ||
    !validAssembly(v.assembly) ||
    !observedAssembly(v.assembly) ||
    typeof v.is_current_head !== "boolean" ||
    v.picture_lock_status !== "NO_PICTURE_LOCK" ||
    v.export_status !== "NO_EXPORT_CLAIM" ||
    v.formal_status !== "BLOCKED" ||
    typeof v.checked_at !== "string" ||
    v.checked_at.startsWith("0000") ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(v.checked_at) ||
    !Number.isFinite(Date.parse(v.checked_at)) ||
    new Date(v.checked_at).toISOString().slice(0, 19) !== v.checked_at.slice(0, 19) ||
    !Array.isArray(v.source_checks) ||
    v.source_checks.length !== 2 ||
    !Array.isArray(v.blockers) ||
    v.blockers.length < 1 ||
    v.blockers.length > 10000
  )
    return false;
  const seen = new Set<string>();
  for (const [index, item] of v.source_checks.entries()) {
    if (
      !record(item) ||
      !exact(item, ["scope", "status", "code"]) ||
      (item.scope !== "SCRIPT" && item.scope !== "STORYBOARD") ||
      item.scope !== ["SCRIPT", "STORYBOARD"][index] ||
      seen.has(item.scope) ||
      typeof item.status !== "string" ||
      !["CURRENT", "NOT_BOUND", "BLOCKED", "UNKNOWN"].includes(item.status) ||
      !code(item.code)
    )
      return false;
    seen.add(item.scope);
  }
  return v.blockers.every(
    (item) =>
      record(item) &&
      exact(item, ["code", "scope", "message"]) &&
      code(item.code) &&
      typeof item.scope === "string" &&
      [
        "ASSEMBLY",
        "SCRIPT",
        "STORYBOARD",
        "MEDIA",
        "SOUND",
        "SUBTITLE",
        "PICTURE_LOCK",
        "FINISHING",
        "RELEASE",
      ].includes(item.scope) &&
      typeof item.message === "string" &&
      [...item.message].length >= 1 &&
      [...item.message].length <= 240,
  );
}
