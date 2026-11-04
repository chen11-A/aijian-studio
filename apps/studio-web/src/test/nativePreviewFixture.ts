import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visualJson } from "@aijian/contracts/visual-bible";
import type { NativePreviewPlanResponse } from "@aijian/contracts/native-preview-plan";
import type { AssemblyVersion } from "../aivora/adapters/episodeMediaAssembly";
export function previewFixture(): NativePreviewPlanResponse {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../packages/contracts/fixtures/native-preview-plan.json"),
      "utf8",
    ),
  );
}
export function previewSaved(receipt = previewFixture()): AssemblyVersion {
  const plan = receipt.data.plan,
    source = plan.source,
    clip = plan.video_tracks[0]!.clips[0]!;
  const media = {
    asset_id: clip.media.asset_id,
    asset_version_id: clip.media.asset_version_id,
    sha256: clip.media.sha256,
  };
  return {
    artifact_id: source.assembly_artifact_id!,
    version_id: source.assembly_version_id!,
    content_hash: source.assembly_content_hash!,
    head_revision: source.assembly_head_revision!,
    parent_version_id: null,
    playback_status: "DRAFT_VIDEO_PREVIEW",
    export_status: "NO_EXPORT_CLAIM",
    media_checks: [
      {
        media,
        kind: "video",
        availability: "VERIFIED",
        technical_status: "PROBED_CFR_VIDEO",
        rights_status: "PENDING_REVIEW",
        rights_decision_id: null,
      },
    ],
    content: {
      schema_version: "1.0.0",
      project_id: source.project_id,
      episode_id: source.episode_id,
      sequence_timebase: plan.sequence_timebase,
      canvas_width: plan.canvas_width,
      canvas_height: plan.canvas_height,
      total_frames: plan.total_frames,
      visual_segments: [
        {
          segment_id: clip.clip_id,
          media_kind: "video",
          media,
          start_frame: clip.start_frame,
          end_frame: clip.end_frame,
          source_in_frame: clip.source_in_frame,
          embedded_audio: clip.embedded_audio,
          storyboard_ref: null,
        },
      ],
      audio_segments: [],
      subtitle_segments: [],
    },
  };
}
export function rehashPreview(receipt: NativePreviewPlanResponse) {
  receipt.data.plan_hash = `sha256:${createHash("sha256").update(visualJson(receipt.data.plan)).digest("hex")}`;
  return receipt;
}
