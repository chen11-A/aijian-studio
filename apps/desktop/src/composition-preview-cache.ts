import { lstat, mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, parse } from "node:path";
import { isDraftExportOperationId } from "./draft-export-contract";
import { hasControlCharacter } from "./api-contract-guards";

/** These are retained, journalled DRAFT outputs, not disposable temp files. */
export const COMPOSITION_PREVIEW_DIRECTORY = "composition-previews";
export function compositionPreviewFilename(operationId: string): string {
  if (!isDraftExportOperationId(operationId)) throw new Error("Invalid preview operation ID");
  return `Aivora-PREVIEW-DRAFT-${operationId}.mp4`;
}
async function plainDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(path)) !== path)
    throw new Error("Preview cache requires plain local directories");
}
/** The caller supplies Electron's trusted userData directory, never a renderer value.
 * The existing backend rechecks local-volume/path identity, reserves the unique name,
 * and publishes without overwrite. This helper never removes any output or receipt. */
export async function prepareCompositionPreviewPath(
  userData: string,
  operationId: string,
): Promise<string> {
  const filename = compositionPreviewFilename(operationId);
  if (
    !isAbsolute(userData) ||
    normalize(userData) !== userData ||
    hasControlCharacter(userData) ||
    userData.startsWith("\\") ||
    userData.startsWith("//") ||
    userData.split(/[/\\]/).some((part) => part === "." || part === "..") ||
    (process.platform !== "win32" && (userData.includes("\\") || userData.includes(":")))
  )
    throw new Error("Preview cache root is not a canonical local path");
  const ancestors = [userData];
  while (ancestors[0] !== parse(userData).root) ancestors.unshift(dirname(ancestors[0]!));
  for (const path of ancestors) await plainDirectory(path);
  const directory = join(userData, COMPOSITION_PREVIEW_DIRECTORY);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  }
  for (const path of [...ancestors, directory]) await plainDirectory(path);
  return join(directory, filename);
}
