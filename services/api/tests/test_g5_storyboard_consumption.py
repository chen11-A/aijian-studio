"""Real manual G5 evidence → exact two-episode pins → existing invalidation graph."""

import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from aijian_api.draft_export_contracts import CreateDraftExportRequest
from aijian_api.draft_export_runtime import DraftExportError, DraftExportRuntime
from aijian_api.episode_media_assembly_contracts import (
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import (
    EpisodeMediaAssemblyError,
    EpisodeMediaAssemblyStore,
)
from aijian_api.episode_storyboard_contracts import CreateEpisodeStoryboardVersionRequest
from aijian_api.episode_storyboard_store import EpisodeStoryboardInputError, EpisodeStoryboardStore
from aijian_api.repository import ArtifactNotFoundError
from aijian_api.visual_bible_contracts import CreateVisualBibleVersionRequest
from aijian_api.visual_bible_store import VisualBibleStore
from test_episode_storyboard import payload, shot
from test_project_creative_library import make_project
from test_visual_bible_g5 import (
    ACTOR,
    clear_rights,
    consume_decision,
    decision_payload,
    inspect_fixture,
    prepare,
    setup_visual,
    signed,
)


def approve(repository, project, saved):
    signature, report = signed(repository, project, saved)
    challenge = prepare(
        repository, project, saved, signature.head.revision, "decision", decision_payload(), report
    )
    return consume_decision(repository, project, saved, signature.head, challenge)


def board_request(project, episode, saved, *, schema="1.2.0"):
    one = shot()
    one["character_ids"] = ["chr_" + "a" * 32]
    one["location_id"] = "loc_" + "b" * 32
    one["character_bindings"] = [
        {
            "character_id": "chr_" + "a" * 32,
            "costume_id": "cst_" + "e" * 32,
            "reference_ids": ["crf_" + "f" * 32],
        }
    ]
    if schema in ("1.3.0", "1.4.0"):
        one.update(
            coverage_notes="覆盖角色反应",
            continuity_notes="保留批准服装",
            transition_notes="动作接下一镜",
        )
    if schema == "1.4.0":
        one["environment_binding"] = {"variant_id": None, "reference_ids": []}
    value = payload(project, episode, shots=[]).model_dump(mode="json")
    value["content"].update(
        schema_version=schema,
        shots=[one],
        creative_library_version_id=saved.version.content.creative_library_version_id,
        visual_bible_pin={
            "version_id": saved.version.id,
            "content_hash": saved.version.content_hash,
        },
    )
    return value


def write_board(repository, project, episode, value):
    return EpisodeStoryboardStore(repository).write(
        project_id=project,
        episode_id=episode,
        payload=CreateEpisodeStoryboardVersionRequest.model_validate(value),
        idempotency_key=uuid4().hex,
        actor_id=ACTOR.subject_id,
    )[0]


def assembly(repository, project, episode, asset, board):
    version = asset.latest_version
    content = EpisodeMediaAssemblyContentV1.model_validate(
        {
            "project_id": project,
            "episode_id": episode,
            "sequence_timebase": {
                "frame_rate": {"num": 24, "den": 1},
                "timecode_mode": "NON_DROP_FRAME",
            },
            "canvas_width": 160,
            "canvas_height": 90,
            "total_frames": 24,
            "visual_segments": [
                {
                    "segment_id": "seg_a",
                    "media_kind": "image",
                    "media": {
                        "asset_id": asset.id,
                        "asset_version_id": version.id,
                        "sha256": version.sha256,
                    },
                    "start_frame": 0,
                    "end_frame": 24,
                    "storyboard_ref": {
                        "storyboard_version_id": board.version_id,
                        "shot_id": board.content.shots[0].shot_id,
                    },
                }
            ],
        }
    )
    store = EpisodeMediaAssemblyStore(repository)
    try:
        latest = store.read_version(project, episode)
    except ArtifactNotFoundError:
        latest = None
    return store.create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=content,
            change_summary="Explicit G5-bound shot source",
            parent_version_id=latest.version_id if latest else None,
            expected_revision=latest.head_revision if latest else None,
        ),
        author_actor_id=ACTOR.subject_id,
    )


@pytest.mark.parametrize("board_schema", ["1.2.0", "1.3.0", "1.4.0"])
def test_approval_replacement_invalidates_exact_two_episode_boards_and_assemblies(
    tmp_path: Path, board_schema: str
):
    repository, project, asset, request, saved = setup_visual(tmp_path)
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    old_approval = approve(repository, project, saved)
    first = repository.list_episodes(project)[0].id
    second = repository.create_episode(project, title="Second").id
    old_boards = [
        write_board(
            repository,
            project,
            episode,
            board_request(project, episode, saved, schema=board_schema),
        )
        for episode in (first, second)
    ]
    old_assemblies = [
        assembly(repository, project, episode, asset, board)
        for episode, board in zip((first, second), old_boards, strict=True)
    ]

    def forbidden_tools():
        pytest.fail("Approval/preflight must not invoke encoding toolchain")

    runtime = DraftExportRuntime(repository, forbidden_tools)
    for episode, board, bound in zip((first, second), old_boards, old_assemblies, strict=True):
        record = repository.get_artifact_version(
            project, "episode_media_assembly", bound.version_id, episode_id=episode
        )
        assert [(d.upstream_version_id, d.impact) for d in record.dependencies] == [
            (board.version_id, "blocking")
        ]
    updated = request.model_dump(mode="json")
    updated["content"]["change_reason"] = "明确更换作品共享视觉版本"
    updated["parent_version_id"] = saved.version.id
    updated["expected_revision"] = old_approval.head.revision
    newer, _ = VisualBibleStore(repository).write(
        project,
        CreateVisualBibleVersionRequest.model_validate(updated),
        idempotency_key="new-visual",
        actor_id=ACTOR.subject_id,
    )
    # Saving a candidate never invalidates or replaces the accepted visual version.
    assert VisualBibleStore(repository).index(project).head.accepted_version_id == saved.version.id
    assert repository.list_invalidation_operations(project) == ()
    approve(repository, project, newer)
    events = repository.list_invalidation_operations(project)
    assert len(events) == 1
    event = events[0]
    assert (
        event.old_accepted_version_id == saved.version.id
        and event.new_accepted_version_id == newer.version.id
    )
    affected = {path.affected_version_id: path for path in event.paths}
    assert {x.version_id for x in [*old_boards, *old_assemblies]} <= affected.keys()
    assert all(
        affected[x.version_id].aggregate_impact == "blocking"
        for x in [*old_boards, *old_assemblies]
    )
    for episode, board, bound in zip((first, second), old_boards, old_assemblies, strict=True):
        # Historical objects retain exact source and remain readable, without retargeting.
        assert (
            EpisodeStoryboardStore(repository)
            .get_version(project_id=project, episode_id=episode, version_id=board.version_id)
            .content
            == board.content
        )
        assert (
            EpisodeMediaAssemblyStore(repository)
            .read_version(project, episode, version_id=bound.version_id)
            .content
            == bound.content
        )
        with pytest.raises(EpisodeStoryboardInputError):
            value = board_request(project, episode, saved, schema=board_schema)
            value["parent_version_id"] = board.version_id
            value["expected_revision"] = board.head_revision
            write_board(repository, project, episode, value)
        with pytest.raises(EpisodeMediaAssemblyError, match="G5"):
            assembly(repository, project, episode, asset, board)
        with pytest.raises(DraftExportError, match="G5"):
            runtime._read_assembly(
                project,
                episode,
                CreateDraftExportRequest(
                    operation_id="dmp_" + uuid4().hex,
                    assembly_version_id=bound.version_id,
                    assembly_content_hash=bound.content_hash,
                    rights_declaration="OWNED_OR_SYNTHETIC",
                    output_path=str(tmp_path / "unused.mp4"),
                ),
            )
    other = make_project(repository)
    assert repository.list_invalidation_operations(other) == ()


@pytest.mark.parametrize(
    "fault",
    [
        "before-approval",
        "wrong-project",
        "hash",
        "library",
        "missing-binding",
        "wrong-owned-reference",
        "empty-reference",
    ],
)
@pytest.mark.parametrize("board_schema", ["1.2.0", "1.3.0"])
def test_g5_pin_rejects_unauthorized_or_changed_identity_without_append(
    tmp_path: Path, fault: str, board_schema: str
):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    episode = repository.list_episodes(project)[0].id
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    if fault != "before-approval":
        approve(repository, project, saved)
    value = board_request(project, episode, saved, schema=board_schema)
    if fault == "wrong-project":
        other = make_project(repository)
        other_episode = repository.list_episodes(other)[0].id
        value["content"]["project_id"] = other
        value["content"]["episode_id"] = other_episode
        project, episode = other, other_episode
    elif fault == "hash":
        value["content"]["visual_bible_pin"]["content_hash"] = "sha256:" + "0" * 64
    elif fault == "library":
        value["content"]["creative_library_version_id"] = "ver_" + "0" * 32
    elif fault == "missing-binding":
        value["content"]["shots"][0]["character_bindings"] = []
    elif fault == "wrong-owned-reference":
        value["content"]["shots"][0]["character_bindings"][0]["reference_ids"] = ["crf_" + "0" * 32]
    elif fault == "empty-reference":
        value["content"]["shots"][0]["character_bindings"][0]["reference_ids"] = []
    with sqlite3.connect(repository.database_path) as connection:
        before = connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone()
    with pytest.raises(EpisodeStoryboardInputError):
        write_board(repository, project, episode, value)
    with sqlite3.connect(repository.database_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM artifact_versions").fetchone() == before


@pytest.mark.parametrize("fault", ["missing", "changed", "rights", "inspection"])
def test_planning_keeps_historical_identity_but_blocks_new_consumption_on_changed_evidence(
    tmp_path: Path, fault: str
):
    repository, project, asset, _, saved = setup_visual(tmp_path)
    episode = repository.list_episodes(project)[0].id
    clear_rights(repository, project, asset)
    inspect_fixture(repository, project, asset)
    approve(repository, project, saved)
    board = write_board(
        repository, project, episode, board_request(project, episode, saved, schema="1.3.0")
    )
    bound = assembly(repository, project, episode, asset, board)
    version = asset.latest_version
    blob = (
        repository.database_path.parent
        / "media-assets"
        / "blobs"
        / version.sha256[:2]
        / version.sha256
    )
    if fault == "missing":
        blob.unlink()
    elif fault == "changed":
        blob.write_bytes(b"x" * version.byte_size)
    elif fault == "rights":
        clear_rights(repository, project, asset, revision=1, decision="RESTRICTED")
    else:
        inspect_fixture(repository, project, asset)
    assert (
        EpisodeStoryboardStore(repository)
        .get_version(project_id=project, episode_id=episode, version_id=board.version_id)
        .content
        == board.content
    )
    assert (
        EpisodeMediaAssemblyStore(repository)
        .read_version(project, episode, version_id=bound.version_id)
        .content
        == bound.content
    )
    value = board_request(project, episode, saved, schema="1.3.0")
    value.update(parent_version_id=board.version_id, expected_revision=board.head_revision)
    with pytest.raises(EpisodeStoryboardInputError):
        write_board(repository, project, episode, value)
    with pytest.raises(EpisodeMediaAssemblyError, match="G5"):
        assembly(repository, project, episode, asset, board)

    def forbidden_tools():
        pytest.fail("Changed G5 evidence must block before any encoding toolchain call")

    with pytest.raises(DraftExportError, match="G5"):
        DraftExportRuntime(repository, forbidden_tools)._read_assembly(
            project,
            episode,
            CreateDraftExportRequest(
                operation_id="dmp_" + uuid4().hex,
                assembly_version_id=bound.version_id,
                assembly_content_hash=bound.content_hash,
                rights_declaration="OWNED_OR_SYNTHETIC",
                output_path=str(tmp_path / "unused.mp4"),
            ),
        )
