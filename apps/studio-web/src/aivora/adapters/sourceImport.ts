import type { SourceDocumentResponse, StudioTransport } from "../../api/studio";

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
export type SourceImportResult =
  | { kind: "SUCCEEDED"; response: SourceDocumentResponse }
  | { kind: "INVALID_INPUT"; message: string }
  | { kind: "REMOTE_UNKNOWN"; message: string };

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
  try {
    const content_base64 = await fileAsBase64(file);
    const response = await transport.importTextSource(projectId, {
      filename: file.name,
      media_type: "text/plain",
      content_base64,
    });
    return { kind: "SUCCEEDED", response };
  } catch {
    return { kind: "REMOTE_UNKNOWN", message: "导入状态未知。请刷新来源清单后再决定是否重试。" };
  }
}
