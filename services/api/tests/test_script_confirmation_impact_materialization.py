"""Independent regression: SQL fence precedes recursive legacy source materialization.

Controlled generic append is a stored oversized source; not healthy typed writer output.
No protected trigger changes and no actual media/Provider process.
"""

import copy

import pytest
from aijian_api import episode_media_assembly_store as assembly_module
from aijian_api.artifacts import canonical_content_bytes
from aijian_api.script_confirmation_impact_projection import (
    bounded_version_record,
    immutable_consumer_context,
)
from test_assembly_script_provenance import source_fixture


def test_oversized_secondary_script_is_refused_before_json_materialization(tmp_path, monkeypatch):
    repo, p, e, _, script, saved, receipt = source_fixture(tmp_path)
    oversized = copy.deepcopy(script.content.model_dump(mode="json"))
    oversized["scenes"][0]["blocks"] = [
        {
            "block_id": "sblk_" + format(i + 1, "032x"),
            "ordinal": i + 1,
            "kind": "ACTION",
            "text": "x" * 20000,
            "speaker": None,
            "delivery": None,
        }
        for i in range(101)
    ]
    assert len(canonical_content_bytes(oversized)) > 2_000_000
    # Generic immutable artifact append preserves native SQLite constraints; its
    # body has a canonical hash but exceeds the typed script writer's budget.
    large = repo.create_artifact_version(
        project_id=p,
        episode_id=e,
        artifact_type="episode_script",
        schema_version="1.0.0",
        content=oversized,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="Controlled oversized stored upstream",
        parent_version_id=script.version_id,
        expected_revision=script.head_revision,
    )
    value = copy.deepcopy(saved.content.model_dump(mode="json"))
    value.pop("script_provenance")
    value["subtitle_segments"] = [
        {
            "segment_id": "seg_original",
            "start_frame": 12,
            "end_frame": 36,
            "script_version_id": script.version_id,
            "script_block_id": "sblk_" + "b" * 32,
        }
    ]
    value["subtitle_segments"].append(
        {
            "segment_id": "seg_secondary",
            "start_frame": 40,
            "end_frame": 48,
            "script_version_id": large.version.id,
            "script_block_id": "sblk_" + format(1, "032x"),
        }
    )
    record = repo.create_artifact_version(
        project_id=p,
        episode_id=e,
        artifact_type="episode_media_assembly",
        schema_version="1.0.0",
        content=value,
        author_actor_type="human",
        author_actor_id="local-user",
        change_summary="Controlled immutable legacy reference",
        parent_version_id=saved.version_id,
        expected_revision=saved.head_revision,
    )
    original = assembly_module.json.loads
    loaded = []

    def spy(raw, *args, **kwargs):
        if isinstance(raw, str) and len(raw.encode()) > 2_000_000:
            loaded.append(len(raw.encode()))
            raise ValueError("CONTROL: oversized raw upstream reached JSON parser")
        return original(raw, *args, **kwargs)

    monkeypatch.setattr(assembly_module.json, "loads", spy)
    with repo._connection() as connection:
        exact = bounded_version_record(
            repo,
            connection,
            project_id=p,
            episode_id=e,
            artifact_type="episode_media_assembly",
            version_id=record.version.id,
        )
        with pytest.raises(Exception) as failure:
            immutable_consumer_context(
                repo,
                connection,
                exact,
                receipt,
                artifact_type="episode_media_assembly",
                episode_id=e,
            )
    print("projection refusal", type(failure.value).__name__, str(failure.value))
    print("oversized upstream bytes reaching parser", loaded)
    assert loaded == [], "Recursive source validation must apply SQL materialization fence first"
