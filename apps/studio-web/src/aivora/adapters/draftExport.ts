import { isLiteralSubtitle, subtitleTrackProblem } from "./assemblySubtitles";
import { validDialogueBinding } from "./assemblyDialogue";
import type { DraftReviewGateway } from "./draftReview";
import type { DraftReviewRevisionGateway } from "./draftReviewRevision";
import type { components } from "@aijian/contracts";
import type { AssemblyVersion } from "./episodeMediaAssembly";

export type DraftExportJob = components["schemas"]["DraftExportJob"];
export type DraftExportCommand = Omit<
  components["schemas"]["CreateDraftExportRequest"],
  "output_path"
>;
export type DraftExportFailure =
  | { kind: "DEFINITE_SERVER_ERROR"; status: number; code: string; request_id: string }
  | { kind: "REMOTE_UNKNOWN" };
export type DraftExportResult =
  | { kind: "FOUND"; receipt: { data: DraftExportJob; request_id: string } }
  | { kind: "NOT_FOUND"; request_id: string }
  | DraftExportFailure;
export type DraftExportListResult =
  | { kind: "LISTED"; receipt: { data: { items: DraftExportJob[] }; request_id: string } }
  | DraftExportFailure;
export type DraftExportSubmitResult =
  | DraftExportResult
  | { kind: "PICKER_CANCELLED" | "PICKER_BUSY" | "INVALID_DESTINATION" | "CACHE_UNAVAILABLE" };
export type DraftExportOutputIdentity = {
  project_id: string;
  episode_id: string;
  operation_id: string;
  output_sha256: string;
  output_bytes: number;
};
export type DraftExportOutputFailure =
  | DraftExportFailure
  | { kind: "NOT_FOUND"; request_id: string }
  | {
      kind: "OUTPUT_UNAVAILABLE";
      code:
        | "RECEIPT_MISMATCH"
        | "NOT_SUCCEEDED"
        | "UNSAFE_PATH"
        | "FILE_UNAVAILABLE"
        | "FILE_CHANGED"
        | "HASH_MISMATCH"
        | "INVALID_MP4"
        | "OUTPUT_TOO_LARGE"
        | "REVEAL_FAILED"
        | "OUTPUT_BUSY";
    }
  | { kind: "PREVIEW_TOO_LARGE"; output_bytes: number; limit_bytes: number };
export type DraftExportPreviewResult =
  | {
      kind: "READY";
      mime_type: "video/mp4";
      bytes: Uint8Array;
      identity: DraftExportOutputIdentity;
    }
  | DraftExportOutputFailure;
export type DraftExportRevealResult =
  { kind: "REVEALED"; identity: DraftExportOutputIdentity } | DraftExportOutputFailure;
export interface DraftExportGateway {
  createPreview?(
    projectId: string,
    episodeId: string,
    command: DraftExportCommand,
  ): Promise<DraftExportSubmitResult>;
  review?: DraftReviewGateway;
  revision?: DraftReviewRevisionGateway;
  preview?(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportPreviewResult>;
  reveal?(
    projectId: string,
    episodeId: string,
    operationId: string,
  ): Promise<DraftExportRevealResult>;
  list(projectId: string, episodeId: string): Promise<DraftExportListResult>;
  get(projectId: string, episodeId: string, operationId: string): Promise<DraftExportResult>;
  createFromPicker(
    projectId: string,
    episodeId: string,
    command: DraftExportCommand,
  ): Promise<DraftExportSubmitResult>;
  cancel(projectId: string, episodeId: string, operationId: string): Promise<DraftExportResult>;
}
export function isActiveDraftExport(job: DraftExportJob) {
  return job.status === "QUEUED" || job.status === "RUNNING" || job.status === "VERIFYING";
}
export function draftExportProblem(version: AssemblyVersion | null): string | null {
  if (!version) return "请先在成片组装中保存本集媒体装配版本。";
  const content = version.content;
  if (version.media_checks.some((check) => check.rights_status === "RESTRICTED"))
    return "存在权利受限素材，不能导出草稿。请先替换受限素材。";
  if (
    version.media_checks.some(
      (check) =>
        check.availability !== "VERIFIED" && check.availability !== "UNVERIFIED_SIZE_LIMIT",
    )
  )
    return "原素材尚未验证可用；请在素材库核对文件后重读。";
  if (
    content.audio_segments.some(
      (segment) => segment.track_kind === "DIALOGUE" && !validDialogueBinding(segment),
    )
  )
    return "对白轨缺少有效的固定剧本、段落、说话者或呈现方式；请重新绑定并保存。";
  if (content.subtitle_segments.some((cue) => !isLiteralSubtitle(cue)))
    return "旧版剧本绑定字幕尚无固定文字；请先移除或换成文字字幕并保存。";
  if (content.subtitle_segments.length > 128) return "单次草稿最多支持 128 条文字字幕。";
  const subtitleProblem = subtitleTrackProblem(content);
  if (subtitleProblem) return subtitleProblem;
  if (
    content.canvas_width > 1920 ||
    content.canvas_height > 1920 ||
    content.canvas_width % 2 ||
    content.canvas_height % 2
  )
    return "草稿画布宽高须为不超过 1920 的偶数。请修改画布并保存。";
  if (content.visual_segments.length > 32 || content.audio_segments.length > 32)
    return "单次草稿最多支持 32 个画面片段和 32 个音频片段。";
  const rate = content.sequence_timebase.frame_rate;
  if (content.total_frames * rate.den > 1800 * rate.num) return "单次草稿时长不能超过 30 分钟。";
  return null;
}
export function draftJobMatches(
  job: DraftExportJob,
  projectId: string,
  episodeId: string,
  operationId?: string,
): boolean {
  return (
    job.project_id === projectId &&
    job.episode_id === episodeId &&
    /^dmp_[0-9a-f]{32}$/.test(job.operation_id) &&
    (operationId === undefined || job.operation_id === operationId) &&
    /^ver_[0-9a-f]{32}$/.test(job.assembly_version_id) &&
    /^sha256:[0-9a-f]{64}$/.test(job.assembly_content_hash) &&
    job.draft === true &&
    job.rights_declaration === "OWNED_OR_SYNTHETIC" &&
    Number.isSafeInteger(job.total_frames) &&
    job.total_frames > 0 &&
    Number.isSafeInteger(job.progress_frames) &&
    job.progress_frames >= 0 &&
    job.progress_frames <= job.total_frames &&
    ["QUEUED", "RUNNING", "VERIFYING", "SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(
      job.status,
    ) &&
    (job.status !== "SUCCEEDED" ||
      (job.progress_frames === job.total_frames &&
        !!job.output_path &&
        typeof job.output_sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(job.output_sha256) &&
        typeof job.output_bytes === "number" &&
        Number.isSafeInteger(job.output_bytes) &&
        job.output_bytes > 0))
  );
}
export function draftExportFailure(result: DraftExportFailure | { kind: string }) {
  if (
    result.kind === "DEFINITE_SERVER_ERROR" &&
    "code" in result &&
    result.code === "DRAFT_TOOLCHAIN_UNAVAILABLE"
  )
    return "本地锁定的 FFmpeg 编码工具不可用，当前无法导出草稿。请检查桌面编码工具配置后重试。";
  return result.kind === "DEFINITE_SERVER_ERROR" && "code" in result
    ? `草稿请求被拒绝：${String(result.code)}。请核对素材或选择新的保存文件。`
    : "任务结果暂未可靠读回；将继续核对，请勿重复提交。";
}
