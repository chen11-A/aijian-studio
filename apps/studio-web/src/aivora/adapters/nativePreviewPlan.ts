import { nativePreviewPlanResponse } from "@aijian/contracts/native-preview-plan";
import { visualJson } from "@aijian/contracts/visual-bible";
import type { AssemblyVersion } from "./episodeMediaAssembly";
import type { MediaPreviewIdentity } from "./mediaPreviewSession";

export type VerifiedNativePreviewPlan = { identity: MediaPreviewIdentity; totalFrames: number };

/** Validate the sidecar plan again at the renderer boundary against the frozen saved version. */
export async function verifyNativePreviewPlan(
  value: unknown,
  saved: AssemblyVersion,
): Promise<VerifiedNativePreviewPlan | null> {
  try {
    const receipt = structuredClone(value);
    const scope = structuredClone(saved);
    const requestId =
      typeof receipt === "object" && receipt !== null && "request_id" in receipt
        ? receipt.request_id
        : null;
    if (
      typeof requestId !== "string" ||
      !nativePreviewPlanResponse(
        receipt,
        scope.content.project_id,
        scope.content.episode_id,
        scope.version_id,
        requestId,
      )
    )
      return null;
    const source = receipt.data.plan.source;
    if (
      source.assembly_artifact_id !== scope.artifact_id ||
      source.assembly_content_hash !== scope.content_hash ||
      source.assembly_head_revision !== scope.head_revision ||
      receipt.data.plan.total_frames !== scope.content.total_frames
    )
      return null;
    const plan = receipt.data.plan,
      content = scope.content;
    if (
      plan.canvas_width !== content.canvas_width ||
      plan.canvas_height !== content.canvas_height ||
      visualJson(plan.sequence_timebase) !== visualJson(content.sequence_timebase) ||
      content.audio_segments.length ||
      content.subtitle_segments.length ||
      plan.video_tracks[0]!.clips.length !== content.visual_segments.length
    )
      return null;
    for (let index = 0; index < content.visual_segments.length; index++) {
      const clip = plan.video_tracks[0]!.clips[index]!,
        segment = content.visual_segments[index]!;
      if (
        segment.media_kind !== "video" ||
        clip.clip_id !== segment.segment_id ||
        clip.start_frame !== segment.start_frame ||
        clip.end_frame !== segment.end_frame ||
        clip.source_in_frame !== segment.source_in_frame ||
        clip.embedded_audio !== segment.embedded_audio ||
        clip.media.asset_id !== segment.media.asset_id ||
        clip.media.asset_version_id !== segment.media.asset_version_id ||
        clip.media.sha256 !== segment.media.sha256
      )
        return null;
    }
    const canonical = visualJson(receipt.data.plan);
    const bytes = new TextEncoder().encode(canonical);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (hash !== receipt.data.plan_hash) return null;
    return {
      identity: {
        project_id: scope.content.project_id,
        episode_id: scope.content.episode_id,
        assembly_artifact_id: scope.artifact_id,
        assembly_version_id: scope.version_id,
        assembly_content_hash: scope.content_hash,
        assembly_head_revision: scope.head_revision,
        plan_hash: hash,
      },
      totalFrames: receipt.data.plan.total_frames,
    };
  } catch {
    return null;
  }
}
