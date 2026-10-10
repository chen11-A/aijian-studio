import type { components } from "@aijian/contracts";
import type { DraftExportJob } from "./draftExport";
import type { DraftReviewNote, DraftReviewTarget } from "./draftReview";
import type {
  DraftReviewRevisionData,
  DraftReviewRevisionScopeData,
  DraftReviewRevisionSegment,
} from "./draftReviewRevision";
export const sourceJob: DraftExportJob = {
  project_id: `prj_${"1".repeat(32)}`,
  episode_id: `ep_${"2".repeat(32)}`,
  operation_id: `dmp_${"3".repeat(32)}`,
  assembly_version_id: `ver_${"4".repeat(32)}`,
  assembly_content_hash: `sha256:${"5".repeat(64)}`,
  output_sha256: "6".repeat(64),
  output_bytes: 100,
  total_frames: 50,
  progress_frames: 50,
  status: "SUCCEEDED",
  output_filename: "source-DRAFT.mp4",
  output_path: "/tmp/source-DRAFT.mp4",
  draft: true,
  rights_declaration: "OWNED_OR_SYNTHETIC",
  toolchain_profile_id: "test",
  created_at: "2026-10-09T20:00:00Z",
  updated_at: "2026-10-09T20:01:00Z",
  error_code: null,
  error_message: null,
};
export const source: DraftReviewTarget = {
  project_id: sourceJob.project_id,
  episode_id: sourceJob.episode_id,
  operation_id: sourceJob.operation_id,
  assembly_version_id: sourceJob.assembly_version_id,
  assembly_content_hash: sourceJob.assembly_content_hash,
  output_sha256: "6".repeat(64),
  output_bytes: 100,
  assembly_version_number: 1,
  total_frames: 50,
  frame_rate_num: 25,
  frame_rate_den: 1,
};
export const savedNote: DraftReviewNote = {
  note_id: `drn_${"7".repeat(32)}`,
  frame_index: 12,
  text: "核对动作连续性",
  actor_id: "local-user",
  created_at: "2026-10-09T20:02:00Z",
  revision: 1,
  resolution: null,
};
export const sourceSegment: DraftReviewRevisionSegment = {
  segment_id: "seg_visual_1",
  track_kind: "VISUAL",
  start_frame: 0,
  end_frame: 25,
  segment_hash: `sha256:${"8".repeat(64)}`,
  media: {
    asset_id: `asset_${"9".repeat(32)}`,
    asset_version_id: `asv_${"a".repeat(32)}`,
    sha256: "b".repeat(64),
  },
  storyboard_ref: {
    storyboard_version_id: `ver_${"c".repeat(32)}`,
    shot_id: `shp_${"d".repeat(32)}`,
  },
};
export const plan: components["schemas"]["DraftReviewRevisionPlan"] = {
  plan_id: `drp_${"d".repeat(32)}`,
  source,
  notes: [
    {
      note_id: savedNote.note_id,
      frame_index: savedNote.frame_index,
      text: savedNote.text,
      actor_id: savedNote.actor_id,
      created_at: savedNote.created_at,
    },
  ],
  affected_segments: [sourceSegment],
  instruction: "调整此镜头动作衔接",
  actor_id: "local-user",
  created_at: "2026-10-09T20:03:00Z",
  plan_hash: `sha256:${"e".repeat(64)}`,
};
export const approval: components["schemas"]["DraftReviewRevisionApproval"] = {
  approval_id: `dra_${"f".repeat(32)}`,
  plan_id: plan.plan_id,
  plan_hash: plan.plan_hash,
  assembly_version_number_at_approval: 1,
  actor_id: "local-user",
  created_at: "2026-10-09T20:04:00Z",
};
export const candidateJob: DraftExportJob = {
  ...sourceJob,
  operation_id: `dmp_${"a".repeat(32)}`,
  assembly_version_id: `ver_${"b".repeat(32)}`,
  assembly_content_hash: `sha256:${"c".repeat(64)}`,
  output_sha256: "d".repeat(64),
  output_bytes: 200,
  output_filename: "candidate-DRAFT.mp4",
  output_path: "/tmp/candidate-DRAFT.mp4",
  total_frames: 60,
  progress_frames: 60,
  created_at: "2026-10-09T20:05:00Z",
  updated_at: "2026-10-09T20:06:00Z",
};
export const candidate: components["schemas"]["DraftReviewRevisionCandidate"] = {
  candidate_id: `drc_${"1".repeat(32)}`,
  plan_id: plan.plan_id,
  plan_hash: plan.plan_hash,
  approval_id: approval.approval_id,
  target: {
    ...source,
    operation_id: candidateJob.operation_id,
    assembly_version_id: candidateJob.assembly_version_id,
    assembly_content_hash: candidateJob.assembly_content_hash,
    output_sha256: "d".repeat(64),
    output_bytes: 200,
    assembly_version_number: 2,
    total_frames: 60,
  },
  segments: [{ ...sourceSegment, end_frame: 30, segment_hash: `sha256:${"2".repeat(64)}` }],
  comparison: {
    unchanged_segment_ids: [],
    changed_segment_ids: [sourceSegment.segment_id],
    removed_segment_ids: [],
    added_segment_ids: [],
    out_of_scope_segment_ids: [],
    sequence_settings_changed: true,
  },
  change_summary: "已调整动作并另行导出新版",
  actor_id: "local-user",
  created_at: "2026-10-09T20:07:00Z",
  candidate_hash: `sha256:${"3".repeat(64)}`,
};
export const recheck: components["schemas"]["DraftReviewRevisionRecheck"] = {
  recheck_id: `drk_${"4".repeat(32)}`,
  candidate_id: candidate.candidate_id,
  candidate_hash: candidate.candidate_hash,
  outcome: "MANUALLY_CHECKED",
  reason: "人工核对候选版衔接",
  actor_id: "local-user",
  created_at: "2026-10-09T20:08:00Z",
};
export function revisionData(): DraftReviewRevisionData {
  return { source, output_verified: true, plans: [], manual_review_only: true };
}
export function revisionScope(): DraftReviewRevisionScopeData {
  return { source, output_verified: true, segments: [sourceSegment], manual_review_only: true };
}
export function plannedData(): DraftReviewRevisionData {
  return { ...revisionData(), plans: [{ plan, approval: null, candidates: [] }] };
}
export function candidateData(): DraftReviewRevisionData {
  return {
    ...revisionData(),
    plans: [{ plan, approval, candidates: [{ candidate, output_verified: true, recheck: null }] }],
  };
}
export const requestId = "00000000-0000-4000-8000-000000000001";
