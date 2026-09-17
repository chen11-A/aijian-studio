from datetime import UTC, datetime, timedelta

from aijian_api.remote_execution_evidence_contracts import (
    CapabilityEvidenceV1,
    CostEvidenceV1,
    RemoteEvidenceDecisionV1,
    RemoteExecutionBindingV1,
    RemoteExecutionEvidenceBundleV1,
    RemoteExecutionGrantCoreV1,
    canonical_sha256,
    capability_verifier_output_hash,
    cost_verifier_output_hash,
    decision_verifier_output_hash,
    evidence_binding_hash,
    grant_core_hash,
)
from aijian_api.remote_execution_evidence_verifier import (
    RemoteEvidenceVerifier,
    evaluate_remote_execution_evidence,
)

NOW = datetime(2026, 9, 15, 12, tzinfo=UTC)


def make_binding(**update: object) -> RemoteExecutionBindingV1:
    fields: dict[str, object] = dict(
        authorization_id="rea_00000000000000000000000000000001",
        grant_revision=1,
        project_id="prj_00000000000000000000000000000001",
        connection_id="pcn_00000000000000000000000000000001",
        connection_revision=4,
        approved_model_id="model-alpha",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash="sha256:" + "1" * 64,
        operation="remote.source.extract",
        input_scope_hash="sha256:" + "2" * 64,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=NOW,
        expires_at=NOW + timedelta(hours=1),
        policy_version="e5-v1",
    )
    fields.update(update)
    grant = RemoteExecutionGrantCoreV1(**fields)
    return RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant))


def make_bundle(
    bound: RemoteExecutionBindingV1, **update: object
) -> RemoteExecutionEvidenceBundleV1:
    g = bound.grant
    common: dict[str, object] = dict(
        issuer_ref="issuer",
        trust_profile_id="profile-v1",
        credential_account_binding_ref="cab_00000000000000000000000000000001",
        binding_hash=evidence_binding_hash(bound),
        connection_id=g.connection_id,
        connection_revision=g.connection_revision,
        approved_model_id=g.approved_model_id,
        operation=g.operation,
        dispatch_class=g.dispatch_class,
        issued_at=NOW - timedelta(minutes=1),
        expires_at=NOW + timedelta(minutes=30),
        revocation_reference="revocation-proof-ref",
    )
    cap_values = dict(
        evidence_id="evc_00000000000000000000000000000001",
        entitlement_claim="CAPABILITY_AND_ENTITLEMENT_FOR_BOUND_OPERATION",
        verification_payload_hash="sha256:" + "3" * 64,
        **common,
    )
    cap_raw = CapabilityEvidenceV1.model_construct(
        **cap_values, verifier_output_hash="sha256:" + "0" * 64
    )
    cap = CapabilityEvidenceV1(
        **cap_values, verifier_output_hash=capability_verifier_output_hash(cap_raw)
    )
    cost_values = dict(
        evidence_id="evf_00000000000000000000000000000001",
        currency="USD",
        maximum_incremental_cost_micros=0,
        estimated_incremental_cost_micros=0,
        cost_evidence_hash="sha256:" + "4" * 64,
        metering_scope_hash=g.input_scope_hash,
        **common,
    )
    cost_raw = CostEvidenceV1.model_construct(
        **cost_values, verifier_output_hash="sha256:" + "0" * 64
    )
    cost = CostEvidenceV1(**cost_values, verifier_output_hash=cost_verifier_output_hash(cost_raw))
    fields: dict[str, object] = dict(capability=cap, cost=cost)
    fields.update(update)
    return RemoteExecutionEvidenceBundleV1(**fields)


def resign_cost(value: CostEvidenceV1, **update: object) -> CostEvidenceV1:
    fields = value.model_dump(exclude={"verifier_output_hash"})
    fields.update(update)
    raw = CostEvidenceV1.model_construct(**fields, verifier_output_hash="sha256:" + "0" * 64)
    return CostEvidenceV1(**fields, verifier_output_hash=cost_verifier_output_hash(raw))


class TrustedTestRoot(RemoteEvidenceVerifier):
    def evaluate(
        self,
        *,
        binding: RemoteExecutionBindingV1,
        envelope: RemoteExecutionEvidenceBundleV1,
        now: datetime,
    ) -> RemoteEvidenceDecisionV1:
        fields: dict[str, object] = dict(
            status="ALLOW",
            code="EVIDENCE_VERIFIED",
            binding_hash=evidence_binding_hash(binding),
            capability_evidence_id=envelope.capability.evidence_id,
            capability_evidence_hash=canonical_sha256(envelope.capability),
            cost_evidence_id=envelope.cost.evidence_id,
            cost_evidence_hash=canonical_sha256(envelope.cost),
            trust_profile_version=envelope.capability.trust_profile_id,
            verifier_id="tests-only-root",
            verified_at=now,
            valid_until=now + timedelta(minutes=1),
        )
        raw = RemoteEvidenceDecisionV1.model_construct(
            **fields, verifier_output_hash="sha256:" + "0" * 64
        )
        return RemoteEvidenceDecisionV1(
            **fields, verifier_output_hash=decision_verifier_output_hash(raw)
        )


def test_default_deny_without_registered_root() -> None:
    bound = make_binding()
    result = evaluate_remote_execution_evidence(
        verifier=None, binding=bound, envelope=make_bundle(bound), now=NOW
    )
    assert (result.status, result.code) == ("DENY", "EVIDENCE_UNTRUSTED")


def test_only_injected_test_root_can_allow_complete_c5_evidence() -> None:
    bound = make_binding()
    result = evaluate_remote_execution_evidence(
        verifier=TrustedTestRoot(), binding=bound, envelope=make_bundle(bound), now=NOW
    )
    assert (result.status, result.code) == ("ALLOW", "EVIDENCE_VERIFIED")


def test_reused_evidence_and_model_copy_tampering_are_safely_denied() -> None:
    original = make_binding()
    other = make_binding(input_scope_hash="sha256:" + "9" * 64)
    mismatch = evaluate_remote_execution_evidence(
        verifier=TrustedTestRoot(), binding=other, envelope=make_bundle(original), now=NOW
    )
    tampered = original.model_copy(update={"grant_core_hash": "sha256:" + "0" * 64})
    malformed = evaluate_remote_execution_evidence(
        verifier=TrustedTestRoot(), binding=tampered, envelope=make_bundle(original), now=NOW
    )
    assert mismatch.code == "EVIDENCE_BINDING_MISMATCH"
    assert malformed.code == "EVIDENCE_MALFORMED"


def test_missing_account_cost_scope_or_nonzero_budget_are_distinct_denials() -> None:
    bound = make_binding()
    account = make_bundle(
        bound,
        cost=resign_cost(
            make_bundle(bound).cost,
            credential_account_binding_ref="cab_00000000000000000000000000000002",
        ),
    )
    scope = make_bundle(
        bound, cost=resign_cost(make_bundle(bound).cost, metering_scope_hash="sha256:" + "9" * 64)
    )
    budget = make_binding(requested_additional_budget_micros=1)
    assert (
        evaluate_remote_execution_evidence(
            verifier=TrustedTestRoot(), binding=bound, envelope=account, now=NOW
        ).code
        == "EVIDENCE_CREDENTIAL_ACCOUNT_UNKNOWN"
    )
    assert (
        evaluate_remote_execution_evidence(
            verifier=TrustedTestRoot(), binding=bound, envelope=scope, now=NOW
        ).code
        == "EVIDENCE_COST_UNKNOWN"
    )
    assert (
        evaluate_remote_execution_evidence(
            verifier=TrustedTestRoot(), binding=budget, envelope=make_bundle(budget), now=NOW
        ).code
        == "EVIDENCE_ZERO_BUDGET_EXCEEDED"
    )


def test_decision_output_is_revalidated_and_must_not_outlive_evidence() -> None:
    bound = make_binding()

    class ExpiringRoot(TrustedTestRoot):
        def evaluate(
            self,
            *,
            binding: RemoteExecutionBindingV1,
            envelope: RemoteExecutionEvidenceBundleV1,
            now: datetime,
        ) -> RemoteEvidenceDecisionV1:
            valid = super().evaluate(binding=binding, envelope=envelope, now=now)
            return valid.model_copy(update={"valid_until": now + timedelta(hours=2)})

    assert (
        evaluate_remote_execution_evidence(
            verifier=ExpiringRoot(), binding=bound, envelope=make_bundle(bound), now=NOW
        ).code
        == "EVIDENCE_MALFORMED"
    )


def test_future_grant_and_naive_now_are_safe_denials() -> None:
    future = make_binding(issued_at=NOW + timedelta(minutes=1), expires_at=NOW + timedelta(hours=1))
    assert (
        evaluate_remote_execution_evidence(
            verifier=TrustedTestRoot(), binding=future, envelope=make_bundle(future), now=NOW
        ).code
        == "EVIDENCE_REVOKED_OR_EXPIRED"
    )
    bound = make_binding()
    assert (
        evaluate_remote_execution_evidence(
            verifier=None, binding=bound, envelope=make_bundle(bound), now=NOW.replace(tzinfo=None)
        ).code
        == "EVIDENCE_MALFORMED"
    )


def test_runtime_verifier_failure_and_invalid_allow_decision_are_safe_denials() -> None:
    bound = make_binding()

    class BrokenRoot(RemoteEvidenceVerifier):
        def evaluate(
            self,
            *,
            binding: RemoteExecutionBindingV1,
            envelope: RemoteExecutionEvidenceBundleV1,
            now: datetime,
        ) -> RemoteEvidenceDecisionV1:
            raise RuntimeError("sensitive provider failure")

    assert (
        evaluate_remote_execution_evidence(
            verifier=BrokenRoot(), binding=bound, envelope=make_bundle(bound), now=NOW
        ).code
        == "EVIDENCE_MALFORMED"
    )

    class BadAllowRoot(TrustedTestRoot):
        def evaluate(
            self,
            *,
            binding: RemoteExecutionBindingV1,
            envelope: RemoteExecutionEvidenceBundleV1,
            now: datetime,
        ) -> RemoteEvidenceDecisionV1:
            return (
                super()
                .evaluate(binding=binding, envelope=envelope, now=now)
                .model_copy(update={"code": "EVIDENCE_MALFORMED"})
            )

    assert (
        evaluate_remote_execution_evidence(
            verifier=BadAllowRoot(), binding=bound, envelope=make_bundle(bound), now=NOW
        ).code
        == "EVIDENCE_MALFORMED"
    )


def resign_decision(value: RemoteEvidenceDecisionV1, **update: object) -> RemoteEvidenceDecisionV1:
    fields = value.model_dump(exclude={"verifier_output_hash"})
    fields.update(update)
    raw = RemoteEvidenceDecisionV1.model_construct(
        **fields, verifier_output_hash="sha256:" + "0" * 64
    )
    return RemoteEvidenceDecisionV1(
        **fields, verifier_output_hash=decision_verifier_output_hash(raw)
    )


def test_re_signed_decision_status_and_time_invariants_are_denied() -> None:
    bound = make_binding()

    class Root(TrustedTestRoot):
        def __init__(self, **update: object) -> None:
            self.update = update

        def evaluate(
            self,
            *,
            binding: RemoteExecutionBindingV1,
            envelope: RemoteExecutionEvidenceBundleV1,
            now: datetime,
        ) -> RemoteEvidenceDecisionV1:
            return resign_decision(
                super().evaluate(binding=binding, envelope=envelope, now=now), **self.update
            )

    envelope = make_bundle(bound)
    assert (
        evaluate_remote_execution_evidence(
            verifier=Root(code="EVIDENCE_MALFORMED"), binding=bound, envelope=envelope, now=NOW
        ).code
        == "EVIDENCE_MALFORMED"
    )
    assert (
        evaluate_remote_execution_evidence(
            verifier=Root(status="DENY", code="EVIDENCE_VERIFIED"),
            binding=bound,
            envelope=envelope,
            now=NOW,
        ).code
        == "EVIDENCE_MALFORMED"
    )
    assert (
        evaluate_remote_execution_evidence(
            verifier=Root(
                verified_at=NOW + timedelta(seconds=1), valid_until=NOW + timedelta(minutes=2)
            ),
            binding=bound,
            envelope=envelope,
            now=NOW,
        ).code
        == "EVIDENCE_MALFORMED"
    )
    assert (
        evaluate_remote_execution_evidence(
            verifier=Root(valid_until=bound.grant.expires_at + timedelta(seconds=1)),
            binding=bound,
            envelope=envelope,
            now=NOW,
        ).code
        == "EVIDENCE_REVOKED_OR_EXPIRED"
    )


def test_trusted_root_denial_for_revocation_or_unknown_is_preserved() -> None:
    bound = make_binding()

    class DenyingRoot(TrustedTestRoot):
        def __init__(self, code: str) -> None:
            self.code = code

        def evaluate(
            self,
            *,
            binding: RemoteExecutionBindingV1,
            envelope: RemoteExecutionEvidenceBundleV1,
            now: datetime,
        ) -> RemoteEvidenceDecisionV1:
            return resign_decision(
                super().evaluate(binding=binding, envelope=envelope, now=now),
                status="DENY",
                code=self.code,
            )

    envelope = make_bundle(bound)
    revoked = evaluate_remote_execution_evidence(
        verifier=DenyingRoot("EVIDENCE_REVOKED_OR_EXPIRED"),
        binding=bound,
        envelope=envelope,
        now=NOW,
    )
    unknown = evaluate_remote_execution_evidence(
        verifier=DenyingRoot("EVIDENCE_UNTRUSTED"), binding=bound, envelope=envelope, now=NOW
    )
    assert (revoked.status, revoked.code) == ("DENY", "EVIDENCE_REVOKED_OR_EXPIRED")
    assert (unknown.status, unknown.code) == ("DENY", "EVIDENCE_UNTRUSTED")


def test_re_signed_verified_time_cannot_precede_evidence_window_and_accepts_lower_bound() -> None:
    bound = make_binding()
    envelope = make_bundle(bound)
    lower_bound = max(bound.grant.issued_at, envelope.capability.issued_at, envelope.cost.issued_at)

    class Root(TrustedTestRoot):
        def __init__(self, verified_at: datetime) -> None:
            self.verified_at = verified_at

        def evaluate(
            self,
            *,
            binding: RemoteExecutionBindingV1,
            envelope: RemoteExecutionEvidenceBundleV1,
            now: datetime,
        ) -> RemoteEvidenceDecisionV1:
            return resign_decision(
                super().evaluate(binding=binding, envelope=envelope, now=now),
                verified_at=self.verified_at,
                valid_until=now + timedelta(minutes=1),
            )

    assert (
        evaluate_remote_execution_evidence(
            verifier=Root(lower_bound - timedelta(seconds=1)),
            binding=bound,
            envelope=envelope,
            now=NOW,
        ).code
        == "EVIDENCE_MALFORMED"
    )
    assert (
        evaluate_remote_execution_evidence(
            verifier=Root(lower_bound), binding=bound, envelope=envelope, now=NOW
        ).status
        == "ALLOW"
    )
