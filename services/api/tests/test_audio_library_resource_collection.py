"""All collectors delegate to the same reviewed bundle builder; compile once per test session."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
REAL_RUN = subprocess.run


@pytest.fixture(scope="module")
def built_audio(tmp_path_factory: pytest.TempPathFactory) -> Path:
    destination = tmp_path_factory.mktemp("actual-audio-builder") / "audio-library"
    REAL_RUN(
        [
            "node",
            str(ROOT / "scripts/build-audio-library-resources.mjs"),
            "--out-dir",
            str(destination),
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return destination


@pytest.mark.parametrize(
    "script",
    [
        "packaging/windows/freeze-sidecar.py",
        "packaging/linux/package-desktop.py",
        "scripts/package-native-linux-checkpoint.py",
    ],
)
def test_audio_collection_uses_the_same_actual_runtime_and_public_evidence(
    script: str, built_audio: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    spec = importlib.util.spec_from_file_location("audio_collector_fixture", ROOT / script)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    destination = tmp_path / "audio-library"
    calls: list[list[str]] = []

    def staged(command: list[str], **options: object) -> subprocess.CompletedProcess[str]:
        assert command == [
            "node",
            str(ROOT / "scripts/build-audio-library-resources.mjs"),
            "--out-dir",
            str(destination.resolve()),
        ]
        assert options == {"cwd": ROOT, "check": True, "capture_output": True, "text": True}
        calls.append(command)
        # Reuse the one genuinely compiled bundle; do not compile/re-hash 206 sources
        # three times merely to exercise identical packaging delegation.
        shutil.copytree(built_audio, destination)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(module.subprocess, "run", staged)
    module.stage_audio_library_resources(destination)
    assert len(calls) == 1
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    index = json.loads((destination / "resource-index.json").read_text(encoding="utf-8"))
    assert len(manifest) == index["assetCount"] == 206
    assert (
        hashlib.sha256((destination / "manifest.json").read_bytes()).hexdigest()
        == index["manifestSha256"]
    )
    assert (destination / "LICENSES.md").read_bytes() == (
        ROOT / "assets/audio-library/LICENSES.md"
    ).read_bytes()
    for row in index["files"]:
        assert hashlib.sha256((destination / row["path"]).read_bytes()).hexdigest() == row["sha256"]
    assert not list(destination.rglob("*.mp3"))
    assert not list(destination.rglob("*.wav"))
    assert not list(destination.rglob("*.py"))
    probe = REAL_RUN(
        [
            "node",
            "--input-type=module",
            "-e",
            "const m=await import(process.argv[1]); "
            "const a=await m.loadAudioLibrary(process.argv[2]); console.log(a.length)",
            (destination / "audio-library.mjs").as_uri(),
            str(destination),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    assert probe.stdout.strip() == "206"
