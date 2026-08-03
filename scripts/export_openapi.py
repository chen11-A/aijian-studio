"""Export the authoritative FastAPI OpenAPI document deterministically."""

import json
import sys
from importlib import import_module
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api" / "src"))

OUTPUT = ROOT / "packages" / "contracts" / "openapi.json"


def main() -> None:
    create_app = import_module("aijian_api.main").create_app
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(create_app().openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


if __name__ == "__main__":
    main()
