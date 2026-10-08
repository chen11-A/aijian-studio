import type {
  AssemblyContent,
  AssemblyStoryboardRef,
  AssemblyVisualSegment,
} from "./episodeMediaAssembly";
import { sameStoryboardJson, type StoryboardVersion } from "./episodeStoryboard";

/** Only the explicitly selected segment changes. Splits keep their own independent links. */
export function bindAssemblyShot(
  content: AssemblyContent,
  segmentId: string,
  reference: AssemblyStoryboardRef | null,
): AssemblyContent {
  return {
    ...content,
    visual_segments: content.visual_segments.map((segment) => {
      if (segment.segment_id !== segmentId) return segment;
      const unlinked = { ...segment };
      delete unlinked.storyboard_ref;
      return reference ? { ...unlinked, storyboard_ref: reference } : unlinked;
    }),
  };
}

export function storyboardImpact(
  segment: AssemblyVisualSegment,
  pinned: StoryboardVersion,
  latest: StoryboardVersion,
): string | null {
  const reference = segment.storyboard_ref;
  if (!reference || pinned.version_id === latest.version_id) return null;
  const before = pinned.content.shots.find((shot) => shot.shot_id === reference.shot_id);
  const after = latest.content.shots.find((shot) => shot.shot_id === reference.shot_id);
  if (!after) return "最新分镜已不含此镜头；当前片段保留原版本引用。请核对后明确另选镜头。";
  if (
    !sameStoryboardJson(before, after) ||
    pinned.content.fps !== latest.content.fps ||
    pinned.content.script_version_id !== latest.content.script_version_id ||
    pinned.content.creative_library_version_id !== latest.content.creative_library_version_id
  )
    return "这个镜头或其上游版本已变化；当前素材仍引用旧分镜，需要人工核对画面与声音。";
  return "已有新版分镜；当前片段仍固定旧版。同编号镜头内容未变，引用不会自动升级。";
}
