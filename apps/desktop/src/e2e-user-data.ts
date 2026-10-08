import { isAbsolute, relative, resolve } from "node:path";

export function resolveE2EUserDataDirectory(
  requested: string | undefined,
  allowedRoot: string,
): string | null {
  if (requested === undefined) return null;
  if (!isAbsolute(requested)) {
    throw new Error("E2E user data override must be an absolute path");
  }
  const requestedPath = resolve(requested);
  const relationship = relative(resolve(allowedRoot), requestedPath);
  if (relationship === "" || relationship.startsWith("..") || isAbsolute(relationship)) {
    throw new Error("E2E user data override must be a child of the development evidence root");
  }
  return requestedPath;
}
