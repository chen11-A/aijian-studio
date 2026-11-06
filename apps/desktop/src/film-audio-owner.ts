import { DatabaseSync } from "node:sqlite";
import { originalCleanRecoveryProof } from "./clean-copy-recovery-proof";
/** Read-only SHA/assembly linkage for a returned voice asset; no filename heuristics,
 * provider calls, database writes or broad project-folder grants. */
export function storyFilmAudioOwner(
  databasePath: string,
  projectId: string,
  sha: string,
  selected?: { path: string; sha: string },
): boolean {
  let database: DatabaseSync | undefined;
  try {
    if (!/^prj_[a-f0-9]{32}$/.test(projectId) || !/^[a-f0-9]{64}$/.test(sha)) return false;
    const proof = selected
      ? originalCleanRecoveryProof(databasePath, projectId, selected.path, selected.sha)
      : undefined;
    if (selected && !proof) return false;
    database = new DatabaseSync(databasePath, { readOnly: true });
    if (!selected)
      return Boolean(
        database
          .prepare(
            "SELECT version.id FROM media_asset_versions AS version JOIN media_assets AS asset ON asset.id=version.asset_id WHERE version.project_id=? AND asset.project_id=? AND asset.deleted_at IS NULL AND version.sha256=?",
          )
          .get(projectId, projectId, sha),
      );
    const version = database
      .prepare(
        "SELECT version.content_json FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id=version.artifact_id WHERE version.version_id=? AND artifact.project_id=? AND artifact.artifact_type='episode_media_assembly'",
      )
      .get(proof!.assemblyVersionId, projectId);
    const content = JSON.parse(String(version?.content_json));
    const segments = Array.isArray(content.audio_segments) ? content.audio_segments : [];
    return segments.some(
      (segment: { media?: { asset_id?: unknown; asset_version_id?: unknown } }) => {
        const ref = segment?.media;
        if (typeof ref?.asset_id !== "string" || typeof ref.asset_version_id !== "string")
          return false;
        return Boolean(
          database!
            .prepare(
              "SELECT version.id FROM media_asset_versions AS version JOIN media_assets AS asset ON asset.id=version.asset_id WHERE version.id=? AND version.asset_id=? AND version.project_id=? AND asset.project_id=? AND asset.deleted_at IS NULL AND version.sha256=?",
            )
            .get(ref.asset_version_id, ref.asset_id, projectId, projectId, sha),
        );
      },
    );
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
