import json
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_combined_windows_stack_does_not_use_uvicorn_reload() -> None:
    package = json.loads((REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]

    assert "pnpm dev:api" in scripts["dev"]
    assert "--reload" not in scripts["dev:api"]
    assert "--reload" in scripts["dev:api:reload"]
