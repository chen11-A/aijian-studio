# QA03 local Sub2API stage: physical copy packet

State: `PREPARED_FOR_MGR01_SCOPE_REVIEW_AND_MGR02_INDEPENDENT_ONE_CALL_APPROVAL`. The stage target and formal `run-01` are absent. This packet prepares one isolated local physical copy only.

## Fixed scope

- Destination: `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-stage-01`.
- `source/`: W0-v3 web/desktop base (13,681 regular files, 771 internal relative symlinks), 187 selected S2 backend files, 24 owner-pinned overlays (23 replacements, 1 addition), and one copied `scripts/export_openapi.py` input. Expected final count: 13,870 regular files and 771 relative symlinks.
- `deps/`: 596 selected S2 Python dependency files. No other stage top-level entries are allowed.
- No OpenAPI export, `generated.ts`, migration 32/33, database import, worker lease, provider call, Electron run, or product acceptance is in this call. `packages/contracts/openapi.json` and generated client remain their W0 base versions.
- Source inputs and their exact identities are in the six immutable `inputs/` files and `PACKAGE.json`. The DEV01 files come from the pinned `after/` snapshot; protected files are read with the pinned sidecar Python.

## QA and Windows path finding

`pure_qa.py` ran once with the pinned Python in isolated/no-bytecode/no-site mode. `QA-FIXTURE-RECEIPT.json` reports all selected physical inputs read back without mismatch: W0 13,681 files and 771 links, S2 187 source files and 596 dependency files, 24 overlays, one generator input. A 350-character fixture destination passed byte/hash readback. A relative directory symlink resolved inside the fixture stage. Out-of-stage destination was rejected. The target stage and formal `run-01` were absent after this QA.

Earlier ordinary Windows path access reported 28 W0 files missing. Every one has an absolute path at least 260 characters long. Extended-path reads (`\\?\`) resolved all 28, and a full W0 pass found zero file or link mismatch. This was a path-view error, not evidence of source change. `stage_once.py` uses extended paths for source reads and target writes.

## Authorization and one-call behavior

MGR01 reviews this fixed scope. MGR02 independently grants exactly one call by creating `MGR02-APPROVAL.json` in this packet root with fields `approved_by: "MGR02"`, `call_id: "QA03-LOCAL-SUB2API-STAGE-01"`, `package_sha256` equal to the exact `PACKAGE.json` SHA-256, `stage_root` equal to the destination above, and `scope: "ONE_PHYSICAL_STAGE_COPY_ONLY_NO_GENERATION"`. The approval record must be attributed to MGR02, not inferred from this packet or its author.

Only after that grant, QA03 may invoke the pinned sidecar Python once: `python.exe -I -B -S stage_once.py MGR02-APPROVAL.json`. The executor claims `run-01` exclusively, checks the package and physical inputs, copies exact bytes with per-item SHA/size readback, then verifies the complete stage tree, source inputs again, and all symlinks. Its result is only `PASS_STATIC_COPY_ONLY` or RED/UNKNOWN with immutable evidence. Any first failure stops further execution; the same call is never retried. Stage existence or a stale run claim is a stop condition.

The physical stage, if completed, is not an OpenAPI generation or Sub2API runtime/product approval. Those require separate scoped packages and independent signatures.
