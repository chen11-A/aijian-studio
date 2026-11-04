import type { DraftExportJob, DraftExportOutputIdentity } from "./draftExport";

export const DRAFT_PREVIEW_LIMIT_BYTES = 32 * 1024 * 1024;
export const DRAFT_PREVIEW_TOO_LARGE =
  "草稿超过 32 MiB 内嵌预览上限。可打开所在文件夹，使用本地播放器查看；不会上传文件。";

export function draftOutputIdentityMatches(
  identity: unknown,
  job: DraftExportJob,
): identity is DraftExportOutputIdentity {
  if (!identity || typeof identity !== "object") return false;
  return (
    "project_id" in identity &&
    identity.project_id === job.project_id &&
    "episode_id" in identity &&
    identity.episode_id === job.episode_id &&
    "operation_id" in identity &&
    identity.operation_id === job.operation_id &&
    "output_sha256" in identity &&
    identity.output_sha256 === job.output_sha256 &&
    typeof identity.output_sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(identity.output_sha256) &&
    "output_bytes" in identity &&
    identity.output_bytes === job.output_bytes &&
    typeof identity.output_bytes === "number" &&
    Number.isSafeInteger(identity.output_bytes) &&
    identity.output_bytes > 0
  );
}
const outputErrors: Record<string, string> = {
  OUTPUT_BUSY: "已有草稿文件正在核验，请等待当前操作完成后重试。",
  RECEIPT_MISMATCH: "任务记录身份不符，已停止打开。请重新读取任务。",
  NOT_SUCCEEDED: "草稿尚未成功完成，不能打开。请重新读取任务。",
  UNSAFE_PATH: "草稿保存路径不安全，已停止打开。请核对文件位置。",
  FILE_UNAVAILABLE: "草稿文件不可用或已移走，请核对原保存位置。",
  FILE_CHANGED: "草稿文件已变化，已停止打开。请核对原文件或重新导出。",
  HASH_MISMATCH: "草稿文件校验值已变化，已停止打开。请核对原文件或重新导出。",
  INVALID_MP4: "草稿文件不符合 MP4 校验要求，已停止打开。请重新导出。",
  OUTPUT_TOO_LARGE: "草稿超过本地验证大小上限，已停止打开。请重新导出较短草稿。",
  REVEAL_FAILED: "系统未能打开草稿所在文件夹，请稍后重试或核对保存位置。",
};
export function draftOutputFailure(result: unknown): string {
  if (result && typeof result === "object" && "kind" in result) {
    if (result.kind === "PREVIEW_TOO_LARGE") return DRAFT_PREVIEW_TOO_LARGE;
    if (result.kind === "NOT_FOUND") return "草稿任务记录不存在，请重新读取任务。";
    if (result.kind === "DEFINITE_SERVER_ERROR")
      return "草稿文件请求被拒绝，请重新读取任务并核对原文件。";
    if (
      result.kind === "OUTPUT_UNAVAILABLE" &&
      "code" in result &&
      typeof result.code === "string"
    ) {
      const notice = Object.hasOwn(outputErrors, result.code)
        ? outputErrors[result.code]
        : undefined;
      return notice ?? "草稿文件验证失败，已停止打开。请重新读取任务。";
    }
  }
  return "草稿文件操作结果未知，请重新读取任务后重试；尚未确认成功。";
}
