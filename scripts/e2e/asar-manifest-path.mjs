import path from "node:path";

// @electron/asar traverses using path.sep, while receipts deliberately use '/'.
export function asarManifestPath(relative, platformPath = path) {
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[:\\]/.test(part))) {
    throw new Error("Expected a plain relative POSIX manifest path");
  }
  return platformPath.join(...parts);
}
