"""Repository authorization and immutable-read boundaries with synthetic review facts."""

import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.domain import TrustedReviewActor
from aijian_api.gate_policy import DEFAULT_GATE_POLICIES
from aijian_api.repository import (
    ArtifactConflictError,
    EpisodeNotFoundError,
    ProjectNotFoundError,
    ReviewInvalidError,
    StudioRepository,
)

POLICY = DEFAULT_GATE_POLICIES["source_manifest"]
ACTOR = TrustedReviewActor("synthetic-author", ("writer", "producer"))
NOW = datetime(2026, 10, 10, tzinfo=UTC)


@pytest.mark.parametrize(
    "actor",
    [
        TrustedReviewActor("", ("writer",)),
        TrustedReviewActor("test", ()),
        TrustedReviewActor("test", ("writer", "writer")),
    ],
)
def test_review_actor_requires_identity_and_unique_roles(actor):
    with pytest.raises(ReviewInvalidError, match="actor is invalid"):
        StudioRepository._authorize_review_action(POLICY, "submit", {}, actor)


@pytest.mark.parametrize("roles", [None, [], "writer", [1], ["writer", "writer"], ["outsider"]])
def test_signoff_requires_explicit_unique_authorized_roles(roles):
    with pytest.raises(ReviewInvalidError):
        StudioRepository._authorize_review_action(POLICY, "signoff", {"roles": roles}, ACTOR)


def test_single_role_policy_cannot_be_bypassed_by_multi_role_actor():
    policy = replace(POLICY, allow_multi_role_signoff=False)
    with pytest.raises(ReviewInvalidError, match="forbids multi-role"):
        StudioRepository._authorize_review_action(
            policy,
            "signoff",
            {"roles": ["writer", "producer"]},
            ACTOR,
        )
    assert (
        StudioRepository._authorize_review_action(
            policy,
            "signoff",
            {"roles": ["writer"]},
            ACTOR,
        )
        is None
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("decision", "unknown"),
        ("rationale", None),
        ("rationale", "  "),
        ("actor_role", None),
        ("actor_role", "viewer"),
    ],
)
def test_gate_decision_requires_valid_reason_and_selected_authority(field, value):
    payload = {"decision": "approved", "rationale": "synthetic review", "actor_role": "producer"}
    payload[field] = value
    with pytest.raises(ReviewInvalidError, match="cannot make"):
        StudioRepository._authorize_review_action(POLICY, "decision", payload, ACTOR)


@pytest.fixture
def challenge(tmp_path):
    repository = StudioRepository(tmp_path / "synthetic.sqlite3")
    payload = {"source": "synthetic"}
    kwargs = dict(
        challenge_id="challenge",
        confirmation_token="synthetic-token",
        expected_action="submit",
        action_payload=payload,
        actor=ACTOR,
        policy=POLICY,
        version_id="version",
        gate="G1",
        expected_revision=2,
        expected_evidence_revision=3,
        consumed_at=NOW,
    )
    row = dict(
        challenge_hash=repository._confirmation_hash("challenge", "synthetic-token"),
        consumed_at=None,
        expires_at=(NOW + timedelta(minutes=1)).isoformat(),
        version_id="version",
        gate="G1",
        action="submit",
        action_payload_hash=canonical_content_hash(
            repository._bound_action_payload(payload, ACTOR, POLICY)
        ),
        policy_snapshot_hash=POLICY.snapshot_hash,
        actor_id=ACTOR.subject_id,
        actor_roles_json=json.dumps(ACTOR.roles),
        head_revision=2,
        review_evidence_revision=3,
        readiness_report_id="report",
    )
    return repository, kwargs, row


@pytest.mark.parametrize(
    "field,value",
    [
        ("challenge_hash", "wrong"),
        ("consumed_at", "already"),
        ("expires_at", NOW.isoformat()),
        ("version_id", "other"),
        ("gate", "G2"),
        ("action", "decision"),
        ("action_payload_hash", "wrong"),
        ("policy_snapshot_hash", "wrong"),
        ("actor_id", "other"),
        ("actor_roles_json", '["writer"]'),
        ("head_revision", 3),
        ("review_evidence_revision", 4),
    ],
)
def test_confirmation_cannot_be_consumed_after_any_binding_change(challenge, field, value):
    repository, kwargs, row = challenge
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = row | {field: value}
    with pytest.raises(ReviewInvalidError):
        repository._consume_challenge(connection, **kwargs)
    assert connection.execute.call_count == 1
    assert connection.execute.call_args.args[0].lstrip().startswith("SELECT")


def readiness_row():
    content = {"ready": True, "policy_snapshot_hash": POLICY.snapshot_hash}
    return dict(
        report_id="report",
        artifact_id="artifact",
        version_id="version",
        gate="G1",
        submission_id=None,
        policy_code=POLICY.policy_code,
        policy_version=POLICY.policy_version,
        head_revision=2,
        review_evidence_revision=3,
        report_json=json.dumps(content),
        report_hash=canonical_content_hash(content),
        expires_at=(NOW + timedelta(minutes=1)).isoformat(),
        created_at=NOW.isoformat(),
    )


@pytest.mark.parametrize(
    "fault",
    [
        "missing-challenge",
        "already-consumed",
        "missing-report",
        "report-hash",
        "report-version",
        "report-gate",
        "report-evidence",
        "report-expired",
        "report-policy",
        "report-policy-version",
        "report-snapshot",
        "report-not-ready",
    ],
)
def test_review_requires_atomic_consumption_and_matching_current_readiness(challenge, fault):
    repository, kwargs, row = challenge
    report = readiness_row()
    if fault == "report-hash":
        report["report_hash"] = "wrong"
    elif fault in {"report-snapshot", "report-not-ready"}:
        content = json.loads(report["report_json"])
        content["policy_snapshot_hash" if fault == "report-snapshot" else "ready"] = (
            "wrong" if fault == "report-snapshot" else False
        )
        report.update(report_json=json.dumps(content), report_hash=canonical_content_hash(content))
    elif fault.startswith("report-"):
        field, value = {
            "report-version": ("version_id", "other"),
            "report-gate": ("gate", "G2"),
            "report-evidence": ("review_evidence_revision", 4),
            "report-expired": ("expires_at", NOW.isoformat()),
            "report-policy": ("policy_code", "other"),
            "report-policy-version": ("policy_version", "0"),
        }[fault]
        report[field] = value
    connection = Mock()
    connection.execute.side_effect = [
        Mock(fetchone=Mock(return_value=None if fault == "missing-challenge" else row)),
        Mock(rowcount=0 if fault == "already-consumed" else 1),
        Mock(fetchone=Mock(return_value=None if fault == "missing-report" else report)),
    ]
    with pytest.raises(ReviewInvalidError):
        repository._consume_challenge(connection, **kwargs)


def test_valid_confirmation_returns_exact_verified_report(challenge):
    repository, kwargs, row = challenge
    report = readiness_row()
    connection = Mock()
    connection.execute.side_effect = [
        Mock(fetchone=Mock(return_value=row)),
        Mock(rowcount=1),
        Mock(fetchone=Mock(return_value=report)),
    ]
    value = repository._consume_challenge(connection, **kwargs)
    assert value.id == "report"
    assert value.report["ready"] is True
    assert value.report_hash == report["report_hash"]


@pytest.mark.parametrize("timeout", [timedelta(0), timedelta(seconds=-1)])
def test_nonpositive_repository_timeout_rejected_before_creating_database(tmp_path, timeout):
    path = tmp_path / "absent" / "workspace.sqlite3"
    with pytest.raises(ValueError, match="timeout must be positive"):
        StudioRepository(path, connection_timeout=timeout)
    assert not path.parent.exists()


def test_gate_policy_override_requires_explicit_test_composition(tmp_path):
    path = tmp_path / "absent" / "workspace.sqlite3"
    with pytest.raises(ValueError, match="restricted to explicit test composition"):
        StudioRepository(path, gate_policies=DEFAULT_GATE_POLICIES)
    assert not path.parent.exists()


@pytest.mark.parametrize("missing", ["version", "head"])
def test_review_context_requires_version_and_head(challenge, missing):
    repository, _, _ = challenge
    connection = Mock()
    connection.execute.return_value.fetchone.side_effect = (
        [None] if missing == "version" else [{"artifact_id": "artifact"}, None]
    )
    with pytest.raises(ReviewInvalidError, match="was not found"):
        repository._review_context(
            connection, project_id="project", artifact_type="test", version_id="v"
        )


def test_cas_revision_failure_and_missing_head_cannot_report_success(challenge):
    repository, _, _ = challenge
    connection = Mock()
    connection.execute.return_value.rowcount = 0
    with pytest.raises(ArtifactConflictError):
        repository._advance_head_revision(
            connection, artifact_id="artifact", expected_revision=1, updated_at=NOW
        )
    connection.execute.return_value.fetchone.return_value = None
    with pytest.raises(RuntimeError, match="head is missing"):
        repository._load_artifact_head(connection, "artifact")


def test_unknown_gate_policy_is_not_implicitly_authorized(challenge):
    repository, _, _ = challenge
    with pytest.raises(ReviewInvalidError, match="registered Gate policy"):
        repository._gate_policy("unregistered-synthetic-artifact")


@pytest.mark.parametrize(
    "failure,error",
    [
        ("project", ProjectNotFoundError),
        ("episode", EpisodeNotFoundError),
        ("producer", ValueError),
        ("content", ValueError),
        ("resolver-content", ValueError),
        ("initial-revision", ArtifactConflictError),
        ("initial-parent", ArtifactConflictError),
        ("ownership", ValueError),
        ("validator", ValueError),
    ],
)
def test_rejected_artifact_creation_leaves_no_version_or_head(challenge, failure, error):
    repository, _, _ = challenge
    project = repository.create_project(
        name="Synthetic invariant",
        aspect_ratio="9:16",
        target_duration_seconds=3,
        source_language="zh-CN",
    )
    kwargs = dict(
        project_id=project.id,
        artifact_type="test_artifact",
        schema_version="1.0.0",
        content={"test": True},
        author_actor_type="human",
        author_actor_id="synthetic",
        change_summary="Synthetic test",
    )
    if failure == "project":
        kwargs["project_id"] = "prj_" + "0" * 32
    elif failure == "episode":
        kwargs["episode_id"] = "ep_" + "0" * 32
    elif failure == "producer":
        kwargs["producer_attempt_id"] = "attempt-missing"
    elif failure == "content":
        kwargs["content"] = None
    elif failure == "resolver-content":
        kwargs["content_resolver"] = Mock()
    elif failure == "initial-revision":
        kwargs["expected_revision"] = 1
    elif failure == "initial-parent":
        kwargs["parent_version_id"] = "ver_" + "0" * 32
    elif failure == "ownership":
        kwargs["_manage_transaction"] = False
    else:
        kwargs["record_validator"] = Mock(side_effect=ValueError("synthetic invalid record"))
    with pytest.raises(error):
        repository.create_artifact_version(**kwargs)
    with repository._connection() as connection:
        for table in ("artifacts", "artifact_versions", "artifact_heads"):
            assert connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0


@pytest.mark.parametrize("bad_content", ["{", "[]", '{"invalid":true}'])
def test_accepted_manifest_cannot_hide_invalid_content(challenge, bad_content):
    from aijian_api.repository import ArtifactDependencyInvalidError

    repository, _, _ = challenge
    connection = Mock()
    connection.execute.return_value.fetchone.return_value = {
        "content_json": bad_content,
        "content_hash": "sha256:" + "0" * 64,
    }
    with pytest.raises(ArtifactDependencyInvalidError, match="content is invalid"):
        repository._validate_accepted_source_manifest_membership(
            connection,
            project_id="project",
            manifest_version_id="version",
            source_spans=(),
        )
    with pytest.raises(ArtifactDependencyInvalidError, match="content is invalid"):
        repository._validate_production_brief_source_membership(
            connection,
            project_id="project",
            manifest_version_id="version",
            source_document_id="source",
            source_block_ids=(),
        )
