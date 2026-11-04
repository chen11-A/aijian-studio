"""Sub2API source extraction readback and explicit one-call consent contracts.

These DTOs neither grant dispatch authority nor prove provider charges. Proposal
references identify the existing proposal truth; no second candidate store is defined.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from aijian_api.agent_skill_contracts import ProposalUnknownCostV2
from aijian_api.contracts import (
    ATTEMPT_ID_PATTERN,
    CONTENT_HASH_PATTERN,
    PROJECT_ID_PATTERN,
    PROPOSAL_ID_PATTERN,
    TASK_ID_PATTERN,
    CreateProposalRunRequest,
)
from aijian_api.provider_contracts import PROVIDER_CONNECTION_ID_PATTERN, Sub2APIOriginMode


class _ClosedContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Sub2APISourceExtractSelectionData(_ClosedContract):
    connection_id: str = Field(pattern=PROVIDER_CONNECTION_ID_PATTERN)
    connection_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    model_id: str = Field(min_length=1, max_length=200, pattern=r"^\S(?:.*\S)?$")


class CreateSub2APISourceExtractRunRequest(_ClosedContract):
    """Queue only. This request does not authorize a charge or a network call."""

    source: CreateProposalRunRequest
    selection: Sub2APISourceExtractSelectionData

    @model_validator(mode="after")
    def validate_source_range(self) -> CreateSub2APISourceExtractRunRequest:
        if self.source.end_byte <= self.source.start_byte:
            raise ValueError("source end_byte must be greater than start_byte")
        return self


class Sub2APISourceExtractScopeData(_ClosedContract):
    """Server-derived task facts displayed before explicit user consent."""

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    task_id: str = Field(pattern=TASK_ID_PATTERN)
    attempt_id: str = Field(pattern=ATTEMPT_ID_PATTERN)
    selection: Sub2APISourceExtractSelectionData
    source: CreateProposalRunRequest
    origin_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    origin_mode: Sub2APIOriginMode = "PUBLIC_HTTPS"
    input_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    context_manifest_hash: str = Field(pattern=CONTENT_HASH_PATTERN)
    attempt_fingerprint: str = Field(pattern=CONTENT_HASH_PATTERN)

    @model_validator(mode="after")
    def validate_source_range(self) -> Sub2APISourceExtractScopeData:
        if self.source.end_byte <= self.source.start_byte:
            raise ValueError("source end_byte must be greater than start_byte")
        return self


class Sub2APIUnknownCostV1(ProposalUnknownCostV2):
    """Operation readback uses the same unknown-charge fields as proposal V2."""


class CreateSub2APICallApprovalRequest(_ClosedContract):
    """Idempotency-Key is a required HTTP header, not a client-supplied scope."""

    task_id: str = Field(pattern=TASK_ID_PATTERN)
    attempt_id: str = Field(pattern=ATTEMPT_ID_PATTERN)
    expected_attempt_fingerprint: str = Field(pattern=CONTENT_HASH_PATTERN)
    unknown_cost_accepted: Literal[True]
    allowed_calls: Literal[1]

    @model_validator(mode="before")
    @classmethod
    def require_explicit_consent_types(cls, value: object) -> object:
        if isinstance(value, dict) and (
            value.get("unknown_cost_accepted") is not True
            or type(value.get("allowed_calls")) is not int
            or value.get("allowed_calls") != 1
        ):
            raise ValueError("explicit boolean consent and integer one-call limit are required")
        return value


class Sub2APICallApprovalData(_ClosedContract):
    """Persisted approval projection; consumption is enforced by the store."""

    approval_id: str = Field(pattern=r"^[a-z]{3}_[0-9a-f]{32}$")
    scope: Sub2APISourceExtractScopeData
    status: Literal["APPROVED_ONE_CALL", "CONSUMED", "EXPIRED", "REVOKED"]
    approved_at: datetime
    expires_at: datetime
    allowed_calls: Literal[1] = 1
    cost_decision: Literal["UNKNOWN_COST_ACCEPTED"] = "UNKNOWN_COST_ACCEPTED"
    cost: Sub2APIUnknownCostV1

    @model_validator(mode="after")
    def validate_interval(self) -> Sub2APICallApprovalData:
        if (
            self.approved_at.tzinfo is None
            or self.approved_at.utcoffset() is None
            or self.expires_at.tzinfo is None
            or self.expires_at.utcoffset() is None
            or not timedelta(0) < self.expires_at - self.approved_at <= timedelta(minutes=30)
        ):
            raise ValueError(
                "approval requires aware timestamps and a lifetime of at most 30 minutes"
            )
        return self


class Sub2APISourceExtractRunData(_ClosedContract):
    scope: Sub2APISourceExtractScopeData
    attempt_status: str = Field(min_length=1)
    approval_id: str | None = Field(pattern=r"^[a-z]{3}_[0-9a-f]{32}$")
    proposal_id: str | None = Field(pattern=PROPOSAL_ID_PATTERN)
    content_status: Literal["PENDING", "PROPOSAL_READY", "FAILED", "REMOTE_UNKNOWN"]
    cost: Sub2APIUnknownCostV1
    automatic_retry_allowed: Literal[False] = False

    @model_validator(mode="after")
    def validate_proposal_reference(self) -> Sub2APISourceExtractRunData:
        if (self.content_status == "PROPOSAL_READY") != (self.proposal_id is not None):
            raise ValueError("only PROPOSAL_READY may reference a persisted proposal")
        if self.content_status == "PROPOSAL_READY" and self.approval_id is None:
            raise ValueError("a Sub2API proposal requires a consumed approval reference")
        return self


class Sub2APICallApprovalResponse(_ClosedContract):
    data: Sub2APICallApprovalData
    request_id: UUID


class Sub2APISourceExtractRunResponse(_ClosedContract):
    data: Sub2APISourceExtractRunData
    request_id: UUID
