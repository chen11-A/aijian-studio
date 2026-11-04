"""Episode script request/replay and rollback boundaries in temporary SQLite."""

import sqlite3
from datetime import datetime
from unittest.mock import Mock

import pytest
from aijian_api import episode_script_store as scripts
from aijian_api.episode_script_contracts import CreateEpisodeScriptVersionRequest
from aijian_api.repository import ArtifactConflictError, ArtifactNotFoundError, StudioRepository


@pytest.fixture
def draft(tmp_path):
    repository = StudioRepository(tmp_path / "studio.db")
    project = repository.create_project(
        name="Script boundaries",
        aspect_ratio="9:16",
        target_duration_seconds=10,
        source_language="zh-CN",
    )
    episode = repository.list_episodes(project.id)[0].id
    payload = CreateEpisodeScriptVersionRequest.model_validate(
        {
            "content": {
                "project_id": project.id,
                "episode_id": episode,
                "scenes": [
                    {
                        "scene_id": "scn_" + "a" * 32,
                        "ordinal": 1,
                        "heading": "Test scene",
                        "blocks": [
                            {
                                "block_id": "sblk_" + "b" * 32,
                                "ordinal": 1,
                                "kind": "ACTION",
                                "text": "A character opens a door.",
                            }
                        ],
                    }
                ],
            },
            "change_summary": "Synthetic script",
        }
    )
    return (
        repository,
        scripts.EpisodeScriptStore(repository),
        dict(
            project_id=project.id,
            episode_id=episode,
            payload=payload,
            idempotency_key="synthetic-script",
            actor_id="local-user",
        ),
    )


def state(repository):
    with repository._connection() as connection:
        return {
            table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table}")]
            for table in (
                "artifacts",
                "artifact_versions",
                "artifact_heads",
                "artifact_dependencies",
                "episode_script_write_requests",
            )
        }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("idempotency_key", " "),
        ("idempotency_key", "x" * 241),
        ("actor_id", " "),
        ("actor_id", "x" * 241),
        ("project_id", "prj_" + "f" * 32),
        ("episode_id", "ep_" + "f" * 32),
    ],
)
def test_bad_request_identity_is_rejected_before_opening_database(draft, monkeypatch, field, value):
    _, store, args = draft
    opener = Mock(side_effect=AssertionError("must not open"))
    monkeypatch.setattr(store, "_open", opener)
    with pytest.raises(scripts.EpisodeScriptInputError):
        store.write(**{**args, field: value})
    opener.assert_not_called()


@pytest.mark.parametrize(
    "kind", ["project", "episode", "parent", "oversized", "dialogue", "upstream"]
)
def test_invalid_new_script_rolls_back_all_artifact_and_receipt_rows(draft, monkeypatch, kind):
    repository, store, args = draft
    raw = args["payload"].model_dump(mode="json")
    if kind == "project":
        raw["content"]["project_id"] = args["project_id"] = "prj_" + "f" * 32
    elif kind == "episode":
        raw["content"]["episode_id"] = args["episode_id"] = "ep_" + "f" * 32
    elif kind == "parent":
        raw["parent_version_id"] = "ver_" + "f" * 32
        raw["expected_revision"] = 1
    elif kind == "oversized":
        monkeypatch.setattr(scripts, "MAX_SCRIPT_BYTES", 10)
    elif kind == "dialogue":
        raw["content"]["scenes"][0]["blocks"][0].update(
            kind="DIALOGUE", speaker="Person", delivery=None
        )
    else:
        raw["content"]["production_brief_version_id"] = "ver_" + "f" * 32
    args["payload"] = CreateEpisodeScriptVersionRequest.model_validate(raw)
    before = state(repository)
    with pytest.raises(
        (
            scripts.EpisodeScriptInputError,
            scripts.EpisodeScriptConflictError,
            scripts.EpisodeScriptTooLargeError,
            scripts.ProjectNotFoundError,
            scripts.EpisodeNotFoundError,
        )
    ):
        store.write(**args)
    assert state(repository) == before


@pytest.mark.parametrize("failure", ["clock", "database", "artifact_conflict"])
def test_late_write_failure_leaves_no_version_or_idempotency_receipt(draft, monkeypatch, failure):
    repository, store, args = draft
    before = state(repository)
    if failure == "clock":
        store._clock = lambda: datetime(2026, 1, 1)
        expected = ValueError
    elif failure == "database":
        store._clock = Mock(side_effect=sqlite3.OperationalError("synthetic storage failure"))
        expected = scripts.EpisodeScriptStorageError
    else:
        monkeypatch.setattr(
            repository,
            "create_artifact_version",
            Mock(side_effect=ArtifactConflictError("synthetic CAS")),
        )
        expected = scripts.EpisodeScriptConflictError
    with pytest.raises(expected):
        store.write(**args)
    assert state(repository) == before


@pytest.mark.parametrize("field", ["actor_id", "payload"])
def test_same_key_different_intent_cannot_reuse_version(draft, field):
    repository, store, args = draft
    store.write(**args)
    before = state(repository)
    if field == "actor_id":
        args[field] = "other-user"
    else:
        args[field] = args[field].model_copy(update={"change_summary": "changed"})
    with pytest.raises(scripts.EpisodeScriptConflictError, match="different script input"):
        store.write(**args)
    assert state(repository) == before


@pytest.mark.parametrize("entry", ["get_latest", "get_version"])
@pytest.mark.parametrize("kind", ["not_found", "missing_conflict", "corrupt"])
def test_get_maps_repository_failures_without_inventing_a_script(draft, monkeypatch, entry, kind):
    repository, store, args = draft
    error = (
        ArtifactNotFoundError("missing")
        if kind == "not_found"
        else ArtifactConflictError(
            "Artifact version was not found" if kind == "missing_conflict" else "corrupt"
        )
    )
    method = "get_latest_artifact" if entry == "get_latest" else "get_artifact_version"
    monkeypatch.setattr(repository, method, Mock(side_effect=error))
    kwargs = {"project_id": args["project_id"], "episode_id": args["episode_id"]}
    if entry == "get_version":
        kwargs["version_id"] = "ver_" + "a" * 32
    expected = (
        scripts.EpisodeScriptNotFoundError
        if kind == "not_found" or (entry == "get_version" and kind == "missing_conflict")
        else scripts.EpisodeScriptStorageError
    )
    with pytest.raises(expected):
        getattr(store, entry)(**kwargs)


@pytest.mark.parametrize("kind", ["lookup_conflict", "scope"])
def test_corrupt_replay_receipt_does_not_create_replacement(draft, monkeypatch, kind):
    repository, store, args = draft
    store.write(**args)
    before = state(repository)
    if kind == "lookup_conflict":
        monkeypatch.setattr(
            repository,
            "_get_artifact_version_in_connection",
            Mock(side_effect=ArtifactConflictError("missing receipt version")),
        )
    else:
        original = store._open

        def open_connection():
            connection = original()

            def factory(cursor, values):
                row = sqlite3.Row(cursor, values)
                if set(row.keys()) == {"request_hash", "artifact_id", "version_id"}:
                    return {**dict(row), "artifact_id": "art_" + "f" * 32}
                return row

            connection.row_factory = factory
            return connection

        monkeypatch.setattr(store, "_open", open_connection)
    with pytest.raises(scripts.EpisodeScriptStorageError):
        store.write(**args)
    assert state(repository) == before


def test_legacy_request_hash_omits_only_fields_absent_from_old_input(draft):
    _, _, args = draft
    payload = args["payload"]
    identity = {key: args[key] for key in ("project_id", "episode_id", "actor_id")}
    legacy = scripts._legacy_request_hash(payload, **identity)
    assert legacy is not None
    raw = payload.model_dump(mode="json")
    for field in (
        "story_bible_version_id",
        "source_extraction_version_id",
        "source_proposal_acceptance_id",
    ):
        raw["content"].pop(field)
    for scene in raw["content"]["scenes"]:
        for block in scene["blocks"]:
            block.pop("delivery")
    assert legacy == scripts.canonical_content_hash({**identity, "payload": raw})
    current = CreateEpisodeScriptVersionRequest.model_validate(payload.model_dump(mode="json"))
    assert scripts._legacy_request_hash(current, **identity) is None


@pytest.mark.parametrize("field", ["version", "acceptance"])
def test_incomplete_source_acceptance_never_reads_connection(field):
    connection = Mock()
    with pytest.raises(scripts.EpisodeScriptInputError, match="incomplete"):
        scripts.EpisodeScriptStore._require_source_acceptance(
            connection,
            "project",
            "version" if field == "version" else None,
            "acceptance" if field == "acceptance" else None,
        )
    connection.execute.assert_not_called()
