# QA02 schema26 long-path HTTP r03

Status: `STATIC_CANDIDATE_AWAITING_MGR02_ONE_SHOT_SIGN`.

This package is a new slice. The r02 profile, database, approval, runner, and
raw evidence stay frozen; r02 is never resumed or rerun. The precondition is
MGR04's protected two-file sync into c19: `managed_local_paths.py` SHA
`78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC`
and `media_asset_store.py` SHA
`2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8`.
The existing schema26 repository and asset route remain pinned to their
pre-sync hashes. No schema30 migration, public probe, rights, or assembly
behavior is claimed.

The runner uses two fresh QA-owned profiles. Their WebM blob **logical**
paths are exactly 265 and 266 characters. Each profile gets one authenticated
sidecar HTTP project create, byte import (expect 201), original-content GET
(expect 200, exact MIME, ETag, length and SHA), normal close, read-only SQLite
count/integrity check, one reopen, asset list and content GET, and normal
close. Total maximum is four sidecar launches. Source WebM is the same 2,619
byte synthetic fixture used by r02, fixed by SHA. All request response bodies,
headers, sidecar stdout/stderr, PIDs, executable hashes, DB hashes, and the
first unexpected result remain in the new evidence/profile directories.
The package's read-only `inspect-db.py` is selftested against the frozen r02
schema26 QA database before sealing, and the prior P23 receipt checks the
expected Windows launcher/actual PID relationship. Neither selftest starts
a sidecar or alters its input evidence.

Before HTTP, the same one-shot runner checks the new helper rejects relative,
traversal, outside-root, UNC, ambiguous-component, and a QA-owned junction
path. The HTTP route accepts media bytes, not a supplied filesystem path.
These local negative checks do not establish resistance to a concurrent
junction swap. No browser, Electron, provider, FFmpeg, G1, rights decision,
assembly, or MLT is invoked.

The preflight builder must run **after** MGR04's protected sync. It records
the exact Git HEAD/status, every current `aijian_api/*.py` SHA, source and tool
pins, profile absence, and expected path lengths. Any source drift invalidates
the package. MGR02 must then create an approval JSON outside the indexed
package with kind `QA02_MEDIA_LONGPATH_HTTP_R03_ONE_SHOT`, status
`MGR02_APPROVED_ONCE`, exact package/envelope/runner/source SHA values, both
profile paths, evidence path, sidecar cap 4, provider cap 0, browser cap 0.
The runner rejects the unapproved template before creating output.

After approval, run exactly once:

```powershell
& 'C:\Program Files\nodejs\node.exe' '<r03 package>\run-once.mjs' --approval='<external approval JSON>' --approval-sha256='<external approval SHA-256>'
```

The first RED or UNKNOWN stops dependent work. Do not automatically retry or
reuse either output profile. Sidecar stdout includes an ephemeral token; keep
raw evidence local.
