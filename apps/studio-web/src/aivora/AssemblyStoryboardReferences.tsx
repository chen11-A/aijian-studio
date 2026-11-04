import { useState } from "react";
import { Button } from "./Common";
import {
  useAssemblyStoryboardSources,
  type AssemblyStoryboardGateway,
} from "./useAssemblyStoryboardSources";
import { bindAssemblyShot, storyboardImpact } from "./adapters/assemblyStoryboard";
import type { AssemblyContent } from "./adapters/episodeMediaAssembly";
import { useVisualAuthority, visualAuthorityLabel } from "./useVisualAuthority";
import { Select } from "./Select";

/** A provenance edit over real imported media, with no fulfillment or review claim. */
export function AssemblyStoryboardReferences({
  content,
  selectedId,
  locked,
  onEdit,
  gateway,
}: {
  content: AssemblyContent;
  selectedId: string;
  locked: boolean;
  onEdit: (next: AssemblyContent) => boolean;
  gateway?: AssemblyStoryboardGateway;
}) {
  const segment = content.visual_segments.find((item) => item.segment_id === selectedId);
  const reference = segment?.storyboard_ref;
  const { latest, pinned, refresh } = useAssemblyStoryboardSources(
    content.project_id,
    content.episode_id,
    reference?.storyboard_version_id,
    gateway,
  );
  const latestVersion = latest.version;
  const pinnedVersion = pinned.version;
  const visualPin =
    pinnedVersion && "visual_bible_pin" in pinnedVersion.content
      ? pinnedVersion.content.visual_bible_pin
      : null;
  const { authority: visualAuthority } = useVisualAuthority(
    content.project_id,
    visualPin?.version_id,
    visualPin?.content_hash,
  );
  const pinnedShot = pinnedVersion?.content.shots.find(
    (shot) => shot.shot_id === reference?.shot_id,
  );
  const choiceKey = `${content.project_id}/${content.episode_id}/${selectedId}/${latestVersion?.version_id ?? ""}`;
  const [choice, setChoice] = useState({ key: "", shotId: "" });
  const shotId =
    choice.key === choiceKey
      ? choice.shotId
      : latestVersion?.content.shots.some((shot) => shot.shot_id === reference?.shot_id)
        ? reference!.shot_id
        : "";
  const candidate = latestVersion?.content.shots.find((shot) => shot.shot_id === shotId);
  const unchanged =
    reference?.storyboard_version_id === latestVersion?.version_id && reference?.shot_id === shotId;
  const impact =
    segment && pinnedVersion && latestVersion
      ? storyboardImpact(segment, pinnedVersion, latestVersion)
      : null;
  const linked = content.visual_segments.filter((item) => item.storyboard_ref).length;
  const sourceUnavailable = !!reference && (pinned.state !== "ready" || !pinnedShot);
  const { num, den } = content.sequence_timebase.frame_rate;
  const timingDiffers =
    segment &&
    pinnedShot &&
    pinnedVersion &&
    (pinnedVersion.content.fps * den !== num ||
      pinnedShot.duration_frames * num !==
        (segment.end_frame - segment.start_frame) * pinnedVersion.content.fps * den);
  function bind() {
    if (locked || !segment || !candidate || !latestVersion || sourceUnavailable || unchanged)
      return;
    if (
      reference &&
      !window.confirm(
        `将所选片段从分镜 ${reference.storyboard_version_id} / ${reference.shot_id} 改绑到 v${latestVersion.version_number}「${candidate.title}」？只改变来源标记，素材和剪辑范围不会自动更新；${segment.manual_candidate_ref ? "同时解除原手工候选来源；" : ""}旧保存版本保留。`,
      )
    )
      return;
    onEdit(
      bindAssemblyShot(content, segment.segment_id, {
        storyboard_version_id: latestVersion.version_id,
        shot_id: candidate.shot_id,
      }),
    );
  }
  return (
    <details className="assembly-storyboard-references" aria-label="画面片段分镜来源">
      <summary>
        分镜来源 · {linked}/{content.visual_segments.length} 个片段已关联
        {impact ? " · 上游有变化，请核对" : ""}
      </summary>
      <div className="assembly-storyboard-body">
        <header className="assembly-actions">
          <h3>分镜来源 · 画面片段</h3>
          <Button disabled={locked || latest.state === "loading"} onClick={refresh}>
            核对最新分镜
          </Button>
        </header>
        <p>
          {linked} / {content.visual_segments.length}{" "}
          个画面片段已标记来源。关联仅记录创作意图，不代表镜头完成或审片通过。
        </p>
        {!segment ? (
          <p>先选择一个画面片段，再关联本集已保存的分镜镜头。</p>
        ) : (
          <>
            {segment.manual_candidate_ref && (
              <p>重绑定或解除分镜来源会同时解除此片段的手工候选来源；请明确核对后再操作。</p>
            )}
            <p>
              所选片段：{segment.segment_id} · 素材版本 {segment.media.asset_version_id}
            </p>
            {reference ? (
              <>
                <p>
                  固定来源：{reference.storyboard_version_id} / {reference.shot_id}
                </p>
                {pinnedShot && pinnedVersion && (
                  <p>
                    分镜 v{pinnedVersion.version_number} · {pinnedShot.ordinal}. {pinnedShot.title}
                  </p>
                )}
                {visualPin && (
                  <p role="status">
                    此来源固定视觉版本 {visualPin.version_id}：
                    {visualAuthorityLabel(visualAuthority)}
                    。历史剪辑保留；新保存和另行草稿导出会重新核对，失效时拒绝，不自动改绑。
                  </p>
                )}
                {sourceUnavailable && (
                  <p role="status">
                    固定分镜尚未可靠读回，现有引用已保留；暂不能改绑，请重试核对。
                  </p>
                )}
                {impact && (
                  <p role="status" className="assembly-notice">
                    {impact}
                  </p>
                )}
                {reference && latest.state === "empty" && (
                  <p role="status">最新分镜不可用，原版本引用仍保留。</p>
                )}
                {timingDiffers && (
                  <p>
                    分镜计划 {pinnedShot!.duration_frames} 帧 / {pinnedVersion!.content.fps}{" "}
                    fps；当前片段 {segment.end_frame - segment.start_frame} 帧 / {num}/{den}{" "}
                    fps。来源标记不会改变剪辑时长或帧率。
                  </p>
                )}
              </>
            ) : (
              <p>此片段尚未关联分镜；已有本地素材不代表已完成某个镜头。</p>
            )}
            {latest.state === "loading" && <p role="status">正在读取已保存分镜…</p>}
            {latest.state === "error" && (
              <p role="status">最新分镜读取未完成。可重试核对；现有引用和剪辑保持不变。</p>
            )}
            {latest.state === "empty" && (
              <p>本集还没有已保存分镜。可先到「分镜」手动保存，再回来关联。</p>
            )}
            {latestVersion && (
              <>
                <label>
                  本集已保存分镜镜头
                  <Select
                    value={shotId}
                    disabled={locked || sourceUnavailable}
                    onChange={(event) => setChoice({ key: choiceKey, shotId: event.target.value })}
                  >
                    <option value="">选择镜头 · 分镜 v{latestVersion.version_number}</option>
                    {latestVersion.content.shots.map((shot) => (
                      <option key={shot.shot_id} value={shot.shot_id}>
                        {shot.ordinal}. {shot.title} · {shot.duration_frames} 帧
                      </option>
                    ))}
                  </Select>
                </label>
                {!latestVersion.content.shots.length && <p>这个已保存分镜还没有镜头。</p>}
                <Button
                  disabled={locked || !candidate || sourceUnavailable || unchanged}
                  onClick={bind}
                >
                  {reference ? "将所选片段改绑到此镜头" : "关联所选镜头"}
                </Button>
              </>
            )}
            {reference && (
              <Button
                disabled={locked}
                onClick={() => {
                  if (
                    !locked &&
                    window.confirm(
                      "移除所选片段的分镜来源标记？素材和旧保存版本保留，此修改可撤销。",
                    )
                  )
                    onEdit(bindAssemblyShot(content, segment.segment_id, null));
                }}
              >
                移除所选片段的分镜引用
              </Button>
            )}
          </>
        )}
        <p>新关联或改绑需要保存本集剪辑。分割和裁剪保留原来源；刷新与分镜更新不会自动改绑。</p>
      </div>
    </details>
  );
}
