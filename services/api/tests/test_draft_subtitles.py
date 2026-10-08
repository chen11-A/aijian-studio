"""Saved literal cues, safe literal rendering and actual decoded frame boundaries."""

import hashlib
import json

import pytest
from aijian_api.assembly_subtitles import SUBTITLE_FONT_SHA256, SUBTITLE_PROFILE
from aijian_api.draft_export_encoder import encode_draft
from aijian_api.draft_export_runtime import DraftExportRuntime
from aijian_api.draft_subtitles import DraftSubtitleError, prepare_subtitles
from aijian_api.episode_media_assembly_contracts import (
    AssemblyTextSubtitleSegmentV1,
    CreateEpisodeMediaAssemblyVersionRequest,
    EpisodeMediaAssemblyContentV1,
)
from aijian_api.episode_media_assembly_store import EpisodeMediaAssemblyStore
from aijian_api.repository import StudioRepository
from pydantic import ValidationError
from test_draft_export_encoder import _assembly, _png, _run, _snapshots, _visual
from test_draft_export_encoder import toolchain as toolchain
from test_draft_export_runtime import fixture, request_for, wait_final


def cue(text="你好 AIVORA", start=3, end=6, id="seg_subtitle"):
    return {
        "segment_id": id,
        "text": text,
        "start_frame": start,
        "end_frame": end,
        "render_profile": SUBTITLE_PROFILE,
    }


def test_literal_contract_preserves_text_and_rejects_unsupported_content():
    original = cue("100% [x] '\\:;\n中文，测试。")
    assert AssemblyTextSubtitleSegmentV1.model_validate(original).model_dump() == original
    for text in [
        "",
        " \n测试",
        "三\n行\n字",
        "A" * 29,
        "emoji😀",
        "العربية",
        "a\u0301",
        "a\x00",
        "a\r",
        "\u202eabc",
    ]:
        with pytest.raises(ValidationError):
            AssemblyTextSubtitleSegmentV1.model_validate(cue(text))
    for update in [
        {"start_frame": 1.5},
        {"end_frame": 3},
        {"render_profile": "unverified"},
        {"fontfile": "/tmp/a"},
    ]:
        with pytest.raises(ValidationError):
            AssemblyTextSubtitleSegmentV1.model_validate({**original, **update})


def test_saved_cues_reopen_and_keep_legacy_hashes(tmp_path):
    repository, project, episode, _asset, legacy = fixture(tmp_path)
    store = EpisodeMediaAssemblyStore(repository)
    original = legacy.content.model_dump(mode="json")
    content = EpisodeMediaAssemblyContentV1.model_validate(
        {**original, "subtitle_segments": [cue()]}
    )
    saved = store.create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=content,
            parent_version_id=legacy.version_id,
            expected_revision=legacy.head_revision,
            change_summary="Add exact literal subtitle",
        ),
        author_actor_id="synthetic-user",
    )
    reopened = EpisodeMediaAssemblyStore(StudioRepository(repository.database_path))
    assert (
        reopened.read_version(project, episode).content.subtitle_segments[0].model_dump() == cue()
    )
    assert (
        reopened.read_version(project, episode, version_id=legacy.version_id).content_hash
        == legacy.content_hash
    )
    assert (
        reopened.read_version(project, episode, version_id=legacy.version_id).content.model_dump(
            mode="json"
        )
        == original
    )
    changed = content.model_dump(mode="json")
    changed["subtitle_segments"][0]["text"] = "修改文字"
    updated = store.create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=EpisodeMediaAssemblyContentV1.model_validate(changed),
            parent_version_id=saved.version_id,
            expected_revision=saved.head_revision,
            change_summary="Edit same cue identity",
        ),
        author_actor_id="synthetic-user",
    )
    assert updated.content_hash != saved.content_hash
    assert (
        updated.content.subtitle_segments[0].segment_id
        == saved.content.subtitle_segments[0].segment_id
    )
    with pytest.raises(ValidationError, match="overlap"):
        EpisodeMediaAssemblyContentV1.model_validate(
            {**original, "subtitle_segments": [cue(), cue(start=5, end=9, id="seg_other")]}
        )


@pytest.mark.parametrize("rate", [(24, 1), (24000, 1001), (30000, 1001)])
def test_actual_pixels_on_exact_half_open_frames(tmp_path, toolchain, rate):
    image = _png(tmp_path / "black.png", (0, 0, 0))
    first = cue("你好 AIVORA\n100% [x] '\\:;")
    second = cue("literal %{n} $(touch x)", start=10, end=14, id="seg_literal")
    assembly = _assembly(
        [_visual(image, 0, 18)],
        canvas_width=320,
        canvas_height=180,
        sequence_timebase={
            "frame_rate": {"num": rate[0], "den": rate[1]},
            "timecode_mode": "NON_DROP_FRAME",
        },
        subtitle_segments=[first, second],
    )
    output = tmp_path / "subtitle-synthetic.mp4"
    result = encode_draft(
        assembly,
        _snapshots(tmp_path, [image]),
        output,
        toolchain,
        on_progress=lambda _: None,
        stop_requested=lambda: False,
    )
    proof = json.loads(result.probe_json)["subtitles"]
    assert proof["font_sha256"] == SUBTITLE_FONT_SHA256
    assert proof["render_profile"] == SUBTITLE_PROFILE
    assert proof["cues"][0]["text_sha256"] == hashlib.sha256(first["text"].encode()).hexdigest()
    assert proof["cues"][0]["start_frame"] == 3
    raw = _run(
        toolchain, "-i", str(output), "-map", "0:v:0", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"
    )
    frame_bytes = 320 * 180 * 3
    assert len(raw) == frame_bytes * 18
    lit = []
    for frame in range(18):
        pixels = raw[frame * frame_bytes : (frame + 1) * frame_bytes]
        lit.append(sum(value > 180 for value in pixels) > 20)
    assert lit == [3 <= n < 6 or 10 <= n < 14 for n in range(18)]
    assert not (tmp_path / "x").exists()
    assert not list(tmp_path.glob("aivora-subtitles-*"))


def test_font_change_and_literal_files_fail_closed(tmp_path, monkeypatch):
    image = _png(tmp_path / "black.png", (0, 0, 0))
    assembly = _assembly([_visual(image, 0, 18)], subtitle_segments=[cue()])
    directory = tmp_path / "private"
    directory.mkdir()
    prepared = prepare_subtitles(assembly.content, directory)
    assert "你好" not in prepared.filters
    assert "textfile=cue_000.txt:expansion=none" in prepared.filters
    (directory / "cue_000.txt").write_text("modified")
    with pytest.raises(DraftSubtitleError):
        prepared.verify()
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "NotoSansCJKsc-Regular.otf").write_bytes(b"not the pinned font")
    monkeypatch.setattr("aijian_api.draft_subtitles._font_root", lambda: bad)
    with pytest.raises(DraftSubtitleError, match="missing or changed"):
        prepare_subtitles(assembly.content, bad)


def test_runtime_publishes_saved_subtitles_with_font_provenance(tmp_path, toolchain):
    repository, project, episode, _asset, legacy = fixture(tmp_path)
    content = EpisodeMediaAssemblyContentV1.model_validate(
        {
            **legacy.content.model_dump(mode="json"),
            "subtitle_segments": [cue()],
        }
    )
    saved = EpisodeMediaAssemblyStore(repository).create_version(
        project,
        episode,
        CreateEpisodeMediaAssemblyVersionRequest(
            content=content,
            parent_version_id=legacy.version_id,
            expected_revision=legacy.head_revision,
            change_summary="Synthetic subtitles",
        ),
        author_actor_id="synthetic-user",
    )
    runtime = DraftExportRuntime(repository, lambda: toolchain)
    request = request_for(saved, tmp_path / "DRAFT-subtitles.mp4")
    runtime.submit(project, episode, request)
    result = wait_final(runtime, project, episode, request.operation_id)
    runtime.join_workers()
    assert result.status == "SUCCEEDED", result
    with repository._connection() as connection:
        row = connection.execute(
            "SELECT verification_json, provenance_json FROM draft_export_jobs WHERE operation_id=?",
            (request.operation_id,),
        ).fetchone()
    proof = json.loads(row[0])
    assert proof["subtitles"]["font_sha256"] == SUBTITLE_FONT_SHA256
    assert proof["subtitles"]["cues"][0]["segment_id"] == "seg_subtitle"
    assert json.loads(row[1])["assembly"]["media_checks"][0]["rights_status"] == "PENDING_REVIEW"
    reopened = DraftExportRuntime(StudioRepository(repository.database_path), lambda: toolchain)
    assert (
        reopened.get(project, episode, request.operation_id).output_sha256 == result.output_sha256
    )
