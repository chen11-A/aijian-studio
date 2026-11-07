# Windows recovery identity evidence

The original Windows quality run for source `0f9505e`, run `42375200635`, job
`128411243565`, failed in recovery-positive assertions at `test_video_recovery_routes`
and `test_video_recovery` (expected `RECOVERED`). This leaf does not guess the cause or
change production. The original recovery reader/lock, SHA, complete-byte validation,
real ffprobe, no-overwrite behavior, deadlines and GET-only transport assertions remain.

The reader currently compares all five identity/time fields from an opened descriptor
before/after reading and a named `Path.lstat`. A Windows API difference is a candidate,
not a demonstrated diagnosis. The shipped `media_probe._open_local_source` supplies an
independent native no-reparse, read-only named handle for a test-only comparison.

The transparent observer preserves the original read result and exceptions. Only when
the original returns `None` does it report at most three closed boolean rows per test:
FD stability/regularity, path regularity, device/inode/size/mtime/ctime equality, named
handle equality, and actual byte-count/hash equality. It does not output any inode,
timestamp, path, request/account ID, hash, bytes, token or exception text. The Node
diagnostic wrapper accepts only that exact boolean schema inside pytest failures and
retains the existing six-annotation ceiling and unmodified child streams/exit status.

The fixed `--video-recovery-test` mode runs exactly:

```sh
uv run pytest services/api/tests/test_video_recovery.py services/api/tests/test_video_recovery_routes.py
```

The existing targeted Windows speech job runs this step after its original 17 tests,
using the same frozen Python dependencies and pinned development media tools. Original
quality, speech, manifest and ownership commands remain; this is not a replacement for
Windows full quality. Extra/unknown caller arguments cannot spawn a command. No real
provider/account/member call is used.

Local evidence:

- Fixed CLI selected and passed the original **12** cases in **9.06 s**, with inherited
  `PYTHONPATH` removed. Log: `/tmp/windows-recovery-fixed-cli.log`.
- The same files plus observer transparency/privacy checks: **13 passed / 9.27 s**.
  Log: `/tmp/windows-recovery-diag-py.log`.
- Original diagnostics and new closed-schema/fixed-mode tests: **30 passed / 1.02 s**,
  including preserved child exit 23, original stdout/stderr and zero spawn for invalid
  arguments. Log: `/tmp/windows-recovery-diag-node.log`.
- A controlled test-local `Path.lstat` API facade altered only the reported inode of
  the same real recovery file. The original positive test then failed as `UNKNOWN`
  (exit 1). The real observer/annotation reported `fdStable=true`, `sameInode=false`,
  `namedHandleMatch=true`, `shaMatch=true`, `byteCountMatch=true` and the actual assertion
  frame. The plugin is under `/tmp/windows-recovery-identity-alias`, not production or
  the CI job. Log: `/tmp/windows-recovery-controlled-stat-api.log`.

That controlled failure proves the diagnostic distinguishes a cross-API disagreement
from changed bytes. It is not evidence that this exact field differs on Windows. The
next real Windows run must supply those facts before choosing any production fix.
