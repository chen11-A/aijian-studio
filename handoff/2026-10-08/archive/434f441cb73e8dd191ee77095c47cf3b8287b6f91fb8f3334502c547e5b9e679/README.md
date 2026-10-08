# QA02 Stage-A long-path run04 review package

Status: `ENVELOPE_APPROVED_WAITING_EXTERNAL_ONE_SHOT`. Run04 is a new QA package with a new
`profile-04` and `invocation-04`; neither directory exists. No run04 product
invocation has occurred. The run03 package, raw receipts, database, profile,
and one-shot approval remain preserved and are not reused.

The only QA logic repair is canonical SHA text comparison at the managed
blob and WAV inspection assertions. `SHA-EQUALITY-AUDIT.md` records the
remaining comparison scan. `digest-case-selfcheck.py` and `SELF-CHECK.json`
provide a pure, product-free case check.

Run04 proposes the same Stage-A first gate as run03: four synthetic imports
(two WebM, two WAV), store and selected/rights readback, independent managed
blob hashes, WAV local inspection, private assembly `_availability`, and
relative/UNC/traversal/symlink-reparse helper rejections. The SRT remains
manifest-only. A failed symlink setup is `NOT_TESTED`, never a negative-case
PASS. Video probe, public assembly read, MLT, provider, human `CLEARED`, and
export are outside this gate.

The MGR04 frozen closure-3, QA01 seed, and five-input manifest are pinned in
the envelope. All four constructed logical blob targets are 266 characters,
matching run03 and the original run01 target length; UUID32 staging is 240.
The wrapper retains a 180-second limit, exact child PID and raw output, and
single-use output directories. It does not retry after a RED or UNKNOWN.

MGR02 approved the envelope status
`MGR02_APPROVED_STAGE_A_RUN04_ONCE`. `approval-template.json` remains
`NOT_APPROVED_TEMPLATE` with `seed_process_zero_observed=false`, so the
wrapper still rejects execution. MGR02 must independently confirm the source
process is stopped and issue a new external one-shot approval bound to the
final hashes before any invocation.
`STATIC-PREFLIGHT.json` and `PACKAGE-SHA256.json` are static review records,
not product acceptance.
