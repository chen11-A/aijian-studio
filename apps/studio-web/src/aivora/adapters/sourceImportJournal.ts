const SOURCE_IMPORT_JOURNAL_PREFIX = "aivora.source-import.v1:";
const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const SOURCE_ID_PATTERN = /^src_[0-9a-f]{32}$/;
const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RAW_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type SourceImportState = "PENDING" | "UNKNOWN";
export type SourceImportMarker = {
  operationId: string;
  rawSha256: string;
  filename: string;
  sourceId: string | null;
  state: SourceImportState;
};

export type SourceImportMarkerRead =
  { kind: "READY"; marker: SourceImportMarker | null } | { kind: "CORRUPT" | "UNAVAILABLE" };

type StoredSourceImportJournal = {
  version: 1;
  marker: SourceImportMarker;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const isProjectId = (value: unknown): value is string =>
  typeof value === "string" && PROJECT_ID_PATTERN.test(value);

const isSourceId = (value: unknown): value is string =>
  typeof value === "string" && SOURCE_ID_PATTERN.test(value);

const isOperationId = (value: unknown): value is string =>
  typeof value === "string" && OPERATION_ID_PATTERN.test(value);

const isFilename = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= 255 &&
  !Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

const isMarker = (value: unknown): value is SourceImportMarker => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["operationId", "rawSha256", "filename", "sourceId", "state"])
  )
    return false;
  return (
    isOperationId(value.operationId) &&
    typeof value.rawSha256 === "string" &&
    RAW_SHA256_PATTERN.test(value.rawSha256) &&
    isFilename(value.filename) &&
    (value.sourceId === null || isSourceId(value.sourceId)) &&
    (value.state === "PENDING" || value.state === "UNKNOWN")
  );
};

const keyFor = (projectId: string): string => `${SOURCE_IMPORT_JOURNAL_PREFIX}${projectId}`;

function parseStored(value: string | null): SourceImportMarkerRead {
  if (value === null) return { kind: "READY", marker: null };
  try {
    const candidate: unknown = JSON.parse(value);
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["version", "marker"]) ||
      candidate.version !== 1
    )
      return { kind: "CORRUPT" };
    if (!isMarker(candidate.marker)) return { kind: "CORRUPT" };
    return { kind: "READY", marker: candidate.marker };
  } catch {
    return { kind: "CORRUPT" };
  }
}

export function readSourceImportMarker(
  storage: Pick<Storage, "getItem">,
  projectId: string,
): SourceImportMarkerRead {
  if (!isProjectId(projectId)) return { kind: "CORRUPT" };
  try {
    return parseStored(storage.getItem(keyFor(projectId)));
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

function canUpdate(existing: SourceImportMarker, next: SourceImportMarker): boolean {
  if (existing.operationId.toLowerCase() !== next.operationId.toLowerCase()) return false;
  if (existing.rawSha256 !== next.rawSha256 || existing.filename !== next.filename) return false;
  if (existing.sourceId !== null && existing.sourceId !== next.sourceId) return false;
  if (existing.sourceId === null && next.sourceId !== null && !isSourceId(next.sourceId))
    return false;
  return existing.state !== "UNKNOWN" || next.state === "UNKNOWN";
}

// The synchronous get-then-write sequence protects ordered calls in one renderer only;
// it is not an atomic compare-and-swap across windows or renderer instances.
export function writeSourceImportMarker(
  storage: Pick<Storage, "getItem" | "setItem">,
  projectId: string,
  marker: SourceImportMarker,
): boolean {
  if (!isProjectId(projectId) || !isMarker(marker)) return false;
  try {
    const existing = parseStored(storage.getItem(keyFor(projectId)));
    if (existing.kind !== "READY") return false;
    if (existing.marker !== null && !canUpdate(existing.marker, marker)) return false;
    const stored: StoredSourceImportJournal = { version: 1, marker };
    storage.setItem(keyFor(projectId), JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

// The synchronous get-then-remove sequence has the same single-renderer boundary as write.
export function clearSourceImportMarker(
  storage: Pick<Storage, "getItem" | "removeItem">,
  projectId: string,
  operationId: string,
): boolean {
  if (!isProjectId(projectId) || !isOperationId(operationId)) return false;
  try {
    const existing = parseStored(storage.getItem(keyFor(projectId)));
    if (existing.kind !== "READY") return false;
    if (existing.marker === null) return true;
    if (existing.marker.operationId.toLowerCase() !== operationId.toLowerCase()) return false;
    storage.removeItem(keyFor(projectId));
    return true;
  } catch {
    return false;
  }
}
