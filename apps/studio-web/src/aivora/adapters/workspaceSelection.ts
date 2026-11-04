export const WORKSPACE_SELECTION_STORAGE_KEY = "aivora.c2b.workspace-selection.v1";
const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;
const EPISODE_ID_PATTERN = /^ep_(?:prj_)?[0-9a-f]{32}$/;

export type EpisodeCreateMarker = "PENDING" | "UNKNOWN";
export type WorkspaceSelection = { projectId: string; episodeId: string | null };
export type WorkspaceSelectionSnapshot = {
  selection: WorkspaceSelection | null;
  createMarkers: Readonly<Record<string, EpisodeCreateMarker>>;
  reviewOperations?: Readonly<Record<string, string>>;
};
export type WorkspaceSelectionRead =
  { kind: "READY"; snapshot: WorkspaceSelectionSnapshot } | { kind: "UNAVAILABLE" | "CORRUPT" };

type StoredWorkspaceSelection = {
  version: 1;
  selection: WorkspaceSelection | null;
  createMarkers: Record<string, EpisodeCreateMarker>;
  reviewOperations?: Readonly<Record<string, string>>;
};
const emptySnapshot = (): WorkspaceSelectionSnapshot => ({ selection: null, createMarkers: {} });
const isProjectId = (value: unknown): value is string =>
  typeof value === "string" && PROJECT_ID_PATTERN.test(value);
const isEpisodeId = (value: unknown): value is string =>
  typeof value === "string" && EPISODE_ID_PATTERN.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSelection = (value: unknown): value is WorkspaceSelection =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  isProjectId(value.projectId) &&
  (value.episodeId === null || isEpisodeId(value.episodeId));

function parse(value: string | null): WorkspaceSelectionRead {
  if (value === null) return { kind: "READY", snapshot: emptySnapshot() };
  try {
    const candidate: unknown = JSON.parse(value);
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some(
        (key) => !["version", "selection", "createMarkers", "reviewOperations"].includes(key),
      ) ||
      candidate.version !== 1 ||
      !Object.hasOwn(candidate, "selection") ||
      !Object.hasOwn(candidate, "createMarkers")
    )
      return { kind: "CORRUPT" };
    if (candidate.selection !== null && !isSelection(candidate.selection))
      return { kind: "CORRUPT" };
    if (!isRecord(candidate.createMarkers)) return { kind: "CORRUPT" };
    const createMarkers: Record<string, EpisodeCreateMarker> = {};
    for (const [projectId, marker] of Object.entries(candidate.createMarkers)) {
      if (!isProjectId(projectId) || (marker !== "PENDING" && marker !== "UNKNOWN"))
        return { kind: "CORRUPT" };
      createMarkers[projectId] = marker;
    }
    if (
      candidate.reviewOperations !== undefined &&
      (!isRecord(candidate.reviewOperations) ||
        Object.keys(candidate.reviewOperations).length > 64 ||
        Object.entries(candidate.reviewOperations).some(([scope, operation]) => {
          const [project, episode, extra] = scope.split("/");
          return (
            extra !== undefined ||
            !isProjectId(project) ||
            !isEpisodeId(episode) ||
            typeof operation !== "string" ||
            !/^dmp_[0-9a-f]{32}$/.test(operation)
          );
        }))
    )
      return { kind: "CORRUPT" };
    return {
      kind: "READY",
      snapshot: {
        selection: candidate.selection,
        createMarkers,
        ...(candidate.reviewOperations !== undefined
          ? { reviewOperations: candidate.reviewOperations as Record<string, string> }
          : {}),
      },
    };
  } catch {
    return { kind: "CORRUPT" };
  }
}

export function readWorkspaceSelection(storage: Pick<Storage, "getItem">): WorkspaceSelectionRead {
  try {
    return parse(storage.getItem(WORKSPACE_SELECTION_STORAGE_KEY));
  } catch {
    return { kind: "UNAVAILABLE" };
  }
}

export function persistWorkspaceSelection(
  storage: Pick<Storage, "getItem" | "setItem">,
  snapshot: WorkspaceSelectionSnapshot,
): boolean {
  try {
    const stored = readWorkspaceSelection(storage);
    if (stored.kind !== "READY") return false;
    const normalized: StoredWorkspaceSelection = {
      version: 1,
      selection: snapshot.selection,
      createMarkers: { ...snapshot.createMarkers },
      ...(stored.snapshot.reviewOperations
        ? { reviewOperations: stored.snapshot.reviewOperations }
        : {}),
    };
    storage.setItem(WORKSPACE_SELECTION_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function withWorkspaceSelection(
  snapshot: WorkspaceSelectionSnapshot,
  selection: WorkspaceSelection | null,
): WorkspaceSelectionSnapshot {
  if (selection !== null && !isSelection(selection)) return snapshot;
  return { ...snapshot, selection, createMarkers: { ...snapshot.createMarkers } };
}

export function withEpisodeCreateMarker(
  snapshot: WorkspaceSelectionSnapshot,
  projectId: string,
  marker: EpisodeCreateMarker | null,
): WorkspaceSelectionSnapshot {
  if (!isProjectId(projectId)) return snapshot;
  const createMarkers = { ...snapshot.createMarkers };
  if (marker) createMarkers[projectId] = marker;
  else delete createMarkers[projectId];
  return { ...snapshot, createMarkers };
}

/** UI cursor only; notes, plans, approvals and outputs stay in the backend. */
export function persistDraftReviewSelection(
  storage: Pick<Storage, "getItem" | "setItem">,
  projectId: string,
  episodeId: string,
  operationId: string,
): boolean {
  if (
    !isProjectId(projectId) ||
    !isEpisodeId(episodeId) ||
    (operationId !== "" && !/^dmp_[0-9a-f]{32}$/.test(operationId))
  )
    return false;
  const stored = readWorkspaceSelection(storage);
  if (stored.kind !== "READY") return false;
  const reviewOperations = { ...stored.snapshot.reviewOperations };
  const scope = `${projectId}/${episodeId}`;
  if (operationId) reviewOperations[scope] = operationId;
  else delete reviewOperations[scope];
  if (Object.keys(reviewOperations).length > 64) return false;
  try {
    storage.setItem(
      WORKSPACE_SELECTION_STORAGE_KEY,
      JSON.stringify({ version: 1, ...stored.snapshot, reviewOperations }),
    );
    const confirmed = readWorkspaceSelection(storage);
    return (
      confirmed.kind === "READY" &&
      (confirmed.snapshot.reviewOperations?.[scope] ?? "") === operationId
    );
  } catch {
    return false;
  }
}
