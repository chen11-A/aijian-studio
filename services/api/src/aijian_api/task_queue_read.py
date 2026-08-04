"""Safe project-scoped read model for the production task queue."""

import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from aijian_api.repository import ProjectNotFoundError
from aijian_api.task_ledger_models import parse_datetime

_VERSION_ID = re.compile(r"^ver_[0-9a-f]{32}$")
_ATTENTION_ATTEMPTS = frozenset({"REMOTE_UNKNOWN", "FAILED", "NOT_SUBMITTED"})
_ACTIVE_ATTEMPTS = frozenset(
    {
        "READY",
        "LEASED",
        "RUNNING",
        "SUBMIT_INTENT",
        "SUBMITTING",
        "WAITING_REMOTE",
        "CANCEL_REQUESTED",
    }
)


@dataclass(frozen=True, slots=True)
class TaskQueueRecord:
    workflow_run_id: str
    node_run_id: str
    node_key: str
    node_type: str
    node_status: str
    input_hash: str
    input_version_ids: tuple[str, ...]
    node_output_version_id: str | None
    attempt_count: int
    max_attempts: int
    node_updated_at: datetime
    attempt_id: str
    attempt_number: int
    execution_mode: str
    attempt_status: str
    provider_model: str | None
    provider_job_id: str | None
    retry_disposition: str | None
    error_code: str | None
    attempt_output_version_id: str | None
    started_at: datetime | None
    finished_at: datetime | None
    attempt_updated_at: datetime
    task_id: str
    task_kind: str
    task_status: str
    priority: int
    available_at: datetime
    lease_generation: int
    lease_expires_at: datetime | None
    heartbeat_at: datetime | None
    task_updated_at: datetime

    @property
    def responsible_role(self) -> str:
        node = self.node_type.lower()
        if any(token in node for token in ("shot", "storyboard", "animatic", "director")):
            return "导演"
        if any(token in node for token in ("story", "script", "dialogue", "episode")):
            return "编剧"
        if any(token in node for token in ("edit", "timeline", "cut", "export")):
            return "剪辑"
        if any(token in node for token in ("voice", "audio", "music", "sound")):
            return "声音"
        if any(token in node for token in ("image", "video", "render", "asset")):
            return "AI 制作"
        return "系统"

    @property
    def upstream_gate(self) -> str | None:
        node = self.node_type.lower()
        if any(token in node for token in ("shot", "storyboard", "animatic")):
            return "G5"
        if "story" in node:
            return "G1"
        if any(token in node for token in ("episode", "script", "dialogue")):
            return "G2"
        if any(token in node for token in ("visual", "asset")):
            return "G4"
        if any(token in node for token in ("render", "generate")):
            return "G6B"
        if any(token in node for token in ("edit", "timeline", "cut")):
            return "G7A"
        if "export" in node:
            return "G7C"
        return None

    @property
    def is_attention(self) -> bool:
        return (
            self.node_status in {"RECONCILIATION_REQUIRED", "FAILED"}
            or self.attempt_status in _ATTENTION_ATTEMPTS
        )

    @property
    def is_active(self) -> bool:
        return self.attempt_status in _ACTIVE_ATTEMPTS

    @property
    def is_completed(self) -> bool:
        return self.attempt_status == "SUCCEEDED"


class TaskQueueReader:
    def __init__(self, database_path: Path) -> None:
        self._database_path = database_path

    def list_project_tasks(self, project_id: str) -> list[TaskQueueRecord]:
        connection = sqlite3.connect(self._database_path, timeout=5)
        connection.row_factory = sqlite3.Row
        try:
            project = connection.execute(
                "SELECT 1 FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            if project is None:
                raise ProjectNotFoundError(project_id)
            rows = connection.execute(
                """
                SELECT run.workflow_run_id,
                       node.node_run_id, node.node_key, node.node_type,
                       node.status AS node_status, node.input_bindings_json,
                       node.input_hash, node.output_version_id AS node_output_version_id,
                       node.attempt_count, node.max_attempts,
                       node.updated_at AS node_updated_at,
                       attempt.attempt_id, attempt.attempt_number,
                       attempt.execution_mode, attempt.status AS attempt_status,
                       attempt.provider_model, attempt.provider_job_id,
                       attempt.retry_disposition, attempt.error_code,
                       attempt.output_version_id AS attempt_output_version_id,
                       attempt.started_at, attempt.finished_at,
                       attempt.updated_at AS attempt_updated_at,
                       task.task_id, task.task_kind, task.status AS task_status,
                       task.priority, task.available_at, task.lease_generation,
                       task.lease_expires_at, task.heartbeat_at,
                       task.updated_at AS task_updated_at
                FROM workflow_runs AS run
                JOIN workflow_node_runs AS node
                  ON node.workflow_run_id = run.workflow_run_id
                JOIN workflow_attempts AS attempt
                  ON attempt.node_run_id = node.node_run_id
                JOIN task_ledger AS task ON task.attempt_id = attempt.attempt_id
                WHERE run.project_id = ?
                ORDER BY
                  CASE WHEN attempt.status IN (
                    'READY', 'LEASED', 'RUNNING', 'SUBMIT_INTENT', 'SUBMITTING',
                    'WAITING_REMOTE', 'REMOTE_UNKNOWN', 'CANCEL_REQUESTED'
                  ) THEN 0 ELSE 1 END,
                  task.updated_at DESC, task.task_id
                """,
                (project_id,),
            ).fetchall()
            return [_record(row) for row in rows]
        finally:
            connection.close()


def _record(row: sqlite3.Row) -> TaskQueueRecord:
    return TaskQueueRecord(
        workflow_run_id=str(row["workflow_run_id"]),
        node_run_id=str(row["node_run_id"]),
        node_key=str(row["node_key"]),
        node_type=str(row["node_type"]),
        node_status=str(row["node_status"]),
        input_hash=str(row["input_hash"]),
        input_version_ids=_version_ids(json.loads(str(row["input_bindings_json"]))),
        node_output_version_id=_optional_text(row["node_output_version_id"]),
        attempt_count=int(row["attempt_count"]),
        max_attempts=int(row["max_attempts"]),
        node_updated_at=parse_datetime(str(row["node_updated_at"])),
        attempt_id=str(row["attempt_id"]),
        attempt_number=int(row["attempt_number"]),
        execution_mode=str(row["execution_mode"]),
        attempt_status=str(row["attempt_status"]),
        provider_model=_optional_text(row["provider_model"]),
        provider_job_id=_optional_text(row["provider_job_id"]),
        retry_disposition=_optional_text(row["retry_disposition"]),
        error_code=_optional_text(row["error_code"]),
        attempt_output_version_id=_optional_text(row["attempt_output_version_id"]),
        started_at=_optional_datetime(row["started_at"]),
        finished_at=_optional_datetime(row["finished_at"]),
        attempt_updated_at=parse_datetime(str(row["attempt_updated_at"])),
        task_id=str(row["task_id"]),
        task_kind=str(row["task_kind"]),
        task_status=str(row["task_status"]),
        priority=int(row["priority"]),
        available_at=parse_datetime(str(row["available_at"])),
        lease_generation=int(row["lease_generation"]),
        lease_expires_at=_optional_datetime(row["lease_expires_at"]),
        heartbeat_at=_optional_datetime(row["heartbeat_at"]),
        task_updated_at=parse_datetime(str(row["task_updated_at"])),
    )


def _version_ids(value: object) -> tuple[str, ...]:
    found: set[str] = set()

    def visit(candidate: object) -> None:
        if isinstance(candidate, str) and _VERSION_ID.fullmatch(candidate):
            found.add(candidate)
        elif isinstance(candidate, list):
            for item in candidate:
                visit(item)
        elif isinstance(candidate, dict):
            for item in candidate.values():
                visit(item)

    visit(value)
    return tuple(sorted(found))


def _optional_text(value: object) -> str | None:
    return None if value is None else str(value)


def _optional_datetime(value: object) -> datetime | None:
    return None if value is None else parse_datetime(str(value))
