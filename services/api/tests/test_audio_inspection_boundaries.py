"""Synthetic PCM files exercise byte identity; no decoder or QA approval is used."""

import hashlib
import struct
from dataclasses import replace
from unittest.mock import Mock

import pytest
from aijian_api import media_asset_audio_inspection as audio
from aijian_api.artifacts import canonical_content_bytes
from aijian_api.media_asset_selected_reader import SelectedMediaAssetRead
from test_media_type_narrowing import PCM_FORMAT, wav
from test_product_media_preflight_boundaries import ASSET, PROJECT, VERSION, version


@pytest.fixture
def managed(tmp_path, monkeypatch):
    data = wav((b"fmt ", PCM_FORMAT), (b"data", b"\0\0" * 48_000))
    digest = hashlib.sha256(data).hexdigest()
    path = tmp_path / "media-assets" / "blobs" / digest[:2] / digest
    path.parent.mkdir(parents=True)
    path.write_bytes(data)
    selected = version("audio", byte_size=len(data), sha256=digest)
    reader = Mock(return_value=SelectedMediaAssetRead("VERIFIED", selected))
    monkeypatch.setattr(audio, "read_selected_media_asset_version", reader)
    return tmp_path / "unused.db", path, data, selected, reader


def inspect(database, expected=48_000):
    return audio.inspect_selected_test_wav(
        database, PROJECT, ASSET, VERSION, expected_samples=expected
    )


def test_stable_real_pcm_bytes_produce_recomputable_inspection(managed):
    database, path, data, selected, reader = managed
    result = inspect(database)
    expected = {
        "inspection_domain": audio.INSPECTION_DOMAIN,
        "project_id": PROJECT,
        "asset_id": ASSET,
        "asset_version_id": VERSION,
        "asset_sha256": hashlib.sha256(data).hexdigest(),
        "byte_size": len(data),
        "codec": "PCM_S16LE",
        "channels": 1,
        "sample_rate_hz": 48_000,
        "total_samples": 48_000,
    }
    assert (
        result.inspection.inspection_sha256
        == hashlib.sha256(canonical_content_bytes(expected)).hexdigest()
    )
    assert result.selected == selected
    assert result.managed_path == path
    assert reader.call_count == 2
    assert all(call.args == (database, PROJECT, ASSET, VERSION) for call in reader.call_args_list)
    assert path.read_bytes() == data
    assert not database.exists()


@pytest.mark.parametrize("expected", [0, 48_001, 240_001])
def test_unsupported_range_never_reads_asset(managed, expected):
    database, _, _, _, reader = managed
    with pytest.raises(audio.TestAudioInspectionError) as error:
        inspect(database, expected)
    assert error.value.code == "AUDIO_RANGE_UNSUPPORTED"
    reader.assert_not_called()


@pytest.mark.parametrize("selected", [None, version("video")])
def test_verified_receipt_without_audio_cannot_open_file(managed, monkeypatch, selected):
    database, _, _, _, reader = managed
    reader.return_value = SelectedMediaAssetRead("VERIFIED", selected)
    opener = Mock(side_effect=AssertionError("must not open"))
    monkeypatch.setattr(audio, "_open_local_source", opener)
    with pytest.raises(audio.TestAudioInspectionError) as error:
        inspect(database)
    assert error.value.code == "AUDIO_ASSET_UNVERIFIED"
    opener.assert_not_called()


def test_wrong_sample_count_stops_before_second_asset_read(managed):
    database, _, _, _, reader = managed
    with pytest.raises(audio.TestAudioInspectionError) as error:
        inspect(database, 240_000)
    assert error.value.code == "AUDIO_SAMPLE_CONFLICT"
    assert reader.call_count == 1


@pytest.mark.parametrize("change", ["status", "missing", "version"])
def test_changed_asset_receipt_cannot_issue_inspection(managed, change):
    database, _, _, selected, reader = managed
    after = {
        "status": SelectedMediaAssetRead("UNKNOWN_MEDIA_CHANGED", selected),
        "missing": SelectedMediaAssetRead("VERIFIED"),
        "version": SelectedMediaAssetRead("VERIFIED", replace(selected, ordinal=2)),
    }[change]
    reader.side_effect = [SelectedMediaAssetRead("VERIFIED", selected), after]
    with pytest.raises(audio.TestAudioInspectionError) as error:
        inspect(database)
    assert error.value.code == "AUDIO_ASSET_CHANGED"
    assert reader.call_count == 2


@pytest.mark.parametrize("call_index", [1, 5])
@pytest.mark.parametrize("failure", [OSError, ValueError])
def test_unsafe_managed_directory_or_file_is_rejected(managed, monkeypatch, call_index, failure):
    database, _, _, selected, _ = managed
    real = audio.managed_local_io_path
    calls = 0

    def resolve(*args):
        nonlocal calls
        calls += 1
        if calls == call_index:
            raise failure("synthetic unsafe path")
        return real(*args)

    monkeypatch.setattr(audio, "managed_local_io_path", resolve)
    with pytest.raises(audio.TestAudioInspectionError) as error:
        audio._managed_path(database, selected.sha256)
    assert error.value.code == "AUDIO_PATH_UNSAFE"


@pytest.mark.parametrize("remote", [False, True])
def test_nonplain_or_remote_workspace_is_rejected(managed, monkeypatch, remote):
    database, _, _, selected, _ = managed
    monkeypatch.setattr(audio, "_is_remote_windows_path", lambda _: remote)
    if not remote:
        monkeypatch.setattr(audio, "_plain_directory", lambda _: False)
    with pytest.raises(audio.TestAudioInspectionError) as error:
        audio._managed_path(database, selected.sha256)
    assert error.value.code == "AUDIO_PATH_UNSAFE"


def test_missing_blob_is_not_created(managed):
    database, path, _, selected, _ = managed
    path.unlink()
    with pytest.raises(audio.TestAudioInspectionError) as error:
        audio._managed_path(database, selected.sha256)
    assert error.value.code == "AUDIO_PATH_UNSAFE"
    assert not path.exists()


@pytest.mark.parametrize(
    ("mutation", "code"),
    [
        ("oversized", "AUDIO_SIZE_UNSUPPORTED"),
        ("size", "AUDIO_IDENTITY_CHANGED"),
        ("hash", "AUDIO_IDENTITY_CHANGED"),
        ("missing", "AUDIO_READ_UNKNOWN"),
    ],
)
def test_byte_identity_failures_do_not_return_data(managed, mutation, code):
    database, path, _, selected, _ = managed
    if mutation == "oversized":
        selected = replace(selected, byte_size=audio.MAX_TEST_WAV_BYTES + 1)
    elif mutation == "size":
        selected = replace(selected, byte_size=selected.byte_size + 1)
    elif mutation == "hash":
        selected = replace(selected, sha256="f" * 64)
    else:
        path.unlink()
    with pytest.raises(audio.TestAudioInspectionError) as error:
        audio._read_same_file(database.parent, path, selected)
    assert error.value.code == code


@pytest.mark.parametrize("metadata", [b"INFO", b"INFOx", b"INFOxy"])
def test_bounded_info_metadata_preserves_exact_pcm_count(metadata):
    data = wav((b"fmt ", PCM_FORMAT), (b"LIST", metadata), (b"data", b"\0\0" * 20))
    assert audio._pcm_sample_count(data) == 20


@pytest.mark.parametrize("metadata", [b"", b"INF", b"JUNK", b"NOTINFO"])
def test_non_info_metadata_is_rejected(metadata):
    data = wav((b"fmt ", PCM_FORMAT), (b"LIST", metadata), (b"data", b"\0\0" * 20))
    with pytest.raises(audio.TestAudioInspectionError) as error:
        audio._pcm_sample_count(data)
    assert error.value.code == "AUDIO_FORMAT_UNSUPPORTED"


@pytest.mark.parametrize("tail", [b"x", b"1234567", b"JUNK\x01\0\0\0x", b"data\xff\xff\xff\x7f"])
def test_truncated_chunks_are_rejected_even_when_riff_size_matches(tail):
    valid = wav((b"fmt ", PCM_FORMAT), (b"data", b"\0\0" * 20))
    data = valid[:4] + struct.pack("<I", len(valid) + len(tail) - 8) + valid[8:] + tail
    with pytest.raises(audio.TestAudioInspectionError) as error:
        audio._pcm_sample_count(data)
    assert error.value.code == "AUDIO_FORMAT_UNSUPPORTED"
