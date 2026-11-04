"""Synthetic MP4 headers and probe receipts; not encoding or playback evidence."""

import hashlib
from pathlib import Path
from unittest.mock import Mock

import pytest
from aijian_api import product_export_output_verify as output
from aijian_api.media_probe import LocalMediaProbeData
from test_product_media_preflight_boundaries import payload
from test_timeline_export import _probe, _toolchain


@pytest.fixture
def material(tmp_path, monkeypatch):
    data = b"\0\0\0\x18ftypisom" + b"\0" * 88
    path = tmp_path / "output.mp4"
    path.write_bytes(data)
    digest = hashlib.sha256(data).hexdigest()
    probe = Mock(return_value=_probe("sha256:" + digest, 30, audio_rate=None))
    monkeypatch.setattr(output, "probe_local_media", probe)
    return path, data, digest, probe


def verify(material, **changes):
    path, _, _, _ = material
    arguments = dict(
        root=path.parent,
        filename=path.name,
        spec=payload().spec,
        total_frames=30,
        toolchain=_toolchain(path.parent),
        expect_audio=False,
    )
    arguments.update(changes)
    return output.verify_local_mp4(**arguments)


@pytest.mark.parametrize("with_audio", [False, True])
def test_output_receipt_binds_exact_bytes_and_validated_probe(material, with_audio):
    path, data, digest, probe = material
    if with_audio:
        value = _probe("sha256:" + digest, 30).model_dump()
        value["audio"]["channels"] = 2
        probe.return_value = LocalMediaProbeData.model_validate(value)
    result = verify(material, expect_audio=with_audio)
    assert result.sha256 == digest and result.byte_size == len(data)
    assert result.absolute_path == str(path)
    assert result.probe_hash == "sha256:" + hashlib.sha256(result.probe_json.encode()).hexdigest()
    assert path.read_bytes() == data and probe.call_count == 1


@pytest.mark.parametrize("frames", [True, 0, -1, "30"])
def test_invalid_duration_stops_before_probe(material, frames):
    with pytest.raises(output.ProductExportOutputError) as error:
        verify(material, total_frames=frames)
    assert error.value.code == "INVALID_DURATION"
    material[3].assert_not_called()


@pytest.mark.parametrize("filename", ["../out.mp4", "out.MP4", "dir/out.mp4", "C:out.mp4"])
def test_unsafe_output_names_cannot_reach_media_probe(material, filename):
    with pytest.raises(output.ProductExportOutputError) as error:
        verify(material, filename=filename)
    assert error.value.code == "OUTPUT_FILENAME"
    material[3].assert_not_called()


@pytest.mark.parametrize("kind", ["relative", "missing", "file"])
def test_managed_root_must_be_existing_local_directory(material, kind):
    path = material[0]
    root = {"relative": Path("relative"), "missing": path.parent / "missing", "file": path}[kind]
    with pytest.raises(output.ProductExportOutputError) as error:
        verify(material, root=root)
    assert error.value.code == "OUTPUT_ROOT_UNSAFE"
    material[3].assert_not_called()


@pytest.mark.parametrize("data", [b"", b"short", b"\0\0\0\x18wrongbrand", b"\0\0\0\x18ftypxxxx"])
def test_invalid_mp4_bytes_stop_before_probe(material, data):
    material[0].write_bytes(data)
    with pytest.raises(output.ProductExportOutputError) as error:
        verify(material)
    assert error.value.code == ("OUTPUT_SIZE" if not data else "OUTPUT_CONTAINER")
    material[3].assert_not_called()


def test_missing_file_returns_unavailable_without_probe(material):
    material[0].unlink()
    with pytest.raises(output.ProductExportOutputError) as error:
        verify(material)
    assert error.value.code == "OUTPUT_UNAVAILABLE"
    material[3].assert_not_called()


def test_bytes_changed_during_probe_cannot_issue_receipt(material):
    path, data, _, probe = material
    receipt = probe.return_value

    def change(*_):
        path.write_bytes(data[:-1] + b"x")
        return receipt

    probe.side_effect = change
    with pytest.raises(output.ProductExportOutputError) as error:
        verify(material)
    assert error.value.code == "OUTPUT_CHANGED" and probe.call_count == 1


@pytest.mark.parametrize("fault", ["codec", "audio", "duration"])
def test_probe_mismatch_cannot_issue_receipt(material, fault):
    probe = material[3]
    value = probe.return_value.model_dump()
    if fault == "codec":
        value["video"]["codec_name"] = "vp9"
    elif fault == "duration":
        value["container_duration"] = {"num": 10, "den": 1}
    else:
        value = _probe("sha256:" + material[2], 30).model_dump()
    probe.return_value = LocalMediaProbeData.model_validate(value)
    with pytest.raises(output.ProductExportOutputError) as error:
        verify(material, expect_audio=fault == "audio")
    assert error.value.code == (
        "OUTPUT_DURATION_MISMATCH" if fault == "duration" else "OUTPUT_SPEC_MISMATCH"
    )
