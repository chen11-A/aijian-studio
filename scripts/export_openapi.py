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
    sidecar_security_type = import_module("aijian_api.security").SidecarSecurity
    contract_sidecar = sidecar_security_type(
        token="contract-export-token-without-runtime-authority",
        host="127.0.0.1:43127",
        origin="app://aijian",
    )
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(
        json.dumps(
            create_app(sidecar_security=contract_sidecar).openapi(),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )


if __name__ == "__main__":
    main()
