import type { SourceDocumentResponse, StudioTransport } from "../../api/studio";

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export type SourceImportResult =
  | { kind: "SUCCEEDED"; response: SourceDocumentResponse; normalizedText: string }
  | { kind: "INVALID_INPUT"; message: string }
  | {
      kind: "REMOTE_UNKNOWN";
      message: string;
      sourceId?: string;
      projectId?: string;
      rawSha256?: string;
    };

export async function readSourceDocumentText(
  transport: StudioTransport,
  projectId: string,
  source: SourceDocumentResponse["data"],
): Promise<string> {
  if (!transport.getSourceText) throw new Error("完整来源正文读取能力不可用");
  const response = await transport.getSourceText(projectId, source.id);
  const data = response.data;
  const normalizedBytes = new TextEncoder().encode(data.normalized_text);
  if (normalizedBytes.byteLength > MAX_SOURCE_BYTES)
    throw new Error("完整来源正文超过 5 MiB，已阻止读取");
  const digest = await crypto.subtle.digest("SHA-256", normalizedBytes);
  const normalizedSha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (
    data.id !== source.id ||
    data.project_id !== projectId ||
    source.project_id !== projectId ||
    !/^[0-9a-f]{64}$/.test(data.raw_sha256) ||
    !/^[0-9a-f]{64}$/.test(source.raw_sha256) ||
    data.raw_sha256 !== source.raw_sha256 ||
    !/^[0-9a-f]{64}$/.test(data.normalized_sha256) ||
    normalizedSha256 !== data.normalized_sha256
  )
    throw new Error("完整来源正文的身份或规范化哈希不匹配");
  return data.normalized_text;
}

function sourceBlocksMatch(
  expected: SourceDocumentResponse["data"]["blocks"],
  actual: SourceDocumentResponse["data"]["blocks"],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((block, index) => {
      const readback = actual[index];
      return (
        !!readback &&
        block.id === readback.id &&
        block.ordinal === readback.ordinal &&
        block.kind === readback.kind &&
        block.chapter_index === readback.chapter_index &&
        block.text === readback.text &&
        block.normalized_start_byte === readback.normalized_start_byte &&
        block.normalized_end_byte === readback.normalized_end_byte &&
        block.content_sha256 === readback.content_sha256
      );
    })
  );
}

export async function sourceFileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateSourceFile(file: File): string | null {
  if (!file.name.toLowerCase().endsWith(".txt")) return "请选择扩展名为 .txt 的 UTF-8 文本。";
  if (file.size > MAX_SOURCE_BYTES) return "文件超过 5 MiB，请拆分后再导入。";
  return null;
}

export function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取文件"));
    reader.onload = () => {
      if (typeof reader.result !== "string") return reject(new Error("无法读取文件"));
      const separator = reader.result.indexOf(",");
      if (separator < 0) return reject(new Error("无法读取文件"));
      resolve(reader.result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export async function importTextSource(
  transport: StudioTransport,
  projectId: string,
  file: File,
): Promise<SourceImportResult> {
  const invalid = validateSourceFile(file);
  if (invalid) return { kind: "INVALID_INPUT", message: invalid };
  let raw_sha256: string | undefined;
  try {
    raw_sha256 = await sourceFileSha256(file);
    const content_base64 = await fileAsBase64(file);
    const response = await transport.importTextSource(projectId, {
      filename: file.name,
      media_type: "text/plain",
      content_base64,
    });
    let readback: SourceDocumentResponse;
    let normalizedText: string;
    try {
      readback = await transport.getSource(projectId, response.data.id);
      normalizedText = await readSourceDocumentText(transport, projectId, readback.data);
    } catch {
      return {
        kind: "REMOTE_UNKNOWN",
        message: "来源已提交但读回状态未知。请刷新来源状态后再决定是否重试。",
        sourceId: response.data.id,
        projectId,
        rawSha256: raw_sha256,
      };
    }
    if (
      readback.data.id !== response.data.id ||
      readback.data.project_id !== projectId ||
      response.data.project_id !== projectId ||
      !raw_sha256 ||
      response.data.raw_sha256 !== raw_sha256 ||
      readback.data.raw_sha256 !== raw_sha256 ||
      !sourceBlocksMatch(response.data.blocks, readback.data.blocks)
    )
      return {
        kind: "REMOTE_UNKNOWN",
        message: "来源已提交但身份或正文读回不一致。请刷新来源状态后再决定是否重试。",
        sourceId: response.data.id,
        projectId,
        rawSha256: raw_sha256,
      };
    return { kind: "SUCCEEDED", response: readback, normalizedText };
  } catch {
    return {
      kind: "REMOTE_UNKNOWN",
      message: "导入状态未知。请刷新来源清单后再决定是否重试。",
      projectId,
      rawSha256: raw_sha256,
    };
  }
}
