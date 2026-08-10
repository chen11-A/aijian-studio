"""Closed, lease-fenced persistence boundary for Agent/Skill attempt snapshots."""

import hashlib
import json
import re
import sqlite3
from collections.abc import Mapping

from pydantic import ValidationError

from aijian_api.agent_skill_contracts import AttemptSnapshotV1
from aijian_api.task_ledger_models import ClaimedTask, LeaseLostError

AGENT_SKILL_SNAPSHOT_KIND = "agent_skill_v1"
_SENSITIVE_SNAPSHOT_TOKENS = {
    "auth",
    "authorization",
    "bearer",
    "cookie",
    "password",
    "secret",
    "token",
}
_KEY_PAIR_QUALIFIERS = {"api", "private", "signing"}
_CAMEL_CASE_BOUNDARY = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_NON_ALPHANUMERIC = re.compile(r"[^A-Za-z0-9]+")
_MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024


def prepare_agent_skill_snapshot(
    *,
    kind: str | None,
    payload: Mapping[str, object] | None,
    attempt_id: str,
    project_id: str,
    input_hash: str,
    idempotency_key: str,
    request_fingerprint: str,
) -> tuple[str, str, str] | None:
    if kind is None and payload is None:
        return None
    if kind is None or payload is None:
        raise ValueError("attempt snapshot kind and payload must be provided together")
    if kind != AGENT_SKILL_SNAPSHOT_KIND:
        raise ValueError("attempt snapshot kind is unsupported")
    if not payload:
        raise ValueError("attempt snapshot payload must not be empty")
    reject_sensitive_snapshot_fields(payload)
    if payload.get("project_id") not in (None, project_id):
        raise ValueError("attempt snapshot project does not match the workflow")
    if payload.get("input_hash") not in (None, input_hash):
        raise ValueError("attempt snapshot input hash does not match the node")
    if payload.get("idempotency_key") not in (None, idempotency_key):
        raise ValueError("attempt snapshot idempotency key does not match the node")
    if payload.get("attempt_fingerprint") not in (None, request_fingerprint):
        raise ValueError("attempt snapshot fingerprint does not match the attempt")
    try:
        validated = AttemptSnapshotV1.model_validate({"attempt_id": attempt_id, **payload})
    except ValidationError as error:
        raise ValueError("attempt snapshot failed the closed Agent/Skill contract") from error
    normalized = validated.model_dump(mode="json")
    normalized.pop("attempt_id")
    if normalized != payload:
        raise ValueError("attempt snapshot differs from its closed Agent/Skill contract")
    snapshot_json = canonical_snapshot_json(normalized)
    encoded = snapshot_json.encode("utf-8")
    if len(encoded) > _MAX_SNAPSHOT_BYTES:
        raise ValueError("attempt snapshot exceeds the size limit")
    return kind, snapshot_json, snapshot_sha256(snapshot_json)


def read_agent_skill_snapshot(
    connection: sqlite3.Connection,
    claim: ClaimedTask,
    *,
    now_text: str,
) -> AttemptSnapshotV1:
    row = connection.execute(
        """
        SELECT snapshot.snapshot_kind, snapshot.snapshot_json, snapshot.snapshot_hash,
               run.project_id, node.input_hash AS node_input_hash,
               node.idempotency_key, attempt.input_hash AS attempt_input_hash,
               attempt.request_fingerprint
        FROM task_ledger AS task
        JOIN workflow_attempts AS attempt ON attempt.attempt_id = task.attempt_id
        JOIN workflow_node_runs AS node ON node.node_run_id = attempt.node_run_id
        JOIN workflow_runs AS run ON run.workflow_run_id = node.workflow_run_id
        LEFT JOIN workflow_attempt_snapshots AS snapshot
          ON snapshot.attempt_id = task.attempt_id
        WHERE task.task_id = ? AND task.attempt_id = ? AND task.status = 'LEASED'
          AND attempt.node_run_id = ? AND node.workflow_run_id = ?
          AND task.lease_owner = ? AND task.lease_token = ?
          AND task.lease_generation = ? AND task.revision = ?
          AND task.lease_expires_at > ?
        """,
        (
            claim.task_id,
            claim.attempt_id,
            claim.node_run_id,
            claim.workflow_run_id,
            claim.lease_owner,
            claim.lease_token,
            claim.lease_generation,
            claim.task_revision,
            now_text,
        ),
    ).fetchone()
    if row is None:
        raise LeaseLostError("task lease is stale or expired")
    if row["snapshot_kind"] is None:
        raise ValueError("task does not have an Agent/Skill snapshot")
    try:
        if str(row["snapshot_kind"]) != AGENT_SKILL_SNAPSHOT_KIND:
            raise ValueError("unsupported snapshot kind")
        snapshot_json = str(row["snapshot_json"])
        if str(row["snapshot_hash"]) != snapshot_sha256(snapshot_json):
            raise ValueError("snapshot hash mismatch")
        payload = json.loads(snapshot_json)
        if not isinstance(payload, dict):
            raise ValueError("snapshot payload is not an object")
        if canonical_snapshot_json(payload) != snapshot_json:
            raise ValueError("snapshot JSON is not canonical")
        if "attempt_id" in payload:
            raise ValueError("snapshot template must not contain an attempt ID")
        reject_sensitive_snapshot_fields(payload)
        validated = AttemptSnapshotV1.model_validate({**payload, "attempt_id": claim.attempt_id})
        if (
            validated.project_id != str(row["project_id"])
            or validated.input_hash != str(row["attempt_input_hash"])
            or validated.input_hash != str(row["node_input_hash"])
            or validated.idempotency_key != str(row["idempotency_key"])
            or validated.attempt_fingerprint != str(row["request_fingerprint"])
        ):
            raise ValueError("snapshot is detached from workflow truth")
        return validated
    except (json.JSONDecodeError, ValidationError, ValueError) as error:
        raise ValueError("attempt snapshot failed integrity validation") from error


def canonical_snapshot_json(value: Mapping[str, object]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def assert_attempt_snapshot_templates_match(
    connection: sqlite3.Connection,
    producer_attempt_id: str,
    current_attempt_id: str,
) -> None:
    rows = connection.execute(
        """
        SELECT attempt_id, snapshot_kind, snapshot_json, snapshot_hash
        FROM workflow_attempt_snapshots
        WHERE attempt_id IN (?, ?)
        """,
        (producer_attempt_id, current_attempt_id),
    ).fetchall()
    snapshots = {
        str(row["attempt_id"]): (
            str(row["snapshot_kind"]),
            str(row["snapshot_json"]),
            str(row["snapshot_hash"]),
        )
        for row in rows
    }
    producer = snapshots.get(producer_attempt_id)
    current = snapshots.get(current_attempt_id)
    if producer is None or current is None or producer != current:
        raise ValueError("proposal producer snapshot differs from the current attempt")


def snapshot_sha256(snapshot_json: str) -> str:
    return f"sha256:{hashlib.sha256(snapshot_json.encode('utf-8')).hexdigest()}"


def reject_sensitive_snapshot_fields(value: object) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            separated = _CAMEL_CASE_BOUNDARY.sub("_", str(key).strip())
            tokens = tuple(
                token.lower() for token in _NON_ALPHANUMERIC.sub("_", separated).split("_") if token
            )
            if set(tokens) & _SENSITIVE_SNAPSHOT_TOKENS or (
                "key" in tokens and bool(set(tokens) & _KEY_PAIR_QUALIFIERS)
            ):
                raise ValueError("attempt snapshot contains a sensitive field")
            reject_sensitive_snapshot_fields(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            reject_sensitive_snapshot_fields(child)
