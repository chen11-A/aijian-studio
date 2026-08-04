export function cacheRecentVersion<T extends { id: string }>(
  current: ReadonlyMap<string, T>,
  version: T,
  maxEntries = 3,
): Map<string, T> {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError("maxEntries must be a positive safe integer");
  }

  const next = new Map(current);
  next.delete(version.id);
  next.set(version.id, version);

  while (next.size > maxEntries) {
    const oldest = next.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    next.delete(oldest);
  }

  return next;
}

export function touchRecentVersion<T extends { id: string }>(
  current: Map<string, T>,
  versionId: string,
): Map<string, T> {
  const version = current.get(versionId);
  if (!version || [...current.keys()].at(-1) === versionId) return current;
  return cacheRecentVersion(current, version);
}
