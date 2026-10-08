"""Migration 32 candidate: additive project settings and immutable CAS receipts.

Existing names, status, aspect, duration, language, and revisions are unchanged.
NULL timebase means unspecified. No artifact or episode is rewritten.
"""

PROJECT_SETTINGS_MIGRATION: tuple[str, ...] = (
    "ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '' "
    "CHECK (length(description) <= 4000)",
    "ALTER TABLE projects ADD COLUMN sequence_timebase_json TEXT "
    "CHECK (sequence_timebase_json IS NULL OR "
    "(json_valid(sequence_timebase_json) AND json_type(sequence_timebase_json) = 'object'))",
    """
    CREATE TABLE project_settings_write_receipts (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        operation_id TEXT NOT NULL CHECK (
            length(operation_id) = 36 AND substr(operation_id, 1, 4) = 'pso_'
            AND substr(operation_id, 5) NOT GLOB '*[^0-9a-f]*'
        ),
        request_hash TEXT NOT NULL CHECK (
            length(request_hash) = 71 AND substr(request_hash, 1, 7) = 'sha256:'
            AND substr(request_hash, 8) NOT GLOB '*[^0-9a-f]*'
        ),
        base_revision INTEGER NOT NULL CHECK (
            typeof(base_revision) = 'integer'
            AND base_revision BETWEEN 1 AND 9223372036854775806
        ),
        result_revision INTEGER NOT NULL CHECK (
            typeof(result_revision) = 'integer'
            AND result_revision BETWEEN base_revision AND base_revision + 1
        ),
        result_json TEXT NOT NULL CHECK (json_valid(result_json)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, operation_id)
    )
    """,
    """
    CREATE TRIGGER project_settings_receipt_insert_scope
    BEFORE INSERT ON project_settings_write_receipts
    WHEN NOT EXISTS (
        SELECT 1 FROM projects
        WHERE id = NEW.project_id AND revision = NEW.result_revision
    ) OR json_extract(NEW.result_json, '$.project_id') IS NOT NEW.project_id
      OR json_extract(NEW.result_json, '$.revision') IS NOT NEW.result_revision
    BEGIN SELECT RAISE(ABORT, 'project settings receipt scope or revision mismatch'); END
    """,
    """
    CREATE TRIGGER project_settings_receipts_no_update
    BEFORE UPDATE ON project_settings_write_receipts
    BEGIN SELECT RAISE(ABORT, 'project settings receipts are immutable'); END
    """,
    """
    CREATE TRIGGER project_settings_receipts_no_direct_delete
    BEFORE DELETE ON project_settings_write_receipts
    WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
    BEGIN SELECT RAISE(ABORT, 'project settings history cannot be deleted'); END
    """,
)
