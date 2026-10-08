import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { M2Stop } from './m2-once-flow.mjs';

const requireValue = (value, detail) => {
  if (!value) throw new M2Stop('TIMELINE_DEPENDENCY', detail);
};

export function verifyProvenanceRows(rows, original, edited, handoff, fake, task) {
  requireValue(rows.source_heads?.length === 1 &&
    rows.source_heads[0].accepted_version_id === handoff.accepted_version_id &&
    rows.source_heads[0].latest_version_id === handoff.accepted_version_id,
  'postclose SourceManifest head no longer accepts the selected version');
  const initial = rows.versions.filter((row) => row.version_id === original.data.version_id);
  const changed = rows.versions.filter((row) => row.version_id === edited.data.version_id);
  requireValue(initial.length === 1 && changed.length === 1,
    'initial/edited timeline version missing or ambiguous');
  for (const [row, response] of [[initial[0], original], [changed[0], edited]]) {
    requireValue(row.project_id === handoff.project_id && row.artifact_type === 'timeline' &&
      row.content_hash === response.data.content_hash,
    'DB timeline identity differs from GET');
  }
  requireValue(initial[0].artifact_id === changed[0].artifact_id &&
    changed[0].parent_version_id === initial[0].version_id,
  'edited timeline does not descend from original version');
  requireValue(initial[0].producer_attempt_id === fake.attempt_id &&
    task.output_version_id === initial[0].version_id,
  'initial timeline is not the successful task output');
  requireValue(rows.dependencies.length === 1, 'initial version dependency is not unique');
  const edge = rows.dependencies[0];
  requireValue(edge.downstream_version_id === initial[0].version_id &&
    edge.downstream_artifact_id === initial[0].artifact_id &&
    edge.upstream_version_id === handoff.accepted_version_id &&
    edge.upstream_artifact_type === 'source_manifest' &&
    edge.upstream_project_id === handoff.project_id &&
    edge.relationship === 'derived_from' && edge.impact === 'blocking',
  'initial timeline lacks accepted SourceManifest derived_from/blocking edge');
  return { kind: 'SQLITE_READ_ONLY_PROVENANCE',
    initial_version_id: initial[0].version_id,
    edited_version_id: changed[0].version_id,
    producer_attempt_id: initial[0].producer_attempt_id,
    parent_version_id: changed[0].parent_version_id,
    upstream_version_id: edge.upstream_version_id,
    relationship: edge.relationship, impact: edge.impact,
    dependency_id: edge.dependency_id };
}

export function readPostcloseProvenance(workspacePath, original, edited, handoff) {
  const databasePath = join(workspacePath, 'workspace.sqlite3');
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON');
    const versionSql = `SELECT version.version_id, version.artifact_id,
      version.parent_version_id, version.content_hash, version.producer_attempt_id,
      artifact.project_id, artifact.artifact_type
      FROM artifact_versions AS version
      JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
      WHERE artifact.project_id = ? AND version.version_id IN (?, ?)`;
    const dependencySql = `SELECT dependency.dependency_id,
      dependency.downstream_artifact_id, dependency.downstream_version_id,
      dependency.upstream_version_id, dependency.relationship, dependency.impact,
      upstream.artifact_type AS upstream_artifact_type,
      upstream.project_id AS upstream_project_id
      FROM artifact_dependencies AS dependency
      JOIN artifacts AS upstream
        ON upstream.artifact_id = dependency.upstream_artifact_id
      WHERE dependency.downstream_version_id = ?`;
    const sourceHeadSql = `SELECT head.accepted_version_id, head.latest_version_id
      FROM artifact_heads AS head
      JOIN artifacts AS artifact ON artifact.artifact_id = head.artifact_id
      WHERE artifact.project_id = ? AND artifact.artifact_type = 'source_manifest'`;
    const rows = {
      versions: db.prepare(versionSql).all(handoff.project_id,
        original.data.version_id, edited.data.version_id),
      dependencies: db.prepare(dependencySql).all(original.data.version_id),
      source_heads: db.prepare(sourceHeadSql).all(handoff.project_id),
    };
    return { database_path: databasePath, sqlite_mode: 'readOnly/query_only',
      raw_rows: rows };
  } finally { db.close(); }
}
