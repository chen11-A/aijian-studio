# QA02 Stage-A long-path video probe r05

This package is a frozen candidate for **one externally approved invocation**.
Do not run `probe-once.py` directly. Do not edit the package after MGR02 signs
its hashes. The package itself contains no approval. No profile or invocation
output exists at freeze time.

Read `PROBE-PLAN.md` for inputs, exact scope, expected rows, and failure
behavior. `ASSEMBLY-READ-PRECONDITIONS.md` records the separate public read
prerequisite. `probe-envelope.json` is fixed at
`READY_FOR_EXTERNAL_ONE_SHOT`; MGR02's separate approval JSON must have the
approved status and pin the hashes in `PACKAGE-SHA256.json`.

Only after MGR02 provides that exact-hash approval and an observed zero source
process count, the one-shot entry is:

```powershell
& '<pinned interpreter from probe-envelope.json>' -I -B '<this package>\invoke-probe-once.py' --approval '<MGR02 approval JSON>' --approved-approval-sha256 '<SHA-256 of that approval JSON>'
```

Expected new outputs: `invocation-05/receipt.json`, `stdout.bin`,
`stderr.bin`, and `profile-05/receipt.json`, cloned workspace DB and four
blobs, plus `tool-evidence/{ffmpeg,ffprobe}-version.{stdout,stderr}.bin`.
The wrapper records a first preflight RED in its receipt when the invocation
directory exists; an approval/hash/output-exists preflight RED occurs before
any output directory is made. The child preserves partial profile state on a
failure. A timeout becomes UNKNOWN and stops only the recorded child PID
tree. No automatic retry is authorized.
