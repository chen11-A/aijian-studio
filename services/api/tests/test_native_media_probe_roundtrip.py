"""Actual Linux fixture proves persisted selected-version API shape, not Windows admission."""

import json
import os
import subprocess
from pathlib import Path

import pytest
from aijian_api.local_media_toolchain import LocalMediaToolchainService
from aijian_api.main import create_app
from aijian_api.media_asset_probe_routes import MediaAssetProbeEvidenceResponse
from aijian_api.media_asset_store import MediaAssetStore
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient
from test_draft_export_runtime import toolchain


def test_probe_serialized_fixture_is_exact_route_schema():
    path = (
        Path(__file__).resolve().parents[3]
        / "packages/contracts/fixtures/media-asset-probe-evidence.json"
    )
    payload = json.loads(path.read_text())
    value = MediaAssetProbeEvidenceResponse.model_validate(payload)
    assert value.model_dump(mode="json") == payload
    assert value.data.probe.source_asset_sha256 == "sha256:" + value.data.asset_sha256


@pytest.mark.skipif(os.name != "posix", reason="Separate explicit Windows acceptance is required")
def test_actual_local_video_probe_persists_and_reads_exact_version(tmp_path):
    tools = toolchain()  # Existing hash-locked Linux test tools; no PATH substitution/download.
    source = tmp_path / "synthetic 视频 clip.mp4"
    subprocess.run(
        [
            str(tools.ffmpeg_path),
            "-v",
            "error",
            "-nostdin",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x90:r=24:d=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(source),
        ],
        check=True,
        timeout=20,
        stdin=subprocess.DEVNULL,
        capture_output=True,
    )
    repository = StudioRepository(tmp_path / "workspace.sqlite3")
    project = repository.create_project(
        name="Synthetic native probe",
        aspect_ratio="16:9",
        target_duration_seconds=1,
        source_language="zh-CN",
    )
    asset = MediaAssetStore(repository).import_local(project.id, source)
    version = asset.latest_version
    token, host = "p" * 43, "127.0.0.1:43123"
    service = LocalMediaToolchainService(None, fallback=lambda: tools)
    app = create_app(
        repository=repository,
        sidecar_security=SidecarSecurity(token=token, host=host),
        local_media_toolchain=service,
    )
    url = f"/api/v1/projects/{project.id}/assets/{asset.id}/versions/{version.id}/probe-evidence"
    headers = {"Authorization": f"Bearer {token}", "Origin": "app://aijian"}
    with TestClient(app, base_url=f"http://{host}", client=("127.0.0.1", 1234)) as client:
        assert client.get(url, headers=headers).json()["error"]["code"] == "PROBE_NOT_FOUND"
        probed = client.post(url, headers=headers)
        assert probed.status_code == 201, probed.text
        payload = probed.json()["data"]
        assert payload["asset_sha256"] == version.sha256
        assert payload["version_id"] == version.id
        assert payload["probe"]["source_asset_sha256"] == "sha256:" + version.sha256
        assert len(payload["probe"]["video"]["frames"]) == 24
        assert payload["probe"]["video"]["average_frame_rate"] == {"num": 24, "den": 1}
        assert payload["probe"]["audio"] is None
    reopened = create_app(
        repository=StudioRepository(repository.database_path),
        sidecar_security=SidecarSecurity(token=token, host=host),
        local_media_toolchain=service,
    )
    with TestClient(reopened, base_url=f"http://{host}", client=("127.0.0.1", 1234)) as client:
        read = client.get(url, headers=headers)
        assert read.status_code == 200
        assert read.json()["data"] == payload
