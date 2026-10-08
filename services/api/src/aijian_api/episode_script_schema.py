"""Add Episode scope to the existing artifact truth and script write receipts.

The repository migration runner must disable foreign keys for this table rebuild,
run these statements in one transaction, check foreign_key_check, and restore them.
Existing project-scoped artifacts retain NULL episode_id and every original ID.
"""

EPISODE_SCRIPT_MIGRATION: tuple[str, ...] = (
    "CREATE UNIQUE INDEX episodes_project_id_id ON episodes(project_id, id)",
    """
    CREATE TABLE artifacts_new (
        artifact_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        artifact_type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        episode_id TEXT,
        FOREIGN KEY (project_id, episode_id)
            REFERENCES episodes(project_id, id) ON DELETE CASCADE
    )
    """,
    """
    INSERT INTO artifacts_new (artifact_id, project_id, artifact_type, created_at, episode_id)
    SELECT artifact_id, project_id, artifact_type, created_at, NULL FROM artifacts
    """,
    "DROP TABLE artifacts",
    "ALTER TABLE artifacts_new RENAME TO artifacts",
    """
    CREATE UNIQUE INDEX artifacts_one_project_scope
    ON artifacts(project_id, artifact_type) WHERE episode_id IS NULL
    """,
    """
    CREATE UNIQUE INDEX artifacts_one_episode_scope
    ON artifacts(project_id, episode_id, artifact_type) WHERE episode_id IS NOT NULL
    """,
    """
    CREATE UNIQUE INDEX artifacts_scope_identity
    ON artifacts(project_id, episode_id, artifact_id)
    """,
    """
    CREATE TABLE episode_script_write_requests (
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL
            CHECK (length(idempotency_key_hash) = 71 AND idempotency_key_hash LIKE 'sha256:%'),
        request_hash TEXT NOT NULL
            CHECK (length(request_hash) = 71 AND request_hash LIKE 'sha256:%'),
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, episode_id, idempotency_key_hash),
        FOREIGN KEY (project_id, episode_id, artifact_id)
            REFERENCES artifacts(project_id, episode_id, artifact_id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TRIGGER episode_script_write_requests_no_update
    BEFORE UPDATE ON episode_script_write_requests
    BEGIN SELECT RAISE(ABORT, 'EpisodeScript write receipt is immutable'); END
    """,
)
