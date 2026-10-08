"""Additive organizational episodes; existing project artifacts are not reassigned."""

MIGRATION_17 = (
    """
    CREATE TABLE episodes (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position INTEGER NOT NULL CHECK (typeof(position) = 'integer' AND position >= 1),
        title TEXT NOT NULL,
        is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
        target_duration_seconds INTEGER CHECK (
            target_duration_seconds IS NULL OR (
                typeof(target_duration_seconds) = 'integer' AND target_duration_seconds > 0
            )
        ),
        revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id, position)
    )
    """,
    """
    CREATE UNIQUE INDEX episodes_one_default_per_project
    ON episodes(project_id) WHERE is_default = 1
    """,
    """
    INSERT INTO episodes (
        id, project_id, position, title, is_default, target_duration_seconds,
        revision, created_at, updated_at
    )
    SELECT 'ep_' || id, id, 1, '第 1 集', 1, target_duration_seconds, 1, created_at, updated_at
    FROM projects
    """,
)
