from datetime import UTC, datetime, timedelta

import pytest
from aijian_api.remote_execution_evidence_contracts import (
    CapabilityEvidenceV1,
    CostEvidenceV1,
    RemoteExecutionBindingV1,
    RemoteExecutionGrantCoreV1,
    canonical_sha256,
    capability_verifier_output_hash,
    cost_verifier_output_hash,
    evidence_binding_hash,
    grant_core_hash,
)
from pydantic import ValidationError

NOW = datetime(2026, 9, 15, 12, tzinfo=UTC)


def grant(**update: object) -> RemoteExecutionGrantCoreV1:
    values: dict[str, object] = dict(
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
    values.update(update)
    return RemoteExecutionGrantCoreV1(**values)


def binding(**update: object) -> RemoteExecutionBindingV1:
    core = update.pop("grant", grant())
    values = dict(grant=core, grant_core_hash=grant_core_hash(core))
    values.update(update)
    return RemoteExecutionBindingV1(**values)


def capability(bound: RemoteExecutionBindingV1, **update: object) -> CapabilityEvidenceV1:
    values: dict[str, object] = dict(
        evidence_id="evc_00000000000000000000000000000001",
        issuer_ref="issuer",
        trust_profile_id="profile-v1",
        credential_account_binding_ref="cab_00000000000000000000000000000001",
        binding_hash=evidence_binding_hash(bound),
        connection_id=bound.grant.connection_id,
        connection_revision=bound.grant.connection_revision,
        approved_model_id=bound.grant.approved_model_id,
        operation=bound.grant.operation,
        dispatch_class=bound.grant.dispatch_class,
        entitlement_claim="CAPABILITY_AND_ENTITLEMENT_FOR_BOUND_OPERATION",
        verification_payload_hash="sha256:" + "3" * 64,
        issued_at=NOW - timedelta(minutes=1),
        expires_at=NOW + timedelta(minutes=30),
        revocation_reference="revocation-proof-ref",
    )
    values.update(update)
    raw = CapabilityEvidenceV1.model_construct(**values, verifier_output_hash="sha256:" + "0" * 64)
    return CapabilityEvidenceV1(**values, verifier_output_hash=capability_verifier_output_hash(raw))


def cost(bound: RemoteExecutionBindingV1, **update: object) -> CostEvidenceV1:
    values: dict[str, object] = dict(
        evidence_id="evf_00000000000000000000000000000001",
        issuer_ref="issuer",
        trust_profile_id="profile-v1",
        credential_account_binding_ref="cab_00000000000000000000000000000001",
        binding_hash=evidence_binding_hash(bound),
        connection_id=bound.grant.connection_id,
        connection_revision=bound.grant.connection_revision,
        approved_model_id=bound.grant.approved_model_id,
        operation=bound.grant.operation,
        dispatch_class=bound.grant.dispatch_class,
        currency="USD",
        maximum_incremental_cost_micros=0,
        estimated_incremental_cost_micros=0,
        cost_evidence_hash="sha256:" + "4" * 64,
        metering_scope_hash=bound.grant.input_scope_hash,
        issued_at=NOW - timedelta(minutes=1),
        expires_at=NOW + timedelta(minutes=30),
        revocation_reference="revocation-proof-ref",
    )
    values.update(update)
    raw = CostEvidenceV1.model_construct(**values, verifier_output_hash="sha256:" + "0" * 64)
    return CostEvidenceV1(**values, verifier_output_hash=cost_verifier_output_hash(raw))


def test_grant_is_the_frozen_c5_source_extract_binding() -> None:
    bound = binding()
    assert bound.grant.operation == "remote.source.extract"
    assert bound.grant.endpoint_binding == "CPA_LOOPBACK_V1"
    assert bound.grant.dispatch_class == "FORMAL_CONTENT_EXECUTION"
    assert grant_core_hash(bound.grant) == bound.grant_core_hash


def test_core_hash_excludes_evidence_but_rejects_reused_hash_after_core_change() -> None:
    bound = binding()
    changed_evidence = capability(bound, verification_payload_hash="sha256:" + "5" * 64)
    assert changed_evidence.binding_hash == evidence_binding_hash(bound)
    changed = grant(approved_model_id="model-beta")
    with pytest.raises(ValidationError, match="grant_core_hash"):
        RemoteExecutionBindingV1(grant=changed, grant_core_hash=bound.grant_core_hash)


def test_strict_contract_rejects_unknown_fake_verification_and_naive_or_bool_values() -> None:
    with pytest.raises(ValidationError, match="extra_forbidden"):
        capability(binding(), verified=True)
    with pytest.raises(ValidationError):
        grant(grant_revision=True)
    with pytest.raises(ValidationError, match="timezone-aware"):
        grant(issued_at=datetime(2026, 9, 15, 12))
    with pytest.raises(ValidationError, match="at least 1 character"):
        capability(binding(), issuer_ref="")


def test_cost_requires_complete_bound_account_and_zero_capable_payload() -> None:
    bound = binding()
    assert (
        cost(bound).credential_account_binding_ref
        == capability(bound).credential_account_binding_ref
    )
    with pytest.raises(ValidationError):
        cost(bound, currency="EUR")
    with pytest.raises(ValidationError, match="exceed"):
        cost(bound, maximum_incremental_cost_micros=0, estimated_incremental_cost_micros=1)
    assert (
        canonical_sha256({"a": 1})
        == "sha256:015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862"
    )


def test_identifier_domains_and_integer_limits_are_independently_strict() -> None:
    with pytest.raises(ValidationError):
        grant(project_id="pcn_00000000000000000000000000000001")
    with pytest.raises(ValidationError):
        grant(connection_id="prj_00000000000000000000000000000001")
    with pytest.raises(ValidationError):
        grant(connection_revision=2_147_483_648)
    with pytest.raises(ValidationError):
        capability(binding(), revocation_reference="   ")
