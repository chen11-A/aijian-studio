"""QA-only checks for the f33 exact source-text readback route."""

import base64
import hashlib
from pathlib import Path

from aijian_api.main import create_app
from aijian_api.repository import StudioRepository
from aijian_api.security import SidecarSecurity
from fastapi.testclient import TestClient


def test_exact_source_text_and_cross_project_not_found(tmp_path: Path) -> None:
    host = "127.0.0.1:43124"
    token = "q" * 43
    client = TestClient(
        create_app(
            repository=StudioRepository(tmp_path / "workspace.sqlite3"),
            sidecar_security=SidecarSecurity(token=token, host=host, origin="app://aijian"),
        ),
        base_url=f"http://{host}",
        client=("127.0.0.1", 50101),
    )
    client.headers.update({"Authorization": f"Bearer {token}", "Origin": "app://aijian"})

    def project(name: str) -> str:
        response = client.post(
            "/api/v1/projects",
            json={
                "name": name,
                "aspect_ratio": "9:16",
                "target_duration_seconds": 38,
                "source_language": "zh-CN",
            },
        )
        assert response.status_code == 201
        return response.json()["data"]["id"]

    owner = project("source owner")
    other = project("other project")
    text = (
        "### 镜头 03\n\n> 周野：第一句。\n>\n> 林澄：第二句。"
        "\n>\n> 周野：第三句。\n\n### 镜头 04\n\n> 周野：好。"
    )
    encoded = text.encode("utf-8")
    created = client.post(
        f"/api/v1/projects/{owner}/sources",
        json={
            "filename": "story.txt",
            "media_type": "text/plain",
            "content_base64": base64.b64encode(encoded).decode("ascii"),
        },
    )
    assert created.status_code == 201
    source = created.json()["data"]
    url = f"/api/v1/projects/{owner}/sources/{source['id']}/text"
    response = client.get(url)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["id"] == source["id"]
    assert data["project_id"] == owner
    assert data["normalized_text"] == text
    assert data["raw_sha256"] == hashlib.sha256(encoded).hexdigest()
    assert data["normalized_sha256"] == hashlib.sha256(encoded).hexdigest()
    assert client.get(f"/api/v1/projects/{other}/sources/{source['id']}/text").status_code == 404
    assert client.get(f"/api/v1/projects/{owner}/sources/src_{'f' * 32}/text").status_code == 404
    assert (
        client.get(f"/api/v1/projects/prj_{'f' * 32}/sources/{source['id']}/text").status_code
        == 404
    )
