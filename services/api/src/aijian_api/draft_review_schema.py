"""Schema 38: immutable draft comments and their single append-only resolution."""

DRAFT_REVIEW_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE draft_review_notes (
        note_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        operation_id TEXT NOT NULL REFERENCES draft_export_jobs(operation_id),
        assembly_version_id TEXT NOT NULL REFERENCES artifact_versions(version_id),
        target_json TEXT NOT NULL,
        target_hash TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        note_json TEXT NOT NULL,
        note_hash TEXT NOT NULL,
        FOREIGN KEY (project_id, episode_id) REFERENCES episodes(project_id, id)
    )
    """,
    "CREATE INDEX draft_review_scope ON draft_review_notes(project_id, episode_id, operation_id)",
    """
    CREATE TABLE draft_review_resolutions (
        resolution_id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL UNIQUE REFERENCES draft_review_notes(note_id),
        request_hash TEXT NOT NULL,
        resolution_json TEXT NOT NULL,
        resolution_hash TEXT NOT NULL
    )
    """,
    """
    CREATE TRIGGER draft_review_note_immutable BEFORE UPDATE ON draft_review_notes
    BEGIN SELECT RAISE(ABORT, 'Draft review note is immutable'); END
    """,
    """
    CREATE TRIGGER draft_review_note_preserved BEFORE DELETE ON draft_review_notes
    BEGIN SELECT RAISE(ABORT, 'Draft review history is preserved'); END
    """,
    """
    CREATE TRIGGER draft_review_resolution_immutable BEFORE UPDATE ON draft_review_resolutions
    BEGIN SELECT RAISE(ABORT, 'Draft review resolution is immutable'); END
    """,
    """
    CREATE TRIGGER draft_review_resolution_preserved BEFORE DELETE ON draft_review_resolutions
    BEGIN SELECT RAISE(ABORT, 'Draft review history is preserved'); END
    """,
)
