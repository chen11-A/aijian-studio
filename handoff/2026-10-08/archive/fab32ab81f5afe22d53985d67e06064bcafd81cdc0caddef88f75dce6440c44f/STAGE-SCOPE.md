# QA03 v4 S: one physical source stage claim

Status: DRAFT_FOR_MGR01_SCOPE_REVIEW_AND_MGR02_EXACT_ONE_CALL_APPROVAL. No stage or run claim has been made.

Call ID: QA03-LOCAL-SUB2API-STAGE-V4-01.
Target: C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-source-v4-01 (must initially be absent).
Scope: ONE_PHYSICAL_STAGE_COPY_ONLY_NO_GENERATION.

The packet pins W0-v3 (13,681 regular source files, 771 internal relative links), S2 (187 selected backend source files, 596 dependency files), composition v4 (26 selected product files, 25 replacements and one addition), and one QA-local OpenAPI exporter. Expected staged source is 13,870 regular files plus 771 links; staged deps is 596 regular files.

DEV07's unrun deadline test is a packet sidecar only. No product import, generator execution, network call, API call, Vitest run, or backend DB gate belongs to this claim.

The one-call runner requires MGR02-APPROVAL.json to bind call ID, target, scope and the exact PACKAGE.json SHA-256. It creates run-01/CLAIM.json before preflight. It checks source bytes and links, copies into the new target, then checks full destination tree and source bytes and links again. A first failure stays RED or UNKNOWN with raw evidence; no retry or cleanup is authorized.

Read source bytes with the fixed author .venv Python SHA-256 461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060 and -I -B -S. Protected DEV05 files may appear as E-SafeNet LOCK through PowerShell/.NET; that reader result is not a source hash.

Review sequence: QA03 final packet and static readback; MGR01 exact scope review; MGR02 matching single-call signature; only then invoke once. PASS_STATIC_COPY_ONLY establishes physical stage integrity, not generation, runtime, DB, device, or product acceptance.
