"""The same standalone archive module must be staged for every shipped desktop layout."""

from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.parametrize(
    "script",
    [
        "packaging/windows/freeze-sidecar.py",
        "packaging/linux/package-desktop.py",
        "scripts/package-native-linux-checkpoint.py",
    ],
)
def test_collects_original_project_archive(script: str, tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("project_archive_collection", ROOT / script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    destination = tmp_path / "resources" / "project-archive"
    module.stage_project_archive_resources(destination)
    assert {path.name for path in destination.iterdir()} == {"archive.mjs"}
    assert (
        hashlib.sha256((destination / "archive.mjs").read_bytes()).digest()
        == hashlib.sha256((ROOT / "packages/aivora-media/archive.mjs").read_bytes()).digest()
    )
