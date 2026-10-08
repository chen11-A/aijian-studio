"""Human declarations about one immutable media version, not legal verification."""

from __future__ import annotations

import unicodedata
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from aijian_api.contracts import PROJECT_ID_PATTERN
from aijian_api.media_asset_contracts import ASSET_ID_PATTERN, ASSET_VERSION_ID_PATTERN

RIGHTS_DECISION_ID_PATTERN = r"^ard_[0-9a-f]{32}$"
RIGHTS_OPERATION_ID_PATTERN = r"^rdop_[0-9a-f]{32}$"
_HASH_PATTERN = r"^[0-9a-f]{64}$"

type HumanRightsDecision = Literal["CLEARED", "RESTRICTED"]
type RightsReadStatus = Literal[
    "VERIFIED",
    "NO_DECISION",
    "CONFLICT",
    "NOT_FOUND",
    "UNKNOWN_DATABASE",
    "UNKNOWN_DATABASE_BUSY",
    "UNKNOWN_DATABASE_CHANGED",
    "UNKNOWN_INVALID_RECORD",
    "UNKNOWN_READ_BUDGET",
    "UNKNOWN_UNSAFE_PATH",
    "UNKNOWN_UNSUPPORTED_PLATFORM",
]


def _unreadable(character: str, *, allow_layout: bool) -> bool:
    code = ord(character)
    return (
        code == 127
        or 0xD800 <= code <= 0xDFFF
        or (code < 32 and (not allow_layout or character not in {"\n", "\t"}))
    )


class HumanRightsDecisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    operation_id: str = Field(pattern=RIGHTS_OPERATION_ID_PATTERN)
    expected_revision: int = Field(strict=True, ge=0)
    decision: HumanRightsDecision
    basis_text: str = Field(min_length=20, max_length=4000)
    supporting_reference: str | None = Field(default=None, min_length=1, max_length=512)

    @field_validator("basis_text")
    @classmethod
    def require_readable_basis(cls, value: str) -> str:
        normalized = unicodedata.normalize("NFC", value)
        if not 20 <= len(normalized) <= 4000 or normalized != normalized.strip() or any(
            _unreadable(character, allow_layout=True) for character in normalized
        ):
            raise ValueError("rights basis must be readable and trimmed")
        return normalized

    @field_validator("supporting_reference")
    @classmethod
    def require_readable_reference(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = unicodedata.normalize("NFC", value)
        if (
            not 1 <= len(normalized) <= 512
            or normalized != normalized.strip()
            or any(_unreadable(character, allow_layout=False) for character in normalized)
        ):
            raise ValueError("rights evidence reference must be readable and trimmed")
        return normalized


class RightsDecisionAuditData(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal[1] = 1
    decision_id: str = Field(pattern=RIGHTS_DECISION_ID_PATTERN)
    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    asset_id: str = Field(pattern=ASSET_ID_PATTERN)
    version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    asset_sha256: str = Field(pattern=_HASH_PATTERN)
    revision: int = Field(strict=True, ge=1)
    previous_decision_id: str | None = Field(default=None, pattern=RIGHTS_DECISION_ID_PATTERN)
    operation_id: str = Field(pattern=RIGHTS_OPERATION_ID_PATTERN)
    request_sha256: str = Field(pattern=_HASH_PATTERN)
    decision: HumanRightsDecision
    actor_type: Literal["human"] = "human"
    actor_id: str = Field(min_length=1, max_length=128)
    basis_text: str = Field(min_length=20, max_length=4000)
    supporting_reference: str | None = Field(default=None, min_length=1, max_length=512)
    evidence_sha256: str = Field(pattern=_HASH_PATTERN)
    decision_content_hash: str = Field(pattern=_HASH_PATTERN)
    created_at: str

    @model_validator(mode="after")
    def require_predecessor(self) -> Self:
        if (self.revision == 1) != (self.previous_decision_id is None):
            raise ValueError("rights decision predecessor does not match revision")
        return self


class RightsDecisionWriteReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    decision: RightsDecisionAuditData
    replayed: bool
    is_latest: bool
    current_revision: int = Field(strict=True, ge=1)

    @model_validator(mode="after")
    def require_current_head(self) -> Self:
        if (
            self.current_revision < self.decision.revision
            or self.is_latest != (self.current_revision == self.decision.revision)
        ):
            raise ValueError("rights decision write receipt disagrees with head")
        return self


class AuthoritativeRightsDecision(BaseModel):
    """Narrow readback for export preflight; basis stays in the audit read API."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    project_id: str = Field(pattern=PROJECT_ID_PATTERN)
    asset_id: str = Field(pattern=ASSET_ID_PATTERN)
    version_id: str = Field(pattern=ASSET_VERSION_ID_PATTERN)
    asset_sha256: str = Field(pattern=_HASH_PATTERN)
    decision_id: str = Field(pattern=RIGHTS_DECISION_ID_PATTERN)
    revision: int = Field(strict=True, ge=1)
    decision: HumanRightsDecision
    previous_decision_id: str | None = Field(default=None, pattern=RIGHTS_DECISION_ID_PATTERN)
    decision_content_hash: str = Field(pattern=_HASH_PATTERN)
    evidence_sha256: str = Field(pattern=_HASH_PATTERN)
    actor_id: str = Field(min_length=1, max_length=128)
    chain_integrity: Literal[True] = True


class RightsDecisionReadResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    status: RightsReadStatus
    current_revision: int | None = Field(default=None, strict=True, ge=0)
    decision: AuthoritativeRightsDecision | None = None

    @model_validator(mode="after")
    def require_authoritative_payload(self) -> Self:
        if self.status == "VERIFIED":
            if self.decision is None or self.current_revision != self.decision.revision:
                raise ValueError("verified rights decision requires matching head")
        elif self.decision is not None:
            raise ValueError("non-authoritative rights result cannot carry a decision")
        if self.status == "NO_DECISION" and self.current_revision != 0:
            raise ValueError("missing rights decision requires revision zero")
        return self
