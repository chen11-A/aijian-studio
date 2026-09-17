"""Strict, offline contracts for remote `source.extract` evidence."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime
from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_HASH = r"^sha256:[0-9a-f]{64}$"
_AUTH_ID = r"^rea_[0-9a-f]{32}$"
_PROJECT_ID = r"^prj_[0-9a-f]{32}$"
_CONNECTION_ID = r"^pcn_[0-9a-f]{32}$"
_CAPABILITY_ID = r"^evc_[0-9a-f]{32}$"
_COST_ID = r"^evf_[0-9a-f]{32}$"
_ACCOUNT_BINDING_ID = r"^cab_[0-9a-f]{32}$"


class _ClosedModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, strict=True, revalidate_instances="always"
    )


def _canonical_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, BaseModel):
        return _canonical_value(value.model_dump(mode="python"))
    if isinstance(value, Mapping):
        return {str(key): _canonical_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_value(item) for item in value]
    return value


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        _canonical_value(value), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()
    return f"sha256:{sha256(encoded).hexdigest()}"


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value


class RemoteExecutionGrantCoreV1(_ClosedModel):
    authorization_id: str = Field(pattern=_AUTH_ID)
    grant_revision: int = Field(ge=1, le=2_147_483_647)
    project_id: str = Field(pattern=_PROJECT_ID)
    connection_id: str = Field(pattern=_CONNECTION_ID)
    connection_revision: int = Field(ge=1, le=2_147_483_647)
    approved_model_id: str = Field(min_length=1, max_length=256)
    endpoint_binding: Literal["CPA_LOOPBACK_V1"]
    transport_contract_hash: str = Field(pattern=_HASH)
    operation: Literal["remote.source.extract"]
    input_scope_hash: str = Field(pattern=_HASH)
    dispatch_class: Literal["SYNTHETIC_CAPABILITY_PROBE", "FORMAL_CONTENT_EXECUTION"]
    requested_additional_budget_micros: int = Field(ge=0)
    approved_currency: Literal["USD"]
    issued_at: datetime
    expires_at: datetime
    policy_version: str = Field(min_length=1, max_length=128)

    @field_validator("issued_at", "expires_at")
    @classmethod
    def requires_aware_datetime(cls, value: datetime) -> datetime:
        return _aware(value)

    @model_validator(mode="after")
    def expires_after_issue(self) -> RemoteExecutionGrantCoreV1:
        if self.expires_at <= self.issued_at:
            raise ValueError("expires_at must be after issued_at")
        return self


def grant_core_hash(grant: RemoteExecutionGrantCoreV1) -> str:
    return canonical_sha256(grant.model_dump(mode="python"))


class RemoteExecutionBindingV1(_ClosedModel):
    grant: RemoteExecutionGrantCoreV1
    grant_core_hash: str = Field(pattern=_HASH)

    @model_validator(mode="after")
    def matches_grant_core(self) -> RemoteExecutionBindingV1:
        if self.grant_core_hash != grant_core_hash(self.grant):
            raise ValueError("grant_core_hash does not match grant")
        return self


def evidence_binding_hash(binding: RemoteExecutionBindingV1) -> str:
    return canonical_sha256({"grant_core_hash": binding.grant_core_hash})


class CapabilityEvidenceV1(_ClosedModel):
    evidence_id: str = Field(pattern=_CAPABILITY_ID)
    issuer_ref: str = Field(min_length=1, max_length=256)
    trust_profile_id: str = Field(min_length=1, max_length=256)
    credential_account_binding_ref: str = Field(pattern=_ACCOUNT_BINDING_ID)
    binding_hash: str = Field(pattern=_HASH)
    connection_id: str = Field(pattern=_CONNECTION_ID)
    connection_revision: int = Field(ge=1, le=2_147_483_647)
    approved_model_id: str = Field(min_length=1, max_length=256)
    operation: Literal["remote.source.extract"]
    dispatch_class: Literal["SYNTHETIC_CAPABILITY_PROBE", "FORMAL_CONTENT_EXECUTION"]
    entitlement_claim: Literal["CAPABILITY_AND_ENTITLEMENT_FOR_BOUND_OPERATION"]
    verification_payload_hash: str = Field(pattern=_HASH)
    issued_at: datetime
    expires_at: datetime
    revocation_reference: str = Field(pattern=r".*\S.*", max_length=256)
    verifier_output_hash: str = Field(pattern=_HASH)

    @field_validator("issued_at", "expires_at")
    @classmethod
    def requires_aware_datetime(cls, value: datetime) -> datetime:
        return _aware(value)

    @model_validator(mode="after")
    def is_well_formed(self) -> CapabilityEvidenceV1:
        if self.expires_at <= self.issued_at:
            raise ValueError("expires_at must be after issued_at")
        if self.verifier_output_hash != capability_verifier_output_hash(self):
            raise ValueError("capability verifier_output_hash does not match payload")
        return self


def capability_verifier_output_hash(evidence: CapabilityEvidenceV1) -> str:
    return canonical_sha256(evidence.model_dump(exclude={"verifier_output_hash"}, mode="python"))


class CostEvidenceV1(_ClosedModel):
    evidence_id: str = Field(pattern=_COST_ID)
    issuer_ref: str = Field(min_length=1, max_length=256)
    trust_profile_id: str = Field(min_length=1, max_length=256)
    credential_account_binding_ref: str = Field(pattern=_ACCOUNT_BINDING_ID)
    binding_hash: str = Field(pattern=_HASH)
    connection_id: str = Field(pattern=_CONNECTION_ID)
    connection_revision: int = Field(ge=1, le=2_147_483_647)
    approved_model_id: str = Field(min_length=1, max_length=256)
    operation: Literal["remote.source.extract"]
    dispatch_class: Literal["SYNTHETIC_CAPABILITY_PROBE", "FORMAL_CONTENT_EXECUTION"]
    currency: Literal["USD"]
    maximum_incremental_cost_micros: int = Field(ge=0, le=9_000_000_000_000_000)
    estimated_incremental_cost_micros: int = Field(ge=0, le=9_000_000_000_000_000)
    cost_evidence_hash: str = Field(pattern=_HASH)
    metering_scope_hash: str = Field(pattern=_HASH)
    issued_at: datetime
    expires_at: datetime
    revocation_reference: str = Field(pattern=r".*\S.*", max_length=256)
    verifier_output_hash: str = Field(pattern=_HASH)

    @field_validator("issued_at", "expires_at")
    @classmethod
    def requires_aware_datetime(cls, value: datetime) -> datetime:
        return _aware(value)

    @model_validator(mode="after")
    def is_well_formed(self) -> CostEvidenceV1:
        if self.expires_at <= self.issued_at:
            raise ValueError("expires_at must be after issued_at")
        if self.estimated_incremental_cost_micros > self.maximum_incremental_cost_micros:
            raise ValueError("estimated cost must not exceed maximum cost")
        if self.verifier_output_hash != cost_verifier_output_hash(self):
            raise ValueError("cost verifier_output_hash does not match payload")
        return self


def cost_verifier_output_hash(evidence: CostEvidenceV1) -> str:
    return canonical_sha256(evidence.model_dump(exclude={"verifier_output_hash"}, mode="python"))


class RemoteExecutionEvidenceBundleV1(_ClosedModel):
    capability: CapabilityEvidenceV1
    cost: CostEvidenceV1


EvidenceDecisionStatus = Literal["ALLOW", "DENY"]
EvidenceDecisionCode = Literal[
    "EVIDENCE_VERIFIED",
    "EVIDENCE_MALFORMED",
    "EVIDENCE_UNTRUSTED",
    "EVIDENCE_REVOKED_OR_EXPIRED",
    "EVIDENCE_BINDING_MISMATCH",
    "EVIDENCE_CREDENTIAL_ACCOUNT_UNKNOWN",
    "EVIDENCE_CAPABILITY_UNKNOWN",
    "EVIDENCE_COST_UNKNOWN",
    "EVIDENCE_ZERO_BUDGET_EXCEEDED",
]


class RemoteEvidenceDecisionV1(_ClosedModel):
    status: EvidenceDecisionStatus
    code: EvidenceDecisionCode
    binding_hash: str = Field(pattern=_HASH)
    capability_evidence_id: str = Field(pattern=_CAPABILITY_ID)
    capability_evidence_hash: str = Field(pattern=_HASH)
    cost_evidence_id: str = Field(pattern=_COST_ID)
    cost_evidence_hash: str = Field(pattern=_HASH)
    trust_profile_version: str = Field(min_length=1, max_length=256)
    verifier_id: str = Field(min_length=1, max_length=256)
    verified_at: datetime
    valid_until: datetime
    verifier_output_hash: str = Field(pattern=_HASH)

    @field_validator("verified_at", "valid_until")
    @classmethod
    def requires_aware_datetime(cls, value: datetime) -> datetime:
        return _aware(value)

    @model_validator(mode="after")
    def is_well_formed(self) -> RemoteEvidenceDecisionV1:
        if self.valid_until < self.verified_at:
            raise ValueError("valid_until must not precede verified_at")
        if self.verifier_output_hash != decision_verifier_output_hash(self):
            raise ValueError("decision verifier_output_hash does not match payload")
        return self


def decision_verifier_output_hash(decision: RemoteEvidenceDecisionV1) -> str:
    return canonical_sha256(decision.model_dump(exclude={"verifier_output_hash"}, mode="python"))
