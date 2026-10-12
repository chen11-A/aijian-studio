import type { DraftReviewTarget } from "./adapters/draftReview";
import type { DraftReviewRevisionSegment } from "./adapters/draftReviewRevision";

export function TargetEvidence({ target, label }: { target: DraftReviewTarget; label: string }) {
  return (
    <details>
      <summary>{label}精确版本与文件证据</summary>
      <p>
        项目：{target.project_id} · 分集：{target.episode_id}
      </p>
      <p>导出：{target.operation_id}</p>
      <p>
        装配 v{target.assembly_version_number}：{target.assembly_version_id}
      </p>
      <p>装配校验值：{target.assembly_content_hash}</p>
      <p>
        文件 SHA-256：{target.output_sha256} · {target.output_bytes} 字节
      </p>
      <p>
        {label}：{target.total_frames} 帧 · {target.frame_rate_num}/{target.frame_rate_den} fps
      </p>
    </details>
  );
}
export function SegmentEvidence({
  segment,
  label,
}: {
  segment: DraftReviewRevisionSegment;
  label: string;
}) {
  return (
    <div>
      <p>
        {segment.track_kind} · {segment.segment_id} · {label}帧 [{segment.start_frame},{" "}
        {segment.end_frame})
      </p>
      {segment.storyboard_ref && (
        <p>
          镜头：{segment.storyboard_ref.shot_id} · 原分镜：
          {segment.storyboard_ref.storyboard_version_id}
        </p>
      )}
      <details>
        <summary>片段版本证据</summary>
        <p>{segment.segment_hash}</p>
        {segment.media && (
          <>
            <p>
              素材：{segment.media.asset_id} · {segment.media.asset_version_id}
            </p>
            <p>{segment.media.sha256}</p>
          </>
        )}
      </details>
    </div>
  );
}
