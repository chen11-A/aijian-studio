"""SQLite schema for provider connection metadata.

Secrets are deliberately excluded and live in the operating-system credential vault.
"""

MIGRATION_7 = (
    """
    CREATE TABLE provider_connections (
        connection_id TEXT PRIMARY KEY,
        provider_kind TEXT NOT NULL CHECK (
            provider_kind IN ('OPENAI', 'XAI', 'OPENAI_COMPATIBLE', 'OLLAMA')
        ),
        display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
        base_url TEXT NOT NULL CHECK (length(base_url) BETWEEN 1 AND 2048),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        models_json TEXT NOT NULL CHECK (json_valid(models_json)),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE UNIQUE INDEX provider_connections_name_unique
    ON provider_connections(lower(display_name))
    """,
)
