"""Default-deny evaluator for the isolated remote evidence contracts."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol

from pydantic import ValidationError

from aijian_api.remote_execution_evidence_contracts import (
    EvidenceDecisionCode,
    RemoteEvidenceDecisionV1,
    RemoteExecutionBindingV1,
    RemoteExecutionEvidenceBundleV1,
    canonical_sha256,
    decision_verifier_output_hash,
    evidence_binding_hash,
)

_INVALID_BINDING_HASH = canonical_sha256({"contract": "remote-evidence-v1", "state": "malformed"})


class RemoteEvidenceVerifier(Protocol):
    """Registered root verifies proof, account binding, and revocation; unknown states deny."""

    def evaluate(
        self,
        *,
        binding: RemoteExecutionBindingV1,
        envelope: RemoteExecutionEvidenceBundleV1,
        now: datetime,
    ) -> RemoteEvidenceDecisionV1: ...


def _evidence_hash(value: object) -> str:
    return canonical_sha256(value)


def _deny(
    *,
    binding_hash: str,
    code: EvidenceDecisionCode,
    now: datetime,
    envelope: RemoteExecutionEvidenceBundleV1 | None = None,
) -> RemoteEvidenceDecisionV1:
    capability_id = (
        envelope.capability.evidence_id if envelope else "evc_00000000000000000000000000000000"
    )
    cost_id = envelope.cost.evidence_id if envelope else "evf_00000000000000000000000000000000"
    capability_hash = _evidence_hash(envelope.capability) if envelope else _INVALID_BINDING_HASH
    cost_hash = _evidence_hash(envelope.cost) if envelope else _INVALID_BINDING_HASH
    raw = RemoteEvidenceDecisionV1.model_construct(
        status="DENY",
        code=code,
        binding_hash=binding_hash,
        capability_evidence_id=capability_id,
        capability_evidence_hash=capability_hash,
        cost_evidence_id=cost_id,
        cost_evidence_hash=cost_hash,
        trust_profile_version="offline-default-deny-v1",
        verifier_id="offline-default-deny-v1",
        verified_at=now,
        valid_until=now,
        verifier_output_hash="sha256:" + "0" * 64,
    )
    return RemoteEvidenceDecisionV1.model_validate(
        {
            **raw.model_dump(exclude={"verifier_output_hash"}),
            "verifier_output_hash": decision_verifier_output_hash(raw),
        }
    )


def evaluate_remote_execution_evidence(
    *,
    verifier: RemoteEvidenceVerifier | None,
    binding: RemoteExecutionBindingV1,
    envelope: RemoteExecutionEvidenceBundleV1,
    now: datetime,
) -> RemoteEvidenceDecisionV1:
    """Map malformed or untrusted inputs to a safe DENY before any integration can occur."""
    if now.tzinfo is None or now.utcoffset() is None:
        return _deny(
            binding_hash=_INVALID_BINDING_HASH, code="EVIDENCE_MALFORMED", now=datetime.now(UTC)
        )
    try:
        binding = RemoteExecutionBindingV1.model_validate(binding)
        envelope = RemoteExecutionEvidenceBundleV1.model_validate(envelope)
    except (ValidationError, TypeError, ValueError):
        return _deny(binding_hash=_INVALID_BINDING_HASH, code="EVIDENCE_MALFORMED", now=now)
    bound_hash = evidence_binding_hash(binding)
    if binding.grant.issued_at > now or binding.grant.expires_at <= now:
        return _deny(
            binding_hash=bound_hash, code="EVIDENCE_REVOKED_OR_EXPIRED", now=now, envelope=envelope
        )
    capability, cost, grant = envelope.capability, envelope.cost, binding.grant
    if capability.binding_hash != bound_hash or cost.binding_hash != bound_hash:
        return _deny(
            binding_hash=bound_hash, code="EVIDENCE_BINDING_MISMATCH", now=now, envelope=envelope
        )
    for evidence in (capability, cost):
        if (
            evidence.connection_id,
            evidence.connection_revision,
            evidence.approved_model_id,
            evidence.operation,
            evidence.dispatch_class,
        ) != (
            grant.connection_id,
            grant.connection_revision,
            grant.approved_model_id,
            grant.operation,
            grant.dispatch_class,
        ):
            return _deny(
                binding_hash=bound_hash,
                code="EVIDENCE_BINDING_MISMATCH",
                now=now,
                envelope=envelope,
            )
        if evidence.issued_at > now or evidence.expires_at <= now:
            return _deny(
                binding_hash=bound_hash,
                code="EVIDENCE_REVOKED_OR_EXPIRED",
                now=now,
                envelope=envelope,
            )
    if capability.credential_account_binding_ref != cost.credential_account_binding_ref:
        return _deny(
            binding_hash=bound_hash,
            code="EVIDENCE_CREDENTIAL_ACCOUNT_UNKNOWN",
            now=now,
            envelope=envelope,
        )
    if capability.entitlement_claim != "CAPABILITY_AND_ENTITLEMENT_FOR_BOUND_OPERATION":
        return _deny(
            binding_hash=bound_hash, code="EVIDENCE_CAPABILITY_UNKNOWN", now=now, envelope=envelope
        )
    if (
        cost.currency != grant.approved_currency
        or cost.metering_scope_hash != grant.input_scope_hash
    ):
        return _deny(
            binding_hash=bound_hash, code="EVIDENCE_COST_UNKNOWN", now=now, envelope=envelope
        )
    if (
        grant.requested_additional_budget_micros
        or cost.maximum_incremental_cost_micros
        or cost.estimated_incremental_cost_micros
    ):
        return _deny(
            binding_hash=bound_hash,
            code="EVIDENCE_ZERO_BUDGET_EXCEEDED",
            now=now,
            envelope=envelope,
        )
    if verifier is None:
        return _deny(binding_hash=bound_hash, code="EVIDENCE_UNTRUSTED", now=now, envelope=envelope)
    try:
        decision = RemoteEvidenceDecisionV1.model_validate(
            verifier.evaluate(binding=binding, envelope=envelope, now=now)
        )
    except Exception:
        return _deny(binding_hash=bound_hash, code="EVIDENCE_MALFORMED", now=now, envelope=envelope)
    if (
        decision.binding_hash,
        decision.capability_evidence_id,
        decision.capability_evidence_hash,
        decision.cost_evidence_id,
        decision.cost_evidence_hash,
    ) != (
        bound_hash,
        capability.evidence_id,
        _evidence_hash(capability),
        cost.evidence_id,
        _evidence_hash(cost),
    ):
        return _deny(
            binding_hash=bound_hash, code="EVIDENCE_BINDING_MISMATCH", now=now, envelope=envelope
        )
    if (
        decision.trust_profile_version != capability.trust_profile_id
        or decision.trust_profile_version != cost.trust_profile_id
    ):
        return _deny(binding_hash=bound_hash, code="EVIDENCE_UNTRUSTED", now=now, envelope=envelope)
    if (
        (decision.status == "ALLOW" and decision.code != "EVIDENCE_VERIFIED")
        or (decision.status == "DENY" and decision.code == "EVIDENCE_VERIFIED")
        or decision.verified_at > now
        or decision.verified_at < max(grant.issued_at, capability.issued_at, cost.issued_at)
        or decision.valid_until <= decision.verified_at
    ):
        return _deny(binding_hash=bound_hash, code="EVIDENCE_MALFORMED", now=now, envelope=envelope)
    if decision.valid_until <= now or decision.valid_until > min(
        grant.expires_at, capability.expires_at, cost.expires_at
    ):
        return _deny(
            binding_hash=bound_hash, code="EVIDENCE_REVOKED_OR_EXPIRED", now=now, envelope=envelope
        )
    return decision
