import { DatabaseSync } from "node:sqlite";
import { realpathSync } from "node:fs";
/** Exact original post-tag SHA, original draft path and assembly chain. Read-only and fail closed. */
export function originalCleanRecoveryProof(
  databasePath: string,
  projectId: string,
  path: string,
  sha256: string,
): { assemblyVersionId: string; hasBurnedSubtitles: boolean } | null {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database
      .prepare(
        "SELECT version.content_json FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id=version.artifact_id WHERE artifact.project_id=? AND artifact.artifact_type='story_film' AND version.content_json LIKE ?",
      )
      .all(projectId, `%${sha256}%`);
    for (const row of rows) {
      let manifest: Record<string, unknown>;
      try {
        manifest = JSON.parse(String(row.content_json));
      } catch {
        continue;
      }
      if (
        manifest.output_sha256 !== sha256 ||
        typeof manifest.assembly_version_id !== "string" ||
        typeof manifest.draft_operation_id !== "string"
      )
        continue;
      const assembly = database
        .prepare(
          "SELECT artifact.project_id,artifact.episode_id,version.content_hash,version.content_json FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id=version.artifact_id WHERE version.version_id=? AND artifact.artifact_type='episode_media_assembly'",
        )
        .get(manifest.assembly_version_id);
      if (
        assembly?.project_id !== projectId ||
        typeof assembly.episode_id !== "string" ||
        assembly.content_hash !== manifest.assembly_content_hash
      )
        continue;
      const job = database
        .prepare(
          "SELECT output_path,assembly_content_hash FROM draft_export_jobs WHERE project_id=? AND episode_id=? AND operation_id=? AND assembly_version_id=? AND status='SUCCEEDED'",
        )
        .get(
          projectId,
          assembly.episode_id,
          manifest.draft_operation_id,
          manifest.assembly_version_id,
        );
      if (
        typeof job?.output_path !== "string" ||
        job.assembly_content_hash !== manifest.assembly_content_hash ||
        realpathSync.native(job.output_path) !== realpathSync.native(path)
      )
        continue;
      const assemblyContent = JSON.parse(String(assembly.content_json));
      if (!assemblyContent || typeof assemblyContent !== "object" || Array.isArray(assemblyContent))
        continue;
      return {
        assemblyVersionId: manifest.assembly_version_id,
        hasBurnedSubtitles:
          assemblyContent.subtitle_segments === undefined
            ? false
            : Array.isArray(assemblyContent.subtitle_segments)
              ? assemblyContent.subtitle_segments.length > 0
              : true,
      };
    }
    return null;
  } catch {
    return null;
  } finally {
    database?.close();
  }
}
/** A newly returned clean file needs its own final post-tag evidence, never a draft SHA. */
export function finalCleanRecoveryProof(
  databasePath: string,
  projectId: string,
  path: string,
  sha256: string,
): boolean {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database
      .prepare(
        "SELECT artifact.episode_id,version.content_json FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id=version.artifact_id WHERE artifact.project_id=? AND artifact.artifact_type='story_film_clean_copy' AND version.content_json LIKE ?",
      )
      .all(projectId, `%${sha256}%`);
    return rows.some((row) => {
      try {
        const content = JSON.parse(String(row.content_json));
        if (
          content.output_sha256 !== sha256 ||
          typeof content.output_path !== "string" ||
          realpathSync.native(content.output_path) !== realpathSync.native(path) ||
          typeof content.assembly_version_id !== "string"
        )
          return false;
        const assembly = database!
          .prepare(
            "SELECT artifact.project_id,artifact.episode_id,version.content_hash,version.content_json FROM artifact_versions AS version JOIN artifacts AS artifact ON artifact.artifact_id=version.artifact_id WHERE version.version_id=? AND artifact.artifact_type='episode_media_assembly'",
          )
          .get(content.assembly_version_id);
        return (
          assembly?.project_id === projectId &&
          typeof assembly.episode_id === "string" &&
          assembly.episode_id === row.episode_id &&
          assembly.content_hash === content.assembly_content_hash
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
