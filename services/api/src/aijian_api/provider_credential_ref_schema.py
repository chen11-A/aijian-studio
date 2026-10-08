"""Migration 31: versioned credential-vault references, never credential bytes.

The repository runner rebuilds with foreign keys disabled, checks them before
commit, and restores them. Legacy rows retain their existing connection-id slot.
"""

PROVIDER_CREDENTIAL_REF_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE provider_connections_v31 (
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
        credential_ref TEXT NOT NULL CHECK (
            credential_ref = connection_id
            OR (
                length(connection_id) = 36
                AND substr(connection_id, 1, 4) = 'pcn_'
                AND substr(connection_id, 5) NOT GLOB '*[^0-9a-f]*'
                AND length(credential_ref) = 73
                AND substr(credential_ref, 1, 41) = connection_id || ':crd_'
                AND substr(credential_ref, 42) NOT GLOB '*[^0-9a-f]*'
            )
        ),
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
    INSERT INTO provider_connections_v31 (
        connection_id, provider_kind, display_name, base_url, enabled,
        models_json, revision, created_at, updated_at, credential_ref
    )
    SELECT connection_id, provider_kind, display_name, base_url, enabled,
           models_json, revision, created_at, updated_at, connection_id
    FROM provider_connections
    """,
    "DROP TABLE provider_connections",
    "ALTER TABLE provider_connections_v31 RENAME TO provider_connections",
    """
    CREATE UNIQUE INDEX provider_connections_name_unique
    ON provider_connections(lower(display_name))
    """,
    """
    CREATE UNIQUE INDEX provider_connections_credential_ref_unique
    ON provider_connections(credential_ref)
    """,
    """
    CREATE TABLE provider_credential_rotation_operations (
        operation_id TEXT PRIMARY KEY NOT NULL CHECK (
            length(operation_id) = 37 AND substr(operation_id, 1, 5) = 'pcop_'
            AND substr(operation_id, 6) NOT GLOB '*[^0-9a-f]*'
        ),
        connection_id TEXT NOT NULL
            REFERENCES provider_connections(connection_id) ON DELETE RESTRICT,
        expected_revision INTEGER NOT NULL CHECK (
            typeof(expected_revision) = 'integer'
            AND expected_revision BETWEEN 1 AND 9223372036854775806
        ),
        candidate_credential_ref TEXT NOT NULL UNIQUE CHECK (
            length(connection_id) = 36
            AND substr(connection_id, 1, 4) = 'pcn_'
            AND substr(connection_id, 5) NOT GLOB '*[^0-9a-f]*'
            AND length(candidate_credential_ref) = 73
            AND substr(candidate_credential_ref, 1, 41) = connection_id || ':crd_'
            AND substr(candidate_credential_ref, 42) NOT GLOB '*[^0-9a-f]*'
        ),
        status TEXT NOT NULL CHECK (status IN ('PREPARED', 'APPLIED', 'CONFLICT', 'UNKNOWN')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        applied_revision INTEGER,
        CHECK (
            (status = 'APPLIED' AND applied_revision IS NOT NULL
             AND typeof(applied_revision) = 'integer'
             AND applied_revision = expected_revision + 1)
            OR (status != 'APPLIED' AND applied_revision IS NULL)
        )
    )
    """,
    """
    CREATE INDEX provider_credential_rotation_connection
    ON provider_credential_rotation_operations(connection_id, created_at)
    """,
    """
    CREATE TRIGGER provider_credential_rotation_initial
    BEFORE INSERT ON provider_credential_rotation_operations
    WHEN NEW.status != 'PREPARED' OR NEW.applied_revision IS NOT NULL
    BEGIN SELECT RAISE(ABORT, 'credential rotation must start prepared'); END
    """,
    """
    CREATE TRIGGER provider_credential_rotation_identity
    BEFORE UPDATE ON provider_credential_rotation_operations
    WHEN NEW.operation_id IS NOT OLD.operation_id
      OR NEW.connection_id IS NOT OLD.connection_id
      OR NEW.expected_revision IS NOT OLD.expected_revision
      OR NEW.candidate_credential_ref IS NOT OLD.candidate_credential_ref
      OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT, 'credential rotation identity is immutable'); END
    """,
    """
    CREATE TRIGGER provider_credential_rotation_transition
    BEFORE UPDATE ON provider_credential_rotation_operations
    WHEN NEW.status IS NOT OLD.status AND NOT (
        (OLD.status = 'PREPARED' AND NEW.status IN ('APPLIED', 'CONFLICT', 'UNKNOWN'))
        OR (OLD.status = 'UNKNOWN' AND NEW.status IN ('APPLIED', 'CONFLICT'))
    )
    BEGIN SELECT RAISE(ABORT, 'invalid credential rotation transition'); END
    """,
    """
    CREATE TRIGGER provider_credential_rotation_applied
    BEFORE UPDATE ON provider_credential_rotation_operations
    WHEN NEW.status = 'APPLIED' AND OLD.status != 'APPLIED' AND NOT EXISTS (
        SELECT 1 FROM provider_connections AS connection
        WHERE connection.connection_id = NEW.connection_id
          AND connection.credential_ref = NEW.candidate_credential_ref
          AND connection.revision = NEW.applied_revision
    )
    BEGIN SELECT RAISE(ABORT, 'credential rotation application is not committed in this transaction'); END
    """,
    """
    CREATE TRIGGER provider_credential_rotation_no_direct_delete
    BEFORE DELETE ON provider_credential_rotation_operations
    WHEN EXISTS (
        SELECT 1 FROM provider_connections WHERE connection_id = OLD.connection_id
    )
    BEGIN SELECT RAISE(ABORT, 'credential rotation history cannot be deleted'); END
    """,
)
