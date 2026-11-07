# Windows recovery: compare identities through the same file API

The diagnostic-only source `02cb1fd` ran on Windows in run 42390007199,
job 128455409828. Its original speech 17 tests passed, then the fixed original
recovery 12-test step failed. The bounded observed facts were: descriptor stable,
regular descriptor/path, same device/inode/size/mtime, **different path-versus-fd
ctime**, and **matching named-handle identity, SHA and byte count**. All five
reported failures were original positive recovery assertions. This is actual Windows
evidence; the earlier Linux successes were not used as a Windows substitute.

`VideoRecoveryService._read_path` now reuses the shipped local-media opener for
both read-only handles. On Windows this is the existing no-reparse disk-file
CreateFile implementation, which also denies concurrent write/delete while open.
The original descriptor is kept open while the actual named file is opened again.
All five device/inode/size/mtime/ctime fields must agree between descriptor
before/after and the second named handle. Path lstat before/after must independently
remain equal across all five fields and regular. Path-versus-handle also still
checks device/inode/size/mtime; ctime is compared within each API instead of assuming
Windows path and fd APIs report the same meaning. The expected full bytes, maximum
80 MiB and SHA remain mandatory. No identity/time guard was merely removed.

This changes no task/account/attempt membership, provider GET/POST flow, failure
reservation or settlement. It does not overwrite any old output, and the original
no-overwrite hard-link publication remains. No schema migration or paid request is
introduced. The diagnostic wrapper, original assertions, deadlines and fixed Windows
12-test command remain present.

Targeted evidence:

- Original two recovery files, diagnostic transparency and new handle tests run
  together. New tests reproduce path-API-only ctime differences; reject changed
  path inode/mtime/ctime and changed source-handle ctime; attempt actual named-file
  replacement between the two opens; and reject a real symlink without changing
  its target. Windows may deny the replacement itself while the handle is held,
  which is verified as protection rather than pretending it happened.
- The original GET-only recovery tests still exercise real local FFmpeg video,
  restart, OS-process lock release, account/input ownership and failure occupancy.
- Final targeted run: **20 passed / 9.99 seconds**, including the original 12.
  Full Python Ruff, format check (**589 files**) and mypy (**322 source files**)
  all exited zero. The initial 19-test run also passed before adding the separate
  descriptor-ctime regression.
  Real Windows validation of this production fix remains required; the diagnostic
  run above is evidence of the old failure, not proof this fix has run on Windows.
