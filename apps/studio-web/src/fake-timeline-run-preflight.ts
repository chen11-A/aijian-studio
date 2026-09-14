import type {
  FakeTimelineRunCreateInput,
  ProjectData,
  SourceDocumentResponse,
  SourceManifestResponse,
} from "./api/studio";

export type FakeTimelinePreflight =
  | { kind: "ready"; input: FakeTimelineRunCreateInput }
  | {
      kind: "unavailable";
      reason:
        | "accepted-manifest-required"
        | "source-project-mismatch"
        | "source-not-in-accepted-manifest";
    };

/** Development-only command preflight. It has no renderer or production entry dependency. */
export function prepareFakeTimelineRun(
  project: Pick<ProjectData, "id">,
  source: Pick<SourceDocumentResponse, "data">,
  manifest: SourceManifestResponse | null,
): FakeTimelinePreflight {
  const accepted = manifest?.data.accepted_version;
  if (
    !manifest ||
    manifest.data.project_id !== project.id ||
    !manifest.data.head.accepted_version_id ||
    !accepted ||
    accepted.id !== manifest.data.head.accepted_version_id
  ) {
    return { kind: "unavailable", reason: "accepted-manifest-required" };
  }
  if (source.data.project_id !== project.id) {
    return { kind: "unavailable", reason: "source-project-mismatch" };
  }
  if (
    !accepted.content.documents.some((document) => document.source_document_id === source.data.id)
  ) {
    return { kind: "unavailable", reason: "source-not-in-accepted-manifest" };
  }
  return {
    kind: "ready",
    input: {
      source_manifest_version_id: accepted.id,
      source_document_id: source.data.id,
    },
  };
}
