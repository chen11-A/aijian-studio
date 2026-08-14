"""HTTP and projection tests for T05A invalidation impact report API."""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from aijian_api.domain import ArtifactDependencyDraft, Project, TrustedReviewActor
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient

LOCAL_ACTOR = TrustedReviewActor(
    subject_id="local-user",
    roles=("writer", "continuity_reviewer", "producer"),
)

TOKEN = "y" * 43
HOST = "127.0.0.1:43124"
ORIGIN = "app://aijian"


class MutableClock:
    def __init__(self) -> None:
        self.value = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.value

    def advance(self, delta: timedelta) -> None:
        self.value += delta


def deterministic_id_factory():
    counters: defaultdict[str, int] = defaultdict(int)

    def create_id(prefix: str) -> str:
        counters[prefix] += 1
        return f"{prefix}_{counters[prefix]:032x}"

    return create_id


def create_repository(database: Path, *, clock: MutableClock | None = None) -> StudioRepository:
    return StudioRepository(
        database,
        id_factory=deterministic_id_factory(),
        clock=clock or MutableClock(),
        challenge_token_factory=lambda: "one-time-native-confirmation",
    )


def create_project(repository: StudioRepository, name: str = "雾城来信") -> Project:
    return repository.create_project(
        name=name,
        aspect_ratio="9:16",
        target_duration_seconds=90,
        source_language="zh-CN",
    )


def create_version(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    *,
    content: dict[str, object] | None = None,
    dependencies: tuple[ArtifactDependencyDraft, ...] = (),
    parent_version_id: str | None = None,
    expected_revision: int | None = None,
    change_summary: str = "version",
):
    return repository.create_artifact_version(
        project_id=project.id,
        artifact_type=artifact_type,
        schema_version="1.0.0",
        content=content if content is not None else {"title": artifact_type},
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary=change_summary,
        dependencies=dependencies,
        parent_version_id=parent_version_id,
        expected_revision=expected_revision,
    )


def force_accept(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    version_id: str,
):
    head = repository.get_artifact_head(project.id, artifact_type)
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER IF EXISTS artifact_heads_accepted_requires_decision")
        connection.execute(
            """
            UPDATE artifact_heads
            SET accepted_version_id = ?, revision = revision + 1,
                updated_at = '2026-08-03T12:00:00Z'
            WHERE artifact_id = ? AND revision = ?
            """,
            (version_id, head.artifact_id, head.revision),
        )
        connection.commit()
    return repository.get_artifact_version(project.id, artifact_type, version_id)


def approve_source_manifest(repository: StudioRepository, project: Project, artifact):
    roles = ("writer", "producer")
    prepared_submit = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="submit",
        action_payload={},
        actor=LOCAL_ACTOR,
        expected_revision=artifact.head.revision,
    )
    submitted = repository.submit_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        expected_revision=artifact.head.revision,
        challenge_id=prepared_submit.challenge.id,
        confirmation_token=prepared_submit.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    prepared_signoff = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="signoff",
        action_payload={"roles": list(roles)},
        actor=LOCAL_ACTOR,
        expected_revision=submitted.head.revision,
    )
    signed = repository.signoff_artifact_review(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        roles=roles,
        expected_revision=submitted.head.revision,
        challenge_id=prepared_signoff.challenge.id,
        confirmation_token=prepared_signoff.confirmation_token,
        actor=LOCAL_ACTOR,
    )
    rationale = "来源基线可用"
    prepared_decision = repository.prepare_review_action(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        action="decision",
        action_payload={
            "decision": "approved",
            "rationale": rationale,
            "actor_role": "producer",
        },
        actor=LOCAL_ACTOR,
        readiness_report_id=prepared_signoff.report.id,
        expected_revision=signed.head.revision,
    )
    decided = repository.decide_artifact_gate(
        project_id=project.id,
        artifact_type="source_manifest",
        version_id=artifact.version.id,
        decision="approved",
        rationale=rationale,
        expected_revision=signed.head.revision,
        challenge_id=prepared_decision.challenge.id,
        confirmation_token=prepared_decision.confirmation_token,
        actor=LOCAL_ACTOR,
        actor_role="producer",
    )
    return repository.get_artifact_version(
        project.id, "source_manifest", decided.head.accepted_version_id or artifact.version.id
    )


def create_and_approve_manifest(
    repository: StudioRepository,
    project: Project,
    *,
    documents: list[dict[str, object]] | None = None,
    parent=None,
    change_summary: str = "manifest",
):
    content = {"documents": documents or [{"source_document_id": "src_fixture"}]}
    if parent is None:
        created = create_version(
            repository,
            project,
            "source_manifest",
            content=content,
            change_summary=change_summary,
        )
    else:
        head = repository.get_artifact_head(project.id, "source_manifest")
        created = create_version(
            repository,
            project,
            "source_manifest",
            content=content,
            parent_version_id=parent.version.id,
            expected_revision=head.revision,
            change_summary=change_summary,
        )
    return approve_source_manifest(repository, project, created)


def accept_custom(
    repository: StudioRepository,
    project: Project,
    artifact_type: str,
    *,
    dependencies: tuple[ArtifactDependencyDraft, ...] = (),
    content: dict[str, object] | None = None,
    change_summary: str = "accepted",
):
    created = create_version(
        repository,
        project,
        artifact_type,
        content=content,
        dependencies=dependencies,
        change_summary=change_summary,
    )
    return force_accept(repository, project, artifact_type, created.version.id)


def client_for(repository: StudioRepository) -> TestClient:
    return TestClient(create_app(repository=repository))


def _drop_path_immutability(connection: sqlite3.Connection) -> None:
    connection.execute("DROP TRIGGER IF EXISTS invalidation_path_impacts_immutable_update")


def _drop_operation_immutability(connection: sqlite3.Connection) -> None:
    connection.execute("DROP TRIGGER IF EXISTS invalidation_operations_immutable_update")


def _seed_direct_impact_operation(repository: StudioRepository, project: Project):
    old = create_and_approve_manifest(repository, project, change_summary="v1")
    leaf = accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=old.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_v2"}],
        parent=old,
        change_summary="v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    return old, leaf, operation, impacts


def _assert_ledger_corrupt(response) -> None:
    assert response.status_code == 409
    body = response.json()
    assert body["error"]["code"] == "INVALIDATION_LEDGER_CORRUPT"
    assert body["error"]["message"] == ("The invalidation ledger data is corrupt or inconsistent")
    assert body["error"]["details"] == {}
    assert "sqlite" not in response.text.lower()
    assert "traceback" not in response.text.lower()
    assert "validationerror" not in response.text.lower()
    assert "pydantic" not in response.text.lower()


def test_empty_project_returns_valid_empty_list(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    client = client_for(repository)

    response = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"] == {"project_id": project.id, "operations": []}
    assert UUID(payload["request_id"])


def test_head_replacement_with_no_downstream_paths_is_zero_count_report(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    old = create_and_approve_manifest(repository, project, change_summary="v1")
    new = create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_fixture_v2"}],
        parent=old,
        change_summary="v2",
    )
    client = client_for(repository)

    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    assert listed.status_code == 200
    operations = listed.json()["data"]["operations"]
    assert len(operations) == 1
    summary = operations[0]
    assert summary["changed_artifact_id"] == old.version.artifact_id
    assert summary["old_accepted_version_id"] == old.version.id
    assert summary["new_accepted_version_id"] == new.version.id
    assert summary["affected_version_count"] == 0
    assert summary["independent_path_count"] == 0
    assert summary["impact_counts"] == {"blocking": 0, "render_only": 0, "advisory": 0}
    assert summary["strongest_effective_impact"] is None

    detail = client.get(
        f"/api/v1/projects/{project.id}/invalidation-operations/{summary['operation_id']}"
    )
    assert detail.status_code == 200
    body = detail.json()["data"]
    assert body["operation"] == summary
    assert body["affected_versions"] == []


def test_direct_blocking_transitive_render_advisory_and_diamond_reports(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    mid = accept_custom(
        repository,
        project,
        "mid",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    leaf = accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=mid.version.id,
                relationship="derived_from",
                impact="render_only",
            ),
        ),
    )
    advisory_leaf = accept_custom(
        repository,
        project,
        "advisory_leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="mentions",
                impact="advisory",
            ),
        ),
    )
    left = accept_custom(
        repository,
        project,
        "left",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    right = accept_custom(
        repository,
        project,
        "right",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    sink = accept_custom(
        repository,
        project,
        "sink",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=left.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ArtifactDependencyDraft(
                upstream_version_id=right.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )

    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    client = client_for(repository)
    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    assert listed.status_code == 200
    summary = listed.json()["data"]["operations"][0]
    assert summary["strongest_effective_impact"] == "blocking"
    assert summary["affected_version_count"] == 6
    assert summary["independent_path_count"] == 7
    assert summary["impact_counts"]["blocking"] >= 1
    assert summary["impact_counts"]["render_only"] >= 1
    assert summary["impact_counts"]["advisory"] >= 1
    assert (
        summary["impact_counts"]["blocking"]
        + summary["impact_counts"]["render_only"]
        + summary["impact_counts"]["advisory"]
        == summary["independent_path_count"]
    )

    detail = client.get(
        f"/api/v1/projects/{project.id}/invalidation-operations/{summary['operation_id']}"
    )
    assert detail.status_code == 200
    groups = {
        (item["affected_artifact_id"], item["affected_version_id"]): item
        for item in detail.json()["data"]["affected_versions"]
    }
    assert set(groups) == {
        (mid.version.artifact_id, mid.version.id),
        (leaf.version.artifact_id, leaf.version.id),
        (advisory_leaf.version.artifact_id, advisory_leaf.version.id),
        (left.version.artifact_id, left.version.id),
        (right.version.artifact_id, right.version.id),
        (sink.version.artifact_id, sink.version.id),
    }

    mid_group = groups[(mid.version.artifact_id, mid.version.id)]
    assert mid_group["strongest_effective_impact"] == "blocking"
    assert mid_group["general_stale"] is True
    assert mid_group["general_blocked"] is True
    assert mid_group["render_blocked"] is True

    leaf_group = groups[(leaf.version.artifact_id, leaf.version.id)]
    assert leaf_group["paths"][0]["path_impacts"] == ["render_only", "blocking"]
    assert leaf_group["strongest_effective_impact"] == "render_only"
    assert leaf_group["general_stale"] is False
    assert leaf_group["general_blocked"] is False
    assert leaf_group["render_blocked"] is True

    advisory_group = groups[(advisory_leaf.version.artifact_id, advisory_leaf.version.id)]
    assert advisory_group["strongest_effective_impact"] == "advisory"
    assert advisory_group["general_stale"] is False
    assert advisory_group["general_blocked"] is False
    assert advisory_group["render_blocked"] is False

    sink_group = groups[(sink.version.artifact_id, sink.version.id)]
    assert len(sink_group["paths"]) == 2
    assert {path["effective_impact"] for path in sink_group["paths"]} == {"blocking", "advisory"}
    assert sink_group["strongest_effective_impact"] == "blocking"
    assert sink_group["general_stale"] is True
    assert sink_group["general_blocked"] is True
    assert sink_group["render_blocked"] is True
    # Advisory path is retained even though blocking wins.
    assert any(path["effective_impact"] == "advisory" for path in sink_group["paths"])


def test_multiple_paths_and_distinct_versions_of_same_artifact(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    left = accept_custom(
        repository,
        project,
        "left",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    right = accept_custom(
        repository,
        project,
        "right",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="references",
                impact="advisory",
            ),
        ),
    )
    # Two exact versions of the same artifact type share the artifact_id after force-accept
    # of sequential versions is not automatic; create two distinct artifact types first then
    # pin both paths into a shared sink artifact with two historical versions.
    sink_v1 = create_version(
        repository,
        project,
        "sink",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=left.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
            ArtifactDependencyDraft(
                upstream_version_id=right.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
        change_summary="sink-v1",
    )
    force_accept(repository, project, "sink", sink_v1.version.id)
    head = repository.get_artifact_head(project.id, "sink")
    sink_v2 = create_version(
        repository,
        project,
        "sink",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=left.version.id,
                relationship="derived_from",
                impact="render_only",
            ),
        ),
        parent_version_id=sink_v1.version.id,
        expected_revision=head.revision,
        change_summary="sink-v2",
    )
    force_accept(repository, project, "sink", sink_v2.version.id)

    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    client = client_for(repository)
    operation_id = client.get(f"/api/v1/projects/{project.id}/invalidation-operations").json()[
        "data"
    ]["operations"][0]["operation_id"]
    detail = client.get(
        f"/api/v1/projects/{project.id}/invalidation-operations/{operation_id}"
    ).json()["data"]

    sink_groups = [
        group
        for group in detail["affected_versions"]
        if group["affected_artifact_id"] == sink_v1.version.artifact_id
    ]
    assert {group["affected_version_id"] for group in sink_groups} == {
        sink_v1.version.id,
        sink_v2.version.id,
    }
    by_version = {group["affected_version_id"]: group for group in sink_groups}
    assert len(by_version[sink_v1.version.id]["paths"]) == 2
    assert by_version[sink_v1.version.id]["strongest_effective_impact"] == "blocking"
    assert len(by_version[sink_v2.version.id]["paths"]) == 1
    assert by_version[sink_v2.version.id]["strongest_effective_impact"] == "render_only"
    assert by_version[sink_v2.version.id]["render_blocked"] is True
    assert by_version[sink_v2.version.id]["general_stale"] is False


def test_list_and_detail_ordering_is_deterministic(tmp_path: Path) -> None:
    clock = MutableClock()
    repository = create_repository(tmp_path / "workspace.db", clock=clock)
    project = create_project(repository)
    root_v1 = create_and_approve_manifest(repository, project, change_summary="root-v1")
    # Insert reverse dependents in reverse creation order to prove report sorting.
    leaf_b = accept_custom(
        repository,
        project,
        "leaf_b",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="advisory",
            ),
        ),
    )
    leaf_a = accept_custom(
        repository,
        project,
        "leaf_a",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_v1.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    root_v2 = create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root_v1,
        change_summary="root-v2",
    )
    clock.advance(timedelta(minutes=1))
    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v3"}],
        parent=root_v2,
        change_summary="root-v3",
    )
    client = client_for(repository)

    first_list = client.get(f"/api/v1/projects/{project.id}/invalidation-operations").json()
    second_list = client.get(f"/api/v1/projects/{project.id}/invalidation-operations").json()
    assert first_list["data"]["operations"] == second_list["data"]["operations"]
    assert len(first_list["data"]["operations"]) == 2
    assert (
        first_list["data"]["operations"][0]["created_at"]
        < first_list["data"]["operations"][1]["created_at"]
    )
    assert first_list["data"]["operations"][0]["old_accepted_version_id"] == root_v1.version.id
    assert first_list["data"]["operations"][0]["new_accepted_version_id"] == root_v2.version.id

    operation_id = first_list["data"]["operations"][0]["operation_id"]
    detail_a = client.get(
        f"/api/v1/projects/{project.id}/invalidation-operations/{operation_id}"
    ).json()["data"]
    detail_b = client.get(
        f"/api/v1/projects/{project.id}/invalidation-operations/{operation_id}"
    ).json()["data"]
    assert detail_a == detail_b
    group_keys = [
        (group["affected_artifact_id"], group["affected_version_id"])
        for group in detail_a["affected_versions"]
    ]
    assert group_keys == sorted(group_keys)
    for group in detail_a["affected_versions"]:
        ordinals = [path["path_ordinal"] for path in group["paths"]]
        assert ordinals == sorted(ordinals)
    assert {group["affected_version_id"] for group in detail_a["affected_versions"]} == {
        leaf_a.version.id,
        leaf_b.version.id,
    }


def test_unknown_project_operation_and_cross_project_errors(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project_a = create_project(repository, "项目甲")
    project_b = create_project(repository, "项目乙")
    old_a = create_and_approve_manifest(repository, project_a, change_summary="a-v1")
    create_and_approve_manifest(
        repository,
        project_a,
        documents=[{"source_document_id": "src_a_v2"}],
        parent=old_a,
        change_summary="a-v2",
    )
    old_b = create_and_approve_manifest(repository, project_b, change_summary="b-v1")
    create_and_approve_manifest(
        repository,
        project_b,
        documents=[{"source_document_id": "src_b_v2"}],
        parent=old_b,
        change_summary="b-v2",
    )
    client = client_for(repository)
    op_a = client.get(f"/api/v1/projects/{project_a.id}/invalidation-operations").json()["data"][
        "operations"
    ][0]["operation_id"]
    op_b = client.get(f"/api/v1/projects/{project_b.id}/invalidation-operations").json()["data"][
        "operations"
    ][0]["operation_id"]

    missing_project = client.get(f"/api/v1/projects/prj_{'f' * 32}/invalidation-operations")
    assert missing_project.status_code == 404
    assert missing_project.json()["error"]["code"] == "PROJECT_NOT_FOUND"

    unknown_op = client.get(
        f"/api/v1/projects/{project_a.id}/invalidation-operations/invop_{'a' * 32}"
    )
    assert unknown_op.status_code == 404
    assert unknown_op.json()["error"]["code"] == "INVALIDATION_OPERATION_NOT_FOUND"
    assert op_b not in unknown_op.text

    cross_project = client.get(f"/api/v1/projects/{project_a.id}/invalidation-operations/{op_b}")
    assert cross_project.status_code == 404
    assert cross_project.json()["error"]["code"] == "INVALIDATION_OPERATION_NOT_FOUND"
    assert cross_project.json()["error"]["details"] == {}
    assert cross_project.json()["error"]["message"] == (
        "The requested invalidation operation was not found"
    )
    # Stable not-found only; do not return project B's operation payload.
    assert "affected_versions" not in cross_project.text
    assert "changed_artifact_id" not in cross_project.text
    assert op_a != op_b


def test_corrupt_ledger_path_json_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    old = create_and_approve_manifest(repository, project, change_summary="v1")
    accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=old.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_v2"}],
        parent=old,
        change_summary="v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        # Keep json_valid CHECK satisfied while violating string-array shape.
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET dependency_path_json = '[1,2,3]'
            WHERE operation_id = ?
            """,
            (operation.id,),
        )
        connection.commit()

    client = client_for(repository)
    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    assert listed.status_code == 409
    assert listed.json()["error"]["code"] == "INVALIDATION_LEDGER_CORRUPT"
    assert listed.json()["error"]["message"] == (
        "The invalidation ledger data is corrupt or inconsistent"
    )
    assert "sqlite" not in listed.text.lower()
    assert "Traceback" not in listed.text

    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    assert detail.status_code == 409
    assert detail.json()["error"]["code"] == "INVALIDATION_LEDGER_CORRUPT"
    assert "Traceback" not in detail.text


def test_corrupt_effective_impact_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    old = create_and_approve_manifest(repository, project, change_summary="v1")
    accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=old.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_v2"}],
        parent=old,
        change_summary="v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        # Keep CHECK-valid enum but make it disagree with path_impacts algebra.
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET effective_impact = 'advisory'
            WHERE operation_id = ?
            """,
            (operation.id,),
        )
        connection.commit()

    client = client_for(repository)
    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    assert detail.status_code == 409
    assert detail.json()["error"]["code"] == "INVALIDATION_LEDGER_CORRUPT"


def test_missing_or_invalid_bearer_token_is_rejected() -> None:
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    client = TestClient(
        create_app(sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50101),
    )
    project_id = f"prj_{'1' * 32}"
    headers = {"Origin": ORIGIN, "Host": HOST}

    missing = client.get(
        f"/api/v1/projects/{project_id}/invalidation-operations",
        headers=headers,
    )
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "SIDECAR_AUTH_REQUIRED"
    assert TOKEN not in missing.text

    wrong = client.get(
        f"/api/v1/projects/{project_id}/invalidation-operations",
        headers={**headers, "Authorization": "Bearer wrong-token"},
    )
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "SIDECAR_AUTH_REQUIRED"

    detail = client.get(
        f"/api/v1/projects/{project_id}/invalidation-operations/invop_{'2' * 32}",
        headers={**headers, "Authorization": "Bearer wrong-token"},
    )
    assert detail.status_code == 401
    assert detail.json()["error"]["code"] == "SIDECAR_AUTH_REQUIRED"


def test_openapi_includes_invalidation_report_endpoints(tmp_path: Path) -> None:
    schema = create_app(repository=StudioRepository(tmp_path / "workspace.db")).openapi()
    list_path = "/api/v1/projects/{project_id}/invalidation-operations"
    detail_path = "/api/v1/projects/{project_id}/invalidation-operations/{operation_id}"

    assert schema["paths"][list_path]["get"]["operationId"] == "listProjectInvalidationOperations"
    assert schema["paths"][detail_path]["get"]["operationId"] == "getProjectInvalidationOperation"
    components = schema["components"]["schemas"]
    for name in (
        "InvalidationOperationListResponse",
        "InvalidationOperationDetailResponse",
        "InvalidationOperationSummaryData",
        "InvalidationAffectedVersionData",
        "InvalidationPathImpactData",
        "InvalidationImpactCountsData",
    ):
        assert name in components


def test_cross_project_affected_pair_fails_closed_without_identity_leakage(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project_a = create_project(repository, "项目甲")
    project_b = create_project(repository, "项目乙")
    _old, _leaf, operation, impacts = _seed_direct_impact_operation(repository, project_a)
    foreign = accept_custom(repository, project_b, "foreign_leaf")
    impact = impacts[0]

    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET affected_artifact_id = ?, affected_version_id = ?
            WHERE impact_id = ?
            """,
            (foreign.version.artifact_id, foreign.version.id, impact.id),
        )
        connection.commit()

    client = client_for(repository)
    listed = client.get(f"/api/v1/projects/{project_a.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project_a.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)
    assert foreign.version.artifact_id not in listed.text
    assert foreign.version.id not in listed.text
    assert foreign.version.artifact_id not in detail.text
    assert foreign.version.id not in detail.text


def test_cross_artifact_same_project_affected_ownership_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    _old, _leaf, operation, impacts = _seed_direct_impact_operation(repository, project)
    other = accept_custom(repository, project, "other_leaf")
    impact = impacts[0]

    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET affected_artifact_id = ?, affected_version_id = ?
            WHERE impact_id = ?
            """,
            (other.version.artifact_id, other.version.id, impact.id),
        )
        connection.commit()

    client = client_for(repository)
    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)
    assert other.version.artifact_id not in listed.text
    assert other.version.id not in listed.text
    assert other.version.artifact_id not in detail.text
    assert other.version.id not in detail.text


def test_corrupt_operation_changed_artifact_version_ownership_fails_closed(
    tmp_path: Path,
) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    project_b = create_project(repository, "项目乙")
    _old, _leaf, operation, _impacts = _seed_direct_impact_operation(repository, project)
    foreign = accept_custom(repository, project_b, "foreign_root")
    foreign_v2 = create_version(
        repository,
        project_b,
        "foreign_root",
        parent_version_id=foreign.version.id,
        expected_revision=repository.get_artifact_head(project_b.id, "foreign_root").revision,
        change_summary="foreign-v2",
    )
    force_accept(repository, project_b, "foreign_root", foreign_v2.version.id)
    client = client_for(repository)

    with sqlite3.connect(repository.database_path) as connection:
        _drop_operation_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_operations
            SET changed_artifact_id = ?,
                old_accepted_version_id = ?,
                new_accepted_version_id = ?
            WHERE operation_id = ?
            """,
            (
                foreign.version.artifact_id,
                foreign.version.id,
                foreign_v2.version.id,
                operation.id,
            ),
        )
        connection.commit()

    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)
    assert foreign.version.artifact_id not in listed.text
    assert foreign.version.id not in listed.text
    assert foreign_v2.version.id not in listed.text
    assert foreign.version.artifact_id not in detail.text
    assert foreign.version.id not in detail.text
    assert foreign_v2.version.id not in detail.text

    repository_same = create_repository(tmp_path / "workspace-same.db")
    project_same = create_project(repository_same)
    _old_same, _leaf_same, operation_same, _impacts_same = _seed_direct_impact_operation(
        repository_same, project_same
    )
    other = accept_custom(repository_same, project_same, "other_changed")
    other_v2 = create_version(
        repository_same,
        project_same,
        "other_changed",
        parent_version_id=other.version.id,
        expected_revision=repository_same.get_artifact_head(
            project_same.id, "other_changed"
        ).revision,
        change_summary="other-v2",
    )
    force_accept(repository_same, project_same, "other_changed", other_v2.version.id)
    with sqlite3.connect(repository_same.database_path) as connection:
        _drop_operation_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_operations
            SET changed_artifact_id = ?,
                old_accepted_version_id = ?,
                new_accepted_version_id = ?
            WHERE operation_id = ?
            """,
            (
                other.version.artifact_id,
                other.version.id,
                other_v2.version.id,
                operation_same.id,
            ),
        )
        connection.commit()

    client_same = client_for(repository_same)
    listed_same = client_same.get(f"/api/v1/projects/{project_same.id}/invalidation-operations")
    detail_same = client_same.get(
        f"/api/v1/projects/{project_same.id}/invalidation-operations/{operation_same.id}"
    )
    _assert_ledger_corrupt(listed_same)
    _assert_ledger_corrupt(detail_same)


def test_corrupt_gate_decision_ownership_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project_a = create_project(repository, "项目甲")
    project_b = create_project(repository, "项目乙")
    _old, _leaf, operation, _impacts = _seed_direct_impact_operation(repository, project_a)
    foreign_manifest = create_and_approve_manifest(
        repository,
        project_b,
        documents=[{"source_document_id": "src_foreign"}],
        change_summary="foreign-root",
    )
    with sqlite3.connect(repository.database_path) as connection:
        connection.row_factory = sqlite3.Row
        decision_row = connection.execute(
            """
            SELECT decision_id
            FROM gate_decisions
            WHERE artifact_id = ? AND version_id = ?
            """,
            (foreign_manifest.version.artifact_id, foreign_manifest.version.id),
        ).fetchone()
        assert decision_row is not None
        _drop_operation_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_operations
            SET gate_decision_id = ?
            WHERE operation_id = ?
            """,
            (str(decision_row["decision_id"]), operation.id),
        )
        connection.commit()

    client = client_for(repository)
    listed = client.get(f"/api/v1/projects/{project_a.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project_a.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)
    assert foreign_manifest.version.artifact_id not in listed.text
    assert foreign_manifest.version.id not in listed.text
    assert foreign_manifest.version.artifact_id not in detail.text
    assert foreign_manifest.version.id not in detail.text


def test_wrong_dependency_id_in_path_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    mid = accept_custom(
        repository,
        project,
        "mid",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    leaf = accept_custom(
        repository,
        project,
        "leaf",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=mid.version.id,
                relationship="derived_from",
                impact="render_only",
            ),
        ),
    )
    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    leaf_impact = next(
        impact for impact in impacts if impact.affected_version_id == leaf.version.id
    )
    mid_impact = next(impact for impact in impacts if impact.affected_version_id == mid.version.id)
    # Replace the first edge with another real dependency that does not continue the chain.
    wrong_path = (mid_impact.dependency_path[0], *leaf_impact.dependency_path[1:])

    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET dependency_path_json = ?
            WHERE impact_id = ?
            """,
            (json.dumps(list(wrong_path), separators=(",", ":")), leaf_impact.id),
        )
        connection.commit()

    client = client_for(repository)
    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)


def test_path_relationship_or_impact_metadata_mismatch_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    _old, _leaf, operation, impacts = _seed_direct_impact_operation(repository, project)
    impact = impacts[0]
    client = client_for(repository)

    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET path_relationships_json = ?
            WHERE impact_id = ?
            """,
            ('["mentions"]', impact.id),
        )
        connection.commit()

    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)

    repository_b = create_repository(tmp_path / "workspace-impact-meta.db")
    project_b = create_project(repository_b)
    _old_b, _leaf_b, operation_b, impacts_b = _seed_direct_impact_operation(repository_b, project_b)
    impact_b = impacts_b[0]
    with sqlite3.connect(repository_b.database_path) as connection:
        _drop_path_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET path_impacts_json = ?, effective_impact = ?
            WHERE impact_id = ?
            """,
            ('["advisory"]', "advisory", impact_b.id),
        )
        connection.commit()

    client_b = client_for(repository_b)
    listed_b = client_b.get(f"/api/v1/projects/{project_b.id}/invalidation-operations")
    detail_b = client_b.get(
        f"/api/v1/projects/{project_b.id}/invalidation-operations/{operation_b.id}"
    )
    _assert_ledger_corrupt(listed_b)
    _assert_ledger_corrupt(detail_b)


def test_ordinal_gap_or_reorder_fails_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    root = create_and_approve_manifest(repository, project, change_summary="root-v1")
    accept_custom(
        repository,
        project,
        "leaf_a",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    accept_custom(
        repository,
        project,
        "leaf_b",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root.version.id,
                relationship="derived_from",
                impact="advisory",
            ),
        ),
    )
    create_and_approve_manifest(
        repository,
        project,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root,
        change_summary="root-v2",
    )
    operation = repository.list_invalidation_operations(project.id)[0]
    impacts = repository.list_invalidation_path_impacts(
        project_id=project.id,
        operation_id=operation.id,
    )
    assert len(impacts) >= 2
    second = impacts[1]
    client = client_for(repository)

    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET path_ordinal = 2
            WHERE impact_id = ?
            """,
            (second.id,),
        )
        connection.commit()

    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)

    repository_b = create_repository(tmp_path / "workspace-reorder.db")
    project_b = create_project(repository_b)
    root_b = create_and_approve_manifest(repository_b, project_b, change_summary="root-v1")
    accept_custom(
        repository_b,
        project_b,
        "leaf_a",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_b.version.id,
                relationship="derived_from",
                impact="blocking",
            ),
        ),
    )
    accept_custom(
        repository_b,
        project_b,
        "leaf_b",
        dependencies=(
            ArtifactDependencyDraft(
                upstream_version_id=root_b.version.id,
                relationship="derived_from",
                impact="advisory",
            ),
        ),
    )
    create_and_approve_manifest(
        repository_b,
        project_b,
        documents=[{"source_document_id": "src_root_v2"}],
        parent=root_b,
        change_summary="root-v2",
    )
    operation_b = repository_b.list_invalidation_operations(project_b.id)[0]
    impacts_b = repository_b.list_invalidation_path_impacts(
        project_id=project_b.id,
        operation_id=operation_b.id,
    )
    first_b, second_b = impacts_b[0], impacts_b[1]
    with sqlite3.connect(repository_b.database_path) as connection:
        _drop_path_immutability(connection)
        # Swap contiguous ordinals so deterministic order no longer matches path_ordinal.
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET path_ordinal = 100
            WHERE impact_id = ?
            """,
            (first_b.id,),
        )
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET path_ordinal = 0
            WHERE impact_id = ?
            """,
            (second_b.id,),
        )
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET path_ordinal = 1
            WHERE impact_id = ?
            """,
            (first_b.id,),
        )
        connection.commit()

    client_b = client_for(repository_b)
    listed_b = client_b.get(f"/api/v1/projects/{project_b.id}/invalidation-operations")
    detail_b = client_b.get(
        f"/api/v1/projects/{project_b.id}/invalidation-operations/{operation_b.id}"
    )
    _assert_ledger_corrupt(listed_b)
    _assert_ledger_corrupt(detail_b)


def test_malformed_persisted_ids_or_timestamp_fail_closed(tmp_path: Path) -> None:
    repository = create_repository(tmp_path / "workspace.db")
    project = create_project(repository)
    _old, _leaf, operation, impacts = _seed_direct_impact_operation(repository, project)
    impact = impacts[0]
    client = client_for(repository)

    with sqlite3.connect(repository.database_path) as connection:
        _drop_path_immutability(connection)
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET impact_id = ?
            WHERE impact_id = ?
            """,
            ("not-an-impact-id", impact.id),
        )
        connection.commit()

    listed = client.get(f"/api/v1/projects/{project.id}/invalidation-operations")
    detail = client.get(f"/api/v1/projects/{project.id}/invalidation-operations/{operation.id}")
    _assert_ledger_corrupt(listed)
    _assert_ledger_corrupt(detail)

    repository_b = create_repository(tmp_path / "workspace-timestamp.db")
    project_b = create_project(repository_b)
    _old_b, _leaf_b, operation_b, _impacts_b = _seed_direct_impact_operation(
        repository_b, project_b
    )
    with sqlite3.connect(repository_b.database_path) as connection:
        _drop_operation_immutability(connection)
        connection.execute(
            """
            UPDATE invalidation_operations
            SET created_at = ?
            WHERE operation_id = ?
            """,
            ("not-a-timestamp", operation_b.id),
        )
        connection.commit()

    client_b = client_for(repository_b)
    listed_b = client_b.get(f"/api/v1/projects/{project_b.id}/invalidation-operations")
    detail_b = client_b.get(
        f"/api/v1/projects/{project_b.id}/invalidation-operations/{operation_b.id}"
    )
    _assert_ledger_corrupt(listed_b)
    _assert_ledger_corrupt(detail_b)

    repository_c = create_repository(tmp_path / "workspace-op-id.db")
    project_c = create_project(repository_c)
    _old_c, _leaf_c, operation_c, _impacts_c = _seed_direct_impact_operation(
        repository_c, project_c
    )
    with sqlite3.connect(repository_c.database_path) as connection:
        _drop_operation_immutability(connection)
        _drop_path_immutability(connection)
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            UPDATE invalidation_path_impacts
            SET operation_id = ?
            WHERE operation_id = ?
            """,
            ("bad-operation-id", operation_c.id),
        )
        connection.execute(
            """
            UPDATE invalidation_operations
            SET operation_id = ?
            WHERE operation_id = ?
            """,
            ("bad-operation-id", operation_c.id),
        )
        connection.commit()

    client_c = client_for(repository_c)
    listed_c = client_c.get(f"/api/v1/projects/{project_c.id}/invalidation-operations")
    _assert_ledger_corrupt(listed_c)
