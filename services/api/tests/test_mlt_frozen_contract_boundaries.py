"""Synthetic frozen-input rejection only; no MLT or actual QA fixtures."""

import hashlib
import json
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

import pytest
from aijian_api import mlt_execution_adapter as adapter
from aijian_api.mlt_execution_worker import MltExecutionError, MltFileIdentity
from test_mlt_adapter_type_boundaries import frozen_fixture


@pytest.fixture
def frozen(tmp_path):
    return frozen_fixture(tmp_path)


def test_non_dto_plan_is_rejected():
    with pytest.raises(MltExecutionError, match="DTO"):
        adapter._require_art04_plan({})


@pytest.mark.parametrize(
    "field,value",
    [
        ("total_frames", 126),
        ("video_tracks", ()),
        ("audio_tracks", ()),
        ("subtitle_cues", ()),
        ("video_transitions", ()),
    ],
)
def test_changed_frozen_plan_shape_is_rejected(frozen, field, value):
    plan, _, _ = frozen
    with pytest.raises(MltExecutionError, match="frozen 125-frame"):
        adapter._require_art04_plan(plan.model_copy(update={field: value}))


@pytest.mark.parametrize(
    "section", ["video", "transition", "audio_role", "audio_samples", "duplicate_media", "subtitle"]
)
def test_changed_frozen_track_semantics_are_rejected(frozen, section):
    plan, _, _ = frozen
    blue, red = plan.video_tracks
    dialogue, bgm = plan.audio_tracks
    if section == "video":
        plan = plan.model_copy(
            update={"video_tracks": (blue.model_copy(update={"clips": ()}), red)}
        )
    elif section == "transition":
        transition = plan.video_transitions[0].model_copy(update={"start_frame": 51})
        plan = plan.model_copy(update={"video_transitions": (transition,)})
    elif section == "audio_role":
        plan = plan.model_copy(
            update={"audio_tracks": (dialogue, bgm.model_copy(update={"role": "DIALOGUE_TEST"}))}
        )
    elif section == "audio_samples":
        changed = dialogue.clips[0].model_copy(update={"source_end_sample": 47999})
        plan = plan.model_copy(
            update={
                "audio_tracks": (
                    dialogue.model_copy(update={"clips": (changed, dialogue.clips[1])}),
                    bgm,
                )
            }
        )
    elif section == "duplicate_media":
        changed = red.clips[0].model_copy(update={"media": blue.clips[0].media})
        plan = plan.model_copy(
            update={"video_tracks": (blue, red.model_copy(update={"clips": (changed,)}))}
        )
    else:
        cue = plan.subtitle_cues[0].model_copy(update={"font_size_px": 49})
        plan = plan.model_copy(update={"subtitle_cues": (cue, plan.subtitle_cues[1])})
    with pytest.raises(MltExecutionError) as error:
        adapter._require_art04_plan(plan)
    assert error.value.code == "ENGINEERING_PLAN_UNSUPPORTED"


@pytest.mark.parametrize(
    "kind",
    ["resolver_type", "media_mismatch", "identity_type", "hash", "relative", "missing", "size"],
)
def test_resolved_selected_version_must_match_its_pinned_file(frozen, kind):
    plan, files, _ = frozen
    ref = plan.video_tracks[0].clips[0].media
    identity = files["v1-blue.webm"]
    returned_ref = ref
    if kind == "media_mismatch":
        returned_ref = ref.model_copy(update={"byte_size": ref.byte_size + 1})
    elif kind == "identity_type":
        identity = None
    elif kind == "hash":
        identity = replace(identity, sha256="0" * 64)
    elif kind == "relative":
        identity = replace(identity, path=Path("relative/file"))
    elif kind == "missing":
        identity = replace(identity, path=identity.path.with_name("absent"))
    elif kind == "size":
        ref = ref.model_copy(update={"byte_size": ref.byte_size + 1})
        returned_ref = ref
    resolved = (
        None if kind == "resolver_type" else adapter.MltResolvedSelection(returned_ref, identity)
    )
    with pytest.raises(MltExecutionError):
        adapter._source_identity(ref, lambda _: resolved, video=True)


@pytest.mark.parametrize(
    "content,message",
    [(b"\xff", "UTF-8"), (b"wrong timing", "timing"), (b"x" * (1024 * 1024 + 1), "hash")],
    ids=["encoding", "timing", "oversize"],
)
def test_rehashed_subtitle_still_requires_frozen_content(frozen, content, message):
    plan, files, _ = frozen
    path = files["subtitle-test.srt"].path
    path.write_bytes(content)
    identity = MltFileIdentity(path, hashlib.sha256(content).hexdigest())
    with pytest.raises(MltExecutionError, match=message):
        adapter._verify_subtitle_file(identity, plan)


@pytest.mark.parametrize(
    "field,value",
    [
        ("kind", "wrong"),
        ("status", "wrong"),
        ("usage", "wrong"),
        ("spec_sha256", None),
        ("project_id", "wrong"),
        ("output_directory", None),
        ("output_directory", "relative"),
        ("files", []),
        ("files", [None] * 5),
    ],
)
def test_rehashed_manifest_rejects_changed_authority(frozen, field, value):
    plan, files, manifest = frozen
    payload = json.loads(manifest.path.read_bytes())
    payload[field] = value
    check_changed_manifest(plan, files, manifest, json.dumps(payload).encode())


@pytest.mark.parametrize(
    "body",
    [b"\xff", b"{", b"[]", b'{"kind":1,"kind":2}'],
    ids=["utf8", "json", "root", "duplicate"],
)
def test_manifest_json_must_be_unambiguous_object(frozen, body):
    plan, files, manifest = frozen
    check_changed_manifest(plan, files, manifest, body)


@pytest.mark.parametrize(
    "field,value",
    [
        ("name", None),
        ("name", "unknown"),
        ("usage", "REAL"),
        ("path", None),
        ("sha256", None),
        ("sha256", "z" * 64),
        ("sha256", "0" * 64),
        ("bytes", True),
        ("bytes", "1"),
        ("bytes", 0),
        ("bytes", 999),
    ],
)
def test_manifest_entry_requires_exact_complete_identity(frozen, field, value):
    plan, files, manifest = frozen
    payload = json.loads(manifest.path.read_bytes())
    payload["files"][0][field] = value
    check_changed_manifest(plan, files, manifest, json.dumps(payload).encode())


def check_changed_manifest(plan, files, manifest, body):
    manifest.path.write_bytes(body)
    manifest = replace(manifest, sha256=hashlib.sha256(body).hexdigest())
    source = plan.source.model_copy(update={"fixture_manifest_sha256": manifest.sha256})
    plan = plan.model_copy(update={"source": source})
    by_hash = {identity.sha256: identity for identity in files.values()}
    refs = [track.clips[0].media for track in (*plan.video_tracks, *plan.audio_tracks)]
    resources = {(ref.asset_id, ref.asset_version_id): by_hash[ref.sha256] for ref in refs}
    with pytest.raises(MltExecutionError) as error:
        adapter._verify_fixture_manifest(manifest, plan, resources, files["subtitle-test.srt"])
    assert error.value.code == "ENGINEERING_PLAN_UNSUPPORTED"


@pytest.mark.parametrize("kind", ["outside", "name", "missing", "directory", "size", "hash"])
def test_origin_input_cannot_escape_or_change_bytes(frozen, kind):
    _, files, _ = frozen
    identity = files["v1-blue.webm"]
    path = identity.path
    root = path.parent
    name = path.name
    size = path.stat().st_size
    digest = identity.sha256
    if kind == "outside":
        root = root / "other"
    elif kind == "name":
        name = "unexpected.webm"
    elif kind == "missing":
        path = path.with_name("absent")
    elif kind == "directory":
        path = root
    elif kind == "size":
        size += 1
    else:
        digest = "0" * 64
    with pytest.raises(MltExecutionError):
        adapter._verify_qa_origin_file(root, str(path), name, size, digest)


@pytest.mark.parametrize("kind", ["id", "missing_root", "existing_job"])
def test_materialization_fails_without_overwriting_existing_job(tmp_path, kind):
    operation = "eteop_" + "f" * 32
    work_root = tmp_path
    sentinel = None
    if kind == "id":
        operation = "../../escape"
    elif kind == "missing_root":
        work_root = tmp_path / "missing"
    else:
        job = tmp_path / operation
        job.mkdir()
        sentinel = job / "project.mlt"
        sentinel.write_bytes(b"preserve")
    blueprint = Mock()
    with pytest.raises(MltExecutionError) as error:
        adapter.materialize_mlt_engineering_task(
            blueprint, operation_id=operation, work_root=work_root
        )
    assert error.value.code == (
        "JOB_MATERIALIZATION_FAILED" if kind == "existing_job" else "JOB_PATH_UNSAFE"
    )
    assert blueprint.mock_calls == []
    if sentinel:
        assert sentinel.read_bytes() == b"preserve"
