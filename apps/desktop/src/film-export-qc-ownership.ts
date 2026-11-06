import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
function samePath(left: unknown, right: string) {
  if (typeof left !== "string") return false;
  if (left === right) return true;
  try {
    return relative(realpathSync.native(left), realpathSync.native(right)) === "";
  } catch {
    return false;
  }
}
/** Read-only evidence, same story-film/draft-export records used by clean-copy recovery. */
export function storyFilmQcOwner(
  databasePath: string,
  projectId: string,
  path: string,
  sha256: string,
): boolean {
  if (!/^prj_[0-9a-f]{32}$/.test(projectId) || !/^[0-9a-f]{64}$/.test(sha256)) return false;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const outputs = database
      .prepare(
        "SELECT output_path, output_sha256 FROM draft_export_jobs WHERE project_id = ? AND status = 'SUCCEEDED' AND output_sha256 = ?",
      )
      .all(projectId, sha256);
    if (outputs.some((row) => samePath(row.output_path, path))) return true;
    const rows = database
      .prepare(
        "SELECT artifact.artifact_type, artifact.episode_id, version.content_json FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id WHERE artifact.project_id = ? AND artifact.artifact_type IN ('story_film','story_film_clean_copy') AND version.content_json LIKE ?",
      )
      .all(projectId, `%${sha256}%`);
    return rows.some((row) => {
      try {
        const content: unknown = JSON.parse(String(row.content_json));
        if (
          !content ||
          typeof content !== "object" ||
          !("output_sha256" in content) ||
          content.output_sha256 !== sha256 ||
          !("assembly_version_id" in content) ||
          typeof content.assembly_version_id !== "string"
        )
          return false;
        if (
          row.artifact_type === "story_film_clean_copy" &&
          (!("output_path" in content) || !samePath(content.output_path, path))
        )
          return false;
        const owner = database!
          .prepare(
            "SELECT artifact.project_id, artifact.episode_id FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id WHERE version.version_id = ? AND artifact.artifact_type = 'episode_media_assembly'",
          )
          .get(content.assembly_version_id);
        return (
          owner?.project_id === projectId &&
          typeof owner.episode_id === "string" &&
          (row.episode_id === null || row.episode_id === owner.episode_id)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  } finally {
    database?.close();
  }
}
