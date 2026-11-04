import json
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_desktop_owned_stack_does_not_start_a_second_reload_sidecar() -> None:
    package = json.loads((REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]

    assert scripts["dev"] == "pnpm dev:desktop"
    assert scripts["dev:desktop"] == "pnpm --filter @aijian/desktop dev"
    desktop = json.loads(
        (REPOSITORY_ROOT / "apps/desktop/package.json").read_text(encoding="utf-8")
    )
    assert "electron ." in desktop["scripts"]["dev"]
    assert "dev:api" not in desktop["scripts"]["dev"]
    assert "--reload" not in scripts["dev:api"]
    assert "--reload" in scripts["dev:api:reload"]
