import type { AudioLibraryProvenance } from "@aijian/contracts/film-audio-library";
/** Creative source attribution only. Main never authorizes a path from this metadata. */
export function normalizeLibraryProvenance(value: unknown): AudioLibraryProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (
    !["assetId", "source", "author", "license", "sha256"].every(
      (key) =>
        typeof row[key] === "string" &&
        (row[key] as string).length > 0 &&
        (row[key] as string).length <= 4096 &&
        !(row[key] as string).includes("\0"),
    ) ||
    !/^[a-f0-9]{64}$/.test(String(row.sha256)) ||
    typeof row.loopable !== "boolean" ||
    (row.loudness !== null &&
      (typeof row.loudness !== "number" || !Number.isFinite(row.loudness))) ||
    (row.processingGainDb !== undefined &&
      (typeof row.processingGainDb !== "number" || !Number.isFinite(row.processingGainDb)))
  )
    return undefined;
  try {
    if (!["https:", "http:"].includes(new URL(String(row.source)).protocol)) return undefined;
  } catch {
    return undefined;
  }
  return {
    assetId: String(row.assetId),
    source: String(row.source),
    author: String(row.author),
    license: String(row.license),
    sha256: String(row.sha256),
    loopable: row.loopable,
    loudness: row.loudness as number | null,
    ...(typeof row.processingGainDb === "number" ? { processingGainDb: row.processingGainDb } : {}),
  };
}
