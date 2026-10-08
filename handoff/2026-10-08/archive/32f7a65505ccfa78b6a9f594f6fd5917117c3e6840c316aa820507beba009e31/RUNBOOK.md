# QA02 short-profile HTTP plus headless Chromium r04

Status: `STATIC_CANDIDATE_AWAITING_MGR02_ONE_SHOT_SIGN`.

This is a new isolated slice after the r02 first RED. Preserve the r02
approval, profile, database, runner and raw evidence. The short QA-owned
profile is `C:\Users\Administrator\Documents\Codex\qa02-r04-short-profile-20260928`;
its WebM blob path is 162 characters. The package evidence directory is a
separate sibling. The runner refuses either pre-existing output path.

The sidecar starts twice against this profile. It imports the frozen
synthetic WebM, WAV, MP3, and decoder-invalid MP3 via actual loopback HTTP
bytes. Each import is followed by original-content GET with MIME, ETag,
size, and SHA checks. The first sidecar closes normally. The runner reads
SQLite schema26 integrity and row counts with `inspect-db.py`, restarts the
sidecar, lists all versions and GETs all original bytes again, closes
normally, and rechecks SQLite. PIDs, parent-child relationship, launcher
and actual Python EXE paths/SHA, raw stdout/stderr, and close process state
are recorded. A closed r02 QA database read-only selftest must pass before
this package is frozen; `inspect-db.py` uses only tables in schema26.

Only after HTTP persistence succeeds does existing Microsoft Edge launch
with Playwright `headless: true`. Media elements consume the **actual
reopened HTTP bytes** and must emit real `loadedmetadata`, `playing`, and
`timeupdate`, advance time, pause, and seek for each valid input. Invalid
MP3 must report a decoder error and never play. The runner captures the
main Edge PID, command line, executable SHA, child processes, and closure.
No event is simulated. No visible Electron window opens.

The label is `HTTP_PLUS_HEADLESS_CHROMIUM_NOT_ELECTRON` even on PASS. This
does not establish desktop picker/renderer acceptance, rights, G1,
assembly, MLT, real provider, billing, installation, or UAT. The 32 MiB
fixture stays outside this minimal run.

After MGR04's protected two-file c19 sync, a static builder pins the exact
Git HEAD/status, complete sidecar Python source set, schema26 repository,
unchanged route, new helper/store SHA, QA01 and MGR04 receipts, input
package, Node/Python/Edge/Playwright identities, and output paths. MGR02
must sign the resulting package/envelope/runner/source hashes in an external
approval JSON with kind `QA02_MEDIA_SHORT_HEADLESS_R04_ONE_SHOT`, status
`MGR02_APPROVED_ONCE`, max sidecar launches 2, max browser launches 1,
provider calls 0. The unapproved template must fail before creating output.

The first RED or UNKNOWN stops dependent work. No automatic retry or
second run. Raw sidecar stdout contains an ephemeral token; keep it local.
