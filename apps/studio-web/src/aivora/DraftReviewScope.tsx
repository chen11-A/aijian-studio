import type { DraftReviewData } from "./adapters/draftReview";

export function DraftReviewScope({ data }: { data: DraftReviewData }) {
  const target = data.target;
  return (
    <>
      <p>
        装配 v{target.assembly_version_number} · {target.total_frames} 帧 · {target.frame_rate_num}/
        {target.frame_rate_den} fps
      </p>
      <details>
        <summary>此记录的精确版本与文件证据</summary>
        <p>
          项目：{target.project_id} · 分集：{target.episode_id}
        </p>
        <p>导出：{target.operation_id}</p>
        <p>装配：{target.assembly_version_id}</p>
        <p>装配校验值：{target.assembly_content_hash}</p>
        <p>
          文件 SHA-256：{target.output_sha256} · {target.output_bytes} 字节
        </p>
      </details>
      {data.version_status === "OLDER_VERSION" && (
        <div role="status">
          <p>装配已有新版本。以下评论仅对应旧版文件和原帧号，不会自动迁移到新版。</p>
          <details>
            <summary>查看当前版本差异</summary>
            <p>{data.current_assembly_version_id}</p>
            <p>{data.current_assembly_content_hash}</p>
          </details>
        </div>
      )}
      {data.version_status === "UNKNOWN" && (
        <p role="alert">当前装配版本无法可靠读取，不能认定这些评论对应最新版本。</p>
      )}
      {!data.output_verified && (
        <p role="alert">原草稿文件已缺失或变化。历史评论保留，可补充处理说明；新增评论已暂停。</p>
      )}
    </>
  );
}
