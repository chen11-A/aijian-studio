"""Seal DEV05's source-only local-mode candidate without running product code."""

from __future__ import annotations

import ast
import difflib
import hashlib
import json
import shutil
from pathlib import Path


ROOT = Path(r"C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp")
SOURCE = ROOT / "services/api/src/aijian_api"
ARTIFACT = ROOT / "work/dev05-b31-local-gates-20260929"
BACKUP = ARTIFACT / "backup-before-local-mode"
AFTER = ARTIFACT / "after-local-mode"
AFTER.mkdir(parents=True, exist_ok=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


names = sorted(path.name for path in BACKUP.glob("*.py"))
files: list[dict[str, object]] = []
patch_parts: list[str] = []
for name in names:
    before = BACKUP / name
    after = SOURCE / name
    snapshot = AFTER / name
    before_text = before.read_text(encoding="utf-8")
    after_text = after.read_text(encoding="utf-8")
    ast.parse(after_text, filename=str(after))
    shutil.copy2(after, snapshot)
    if sha256(after) != sha256(snapshot):
        raise RuntimeError(f"source changed while sealing {name}")
    relative = f"services/api/src/aijian_api/{name}"
    diff = "".join(
        difflib.unified_diff(
            before_text.splitlines(keepends=True),
            after_text.splitlines(keepends=True),
            fromfile=f"a/{relative}",
            tofile=f"b/{relative}",
        )
    )
    if diff:
        patch_parts.append(diff)
    files.append(
        {
            "path": relative,
            "before_sha256": sha256(before),
            "after_sha256": sha256(after),
            "after_snapshot_path": str(snapshot),
            "changed": bool(diff),
            "syntax_parse": "PASS",
        }
    )

patch = ARTIFACT / "DEV05-LOCAL-MODE.patch"
patch.write_text("".join(patch_parts), encoding="utf-8", newline="\n")
manifest = {
    "kind": "DEV05_SUB2API_LOCAL_MODE_SOURCE_CANDIDATE",
    "status": "SOURCE_ONLY_INTEGRATION_HOLD",
    "date": "2026-09-29",
    "source_root": str(ROOT),
    "baseline_r2_composite_sha256": "3A3DA222E44622DA5803AE80D9867FF69296BD394E7AC2132921F3C9C30FAE7B",
    "baseline_b31_manifest_sha256": "B91EE1F989B73E23B4740224643B95F48517F006448DCFD375F91E67C11E35B9",
    "origin_mode_contract": ["PUBLIC_HTTPS", "LOCAL_LOOPBACK_HTTP"],
    "origin_binding_fields": ["origin", "origin_mode", "connection_revision"],
    "existing_local_edit_omitted_mode": "REJECT_WITHOUT_CAS",
    "repository_dependency": "DEV01 migration33 candidate; migration32 independently unverified",
    "known_local_port_blocker": "Windows portproxy 0.0.0.0:8080 -> 192.168.254.115:80",
    "files": files,
    "patch_path": str(patch),
    "patch_sha256": sha256(patch),
    "verification": "AST parse only; no build, tests, migration, service, provider call, or EXE run",
}
(ARTIFACT / "MANIFEST.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
)
print(json.dumps({"files": len(files), "changed": len(patch_parts), "patch_sha256": sha256(patch), "manifest_sha256": sha256(ARTIFACT / "MANIFEST.json")}, ensure_ascii=False))
