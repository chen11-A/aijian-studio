"""Exact-scope consent checks for one external Sub2API source.extract call.

These pure checks are not dispatch authority. The sidecar must obtain the approval
from a trusted, authenticated user action and atomically consume it with the task
attempt before sending bytes. An absent or already consumed approval denies.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.agent_skill_contracts import canonical_sha256
from aijian_api.contracts import TASK_ID_PATTERN
from aijian_api.provider_contracts import (
    Sub2APIOriginMode,
    sub2api_origin_binding,
    validate_sub2api_origin,
)

_HASH = r"^sha256:[0-9a-f]{64}$"
_ID = r"^[a-z]{3}_[0-9a-f]{32}$"


class Sub2APICallApprovalV1(BaseModel):
    """One persisted user decision for exactly one source.extract attempt.

    Cost acknowledgement is deliberately qualitative. It supplies neither a
    monetary ceiling nor a settlement receipt, and does not assert that the
    external business key has the claimed permissions or remaining quota.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    approval_id: str = Field(pattern=_ID)
    project_id: str = Field(pattern=_ID)
    task_id: str = Field(pattern=TASK_ID_PATTERN)
    attempt_id: str = Field(pattern=r"^att_[0-9a-f]{32}$")
    connection_id: str = Field(pattern=r"^pcn_[0-9a-f]{32}$")
    connection_revision: int = Field(ge=1)
    model_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")
    origin_hash: str = Field(pattern=_HASH)
    origin_mode: Sub2APIOriginMode = "PUBLIC_HTTPS"
    input_hash: str = Field(pattern=_HASH)
    context_manifest_hash: str = Field(pattern=_HASH)
    allowed_calls: Literal[1]
    cost_decision: Literal["UNKNOWN_COST_ACCEPTED"]
    approved_at: datetime
    expires_at: datetime

    @model_validator(mode="after")
    def validate_interval(self) -> Sub2APICallApprovalV1:
        if (
            self.approved_at.tzinfo is None
            or self.approved_at.utcoffset() is None
            or self.expires_at.tzinfo is None
            or self.expires_at.utcoffset() is None
            or self.expires_at <= self.approved_at
            or self.expires_at - self.approved_at > timedelta(minutes=30)
        ):
            raise ValueError("Sub2API approval requires a bounded aware-time interval")
        return self


@dataclass(frozen=True, slots=True)
class Sub2APIDispatchFacts:
    """Facts re-read from the claimed task, connection, and source snapshot."""

    project_id: str
    task_id: str
    attempt_id: str
    connection_id: str
    connection_revision: int
    provider_kind: str
    connection_enabled: bool
    base_url: str
    origin_mode: Sub2APIOriginMode
    model_id: str
    model_capabilities: tuple[str, ...]
    input_hash: str
    context_manifest_hash: str
    attempt_status: str
    task_kind: str


@dataclass(frozen=True, slots=True)
class Sub2APIPolicyMatch:
    """MATCHED means only that an atomic approval consume may be attempted."""

    status: Literal["MATCHED", "REJECTED"]
    code: str


def match_sub2api_approval(
    *,
    approval: Sub2APICallApprovalV1 | None,
    facts: Sub2APIDispatchFacts,
    now: datetime,
) -> Sub2APIPolicyMatch:
    """Check exact immutable scope before the store's one-call consume transaction."""
    if approval is None:
        return Sub2APIPolicyMatch("REJECTED", "APPROVAL_MISSING")
    if now.tzinfo is None or now.utcoffset() is None:
        return Sub2APIPolicyMatch("REJECTED", "CLOCK_INVALID")
    if now < approval.approved_at or now >= approval.expires_at:
        return Sub2APIPolicyMatch("REJECTED", "APPROVAL_EXPIRED")
    if (
        facts.provider_kind != "SUB2API"
        or not facts.connection_enabled
        or facts.task_kind != "sub2api.source.extract"
        or facts.attempt_status != "RUNNING"
        or facts.model_capabilities != ("TEXT",)
    ):
        return Sub2APIPolicyMatch("REJECTED", "EXECUTION_CONTEXT_INVALID")
    try:
        validate_sub2api_origin(facts.base_url, facts.origin_mode)
    except ValueError:
        return Sub2APIPolicyMatch("REJECTED", "ORIGIN_INVALID")
    if (
        approval.project_id != facts.project_id
        or approval.task_id != facts.task_id
        or approval.attempt_id != facts.attempt_id
        or approval.connection_id != facts.connection_id
        or approval.connection_revision != facts.connection_revision
        or approval.model_id != facts.model_id
        or approval.origin_mode != facts.origin_mode
        or approval.origin_hash != canonical_sha256(
            sub2api_origin_binding(
                facts.base_url, facts.origin_mode, facts.connection_revision
            )
        )
        or approval.input_hash != facts.input_hash
        or approval.context_manifest_hash != facts.context_manifest_hash
    ):
        return Sub2APIPolicyMatch("REJECTED", "APPROVAL_SCOPE_MISMATCH")
    return Sub2APIPolicyMatch("MATCHED", "EXACT_SCOPE_MATCHED")
