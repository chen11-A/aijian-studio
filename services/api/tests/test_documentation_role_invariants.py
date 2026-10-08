import os
from pathlib import Path

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
        if forbidden_name in path.read_text(encoding="utf-8")
    ]
    assert matches == []


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
