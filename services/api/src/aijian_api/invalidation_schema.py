"""SQLite schema for append-only invalidation operations and path-impact rows."""

MIGRATION_8 = (
    """
    CREATE TABLE invalidation_operations (
        operation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        changed_artifact_id TEXT NOT NULL,
        old_accepted_version_id TEXT NOT NULL,
        new_accepted_version_id TEXT NOT NULL,
        gate_decision_id TEXT NOT NULL REFERENCES gate_decisions(decision_id),
        created_at TEXT NOT NULL,
        CHECK (old_accepted_version_id <> new_accepted_version_id),
        UNIQUE (gate_decision_id),
        UNIQUE (operation_id, project_id),
        FOREIGN KEY (changed_artifact_id, old_accepted_version_id)
            REFERENCES artifact_versions(artifact_id, version_id),
        FOREIGN KEY (changed_artifact_id, new_accepted_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
    )
    """,
    """
    CREATE TABLE invalidation_path_impacts (
        impact_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        affected_artifact_id TEXT NOT NULL,
        affected_version_id TEXT NOT NULL,
        dependency_path_json TEXT NOT NULL CHECK (json_valid(dependency_path_json)),
        path_relationships_json TEXT NOT NULL CHECK (json_valid(path_relationships_json)),
        path_impacts_json TEXT NOT NULL CHECK (json_valid(path_impacts_json)),
        effective_impact TEXT NOT NULL
            CHECK (effective_impact IN ('blocking', 'advisory', 'render_only')),
        path_ordinal INTEGER NOT NULL CHECK (path_ordinal >= 0),
        UNIQUE (operation_id, path_ordinal),
        UNIQUE (operation_id, dependency_path_json),
        FOREIGN KEY (operation_id, project_id)
            REFERENCES invalidation_operations(operation_id, project_id)
            ON DELETE CASCADE,
        FOREIGN KEY (affected_artifact_id, affected_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
    )
    """,
    """
    CREATE INDEX invalidation_operations_project
    ON invalidation_operations(project_id, created_at, operation_id)
    """,
    """
    CREATE INDEX invalidation_path_impacts_operation
    ON invalidation_path_impacts(operation_id, path_ordinal)
    """,
    """
    CREATE INDEX invalidation_path_impacts_affected
    ON invalidation_path_impacts(project_id, affected_version_id)
    """,
    """
    CREATE TRIGGER invalidation_operations_immutable_update
    BEFORE UPDATE ON invalidation_operations
    BEGIN
        SELECT RAISE(ABORT, 'invalidation_operations rows are immutable');
    END
    """,
    """
    CREATE TRIGGER invalidation_operations_immutable_delete
    BEFORE DELETE ON invalidation_operations
    BEGIN
        SELECT RAISE(ABORT, 'invalidation_operations rows are immutable');
    END
    """,
    """
    CREATE TRIGGER invalidation_path_impacts_immutable_update
    BEFORE UPDATE ON invalidation_path_impacts
    BEGIN
        SELECT RAISE(ABORT, 'invalidation_path_impacts rows are immutable');
    END
    """,
    """
    CREATE TRIGGER invalidation_path_impacts_immutable_delete
    BEFORE DELETE ON invalidation_path_impacts
    BEGIN
        SELECT RAISE(ABORT, 'invalidation_path_impacts rows are immutable');
    END
    """,
)
