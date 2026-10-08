"""Project-owned media bytes and immutable version metadata.

The repository owner assigns the global migration number and registers this tuple.
The media store never initializes a second database or changes PRAGMA user_version.
"""

MEDIA_ASSET_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE media_assets (
        id TEXT PRIMARY KEY CHECK (id GLOB 'asset_*'),
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE (project_id, id)
    )
    """,
    """
    CREATE TABLE media_asset_versions (
        id TEXT PRIMARY KEY CHECK (id GLOB 'asv_*'),
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (typeof(ordinal) = 'integer' AND ordinal > 0),
        filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
        kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL CHECK (typeof(byte_size) = 'integer' AND byte_size > 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        rights_status TEXT NOT NULL CHECK (
            rights_status IN ('PENDING_REVIEW', 'CLEARED', 'RESTRICTED')
        ),
        source_kind TEXT NOT NULL CHECK (source_kind IN ('LOCAL_IMPORT')),
        technical_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id, asset_id)
            REFERENCES media_assets(project_id, id) ON DELETE CASCADE,
        UNIQUE (asset_id, ordinal),
        UNIQUE (project_id, asset_id, id)
    )
    """,
    """
    CREATE TABLE media_asset_episode_references (
        project_id TEXT NOT NULL,
        episode_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 80),
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, episode_id, asset_id, role),
        FOREIGN KEY (project_id, episode_id)
            REFERENCES episodes(project_id, id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, asset_id, version_id)
            REFERENCES media_asset_versions(project_id, asset_id, id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    )
    """,
    "CREATE INDEX media_assets_project ON media_assets(project_id, created_at DESC)",
    "CREATE INDEX media_asset_versions_asset ON media_asset_versions(asset_id, ordinal DESC)",
    "CREATE INDEX media_asset_versions_hash ON media_asset_versions(sha256)",
    "CREATE INDEX media_asset_refs_asset ON media_asset_episode_references(asset_id)",
    """
    CREATE TRIGGER media_asset_versions_no_update
    BEFORE UPDATE ON media_asset_versions
    BEGIN SELECT RAISE(ABORT, 'media asset versions are immutable'); END
    """,
)
