/**
 * What the Grok subscription OAuth token can drive.
 *
 * Proven on the owner's v0.2.6 desktop (scope `api:access`, host api.x.ai):
 * POST /v1/images/generations, POST /v1/videos/generations with
 * grok-imagine-video-1.5 (including an image), GET /v1/videos/{id}, POST /v1/tts.
 *
 * Documented, but the public examples use an API key and the model is the
 * older `grok-imagine-video`, not 1.5:
 * POST /v1/videos/edits, POST /v1/videos/extensions.
 * Those stay off until that exact model id is in the catalog this token lists.
 * A 1.5 id does not unlock them. The owner can try the real calls locally.
 */

export const GENERATE_MODEL = "grok-imagine-video-1.5";
export const VIDEO_MODEL = GENERATE_MODEL;
export const VIDEO_DRAFT_MODEL = "grok-imagine-video-1.5-lite";
export const EDIT_MODEL = "grok-imagine-video";
export const IMAGE_MODEL = "grok-imagine-image-2.0";
export const IMAGE_MODEL_RETIRES_ON = "2026-11-02";
export const TEXT_MODEL = "grok-4.7";

export type VideoAction = "regenerate" | "rewrite" | "edit" | "extend" | "voice" | "cut";

export type ActionGate = { enabled: boolean; reason: string };

export function videoActions(modelIds: readonly string[]): Record<VideoAction, ActionGate> {
  const ids = new Set(modelIds.map((id) => id.trim()));
  const hasGenerate = ids.has(GENERATE_MODEL);
  const hasEditModel = ids.has(EDIT_MODEL);
  const generateReason = hasGenerate ? "" : "需要 Grok 会员，并且模型列表里要有视频 1.5。";
  const editReason = hasEditModel
    ? ""
    : "当前登录看不到 grok-imagine-video 的编辑接口，不能改画面细节。";
  const extendReason = hasEditModel
    ? ""
    : "当前登录看不到延长接口。列表里出现 grok-imagine-video 之后才能从片尾往后接。";
  return {
    regenerate: {
      enabled: hasGenerate,
      reason: generateReason || "按原描述再生成，每个版本各算一次。",
    },
    rewrite: {
      enabled: hasGenerate,
      reason: generateReason || "改描述后再生成，每个版本各算一次。",
    },
    edit: { enabled: hasEditModel, reason: editReason || "只用文字说明改细节，没有画笔。" },
    extend: { enabled: hasEditModel, reason: extendReason || "从最后一帧往后接一段。" },
    voice: {
      enabled: hasGenerate,
      reason: generateReason || "重做这一段的旁白。视频自带的声音默认关掉。",
    },
    cut: { enabled: true, reason: "只在本地剪掉，不请求生成。" },
  };
}

export function generationReady(modelIds: readonly string[]): ActionGate {
  return videoActions(modelIds).regenerate;
}
