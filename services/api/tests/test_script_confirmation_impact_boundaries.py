"""Independent regressions on real temporary SQLite/ASGI; no provider/native.

These assert required behavior and initially reproduce regressions. All writes
are to pytest temporary databases; no protected triggers are removed or changed.
"""

import copy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from aijian_api.artifacts import canonical_content_hash
from aijian_api.script_confirmation_impact_store import (
    ScriptConfirmationImpactError,
    ScriptConfirmationImpactStore,
)
from test_assembly_script_provenance import confirm, revise, source_fixture
from test_assembly_storyboard_provenance import save
from test_script_confirmation_impacts import payload


def test_original_uppercase_uuid_read_recovers_the_exact_stored_key(tmp_path):
    from aijian_api.main import create_app
    from aijian_api.security import SidecarSecurity
    from fastapi.testclient import TestClient

    repo, p, e, _, script, _, _ = source_fixture(tmp_path, confirmed=False)
    operation = str(uuid4()).upper()
    original = payload(script)
    security = SidecarSecurity(token="z" * 43, host="127.0.0.1:43124", origin="app://aijian")
    headers = {"Authorization": "Bearer " + "z" * 43, "Origin": "app://aijian"}
    app = create_app(repository=repo, sidecar_security=security)
    with TestClient(app, base_url="http://127.0.0.1:43124", client=("127.0.0.1", 50101)) as client:
        posted = client.post(
            f"/api/v1/projects/{p}/episodes/{e}/script/confirmations",
            headers={**headers, "Idempotency-Key": operation},
            json=original.model_dump(mode="json"),
        )
        assert posted.status_code == 201, posted.text
        with repo._connection() as connection:
            assert connection.execute(
                "SELECT idempotency_key_hash FROM episode_script_confirmations"
            ).fetchone()[0] == canonical_content_hash({"value": operation})
        params = original.model_dump(mode="json")
        del params["confirm"]
        recovered = client.get(
            f"/api/v1/projects/{p}/episodes/{e}/script/confirmation-operations/{operation}",
            headers=headers,
            params=params,
        )
        print("uppercase POST", posted.status_code, "GET", recovered.status_code, recovered.json())
        assert recovered.status_code == 200
        assert (
            recovered.json()["data"]["lookup"]["confirmation"]["confirmation_id"]
            == (posted.json()["data"]["status"]["confirmation"]["confirmation_id"])
        )


def test_legacy_reference_only_action_block_does_not_block_confirm_replacement(tmp_path):
    repo, p, e, _, script, saved, first = source_fixture(tmp_path)
    value = saved.content.model_dump(mode="json")
    del value["script_provenance"]
    value["subtitle_segments"] = [
        {
            "segment_id": "seg_action_reference",
            "start_frame": 12,
            "end_frame": 36,
            "script_version_id": script.version_id,
            "script_block_id": "sblk_" + "c" * 32,
        }
    ]
    legacy = save(repo, p, e, saved, value)
    with repo._connection() as connection:
        assert (
            connection.execute(
                "SELECT count(*) FROM artifact_dependencies WHERE downstream_version_id=?",
                (legacy.version_id,),
            ).fetchone()[0]
            == 0
        )
    print("valid legacy ACTION reference stored", legacy.version_id)
    scenes = copy.deepcopy(script.content.model_dump(mode="json")["scenes"])
    scenes[0]["blocks"][0]["text"] = "Changed dialogue."
    newer = revise(repo, p, e, script, scenes=scenes)
    receipt = confirm(repo, p, e, newer)
    report = ScriptConfirmationImpactStore(repo).lookup(p, e, receipt.confirmation_id).report
    target = next(t for t in report.assessment.targets if t.version_id == legacy.version_id)
    assert target.classification == "ADVISORY_LEGACY_REVIEW"
    assert any(
        s.kind == "REFERENCE_SUBTITLE" and s.segment.script_block_id == "sblk_" + "c" * 32
        for s in target.context.segments
    )


def test_covered_receipt_missing_report_cannot_appear_as_empty_history(tmp_path):
    repo, p, e, _, script, _, _ = source_fixture(tmp_path, confirmed=False)
    operation, receipt_id = str(uuid4()), "esc_" + uuid4().hex
    original = payload(script)
    # Controlled orphan insertion: real checked schema/owner/current-source and
    # coverage triggers all stay enabled; no receipt/report UPDATE or DELETE.
    with repo._connection() as connection:
        artifact = connection.execute(
            "SELECT artifact_id FROM artifact_versions WHERE version_id=?", (script.version_id,)
        ).fetchone()[0]
        connection.execute(
            """INSERT INTO episode_script_confirmations
               (confirmation_id, project_id, episode_id, artifact_id, version_id,
                content_hash, head_revision, actor_id, idempotency_key_hash,
                request_hash, confirmed_at, impact_coverage_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (
                receipt_id,
                p,
                e,
                artifact,
                script.version_id,
                script.content_hash,
                script.head_revision,
                "local-user",
                canonical_content_hash({"value": operation}),
                canonical_content_hash(
                    {
                        "project_id": p,
                        "episode_id": e,
                        "actor_id": "local-user",
                        "payload": original.model_dump(mode="json"),
                    }
                ),
                datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            ),
        )
        connection.commit()
    store = ScriptConfirmationImpactStore(repo)
    with pytest.raises(ScriptConfirmationImpactError, match="missing"):
        store.lookup(p, e, receipt_id)
    with pytest.raises(ScriptConfirmationImpactError):
        store.list_page(p)
