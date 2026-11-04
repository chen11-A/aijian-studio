import hashlib
import os
from pathlib import Path

import pytest

REPOSITORY_ROOT = Path(__file__).parents[3]
EXCLUDED_PARTS = {
    ".aijian-dev",
    ".git",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "dist",
    "node_modules",
    "upstreams",
}
TEXT_SUFFIXES = {
    ".css",
    ".html",
    ".json",
    ".md",
    ".mjs",
    ".ps1",
    ".py",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}
# Byte-preserved handoff archive, not readable Python source. Only this exact
# opaque blob is outside the text assertion; unknown encodings still fail.
OPAQUE_ARCHIVE_SHA256 = {
    "handoff/2026-10-08/archive/"
    "fdb79d7355dbbaeca044688b66a914930c05a506a847584a2e5479d359f2c926/"
    "_internal_dataclass.py": "dd152601c9ad910bb9c7e9e3c25e5bb027e088c0e6ce640b0758b61a7154cffd",
}


def repository_text(path: Path, root: Path = REPOSITORY_ROOT) -> str:
    body = path.read_bytes()
    expected = OPAQUE_ARCHIVE_SHA256.get(path.relative_to(root).as_posix())
    if expected is not None:
        digest = hashlib.sha256(body).hexdigest()
        if digest == expected:
            return ""
        # The Windows Python reader can receive the transparent plaintext view.
        # Its original content hash is the archive directory name; scan it too.
        assert digest == path.parent.name, "Opaque archive bytes changed"
    return body.decode("utf-8")


def repository_text_files() -> list[Path]:
    paths: list[Path] = []
    for directory, directory_names, filenames in os.walk(REPOSITORY_ROOT):
        directory_names[:] = [name for name in directory_names if name not in EXCLUDED_PARTS]
        root = Path(directory)
        paths.extend(
            root / filename
            for filename in filenames
            if Path(filename).suffix.lower() in TEXT_SUFFIXES
        )
    return paths


def test_mistaken_person_name_is_absent_from_repository_text() -> None:
    forbidden_name = "\u963f\u5065"
    matches = [
        str(path.relative_to(REPOSITORY_ROOT))
        for path in repository_text_files()
        if forbidden_name in repository_text(path)
    ]
    assert matches == []


def test_unknown_binary_source_still_fails_text_audit(tmp_path):
    path = tmp_path / "unknown.py"
    path.write_bytes(b"\xff")
    with pytest.raises(UnicodeDecodeError):
        repository_text(path, tmp_path)


def test_opaque_archive_exception_is_bound_to_exact_bytes(tmp_path):
    path = tmp_path / next(iter(OPAQUE_ARCHIVE_SHA256))
    path.parent.mkdir(parents=True)
    path.write_bytes(b"changed archive")
    with pytest.raises(AssertionError, match="Opaque archive bytes changed"):
        repository_text(path, tmp_path)


def test_default_agent_roles_use_stable_ids_and_explicit_boundaries() -> None:
    specification = (REPOSITORY_ROOT / "docs/specs/agent-skill-runtime-v1.md").read_text(
        encoding="utf-8"
    )
    architecture = (REPOSITORY_ROOT / "docs/architecture/workflow-and-agents.md").read_text(
        encoding="utf-8"
    )
    combined = f"{specification}\n{architecture}"

    for definition_id, display_name in (
        ("producer_coordinator", "AI 制片协调员"),
        ("screenwriter", "编剧 Agent"),
        ("continuity_supervisor", "连续性监督 Agent"),
        ("director", "导演 Agent"),
        ("art_asset", "美术与资产 Agent"),
        ("prompt_planner", "提示词 Agent"),
        ("editor", "剪辑 Agent"),
        ("quality_control", "QC Agent"),
    ):
        assert f"`{definition_id}`" in specification
        assert display_name in combined

    for forbidden_action in ("不写专业产物", "不审批", "不直接调用 Provider", "不读取密钥"):
        assert forbidden_action in combined
