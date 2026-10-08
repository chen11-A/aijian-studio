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


def migration_20_statements() -> tuple[str, ...]:
    """Add a distinct CPA loopback kind without weakening historical provider rules."""
    return (
        """
        CREATE TABLE provider_connections_v20 (
            connection_id TEXT PRIMARY KEY,
            provider_kind TEXT NOT NULL CHECK (
                provider_kind IN ('OPENAI', 'XAI', 'OPENAI_COMPATIBLE', 'OLLAMA', 'CPA_LOOPBACK')
            ),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
            base_url TEXT NOT NULL CHECK (length(base_url) BETWEEN 1 AND 2048),
            enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            models_json TEXT NOT NULL CHECK (json_valid(models_json)),
            revision INTEGER NOT NULL CHECK (revision >= 1),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (provider_kind <> 'CPA_LOOPBACK'
                   OR base_url = 'http://127.0.0.1:8317')
        )
        """,
        """
        INSERT INTO provider_connections_v20 (
            connection_id, provider_kind, display_name, base_url, enabled,
            models_json, revision, created_at, updated_at
        )
        SELECT connection_id, provider_kind, display_name, base_url, enabled,
               models_json, revision, created_at, updated_at
        FROM provider_connections
        """,
        "DROP TABLE provider_connections",
        "ALTER TABLE provider_connections_v20 RENAME TO provider_connections",
        """
        CREATE UNIQUE INDEX provider_connections_name_unique
        ON provider_connections(lower(display_name))
        """,
    )


def migration_22_statements() -> tuple[str, ...]:
    """Add SUB2API origin metadata while retaining every existing provider kind."""
    return (
        """
        CREATE TABLE provider_connections_v22 (
            connection_id TEXT PRIMARY KEY,
            provider_kind TEXT NOT NULL CHECK (
                provider_kind IN (
                    'OPENAI', 'XAI', 'OPENAI_COMPATIBLE', 'OLLAMA',
                    'CPA_LOOPBACK', 'SUB2API'
                )
            ),
            display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
            base_url TEXT NOT NULL CHECK (length(base_url) BETWEEN 1 AND 2048),
            enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            models_json TEXT NOT NULL CHECK (json_valid(models_json)),
            revision INTEGER NOT NULL CHECK (revision >= 1),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK (provider_kind <> 'CPA_LOOPBACK'
                   OR base_url = 'http://127.0.0.1:8317'),
            CHECK (provider_kind <> 'SUB2API' OR (
                base_url LIKE 'https://%'
                AND length(base_url) > 8
                AND instr(substr(base_url, 9), '/') = 0
                AND instr(base_url, '@') = 0
                AND instr(base_url, '?') = 0
                AND instr(base_url, '#') = 0
            ))
        )
        """,
        """
        INSERT INTO provider_connections_v22 (
            connection_id, provider_kind, display_name, base_url, enabled,
            models_json, revision, created_at, updated_at
        )
        SELECT connection_id, provider_kind, display_name, base_url, enabled,
               models_json, revision, created_at, updated_at
        FROM provider_connections
        """,
        "DROP TABLE provider_connections",
        "ALTER TABLE provider_connections_v22 RENAME TO provider_connections",
        """
        CREATE UNIQUE INDEX provider_connections_name_unique
        ON provider_connections(lower(display_name))
        """,
    )
