/** Current video-only DRAFT subset. This guard never admits engineering TEST plans. */
/** @param {unknown} v @returns {v is Record<string,unknown>} */
const record = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v, keys) =>
  record(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= min && v <= max;
const id = (v, prefix) => typeof v === "string" && new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(v);
const hash = (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const contentHash = (v) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v);
const PLAN_KEYS = [
  "schema_version",
  "scope",
  "source",
  "sequence_timebase",
  "canvas_width",
  "canvas_height",
  "total_frames",
  "audio_master_sample_rate_hz",
  "audio_mix_policy",
  "subtitle_output_mode",
  "dialogue_speech_status",
  "video_overlap_mode",
  "video_tracks",
  "audio_tracks",
  "subtitle_cues",
  "video_transitions",
  "absent_test_roles",
];
/** @param {unknown} value @param {string} projectId @param {string} episodeId @param {string} versionId @param {string|null} requestId */
export function nativePreviewPlanResponse(value, projectId, episodeId, versionId, requestId) {
  if (
    !exact(value, ["data", "request_id"]) ||
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
    value.request_id !== requestId ||
    !exact(value.data, ["plan", "plan_hash"]) ||
    !contentHash(value.data.plan_hash)
  )
    return false;
  const plan = value.data.plan;
  if (
    !exact(plan, PLAN_KEYS) ||
    plan.schema_version !== 1 ||
    plan.scope !== "DRAFT_PREVIEW" ||
    !integer(plan.canvas_width, 1, 8192) ||
    !integer(plan.canvas_height, 1, 8192) ||
    !integer(plan.total_frames, 1, 1000000) ||
    plan.audio_master_sample_rate_hz !== 48000 ||
    plan.audio_mix_policy !== "SUM_NO_NORMALIZE_NO_LIMITER" ||
    plan.subtitle_output_mode !== "NONE" ||
    plan.dialogue_speech_status !== "NOT_APPLICABLE" ||
    plan.video_overlap_mode !== "EXPLICIT_TRANSITION_FOR_OVERLAP" ||
    ![plan.audio_tracks, plan.subtitle_cues, plan.video_transitions, plan.absent_test_roles].every(
      (v) => Array.isArray(v) && v.length === 0,
    )
  )
    return false;
  const source = plan.source;
  if (
    !exact(source, [
      "origin",
      "project_id",
      "episode_id",
      "assembly_artifact_id",
      "assembly_version_id",
      "assembly_content_hash",
      "assembly_head_revision",
      "test_spec_sha256",
      "fixture_manifest_sha256",
    ]) ||
    source.origin !== "EPISODE_ASSEMBLY" ||
    !id(source.project_id, "prj") ||
    source.project_id !== projectId ||
    typeof source.episode_id !== "string" ||
    !/^ep_(?:prj_)?[0-9a-f]{32}$/.test(source.episode_id) ||
    source.episode_id !== episodeId ||
    !id(source.assembly_artifact_id, "art") ||
    !id(source.assembly_version_id, "ver") ||
    source.assembly_version_id !== versionId ||
    !contentHash(source.assembly_content_hash) ||
    !integer(source.assembly_head_revision, 1) ||
    source.test_spec_sha256 !== null ||
    source.fixture_manifest_sha256 !== null
  )
    return false;
  const tb = plan.sequence_timebase;
  if (
    !exact(tb, ["frame_rate", "timecode_mode"]) ||
    !exact(tb.frame_rate, ["num", "den"]) ||
    !integer(tb.frame_rate.num, 1) ||
    !integer(tb.frame_rate.den, 1) ||
    !["NON_DROP_FRAME", "DROP_FRAME"].includes(tb.timecode_mode)
  )
    return false;
  if (!Array.isArray(plan.video_tracks) || plan.video_tracks.length !== 1) return false;
  const track = plan.video_tracks[0];
  if (
    !exact(track, ["track_id", "layer_index", "clips"]) ||
    track.track_id !== "visual_0" ||
    track.layer_index !== 0 ||
    !Array.isArray(track.clips) ||
    track.clips.length < 1 ||
    track.clips.length > 32
  )
    return false;
  const seen = new Set();
  let end = 0;
  for (const clip of track.clips) {
    if (
      !exact(clip, [
        "clip_id",
        "media",
        "start_frame",
        "end_frame",
        "source_in_frame",
        "source_frame_count",
        "embedded_audio",
        "source_width",
        "source_height",
        "scale_mode",
      ]) ||
      typeof clip.clip_id !== "string" ||
      !/^[a-z][a-z0-9._-]{0,79}$/.test(clip.clip_id) ||
      seen.has(clip.clip_id) ||
      clip.start_frame !== end ||
      !integer(clip.end_frame, end + 1, plan.total_frames) ||
      !integer(clip.source_in_frame) ||
      !integer(clip.source_frame_count, 1) ||
      clip.source_in_frame + clip.end_frame - clip.start_frame > clip.source_frame_count ||
      !["MUTE", "PLAY"].includes(clip.embedded_audio) ||
      clip.source_width !== plan.canvas_width ||
      clip.source_height !== plan.canvas_height ||
      clip.scale_mode !== "IDENTITY"
    )
      return false;
    const m = clip.media;
    if (
      !exact(m, [
        "asset_id",
        "asset_version_id",
        "sha256",
        "byte_size",
        "rights_status",
        "rights_decision_id",
        "probe_evidence_id",
        "probe_sha256",
        "inspection_sha256",
      ]) ||
      !id(m.asset_id, "asset") ||
      !id(m.asset_version_id, "asv") ||
      !hash(m.sha256) ||
      !integer(m.byte_size, 1) ||
      !["PENDING_REVIEW", "CLEARED"].includes(m.rights_status) ||
      !(m.rights_decision_id === null || id(m.rights_decision_id, "ard")) ||
      (m.rights_status === "CLEARED" && m.rights_decision_id === null) ||
      !id(m.probe_evidence_id, "mpe") ||
      !hash(m.probe_sha256) ||
      m.inspection_sha256 !== null
    )
      return false;
    end = clip.end_frame;
    seen.add(clip.clip_id);
  }
  return end === plan.total_frames;
}
