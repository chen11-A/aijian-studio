"""Real SQLite/HTTP scope with explicitly synthetic non-decoding video probe evidence."""

import json
from pathlib import Path

import pytest
from aijian_api.episode_media_assembly_contracts import CreateEpisodeMediaAssemblyVersionRequest
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_preview_plan_routes import MediaPreviewPlanResponse
from test_audio_asset_probe import api_client
from test_media_execution_plan_boundaries import VERSION, assembly, probe
from test_probe_store_boundaries import persist

pytest_plugins = ["test_probe_store_boundaries"]


@pytest.fixture
def preview(selected):
    evidence = persist(selected)
    repository = selected.repository
    project, asset, asset_version = selected.args
    episode = repository.list_episodes(project)[0].id
    content = assembly().content.model_dump(mode="json")
    content.update(project_id=project, episode_id=episode)
    content["visual_segments"][0]["media"] = {
        "asset_id": asset,
        "asset_version_id": asset_version,
        "sha256": selected.version.sha256,
    }
    saved = EpisodeMediaAssemblyStore(repository).create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest.model_validate(
            {"content": content, "change_summary": "Synthetic native plan fixture"}
        ),
        author_actor_id="synthetic-user",
    )
    url = (
        f"/api/v1/projects/{project}/episodes/{episode}/media-assembly/versions/"
        f"{saved.version_id}/native-preview-plan"
    )
    return selected, episode, saved, evidence, url


def counts(repository):
    with repository._connection() as connection:
        names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        return {
            name: connection.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
            for name in names
        }


def test_exact_plan_is_read_only_without_tools_or_generation(preview):
    selected, episode, saved, evidence, url = preview
    client, headers = api_client(selected.repository, selected.tools)
    before = counts(selected.repository)
    with client:
        for _ in range(2):
            response = client.get(url, headers=headers)
            assert response.status_code == 200, response.text
            receipt = MediaPreviewPlanResponse.model_validate_json(response.content)
            assert response.headers["Cache-Control"] == "no-store"
            assert str(receipt.request_id) == response.headers["x-request-id"]
            source = receipt.data.plan.source
            assert (source.project_id, source.episode_id, source.assembly_version_id) == (
                selected.args[0],
                episode,
                saved.version_id,
            )
            assert source.assembly_content_hash == saved.content_hash
            assert (
                receipt.data.plan.video_tracks[0].clips[0].media.probe_sha256
                == evidence.probe_sha256
            )
            assert receipt.data.plan.scope == "DRAFT_PREVIEW"
    assert counts(selected.repository) == before
    assert selected.runner.call_count == 1  # Fixture wrote evidence; route never probes.


@pytest.mark.parametrize("foreign", ["project", "episode", "version"])
def test_plan_never_crosses_exact_scope(preview, foreign):
    selected, episode, saved, _evidence, url = preview
    project = selected.args[0]
    if foreign == "project":
        other = selected.repository.create_project(
            name="Other", aspect_ratio="9:16", target_duration_seconds=3, source_language="zh-CN"
        )
        url = url.replace(project, other.id)
    elif foreign == "episode":
        url = url.replace(episode, "ep_" + "e" * 32)
    else:
        url = url.replace(saved.version_id, "ver_" + "f" * 32)
    client, headers = api_client(selected.repository, selected.tools)
    with client:
        response = client.get(url, headers=headers)
        assert response.status_code == 404, response.text
        assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize(
    "fault", ["missing", "changed", "probe_hash", "assembly_hash", "restricted"]
)
def test_plan_fresh_checks_reject_file_hash_rights_and_corrupt_receipts(
    preview, fault, monkeypatch
):
    selected, _episode, saved, _evidence, url = preview
    repository = selected.repository
    if fault in {"missing", "changed"}:
        path = (
            repository.database_path.parent
            / "media-assets"
            / "blobs"
            / selected.version.sha256[:2]
            / selected.version.sha256
        )
        if fault == "missing":
            path.unlink()
        else:
            path.write_bytes(b"x" * selected.version.byte_size)
    elif fault == "restricted":
        MediaAssetRightsStore(repository).append_human_decision(
            *selected.args,
            HumanRightsDecisionInput(
                operation_id="rdop_" + "a" * 32,
                expected_revision=0,
                decision="RESTRICTED",
                basis_text="Synthetic refusal of this fixture only",
            ),
            actor_id="synthetic-user",
        )
    elif fault == "assembly_hash":
        # The immutable SQLite trigger is retained. Inject a corrupt reader result instead.
        monkeypatch.setattr(
            EpisodeMediaAssemblyStore,
            "read_version",
            lambda *_args, **_kwargs: saved.model_copy(
                update={"content_hash": "sha256:" + "f" * 64}
            ),
        )
    else:
        from aijian_api.media_asset_probe_store import (
            MediaAssetProbeEvidenceError,
            MediaAssetProbeEvidenceStore,
        )

        def corrupt(*_args, **_kwargs):
            raise MediaAssetProbeEvidenceError(
                "PROBE_EVIDENCE_CORRUPT", "Synthetic controlled reader failure"
            )

        monkeypatch.setattr(MediaAssetProbeEvidenceStore, "read", corrupt)
    client, headers = api_client(repository, selected.tools)
    with client:
        response = client.get(url, headers=headers)
        assert response.status_code == 409, response.text
        assert response.headers["Cache-Control"] == "no-store"
        assert response.json()["error"]["retryable"] is False
    assert selected.runner.call_count == 1


def test_missing_probe_never_autoprobes(preview, monkeypatch):
    selected, _episode, _saved, _evidence, url = preview
    from aijian_api.media_asset_probe_store import MediaAssetProbeEvidenceStore

    monkeypatch.setattr(MediaAssetProbeEvidenceStore, "read", lambda *_args: None)
    client, headers = api_client(selected.repository, selected.tools)
    with client:
        assert client.get(url, headers=headers).status_code == 409
    assert selected.runner.call_count == 1


def test_plan_route_requires_sidecar_auth_and_is_absent_in_public_app(preview):
    selected, _episode, _saved, _evidence, url = preview
    client, headers = api_client(selected.repository, selected.tools)
    with client:
        assert client.get(url).status_code == 401
        assert client.post(url, headers=headers).status_code == 405
    public, _ = api_client(selected.repository, selected.tools, security=False)
    with public:
        assert public.get(url).status_code == 404


def test_fresh_storyboard_admission_receives_exact_saved_record_and_refuses_before_plan(
    preview, monkeypatch
):
    from aijian_api import media_preview_plan_routes
    from aijian_api.assembly_storyboard_provenance import AssemblyStoryboardReferenceError

    selected, episode, saved, _evidence, url = preview
    calls = []

    def denied(repository, connection, content, *, assembly_record, fresh):
        assert connection.execute("PRAGMA query_only").fetchone()[0] == 1
        calls.append((repository, content, assembly_record.version.id, fresh))
        raise AssemblyStoryboardReferenceError(
            "STORYBOARD_SOURCE_NOT_READY", "Controlled fresh admission refusal"
        )

    monkeypatch.setattr(media_preview_plan_routes, "validate_storyboard_provenance", denied)
    client, headers = api_client(selected.repository, selected.tools)
    before = counts(selected.repository)
    with client:
        response = client.get(url, headers=headers)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "STORYBOARD_SOURCE_NOT_READY"
    assert calls == [(selected.repository, saved.content, saved.version_id, True)]
    assert counts(selected.repository) == before
    assert selected.runner.call_count == 1


def test_canonical_shared_fixture_is_python_derived_and_not_engineering_test():
    from aijian_api.episode_media_execution_plan import build_assembly_execution_plan

    fixture = (
        Path(__file__).resolve().parents[3] / "packages/contracts/fixtures/native-preview-plan.json"
    )
    receipt = MediaPreviewPlanResponse.model_validate_json(fixture.read_bytes())
    plan = build_assembly_execution_plan(assembly(), {VERSION: probe()})
    assert receipt.data.plan == plan
    assert receipt.model_dump(mode="json") == json.loads(fixture.read_text())


def test_native_plan_refuses_new_environment_rights_without_tools_or_writes(preview, tmp_path):
    from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
    from aijian_api.episode_storyboard_store import EpisodeStoryboardStore
    from aijian_api.media_asset_store import MediaAssetStore
    from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
    from test_assembly_storyboard_provenance import linked_content, save
    from test_character_reference_assets import png
    from test_episode_storyboard import write
    from test_project_environment import environment
    from test_storyboard_environment import environment_board

    selected, episode, saved, _evidence, _url = preview
    repository, project = selected.repository, selected.args[0]
    image = MediaAssetStore(repository).import_local(project, png(tmp_path / "environment.png"))
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project,
        payload=environment(
            project, image.id, image.latest_version.id, image.latest_version.sha256
        ),
        idempotency_key="environment-library",
        actor_id="human",
    )
    board, _ = write(
        EpisodeStoryboardStore(repository),
        CreateEpisodeStoryboardVersionRequest.model_validate(
            environment_board(project, episode, library.version_id)
        ),
        "environment-board",
    )
    bound = save(repository, project, episode, saved, linked_content(saved, board))
    url = (
        f"/api/v1/projects/{project}/episodes/{episode}/media-assembly/versions/"
        f"{bound.version_id}/native-preview-plan"
    )
    client, headers = api_client(repository, selected.tools)
    with client:
        assert client.get(url, headers=headers).status_code == 200
        MediaAssetRightsStore(repository).append_human_decision(
            project,
            image.id,
            image.latest_version.id,
            HumanRightsDecisionInput(
                operation_id="rdop_" + "b" * 32,
                expected_revision=0,
                decision="RESTRICTED",
                basis_text="Current exact environment asset is restricted",
            ),
            actor_id="human",
        )
        before = counts(repository)
        response = client.get(url, headers=headers)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "STORYBOARD_REFERENCE_STALE"
        assert response.headers["Cache-Control"] == "no-store"
        assert counts(repository) == before
    assert selected.runner.call_count == 1
    assert (
        EpisodeMediaAssemblyStore(repository)
        .read_version(project, episode, version_id=bound.version_id)
        .content_hash
        == bound.content_hash
    )
