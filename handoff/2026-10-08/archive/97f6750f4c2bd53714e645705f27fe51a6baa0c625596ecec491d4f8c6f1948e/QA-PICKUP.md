# QA03 v4 physical source stage pickup

State: PACKAGE_DRAFT_NOT_SIGNED_NOT_RUN. The single claim requires MGR01 exact scope review and MGR02 approval bound to PACKAGE.json SHA-256.

- New target: C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-source-v4-01. It must be absent before the claim.
- Inputs: W0-v3 13,681 regular source files and 771 internal relative links; S2 187 backend source files and 596 dependency files; v4 26 selected product overlays (25 replace, one add); one QA-local OpenAPI exporter.
- Expected target: source 13,870 regular files and 771 internal links; deps 596 regular files.
- DEV07 deadline test SHA-256 B18187304B871B876DCCDF70BA8B1D02CEA196F4A3DDDC15105B5248EC5F80C1 is packet sidecar only. It does not enter product source.
- Scope: physical copy and full-tree source/link preflight, destination readback, source-after readback. No import, generation, API call, network call or product test.
- Reader: pinned author .venv Python with -I -B -S. PowerShell/.NET E-SafeNet LOCK for protected DEV05 files is a reader boundary, not source drift.
- On first failure, retain claim and raw evidence; no automatic retry, cleanup, second target or replacement call.
- Static copy PASS is not runtime or product acceptance. Generator and backend gates remain separate.
