"""Version-bound human rights decisions; repository owner registers migration 27."""

RIGHTS_DECISION_MIGRATION: tuple[str, ...] = (
    """
    CREATE TABLE media_asset_rights_decisions (
        id TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        asset_sha256 TEXT NOT NULL CHECK (length(asset_sha256) = 64),
        revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
        previous_decision_id TEXT,
        operation_id TEXT NOT NULL,
        request_sha256 TEXT NOT NULL CHECK (length(request_sha256) = 64),
        decision TEXT NOT NULL CHECK (decision IN ('CLEARED', 'RESTRICTED')),
        actor_type TEXT NOT NULL CHECK (actor_type = 'human'),
        actor_id TEXT NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 128),
        basis_text TEXT NOT NULL CHECK (length(basis_text) BETWEEN 20 AND 4000),
        supporting_reference TEXT CHECK (
            supporting_reference IS NULL OR length(supporting_reference) BETWEEN 1 AND 512
        ),
        evidence_sha256 TEXT NOT NULL CHECK (length(evidence_sha256) = 64),
        decision_content_hash TEXT NOT NULL CHECK (length(decision_content_hash) = 64),
        created_at TEXT NOT NULL,
        CHECK (
            (revision = 1 AND previous_decision_id IS NULL)
            OR (revision > 1 AND previous_decision_id IS NOT NULL)
        ),
        FOREIGN KEY (project_id, asset_id, version_id)
            REFERENCES media_asset_versions(project_id, asset_id, id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, asset_id, version_id, previous_decision_id)
            REFERENCES media_asset_rights_decisions(project_id, asset_id, version_id, id)
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
        UNIQUE (project_id, asset_id, version_id, revision),
        UNIQUE (project_id, asset_id, version_id, operation_id),
        UNIQUE (project_id, asset_id, version_id, id),
        UNIQUE (project_id, asset_id, version_id, id, revision)
    )
    """,
    """
    CREATE TABLE media_asset_rights_heads (
        project_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        version_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
        decision_id TEXT NOT NULL,
        PRIMARY KEY (project_id, asset_id, version_id),
        FOREIGN KEY (project_id, asset_id, version_id)
            REFERENCES media_asset_versions(project_id, asset_id, id) ON DELETE CASCADE,
        FOREIGN KEY (project_id, asset_id, version_id, decision_id, revision)
            REFERENCES media_asset_rights_decisions(
                project_id, asset_id, version_id, id, revision
            )
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
    )
    """,
    """
    CREATE INDEX media_asset_rights_history
    ON media_asset_rights_decisions(project_id, asset_id, version_id, revision)
    """,
    """
    CREATE TRIGGER media_asset_rights_decisions_no_update
    BEFORE UPDATE ON media_asset_rights_decisions
    BEGIN SELECT RAISE(ABORT, 'media asset rights decisions are immutable'); END
    """,
    """
    CREATE TRIGGER media_asset_rights_previous_revision
    BEFORE INSERT ON media_asset_rights_decisions
    WHEN NEW.revision > 1
    BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM media_asset_rights_decisions AS previous
            WHERE previous.project_id = NEW.project_id
              AND previous.asset_id = NEW.asset_id
              AND previous.version_id = NEW.version_id
              AND previous.id = NEW.previous_decision_id
              AND previous.revision = NEW.revision - 1
        ) THEN RAISE(ABORT, 'rights decision predecessor revision mismatch') END;
    END
    """,
    """
    CREATE TRIGGER media_asset_rights_decisions_no_direct_delete
    BEFORE DELETE ON media_asset_rights_decisions
    WHEN EXISTS (
        SELECT 1 FROM media_asset_versions AS version
        WHERE version.project_id = OLD.project_id
          AND version.asset_id = OLD.asset_id
          AND version.id = OLD.version_id
    )
    BEGIN SELECT RAISE(ABORT, 'active media rights decisions cannot be deleted'); END
    """,
)
