"""Append-only human confirmations bound to existing EpisodeScript versions.

The repository assigns this migration its global version. No script content or
second version head is stored here; accepted Gate state remains untouched.
"""

EPISODE_SCRIPT_CONFIRMATION_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE episode_script_confirmations (
        confirmation_id TEXT PRIMARY KEY
            CHECK (length(confirmation_id) = 36 AND confirmation_id LIKE 'esc_%'),
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        content_hash TEXT NOT NULL
            CHECK (length(content_hash) = 71 AND content_hash LIKE 'sha256:%'),
        head_revision INTEGER NOT NULL
            CHECK (typeof(head_revision) = 'integer' AND head_revision >= 1),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 240),
        idempotency_key_hash TEXT NOT NULL
            CHECK (length(idempotency_key_hash) = 71
                   AND idempotency_key_hash LIKE 'sha256:%'),
        request_hash TEXT NOT NULL
            CHECK (length(request_hash) = 71 AND request_hash LIKE 'sha256:%'),
        confirmed_at TEXT NOT NULL,
        UNIQUE (project_id, episode_id, idempotency_key_hash),
        FOREIGN KEY (project_id, episode_id, artifact_id)
            REFERENCES artifacts(project_id, episode_id, artifact_id) ON DELETE CASCADE,
        FOREIGN KEY (artifact_id, version_id)
            REFERENCES artifact_versions(artifact_id, version_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TRIGGER episode_script_confirmation_scope_insert
    BEFORE INSERT ON episode_script_confirmations
    WHEN NOT EXISTS (
        SELECT 1 FROM artifacts AS artifact
        JOIN artifact_versions AS version ON version.artifact_id = artifact.artifact_id
        JOIN artifact_heads AS head ON head.artifact_id = artifact.artifact_id
        WHERE artifact.artifact_id = NEW.artifact_id
          AND artifact.project_id = NEW.project_id
          AND artifact.episode_id = NEW.episode_id
          AND artifact.artifact_type = 'episode_script'
          AND version.version_id = NEW.version_id
          AND version.content_hash = NEW.content_hash
          AND head.latest_version_id = NEW.version_id
          AND head.revision = NEW.head_revision
    )
    BEGIN
        SELECT RAISE(ABORT, 'EpisodeScript confirmation must bind the current version');
    END
    """,
    """
    CREATE TRIGGER episode_script_confirmation_no_update
    BEFORE UPDATE ON episode_script_confirmations
    BEGIN SELECT RAISE(ABORT, 'EpisodeScript confirmation is immutable'); END
    """,
    """
    CREATE TRIGGER episode_script_confirmation_no_delete
    BEFORE DELETE ON episode_script_confirmations
    WHEN EXISTS (
        SELECT 1 FROM artifact_versions AS version
        WHERE version.artifact_id = OLD.artifact_id
          AND version.version_id = OLD.version_id
    )
    BEGIN SELECT RAISE(ABORT, 'EpisodeScript confirmation is immutable'); END
    """,
    """
    CREATE INDEX episode_script_confirmations_scope_order
    ON episode_script_confirmations(project_id, episode_id, confirmed_at DESC)
    """,
)
