"""Closed, versioned post-dispatch settlement receipts and verification decisions."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Protocol

from pydantic import Field, model_validator

from aijian_api.agent_skill_contracts import ClosedModel, canonical_sha256


class RemoteSettlementReceiptPayloadV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    issuer_id: str = Field(min_length=1, max_length=128)
    trust_profile_id: str = Field(min_length=1, max_length=128)
    trust_profile_version: str = Field(min_length=1, max_length=64)
    receipt_id: str = Field(min_length=1, max_length=256)
    attempt_id: str = Field(pattern=r"^att_[0-9a-f]{32}$")
    authorization_id: str = Field(pattern=r"^rea_[0-9a-f]{32}$")
    consume_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    lease_generation: int = Field(strict=True, ge=1, le=2_147_483_647)
    evidence_binding_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    provider_response_id: str = Field(min_length=1, max_length=512)
    connection_id: str = Field(min_length=1, max_length=128)
    connection_revision: int = Field(strict=True, ge=1, le=2_147_483_647)
    model_id: str = Field(min_length=1, max_length=256)
    operation: Literal["remote.source.extract"]
    input_scope_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    currency: Literal["USD"]
    actual_micros: int = Field(strict=True, ge=0, le=9_007_199_254_740_991)
    settled_at: datetime

    @model_validator(mode="after")
    def require_timezone(self) -> RemoteSettlementReceiptPayloadV1:
        if self.settled_at.tzinfo is None or self.settled_at.utcoffset() is None:
            raise ValueError("settled_at must include a timezone")
        return self


class RemoteSettlementReceiptV1(ClosedModel):
    payload: RemoteSettlementReceiptPayloadV1
    payload_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    signature_algorithm: str = Field(min_length=1, max_length=64)
    signing_key_id: str = Field(min_length=1, max_length=256)
    signature: str = Field(min_length=1, max_length=8192)

    @model_validator(mode="after")
    def validate_payload_hash(self) -> RemoteSettlementReceiptV1:
        expected = canonical_sha256(self.payload.model_dump(mode="json"))
        if self.payload_hash != expected:
            raise ValueError("settlement receipt payload hash mismatch")
        return self

    def canonical_hash(self) -> str:
        return canonical_sha256(self.model_dump(mode="json"))


class RemoteSettlementVerificationV1(ClosedModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    status: Literal["VERIFIED", "DENIED"]
    code: str = Field(min_length=1, max_length=128)
    receipt_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    verifier_id: str = Field(min_length=1, max_length=128)
    verifier_version: str = Field(min_length=1, max_length=64)
    checked_at: datetime

    @model_validator(mode="after")
    def require_timezone(self) -> RemoteSettlementVerificationV1:
        if self.checked_at.tzinfo is None or self.checked_at.utcoffset() is None:
            raise ValueError("checked_at must include a timezone")
        return self


class RemoteSettlementVerifier(Protocol):
    """Verify using preloaded trust only.

    Implementations are called while the candidate transaction holds SQLite's
    write lock. They must be local, pure, side-effect-free, and strictly bounded:
    no network, filesystem, subprocess, secret-vault, or other external I/O. Load
    and refresh trust roots outside candidate transactions.
    """

    def verify(
        self, receipt: RemoteSettlementReceiptV1, *, checked_at: datetime
    ) -> RemoteSettlementVerificationV1: ...


class DenyRemoteSettlementVerifier:
    """Default-deny until an independently administered issuer trust root exists."""

    def verify(
        self, receipt: RemoteSettlementReceiptV1, *, checked_at: datetime
    ) -> RemoteSettlementVerificationV1:
        return RemoteSettlementVerificationV1(
            status="DENIED",
            code="NO_TRUSTED_SETTLEMENT_ISSUER",
            receipt_hash=receipt.canonical_hash(),
            verifier_id="builtin-deny",
            verifier_version="1.0.0",
            checked_at=checked_at,
        )


def migration_21_statements() -> tuple[str, ...]:
    """Add immutable settlement audit storage without rewriting historical proposals."""
    return (
        """
        CREATE TABLE remote_settlement_receipts (
            attempt_id TEXT PRIMARY KEY REFERENCES workflow_attempts(attempt_id),
            authorization_id TEXT NOT NULL,
            consume_revision INTEGER NOT NULL CHECK (consume_revision >= 1),
            lease_generation INTEGER NOT NULL CHECK (lease_generation >= 1),
            issuer_id TEXT NOT NULL,
            trust_profile_id TEXT NOT NULL,
            trust_profile_version TEXT NOT NULL,
            receipt_id TEXT NOT NULL,
            provider_response_id TEXT NOT NULL,
            connection_id TEXT NOT NULL,
            connection_revision INTEGER NOT NULL CHECK (connection_revision >= 1),
            model_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK (operation = 'remote.source.extract'),
            currency TEXT NOT NULL CHECK (currency = 'USD'),
            actual_micros INTEGER NOT NULL CHECK (actual_micros >= 0),
            settled_at TEXT NOT NULL,
            receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
            receipt_hash TEXT NOT NULL CHECK (
                length(receipt_hash) = 71 AND receipt_hash LIKE 'sha256:%'
            ),
            verification_json TEXT NOT NULL CHECK (json_valid(verification_json)),
            verification_hash TEXT NOT NULL CHECK (
                length(verification_hash) = 71 AND verification_hash LIKE 'sha256:%'
            ),
            created_at TEXT NOT NULL,
            UNIQUE (authorization_id, consume_revision),
            UNIQUE (issuer_id, trust_profile_id, receipt_id),
            FOREIGN KEY (authorization_id, consume_revision)
                REFERENCES remote_execution_authorization_snapshots(authorization_id, revision)
        )
        """,
        """
        CREATE TRIGGER remote_settlement_receipts_immutable_update
        BEFORE UPDATE ON remote_settlement_receipts
        BEGIN
            SELECT RAISE(ABORT, 'remote settlement receipt is immutable');
        END
        """,
        """
        CREATE TRIGGER remote_settlement_receipts_immutable_delete
        BEFORE DELETE ON remote_settlement_receipts
        BEGIN
            SELECT RAISE(ABORT, 'remote settlement receipt is immutable');
        END
        """,
    )
