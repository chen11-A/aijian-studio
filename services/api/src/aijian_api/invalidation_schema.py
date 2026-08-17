"""Additive schema v15 for the append-only accepted-head invalidation ledger."""

from __future__ import annotations

import re
import sqlite3

MIGRATION_15 = (
    """
    CREATE TABLE invalidation_operations (
        operation_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        changed_artifact_id TEXT NOT NULL,
        old_accepted_version_id TEXT NOT NULL,
        new_accepted_version_id TEXT NOT NULL,
        gate_decision_id TEXT NOT NULL,
        assessment_hash TEXT NOT NULL CHECK (
            length(assessment_hash) = 71
            AND substr(assessment_hash, 1, 7) = 'sha256:'
            AND substr(assessment_hash, 8) NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        CHECK (old_accepted_version_id <> new_accepted_version_id),
        UNIQUE (gate_decision_id),
        UNIQUE (project_id, operation_id),
        UNIQUE (project_id, gate_decision_id),
        FOREIGN KEY (changed_artifact_id)
            REFERENCES artifacts(artifact_id),
        FOREIGN KEY (changed_artifact_id, old_accepted_version_id)
            REFERENCES artifact_versions(artifact_id, version_id),
        FOREIGN KEY (changed_artifact_id, new_accepted_version_id)
            REFERENCES artifact_versions(artifact_id, version_id),
        FOREIGN KEY (gate_decision_id)
            REFERENCES gate_decisions(decision_id)
    )
    """,
    """
    CREATE TABLE invalidation_reason_paths (
        path_id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        affected_artifact_id TEXT NOT NULL,
        affected_version_id TEXT NOT NULL,
        classification TEXT NOT NULL CHECK (classification IN ('STALE', 'INVALIDATE')),
        aggregate_impact TEXT NOT NULL
            CHECK (aggregate_impact IN ('blocking', 'advisory', 'render_only')),
        dependency_ids_json TEXT NOT NULL CHECK (
            json_valid(dependency_ids_json)
            AND json_type(dependency_ids_json) = 'array'
            AND json_array_length(dependency_ids_json) >= 1
        ),
        relationships_json TEXT NOT NULL CHECK (
            json_valid(relationships_json)
            AND json_type(relationships_json) = 'array'
            AND json_array_length(relationships_json) >= 1
        ),
        edge_impacts_json TEXT NOT NULL CHECK (
            json_valid(edge_impacts_json)
            AND json_type(edge_impacts_json) = 'array'
            AND json_array_length(edge_impacts_json) >= 1
        ),
        effective_impact TEXT NOT NULL
            CHECK (effective_impact IN ('blocking', 'advisory', 'render_only')),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        created_at TEXT NOT NULL,
        CHECK (
            json_array_length(dependency_ids_json) = json_array_length(relationships_json)
        ),
        CHECK (
            json_array_length(dependency_ids_json) = json_array_length(edge_impacts_json)
        ),
        UNIQUE (operation_id, ordinal),
        UNIQUE (
            operation_id,
            affected_version_id,
            dependency_ids_json,
            relationships_json,
            edge_impacts_json
        ),
        UNIQUE (project_id, path_id),
        FOREIGN KEY (project_id, operation_id)
            REFERENCES invalidation_operations(project_id, operation_id)
            ON DELETE CASCADE,
        FOREIGN KEY (affected_artifact_id, affected_version_id)
            REFERENCES artifact_versions(artifact_id, version_id)
    )
    """,
    """
    CREATE INDEX invalidation_operations_project_history
    ON invalidation_operations(project_id, created_at, operation_id)
    """,
    """
    CREATE INDEX invalidation_reason_paths_project_affected
    ON invalidation_reason_paths(project_id, affected_version_id, operation_id, ordinal)
    """,
    """
    CREATE TRIGGER invalidation_operations_chain_insert
    BEFORE INSERT ON invalidation_operations
    WHEN NOT EXISTS (
        SELECT 1
        FROM artifacts AS artifact
        JOIN artifact_versions AS old_version
          ON old_version.artifact_id = artifact.artifact_id
         AND old_version.version_id = NEW.old_accepted_version_id
        JOIN artifact_versions AS new_version
          ON new_version.artifact_id = artifact.artifact_id
         AND new_version.version_id = NEW.new_accepted_version_id
        JOIN gate_decisions AS decision
          ON decision.decision_id = NEW.gate_decision_id
        WHERE artifact.artifact_id = NEW.changed_artifact_id
          AND artifact.project_id = NEW.project_id
          AND decision.artifact_id = NEW.changed_artifact_id
          AND decision.version_id = NEW.new_accepted_version_id
          AND decision.decision IN ('approved', 'approved_with_waiver')
    )
    BEGIN
        SELECT RAISE(ABORT, 'invalidation operation chain is inconsistent');
    END
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
    WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
    BEGIN
        SELECT RAISE(ABORT, 'invalidation_operations rows are immutable');
    END
    """,
    """
    CREATE TRIGGER invalidation_reason_paths_chain_insert
    BEFORE INSERT ON invalidation_reason_paths
    WHEN NOT EXISTS (
        SELECT 1
        FROM invalidation_operations AS operation
        JOIN artifacts AS artifact
          ON artifact.artifact_id = NEW.affected_artifact_id
         AND artifact.project_id = NEW.project_id
        JOIN artifact_versions AS version
          ON version.artifact_id = artifact.artifact_id
         AND version.version_id = NEW.affected_version_id
        WHERE operation.operation_id = NEW.operation_id
          AND operation.project_id = NEW.project_id
    ) OR EXISTS (
        SELECT 1 FROM json_each(NEW.dependency_ids_json)
        WHERE json_each.type != 'text' OR length(json_each.value) = 0
    ) OR EXISTS (
        SELECT 1 FROM json_each(NEW.relationships_json)
        WHERE json_each.type != 'text' OR length(json_each.value) = 0
    ) OR EXISTS (
        SELECT 1 FROM json_each(NEW.edge_impacts_json)
        WHERE json_each.value NOT IN ('blocking', 'advisory', 'render_only')
    )
    BEGIN
        SELECT RAISE(ABORT, 'invalidation reason path chain is inconsistent');
    END
    """,
    """
    CREATE TRIGGER invalidation_reason_paths_immutable_update
    BEFORE UPDATE ON invalidation_reason_paths
    BEGIN
        SELECT RAISE(ABORT, 'invalidation_reason_paths rows are immutable');
    END
    """,
    """
    CREATE TRIGGER invalidation_reason_paths_immutable_delete
    BEFORE DELETE ON invalidation_reason_paths
    WHEN EXISTS (SELECT 1 FROM projects WHERE id = OLD.project_id)
    BEGIN
        SELECT RAISE(ABORT, 'invalidation_reason_paths rows are immutable');
    END
    """,
)

_CREATE_OBJECT = re.compile(
    r"^\s*CREATE\s+(TABLE|INDEX|TRIGGER)\s+(\w+)\b",
    re.IGNORECASE | re.MULTILINE,
)


def _canonical_sql(sql: str) -> str:
    return " ".join(sql.split()).strip().rstrip(";")


def expected_v15_objects() -> dict[tuple[str, str], str]:
    expected: dict[tuple[str, str], str] = {}
    for statement in MIGRATION_15:
        match = _CREATE_OBJECT.search(statement)
        if match is None:
            raise RuntimeError("MIGRATION_15 statement is not a CREATE object")
        kind = match.group(1).lower()
        name = match.group(2)
        expected[(kind, name)] = _canonical_sql(statement)
    return expected


def _present_v15_objects(
    connection: sqlite3.Connection,
) -> dict[tuple[str, str], str]:
    expected = expected_v15_objects()
    names = tuple(name for _kind, name in expected)
    placeholders = ", ".join("?" for _ in names)
    rows = connection.execute(
        f"SELECT type, name, sql FROM sqlite_master WHERE name IN ({placeholders})",
        names,
    ).fetchall()
    present: dict[tuple[str, str], str] = {}
    for row in rows:
        sql = row[2]
        if sql is None:
            raise RuntimeError(
                "Cannot migrate workspace to schema v15: untrusted invalidation ledger objects"
            )
        present[(str(row[0]).lower(), str(row[1]))] = _canonical_sql(str(sql))
    return present


def migration_15_statements(connection: sqlite3.Connection) -> tuple[str, ...]:
    """Return full v15 DDL, or an empty replay sequence after exact validation."""

    present = _present_v15_objects(connection)
    if not present:
        return MIGRATION_15
    if present != expected_v15_objects():
        raise RuntimeError(
            "Cannot migrate workspace to schema v15: untrusted invalidation ledger objects"
        )
    return ()
