# QA03 Sub2API composite-v3 stage copy packet

Status: `PREPARED_FOR_EXACT_REVIEW_NOT_SIGNED_NOT_RUN`.

Operation `QA03-LOCAL-SUB2API-STAGE-V3-01` is one claim for physical copy to the new, initially absent `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-source-01`. It takes the pinned W0-v3 files/links, pinned S2 source/dependencies, 24 MGR04 composite-v3 selections and pinned QA-local OpenAPI exporter. It does no Python import, OpenAPI/TypeScript generation, API/service startup, DB migration, Vault/provider call, Electron run or network request.

The script validates its exact package, MGR02 approval identity and one-time claim before creating the target. It checks input hashes, symlink targets/containment and collisions before copying; uses exact-byte, create-only writes; then checks every source input and the full target tree. Expected target: `source` with 13,870 regular files and 771 internal links; `deps` with 596 regular files and no links. A mismatch leaves a raw RED receipt and no automatic retry. It never writes the old signed `qa03-local-sub2api-stage-01`.

MGR01 fixes this S scope; an independent MGR02 approval must name the final `PACKAGE.json` SHA-256, call ID, target and `ONE_PHYSICAL_STAGE_COPY_ONLY_NO_GENERATION`. `MGR02-APPROVAL.json` is intentionally absent. Running `stage_once.py` without that approval is prohibited; this package preparation has not invoked it.

The new composite still selects the earlier DEV07 desktop candidate and frozen DEV04 handoff. Later DEV07/DEV04 consumer behavior, migration 32/33, offline generation and P1/L1-L4 HTTP/DB/approval tests require separate version identity and gates.
