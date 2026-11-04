"""Migration 39: durable provider deletion admission, never credential bytes."""

PROVIDER_CREDENTIAL_CLEANUP_MIGRATION: tuple[str, ...] = (
    """
    ALTER TABLE provider_connections ADD COLUMN cleanup_pending INTEGER NOT NULL
        DEFAULT 0 CHECK (cleanup_pending IN (0, 1))
    """,
    """
    CREATE TRIGGER provider_credential_cleanup_initial
    BEFORE INSERT ON provider_connections WHEN NEW.cleanup_pending != 0
    BEGIN SELECT RAISE(ABORT, 'credential cleanup must start from an existing provider'); END
    """,
    """
    CREATE TRIGGER provider_credential_cleanup_disabled
    BEFORE UPDATE ON provider_connections
    WHEN NEW.cleanup_pending = 1 AND NEW.enabled != 0
    BEGIN SELECT RAISE(ABORT, 'credential cleanup requires a disabled provider'); END
    """,
    """
    CREATE TRIGGER provider_credential_cleanup_irreversible
    BEFORE UPDATE ON provider_connections WHEN OLD.cleanup_pending = 1
    BEGIN SELECT RAISE(ABORT, 'credential cleanup cannot be reversed'); END
    """,
    """
    CREATE TRIGGER provider_credential_cleanup_no_rotation
    BEFORE INSERT ON provider_credential_rotation_operations
    WHEN EXISTS (
        SELECT 1 FROM provider_connections
        WHERE connection_id = NEW.connection_id AND cleanup_pending = 1
    )
    BEGIN SELECT RAISE(ABORT, 'credential cleanup prevents new rotations'); END
    """,
)
