"""Read a Fake Timeline operation from its durable enqueue identity."""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from aijian_api.artifacts import canonical_content_hash
from aijian_api.contracts import (
    ATTEMPT_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    NODE_RUN_ID_PATTERN,
    PROJECT_ID_PATTERN,
    SOURCE_ID_PATTERN,
    TASK_ID_PATTERN,
    VERSION_ID_PATTERN,
    WORKFLOW_RUN_ID_PATTERN,
)
from aijian_api.fake_media_package import FakeMediaToolchainIdentityV1
from aijian_api.fake_timeline_run import (
    DEFINITION_ID,
    DEFINITION_VERSION,
    NODE_KEY,
    TASK_KIND,
)

_OPERATION_ID_PATTERN = (
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-"
    r"[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)
_GRAPH = {"nodes": [NODE_KEY]}
_DEFINITION_HASH = canonical_content_hash(_GRAPH)
_BINDING_KEYS = {
    "source_manifest_version_id",
    "source_manifest_content_hash",
    "source_document_id",
    "source_sha256",
    "media_toolchain",
}


class FakeTimelineRunOperationNotFoundError(LookupError):
    """The project or its operation key does not exist."""


class FakeTimelineRunOperationConflictError(RuntimeError):
    """A durable operation key exists but its linked truth is inconsistent."""


@dataclass(frozen=True, slots=True)
class FakeTimelineRunOperation:
    project_id: str
    operation_id: str
    source_manifest_version_id: str
    source_document_id: str
    workflow_run_id: str
    node_run_id: str
    attempt_id: str
    task_id: str


def _matches(pattern: str, value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def _required_row(connection: sqlite3.Connection, sql: str, values: tuple[object, ...]) -> sqlite3.Row:
    row = connection.execute(sql, values).fetchone()
    if row is None:
        raise FakeTimelineRunOperationConflictError("Fake Timeline operation link is missing")
    return row


class FakeTimelineRunOperationReader:
    """Resolve one operation within a single SQLite read snapshot, without runtime setup."""

    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def get(self, project_id: str, operation_id: str) -> FakeTimelineRunOperation:
        if not _matches(PROJECT_ID_PATTERN, project_id) or not _matches(
            _OPERATION_ID_PATTERN, operation_id
        ):
            raise ValueError("invalid Fake Timeline operation identity")
        key_value = f"fake-timeline-run:create:v1:{operation_id}"
        # A URI read-only connection prevents this reader from repairing or queuing work.
        connection = sqlite3.connect(self._database_path.resolve().as_uri() + "?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("BEGIN")
            project = connection.execute(
                "SELECT 1 FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project is None:
                raise FakeTimelineRunOperationNotFoundError("Fake Timeline operation not found")
            key = connection.execute(
                """SELECT project_id, idempotency_key, workflow_run_id, node_run_id
                   FROM workflow_enqueue_keys
                   WHERE project_id = ? AND idempotency_key = ?""",
                (project_id, key_value),
            ).fetchone()
            if key is None:
                raise FakeTimelineRunOperationNotFoundError("Fake Timeline operation not found")
            return self._read_linked_truth(connection, project_id, operation_id, key_value, key)
        finally:
            connection.close()

    @staticmethod
    def _read_linked_truth(
        connection: sqlite3.Connection,
        project_id: str,
        operation_id: str,
        key_value: str,
        key: sqlite3.Row,
    ) -> FakeTimelineRunOperation:
        run = _required_row(
            connection,
            """SELECT workflow_run_id, project_id, definition_id, definition_version, input_hash
               FROM workflow_runs WHERE workflow_run_id = ?""",
            (key["workflow_run_id"],),
        )
        node = _required_row(
            connection,
            """SELECT node_run_id, workflow_run_id, node_key, node_type,
                      contract_version, input_bindings_json, input_hash, idempotency_key
               FROM workflow_node_runs WHERE node_run_id = ?""",
            (key["node_run_id"],),
        )
        definition = _required_row(
            connection,
            """SELECT definition_hash, graph_json FROM workflow_definitions
               WHERE definition_id = ? AND version = ?""",
            (run["definition_id"], run["definition_version"]),
        )
        attempt = connection.execute(
            """SELECT attempt_id, node_run_id, attempt_number, execution_mode,
                      input_hash, request_fingerprint
               FROM workflow_attempts WHERE node_run_id = ?
               ORDER BY attempt_number DESC, attempt_id DESC LIMIT 1""",
            (node["node_run_id"],),
        ).fetchone()
        if attempt is None:
            raise FakeTimelineRunOperationConflictError("Fake Timeline operation attempt is missing")
        tasks = connection.execute(
            "SELECT task_id, attempt_id, task_kind FROM task_ledger WHERE attempt_id = ?",
            (attempt["attempt_id"],),
        ).fetchall()
        try:
            graph_json = str(definition["graph_json"])
            graph = json.loads(graph_json)
            bindings = json.loads(str(node["input_bindings_json"]))
            if not isinstance(bindings, dict) or set(bindings) != _BINDING_KEYS:
                raise ValueError("Fake Timeline bindings are invalid")
            FakeMediaToolchainIdentityV1.model_validate(bindings["media_toolchain"])
            input_hash = canonical_content_hash(bindings)
            fingerprint = canonical_content_hash(
                {
                    "definition_id": DEFINITION_ID,
                    "definition_version": DEFINITION_VERSION,
                    "definition_hash": _DEFINITION_HASH,
                    "input_hash": input_hash,
                    "task_kind": TASK_KIND,
                }
            )
            canonical_graph = json.dumps(
                graph, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True
            )
            identities = (
                (project_id, PROJECT_ID_PATTERN),
                (operation_id, _OPERATION_ID_PATTERN),
                (bindings["source_manifest_version_id"], VERSION_ID_PATTERN),
                (bindings["source_document_id"], SOURCE_ID_PATTERN),
                (key["workflow_run_id"], WORKFLOW_RUN_ID_PATTERN),
                (key["node_run_id"], NODE_RUN_ID_PATTERN),
                (attempt["attempt_id"], ATTEMPT_ID_PATTERN),
            )
            valid = (
                all(_matches(pattern, value) for value, pattern in identities)
                and _matches(CONTENT_HASH_PATTERN, bindings["source_manifest_content_hash"])
                and _matches(CONTENT_HASH_PATTERN, bindings["source_sha256"])
                and key["project_id"] == project_id
                and key["idempotency_key"] == key_value
                and run["workflow_run_id"] == key["workflow_run_id"]
                and run["project_id"] == project_id
                and node["node_run_id"] == key["node_run_id"]
                and node["workflow_run_id"] == run["workflow_run_id"]
                and node["idempotency_key"] == key_value
                and run["definition_id"] == DEFINITION_ID
                and run["definition_version"] == DEFINITION_VERSION
                and definition["definition_hash"] == _DEFINITION_HASH
                and canonical_graph == graph_json
                and graph == _GRAPH
                and run["input_hash"] == input_hash
                and node["node_key"] == NODE_KEY
                and node["node_type"] == NODE_KEY
                and node["contract_version"] == 1
                and node["input_hash"] == input_hash
                and attempt["node_run_id"] == node["node_run_id"]
                and attempt["execution_mode"] == "local"
                and attempt["input_hash"] == input_hash
                and attempt["request_fingerprint"] == fingerprint
                and len(tasks) == 1
                and tasks[0]["attempt_id"] == attempt["attempt_id"]
                and tasks[0]["task_kind"] == TASK_KIND
                and _matches(TASK_ID_PATTERN, tasks[0]["task_id"])
            )
            if not valid:
                raise ValueError("Fake Timeline operation truth is invalid")
        except (ValueError, TypeError, KeyError, ValidationError) as error:
            raise FakeTimelineRunOperationConflictError(
                "Fake Timeline operation truth is invalid"
            ) from error
        return FakeTimelineRunOperation(
            project_id=project_id,
            operation_id=operation_id,
            source_manifest_version_id=bindings["source_manifest_version_id"],
            source_document_id=bindings["source_document_id"],
            workflow_run_id=key["workflow_run_id"],
            node_run_id=key["node_run_id"],
            attempt_id=attempt["attempt_id"],
            task_id=tasks[0]["task_id"],
        )
