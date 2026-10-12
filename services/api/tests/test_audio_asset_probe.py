"""Pure audio source timing; synthetic probe boundaries and actual Linux WAV are distinct."""

import hashlib
import json
import os
import wave
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

import pytest
from aijian_api import audio_asset_probe_store as audio_store
from aijian_api.audio_asset_probe_routes import AudioAssetProbeEvidenceResponse
from aijian_api.audio_asset_probe_store import AudioAssetProbeEvidenceStore
from aijian_api.domain import TrustedReviewActor
from aijian_api.local_media_toolchain import LocalMediaToolchainService
from aijian_api.main import create_app
from aijian_api.media_asset_probe_store import MediaAssetProbeEvidenceError
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.media_probe import MediaProbeError, probe_local_audio, probe_local_media
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from test_draft_export_runtime import toolchain
from test_media_probe import _audio_frames_payload, _runner_for, _summary_payload, _toolchain
from test_probe_store_boundaries import sqlite_row


def pure_summary(source, rate="32000"):
    result = _summary_payload(source.stat().st_size, audio_rate=rate)
    result["streams"] = result["streams"][1:]
    result["format"]["format_name"] = "wav"
    return result


@pytest.mark.parametrize("rate", [32000, 44100, 48000, 96000, 192000, 384000])
def test_audio_source_rate_is_not_replaced_with_export_or_decoder_rate(tmp_path, rate):
    source = tmp_path / "synthetic.wav"
    source.write_bytes(b"synthetic-not-decoded")
    commands = []
    result = probe_local_audio(
        source.resolve(),
        _toolchain(tmp_path),
        command_runner=_runner_for(
            source, summary=pure_summary(source, str(rate)), commands=commands
        ),
    )
    assert result.video is None
    assert result.audio.sample_rate_hz == rate
    assert result.audio.total_samples == 2560
    assert result.source_asset_sha256 == "sha256:" + hashlib.sha256(source.read_bytes()).hexdigest()
    assert len(commands) == 2 and not any("v:0" in command for command in commands)


@pytest.mark.parametrize("layout", ["none", "video", "multiple", "subtitle"])
def test_audio_probe_rejects_cover_art_other_streams_and_multiple_audio(tmp_path, layout):
    source = tmp_path / "synthetic.wav"
    source.write_bytes(b"synthetic")
    summary = pure_summary(source)
    streams = summary["streams"]
    if layout == "none":
        summary["streams"] = []
    elif layout == "video":
        streams.append(_summary_payload(source.stat().st_size)["streams"][0])
    elif layout == "multiple":
        streams.append(dict(streams[0], index=2))
    else:
        streams.append({"index": 2, "codec_type": "subtitle"})
    with pytest.raises(MediaProbeError):
        probe_local_audio(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(source, summary=summary),
        )


@pytest.mark.parametrize("invalid", ["rate", "zero", "empty", "frame_owner", "boolean"])
def test_audio_probe_rejects_invalid_source_timing(tmp_path, invalid):
    source = tmp_path / "synthetic.wav"
    source.write_bytes(b"synthetic")
    summary = pure_summary(
        source, "384001" if invalid == "rate" else "0" if invalid == "zero" else "32000"
    )
    frames = _audio_frames_payload()
    if invalid == "empty":
        frames["frames"] = []
    elif invalid == "frame_owner":
        frames["frames"][0]["stream_index"] = 2
    elif invalid == "boolean":
        frames["frames"][0]["nb_samples"] = True
    with pytest.raises(MediaProbeError):
        probe_local_audio(
            source.resolve(),
            _toolchain(tmp_path),
            command_runner=_runner_for(source, summary=summary, audio_frames=frames),
        )


def test_original_video_probe_still_requires_video_and_accepted_embedded_audio_rate(tmp_path):
    source = tmp_path / "synthetic.wav"
    source.write_bytes(b"synthetic")
    for summary in [
        pure_summary(source),
        _summary_payload(source.stat().st_size, audio_rate="32000"),
    ]:
        with pytest.raises(MediaProbeError):
            probe_local_media(
                source.resolve(),
                _toolchain(tmp_path),
                command_runner=_runner_for(source, summary=summary),
            )


def wav_source(path, rate=32000, channels=2):
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(b"\x00\x00" * channels * (rate // 2))
    return path


@pytest.fixture
def selected(tmp_path, monkeypatch):
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    projects = [
        repository.create_project(
            name=name, aspect_ratio="16:9", target_duration_seconds=2, source_language="zh-CN"
        )
        for name in ("A", "B")
    ]
    source = wav_source(tmp_path / "录音.wav")
    asset = MediaAssetStore(repository).import_local(projects[0].id, source)
    result = probe_local_audio(
        source,
        _toolchain(tmp_path),
        command_runner=_runner_for(source, summary=pure_summary(source)),
    )
    runner = Mock(return_value=result)
    monkeypatch.setattr(audio_store, "probe_local_audio", runner)
    return repository, projects, asset, result, runner, _toolchain(tmp_path)


def persist(selected):
    repository, projects, asset, _, _, tools = selected
    return AudioAssetProbeEvidenceStore(repository).probe_selected_audio(
        projects[0].id, asset.id, asset.latest_version.id, tools
    )


def test_audio_uses_existing_immutable_table_and_reopens_exact_receipt(selected):
    repository, projects, asset, _, runner, _ = selected
    evidence = persist(selected)
    reopened = AudioAssetProbeEvidenceStore(StudioRepository(repository.database_path))
    assert reopened.read(projects[0].id, asset.id, asset.latest_version.id) == evidence
    assert persist(selected) == evidence
    with repository._connection() as connection:
        assert (
            connection.execute("SELECT count(*) FROM media_asset_probe_evidence").fetchone()[0] == 1
        )
    assert runner.call_count == 2
    with pytest.raises(MediaAssetProbeEvidenceError, match="Selected"):
        reopened.read(projects[1].id, asset.id, asset.latest_version.id)


@pytest.mark.parametrize("change", ["hash", "size", "metadata", "tool"])
def test_conflicting_audio_never_overwrites_original(selected, change):
    repository, projects, asset, result, runner, tools = selected
    original = persist(selected)
    if change == "tool":
        selected = (*selected[:-1], replace(tools, version="other"))
    else:
        runner.return_value = result.model_copy(
            update={"source_asset_sha256": "sha256:" + "f" * 64}
            if change == "hash"
            else {"byte_size": result.byte_size + 1}
            if change == "size"
            else {"format_names": ("other",)}
        )
    with pytest.raises(MediaAssetProbeEvidenceError):
        persist(selected)
    assert (
        AudioAssetProbeEvidenceStore(repository).read(
            projects[0].id, asset.id, asset.latest_version.id
        )
        == original
    )


@pytest.mark.parametrize("corruption", ["hash", "nested_bool", "old_video", "owner"])
def test_audio_rejects_corrupt_stored_body_even_when_rehashed(selected, corruption):
    repository, _, _, _, _, _ = selected
    persist(selected)
    with repository._connection() as connection:
        fields = dict(connection.execute("SELECT * FROM media_asset_probe_evidence").fetchone())
    payload = json.loads(fields["probe_json"])
    if corruption == "nested_bool":
        payload["audio"]["sample_rate_hz"] = True
    elif corruption == "old_video":
        payload["video"] = {}
    elif corruption == "owner":
        payload["source_asset_sha256"] = "sha256:" + "f" * 64
    fields["probe_json"] = json.dumps(payload)
    fields["probe_sha256"] = (
        "f" * 64
        if corruption == "hash"
        else hashlib.sha256(fields["probe_json"].encode()).hexdigest()
    )
    with pytest.raises(MediaAssetProbeEvidenceError):
        audio_store._from_audio_row(sqlite_row(fields))


def api_client(repository, tools, *, actor=None, security=True):
    token, host = "a" * 43, "127.0.0.1:43123"
    app = create_app(
        repository=repository,
        sidecar_security=SidecarSecurity(token=token, host=host) if security else None,
        local_media_toolchain=LocalMediaToolchainService(None, fallback=lambda: tools),
        review_actor=actor,
    )
    return TestClient(app, base_url=f"http://{host}", client=("127.0.0.1", 1234)), {
        "Authorization": f"Bearer {token}",
        "Origin": "app://aijian",
    }


def test_audio_route_has_same_auth_scope_and_writer_boundary(selected):
    repository, projects, asset, _, runner, tools = selected
    url = (
        f"/api/v1/projects/{projects[0].id}/assets/{asset.id}/versions/"
        f"{asset.latest_version.id}/audio-probe-evidence"
    )
    client, headers = api_client(repository, tools)
    with client:
        assert client.post(url).status_code == 401
        assert client.get(url, headers=headers).json()["error"]["code"] == "PROBE_NOT_FOUND"
        assert (
            client.post(url.replace(projects[0].id, projects[1].id), headers=headers).status_code
            == 404
        )
        runner.assert_not_called()
        assert client.post(url, headers=headers).status_code == 201
        assert client.get(url, headers=headers).headers["cache-control"] == "no-store"
        assert (
            client.post(
                url.replace("audio-probe-evidence", "probe-evidence"), headers=headers
            ).status_code
            == 409
        )
    client, headers = api_client(
        repository, tools, actor=TrustedReviewActor(subject_id="reader", roles=("reviewer",))
    )
    with client:
        assert client.post(url, headers=headers).status_code == 403
    assert runner.call_count == 1
    client, _ = api_client(repository, tools, security=False)
    with client:
        assert client.post(url).status_code == 404


@pytest.mark.skipif(os.name != "posix", reason="Windows native acceptance remains separate")
def test_actual_linux_wav_probes_source_samples_and_fails_new_probe_after_file_change(tmp_path):
    tools = toolchain()  # Existing pinned/hash-locked tools, no install or PATH fallback.
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    project = repository.create_project(
        name="Actual synthetic WAV",
        aspect_ratio="16:9",
        target_duration_seconds=2,
        source_language="zh-CN",
    )
    asset = MediaAssetStore(repository).import_local(
        project.id, wav_source(tmp_path / "真实测试.wav")
    )
    version = asset.latest_version
    url = (
        f"/api/v1/projects/{project.id}/assets/{asset.id}/versions/"
        f"{version.id}/audio-probe-evidence"
    )
    client, headers = api_client(repository, tools)
    with client:
        response = client.post(url, headers=headers)
        assert response.status_code == 201, response.text
        receipt = AudioAssetProbeEvidenceResponse.model_validate_json(response.content)
        assert receipt.data.probe.audio.sample_rate_hz == 32000
        assert receipt.data.probe.audio.channels == 2
        assert receipt.data.probe.audio.total_samples == 16000
        original = receipt.data.model_dump(mode="json")
        managed = (
            repository.database_path.parent
            / "media-assets"
            / "blobs"
            / version.sha256[:2]
            / version.sha256
        )
        assert managed.is_file()
        managed.unlink()
        assert client.get(url, headers=headers).json()["data"] == original
        assert client.post(url, headers=headers).status_code == 409
        wav_source(managed, rate=48000)
        assert client.post(url, headers=headers).status_code == 409
        assert client.get(url, headers=headers).json()["data"] == original


def test_audio_contract_fixture_preserves_the_exact_serialized_body():
    path = (
        Path(__file__).resolve().parents[3]
        / "packages/contracts/fixtures/audio-asset-probe-evidence.json"
    )
    payload = json.loads(path.read_text())
    model = AudioAssetProbeEvidenceResponse.model_validate_json(path.read_bytes())
    assert model.model_dump(mode="json") == payload
