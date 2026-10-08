"""Migration 36: durable local draft MP4 operations, separate from release claims."""

DRAFT_EXPORT_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE draft_export_jobs (
        operation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        assembly_version_id TEXT NOT NULL,
        assembly_content_hash TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        request_json TEXT NOT NULL,
        provenance_json TEXT NOT NULL,
        target_key TEXT NOT NULL UNIQUE,
        output_path TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
            'QUEUED','RUNNING','VERIFYING','SUCCEEDED','FAILED','CANCELLED','INTERRUPTED')),
        progress_frames INTEGER NOT NULL DEFAULT 0 CHECK (progress_frames >= 0),
        total_frames INTEGER NOT NULL CHECK (total_frames > 0),
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0,1)),
        toolchain_profile_id TEXT NOT NULL,
        output_sha256 TEXT,
        output_bytes INTEGER,
        verification_json TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id, episode_id) REFERENCES episodes(project_id, id),
        CHECK (progress_frames <= total_frames),
        CHECK (status != 'SUCCEEDED' OR (
            length(output_sha256) = 64 AND output_bytes > 0 AND verification_json IS NOT NULL
        ))
    )
    """,
    "CREATE INDEX draft_export_episode ON draft_export_jobs(project_id, episode_id, created_at)",
    """
    CREATE TRIGGER draft_export_identity_immutable
    BEFORE UPDATE OF operation_id, project_id, episode_id, assembly_version_id,
        assembly_content_hash, request_hash, request_json, provenance_json,
        target_key, output_path, total_frames, toolchain_profile_id, created_at
    ON draft_export_jobs
    BEGIN SELECT RAISE(ABORT, 'Draft export identity is immutable'); END
    """,
)
