"""Independent-review regression: latest rights, with real exact SQLite references."""

import sqlite3

import pytest
from aijian_api.assembly_storyboard_provenance import (
    AssemblyStoryboardReferenceError,
    validate_storyboard_provenance,
)
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
)
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import EpisodeStoryboardInputError, EpisodeStoryboardStore
from aijian_api.media_asset_rights_contracts import HumanRightsDecisionInput
from aijian_api.media_asset_rights_store import MediaAssetRightsStore
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.project_creative_library_contracts import CreateProjectCreativeLibraryVersionRequest
from aijian_api.project_creative_library_store import (
    ProjectCreativeLibraryInputError,
    ProjectCreativeLibraryStore,
)
from test_assembly_storyboard_provenance import linked_content, save
from test_character_reference_assets import png
from test_draft_export_runtime import fixture
from test_episode_storyboard import write
from test_project_environment import environment
from test_storyboard_environment import environment_board


@pytest.mark.parametrize("fault", ["restricted", "corrupt-head", "corrupt-audit"])
def test_current_rights_refuse_new_saves_and_consumption_but_keep_history_replay(tmp_path, fault):
    repository, project, episode, _asset, assembly = fixture(tmp_path)
    image = MediaAssetStore(repository).import_local(project, png(tmp_path / "environment.png"))
    args = (project, image.id, image.latest_version.id)
    lib_request = environment(
        project, image.id, image.latest_version.id, image.latest_version.sha256
    )
    libraries = ProjectCreativeLibraryStore(repository)
    library, _ = libraries.write(
        project_id=project, payload=lib_request, idempotency_key="library", actor_id="human"
    )
    value = environment_board(project, episode, library.version_id)
    request = CreateEpisodeStoryboardVersionRequest.model_validate(value)
    boards = EpisodeStoryboardStore(repository)
    board, _ = write(boards, request, "board")
    bound = save(repository, project, episode, assembly, linked_content(assembly, board))
    MediaAssetRightsStore(repository).append_human_decision(
        *args,
        HumanRightsDecisionInput(
            operation_id="rdop_" + "a" * 32,
            expected_revision=0,
            decision="RESTRICTED",
            basis_text="Independent regression: explicit current restriction",
        ),
        actor_id="human",
    )
    if fault == "corrupt-head":
        with repository._connection() as connection:
            connection.execute("UPDATE media_asset_rights_heads SET revision=2")
    elif fault == "corrupt-audit":
        # Preserve immutable SQL triggers. Inject corrupt audit decoding only.
        from unittest.mock import patch

        from aijian_api import media_asset_rights_store

        original = media_asset_rights_store._audit_from_row
        corrupt = patch.object(
            media_asset_rights_store,
            "_audit_from_row",
            lambda row: original(row).model_copy(update={"asset_sha256": "f" * 64}),
        )
        corrupt.start()
    try:
        assert (
            MediaAssetStore(repository)
            .get_asset(project, image.id, verify=True)
            .latest_version.rights_status
            == "PENDING_REVIEW"
        )
        assert (
            boards.get_version(
                project_id=project, episode_id=episode, version_id=board.version_id
            ).content
            == board.content
        )
        assert (
            EpisodeMediaAssemblyStore(repository)
            .read_version(project, episode, version_id=bound.version_id)
            .content
            == bound.content
        )
        assert write(boards, request, "board")[1]
        assert libraries.write(
            project_id=project, payload=lib_request, idempotency_key="library", actor_id="human"
        )[1]
        value.update(parent_version_id=board.version_id, expected_revision=board.head_revision)
        with pytest.raises(EpisodeStoryboardInputError, match="environment"):
            write(boards, CreateEpisodeStoryboardVersionRequest.model_validate(value), "new")
        lib_value = lib_request.model_dump(mode="json")
        lib_value.update(
            parent_version_id=library.version_id, expected_revision=library.head_revision
        )
        with pytest.raises(ProjectCreativeLibraryInputError):
            libraries.write(
                project_id=project,
                payload=CreateProjectCreativeLibraryVersionRequest.model_validate(lib_value),
                idempotency_key="new",
                actor_id="human",
            )
        with pytest.raises(EpisodeMediaAssemblyError) as refused:
            save(repository, project, episode, bound, bound.content.model_dump(mode="json"))
        assert refused.value.code == "STORYBOARD_REFERENCE_STALE"
        from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
        from test_draft_export_runtime import request_for

        def forbidden_tools():
            pytest.fail("Restricted reference must reject before encoding toolchain access")

        runtime = DraftExportRuntime(repository, forbidden_tools)
        with pytest.raises(DraftExportError) as export_refused:
            runtime._read_assembly(project, episode, request_for(bound, tmp_path / "never.mp4"))
        assert export_refused.value.code == "STORYBOARD_REFERENCE_STALE"
        assert not (tmp_path / "never.mp4").exists()
        with repository._connection() as connection:
            before = connection.total_changes
            with pytest.raises(AssemblyStoryboardReferenceError):
                validate_storyboard_provenance(repository, connection, bound.content, fresh=True)
            assert connection.total_changes == before
        assert (
            boards.get_latest(project_id=project, episode_id=episode).version_id == board.version_id
        )
        assert (
            EpisodeMediaAssemblyStore(repository).read_version(project, episode).version_id
            == bound.version_id
        )
        with sqlite3.connect(repository.database_path) as connection:
            assert connection.execute("SELECT COUNT(*) FROM task_ledger").fetchone() == (0,)
    finally:
        if fault == "corrupt-audit":
            corrupt.stop()
