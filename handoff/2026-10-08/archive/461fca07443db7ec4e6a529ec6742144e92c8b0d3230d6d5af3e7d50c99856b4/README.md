# QA02 Stage-A long-path run03 review package

Status: `ENVELOPE_APPROVED_WAITING_EXTERNAL_ONE_SHOT`. This package has not created `profile-03`
or `invocation-03` and has not imported media. The earlier run01 RED and run02
short-path receipts are preserved separately.

## First gate

This proposed one-call run uses MGR04's frozen 47-file unified closure-3,
the QA01 schema-26 seed copy, and the original five-input manifest. Four
synthetic inputs (two WebM, two WAV) are imported once into a new isolated
profile. The SRT remains manifest-only. The proposed checks cover product
store/readback, selected and rights readback, independent managed-blob bytes,
two local WAV inspections, a private assembly availability helper, and path
rejections for relative, UNC, traversal, and symlink ancestors. The helper's
ancestor check and later file access are separate operations, so this does
not prove resistance to a junction-swap race.

The constructed logical managed blob paths are 266 characters, matching the
run01 failing target length; the UUID32 staging path is 240. The product may
use extended Windows paths for its managed filesystem operations while
keeping logical paths in records. The public assembly read has no seed
assembly artifact and is not called. Video probe needs a separate pinned
toolchain approval; FFmpeg/ffprobe, MLT, provider, human rights decisions,
and export are outside this gate.

## Approval and execution boundary

MGR02 approved the static envelope status
`MGR02_APPROVED_STAGE_A_RUN03_ONCE`. The envelope's other fields are
unchanged. `approval-template.json` remains `NOT_APPROVED_TEMPLATE` with
`seed_process_zero_observed=false`, so the wrapper still rejects execution.
MGR02 must independently sign an external one-shot approval bound to the
final envelope, script, wrapper, interpreter, closure, seed, and input hashes
after confirming the source process is stopped. Each invocation directory is
single-use.

The wrapper records raw stdout/stderr, PID, exit status, timeout and any
exact-PID process-tree termination result. A failed or uncertain run stays
preserved; no automatic retry, short-path fallback, or second call follows.

`STATIC-PREFLIGHT.json` records static identity and path checks only.
`PACKAGE-SHA256.json` indexes these review files. Neither is runtime proof.
