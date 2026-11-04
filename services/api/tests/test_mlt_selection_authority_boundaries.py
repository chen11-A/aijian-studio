"""Typed synthetic selection receipts; not frozen QA input or MLT execution evidence."""

from contextlib import nullcontext
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import mlt_test_selection_resolver as resolver
from aijian_api.episode_media_execution_plan import build_art04_synthetic_execution_plan
from aijian_api.media_asset_audio_inspection import VerifiedTestAudio
from aijian_api.media_asset_rights_contracts import (
    AuthoritativeRightsDecision,
    RightsDecisionReadResult,
)
from aijian_api.media_asset_selected_reader import SelectedMediaAssetRead
from test_media_execution_plan_boundaries import engineering_inputs
from test_product_media_preflight_boundaries import version


@pytest.fixture(params=range(4), ids=["blue", "red", "dialogue", "bgm"])
def selection(tmp_path, monkeypatch, request):
    bindings, inputs = engineering_inputs()
    index = request.param
    name = resolver._FILE_NAMES[index]
    ref = (bindings.blue_video, bindings.red_video, bindings.dialogue_tone, bindings.bgm_tone)[
        index
    ]
    selected = version(
        "video" if index < 2 else "audio",
        asset_id=ref.asset_id,
        version_id=ref.asset_version_id,
        sha256=ref.sha256,
        byte_size=ref.byte_size,
    )
    path = tmp_path / "managed-synthetic.bin"
    path.write_bytes(b"X" * ref.byte_size)
    rights = AuthoritativeRightsDecision(
        project_id=bindings.project_id,
        asset_id=ref.asset_id,
        version_id=ref.asset_version_id,
        asset_sha256=ref.sha256,
        decision_id=ref.rights_decision_id,
        revision=1,
        decision="CLEARED",
        decision_content_hash="a" * 64,
        evidence_sha256="b" * 64,
        actor_id="synthetic-unit-test",
    )
    read = Mock(return_value=SelectedMediaAssetRead("VERIFIED", selected))
    read_rights = Mock(
        return_value=RightsDecisionReadResult(
            status="VERIFIED",
            current_revision=1,
            decision=rights,
        )
    )
    evidence = inputs["blue_probe" if index == 0 else "red_probe"]
    inspect = Mock(
        return_value=VerifiedTestAudio(
            selected,
            inputs["dialogue_inspection" if index == 2 else "bgm_inspection"],
            path,
        )
    )
    probe = Mock(return_value=evidence)
    monkeypatch.setattr(resolver, "read_selected_media_asset_version", read)
    monkeypatch.setattr(resolver, "read_latest_rights_decision", read_rights)
    monkeypatch.setattr(resolver, "_managed_path", lambda *_: path)
    monkeypatch.setattr(resolver, "_read_video_probe", probe)
    monkeypatch.setattr(resolver, "inspect_selected_test_wav", inspect)
    manifest = SimpleNamespace(
        project_id=bindings.project_id,
        ffmpeg_sha256=evidence.ffmpeg_sha256,
        ffprobe_sha256=evidence.ffprobe_sha256,
        files={name: resolver._FixtureFile(path, ref.sha256, ref.byte_size)},
    )
    return SimpleNamespace(
        args=(
            tmp_path / "unused.sqlite3",
            manifest,
            name,
            resolver.AssetVersionSelector(ref.asset_id, ref.asset_version_id),
        ),
        read=read,
        rights=read_rights,
        probe=probe,
        inspect=inspect,
        ref=ref,
        path=path,
        selected=selected,
        is_video=index < 2,
    )


def test_verified_typed_receipts_preserve_selection_identity(selection):
    result = resolver._verified_media(*selection.args)
    assert result.ref == selection.ref
    assert result.file.path == selection.path
    assert result.rights == selection.rights.return_value.decision
    if selection.is_video:
        selection.inspect.assert_not_called()
    else:
        selection.probe.assert_not_called()
        assert selection.inspect.call_args.kwargs["expected_samples"] in {48000, 240000}


@pytest.mark.parametrize("change", ["status", "none", "kind", "hash", "size"])
def test_unverified_or_changed_asset_never_reaches_rights_or_inspection(selection, change):
    read = selection.read.return_value
    if change == "status":
        read = replace(read, status="UNKNOWN_DATABASE")
    elif change == "none":
        read = replace(read, version=None)
    else:
        field, value = {
            "kind": ("kind", "image"),
            "hash": ("sha256", "0" * 64),
            "size": ("byte_size", 999),
        }[change]
        read = replace(read, version=replace(read.version, **{field: value}))
    selection.read.return_value = read
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolver._verified_media(*selection.args)
    assert caught.value.code == "ASSET_SELECTION_CONFLICT"
    selection.rights.assert_not_called()
    selection.probe.assert_not_called()
    selection.inspect.assert_not_called()


@pytest.mark.parametrize("change", ["status", "none", "decision", "chain", "hash", "revision"])
def test_latest_rights_must_be_verified_cleared_and_match_asset(selection, change):
    read = selection.rights.return_value
    if change == "status":
        read = read.model_copy(update={"status": "UNKNOWN_DATABASE"})
    elif change == "none":
        read = read.model_copy(update={"decision": None})
    else:
        field, value = {
            "decision": ("decision", "RESTRICTED"),
            "chain": ("chain_integrity", False),
            "hash": ("asset_sha256", "0" * 64),
            "revision": ("revision", 2),
        }[change]
        read = read.model_copy(update={"decision": read.decision.model_copy(update={field: value})})
    selection.rights.return_value = read
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolver._verified_media(*selection.args)
    assert caught.value.code == "RIGHTS_NOT_CLEARED"
    selection.probe.assert_not_called()
    selection.inspect.assert_not_called()


@pytest.mark.parametrize("mode", ["absent", "size", "resolver-error"])
def test_managed_file_must_still_match_verified_receipt(selection, monkeypatch, mode):
    if mode == "absent":
        monkeypatch.setattr(resolver, "managed_local_io_path", lambda *_: selection.path / "absent")
    elif mode == "size":
        selection.path.write_bytes(b"changed synthetic bytes")
    else:
        monkeypatch.setattr(
            resolver, "managed_local_io_path", Mock(side_effect=ValueError("unsafe"))
        )
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolver._verified_media(*selection.args)
    assert caught.value.code == "ASSET_SELECTION_CONFLICT"


@pytest.mark.parametrize("change", ["ffmpeg", "ffprobe", "vfr", "rate", "dimensions", "audio"])
@pytest.mark.parametrize("selection", [0, 1], indirect=True)
def test_video_probe_drift_is_rejected_before_plan_reference(selection, change):
    evidence = selection.probe.return_value
    if change in {"ffmpeg", "ffprobe"}:
        evidence = replace(evidence, **{change + "_sha256": "0" * 64})
    elif change == "audio":
        evidence = replace(evidence, probe=evidence.probe.model_copy(update={"audio": object()}))
    else:
        video = evidence.probe.video
        field, value = {
            "vfr": ("is_variable_frame_rate", True),
            "rate": ("average_frame_rate", video.average_frame_rate.model_copy(update={"num": 24})),
            "dimensions": ("width", 640),
        }[change]
        evidence = replace(
            evidence,
            probe=evidence.probe.model_copy(
                update={
                    "video": video.model_copy(update={field: value}),
                }
            ),
        )
    selection.probe.return_value = evidence
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolver._verified_media(*selection.args)
    assert caught.value.code == "VIDEO_PROBE_CONFLICT"


@pytest.mark.parametrize("selection", [2, 3], indirect=True)
@pytest.mark.parametrize("field", ["selected", "managed_path"])
def test_audio_inspection_cannot_change_selection_or_path(selection, field):
    audio = selection.inspect.return_value
    value = (
        replace(audio.selected, byte_size=999)
        if field == "selected"
        else selection.path.parent / "different"
    )
    selection.inspect.return_value = replace(audio, **{field: value})
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolver._verified_media(*selection.args)
    assert caught.value.code == "AUDIO_SELECTION_CHANGED"


@pytest.fixture
def resolved(tmp_path):
    bindings, inputs = engineering_inputs()
    refs = (bindings.blue_video, bindings.red_video, bindings.dialogue_tone, bindings.bgm_tone)
    selectors = [resolver.AssetVersionSelector(ref.asset_id, ref.asset_version_id) for ref in refs]
    request = resolver.TestSelectionRequest(
        tmp_path / "unused.sqlite3",
        tmp_path / "unused-manifest.json",
        *selectors,
        resolver.TestSubtitleStyle("Synthetic Font", 32, "#FFFFFFFF"),
    )
    items = tuple(
        resolver._VerifiedMedia(
            ref=ref,
            file=resolver.MltFileIdentity(tmp_path / str(index), ref.sha256),
            rights=AuthoritativeRightsDecision(
                project_id=bindings.project_id,
                asset_id=ref.asset_id,
                version_id=ref.asset_version_id,
                asset_sha256=ref.sha256,
                decision_id=ref.rights_decision_id,
                revision=1,
                decision="CLEARED",
                decision_content_hash="a" * 64,
                evidence_sha256="b" * 64,
                actor_id="synthetic-unit-test",
            ),
        )
        for index, ref in enumerate(refs)
    )
    return resolver.ResolvedEngineeringTest(
        request,
        bindings,
        build_art04_synthetic_execution_plan(bindings, **inputs),
        resolver.MltFileIdentity(request.manifest_path, "9" * 64),
        resolver.MltFileIdentity(tmp_path / "unused.srt", "a" * 64),
        items,
    )


@pytest.mark.parametrize(
    "change,code",
    [
        ("fixture_manifest", "FIXTURE_CHANGED"),
        ("subtitle_file", "FIXTURE_CHANGED"),
        ("bindings", "BINDINGS_CHANGED"),
        ("selected_media", "SELECTION_CHANGED"),
        ("plan", "PLAN_CHANGED"),
        ("resources", "RESOURCE_CHANGED"),
        ("duplicate", "RESOURCE_CHANGED"),
    ],
)
def test_revalidation_rejects_each_changed_authority(resolved, monkeypatch, change, code):
    resources = tuple(item.file for item in resolved.selected_media) + (resolved.subtitle_file,)
    current = resolved
    if change == "resources":
        resources = resources[:-1]
    elif change == "duplicate":
        resources += (resources[0],)
    elif change in {"fixture_manifest", "subtitle_file"}:
        current = replace(resolved, **{change: replace(getattr(resolved, change), sha256="0" * 64)})
    elif change == "selected_media":
        current = replace(resolved, selected_media=resolved.selected_media[:-1])
    else:
        current = replace(resolved, **{change: object()})
    monkeypatch.setattr(resolver, "prepare_test_selection", lambda _: current)
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolved.revalidate(resolved.plan, resources)
    assert caught.value.code == code


def test_revalidation_accepts_exact_set_and_current_media_receipts(resolved, monkeypatch):
    monkeypatch.setattr(resolver, "prepare_test_selection", lambda _: resolved)
    resources = tuple(item.file for item in resolved.selected_media) + (resolved.subtitle_file,)
    assert resolved.revalidate(resolved.plan, resources) is None
    monkeypatch.setattr(resolver, "_frozen_database", lambda _: nullcontext())
    monkeypatch.setattr(resolver, "_load_manifest", lambda _: object())
    monkeypatch.setattr(resolver, "_verified_media", lambda *_: resolved.selected_media[0])
    selected = resolved.resolve_selected(resolved.selected_media[0].ref)
    assert selected.media == resolved.selected_media[0].ref
    assert selected.file == resources[0]


@pytest.mark.parametrize(
    "change,code",
    [
        ("unknown-ref", "PLAN_MEDIA_UNKNOWN"),
        ("unknown-selector", "PLAN_MEDIA_UNKNOWN"),
        ("ref", "PLAN_MEDIA_CHANGED"),
        ("rights", "PLAN_MEDIA_CHANGED"),
        ("file", "PLAN_FILE_CHANGED"),
    ],
)
def test_adapter_callback_rereads_authority_and_rejects_drift(resolved, monkeypatch, change, code):
    selected = resolved.selected_media[0]
    ref = selected.ref
    if change == "unknown-ref":
        ref = ref.model_copy(update={"sha256": "0" * 64})
    elif change == "unknown-selector":
        resolved = replace(
            resolved,
            request=replace(
                resolved.request,
                blue_video=resolved.request.red_video,
            ),
        )
    elif change == "ref":
        selected = replace(selected, ref=ref.model_copy(update={"sha256": "0" * 64}))
    elif change == "rights":
        selected = replace(selected, rights=selected.rights.model_copy(update={"revision": 2}))
    else:
        selected = replace(selected, file=replace(selected.file, sha256="0" * 64))
    monkeypatch.setattr(resolver, "_frozen_database", lambda _: nullcontext())
    monkeypatch.setattr(resolver, "_load_manifest", lambda _: object())
    monkeypatch.setattr(resolver, "_verified_media", lambda *_: selected)
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolved.resolve_selected(ref)
    assert caught.value.code == code


@pytest.fixture
def prepared(resolved, monkeypatch):
    bindings, inputs = engineering_inputs()
    items = list(resolved.selected_media)
    for index in range(4):
        if index < 2:
            items[index] = replace(
                items[index], probe=inputs["blue_probe" if index == 0 else "red_probe"]
            )
        else:
            ref = items[index].ref
            selected = version(
                "audio",
                asset_id=ref.asset_id,
                version_id=ref.asset_version_id,
                sha256=ref.sha256,
                byte_size=ref.byte_size,
            )
            items[index] = replace(
                items[index],
                audio=VerifiedTestAudio(
                    selected,
                    inputs["dialogue_inspection" if index == 2 else "bgm_inspection"],
                    items[index].file.path,
                ),
            )
    manifest = SimpleNamespace(
        project_id=bindings.project_id,
        episode_id=bindings.episode_id,
        script_version_id=bindings.test_script_version_id,
        script_content_hash=bindings.test_script_content_hash,
        first_block_id=bindings.first_script_block_id,
        second_block_id=bindings.second_script_block_id,
        files={
            "subtitle-test.srt": resolver._FixtureFile(
                resolved.subtitle_file.path,
                bindings.subtitle_file_sha256,
                100,
            )
        },
    )
    monkeypatch.setattr(resolver, "_frozen_database", lambda _: nullcontext())
    monkeypatch.setattr(resolver, "_load_manifest", lambda _: manifest)
    monkeypatch.setattr(resolver, "_read_script_record", lambda *_: inputs["test_script_record"])
    monkeypatch.setattr(
        resolver,
        "_verified_media",
        lambda _db, _manifest, name, _selector: items[resolver._FILE_NAMES.index(name)],
    )
    return resolved.request, items


def test_prepare_maps_four_synthetic_selections_to_test_only_plan(prepared):
    request, items = prepared
    result = resolver.prepare_test_selection(request)
    assert result.selected_media == tuple(items)
    assert result.plan.scope == "ENGINEERING_TEST"
    assert result.plan.total_frames == 125
    assert result.bindings.blue_video == items[0].ref
    assert result.bindings.bgm_tone == items[3].ref


@pytest.mark.parametrize("change", ["selectors", "hashes", "blue", "red", "dialogue", "bgm"])
def test_prepare_requires_distinct_inputs_and_complete_inspections(prepared, change):
    request, items = prepared
    if change == "selectors":
        request = replace(request, red_video=request.blue_video)
    elif change == "hashes":
        items[1] = replace(
            items[1], ref=items[1].ref.model_copy(update={"sha256": items[0].ref.sha256})
        )
    else:
        index = {"blue": 0, "red": 1, "dialogue": 2, "bgm": 3}[change]
        items[index] = replace(items[index], **{"probe" if index < 2 else "audio": None})
    with pytest.raises(resolver.TestSelectionError) as caught:
        resolver.prepare_test_selection(request)
    assert caught.value.code == (
        "ASSET_SELECTION_CONFLICT" if change in {"selectors", "hashes"} else "INSPECTION_MISSING"
    )
