import type { AssemblyContent, AssemblyTextSubtitleSegment } from "./episodeMediaAssembly";

export const SUBTITLE_PROFILE = "noto-cjk-sc-bottom-v1" as const;
export function subtitleTextProblem(text: string): string | null {
  const lines = text.split("\n");
  if (lines.length > 2 || lines.some((line) => !line.trim() || [...line].length > 28))
    return "字幕需为 1–2 行非空文字，每行最多 28 个字符。";
  if (
    ![...text].every((c) =>
      /^[\x20-\x7e\u4e00-\u9fff\u3000-\u3029\u3030-\u303f\uff01-\uff5e\n‘’“”—…]$/u.test(c),
    )
  )
    return "当前仅支持基础汉字、ASCII 英文数字和常用中文标点；暂不支持 emoji、组合字形或其他文字。";
  return null;
}
export function isLiteralSubtitle(value: unknown): value is AssemblyTextSubtitleSegment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const cue = value as Record<string, unknown>;
  return (
    Object.keys(cue).length === 5 &&
    typeof cue.segment_id === "string" &&
    /^seg_[a-z0-9._-]{1,80}$/.test(cue.segment_id) &&
    Number.isSafeInteger(cue.start_frame) &&
    Number(cue.start_frame) >= 0 &&
    Number.isSafeInteger(cue.end_frame) &&
    Number(cue.end_frame) > Number(cue.start_frame) &&
    cue.render_profile === SUBTITLE_PROFILE &&
    typeof cue.text === "string" &&
    subtitleTextProblem(cue.text) === null
  );
}
export function subtitleTrackProblem(content: AssemblyContent): string | null {
  for (const cue of content.subtitle_segments) {
    if ("text" in cue && !isLiteralSubtitle(cue)) return "字幕文字、样式或整数帧范围无效。";
  }
  const ordered = [...content.subtitle_segments].sort((a, b) => a.start_frame - b.start_frame);
  if (
    ordered.some((cue, index) =>
      ordered
        .slice(0, index)
        .some(
          (before) => before.end_frame > cue.start_frame && ("text" in before || "text" in cue),
        ),
    )
  )
    return "字幕范围不能重叠；请调整入点或出点。";
  return null;
}
