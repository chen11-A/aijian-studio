"""Conservative operation ledger and immutable official proposal adoption receipts."""

OFFICIAL_TEXT_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE official_text_operations (
        operation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('REMOTE_UNKNOWN', 'COMPLETED', 'NOT_SENT')),
        error_code TEXT,
        proposal_version_id TEXT REFERENCES artifact_versions(version_id),
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id, episode_id) REFERENCES episodes(project_id, id),
        CHECK ((status = 'COMPLETED') = (proposal_version_id IS NOT NULL)),
        CHECK ((status = 'NOT_SENT') = (error_code IS NOT NULL))
    )
    """,
    "CREATE INDEX official_text_episode "
    "ON official_text_operations(project_id, episode_id, created_at)",
    """
    CREATE TRIGGER official_text_request_immutable BEFORE UPDATE ON official_text_operations
    WHEN OLD.operation_id <> NEW.operation_id OR OLD.project_id <> NEW.project_id
      OR OLD.episode_id <> NEW.episode_id OR OLD.request_json <> NEW.request_json
      OR OLD.request_hash <> NEW.request_hash OR OLD.created_at <> NEW.created_at
      OR OLD.status <> 'REMOTE_UNKNOWN' OR NEW.status = 'REMOTE_UNKNOWN'
    BEGIN SELECT RAISE(ABORT, 'Official text operation cannot be rewritten'); END
    """,
    """
    CREATE TABLE official_text_adoptions (
        operation_id TEXT PRIMARY KEY REFERENCES official_text_operations(operation_id),
        proposal_version_id TEXT NOT NULL REFERENCES artifact_versions(version_id),
        proposal_content_hash TEXT NOT NULL,
        script_version_id TEXT NOT NULL UNIQUE REFERENCES artifact_versions(version_id),
        script_content_hash TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        adopted_at TEXT NOT NULL
    )
    """,
    """
    CREATE TRIGGER official_text_adoption_immutable BEFORE UPDATE ON official_text_adoptions
    BEGIN SELECT RAISE(ABORT, 'Official text adoption is immutable'); END
    """,
)
