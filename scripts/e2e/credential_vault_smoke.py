"""Exercise the real OS credential vault without persisting a test secret."""

import json
import sys
from importlib import import_module
from pathlib import Path
from uuid import uuid4

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY_ROOT / "services" / "api" / "src"))
SystemCredentialVault = import_module("aijian_api.credential_vault").SystemCredentialVault
RESULT_PATH = REPOSITORY_ROOT / "docs" / "quality" / "evidence" / "credential-vault-smoke.json"


def main() -> None:
    connection_id = f"pcn_test_{uuid4().hex}"
    secret = f"test-only-{uuid4().hex}"
    vault = SystemCredentialVault()
    try:
        vault.set(connection_id, secret)
        if vault.get(connection_id) != secret:
            raise RuntimeError("credential vault did not return the test value")
    finally:
        vault.delete(connection_id)
    if vault.get(connection_id) is not None:
        raise RuntimeError("credential vault did not remove the test value")
    evidence = {
        "check": "credential-vault-smoke",
        "passed": True,
        "backend": "operating-system keyring",
        "roundTrip": {
            "write": True,
            "read": True,
            "delete": True,
            "confirmAbsent": True,
        },
        "testCredentialRemoved": True,
        "secretOrCredentialIdRecorded": False,
    }
    RESULT_PATH.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print("Windows credential vault round-trip: PASS (test credential removed)")


if __name__ == "__main__":
    main()
