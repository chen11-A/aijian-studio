import hashlib
import json
import sqlite3
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from aijian_api.agent_skill_builtins import (
    built_in_agent_skill_registry,
    built_in_proposal_schema_registry,
)
from aijian_api.agent_skill_contracts import (
    AgentSkillFixtureBundleV1,
    AttemptSnapshotV1,
    ProposalDependencyV1,
    ProposalSourceSpanV1,
)
from aijian_api.artifact_proposal_acceptance import ArtifactProposalAcceptanceService
from aijian_api.artifact_proposal_rejection import ArtifactProposalRejectionService
from aijian_api.domain import TrustedReviewActor
from aijian_api.ingestion import ingest_text_file
from aijian_api.remote_execution_authorization import (
    RemoteAuthorizationError,
    RemoteDispatchSnapshotDraft,
    RemoteExecutionAuthorizationStore,
    TrustedRemoteCompositionPolicy,
    _assert_current_composition_policy,
    authorization_snapshot_from_grant,
)
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
from aijian_api.remote_execution_evidence_verifier import RemoteEvidenceVerifier
from aijian_api.repository import StudioRepository
from aijian_api.task_ledger import LocalTaskLedger
from aijian_api.task_ledger_models import LeaseLostError

NOW = datetime(2026, 9, 15, tzinfo=UTC)
HASH = f"sha256:{'a' * 64}"
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "agent-skill" / "contracts-v1.json"


class _TrustedOfflineVerifier(RemoteEvidenceVerifier):
    def evaluate(self, *, binding, envelope, now):
        fields = {
            "status": "ALLOW",
            "code": "EVIDENCE_VERIFIED",
            "binding_hash": evidence_binding_hash(binding),
            "capability_evidence_id": envelope.capability.evidence_id,
            "capability_evidence_hash": canonical_sha256(envelope.capability),
            "cost_evidence_id": envelope.cost.evidence_id,
            "cost_evidence_hash": canonical_sha256(envelope.cost),
            "trust_profile_version": envelope.capability.trust_profile_id,
            "verifier_id": "offline-test-root",
            "verified_at": now,
            "valid_until": now + timedelta(minutes=1),
        }
        raw = RemoteEvidenceDecisionV1.model_construct(
            **fields, verifier_output_hash="sha256:" + "0" * 64
        )
        return RemoteEvidenceDecisionV1(
            **fields, verifier_output_hash=decision_verifier_output_hash(raw)
        )


def _evidence(bound: RemoteExecutionBindingV1) -> RemoteExecutionEvidenceBundleV1:
    grant = bound.grant
    common = {
        "issuer_ref": "offline-test",
        "trust_profile_id": "offline-v1",
        "credential_account_binding_ref": "cab_" + "1" * 32,
        "binding_hash": evidence_binding_hash(bound),
        "connection_id": grant.connection_id,
        "connection_revision": grant.connection_revision,
        "approved_model_id": grant.approved_model_id,
        "operation": grant.operation,
        "dispatch_class": grant.dispatch_class,
        "issued_at": NOW - timedelta(minutes=1),
        "expires_at": NOW + timedelta(minutes=5),
        "revocation_reference": "offline-revocation",
    }
    cap_values = {
        **common,
        "evidence_id": "evc_" + "2" * 32,
        "entitlement_claim": "CAPABILITY_AND_ENTITLEMENT_FOR_BOUND_OPERATION",
        "verification_payload_hash": HASH,
    }
    cap = CapabilityEvidenceV1(
        **cap_values,
        verifier_output_hash=capability_verifier_output_hash(
            CapabilityEvidenceV1.model_construct(
                **cap_values, verifier_output_hash="sha256:" + "0" * 64
            )
        ),
    )
    cost_values = {
        **common,
        "evidence_id": "evf_" + "3" * 32,
        "currency": "USD",
        "maximum_incremental_cost_micros": 0,
        "estimated_incremental_cost_micros": 0,
        "cost_evidence_hash": HASH,
        "metering_scope_hash": grant.input_scope_hash,
    }
    cost = CostEvidenceV1(
        **cost_values,
        verifier_output_hash=cost_verifier_output_hash(
            CostEvidenceV1.model_construct(**cost_values, verifier_output_hash="sha256:" + "0" * 64)
        ),
    )
    return RemoteExecutionEvidenceBundleV1(capability=cap, cost=cost)


def _accept_source_manifest(repository: StudioRepository, project_id: str, version_id: str) -> None:
    head = repository.get_artifact_head(project_id, "source_manifest")
    actor = TrustedReviewActor(subject_id="offline-reviewer", roles=("writer", "producer"))
    submit = repository.prepare_review_action(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=version_id,
        action="submit",
        action_payload={},
        actor=actor,
        expected_revision=head.revision,
    )
    reviewed = repository.submit_artifact_review(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=version_id,
        expected_revision=head.revision,
        challenge_id=submit.challenge.id,
        confirmation_token=submit.confirmation_token,
        actor=actor,
    )
    signoff = repository.prepare_review_action(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=version_id,
        action="signoff",
        action_payload={"roles": ["writer", "producer"]},
        actor=actor,
        expected_revision=reviewed.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=version_id,
        roles=("writer", "producer"),
        expected_revision=reviewed.head.revision,
        challenge_id=signoff.challenge.id,
        confirmation_token=signoff.confirmation_token,
        actor=actor,
    )
    decision = repository.prepare_review_action(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=version_id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": "offline fixture",
            "actor_role": "producer",
        },
        actor=actor,
        readiness_report_id=signoff.report.id,
        expected_revision=signed.head.revision,
    )
    repository.decide_artifact_gate(
        project_id=project_id,
        artifact_type="source_manifest",
        version_id=version_id,
        decision="approved",
        rationale="offline fixture",
        expected_revision=signed.head.revision,
        challenge_id=decision.challenge.id,
        confirmation_token=decision.confirmation_token,
        actor=actor,
        actor_role="producer",
    )


def _remote_fixture(tmp_path, *, scope_update=None, draft_update=None, provider_mutation=None):
    database = tmp_path / "remote-chain.db"
    repository = StudioRepository(database)
    project = repository.create_project(
        name="remote", aspect_ratio="9:16", target_duration_seconds=30, source_language="zh-CN"
    )
    source = repository.import_source(
        project.id, ingest_text_file(filename="remote.txt", content=b"Remote fixture source.")
    )
    head = repository.get_artifact_head(project.id, "source_manifest")
    _accept_source_manifest(repository, project.id, head.latest_version_id)
    manifest = repository.get_artifact_version(
        project.id, "source_manifest", head.latest_version_id
    )
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    fields = bundle.attempt.model_dump(mode="json")
    fields["project_id"] = project.id
    fields["provider_connection_id"] = "pcn_" + "1" * 32
    fields["model_id"] = "remote-model"
    fields["input_hash"] = HASH
    fields["idempotency_key"] = "remote:fixture:1"
    fields["attempt_fingerprint"] = canonical_sha256(
        {
            key: value
            for key, value in fields.items()
            if key not in {"schema_version", "attempt_id", "attempt_fingerprint"}
        }
    )
    snapshot = AttemptSnapshotV1.model_validate(fields)
    context = bundle.context_manifest.model_dump(mode="json")
    context["project_id"] = project.id
    context["manifest_hash"] = canonical_sha256(
        {
            "project_id": project.id,
            "agent_definition": context["agent_definition"],
            "skill_definition": context["skill_definition"],
            "entries": context["entries"],
            "total_byte_count": context["total_byte_count"],
        }
    )
    now_text = NOW.isoformat().replace("+00:00", "Z")
    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "INSERT INTO provider_connections VALUES (?, 'OPENAI_COMPATIBLE', 'offline', "
            "'http://offline.invalid', 1, '[{\"model_id\":\"remote-model\"}]', 1, ?, ?)",
            (fields["provider_connection_id"], now_text, now_text),
        )
        if provider_mutation is not None:
            provider_mutation(connection, fields["provider_connection_id"])
        connection.execute(
            "INSERT INTO agent_runs VALUES (?, ?, ?, ?, 'PENDING', ?, 1, ?, ?)",
            (
                snapshot.agent_run_id,
                project.id,
                snapshot.agent_definition_id,
                snapshot.agent_version,
                json.dumps([snapshot.skill_run_id]),
                now_text,
                now_text,
            ),
        )
        connection.execute(
            "INSERT INTO agent_context_manifests VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                bundle.context_manifest.context_manifest_id,
                project.id,
                snapshot.agent_definition_id,
                snapshot.agent_version,
                snapshot.skill_definition_id,
                snapshot.skill_version,
                json.dumps(context, sort_keys=True, separators=(",", ":")),
                context["manifest_hash"],
                now_text,
            ),
        )
        connection.execute(
            "INSERT INTO skill_runs VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, 1, ?, ?)",
            (
                snapshot.skill_run_id,
                project.id,
                snapshot.agent_run_id,
                snapshot.skill_definition_id,
                snapshot.skill_version,
                bundle.context_manifest.context_manifest_id,
                now_text,
                now_text,
            ),
        )
    scope = {
        "input_hash": HASH,
        "context_manifest_hash": context["manifest_hash"],
        "accepted_manifest_version_id": manifest.version.id,
        "accepted_manifest_content_hash": manifest.version.content_hash,
        "source_document_id": source.id,
        "source_block_ids": [source.blocks[0].id],
        "span_bounds": [
            [source.blocks[0].normalized_start_byte, source.blocks[0].normalized_end_byte]
        ],
    }
    if scope_update is not None:
        scope.update(scope_update)
    draft = RemoteDispatchSnapshotDraft(
        connection_id=fields["provider_connection_id"],
        connection_revision=1,
        approved_model_id="remote-model",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        policy_version=snapshot.policy_version,
        context_manifest_id=bundle.context_manifest.context_manifest_id,
        context_manifest_hash=context["manifest_hash"],
        scope=scope,
    )
    if draft_update is not None:
        draft = replace(draft, **draft_update)
    ledger = LocalTaskLedger(database, clock=lambda: NOW)
    queued = ledger.enqueue_remote_node(
        project_id=project.id,
        definition_id="remote",
        definition_version=1,
        definition_hash=HASH,
        graph={"nodes": ["remote"]},
        workflow_input_hash=HASH,
        node_key="remote",
        node_type="remote",
        contract_version=1,
        input_bindings={},
        node_input_hash=HASH,
        request_fingerprint=snapshot.attempt_fingerprint,
        idempotency_key="remote:fixture:1",
        max_attempts=1,
        task_kind="remote.extract",
        priority=50,
        available_at=NOW,
        attempt_snapshot_kind="agent_skill_v1",
        attempt_snapshot=snapshot.model_dump(mode="json", exclude={"attempt_id"}),
        dispatch_snapshot=draft,
    )
    claim = ledger.claim_remote_task(
        worker_id="remote-worker", lease_duration=timedelta(minutes=1), task_id=queued.task_id
    )
    assert claim is not None
    return (
        database,
        repository,
        project.id,
        source,
        manifest.version.id,
        ledger,
        ledger.mark_attempt_running(claim),
        draft,
    )


def _issued_remote_authorization(
    tmp_path,
    *,
    clock=lambda: NOW,
    grant_update=None,
    policy_box=None,
):
    database, repository, project_id, source, manifest_version_id, ledger, claim, draft = (
        _remote_fixture(tmp_path)
    )
    policy = TrustedRemoteCompositionPolicy(
        draft.endpoint_binding,
        draft.transport_contract_hash,
        draft.dispatch_class,
        draft.requested_additional_budget_micros,
        draft.approved_currency,
        draft.policy_version,
    )
    if policy_box is None:
        policy_box = [policy]
    else:
        policy_box.append(policy)
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "9" * 32,
        grant_revision=1,
        project_id=project_id,
        connection_id=draft.connection_id,
        connection_revision=draft.connection_revision,
        approved_model_id=draft.approved_model_id,
        endpoint_binding=draft.endpoint_binding,
        transport_contract_hash=draft.transport_contract_hash,
        operation="remote.source.extract",
        input_scope_hash=draft.input_scope_hash(),
        dispatch_class=draft.dispatch_class,
        requested_additional_budget_micros=0,
        approved_currency=draft.approved_currency,
        issued_at=NOW,
        expires_at=NOW + timedelta(minutes=2),
        policy_version=draft.policy_version,
    )
    if grant_update is not None:
        grant = grant.model_copy(update=grant_update)
    binding = RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant))
    counter = iter(range(1, 1000))
    store = RemoteExecutionAuthorizationStore(
        database,
        id_factory=lambda prefix: f"{prefix}_{next(counter):032x}",
        clock=clock,
        composition_policy_reader=lambda: policy_box[0],
    )
    store.issue(binding=binding, envelope=_evidence(binding), verifier=_TrustedOfflineVerifier())
    return (
        database,
        repository,
        project_id,
        source,
        manifest_version_id,
        ledger,
        claim,
        grant,
        store,
    )


def _issued_remote_dispatch(tmp_path):
    *fixture, claim, grant, store = _issued_remote_authorization(tmp_path)
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    return *fixture, claim, grant, store, permit


def _proposal_for_remote_permit(
    *,
    ledger: LocalTaskLedger,
    permit,
    project_id: str,
    source,
    manifest_version_id: str,
):
    snapshot = ledger.read_agent_skill_snapshot(permit.claim)
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    quote = source.normalized_text.encode("utf-8")[
        source.blocks[0].normalized_start_byte : source.blocks[0].normalized_end_byte
    ]
    span = ProposalSourceSpanV1(
        source_span_id=bundle.artifact_proposal.source_spans[0].source_span_id,
        source_document_id=source.id,
        source_block_id=source.blocks[0].id,
        start_byte=source.blocks[0].normalized_start_byte,
        end_byte=source.blocks[0].normalized_end_byte,
        claim=bundle.artifact_proposal.source_spans[0].claim,
        quote_hash=f"sha256:{hashlib.sha256(quote).hexdigest()}",
    )
    return bundle.artifact_proposal.model_copy(
        update={
            "project_id": project_id,
            "producer_agent_run_id": snapshot.agent_run_id,
            "producer_skill_run_id": snapshot.skill_run_id,
            "source_spans": (span,),
            "dependencies": (
                ProposalDependencyV1(
                    artifact_type="SourceManifest", version_id=manifest_version_id
                ),
            ),
        }
    )


def test_remote_enqueue_claim_issue_begin_and_recheck_are_real_transactions(tmp_path) -> None:
    database, _repository, project_id, _source, _manifest_version_id, _ledger, claim, draft = (
        _remote_fixture(tmp_path)
    )
    policy = TrustedRemoteCompositionPolicy(
        draft.endpoint_binding,
        draft.transport_contract_hash,
        draft.dispatch_class,
        draft.requested_additional_budget_micros,
        draft.approved_currency,
        draft.policy_version,
    )
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "9" * 32,
        grant_revision=1,
        project_id=project_id,
        connection_id=draft.connection_id,
        connection_revision=draft.connection_revision,
        approved_model_id=draft.approved_model_id,
        endpoint_binding=draft.endpoint_binding,
        transport_contract_hash=draft.transport_contract_hash,
        operation="remote.source.extract",
        input_scope_hash=draft.input_scope_hash(),
        dispatch_class=draft.dispatch_class,
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=NOW,
        expires_at=NOW + timedelta(minutes=2),
        policy_version=draft.policy_version,
    )
    binding = RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant))
    counter = iter(range(1, 1000))
    store = RemoteExecutionAuthorizationStore(
        database,
        id_factory=lambda prefix: f"{prefix}_{next(counter):032x}",
        clock=lambda: NOW,
        composition_policy_reader=lambda: policy,
    )
    store.issue(binding=binding, envelope=_evidence(binding), verifier=_TrustedOfflineVerifier())
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    store.recheck_dispatch_permit(permit)
    with pytest.raises(LeaseLostError, match="lease is stale"):
        store.begin_remote_dispatch(
            claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
        )
    with sqlite3.connect(database) as connection:
        assert (
            connection.execute("SELECT status FROM workflow_attempts").fetchone()[0] == "SUBMITTING"
        )
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
                "WHERE event_kind = 'CONSUME'"
            ).fetchone()[0]
            == 1
        )


@pytest.mark.parametrize("terminal", ("revoke", "expire"))
def test_remote_terminal_authorization_before_begin_has_zero_consumes(tmp_path, terminal) -> None:
    database, _repository, _project_id, _source, _manifest_id, _ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path)
    )
    getattr(store, terminal)(grant.authorization_id)

    with pytest.raises(RemoteAuthorizationError, match="authorization revision is stale"):
        store.begin_remote_dispatch(
            claim=claim,
            authorization_id=grant.authorization_id,
            expected_authorization_revision=1,
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (0,)
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == ("RUNNING",)


def test_duplicate_issue_and_unknown_lifecycle_leave_authorization_history_unchanged(
    tmp_path,
) -> None:
    database, _repository, _project_id, _source, _manifest_id, _ledger, _claim, grant, store = (
        _issued_remote_authorization(tmp_path)
    )
    binding = RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant))

    with pytest.raises(RemoteAuthorizationError, match="already issued"):
        store.issue(
            binding=binding, envelope=_evidence(binding), verifier=_TrustedOfflineVerifier()
        )
    with pytest.raises(RemoteAuthorizationError):
        store.revoke("rea_" + "0" * 32)

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT event_kind, COUNT(*) FROM remote_execution_authorization_snapshots "
            "GROUP BY event_kind"
        ).fetchall() == [("ISSUE", 1)]


def test_blank_provider_response_rejects_before_candidate_persistence(tmp_path) -> None:
    (
        database,
        _repository,
        project_id,
        source,
        manifest_id,
        ledger,
        _claim,
        _grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )

    with pytest.raises(ValueError, match="provider response identifier"):
        store.record_remote_candidate(permit=permit, proposal=proposal, provider_response_id=" ")

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "SUBMITTING",
        )
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )


def test_remote_lease_expiry_before_begin_has_zero_consumes(tmp_path) -> None:
    current_time = [NOW]
    database, _repository, _project_id, _source, _manifest_id, _ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path, clock=lambda: current_time[0])
    )
    current_time[0] = NOW + timedelta(minutes=2)

    with pytest.raises(LeaseLostError, match="task lease is stale or expired"):
        store.begin_remote_dispatch(
            claim=claim,
            authorization_id=grant.authorization_id,
            expected_authorization_revision=1,
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (0,)


def test_local_cancellation_cannot_resolve_active_remote_before_or_after_consume(tmp_path) -> None:
    database, _repository, project_id, _source, _manifest_id, ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path)
    )

    with pytest.raises(ValueError, match="cannot resolve an active remote attempt"):
        ledger.cancel_local_workflow(
            project_id=project_id,
            workflow_run_id=claim.workflow_run_id,
            actor_id="named-canceller",
        )
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (0,)
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == ("RUNNING",)

    permit = store.begin_remote_dispatch(
        claim=claim,
        authorization_id=grant.authorization_id,
        expected_authorization_revision=1,
    )
    with pytest.raises(ValueError, match="cannot resolve an active remote attempt"):
        ledger.cancel_local_workflow(
            project_id=project_id,
            workflow_run_id=permit.claim.workflow_run_id,
            actor_id="named-canceller",
        )
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (1,)
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "SUBMITTING",
        )
    assert (
        LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))
        .recover_expired_local_tasks()
        .recovered
        == 0
    )


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("input_hash", "sha256:" + "b" * 64),
        ("context_manifest_hash", "sha256:" + "b" * 64),
        ("accepted_manifest_version_id", "ver_" + "b" * 32),
        ("accepted_manifest_content_hash", "sha256:" + "b" * 64),
        ("source_document_id", "src_" + "b" * 32),
        ("source_block_ids", ["srcb_" + "b" * 32]),
        ("span_bounds", [[999, 1000]]),
    ),
)
def test_formal_scope_binding_mutation_cannot_enqueue_or_consume(tmp_path, field, value) -> None:
    with pytest.raises((RemoteAuthorizationError, ValueError)):
        _remote_fixture(tmp_path, scope_update={field: value})


@pytest.mark.parametrize(
    ("label", "draft_update", "provider_mutation"),
    (
        ("endpoint", {"endpoint_binding": "UNTRUSTED"}, None),
        ("budget", {"requested_additional_budget_micros": 1}, None),
        ("currency", {"approved_currency": "EUR"}, None),
        ("revision", {"connection_revision": 2}, None),
        (
            "disabled-provider",
            None,
            lambda connection, connection_id: connection.execute(
                "UPDATE provider_connections SET enabled = 0 WHERE connection_id = ?",
                (connection_id,),
            ),
        ),
        (
            "stale-provider",
            None,
            lambda connection, connection_id: connection.execute(
                "UPDATE provider_connections SET revision = 2 WHERE connection_id = ?",
                (connection_id,),
            ),
        ),
        (
            "malformed-models",
            None,
            lambda connection, connection_id: (
                connection.execute("PRAGMA ignore_check_constraints = ON"),
                connection.execute(
                    "UPDATE provider_connections SET models_json = 'not-json' "
                    "WHERE connection_id = ?",
                    (connection_id,),
                ),
            ),
        ),
        (
            "unapproved-model",
            None,
            lambda connection, connection_id: connection.execute(
                "UPDATE provider_connections SET models_json = '[]' WHERE connection_id = ?",
                (connection_id,),
            ),
        ),
    ),
)
def test_remote_enqueue_rejects_invalid_policy_or_provider_without_queue_residue(
    tmp_path, label, draft_update, provider_mutation
) -> None:
    with pytest.raises((RemoteAuthorizationError, ValueError)):
        _remote_fixture(
            tmp_path,
            draft_update=draft_update,
            provider_mutation=provider_mutation,
        )

    with sqlite3.connect(tmp_path / "remote-chain.db") as connection:
        assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM workflow_attempts").fetchone() == (0,)
        assert connection.execute("SELECT COUNT(*) FROM remote_dispatch_snapshots").fetchone() == (
            0,
        )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    (
        ("input_scope_hash", "sha256:" + "b" * 64, "input scope does not match"),
        ("connection_id", "pcn_" + "b" * 32, "connection does not match"),
        ("connection_revision", 2, "connection revision does not match"),
        ("approved_model_id", "other-approved-model", "model does not match"),
        ("transport_contract_hash", "sha256:" + "b" * 64, "transport does not match"),
        ("dispatch_class", "SYNTHETIC_CAPABILITY_PROBE", "dispatch class does not match"),
        ("policy_version", "policy-v2", "policy does not match"),
    ),
)
def test_remote_grant_binding_mismatch_has_zero_consumes(tmp_path, field, value, message) -> None:
    database, _repository, _project_id, _source, _manifest_id, _ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path, grant_update={field: value})
    )

    with pytest.raises(RemoteAuthorizationError, match=message):
        store.begin_remote_dispatch(
            claim=claim,
            authorization_id=grant.authorization_id,
            expected_authorization_revision=1,
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (0,)
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == ("RUNNING",)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    (
        ("grant_core_hash", "sha256:" + "b" * 64, "authorization core changed"),
        (
            "evidence_binding_hash",
            "sha256:" + "b" * 64,
            "authorization evidence binding changed",
        ),
    ),
)
def test_remote_recheck_rejects_permit_core_or_evidence_mismatch_after_consume(
    tmp_path, field, value, message
) -> None:
    (
        database,
        _repository,
        _project_id,
        _source,
        _manifest_id,
        _ledger,
        _claim,
        _grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)

    with pytest.raises(RemoteAuthorizationError, match=message):
        store.recheck_dispatch_permit(replace(permit, **{field: value}))

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "SUBMITTING",
        )
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )


def test_remote_candidate_write_failure_rolls_back_every_state_change(tmp_path) -> None:
    (
        database,
        _repository,
        project_id,
        source,
        manifest_id,
        ledger,
        _claim,
        _grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TRIGGER test_remote_candidate_write_failure "
            "BEFORE INSERT ON agent_artifact_proposals "
            "BEGIN SELECT RAISE(ABORT, 'candidate write failure'); END"
        )
        connection.commit()

    with pytest.raises(sqlite3.IntegrityError, match="candidate write failure"):
        store.record_remote_candidate(
            permit=permit,
            proposal=proposal,
            provider_response_id="response-write-failure",
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("SUBMITTING", None, None)
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "RUNNING",
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("LEASED",)


def test_remote_candidate_late_task_failure_rolls_back_prior_writes(tmp_path) -> None:
    (
        database,
        _repository,
        project_id,
        source,
        manifest_id,
        ledger,
        _claim,
        _grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TRIGGER test_remote_candidate_late_task_failure "
            "BEFORE UPDATE OF status ON task_ledger "
            "WHEN NEW.status = 'COMPLETED' "
            "BEGIN SELECT RAISE(ABORT, 'late task completion failure'); END"
        )
        connection.commit()

    with pytest.raises(sqlite3.IntegrityError, match="late task completion failure"):
        store.record_remote_candidate(
            permit=permit,
            proposal=proposal,
            provider_response_id="response-late-write-failure",
        )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("SUBMITTING", None, None)
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        assert connection.execute("SELECT status FROM agent_runs").fetchone() == ("RUNNING",)
        assert connection.execute("SELECT status, proposal_id FROM skill_runs").fetchone() == (
            "RUNNING",
            None,
        )
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "RUNNING",
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("LEASED",)
        assert connection.execute(
            "SELECT COUNT(*) FROM workflow_transition_events "
            "WHERE to_status = 'REMOTE_REVIEW_PENDING'"
        ).fetchone() == (0,)


def test_remote_candidate_records_policy_change_as_stale_after_dispatch(tmp_path) -> None:
    policy_box = []
    database, _repository, project_id, source, manifest_id, ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path, policy_box=policy_box)
    )
    permit = store.begin_remote_dispatch(
        claim=claim,
        authorization_id=grant.authorization_id,
        expected_authorization_revision=1,
    )
    policy_box[0] = replace(policy_box[0], policy_version="policy-after-dispatch")
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )

    store.record_remote_candidate(
        permit=permit,
        proposal=proposal,
        provider_response_id="response-policy-stale",
    )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("REMOTE_REVIEW_PENDING", "response-policy-stale", None)
        assert connection.execute(
            "SELECT reason_code FROM workflow_transition_events WHERE entity_id = ? "
            "ORDER BY sequence DESC LIMIT 1",
            (permit.claim.attempt_id,),
        ).fetchone() == ("remote.candidate.stale_after_dispatch",)


def test_remote_candidate_records_provider_change_as_stale_after_dispatch(tmp_path) -> None:
    database, _repository, project_id, source, manifest_id, ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path)
    )
    permit = store.begin_remote_dispatch(
        claim=claim,
        authorization_id=grant.authorization_id,
        expected_authorization_revision=1,
    )
    with sqlite3.connect(database) as connection:
        connection.execute(
            "UPDATE provider_connections SET revision = revision + 1 WHERE connection_id = ?",
            (grant.connection_id,),
        )
        connection.commit()
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )

    store.record_remote_candidate(
        permit=permit,
        proposal=proposal,
        provider_response_id="response-provider-stale",
    )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("REMOTE_REVIEW_PENDING", "response-provider-stale", None)
        assert connection.execute(
            "SELECT reason_code FROM workflow_transition_events WHERE entity_id = ? "
            "ORDER BY sequence DESC LIMIT 1",
            (permit.claim.attempt_id,),
        ).fetchone() == ("remote.candidate.stale_after_dispatch",)


def test_remote_candidate_records_throwing_policy_reader_as_stale_after_dispatch(tmp_path) -> None:
    database, _repository, project_id, source, manifest_id, ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path)
    )
    permit = store.begin_remote_dispatch(
        claim=claim,
        authorization_id=grant.authorization_id,
        expected_authorization_revision=1,
    )

    def unavailable_policy_reader():
        raise RuntimeError("offline policy reader failure")

    store._composition_policy_reader = unavailable_policy_reader
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )
    store.record_remote_candidate(
        permit=permit,
        proposal=proposal,
        provider_response_id="response-policy-reader-stale",
    )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("REMOTE_REVIEW_PENDING", "response-policy-reader-stale", None)
        assert connection.execute(
            "SELECT reason_code FROM workflow_transition_events WHERE entity_id = ? "
            "ORDER BY sequence DESC LIMIT 1",
            (permit.claim.attempt_id,),
        ).fetchone() == ("remote.candidate.stale_after_dispatch",)


def test_remote_candidate_records_accepted_source_change_as_stale_after_dispatch(tmp_path) -> None:
    database, repository, project_id, source, manifest_id, ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path)
    )
    permit = store.begin_remote_dispatch(
        claim=claim,
        authorization_id=grant.authorization_id,
        expected_authorization_revision=1,
    )
    repository.import_source(
        project_id,
        ingest_text_file(filename="remote-after-dispatch.txt", content=b"Changed accepted source."),
    )
    changed_head = repository.get_artifact_head(project_id, "source_manifest")
    _accept_source_manifest(repository, project_id, changed_head.latest_version_id)
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )
    store.record_remote_candidate(
        permit=permit,
        proposal=proposal,
        provider_response_id="response-source-stale",
    )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("REMOTE_REVIEW_PENDING", "response-source-stale", None)
        assert connection.execute(
            "SELECT reason_code FROM workflow_transition_events WHERE entity_id = ? "
            "ORDER BY sequence DESC LIMIT 1",
            (permit.claim.attempt_id,),
        ).fetchone() == ("remote.candidate.stale_after_dispatch",)
    acceptance = ArtifactProposalAcceptanceService(
        repository,
        built_in_agent_skill_registry(),
        built_in_proposal_schema_registry(),
    )
    with pytest.raises(ValueError, match="DRAFT validation failed"):
        acceptance.accept_as_draft(
            project_id=project_id,
            proposal_id=proposal.proposal_id,
            idempotency_key="source-stale-must-not-accept",
            actor=TrustedReviewActor(subject_id="named-reviewer", roles=("producer",)),
            parent_version_id=None,
            expected_head_revision=None,
        )


def test_remote_candidate_is_persisted_atomically_as_human_review_only(tmp_path) -> None:
    database, repository, project_id, source, manifest_version_id, ledger, claim, draft = (
        _remote_fixture(tmp_path)
    )
    policy = TrustedRemoteCompositionPolicy(
        draft.endpoint_binding,
        draft.transport_contract_hash,
        draft.dispatch_class,
        0,
        "USD",
        draft.policy_version,
    )
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "8" * 32,
        grant_revision=1,
        project_id=project_id,
        connection_id=draft.connection_id,
        connection_revision=1,
        approved_model_id=draft.approved_model_id,
        endpoint_binding=draft.endpoint_binding,
        transport_contract_hash=draft.transport_contract_hash,
        operation="remote.source.extract",
        input_scope_hash=draft.input_scope_hash(),
        dispatch_class=draft.dispatch_class,
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=NOW,
        expires_at=NOW + timedelta(minutes=2),
        policy_version=draft.policy_version,
    )
    binding = RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant))
    ids = iter(range(1, 1000))
    store = RemoteExecutionAuthorizationStore(
        database,
        id_factory=lambda prefix: f"{prefix}_{next(ids):032x}",
        clock=lambda: NOW,
        composition_policy_reader=lambda: policy,
    )
    store.issue(binding=binding, envelope=_evidence(binding), verifier=_TrustedOfflineVerifier())
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    store.revoke(grant.authorization_id)
    snapshot = ledger.read_agent_skill_snapshot(permit.claim)
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    quote = source.normalized_text.encode("utf-8")[
        source.blocks[0].normalized_start_byte : source.blocks[0].normalized_end_byte
    ]
    span = ProposalSourceSpanV1(
        source_span_id=bundle.artifact_proposal.source_spans[0].source_span_id,
        source_document_id=source.id,
        source_block_id=source.blocks[0].id,
        start_byte=source.blocks[0].normalized_start_byte,
        end_byte=source.blocks[0].normalized_end_byte,
        claim=bundle.artifact_proposal.source_spans[0].claim,
        quote_hash=f"sha256:{hashlib.sha256(quote).hexdigest()}",
    )
    proposal = bundle.artifact_proposal.model_copy(
        update={
            "project_id": project_id,
            "producer_agent_run_id": snapshot.agent_run_id,
            "producer_skill_run_id": snapshot.skill_run_id,
            "source_spans": (span,),
            "dependencies": (
                ProposalDependencyV1(
                    artifact_type="SourceManifest", version_id=manifest_version_id
                ),
            ),
        }
    )
    persisted = store.record_remote_candidate(
        permit=permit, proposal=proposal, provider_response_id="response-1"
    )
    assert persisted.producer_attempt_id == permit.claim.attempt_id
    restarted = LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))
    assert restarted.recover_expired_local_tasks().recovered == 0
    assert (
        restarted.claim_remote_task(worker_id="new-worker", lease_duration=timedelta(minutes=1))
        is None
    )
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("REMOTE_REVIEW_PENDING", "response-1", None)
        assert (
            connection.execute("SELECT status FROM workflow_node_runs").fetchone()[0]
            == "NEEDS_REVIEW"
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone()[0] == "COMPLETED"
        assert connection.execute(
            "SELECT reason_code FROM workflow_transition_events WHERE entity_id = ? "
            "ORDER BY sequence DESC LIMIT 1",
            (permit.claim.attempt_id,),
        ).fetchone() == ("remote.candidate.revoked_after_dispatch",)
    rejected = ArtifactProposalRejectionService(database).reject(
        project_id=project_id,
        proposal_id=persisted.proposal.proposal_id,
        idempotency_key="remote-human-reject",
        actor=TrustedReviewActor(subject_id="named-reviewer", roles=("producer",)),
        reason_code="OTHER",
        comment="Human rejection after remote review.",
    )
    assert rejected.proposal_id == persisted.proposal.proposal_id
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts"
        ).fetchone() == ("FAILED", None)


def test_remote_candidate_human_acceptance_creates_draft(tmp_path) -> None:
    database, repository, project_id, source, manifest_version_id, ledger, claim, draft = (
        _remote_fixture(tmp_path)
    )
    policy = TrustedRemoteCompositionPolicy(
        draft.endpoint_binding,
        draft.transport_contract_hash,
        draft.dispatch_class,
        0,
        "USD",
        draft.policy_version,
    )
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "8" * 32,
        grant_revision=1,
        project_id=project_id,
        connection_id=draft.connection_id,
        connection_revision=1,
        approved_model_id=draft.approved_model_id,
        endpoint_binding=draft.endpoint_binding,
        transport_contract_hash=draft.transport_contract_hash,
        operation="remote.source.extract",
        input_scope_hash=draft.input_scope_hash(),
        dispatch_class=draft.dispatch_class,
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=NOW,
        expires_at=NOW + timedelta(minutes=2),
        policy_version=draft.policy_version,
    )
    binding = RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant))
    ids = iter(range(1, 1000))
    store = RemoteExecutionAuthorizationStore(
        database,
        id_factory=lambda prefix: f"{prefix}_{next(ids):032x}",
        clock=lambda: NOW,
        composition_policy_reader=lambda: policy,
    )
    store.issue(binding=binding, envelope=_evidence(binding), verifier=_TrustedOfflineVerifier())
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    snapshot = ledger.read_agent_skill_snapshot(permit.claim)
    bundle = AgentSkillFixtureBundleV1.model_validate_json(FIXTURE_PATH.read_text(encoding="utf-8"))
    quote = source.normalized_text.encode("utf-8")[
        source.blocks[0].normalized_start_byte : source.blocks[0].normalized_end_byte
    ]
    span = ProposalSourceSpanV1(
        source_span_id=bundle.artifact_proposal.source_spans[0].source_span_id,
        source_document_id=source.id,
        source_block_id=source.blocks[0].id,
        start_byte=source.blocks[0].normalized_start_byte,
        end_byte=source.blocks[0].normalized_end_byte,
        claim=bundle.artifact_proposal.source_spans[0].claim,
        quote_hash=f"sha256:{hashlib.sha256(quote).hexdigest()}",
    )
    proposal = bundle.artifact_proposal.model_copy(
        update={
            "project_id": project_id,
            "producer_agent_run_id": snapshot.agent_run_id,
            "producer_skill_run_id": snapshot.skill_run_id,
            "source_spans": (span,),
            "dependencies": (
                ProposalDependencyV1(
                    artifact_type="SourceManifest", version_id=manifest_version_id
                ),
            ),
        }
    )
    persisted = store.record_remote_candidate(
        permit=permit, proposal=proposal, provider_response_id="response-1"
    )
    assert persisted.producer_attempt_id == permit.claim.attempt_id
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("REMOTE_REVIEW_PENDING", "response-1", None)
        assert (
            connection.execute("SELECT status FROM workflow_node_runs").fetchone()[0]
            == "NEEDS_REVIEW"
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone()[0] == "COMPLETED"
    acceptance = ArtifactProposalAcceptanceService(
        repository,
        built_in_agent_skill_registry(),
        built_in_proposal_schema_registry(),
    )
    accepted = acceptance.accept_as_draft(
        project_id=project_id,
        proposal_id=persisted.proposal.proposal_id,
        idempotency_key="remote-human-accept",
        actor=TrustedReviewActor(subject_id="named-reviewer", roles=("producer",)),
        parent_version_id=None,
        expected_head_revision=None,
    )
    assert accepted.proposal_id == persisted.proposal.proposal_id
    with sqlite3.connect(database) as connection:
        status, output_version_id = connection.execute(
            "SELECT status, output_version_id FROM workflow_attempts"
        ).fetchone()
        assert status == "SUCCEEDED"
        assert output_version_id is not None


def test_trusted_offline_evidence_can_issue_without_runtime(tmp_path) -> None:
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "9" * 32,
        grant_revision=1,
        project_id="prj_" + "8" * 32,
        connection_id="pcn_" + "7" * 32,
        connection_revision=1,
        approved_model_id="model",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH,
        operation="remote.source.extract",
        input_scope_hash=HASH,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=NOW,
        expires_at=NOW + timedelta(minutes=2),
        policy_version="policy-v1",
    )
    bound = RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant))
    issued = RemoteExecutionAuthorizationStore(
        tmp_path / "offline.db", id_factory=lambda prefix: f"{prefix}_{'d' * 32}", clock=lambda: NOW
    ).issue(binding=bound, envelope=_evidence(bound), verifier=_TrustedOfflineVerifier())
    assert issued.authorization_id == grant.authorization_id


def test_remote_submitting_attempt_is_not_recovered_after_ledger_restart(tmp_path) -> None:
    (
        database,
        _repository,
        _project_id,
        _source,
        _manifest_id,
        _ledger,
        _claim,
        _grant,
        _store,
        _permit,
    ) = _issued_remote_dispatch(tmp_path)
    restarted = LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))

    assert restarted.recover_expired_local_tasks().recovered == 0
    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "SUBMITTING",
        )
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (1,)


def test_remote_parse_failure_preserves_known_response_without_proposal_or_output(tmp_path) -> None:
    (
        database,
        _repository,
        _project_id,
        _source,
        _manifest_id,
        _ledger,
        _claim,
        _grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)

    store.fail_remote_attempt(
        permit=permit,
        error_code="REMOTE_RESPONSE_PARSE_FAILED",
        provider_response_id="response-parse-failed",
    )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("FAILED", "response-parse-failed", None)
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("COMPLETED",)


def test_remote_failure_after_revocation_preserves_response_and_records_fact(tmp_path) -> None:
    (
        database,
        _repository,
        _project_id,
        _source,
        _manifest_id,
        _ledger,
        _claim,
        grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)
    store.revoke(grant.authorization_id)

    store.fail_remote_attempt(
        permit=permit,
        error_code="REMOTE_RESPONSE_PARSE_FAILED",
        provider_response_id="response-revoked-failure",
    )

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("FAILED", "response-revoked-failure", None)
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        assert connection.execute(
            "SELECT reason_code FROM workflow_transition_events WHERE entity_id = ? "
            "ORDER BY sequence DESC LIMIT 1",
            (permit.claim.task_id,),
        ).fetchone() == ("remote.failure.revoked_after_dispatch",)


def test_remote_unknown_quarantine_survives_restart_without_redispatch(tmp_path) -> None:
    (
        database,
        _repository,
        _project_id,
        _source,
        _manifest_id,
        _ledger,
        _claim,
        _grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)
    store.quarantine_remote_unknown(
        permit=permit,
        provider_response_id="response-unknown",
    )

    restarted = LocalTaskLedger(database, clock=lambda: NOW + timedelta(minutes=2))
    assert restarted.recover_expired_local_tasks().recovered == 0
    assert (
        restarted.claim_remote_task(worker_id="new-worker", lease_duration=timedelta(minutes=1))
        is None
    )
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, retry_disposition, provider_response_id, output_version_id "
            "FROM workflow_attempts"
        ).fetchone() == ("REMOTE_UNKNOWN", "REMOTE_UNKNOWN", "response-unknown", None)
        assert connection.execute("SELECT status FROM workflow_node_runs").fetchone() == (
            "RECONCILIATION_REQUIRED",
        )
        assert connection.execute("SELECT status FROM task_ledger").fetchone() == ("COMPLETED",)
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (1,)

    with pytest.raises(LeaseLostError, match="remote unknown lease identity is stale"):
        store.quarantine_remote_unknown(
            permit=permit,
            provider_response_id="response-unknown-replay",
        )


def test_expired_remote_candidate_is_rejected_but_unknown_can_preserve_response(tmp_path) -> None:
    current_time = [NOW]
    database, _repository, project_id, source, manifest_id, ledger, claim, grant, store = (
        _issued_remote_authorization(tmp_path, clock=lambda: current_time[0])
    )
    permit = store.begin_remote_dispatch(
        claim=claim,
        authorization_id=grant.authorization_id,
        expected_authorization_revision=1,
    )
    proposal = _proposal_for_remote_permit(
        ledger=ledger,
        permit=permit,
        project_id=project_id,
        source=source,
        manifest_version_id=manifest_id,
    )
    current_time[0] = NOW + timedelta(minutes=2)

    with pytest.raises(LeaseLostError, match="task lease is stale or expired"):
        store.record_remote_candidate(
            permit=permit,
            proposal=proposal,
            provider_response_id="response-expired-candidate",
        )
    store.quarantine_remote_unknown(
        permit=permit,
        provider_response_id="response-expired-unknown",
    )
    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT status, provider_response_id, output_version_id FROM workflow_attempts"
        ).fetchone() == ("REMOTE_UNKNOWN", "response-expired-unknown", None)
        assert connection.execute("SELECT COUNT(*) FROM agent_artifact_proposals").fetchone() == (
            0,
        )
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (1,)


def test_remote_recheck_blocks_revocation_after_consume(tmp_path) -> None:
    (
        database,
        _repository,
        _project_id,
        _source,
        _manifest_id,
        _ledger,
        _claim,
        grant,
        store,
        permit,
    ) = _issued_remote_dispatch(tmp_path)
    store.revoke(grant.authorization_id)

    with pytest.raises(RemoteAuthorizationError, match="lifecycle does not permit dispatch"):
        store.recheck_dispatch_permit(permit)

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM remote_execution_authorization_snapshots "
            "WHERE event_kind = 'CONSUME'"
        ).fetchone() == (1,)
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "SUBMITTING",
        )


def test_remote_dispatch_scope_is_closed_normalized_and_deeply_immutable() -> None:
    scope = {
        "input_hash": HASH,
        "context_manifest_hash": HASH,
        "accepted_manifest_version_id": "ver_" + "1" * 32,
        "accepted_manifest_content_hash": HASH,
        "source_document_id": "src_" + "2" * 32,
        "source_block_ids": ["srcb_" + "3" * 32],
        "span_bounds": [[0, 1]],
    }
    draft = RemoteDispatchSnapshotDraft(
        connection_id="pcn_" + "4" * 32,
        connection_revision=1,
        approved_model_id="approved-text-v1",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        policy_version="policy-v1",
        context_manifest_id="ctx_" + "5" * 32,
        context_manifest_hash=HASH,
        scope=scope,
    )
    scope["span_bounds"][0][1] = 99
    assert draft.scope_json().endswith('"span_bounds":[[0,1]]}')
    with pytest.raises(TypeError):
        draft.scope["input_hash"] = HASH  # type: ignore[index]
    with pytest.raises(ValueError, match="scope is malformed"):
        replace(draft, scope={**scope, "unexpected": "x"})
    for field in (
        "input_hash",
        "context_manifest_hash",
        "accepted_manifest_version_id",
        "accepted_manifest_content_hash",
        "source_document_id",
        "source_block_ids",
        "span_bounds",
    ):
        incomplete = {key: value for key, value in scope.items() if key != field}
        with pytest.raises(ValueError, match="scope is malformed"):
            replace(draft, scope=incomplete)


def test_current_composition_policy_is_independent_and_fails_closed() -> None:
    draft = RemoteDispatchSnapshotDraft(
        connection_id="pcn_" + "4" * 32,
        connection_revision=1,
        approved_model_id="approved-text-v1",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        policy_version="policy-v1",
        context_manifest_id="ctx_" + "5" * 32,
        context_manifest_hash=HASH,
        scope={
            "input_hash": HASH,
            "context_manifest_hash": HASH,
            "accepted_manifest_version_id": "ver_" + "1" * 32,
            "accepted_manifest_content_hash": HASH,
            "source_document_id": "src_" + "2" * 32,
            "source_block_ids": ["srcb_" + "3" * 32],
            "span_bounds": [[0, 1]],
        },
    )
    policy = TrustedRemoteCompositionPolicy(
        "CPA_LOOPBACK_V1", HASH, "FORMAL_CONTENT_EXECUTION", 0, "USD", "policy-v1"
    )
    _assert_current_composition_policy(lambda: policy, draft)
    with pytest.raises(RemoteAuthorizationError, match="unavailable"):
        _assert_current_composition_policy(None, draft)
    with pytest.raises(RemoteAuthorizationError, match="changed"):
        _assert_current_composition_policy(lambda: replace(policy, policy_version="revoked"), draft)


def test_issue_snapshot_uses_only_the_evidence_grant_core_hash() -> None:
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "1" * 32,
        grant_revision=1,
        project_id="prj_" + "2" * 32,
        connection_id="pcn_" + "3" * 32,
        connection_revision=1,
        approved_model_id="approved-text-v1",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH,
        operation="remote.source.extract",
        input_scope_hash=HASH,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=NOW,
        expires_at=NOW + timedelta(minutes=5),
        policy_version="policy-v1",
    )

    snapshot = authorization_snapshot_from_grant(grant)

    assert snapshot.authorization_id == grant.authorization_id
    assert snapshot.revision == 1
    assert snapshot.event_kind == "ISSUE"
    assert snapshot.grant_core_hash == grant_core_hash(grant)


def test_issue_defaults_to_deny_without_a_complete_typed_evidence_bundle(tmp_path) -> None:
    grant = RemoteExecutionGrantCoreV1(
        authorization_id="rea_" + "1" * 32,
        grant_revision=1,
        project_id="prj_" + "2" * 32,
        connection_id="pcn_" + "3" * 32,
        connection_revision=1,
        approved_model_id="approved-text-v1",
        endpoint_binding="CPA_LOOPBACK_V1",
        transport_contract_hash=HASH,
        operation="remote.source.extract",
        input_scope_hash=HASH,
        dispatch_class="FORMAL_CONTENT_EXECUTION",
        requested_additional_budget_micros=0,
        approved_currency="USD",
        issued_at=NOW,
        expires_at=NOW + timedelta(minutes=5),
        policy_version="policy-v1",
    )
    store = RemoteExecutionAuthorizationStore(
        tmp_path / "workspace.db", id_factory=lambda prefix: f"{prefix}_test"
    )

    with pytest.raises(RemoteAuthorizationError, match="EVIDENCE_MALFORMED"):
        store.issue(
            binding=RemoteExecutionBindingV1(grant=grant, grant_core_hash=grant_core_hash(grant)),
            envelope=None,  # type: ignore[arg-type]
            verifier=None,
        )


@pytest.mark.parametrize(
    ("entrypoint", "field", "message"),
    (
        ("candidate", "grant_core_hash", "candidate authorization core changed"),
        ("candidate", "evidence_binding_hash", "candidate evidence binding changed"),
        ("failure", "grant_core_hash", "failure authorization core changed"),
        ("failure", "evidence_binding_hash", "failure evidence binding changed"),
        ("unknown", "grant_core_hash", "unknown authorization core changed"),
        ("unknown", "evidence_binding_hash", "unknown evidence binding changed"),
    ),
)
def test_terminal_writes_reject_tampered_permit(tmp_path, entrypoint, field, message) -> None:
    *fixture, ledger, claim, grant, store = _issued_remote_authorization(tmp_path)
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    tampered = replace(permit, **{field: "sha256:" + "b" * 64})
    kwargs = {"permit": tampered, "provider_response_id": "response-tampered"}
    if entrypoint == "candidate":
        project_id, source, manifest_id = fixture[2:5]
        kwargs["proposal"] = _proposal_for_remote_permit(
            ledger=ledger,
            permit=permit,
            project_id=project_id,
            source=source,
            manifest_version_id=manifest_id,
        )
        call = store.record_remote_candidate
    elif entrypoint == "failure":
        kwargs["error_code"] = "REMOTE_TEST"
        call = store.fail_remote_attempt
    else:
        call = store.quarantine_remote_unknown
    tables = (
        "workflow_attempts",
        "workflow_node_runs",
        "task_ledger",
        "agent_artifact_proposals",
        "workflow_transition_events",
        "remote_execution_authorization_snapshots",
    )
    with sqlite3.connect(fixture[0]) as connection:
        before = tuple(
            tuple(connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall())
            for table in tables
        )
    with pytest.raises(RemoteAuthorizationError, match=message):
        call(**kwargs)
    with sqlite3.connect(fixture[0]) as connection:
        after = tuple(
            tuple(connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall())
            for table in tables
        )
    assert after == before


@pytest.mark.parametrize("terminal", ("revoke", "expire"))
def test_remote_terminal_lifecycle_cannot_be_applied_twice(tmp_path, terminal) -> None:
    _database, _repository, _project_id, _source, _manifest_id, _ledger, _claim, grant, store = (
        _issued_remote_authorization(tmp_path)
    )
    getattr(store, terminal)(grant.authorization_id)
    with pytest.raises(RemoteAuthorizationError, match="already terminal"):
        getattr(store, terminal)(grant.authorization_id)


@pytest.mark.parametrize("entrypoint", ("failure", "unknown"))
@pytest.mark.parametrize("response_id", (" ", "r" * 513))
def test_remote_terminal_response_identifier_is_bounded_before_state_change(
    tmp_path, entrypoint, response_id
) -> None:
    *fixture, _ledger, claim, grant, store = _issued_remote_authorization(tmp_path)
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    with pytest.raises(ValueError, match="provider response identifier is invalid"):
        if entrypoint == "failure":
            store.fail_remote_attempt(
                permit=permit, error_code="REMOTE_TEST", provider_response_id=response_id
            )
        else:
            store.quarantine_remote_unknown(permit=permit, provider_response_id=response_id)
    with sqlite3.connect(fixture[0]) as connection:
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "SUBMITTING",
        )


@pytest.mark.parametrize("error_code", (" ", "e" * 161))
def test_remote_failure_error_code_is_bounded_before_state_change(tmp_path, error_code) -> None:
    *fixture, _ledger, claim, grant, store = _issued_remote_authorization(tmp_path)
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    with pytest.raises(ValueError, match="remote error code is required and bounded"):
        store.fail_remote_attempt(permit=permit, error_code=error_code, provider_response_id=None)
    with sqlite3.connect(fixture[0]) as connection:
        assert connection.execute("SELECT status FROM workflow_attempts").fetchone() == (
            "SUBMITTING",
        )


def test_remote_recheck_rejects_naturally_expired_evidence_while_lease_is_live(tmp_path) -> None:
    current = [NOW]
    *fixture, claim, grant, store = _issued_remote_authorization(
        tmp_path,
        clock=lambda: current[0],
        grant_update={"expires_at": NOW + timedelta(minutes=2)},
    )
    permit = store.begin_remote_dispatch(
        claim=claim, authorization_id=grant.authorization_id, expected_authorization_revision=1
    )
    live_claim = fixture[5].heartbeat(permit.claim, lease_duration=timedelta(minutes=2))
    permit = replace(permit, claim=live_claim)
    current[0] = NOW + timedelta(seconds=61)
    with sqlite3.connect(fixture[0]) as connection:
        before = tuple(
            tuple(connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall())
            for table in (
                "workflow_attempts",
                "workflow_node_runs",
                "task_ledger",
                "workflow_transition_events",
                "remote_execution_authorization_snapshots",
            )
        )
    with pytest.raises(RemoteAuthorizationError, match="authorization has expired"):
        store.recheck_dispatch_permit(permit)
    with sqlite3.connect(fixture[0]) as connection:
        after = tuple(
            tuple(connection.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall())
            for table in (
                "workflow_attempts",
                "workflow_node_runs",
                "task_ledger",
                "workflow_transition_events",
                "remote_execution_authorization_snapshots",
            )
        )
    assert after == before
