# QA03 R2-only sidecar EXE build gate — prepared, not run

## Scope

Build a new isolated `aijian-sidecar.exe` from exactly the old 194-file sidecar build inventory with only `workspace_owner_lock.py` replaced by the MGR04 frozen DEV05 R2 consumer bytes. Keep the unchanged entry/spec and 32 offline acquisition items (Python archive plus 31 wheels). Do not include DEV07 desktop files. Do not write product, c19, user database, provider, or old QA build/run directories.

## Freeze prerequisites

1. MGR04 supplies an R2-only source/input manifest with exact root, 194 paths, per-file Python consumer SHA/bytes, changed-file identity, unchanged spec/entry hashes, and manifest SHA.
2. QA03 checks set equality against the old 194 paths; exactly one `workspace_owner_lock.py` entry changes, all other 193 inventory entries and spec/entry match the old freeze. Preserve any PowerShell raw ciphertext discrepancy separately from the Python consumer view.
3. Check the 32 acquisition items, base Python 3318-file inventory, uv/Node versions and hashes, requirements hash file and 31 wheel hashes against the prior accepted immutable evidence. Re-read current bytes before signing and before/after build.
4. Review and hash QA-only runner, probe and guard. Bind all inputs to a new one-shot packet and approval. New output path: `run-01` under this directory; the old EXE remains untouched.

## Signed one-shot phases

1. Extracted Python `-I -B` same-process view: 3318 base files, exactly 194 R2 inventory files, stdlib origins, interpreter SHA/PE, entry/spec.
2. Offline uv venv and strict hash-locked sync of exactly 31 wheels; no index, network fallback or download.
3. uv dependency check and installed distribution file fingerprint.
4. Same-process guarded PyInstaller build into fresh QA `run-01/dist`; check 3318+194 and 31 distributions before and after.
5. One PE x64 EXE SHA/bytes and raw stdout/stderr/process audit. First RED stops, preserves partial files, and prohibits retry under the same approval.

A successful build proves only this frozen local EXE artifact. Long-profile lock and short-TEMP runtime contrast require a separate packet and approval.


