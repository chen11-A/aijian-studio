"""Migration 34: idempotent creative-library writes in the existing SQLite truth."""

PROJECT_CREATIVE_LIBRARY_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE project_creative_library_write_requests (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        idempotency_key_hash TEXT NOT NULL
            CHECK (length(idempotency_key_hash) = 71 AND idempotency_key_hash LIKE 'sha256:%'),
        request_hash TEXT NOT NULL
            CHECK (length(request_hash) = 71 AND request_hash LIKE 'sha256:%'),
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, idempotency_key_hash),
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TRIGGER project_creative_library_write_requests_no_update
    BEFORE UPDATE ON project_creative_library_write_requests
    BEGIN SELECT RAISE(ABORT, 'Creative library write receipt is immutable'); END
    """,
)
