import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
function builtIndex(root: string) {
  try {
    const path = join(root, "resource-index.json"),
      info = lstatSync(path);
    if (!info.isFile() || info.size <= 0 || info.size > 2 * 1024 * 1024) return false;
    const index = JSON.parse(readFileSync(path, "utf8"));
    return (
      index.schemaVersion === 1 &&
      index.createdBy === "aivora-bundled-audio-builder" &&
      Number.isInteger(index.assetCount) &&
      index.assetCount > 0 &&
      index.assetCount <= 1000 &&
      /^[a-f0-9]{64}$/.test(index.manifestSha256) &&
      /^[a-f0-9]{64}$/.test(index.loaderSha256) &&
      Array.isArray(index.files) &&
      index.files.length > 0
    );
  } catch {
    return false;
  }
}
/** Main-owned locations only: packaged resources, the existing Linux portable layout,
 * or compiled development resources. No cwd, environment or raw-source fallback. */
export function resolveBundledAudioLibraryRoot(host: {
  isPackaged: boolean;
  resourcesPath: string;
  mainDir: string;
}): string {
  if (host.isPackaged) return join(host.resourcesPath, "audio-library");
  const portable = resolve(host.mainDir, "../../../audio-library");
  return builtIndex(portable) ? portable : join(host.mainDir, "audio-library");
}
