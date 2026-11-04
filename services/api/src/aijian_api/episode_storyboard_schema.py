"""Migration 35: episode-scoped immutable manual storyboard write receipts."""

EPISODE_STORYBOARD_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE episode_storyboard_write_requests (
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
    CREATE TRIGGER episode_storyboard_write_requests_no_update
    BEFORE UPDATE ON episode_storyboard_write_requests
    BEGIN SELECT RAISE(ABORT, 'EpisodeStoryboard write receipt is immutable'); END
    """,
)
