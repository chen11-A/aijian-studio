"""Real QC resource collection; no installer, binary download or release claim."""

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
def test_collects_original_qc_engine(script: str, tmp_path: Path) -> None:
    spec = importlib.util.spec_from_file_location("qc_collection_fixture", ROOT / script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    destination = tmp_path / "resources" / "qc"
    module.stage_qc_resources(destination)
    names = {"index.mjs", "media.mjs", "rules.mjs", "subtitles.mjs", "audio-normalize.mjs"}
    assert {path.name for path in destination.iterdir()} == names
    for name in names:
        source_root = (
            "packages/aivora-media" if name == "audio-normalize.mjs" else "packages/aivora-qc"
        )
        assert (
            hashlib.sha256((destination / name).read_bytes()).digest()
            == hashlib.sha256((ROOT / source_root / name).read_bytes()).digest()
        )
