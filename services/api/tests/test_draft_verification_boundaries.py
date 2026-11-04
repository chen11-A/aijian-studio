"""Real sealed byte reads with synthetic probe replies; not playable-output evidence."""

import hashlib
import json
from contextlib import ExitStack
from dataclasses import replace
from fractions import Fraction
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from aijian_api import draft_export_encoder as encoder
from test_draft_export_encoder import _assembly, _audio, _visual


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    path = tmp_path / "synthetic.mp4"
    data = b"\x00\x00\x00\x18ftypisom" + b"\0" * 100
    path.write_bytes(data)
    assembly = _assembly([_visual(path, 0, 24, kind="video")])
    runner = Mock()
    runner.toolchain = SimpleNamespace(
        profile_id="synthetic", ffmpeg_sha256="1" * 64, ffprobe_sha256="2" * 64
    )

    def hash_stream(stream):
        stream.seek(0)
        digest = hashlib.sha256(stream.read()).hexdigest()
        stream.seek(0)
        return digest

    runner.hash_stream.side_effect = hash_stream
    media = encoder._Media(
        24,
        Fraction(0),
        Fraction(24),
        64,
        64,
        "h264",
        "yuv420p",
        None,
        Fraction(1),
        encoder.DRAFT_TITLE,
        encoder.DRAFT_COMMENT,
    )
    probe = Mock(return_value=media)
    monkeypatch.setattr(encoder, "_probe", probe)
    return path, data, assembly, runner, media, probe


def verify(fixture, *, audio=False, subtitles=None):
    path, _, assembly, runner, _, _ = fixture
    return encoder._verify_output(
        path, assembly, runner, audio, 48_000, subtitle_evidence=subtitles
    )


@pytest.mark.parametrize("with_audio", [False, True])
def test_output_receipt_binds_sealed_bytes_and_explicit_track_selection(fixture, with_audio):
    path, data, assembly, runner, media, probe = fixture
    if with_audio:
        probe.return_value = replace(
            media, audio=encoder._Audio(48000, 48000, Fraction(0), "aac", 2)
        )
    result = verify(fixture, audio=with_audio, subtitles={"synthetic": "evidence"})
    assert result.sha256 == hashlib.sha256(data).hexdigest()
    assert result.byte_size == len(data)
    payload = json.loads(result.probe_json)
    assert payload["assembly_content_hash"] == assembly.content_hash
    assert payload["subtitles"] == {"synthetic": "evidence"}
    assert (payload["audio"] is not None) == with_audio
    assert result.probe_hash == "sha256:" + hashlib.sha256(result.probe_json.encode()).hexdigest()
    arguments = runner.run.call_args.args[0]
    assert ("0:a:0" in arguments) == with_audio
    assert arguments[-3:] == ["-f", "null", "-"]
    assert path.read_bytes() == data


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("codec", "mpeg4"),
        ("title", None),
        ("comment", "wrong"),
        ("pixel_format", "yuv444p"),
        ("width", 66),
        ("height", 66),
        ("rate", Fraction(25)),
        ("frames", 23),
        ("first_time", Fraction(1)),
        ("duration", None),
        ("duration", Fraction(2)),
        ("audio", encoder._Audio(48000, 48000, Fraction(0), "aac", 2)),
    ],
)
def test_output_spec_drift_never_reaches_decode_or_receipt(fixture, field, value):
    _, _, _, runner, media, probe = fixture
    probe.return_value = replace(media, **{field: value})
    with pytest.raises(encoder.DraftEncodeError) as error:
        verify(fixture)
    assert error.value.code == "OUTPUT_SPEC_MISMATCH"
    runner.run.assert_not_called()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("codec", "pcm_s16le"),
        ("sample_rate", 44100),
        ("channels", 1),
        ("first_time", Fraction(1, 48000)),
        ("samples", 47999),
        ("samples", 49025),
    ],
)
def test_output_audio_contract_drift_cannot_issue_receipt(fixture, field, value):
    _, _, _, runner, media, probe = fixture
    audio = encoder._Audio(48000, 48000, Fraction(0), "aac", 2)
    probe.return_value = replace(media, audio=replace(audio, **{field: value}))
    with pytest.raises(encoder.DraftEncodeError) as error:
        verify(fixture, audio=True)
    assert error.value.code == "OUTPUT_SPEC_MISMATCH"
    runner.run.assert_not_called()


@pytest.mark.parametrize("mutation", ["hash", "size"])
def test_final_output_hash_recheck_rejects_changed_receipt(fixture, monkeypatch, mutation):
    _, data, _, _, _, _ = fixture
    digest = hashlib.sha256(data).hexdigest()
    changed = ("f" * 64, len(data)) if mutation == "hash" else (digest, len(data) + 1)
    monkeypatch.setattr(
        encoder, "_guarded_file_hash", Mock(side_effect=[(digest, len(data)), changed])
    )
    with pytest.raises(encoder.DraftEncodeError) as error:
        verify(fixture)
    assert error.value.code == "OUTPUT_CHANGED"


def test_output_size_limit_stops_before_probe(fixture, monkeypatch):
    _, data, _, runner, _, probe = fixture
    monkeypatch.setattr(encoder, "MAX_OUTPUT_BYTES", len(data) - 1)
    with pytest.raises(encoder.DraftEncodeError) as error:
        verify(fixture)
    assert error.value.code == "OUTPUT_SIZE"
    probe.assert_not_called()
    runner.run.assert_not_called()


def test_missing_output_preserves_typed_failure(fixture):
    path, _, _, runner, _, probe = fixture
    path.unlink()
    with pytest.raises(encoder.DraftEncodeError) as error:
        verify(fixture)
    assert error.value.code == "OUTPUT_UNAVAILABLE"
    runner.run.assert_not_called()
    probe.assert_not_called()


@pytest.mark.parametrize("mutation", ["empty", "hash", "missing"])
def test_seal_source_refuses_bad_bytes_and_closes_handle(fixture, mutation):
    path, data, _, runner, _, _ = fixture
    digest = hashlib.sha256(data).hexdigest()
    if mutation == "empty":
        path.write_bytes(b"")
    elif mutation == "hash":
        digest = "f" * 64
    else:
        path.unlink()
    with ExitStack() as stack, pytest.raises(encoder.DraftEncodeError) as error:
        encoder._seal_source(path, digest, "video", runner, stack)
    assert (
        error.value.code
        == {"empty": "SOURCE_SIZE", "hash": "SOURCE_CHANGED", "missing": "SOURCE_PATH_UNSAFE"}[
            mutation
        ]
    )
    # A released deny-write handle must not prevent replacing the test file.
    path.write_bytes(data)


@pytest.mark.parametrize("kind", ["visual", "audio", "source_set"])
def test_conflicting_source_identity_stops_before_reading_sources(fixture, monkeypatch, kind):
    path, _, _, runner, _, _ = fixture
    visuals = [_visual(path, 0, 24, kind="video")]
    audio = []
    if kind == "visual":
        visuals.append(_visual(path, 24, 48, kind="image"))
    elif kind == "audio":
        audio.append(_audio(path, 0, 24, kind="BGM"))
    assembly = _assembly(visuals, audio)
    monkeypatch.setattr(encoder, "_Runner", Mock(return_value=runner))
    seal = Mock(side_effect=AssertionError("must not seal"))
    monkeypatch.setattr(encoder, "_seal_source", seal)
    with pytest.raises(encoder.DraftEncodeError) as error:
        encoder.encode_draft(
            assembly,
            {},
            path.parent / "new.mp4",
            SimpleNamespace(),
            on_progress=Mock(),
            stop_requested=lambda: False,
        )
    assert error.value.code == (
        "SOURCE_SET_MISMATCH" if kind == "source_set" else "SOURCE_KIND_CONFLICT"
    )
    seal.assert_not_called()
    runner.run.assert_not_called()


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("rate", Fraction(25), "VIDEO_FRAME_RATE_MISMATCH"),
        ("frames", 23, "VIDEO_RANGE_UNSUPPORTED"),
        ("audio", None, "EMBEDDED_AUDIO_MISSING"),
        (
            "audio",
            encoder._Audio(48000, 96000, Fraction(1), "aac", 2),
            "EMBEDDED_AUDIO_OFFSET_UNSUPPORTED",
        ),
        ("audio", encoder._Audio(48000, 47999, Fraction(0), "aac", 2), "AUDIO_RANGE_UNSUPPORTED"),
    ],
)
def test_selected_video_trim_and_embedded_audio_are_checked_before_encode(
    fixture, monkeypatch, field, value, code
):
    path, data, _, runner, media, probe = fixture
    assembly = _assembly([_visual(path, 0, 24, kind="video", play=True)])
    probe.return_value = replace(media, **{field: value})
    runner.external_directory = None
    monkeypatch.setattr(encoder, "_Runner", Mock(return_value=runner))
    with pytest.raises(encoder.DraftEncodeError) as error:
        encoder.encode_draft(
            assembly,
            {hashlib.sha256(data).hexdigest(): path},
            path.parent / "new.mp4",
            SimpleNamespace(external_selected=False),
            on_progress=Mock(),
            stop_requested=lambda: False,
        )
    assert error.value.code == code
    runner.run.assert_not_called()
