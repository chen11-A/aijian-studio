"""Actual signed boundary refusals preserve byte ownership and durable attempt state."""

import base64
import hashlib
import json
from copy import deepcopy

import pytest
from aijian_api.generation_failure_store import GenerationFailureStore
from aijian_api.main import create_app
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from test_prepared_generation_recipe import registration
from test_prepared_generation_routes import post
from test_story_film import HOST, TOKEN, _byte_image, _project


def app_for(repo, *, raise_server_exceptions=True):
    return TestClient(
        create_app(repository=repo, sidecar_security=SidecarSecurity(TOKEN, HOST)),
        base_url=f"http://{HOST}",
        client=("127.0.0.1", 12345),
        raise_server_exceptions=raise_server_exceptions,
    )


def stage_payload():
    payload = registration(_byte_image("fixed-user-reference")).model_dump(exclude_none=True)
    payload["stages"] = [
        {
            "key": "frame",
            "kind": "shot-frame",
            "target_id": "shot",
            "origin": {"references": [], "prompt": "实际原始创作"},
            "target_keys": [payload["targets"][0]["key"]],
        }
    ]
    return payload


def assert_no_attempt(repo):
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM story_creation_failure_attempt").fetchone()[0]
            == 0
        )
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_failure_attempt").fetchone()[0] == 0
        )


@pytest.mark.parametrize(
    "gate,code",
    [
        ("parent-missing", "UNCONFIGURED"),
        ("parent-zero", "INPUT_FAILURE_LIMIT"),
        ("video-missing", "VIDEO_UNCONFIGURED"),
        ("video-zero", "VIDEO_INPUT_FAILURE_LIMIT"),
    ],
)
def test_real_image_gate_reports_the_exact_unconfigured_policy_without_reserving(
    tmp_path, gate, code
):
    repo, project = _project(tmp_path)
    if gate != "parent-missing":
        GenerationFailureStore(repo, scope="story_creation").configure(
            project,
            expected_revision=0,
            failure_limit=0 if gate == "parent-zero" else 1,
        )
    if gate != "video-missing":
        GenerationFailureStore(repo).configure(
            project,
            expected_revision=0,
            failure_limit=0 if gate == "video-zero" else 1,
        )
    with app_for(repo) as client:
        registered = post(client, project, "prepared-generation-executions", stage_payload())
        assert registered.status_code == 200
        execution = registered.json()["execution_id"]
        blocked = post(
            client,
            project,
            f"prepared-generation-executions/{execution}/image-dispatch",
            {
                "stage_key": "frame",
                "body_sha256": "b" * 64,
            },
        )
        assert blocked.status_code == 409 and blocked.json()["detail"] == code
    assert_no_attempt(repo)


@pytest.mark.parametrize(
    "change",
    [
        "provider",
        "no-shots",
        "duplicate-source",
        "undeclared-source",
        "remote-only",
        "unused-source",
        "huge-origin",
    ],
)
def test_signed_registration_refuses_incomplete_effective_inputs_before_any_execution_write(
    tmp_path, change
):
    repo, project = _project(tmp_path)
    payload = stage_payload()
    target = payload["targets"][0]
    if change == "provider":
        target["body"]["provider"] = "stub"
    elif change == "no-shots":
        target["body"]["shots"] = []
    elif change == "duplicate-source":
        target["sources"].append(deepcopy(target["sources"][0]))
    elif change == "undeclared-source":
        target["sources"] = []
    elif change == "remote-only":
        target["client_frame"]["references"] = ["https://unreadable.invalid/reference.png"]
        target["sources"] = [
            {"source": target["client_frame"]["references"][0], "sha256": "a" * 64}
        ]
    elif change == "unused-source":
        extra = _byte_image("unused-reference")
        target["sources"].append(
            {"source": extra, "sha256": hashlib.sha256(b"not-used").hexdigest()}
        )
    else:
        payload["stages"][0]["origin"]["prompt"] = "x" * (64 * 1024 + 1)
    with app_for(repo) as client:
        response = post(client, project, "prepared-generation-executions", payload)
        assert response.status_code == 409 and response.json()["detail"] == "INPUT_UNVERIFIABLE"
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM prepared_generation_execution").fetchone()[0]
            == 0
        )
    assert_no_attempt(repo)


def test_signed_private_account_and_stage_lifecycle_cannot_be_replayed_as_admission(tmp_path):
    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=2)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=2
    )
    payload = stage_payload()
    with app_for(repo) as client:
        invalid_account = post(
            client,
            project,
            "prepared-generation-executions",
            payload,
            extra_headers={"X-Aivora-Generation-Account": "invalid"},
        )
        assert (
            invalid_account.status_code == 403
            and invalid_account.json()["detail"] == "ACCOUNT_UNAVAILABLE"
        )
        registered = post(client, project, "prepared-generation-executions", payload)
        execution = registered.json()["execution_id"]
        prefix = f"prepared-generation-executions/{execution}"
        fact = {"stage_key": "frame", "body_sha256": "b" * 64}
        wrong_account = post(client, project, prefix + "/image-dispatch", fact, account="f" * 64)
        assert wrong_account.status_code == 409
        assert_no_attempt(repo)
        premature = post(
            client, project, prefix + "/image-observation", {**fact, "output_sha256": "c" * 64}
        )
        assert premature.status_code == 409
        assert_no_attempt(repo)
        sent = post(client, project, prefix + "/image-dispatch", fact)
        assert sent.status_code == 200
        repeated = post(client, project, prefix + "/image-dispatch", fact)
        assert repeated.status_code == 409
        observed = post(
            client, project, prefix + "/image-observation", {**fact, "output_sha256": None}
        )
        assert observed.status_code == 200
        assert (
            post(
                client, project, prefix + "/retire", {"target_key": None, "slot_index": None}
            ).status_code
            == 200
        )
        again = post(client, project, prefix + "/image-dispatch", fact)
        assert again.status_code == 409
    with repo._connection() as connection:
        attempts = connection.execute(
            "SELECT status FROM story_creation_failure_attempt"
        ).fetchall()
        assert [row[0] for row in attempts] == ["UNKNOWN"]
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_failure_attempt").fetchone()[0] == 0
        )


@pytest.mark.parametrize(
    "change", ["body-hash", "provider", "two-shots", "role", "target", "slot", "account"]
)
def test_real_arm_refuses_changed_wire_roles_and_execution_scope_without_reserving(
    tmp_path, change
):
    repo, project = _project(tmp_path)
    payload = stage_payload()
    image = _byte_image("actual-current-frame")
    from aijian_api.generation_dispatch_identity import story_reference_identity

    body = deepcopy(payload["targets"][0]["body"])
    body["shots"][0]["still"] = image
    if change == "provider":
        body["provider"] = "stub"
    if change == "two-shots":
        body["shots"].append(deepcopy(body["shots"][0]))
    wire = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    arm = {
        "target_key": payload["targets"][0]["key"],
        "slot_index": 0,
        "take_key": "actual-issued-queued-slot",
        "wire_body": wire,
        "body_sha256": hashlib.sha256(wire.encode()).hexdigest(),
        "sources": [
            {
                "role": "still",
                "index": 0,
                "source": image,
                "canonical_path": None,
                **story_reference_identity(image),
            }
        ],
    }
    if change == "body-hash":
        arm["body_sha256"] = "f" * 64
    elif change == "role":
        arm["sources"][0]["role"] = "reference"
    elif change == "target":
        arm["target_key"] = "different-native-target"
    elif change == "slot":
        arm["slot_index"] = 1
    with app_for(repo) as client:
        registered = post(client, project, "prepared-generation-executions", payload)
        execution = registered.json()["execution_id"]
        response = post(
            client,
            project,
            f"prepared-generation-executions/{execution}/video-arm",
            arm,
            **({"account": "f" * 64} if change == "account" else {}),
        )
        assert response.status_code == 409
    with repo._connection() as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM prepared_generation_video_arm").fetchone()[0]
            == 0
        )
    assert_no_attempt(repo)


def test_readable_silent_local_fallback_does_not_settle_unknown_or_publish_a_video_cache(
    tmp_path, monkeypatch
):
    from aijian_api.story_film import StoryFilmService
    from test_draft_export_runtime import fixture as media_fixture
    from test_draft_export_runtime import toolchain
    from test_story_creation_failure_budget import LostResponse
    from test_story_film import _allow_live

    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=1
    )
    _allow_live(monkeypatch, tmp_path / "status.log")
    image_root = tmp_path / "real-image-fixture"
    image_root.mkdir()
    media_fixture(image_root)
    image = (
        "data:image/png;base64,"
        + base64.b64encode((image_root / "owned-synthetic.png").read_bytes()).decode()
    )
    from aijian_api.generation_dispatch_identity import story_reference_identity

    payload = stage_payload()
    target = payload["targets"][0]
    target.pop("client_frame")
    target["body"]["narration"] = "。"
    target["body"]["shots"][0].update(narration="。", still=image, duration_seconds=3)
    target["sources"] = [{"source": image, "sha256": story_reference_identity(image)["sha256"]}]
    payload["stages"] = []
    body = target["body"]
    wire = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    transport = LostResponse()
    instances = []

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, toolchain, transport=transport)
            instances.append(self)

    monkeypatch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
    with app_for(repo) as client:
        registered = post(client, project, "prepared-generation-executions", payload)
        assert registered.status_code == 200
        execution = registered.json()["execution_id"]
        arm = post(
            client,
            project,
            f"prepared-generation-executions/{execution}/video-arm",
            {
                "target_key": target["key"],
                "slot_index": 0,
                "take_key": "actual-native-slot",
                "wire_body": wire,
                "body_sha256": hashlib.sha256(wire.encode()).hexdigest(),
                "sources": [
                    {
                        "role": "still",
                        "index": 0,
                        "source": image,
                        "canonical_path": None,
                        **story_reference_identity(image),
                    }
                ],
            },
        )
        assert arm.status_code == 200
        result = post(client, project, "story-film", body, arm=arm.json()["arm_id"])
        assert result.status_code == 200
        assert result.json()["data"]["status"] == "SUCCEEDED"
        assert len(transport.requests) == 1
        assert transport.requests[0].method == "POST"
        assert transport.requests[0].url.endswith("/v1/videos/generations")
    assert len(instances) == 1
    service = instances[0]
    assert service._partial_note
    assert service._creation_cache(project, service._creation_request).bundle() is None
    with repo._connection() as connection:
        assert [
            row[0]
            for row in connection.execute("SELECT status FROM story_creation_failure_attempt")
        ] == ["UNKNOWN"]
        assert [
            row[0] for row in connection.execute("SELECT status FROM generation_failure_attempt")
        ] == ["UNKNOWN"]
        assert (
            connection.execute("SELECT COUNT(*) FROM generation_video_recovery").fetchone()[0] == 0
        )


@pytest.mark.parametrize(
    "change",
    [
        "unknown-arm",
        "body",
        "expired",
        "future",
        "retired",
        "unready",
        "runtime-proof",
        "source-proof",
        "intent-proof",
    ],
)
def test_actual_signed_consumer_refuses_late_invalid_arm_state_at_zero_transport(
    tmp_path, monkeypatch, change
):
    import time

    from aijian_api.generation_dispatch_identity import story_reference_identity
    from aijian_api.story_film import StoryFilmService
    from test_draft_export_runtime import toolchain
    from test_story_creation_failure_budget import LostResponse
    from test_story_film import _allow_live

    repo, project = _project(tmp_path)
    GenerationFailureStore(repo).configure(project, expected_revision=0, failure_limit=1)
    GenerationFailureStore(repo, scope="story_creation").configure(
        project, expected_revision=0, failure_limit=1
    )
    _allow_live(monkeypatch, tmp_path / "status.log")
    payload = stage_payload()
    image = _byte_image("immutable fixed reference")
    target = payload["targets"][0]
    target.pop("client_frame")
    target["body"]["shots"][0]["still"] = image
    target["sources"] = [{"source": image, "sha256": story_reference_identity(image)["sha256"]}]
    if change != "unready":
        payload["stages"] = []
    body = target["body"]
    wire = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    transport = LostResponse()

    class Consumer(StoryFilmService):
        def __init__(self, repository, tools):
            super().__init__(repository, toolchain, transport=transport)

    monkeypatch.setattr("aijian_api.story_film_routes.StoryFilmService", Consumer)
    with app_for(repo, raise_server_exceptions=change != "intent-proof") as client:
        registered = post(client, project, "prepared-generation-executions", payload)
        assert registered.status_code == 200
        execution = registered.json()["execution_id"]
        armed = post(
            client,
            project,
            f"prepared-generation-executions/{execution}/video-arm",
            {
                "target_key": target["key"],
                "slot_index": 0,
                "take_key": "actual-native-slot",
                "wire_body": wire,
                "body_sha256": hashlib.sha256(wire.encode()).hexdigest(),
                "sources": [
                    {
                        "role": "still",
                        "index": 0,
                        "source": image,
                        "canonical_path": None,
                        **story_reference_identity(image),
                    }
                ],
            },
        )
        assert armed.status_code == 200
        arm = armed.json()["arm_id"]
        if change == "unknown-arm":
            arm = "f" * 32
        elif change == "body":
            body["narration"] += "用户在arm之后真实改了正文。"
        elif change == "retired":
            assert (
                post(
                    client,
                    project,
                    f"prepared-generation-executions/{execution}/retire",
                    {"target_key": None, "slot_index": None},
                ).status_code
                == 200
            )
        elif change in {"expired", "future", "runtime-proof", "source-proof", "intent-proof"}:
            with repo._connection() as connection:
                if change in {"expired", "future"}:
                    clock = 0 if change == "expired" else int(time.time()) + 1200
                    connection.execute(
                        "UPDATE prepared_generation_video_arm SET created_at=? WHERE id=?",
                        (clock, arm),
                    )
                elif change == "runtime-proof":
                    connection.execute(
                        "UPDATE prepared_generation_video_arm "
                        "SET runtime_recipe_json='[]' WHERE id=?",
                        (arm,),
                    )
                elif change == "source-proof":
                    connection.execute(
                        "UPDATE prepared_generation_video_arm "
                        "SET runtime_sources_json='null' WHERE id=?",
                        (arm,),
                    )
                else:
                    connection.execute(
                        "UPDATE prepared_generation_target SET original_recipe_json='[]' "
                        "WHERE execution_id=?",
                        (execution,),
                    )
                connection.commit()
        response = post(client, project, "story-film", body, arm=arm)
        if change == "intent-proof":
            # Existing malformed durable-cache proof propagates an internal error.
            # Assert its real HTTP boundary exactly; do not relabel it a saved result.
            assert response.status_code == 500
            assert response.text == "Internal Server Error"
        else:
            assert response.status_code == 200
            assert response.json()["data"]["status"] in {"BLOCKED", "FAILED"}
            assert response.json()["data"]["user_message"]["code"] == "CREATION_INPUT_UNVERIFIABLE"
    assert transport.requests == []
    assert_no_attempt(repo)
