# DEV04 generated origin_mode alignment candidate

Author source: `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp\apps\studio-web\src\api\studio.ts`

Before: SHA-256 `E70D8E2ED484340DC656AB6D0E1952F097E49AC41BEC9C225F21CC941570F286`, 59600 bytes.

After: SHA-256 `86557FBDF9598EEA5CF22316896B7E5940129806AF6CA9C80BFD5CDBDEC8A16B`, 60372 bytes.

`studio.ts.before` and `studio.ts.after` are byte-for-byte source snapshots. This handoff supersedes only the `studio.ts` row of `dev04-sub2api-local-mode-transfer-20260929/HANDOFF.md`; the four other DEV04 UI files retain their hashes there.

QA03 offline stage read only: `C:\Users\Administrator\Documents\Codex\2026-09-23\qa03-local-sub2api-stage-01\source\packages\contracts\openapi.json` SHA-256 `5DB5480A7CDFC5AADECECD9D9F6835148B289ED32427289250AAAEE3623C8AFE`; its `src\generated.ts` SHA-256 `DE2B2F58314658A21576AE7E850CB93016A8A419F021E8E294F026FD95EAE8A0`. The author tree still contains the earlier generated files. DEV04 did not copy or modify either generated output.

## Difference

- The create input now removes the generated nullable `origin_mode` and exposes an optional **non-null** `Sub2APIOriginMode`. The runtime create transport rejects an explicitly supplied null, undefined or unknown value for `SUB2API` before invoking either desktop bridge or HTTP request.
- Provider list/receipt data use the generated `origin_mode` field when present. The compatibility addition is used only while the author tree has the older generated type without that field; the QA stage schema has it.
- CAS retains an optional non-null mode for legacy public requests. The desktop bridge wrapper rejects any explicitly supplied null, undefined or unknown mode before invoking CAS. The existing UI constructors send `sub2apiMode` / `mode` from the non-null union only when their integration gate is enabled; the gate remains `false`.
- The prior public HTTPS payload shape remains unchanged. Local mode create/CAS remains blocked at the UI gate pending generated-contract promotion, desktop/backend/migration integration and independent QA.

Static `git diff --check` and no-index snapshot diff check produced no whitespace errors. No build, test, provider, deployment or real UI run was performed. This is candidate source, not integrated acceptance. MGR04 must replace the old `studio.ts` SHA in its composition inputs; do not reuse a prior draft or stage a generated file from this handoff.
