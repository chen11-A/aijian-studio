import type {
  SourceManifestResponse,
  SourceManifestReviewCapability,
  SourceManifestReviewIdentity,
  SourceManifestReviewOperationResult,
} from "../../api/studio";

export function sourceReviewIdentity(
  manifest: SourceManifestResponse | null | undefined,
  projectId: string,
): SourceManifestReviewIdentity | null {
  if (!manifest || manifest.data.project_id !== projectId) return null;
  const {
    head,
    latest_version: latest,
    review_version: review,
    accepted_version: accepted,
  } = manifest.data;
  if (
    head.latest_version_id !== latest.id ||
    head.artifact_id !== latest.artifact_id ||
    !/^prj_[0-9a-f]{32}$/.test(projectId) ||
    !/^ver_[0-9a-f]{32}$/.test(latest.id) ||
    !/^sha256:[0-9a-f]{64}$/.test(latest.content_hash) ||
    !Number.isSafeInteger(head.revision) ||
    head.revision < 1 ||
    head.revision >= Number.MAX_SAFE_INTEGER ||
    (head.review_version_id ?? null) !== (review?.id ?? null) ||
    (head.accepted_version_id ?? null) !== (accepted?.id ?? null)
  )
    return null;
  return {
    project_id: projectId,
    version_id: latest.id,
    content_hash: latest.content_hash,
    expected_revision: head.revision,
  };
}
export type ReviewAction = "submit" | "confirm_baseline" | "copy_draft";

/** A rejected bridge call is treated as state-unknown and remains locked until a fresh manifest read. */
export function createSourceReviewRunner(capability: SourceManifestReviewCapability | undefined) {
  const locks = new Set<string>();
  return {
    isLocked(projectId: string) {
      return locks.has(projectId);
    },
    clear(projectId: string) {
      locks.delete(projectId);
    },
    async run(
      action: ReviewAction,
      identity: SourceManifestReviewIdentity | null,
      rationale: string,
    ): Promise<SourceManifestReviewOperationResult | null> {
      if (!capability || !identity || locks.has(identity.project_id)) return null;
      if (
        action === "confirm_baseline" &&
        (![...rationale.trim()].length || [...rationale.trim()].length > 1000)
      )
        return null;
      locks.add(identity.project_id);
      let result: SourceManifestReviewOperationResult;
      try {
        result =
          action === "submit"
            ? await capability.submit(identity)
            : action === "copy_draft"
              ? await capability.copyDraft(identity)
              : await capability.confirmBaseline({ ...identity, rationale: rationale.trim() });
      } catch {
        result = {
          kind: "REMOTE_UNKNOWN",
          phase: "preflight",
          identity,
          completed_actions: [],
          receipts: [],
        };
      }
      if (result.kind !== "REMOTE_UNKNOWN") locks.delete(identity.project_id);
      return result;
    },
  };
}
