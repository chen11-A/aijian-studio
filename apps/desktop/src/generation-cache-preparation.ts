export type PreparedPrivateCache = {
  schemaVersion: 1;
  snapshotSha256: string;
  inputSha256: string;
  request: Record<string, unknown>;
  sources: { source: string; canonicalPath: string; sha256: string; mime: string }[];
  runtimeRecipe: Record<string, unknown>;
  parts: { image: CachePart; video: CachePart; voice: CachePart };
};
type CachePart = { sha256: string; bytes: number };
export type PreparedSlotCacheFact = {
  targetKey: string;
  slotIndex: 0 | 1 | 2;
  preparation: "CLIENT_IMAGES" | "STORYFILM_CACHE";
  cache: PreparedPrivateCache | null;
};
export type PreparedSlotCacheFacts = { kind: "PREPARATIONS"; items: PreparedSlotCacheFact[] };

const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function fail(): never {
  throw Error("CREATION_INPUT_UNVERIFIABLE");
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!record(value)) fail();
  return value;
}

function part(input: unknown): CachePart {
  const value = asRecord(input);
  if (!exact(value, ["sha256", "bytes"])) fail();
  if (!sha(value.sha256)) fail();
  if (!Number.isSafeInteger(value.bytes)) fail();
  const bytes = value.bytes as number;
  if (bytes < 1 || bytes > 80 * 1024 * 1024) fail();
  return { sha256: value.sha256, bytes };
}

function cache(input: unknown): PreparedPrivateCache {
  const value = asRecord(input);
  if (
    !exact(value, [
      "schema_version",
      "snapshot_sha256",
      "input_sha256",
      "request",
      "sources",
      "runtime_recipe",
      "parts",
    ])
  )
    fail();
  if (value.schema_version !== 1) fail();
  if (!sha(value.snapshot_sha256) || !sha(value.input_sha256)) fail();
  if (!record(value.request) || !record(value.runtime_recipe)) fail();
  const sourceRows = value.sources;
  if (!Array.isArray(sourceRows) || sourceRows.length > 64) fail();
  if (!record(value.parts) || !exact(value.parts, ["image", "video", "voice"])) fail();
  const sources = sourceRows.map((inputRow: unknown) => {
    const row = asRecord(inputRow);
    if (!exact(row, ["source", "canonical_path", "sha256", "mime"])) fail();
    if (typeof row.source !== "string" || !row.source || row.source.length > 4096) fail();
    if (
      typeof row.canonical_path !== "string" ||
      !row.canonical_path ||
      row.canonical_path.length > 4096
    )
      fail();
    if (typeof row.mime !== "string" || !row.mime || row.mime.length > 255) fail();
    if (!sha(row.sha256)) fail();
    return {
      source: row.source,
      canonicalPath: row.canonical_path,
      sha256: row.sha256,
      mime: row.mime,
    };
  });
  return {
    schemaVersion: 1,
    snapshotSha256: value.snapshot_sha256,
    inputSha256: value.input_sha256,
    request: value.request,
    sources,
    runtimeRecipe: value.runtime_recipe,
    parts: {
      image: part(value.parts.image),
      video: part(value.parts.video),
      voice: part(value.parts.voice),
    },
  };
}

/** Private main parser for the generated PREPARATIONS body. Cache stays out of the renderer. */
export function parseGenerationSlotPreparations(input: unknown): PreparedSlotCacheFacts {
  const payload = asRecord(input);
  if (!exact(payload, ["kind", "items"]) || payload.kind !== "PREPARATIONS") fail();
  const rows = payload.items;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 768) fail();
  const seen = new Set<string>();
  const items = rows.map((inputItem: unknown) => {
    const item = asRecord(inputItem);
    if (!exact(item, ["target_key", "slot_index", "preparation", "cache"])) fail();
    if (typeof item.target_key !== "string" || !/^[a-zA-Z0-9_:@.-]{1,160}$/.test(item.target_key))
      fail();
    if (!Number.isInteger(item.slot_index)) fail();
    const slot = item.slot_index as number;
    if (slot < 0 || slot > 2) fail();
    if (item.preparation !== "CLIENT_IMAGES" && item.preparation !== "STORYFILM_CACHE") fail();
    const id = `${item.target_key}:${slot}`;
    if (seen.has(id)) fail();
    seen.add(id);
    if (item.preparation === "CLIENT_IMAGES") {
      if (item.cache !== null) fail();
      return {
        targetKey: item.target_key,
        slotIndex: slot as 0 | 1 | 2,
        preparation: "CLIENT_IMAGES" as const,
        cache: null,
      };
    }
    if (slot !== 0) fail();
    return {
      targetKey: item.target_key,
      slotIndex: 0 as const,
      preparation: "STORYFILM_CACHE" as const,
      cache: cache(item.cache),
    };
  });
  return { kind: "PREPARATIONS", items };
}
