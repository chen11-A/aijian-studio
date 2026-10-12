"""Exact DRAFT shot choices, no identity approval or generated media claim."""

from pathlib import Path

import pytest
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import (
    EpisodeStoryboardConflictError,
    EpisodeStoryboardInputError,
    EpisodeStoryboardStorageError,
    EpisodeStoryboardStore,
)
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.project_creative_library_store import ProjectCreativeLibraryStore
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_character_reference_assets import candidate, png
from test_episode_storyboard import payload, shot, write
from test_project_creative_library import make_project


def setup(tmp_path: Path):
    repository = StudioRepository(tmp_path / "studio.sqlite3")
    project = make_project(repository)
    episode = repository.list_episodes(project)[0].id
    image = MediaAssetStore(repository).import_local(project, png(tmp_path / "reference.png"))
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project,
        payload=candidate(project, image.id, image.latest_version.id, image.latest_version.sha256),
        idempotency_key="library",
        actor_id="human",
    )
    linked = shot()
    linked["character_ids"] = ["chr_" + "a" * 32]
    request = payload(project, episode, shots=[linked], library=library.version_id).model_dump(
        mode="json"
    )
    request["content"]["schema_version"] = "1.1.0"
    request["content"]["shots"][0]["character_bindings"] = [
        {
            "character_id": "chr_" + "a" * 32,
            "costume_id": "cst_" + "e" * 32,
            "reference_ids": ["crf_" + "f" * 32],
        }
    ]
    return repository, project, episode, library, request


def test_exact_shot_bindings_save_restart_replay_and_legacy_history(tmp_path: Path) -> None:
    repository, project, episode, library, value = setup(tmp_path)
    store = EpisodeStoryboardStore(repository)
    original, _ = write(
        store, payload(project, episode, shots=[], library=library.version_id), "legacy"
    )
    value["parent_version_id"] = original.version_id
    value["expected_revision"] = original.head_revision
    request = CreateEpisodeStoryboardVersionRequest.model_validate(value)
    saved, _ = write(store, request, "choices")
    reopened = EpisodeStoryboardStore(StudioRepository(repository.database_path))
    assert (
        reopened.get_version(
            project_id=project, episode_id=episode, version_id=saved.version_id
        ).content
        == request.content
    )
    historic = reopened.get_version(
        project_id=project, episode_id=episode, version_id=original.version_id
    )
    assert historic.content_hash == original.content_hash
    assert historic.content.schema_version == "1.0.0"
    replay, replayed = write(reopened, request, "choices")
    assert replayed and replay.version_id == saved.version_id
    with pytest.raises(EpisodeStoryboardConflictError):
        write(
            reopened,
            payload(project, episode, parent=saved.version_id, revision=saved.head_revision),
            "downgrade",
        )


@pytest.mark.parametrize(
    "change",
    [
        {"character_id": "chr_" + "c" * 32},
        {"costume_id": "cst_" + "0" * 32},
        {"costume_id": None},
        {"reference_ids": ["crf_" + "0" * 32]},
    ],
)
def test_invalid_choice_never_appends_and_does_not_change_library(
    tmp_path: Path, change: dict[str, object]
) -> None:
    repository, project, episode, library, value = setup(tmp_path)
    value["content"]["shots"][0]["character_bindings"][0].update(change)
    with pytest.raises((ValidationError, EpisodeStoryboardInputError)):
        request = CreateEpisodeStoryboardVersionRequest.model_validate(value)
        write(EpisodeStoryboardStore(repository), request)
    assert (
        ProjectCreativeLibraryStore(repository).get_latest(project_id=project).version_id
        == library.version_id
    )


def test_missing_reference_retains_historical_board_but_rejects_new_save(tmp_path: Path) -> None:
    repository, project, episode, library, value = setup(tmp_path)
    request = CreateEpisodeStoryboardVersionRequest.model_validate(value)
    store = EpisodeStoryboardStore(repository)
    saved, _ = write(store, request)
    ref = library.content.references[0]
    (tmp_path / "media-assets" / "blobs" / ref.asset_sha256[:2] / ref.asset_sha256).unlink()
    assert (
        store.get_version(
            project_id=project, episode_id=episode, version_id=saved.version_id
        ).content
        == request.content
    )
    replay, replayed = write(store, request)
    assert replayed and replay.version_id == saved.version_id
    fresh = request.model_copy(
        update={"parent_version_id": saved.version_id, "expected_revision": saved.head_revision}
    )
    with pytest.raises(EpisodeStoryboardInputError):
        write(store, fresh, "fresh")


def test_two_episodes_preserve_different_explicit_choices(tmp_path: Path) -> None:
    repository, project, episode, library, value = setup(tmp_path)
    second = repository.create_episode(project, title="第二集").id
    store = EpisodeStoryboardStore(repository)
    first, _ = write(store, CreateEpisodeStoryboardVersionRequest.model_validate(value))
    value["content"]["episode_id"] = second
    value["content"]["shots"][0]["character_bindings"] = []
    other, _ = write(store, CreateEpisodeStoryboardVersionRequest.model_validate(value))
    assert first.content.shots[0].character_bindings
    assert not other.content.shots[0].character_bindings
    assert store.get_latest(project_id=project, episode_id=episode).version_id == first.version_id
    assert store.get_latest(project_id=project, episode_id=second).version_id == other.version_id


def test_recomputed_hash_cannot_hide_an_orphan_binding(tmp_path: Path) -> None:
    import json
    import sqlite3

    from aijian_api.artifacts import canonical_content_hash

    repository, project, episode, _, value = setup(tmp_path)
    store = EpisodeStoryboardStore(repository)
    saved, _ = write(store, CreateEpisodeStoryboardVersionRequest.model_validate(value))
    tampered = saved.content.model_dump(mode="json")
    tampered["shots"][0]["character_bindings"][0]["reference_ids"] = ["crf_" + "0" * 32]
    with sqlite3.connect(repository.database_path) as connection:
        connection.execute("DROP TRIGGER artifact_versions_immutable_update")
        connection.execute(
            "UPDATE artifact_versions SET content_json = ?, content_hash = ? WHERE version_id = ?",
            (json.dumps(tampered), canonical_content_hash(tampered), saved.version_id),
        )
    with pytest.raises(EpisodeStoryboardStorageError):
        store.get_version(project_id=project, episode_id=episode, version_id=saved.version_id)


@pytest.mark.parametrize("official", [False, True])
@pytest.mark.parametrize("has_choices", [False, True])
def test_whole_storyboard_adoption_preserves_schema_or_explicitly_rejects_choice_loss(
    tmp_path: Path,
    official: bool,
    has_choices: bool,
) -> None:
    import json
    from uuid import uuid4

    from aijian_api.official_director_contracts import (
        CompleteOfficialDirectorRequest,
        PrepareOfficialDirectorRequest,
        ReserveOfficialDirectorRequest,
    )
    from aijian_api.official_director_store import OfficialDirectorError, OfficialDirectorStore
    from aijian_api.shot_plan_proposal_store import ShotPlanProposalStore
    from aijian_api.shot_plan_validation import ShotPlanError
    from test_official_director_workflow import adoption_request
    from test_shot_plan_proposals import accept
    from test_shot_plan_proposals import request as director_request
    from test_shot_plan_proposals import setup as director_setup

    repository, project, episode = director_setup(tmp_path)
    image = MediaAssetStore(repository).import_local(project, png(tmp_path / "reference.png"))
    library, _ = ProjectCreativeLibraryStore(repository).write(
        project_id=project,
        payload=candidate(project, image.id, image.latest_version.id, image.latest_version.sha256),
        idempotency_key="library",
        actor_id="local-user",
    )
    linked = shot()
    linked["character_ids"] = ["chr_" + "a" * 32]
    value = payload(project, episode, shots=[linked], library=library.version_id).model_dump(
        mode="json"
    )
    value["content"]["schema_version"] = "1.1.0"
    value["content"]["shots"][0]["character_bindings"] = (
        [
            {
                "character_id": "chr_" + "a" * 32,
                "costume_id": "cst_" + "e" * 32,
                "reference_ids": ["crf_" + "f" * 32],
            }
        ]
        if has_choices
        else []
    )
    boards = EpisodeStoryboardStore(repository)
    original, _ = write(boards, CreateEpisodeStoryboardVersionRequest.model_validate(value))
    human_store = ShotPlanProposalStore(repository)
    request = director_request(human_store, project, episode)
    if official:
        store = OfficialDirectorStore(repository)
        prepared = store.prepare(
            project,
            episode,
            PrepareOfficialDirectorRequest.model_validate(
                {
                    "operation_id": str(uuid4()),
                    "profile_id": str(uuid4()),
                    "model": "offline-fixture",
                    "authority": request.content.authority.model_dump(mode="json"),
                    "storyboard_base": request.content.storyboard_base.model_dump(mode="json"),
                    "intent": "人工确认候选分镜的完整替换",
                    "options": {"target_shot_count": 7, "pacing": "SLOW"},
                }
            ),
        )
        reserve = ReserveOfficialDirectorRequest.model_validate(
            prepared.model_dump(
                mode="json", include=set(ReserveOfficialDirectorRequest.model_fields)
            )
        )
        store.reserve(project, episode, reserve)
        content = request.content.model_dump(mode="json")
        content["provenance"] = "AI"
        operation, _ = store.complete(
            project,
            episode,
            CompleteOfficialDirectorRequest(
                operation_id=reserve.operation_id,
                profile_id=reserve.profile_id,
                model=reserve.model,
                request_hash=prepared.request_hash,
                response_id="resp_offline_v2_fixture",
                text=json.dumps(content, ensure_ascii=False),
                completed_at="2026-10-08T23:00:00Z",
            ),
        )

        def adopt():
            return store.adopt(
                project, episode, reserve.operation_id, adoption_request(operation), "local-user"
            )
    else:
        proposal, _ = human_store.write(project, episode, request, str(uuid4()), "local-user")

        def adopt():
            return accept(human_store, project, episode, proposal)

    if has_choices:
        with pytest.raises((ShotPlanError, OfficialDirectorError), match="PROJECTION_UNSUPPORTED"):
            adopt()
        assert (
            boards.get_latest(project_id=project, episode_id=episode).version_id
            == original.version_id
        )
    else:
        adopt()
        current = boards.get_latest(project_id=project, episode_id=episode)
        assert current.content.schema_version == "1.1.0"
        assert all(not item.character_bindings for item in current.content.shots)
        assert current.parent_version_id == original.version_id
        assert adopt()[1]
