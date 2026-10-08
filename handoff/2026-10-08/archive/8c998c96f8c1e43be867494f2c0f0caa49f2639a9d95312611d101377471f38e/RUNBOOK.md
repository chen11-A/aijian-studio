# QA02 real sidecar HTTP + headless Edge media slice

Status: `STATIC_CANDIDATE_NOT_APPROVED_NOT_RUN`.

This package proposes one isolated local run with **no visible Electron
window**. The runner starts the actual c19 sidecar twice against one new
QA-owned data directory. It creates one synthetic project and imports the
already frozen WebM, WAV, MP3 and undecodable MP3 by HTTP bytes. It reads
the original-content endpoint and checks returned size, MIME, ETag and
SHA-256 against the input and stored version. It normally closes the first
sidecar, reads the SQLite counters, restarts once, and reads all versions and
original bytes again. The second sidecar also closes normally.

Only then does it launch the existing Microsoft Edge binary with Playwright
`headless: true`. The browser receives the **actual reopened HTTP response
bytes** as a Blob. A real media element must emit `loadedmetadata`,
`playing` and `timeupdate`, advance currentTime, pause and seek for each
valid input. The deliberately invalid MP3 must report a decoder error and
never `playing`. The runner does not dispatch or simulate media events.

The result label is `HTTP_PLUS_HEADLESS_CHROMIUM_NOT_ELECTRON` even on a
pass. It does not exercise the desktop picker, renderer `SceneAndAssets`,
visible Electron controls, project switching, rights, G1, assembly, MLT,
provider, release, or user acceptance. The 32 MiB fixture is frozen in the
r01 input package but outside this minimal run; the native/UI negative plan
remains separate.

`RUN-ENVELOPE.json` pins the Git state, full sidecar Python source set,
Python/Node/Edge binaries, Playwright package, exact test inputs and output
paths. The source and tool files must still match immediately before the
run. The package contains an unapproved template only. MGR02 must first
provide an external approval JSON with the package/runner/envelope hashes,
kind `QA02_MEDIA_HTTP_HEADLESS_R02_ONE_SHOT`, status
`MGR02_APPROVED_ONCE`, `headless_only=true`, and
`provider_calls_allowed=0`. Do not modify this indexed package to approve
it. Expected invocation after approval:

```powershell
& 'C:\Program Files\nodejs\node.exe' '<this package>\run-once.mjs' --approval='<external approval JSON>' --approval-sha256='<external approval SHA-256>'
```

The first unexpected RED/UNKNOWN stops dependent work and leaves raw HTTP
bodies/headers, sidecar stdout/stderr, browser observations, process IDs and
the isolated DB in the new evidence/profile directories. There is no
automatic write retry or second run. A timeout stops only its owned child;
record a failure/UNKNOWN if normal close is not observed. The sidecar raw
stdout includes an ephemeral token, so keep this local evidence private.
