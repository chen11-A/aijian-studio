import base64
import hashlib
import sqlite3
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from time import monotonic, sleep
from typing import Any

import pytest
from aijian_api.agent_run_store import AgentRunStore
from aijian_api.agent_skill_contracts import ArtifactProposalV1
from aijian_api.artifact_proposal_store import ArtifactProposalStore
from aijian_api.domain import ArtifactDependencyDraft, ArtifactSourceSpanDraft
from aijian_api.repository import (
    ArtifactConflictError,
    ArtifactDependencyInvalidError,
    StudioRepository,
)
from aijian_api.shot_outline_worker import (
    ShotOutlineInvocationBuilder,
    shot_outline_fake_skill,
)
from aijian_api.source_extract_worker import LocalFakeSourceExtractWorker
from aijian_api.task_ledger import LocalTaskLedger
from httpx2 import Response as HttpxResponse
from test_proposal_run_create_api import (
    accepted_source,
    approve_manifest,
    sidecar_client,
)
from test_shot_outline_worker import shot_outline_payload


def _wait_for_reviewable_proposal(
    client: Any, project_id: str, task_id: str, timeout: float = 5.0
) -> dict[str, Any]:
    deadline = monotonic() + timeout
    while monotonic() < deadline:
        response = client.get(f"/api/v1/projects/{project_id}/tasks")
        assert response.status_code == 200, response.text
        task = next(
            item for item in response.json()["data"]["tasks"] if item["task"]["task_id"] == task_id
        )
        if task["proposal_id"] is not None and task["node"]["status"] == "NEEDS_REVIEW":
            return task
        sleep(0.02)
    raise AssertionError("local Fake worker did not publish a reviewable ShotOutline proposal")


def _run_real_fake_shot_outline(
    tmp_path: Path,
) -> tuple[Any, StudioRepository, tuple[str, str, str, str, int, int], dict[str, Any]]:
    client, repository = sidecar_client(tmp_path)
    source = accepted_source(client)
    project_id = source[0]
    created_response = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shot-outline-draft-acceptance-v1"},
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()["data"]

    worker = LocalFakeSourceExtractWorker(
        repository.database_path,
        poll_interval=timedelta(milliseconds=20),
        recovery_interval=timedelta(milliseconds=100),
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=5),
    )
    worker.start()
    try:
        task = _wait_for_reviewable_proposal(client, project_id, created["task"]["task_id"])
    finally:
        worker.stop()

    proposal_response = client.get(f"/api/v1/projects/{project_id}/proposals/{task['proposal_id']}")
    assert proposal_response.status_code == 200, proposal_response.text
    proposal = proposal_response.json()["data"]["proposal"]
    return client, repository, source, proposal


def _run_fake_shot_outline_for_existing_source(
    client: Any,
    repository: StudioRepository,
    source: tuple[str, str, str, str, int, int],
    idempotency_key: str,
) -> dict[str, Any]:
    created_response = client.post(
        f"/api/v1/projects/{source[0]}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": idempotency_key},
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()["data"]
    worker = LocalFakeSourceExtractWorker(
        repository.database_path,
        poll_interval=timedelta(milliseconds=20),
        recovery_interval=timedelta(milliseconds=100),
        lease_duration=timedelta(seconds=30),
        handler_timeout=timedelta(seconds=5),
    )
    worker.start()
    try:
        task = _wait_for_reviewable_proposal(client, source[0], created["task"]["task_id"])
    finally:
        worker.stop()
    response = client.get(f"/api/v1/projects/{source[0]}/proposals/{task['proposal_id']}")
    assert response.status_code == 200, response.text
    return response.json()["data"]["proposal"]


def _accept(client: Any, project_id: str, proposal_id: str, key: str) -> HttpxResponse:
    return client.post(
        f"/api/v1/projects/{project_id}/proposals/{proposal_id}/acceptances",
        headers={"Idempotency-Key": key},
        json={"parent_version_id": None, "expected_head_revision": None},
    )


def _assert_draft_validation_failure(response: HttpxResponse) -> None:
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "ARTIFACT_PROPOSAL_VALIDATION_FAILED"


def _manual_reviewable_shot_outline(
    tmp_path: Path,
    mutate: Callable[
        [ArtifactProposalV1, Any, StudioRepository, tuple[str, str, str, str, int, int]],
        ArtifactProposalV1,
    ]
    | None = None,
) -> tuple[Any, StudioRepository, tuple[str, str, str, str, int, int], str]:
    client, repository = sidecar_client(tmp_path)
    source = accepted_source(client)
    project_id = source[0]
    created_response = client.post(
        f"/api/v1/projects/{project_id}/proposal-runs",
        json=shot_outline_payload(source),
        headers={"Idempotency-Key": "shot-outline-invalid-draft-v1"},
    )
    assert created_response.status_code == 201, created_response.text
    created = created_response.json()["data"]

    ledger = LocalTaskLedger(repository.database_path)
    claim = ledger.claim_ready_task(
        worker_id="shot-outline-draft-test-worker",
        lease_duration=timedelta(seconds=30),
        task_id=created["task"]["task_id"],
    )
    assert claim is not None
    running = ledger.mark_attempt_running(claim)
    snapshot = ledger.read_agent_skill_snapshot(running)
    invocation = ShotOutlineInvocationBuilder(repository.database_path)(snapshot, running)
    proposal = shot_outline_fake_skill(snapshot, 0, invocation)
    if mutate is not None:
        proposal = mutate(proposal, client, repository, source)
    proposal_id = (
        ArtifactProposalStore(repository.database_path)
        .persist(running, proposal)
        .proposal.proposal_id
    )
    ledger.complete_local_proposal_task(running, proposal_id=proposal_id)
    return client, repository, source, proposal_id


def _shot_outline_counts(repository: StudioRepository, project_id: str) -> tuple[int, int]:
    with sqlite3.connect(repository.database_path) as connection:
        versions = connection.execute(
            """
            SELECT COUNT(*) FROM artifact_versions AS version
            JOIN artifacts AS artifact ON artifact.artifact_id = version.artifact_id
            WHERE artifact.project_id = ? AND artifact.artifact_type = 'shot_outline'
            """,
            (project_id,),
        ).fetchone()[0]
        acceptances = connection.execute(
            "SELECT COUNT(*) FROM artifact_proposal_draft_acceptances WHERE project_id = ?",
            (project_id,),
        ).fetchone()[0]
    return int(versions), int(acceptances)


def test_real_fake_worker_accepts_eight_shot_proposal_as_idempotent_draft_without_gate_advance(
    tmp_path: Path,
) -> None:
    client, repository, source, proposal = _run_real_fake_shot_outline(tmp_path)
    project_id = source[0]

    accepted = _accept(client, project_id, proposal["proposal_id"], "shot-outline-draft-v1")
    assert accepted.status_code == 201, accepted.text
    data = accepted.json()["data"]
    assert data["project_id"] == project_id
    assert data["proposal_id"] == proposal["proposal_id"]
    assert data["draft_version_id"].startswith("ver_")
    assert data["replayed"] is False

    head = repository.get_artifact_head(project_id, "shot_outline")
    assert head.latest_version_id == data["draft_version_id"]
    assert head.review_version_id is None
    assert head.accepted_version_id is None
    record = repository.get_artifact_version(project_id, "shot_outline", data["draft_version_id"])
    assert record.version.content == proposal["payload"]
    assert record.version.content_hash == proposal["payload_hash"]
    assert [item.upstream_version_id for item in record.dependencies] == [source[1]]
    persisted_span = record.source_spans[0]
    source_document = repository.get_source(project_id, persisted_span.source_document_id)
    quote = source_document.normalized_text.encode("utf-8")[
        persisted_span.start_byte : persisted_span.end_byte
    ]
    assert persisted_span.quote_hash == f"sha256:{hashlib.sha256(quote).hexdigest()}"

    replay = _accept(client, project_id, proposal["proposal_id"], "shot-outline-draft-v1")
    assert replay.status_code == 200, replay.text
    assert replay.json()["data"] == {**data, "replayed": True}
    assert _shot_outline_counts(repository, project_id) == (1, 1)

    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute(
            """
            SELECT COUNT(*) FROM gate_decisions AS decision
            JOIN artifacts AS artifact ON artifact.artifact_id = decision.artifact_id
            WHERE artifact.project_id = ? AND artifact.artifact_type = 'shot_outline'
            """,
            (project_id,),
        ).fetchone() == (0,)


def test_shot_outline_second_draft_enforces_cas_and_latest_parent_without_gate_advance(
    tmp_path: Path,
) -> None:
    client, repository, source, first_proposal = _run_real_fake_shot_outline(tmp_path)
    first = _accept(client, source[0], first_proposal["proposal_id"], "shot-outline-v1")
    assert first.status_code == 201, first.text
    first_data = first.json()["data"]

    second_proposal = _run_fake_shot_outline_for_existing_source(
        client, repository, source, "shot-outline-v2"
    )
    first_bundle = AgentRunStore(repository.database_path).get(
        source[0], first_proposal["producer_agent_run_id"]
    )
    second_bundle = AgentRunStore(repository.database_path).get(
        source[0], second_proposal["producer_agent_run_id"]
    )
    assert second_bundle.context_manifest.manifest_hash == (
        first_bundle.context_manifest.manifest_hash
    )
    assert second_bundle.context_manifest.context_manifest_id != (
        first_bundle.context_manifest.context_manifest_id
    )
    second = client.post(
        f"/api/v1/projects/{source[0]}/proposals/{second_proposal['proposal_id']}/acceptances",
        headers={"Idempotency-Key": "shot-outline-accept-v2"},
        json={
            "parent_version_id": first_data["draft_version_id"],
            "expected_head_revision": 1,
        },
    )
    assert second.status_code == 201, second.text
    second_data = second.json()["data"]
    assert second_data["draft_version_id"] != first_data["draft_version_id"]
    second_record = repository.get_artifact_version(
        source[0], "shot_outline", second_data["draft_version_id"]
    )
    assert second_record.version.parent_version_id == first_data["draft_version_id"]
    assert _shot_outline_counts(repository, source[0]) == (2, 2)

    third_proposal = _run_fake_shot_outline_for_existing_source(
        client, repository, source, "shot-outline-v3"
    )
    third_bundle = AgentRunStore(repository.database_path).get(
        source[0], third_proposal["producer_agent_run_id"]
    )
    assert third_bundle.context_manifest.manifest_hash == (
        first_bundle.context_manifest.manifest_hash
    )
    assert third_bundle.context_manifest.context_manifest_id not in {
        first_bundle.context_manifest.context_manifest_id,
        second_bundle.context_manifest.context_manifest_id,
    }
    stale_cas = client.post(
        f"/api/v1/projects/{source[0]}/proposals/{third_proposal['proposal_id']}/acceptances",
        headers={"Idempotency-Key": "shot-outline-v3-stale-cas"},
        json={
            "parent_version_id": second_data["draft_version_id"],
            "expected_head_revision": 1,
        },
    )
    assert stale_cas.status_code == 409, stale_cas.text
    assert stale_cas.json()["error"]["code"] == "ARTIFACT_PROPOSAL_VALIDATION_FAILED"
    assert _shot_outline_counts(repository, source[0]) == (2, 2)
    non_latest_parent = client.post(
        f"/api/v1/projects/{source[0]}/proposals/{third_proposal['proposal_id']}/acceptances",
        headers={"Idempotency-Key": "shot-outline-v3-non-latest"},
        json={
            "parent_version_id": first_data["draft_version_id"],
            "expected_head_revision": 2,
        },
    )
    assert non_latest_parent.status_code == 409, non_latest_parent.text
    assert non_latest_parent.json()["error"]["code"] == "ARTIFACT_PROPOSAL_VALIDATION_FAILED"
    assert _shot_outline_counts(repository, source[0]) == (2, 2)
    third = client.post(
        f"/api/v1/projects/{source[0]}/proposals/{third_proposal['proposal_id']}/acceptances",
        headers={"Idempotency-Key": "shot-outline-accept-v3"},
        json={
            "parent_version_id": second_data["draft_version_id"],
            "expected_head_revision": 2,
        },
    )
    assert third.status_code == 201, third.text
    head = repository.get_artifact_head(source[0], "shot_outline")
    assert head.latest_version_id == third.json()["data"]["draft_version_id"]
    assert head.review_version_id is None
    assert head.accepted_version_id is None
    assert _shot_outline_counts(repository, source[0]) == (3, 3)
    replay = client.post(
        f"/api/v1/projects/{source[0]}/proposals/{third_proposal['proposal_id']}/acceptances",
        headers={"Idempotency-Key": "shot-outline-accept-v3"},
        json={
            "parent_version_id": second_data["draft_version_id"],
            "expected_head_revision": 2,
        },
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["data"] == {**third.json()["data"], "replayed": True}
    assert _shot_outline_counts(repository, source[0]) == (3, 3)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute(
            "SELECT COUNT(*) FROM gate_decisions AS decision "
            "JOIN artifacts AS artifact ON artifact.artifact_id = decision.artifact_id "
            "WHERE artifact.project_id = ? AND artifact.artifact_type = 'shot_outline'",
            (source[0],),
        ).fetchone() == (0,)


def test_draft_acceptance_rejects_source_span_outside_accepted_manifest_membership(
    tmp_path: Path,
) -> None:
    def outside_manifest_member(
        proposal: ArtifactProposalV1,
        client: Any,
        _repository: StudioRepository,
        source: tuple[str, str, str, str, int, int],
    ) -> ArtifactProposalV1:
        response = client.post(
            f"/api/v1/projects/{source[0]}/sources",
            json={
                "filename": "not-in-accepted-manifest.txt",
                "media_type": "text/plain",
                "content_base64": base64.b64encode(
                    "新文档不属于已接受来源成员。".encode()
                ).decode(),
            },
        )
        assert response.status_code == 201, response.text
        document = response.json()["data"]
        block = document["blocks"][-1]
        changed_span = proposal.source_spans[0].model_copy(
            update={
                "source_document_id": document["id"],
                "source_block_id": block["id"],
                "start_byte": block["normalized_start_byte"],
                "end_byte": block["normalized_end_byte"],
                "quote_hash": (
                    f"sha256:{hashlib.sha256('新文档不属于已接受来源成员。'.encode()).hexdigest()}"
                ),
            }
        )
        return proposal.model_copy(update={"source_spans": (changed_span,)})

    client, repository, source, proposal_id = _manual_reviewable_shot_outline(
        tmp_path, outside_manifest_member
    )
    response = _accept(client, source[0], proposal_id, "shot-outline-non-member-v1")
    _assert_draft_validation_failure(response)
    assert _shot_outline_counts(repository, source[0]) == (0, 0)


def test_draft_acceptance_requires_an_exact_accepted_source_manifest_dependency(
    tmp_path: Path,
) -> None:
    def missing_dependency(
        proposal: ArtifactProposalV1,
        _client: Any,
        _repository: StudioRepository,
        _source: tuple[str, str, str, str, int, int],
    ) -> ArtifactProposalV1:
        return proposal.model_copy(update={"dependencies": ()})

    client, repository, source, proposal_id = _manual_reviewable_shot_outline(
        tmp_path, missing_dependency
    )
    response = _accept(client, source[0], proposal_id, "shot-outline-missing-dependency-v1")
    _assert_draft_validation_failure(response)
    assert _shot_outline_counts(repository, source[0]) == (0, 0)


def test_shot_outline_content_resolver_spans_are_checked_against_accepted_manifest(
    tmp_path: Path,
) -> None:
    client, repository = sidecar_client(tmp_path)
    source = accepted_source(client)
    imported = client.post(
        f"/api/v1/projects/{source[0]}/sources",
        json={
            "filename": "not-yet-manifest-member.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode("不属于已接受清单。".encode()).decode("ascii"),
        },
    )
    assert imported.status_code == 201, imported.text
    document = imported.json()["data"]
    block = document["blocks"][-1]
    span = ArtifactSourceSpanDraft(
        fact_id="resolver-outside-manifest",
        source_document_id=document["id"],
        source_block_id=block["id"],
        role="supports",
        start_byte=block["normalized_start_byte"],
        end_byte=block["normalized_end_byte"],
        claim="resolver span is outside the accepted manifest",
    )
    dependency = ArtifactDependencyDraft(
        upstream_version_id=source[1],
        relationship="derived_from",
        impact="blocking",
    )

    def resolver(
        _id_factory: Callable[[str], str],
    ) -> tuple[dict[str, object], tuple[ArtifactSourceSpanDraft, ...]]:
        return ({"purpose": "DEVELOPMENT_FAKE_ONLY"}, (span,))

    with pytest.raises(
        ArtifactDependencyInvalidError,
        match="outside the accepted SourceManifest",
    ):
        repository.create_artifact_version(
            project_id=source[0],
            artifact_type="shot_outline",
            schema_version="1.0.0",
            content=None,
            author_actor_type="agent",
            author_actor_id="resolver-test",
            change_summary="resolver boundary test",
            dependencies=(dependency,),
            required_accepted_upstream_version_id=source[1],
            content_resolver=resolver,
        )
    assert _shot_outline_counts(repository, source[0]) == (0, 0)


def test_shot_outline_repository_rejects_missing_required_accepted_upstream(
    tmp_path: Path,
) -> None:
    client, repository = sidecar_client(tmp_path)
    source = accepted_source(client)
    span = ArtifactSourceSpanDraft(
        fact_id="missing-required-upstream",
        source_document_id=source[2],
        source_block_id=source[3],
        role="supports",
        start_byte=source[4],
        end_byte=source[5],
        claim="valid source span with omitted required upstream",
    )
    dependency = ArtifactDependencyDraft(
        upstream_version_id=source[1],
        relationship="derived_from",
        impact="blocking",
    )

    with pytest.raises(
        ArtifactDependencyInvalidError,
        match="requires an exact accepted SourceManifest dependency",
    ):
        repository.create_artifact_version(
            project_id=source[0],
            artifact_type="shot_outline",
            schema_version="1.0.0",
            content={"purpose": "DEVELOPMENT_FAKE_ONLY"},
            author_actor_type="agent",
            author_actor_id="missing-required-upstream-test",
            change_summary="required upstream boundary test",
            source_spans=(span,),
            dependencies=(dependency,),
        )
    assert _shot_outline_counts(repository, source[0]) == (0, 0)


def test_draft_acceptance_rejects_source_span_that_splits_utf8_codepoint(
    tmp_path: Path,
) -> None:
    def split_utf8(
        proposal: ArtifactProposalV1,
        _client: Any,
        repository: StudioRepository,
        source: tuple[str, str, str, str, int, int],
    ) -> ArtifactProposalV1:
        document = repository.get_source(source[0], source[2])
        block = next(item for item in document.blocks if item.id == source[3])
        encoded = document.normalized_text.encode("utf-8")
        invalid_start = next(
            offset
            for offset in range(block.normalized_start_byte + 1, block.normalized_end_byte)
            if _cannot_decode_one_byte(encoded, offset)
        )
        changed_span = proposal.source_spans[0].model_copy(
            update={
                "start_byte": invalid_start,
                "end_byte": invalid_start + 1,
                "quote_hash": f"sha256:{'0' * 64}",
            }
        )
        return proposal.model_copy(update={"source_spans": (changed_span,)})

    client, repository, source, proposal_id = _manual_reviewable_shot_outline(tmp_path, split_utf8)
    response = _accept(client, source[0], proposal_id, "shot-outline-utf8-boundary-v1")
    _assert_draft_validation_failure(response)
    assert _shot_outline_counts(repository, source[0]) == (0, 0)


def _cannot_decode_one_byte(encoded: bytes, offset: int) -> bool:
    try:
        encoded[offset : offset + 1].decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def test_draft_acceptance_rejects_source_quote_hash_drift_without_partial_version(
    tmp_path: Path,
) -> None:
    def wrong_hash(
        proposal: ArtifactProposalV1,
        _client: Any,
        _repository: StudioRepository,
        _source: tuple[str, str, str, str, int, int],
    ) -> ArtifactProposalV1:
        changed_span = proposal.source_spans[0].model_copy(
            update={"quote_hash": f"sha256:{'f' * 64}"}
        )
        return proposal.model_copy(update={"source_spans": (changed_span,)})

    client, repository, source, proposal_id = _manual_reviewable_shot_outline(tmp_path, wrong_hash)
    response = _accept(client, source[0], proposal_id, "shot-outline-hash-drift-v1")
    _assert_draft_validation_failure(response)
    assert _shot_outline_counts(repository, source[0]) == (0, 0)


def test_draft_acceptance_rejects_proposal_bound_to_expired_accepted_manifest(
    tmp_path: Path,
) -> None:
    client, repository, source, proposal = _run_real_fake_shot_outline(tmp_path)
    manifest = client.get(f"/api/v1/projects/{source[0]}/source-manifest")
    assert manifest.status_code == 200, manifest.text
    copied = client.post(
        f"/api/v1/internal/projects/{source[0]}/source-manifest/versions/{manifest.json()['data']['latest_version']['id']}:copy-draft",
        headers={"If-Match": manifest.headers["etag"]},
        json={},
    )
    assert copied.status_code == 201, copied.text
    new_manifest_id = copied.json()["data"]["latest_version"]["id"]
    approve_manifest(
        client,
        project_id=source[0],
        version_id=new_manifest_id,
        etag=copied.headers["etag"],
    )
    assert (
        repository.get_artifact_head(source[0], "source_manifest").accepted_version_id
        == new_manifest_id
    )

    response = _accept(
        client, source[0], proposal["proposal_id"], "shot-outline-expired-dependency-v1"
    )
    _assert_draft_validation_failure(response)
    assert _shot_outline_counts(repository, source[0]) == (0, 0)
    with pytest.raises(ArtifactConflictError):
        repository.get_artifact_head(source[0], "shot_outline")
