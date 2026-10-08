# QA02 final resolver path-gate review packet

Status: `ENVELOPE_APPROVED_WAITING_EXTERNAL_ONE_SHOT_NOT_RUN`. This package proposes one
bounded, isolated path-gate invocation for frozen final resolver SHA
`1D80A540...`. No product module has been imported and `profile-01` and
`invocation-01` below this package do not exist.

`CASE-MATRIX.md` identifies the exact positive and negative cases and their
limits. `path-layout.py` is pure: its saved `PATH-LAYOUT.json` proves the
constructed path lengths in Windows UTF-16 code units, including an emoji
boundary, without creating files. The runtime candidate
`resolver-path-once.py` copies the 54-file frozen closure into a new QA
profile, uses only the product resolver's closed-DB and fixture-byte helpers
and the managed-path helper, and retains raw results. Its wrapper pins one
process, timeout, source hashes, and exact output directories. These scripts
have only been parsed statically; their product imports and behavior are
unproven until a separately approved invocation.

MGR02 approved the envelope status
`MGR02_APPROVED_RESOLVER_PATH_R01_ONCE`. `approval-template.json` remains
`NOT_APPROVED_TEMPLATE` with `source_process_zero_observed=false`, so the
wrapper still rejects execution. MGR02 must independently confirm source
quiescence and issue an external exact-hash one-shot approval after the c19
sync window is released. A failure or UNKNOWN preserves the profile and raw
output; no automatic retry is permitted.

Stage-A run01/run03/run04 profiles and raw receipts remain untouched. This
packet does not create rights decisions or video probes and cannot prove a
full `prepare_test_selection` success, native MLT execution, or export.
