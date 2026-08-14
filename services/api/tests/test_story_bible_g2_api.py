import sqlite3
from datetime import timedelta
from pathlib import Path

import pytest
from aijian_api.ingestion import ingest_text_file
from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from test_review_repository import (
    MutableClock,
    approve_artifact,
    create_review_repository,
    create_reviewable_artifact,
)
from test_story_bible import fact_base, identifier, valid_story_bible_payload
from test_story_bible_api import create_imported_source, story_draft_request

TOKEN = "g" * 43
HOST = "127.0.0.1:43124"
ORIGIN = "app://aijian"

G2_UNTRUSTED_FIELDS = {
    "actor_id": "renderer",
    "roles": ["producer"],
    "capabilities": ["decide"],
    "self_review": False,
    "report_hash": "sha256:" + "a" * 64,
    "review_evidence_revision": 0,
    "accepted_version_id": "ver_" + "1" * 32,
}


def protected_client(repository: StudioRepository) -> TestClient:
    security = SidecarSecurity(token=TOKEN, host=HOST, origin=ORIGIN)
    test_client = TestClient(
        create_app(repository=repository, sidecar_security=security),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 50101),
    )
    test_client.headers.update(
        {
            "Authorization": f"Bearer {TOKEN}",
            "Origin": ORIGIN,
        }
    )
    return test_client


def confirmation_payload(prepared_response) -> dict[str, str]:
    prepared = prepared_response.json()["data"]
    return {
        "challenge_id": prepared["challenge"]["id"],
        "confirmation_token": prepared["confirmation_token"],
    }


def g2_base(project_id: str, version_id: str) -> str:
    return f"/api/v1/internal/projects/{project_id}/story-bible/versions/{version_id}"


def review_row_counts(database: Path, version_id: str) -> tuple[int, int, int]:
    with sqlite3.connect(database) as connection:
        submissions = connection.execute(
            "SELECT COUNT(*) FROM review_submissions WHERE version_id = ?",
            (version_id,),
        ).fetchone()[0]
        signoffs = connection.execute(
            "SELECT COUNT(*) FROM role_signoffs WHERE version_id = ?",
            (version_id,),
        ).fetchone()[0]
        decisions = connection.execute(
            "SELECT COUNT(*) FROM gate_decisions WHERE version_id = ?",
            (version_id,),
        ).fetchone()[0]
    return int(submissions), int(signoffs), int(decisions)


def challenge_consumed(database: Path, challenge_id: str) -> bool:
    with sqlite3.connect(database) as connection:
        row = connection.execute(
            "SELECT consumed_at FROM confirmation_challenges WHERE challenge_id = ?",
            (challenge_id,),
        ).fetchone()
    return row is not None and row[0] is not None


def create_story_bible_via_api(
    client: TestClient,
    repository: StudioRepository,
) -> tuple[str, str, str, str]:
    project, source, manifest = create_imported_source(repository, approve=True)
    created = client.post(
        f"/api/v1/projects/{project.id}/story-bible/versions",
        json=story_draft_request(source, manifest),
    )
    assert created.status_code == 201
    version_id = created.json()["data"]["version"]["id"]
    return (
        project.id,
        version_id,
        created.headers["etag"],
        created.json()["data"]["version"]["content_hash"],
    )


def advance_accepted_g1(repository: StudioRepository, project_id: str):
    project = repository.get_project(project_id)
    repository.import_source(
        project_id,
        ingest_text_file(filename="第二章.txt", content="第二章\n旧站重逢".encode()),
    )
    latest = repository.get_latest_artifact(project_id, "source_manifest")
    return approve_artifact(repository, project, latest, "source_manifest")


def test_internal_g2_routes_absent_without_sidecar_and_authenticated_when_enabled(
    tmp_path: Path,
) -> None:
    unprotected_repository = StudioRepository(tmp_path / "unprotected.db")
    unprotected = TestClient(create_app(repository=unprotected_repository))
    schema = create_app(repository=StudioRepository(tmp_path / "schema.db")).openapi()
    serialized_schema = str(schema)

    missing = unprotected.post(
        "/api/v1/internal/projects/prj_missing/story-bible/versions/ver_missing:prepare-submit",
        json={},
    )
    assert missing.status_code == 404
    assert all("/api/v1/internal/" not in path for path in schema["paths"])
    assert "prepare-submit" not in serialized_schema
    assert "confirmation_token" not in serialized_schema

    repository = StudioRepository(tmp_path / "protected.db")
    client = protected_client(repository)
    project_id, version_id, etag, _hash = create_story_bible_via_api(client, repository)
    path = f"{g2_base(project_id, version_id)}:prepare-submit"

    unauthenticated = client.post(
        path,
        headers={"Authorization": "", "If-Match": etag},
        json={},
    )
    wrong_origin = client.post(
        path,
        headers={"Origin": "http://127.0.0.1:5173", "If-Match": etag},
        json={},
    )
    prepared = client.post(path, headers={"If-Match": etag}, json={})

    assert unauthenticated.status_code == 401
    assert "confirmation_token" not in unauthenticated.text
    assert wrong_origin.status_code == 403
    assert "confirmation_token" not in wrong_origin.text
    assert prepared.status_code == 200
    assert prepared.json()["data"]["report"]["gate"] == "G2"
    assert prepared.json()["data"]["report"]["policy_code"] == "g2.story-bible"


@pytest.mark.parametrize(
    ("project_id", "version_id"),
    [
        ("project", "ver_" + "1" * 32),
        ("prj_" + "1" * 32, "version"),
    ],
)
def test_g2_route_rejects_malformed_resource_ids(
    tmp_path: Path,
    project_id: str,
    version_id: str,
) -> None:
    client = protected_client(StudioRepository(tmp_path / "workspace.db"))

    response = client.post(
        f"{g2_base(project_id, version_id)}:prepare-submit",
        headers={"If-Match": '"revision-1"'},
        json={},
    )

    assert response.status_code == 422


@pytest.mark.parametrize(
    "path_suffix",
    [
        ":prepare-submit",
        ":submit",
        ":prepare-signoff",
        "/signoffs",
        ":prepare-decision",
        "/decisions",
    ],
)
def test_g2_rejects_untrusted_actor_and_capability_fields(
    tmp_path: Path,
    path_suffix: str,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    client = protected_client(repository)
    project_id, version_id, etag, _hash = create_story_bible_via_api(client, repository)
    body: dict[str, object] = {**G2_UNTRUSTED_FIELDS}
    if path_suffix in {":submit", "/signoffs"}:
        body.update(
            {
                "challenge_id": "chg_" + "1" * 32,
                "confirmation_token": "one-time-native-confirmation-token",
            }
        )
    elif path_suffix == ":prepare-decision":
        body.update(
            {
                "decision": "approved",
                "rationale": "来源连续性已确认",
                "readiness_report_id": "rpt_" + "1" * 32,
            }
        )
    elif path_suffix == "/decisions":
        body.update(
            {
                "challenge_id": "chg_" + "1" * 32,
                "confirmation_token": "one-time-native-confirmation-token",
                "decision": "approved",
                "rationale": "来源连续性已确认",
            }
        )

    response = client.post(
        f"{g2_base(project_id, version_id)}{path_suffix}",
        headers={"If-Match": etag},
        json=body,
    )

    assert response.status_code == 422
    assert "renderer" not in response.text
    assert review_row_counts(repository.database_path, version_id) == (0, 0, 0)


def test_g2_complete_approval_path_writes_one_submission_three_signoffs_and_one_decision(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    client = protected_client(repository)
    project_id, version_id, etag, content_hash = create_story_bible_via_api(client, repository)
    base = g2_base(project_id, version_id)
    g1_before = repository.get_artifact_head(project_id, "source_manifest")

    prepared_submit = client.post(
        f"{base}:prepare-submit",
        headers={"If-Match": etag},
        json={},
    )
    assert prepared_submit.status_code == 200
    assert prepared_submit.headers["etag"] == '"revision-1"'
    assert prepared_submit.json()["data"]["report"]["gate"] == "G2"

    submitted = client.post(
        f"{base}:submit",
        headers={"If-Match": etag},
        json=confirmation_payload(prepared_submit),
    )
    assert submitted.status_code == 200
    assert submitted.headers["etag"] == '"revision-2"'
    assert submitted.json()["data"]["head"]["review_version_id"] == version_id
    assert submitted.json()["data"]["head"]["accepted_version_id"] is None

    prepared_signoff = client.post(
        f"{base}:prepare-signoff",
        headers={"If-Match": '"revision-2"'},
        json={},
    )
    assert prepared_signoff.status_code == 200
    assert prepared_signoff.headers["etag"] == '"revision-2"'
    signed = client.post(
        f"{base}/signoffs",
        headers={"If-Match": '"revision-2"'},
        json=confirmation_payload(prepared_signoff),
    )
    assert signed.status_code == 200
    assert signed.headers["etag"] == '"revision-3"'
    assert {signoff["role"] for signoff in signed.json()["data"]["signoffs"]} == {
        "writer",
        "continuity_reviewer",
        "producer",
    }
    assert len(signed.json()["data"]["signoffs"]) == 3

    rationale = "标题、人物与连续性基线均已人工确认"
    prepared_decision = client.post(
        f"{base}:prepare-decision",
        headers={"If-Match": '"revision-3"'},
        json={
            "decision": "approved",
            "rationale": rationale,
            "readiness_report_id": prepared_signoff.json()["data"]["report"]["id"],
        },
    )
    assert prepared_decision.status_code == 200
    assert prepared_decision.headers["etag"] == '"revision-3"'
    decided = client.post(
        f"{base}/decisions",
        headers={"If-Match": '"revision-3"'},
        json={
            **confirmation_payload(prepared_decision),
            "decision": "approved",
            "rationale": rationale,
        },
    )
    assert decided.status_code == 200
    assert decided.headers["etag"] == '"revision-4"'
    decision_data = decided.json()["data"]
    assert decision_data["head"]["accepted_version_id"] == version_id
    assert decision_data["head"]["review_version_id"] is None
    assert decision_data["decision"]["actor_id"] == "local-user"
    assert decision_data["decision"]["actor_role"] == "producer"
    assert decision_data["decision"]["gate"] == "G2"

    replayed = client.post(
        f"{base}/decisions",
        headers={"If-Match": '"revision-4"'},
        json={
            **confirmation_payload(prepared_decision),
            "decision": "approved",
            "rationale": rationale,
        },
    )
    assert replayed.status_code == 409
    assert replayed.json()["error"]["code"] == "REVIEW_INVALID"

    index = client.get(f"/api/v1/projects/{project_id}/story-bible")
    assert index.status_code == 200
    assert index.json()["data"]["accepted_version"]["id"] == version_id
    assert index.json()["data"]["review_version"] is None
    stored = repository.get_artifact_version(project_id, "story_bible", version_id)
    assert stored.version.content_hash == content_hash
    assert review_row_counts(repository.database_path, version_id) == (1, 3, 1)
    g1_after = repository.get_artifact_head(project_id, "source_manifest")
    assert g1_after.accepted_version_id == g1_before.accepted_version_id
    assert g1_after.revision == g1_before.revision


def test_g2_missing_and_stale_if_match_fail_without_writes(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    client = protected_client(repository)
    project_id, version_id, etag, _hash = create_story_bible_via_api(client, repository)
    path = f"{g2_base(project_id, version_id)}:prepare-submit"

    missing = client.post(path, json={})
    malformed = client.post(path, headers={"If-Match": "revision-1"}, json={})
    stale = client.post(path, headers={"If-Match": '"revision-9"'}, json={})

    assert missing.status_code == 428
    assert missing.json()["error"]["code"] == "PRECONDITION_REQUIRED"
    assert malformed.status_code == 412
    assert malformed.json()["error"]["code"] == "PRECONDITION_FAILED"
    assert stale.status_code == 412
    assert stale.json()["error"]["code"] == "PRECONDITION_FAILED"
    assert review_row_counts(repository.database_path, version_id) == (0, 0, 0)
    assert repository.get_artifact_head(project_id, "story_bible").revision == 1
    assert client.get(f"/api/v1/projects/{project_id}/story-bible").headers["etag"] == etag


def test_g2_replay_payload_mismatch_and_stale_report_fail_without_partial_writes(
    tmp_path: Path,
) -> None:
    clock = MutableClock()
    repository = create_review_repository(tmp_path / "workspace.db", clock)
    client = protected_client(repository)
    project_id, version_id, etag, _hash = create_story_bible_via_api(client, repository)
    base = g2_base(project_id, version_id)

    prepared_submit = client.post(
        f"{base}:prepare-submit",
        headers={"If-Match": etag},
        json={},
    )
    submitted = client.post(
        f"{base}:submit",
        headers={"If-Match": etag},
        json=confirmation_payload(prepared_submit),
    )
    assert submitted.status_code == 200
    replayed_submit = client.post(
        f"{base}:submit",
        headers={"If-Match": '"revision-2"'},
        json=confirmation_payload(prepared_submit),
    )
    assert replayed_submit.status_code == 409
    assert replayed_submit.json()["error"]["code"] == "REVIEW_INVALID"

    prepared_signoff = client.post(
        f"{base}:prepare-signoff",
        headers={"If-Match": '"revision-2"'},
        json={},
    )
    signed = client.post(
        f"{base}/signoffs",
        headers={"If-Match": '"revision-2"'},
        json=confirmation_payload(prepared_signoff),
    )
    assert signed.status_code == 200

    rationale = "连续性基线可用"
    mismatched = client.post(
        f"{base}/decisions",
        headers={"If-Match": '"revision-3"'},
        json={
            **confirmation_payload(prepared_signoff),
            "decision": "approved",
            "rationale": rationale,
        },
    )
    assert mismatched.status_code == 409
    assert mismatched.json()["error"]["code"] == "REVIEW_INVALID"
    assert review_row_counts(repository.database_path, version_id) == (1, 3, 0)
    assert repository.get_artifact_head(project_id, "story_bible").accepted_version_id is None

    clock.advance(timedelta(minutes=6))
    expired = client.post(
        f"{base}:prepare-decision",
        headers={"If-Match": '"revision-3"'},
        json={
            "decision": "approved",
            "rationale": rationale,
            "readiness_report_id": prepared_signoff.json()["data"]["report"]["id"],
        },
    )
    assert expired.status_code == 409
    assert expired.json()["error"]["code"] == "REVIEW_INVALID"
    assert review_row_counts(repository.database_path, version_id) == (1, 3, 0)
    assert repository.get_artifact_head(project_id, "story_bible").revision == 3


def test_g2_stale_g1_dependency_cannot_prepare_or_act(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    client = protected_client(repository)
    project_id, version_id, etag, _hash = create_story_bible_via_api(client, repository)
    advance_accepted_g1(repository, project_id)
    story_head = repository.get_artifact_head(project_id, "story_bible")

    prepared = client.post(
        f"{g2_base(project_id, version_id)}:prepare-submit",
        headers={"If-Match": etag},
        json={},
    )
    submitted = client.post(
        f"{g2_base(project_id, version_id)}:submit",
        headers={"If-Match": etag},
        json={
            "challenge_id": "chg_" + "1" * 32,
            "confirmation_token": "one-time-native-confirmation-token",
        },
    )

    assert prepared.status_code == 409
    assert prepared.json()["error"]["code"] == "ARTIFACT_DEPENDENCY_INVALID"
    assert submitted.status_code == 409
    assert submitted.json()["error"]["code"] == "ARTIFACT_DEPENDENCY_INVALID"
    assert repository.get_artifact_head(project_id, "story_bible") == story_head
    assert review_row_counts(repository.database_path, version_id) == (0, 0, 0)


def test_g2_g1_advance_after_prepare_leaves_challenge_unconsumed_and_head_unchanged(
    tmp_path: Path,
) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    client = protected_client(repository)
    project_id, version_id, etag, _hash = create_story_bible_via_api(client, repository)
    prepared = client.post(
        f"{g2_base(project_id, version_id)}:prepare-submit",
        headers={"If-Match": etag},
        json={},
    )
    assert prepared.status_code == 200
    challenge_id = prepared.json()["data"]["challenge"]["id"]
    advance_accepted_g1(repository, project_id)
    story_head = repository.get_artifact_head(project_id, "story_bible")

    submitted = client.post(
        f"{g2_base(project_id, version_id)}:submit",
        headers={"If-Match": etag},
        json=confirmation_payload(prepared),
    )

    assert submitted.status_code == 409
    assert submitted.json()["error"]["code"] == "ARTIFACT_DEPENDENCY_INVALID"
    assert repository.get_artifact_head(project_id, "story_bible") == story_head
    assert challenge_consumed(repository.database_path, challenge_id) is False
    assert review_row_counts(repository.database_path, version_id) == (0, 0, 0)


def test_g2_api_readiness_rejects_canonical_blocking_story_content(tmp_path: Path) -> None:
    repository = StudioRepository(tmp_path / "workspace.db")
    client = protected_client(repository)
    blocking_question = valid_story_bible_payload()
    blocking_question["questions"] = [
        {
            "question_id": identifier("qst", "1"),
            "scope_type": "artifact",
            "scope_id": None,
            "question": "关键身份尚未确认",
            "severity": "blocking",
            "responsible_role": "writer",
            "blocking": True,
            "status": "open",
            "resolution": None,
        }
    ]
    unresolved_conflict = valid_story_bible_payload()
    unresolved_conflict["conflicts"] = [
        {
            "conflict_id": identifier("cfl", "1"),
            "conflict_type": "identity",
            "fact_ids": [identifier("fact", "1"), identifier("fact", "2")],
            "severity": "major",
            "responsible_role": "writer",
            "status": "unresolved",
            "resolution_reason": None,
            "resolution_fact_id": None,
        }
    ]
    unreviewed_inference = valid_story_bible_payload()
    unreviewed_inference["facts"].append(
        {
            **fact_base(
                identifier("fact", "4"),
                importance="supporting",
                origin="ai_inference",
                canon_status="proposed",
            ),
            "kind": "character_fact",
            "character_id": identifier("ent", "1"),
            "attribute": "推测职业",
            "value": "记者",
            "validity": None,
        }
    )

    for content in (blocking_question, unresolved_conflict, unreviewed_inference):
        _project, artifact = create_reviewable_artifact(repository, content=content)
        response = client.post(
            f"{g2_base(_project.id, artifact.version.id)}:prepare-submit",
            headers={"If-Match": f'"revision-{artifact.head.revision}"'},
            json={},
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "GATE_NOT_READY"
        assert repository.get_artifact_head(_project.id, "story_bible") == artifact.head
        assert review_row_counts(repository.database_path, artifact.version.id) == (0, 0, 0)
