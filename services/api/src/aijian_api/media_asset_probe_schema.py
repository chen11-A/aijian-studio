"""Immutable local video probe evidence; repository owner registers migration 30."""

MEDIA_ASSET_PROBE_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE media_asset_probe_evidence (
        id TEXT PRIMARY KEY CHECK (id GLOB 'mpe_*'),
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        asset_sha256 TEXT NOT NULL CHECK (length(asset_sha256) = 64),
        byte_size INTEGER NOT NULL CHECK (typeof(byte_size) = 'integer' AND byte_size > 0),
        probe_json TEXT NOT NULL,
        probe_sha256 TEXT NOT NULL CHECK (length(probe_sha256) = 64),
        toolchain_profile_id TEXT NOT NULL,
        toolchain_version TEXT NOT NULL,
        ffmpeg_sha256 TEXT NOT NULL CHECK (length(ffmpeg_sha256) = 64),
        ffprobe_sha256 TEXT NOT NULL CHECK (length(ffprobe_sha256) = 64),
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id, asset_id, version_id)
            REFERENCES media_asset_versions(project_id, asset_id, id) ON DELETE CASCADE,
        UNIQUE (project_id, asset_id, version_id)
    )
    """,
    "CREATE INDEX media_asset_probe_project ON media_asset_probe_evidence(project_id, asset_id)",
    """
    CREATE TRIGGER media_asset_probe_no_update
    BEFORE UPDATE ON media_asset_probe_evidence
    BEGIN SELECT RAISE(ABORT, 'media probe evidence is immutable'); END
    """,
    """
    CREATE TRIGGER media_asset_probe_no_direct_delete
    BEFORE DELETE ON media_asset_probe_evidence
    WHEN EXISTS (
        SELECT 1 FROM media_asset_versions AS version
        WHERE version.project_id = OLD.project_id
          AND version.asset_id = OLD.asset_id AND version.id = OLD.version_id
    )
    BEGIN SELECT RAISE(ABORT, 'active media probe evidence cannot be deleted'); END
    """,
)
