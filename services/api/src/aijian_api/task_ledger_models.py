"""Shared records and time helpers for the local task ledger."""

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4


class LeaseLostError(RuntimeError):
    """Raised when a worker no longer owns the exact leased revision."""


@dataclass(frozen=True, slots=True)
class QueuedTask:
    workflow_run_id: str
    node_run_id: str
    attempt_id: str
    task_id: str


@dataclass(frozen=True, slots=True)
class ClaimedTask:
    workflow_run_id: str
    node_run_id: str
    attempt_id: str
    task_id: str
    task_kind: str
    attempt_number: int
    lease_owner: str
    lease_token: str
    lease_generation: int
    lease_expires_at: datetime
    heartbeat_at: datetime
    task_revision: int
    attempt_revision: int
    node_revision: int


def utc_now() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def lease_token() -> str:
    return secrets.token_urlsafe(32)


def timestamp(value: datetime) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("task ledger timestamps must include a timezone")
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))
