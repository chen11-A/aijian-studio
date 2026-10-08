# B31 desktop bridge source candidate

State: `AUTHOR_SOURCE_ONLY_NO_EMIT_NO_BUILD_NO_QA_NO_C19_SYNC`.

`MANIFEST.json` pins the four edited author sources, their pre-edit backups and
per-file patches, unchanged dependencies, the protected c19 baseline, and the
separate R2 sidecar candidate. Apply only reviewed hunks when integrating with
c19: its `main.ts` contains packaged-resource checks absent from the author
file. The older c19 desktop emit and renderer are not B31 artifacts.

The bridge exposes metadata PATCH, key-rotation POST, and operation GET through
top-level-frame IPC. Metadata and rotation 200 replies must match the requested
connection and next revision; an invalid receipt, transport failure, deadline,
or 503 yields `REMOTE_UNKNOWN`. A matching 401/403/404/409/422 error yields
`DEFINITE_SERVER_ERROR`. The bridge makes one rotation POST and never retries
it automatically. The caller must keep the original `operation_id` for GET
readback after uncertainty or `PROVIDER_ROTATION_OPERATION_EXISTS`.

## Required later QA samples (not run here)

1. Metadata PATCH with a public DNS origin and with a public HTTPS IP origin:
   backend accepts each; response identity, normalized origin, model order, and
   revision are checked before the UI claims success.
2. Metadata PATCH with `127.0.0.1`, private, and reserved IP origins: backend
   returns 422, with no provider call or persistence. The desktop origin check
   is syntax preflight; backend `validate_sub2api_origin` owns IP policy.
3. Stale metadata revision: 409 is definite. Timeout, 503, malformed 200, or
   wrong `X-Request-ID`: outcome stays unknown; read current state before a
   human decides whether to submit another mutation.
4. Rotation success: exactly one POST, no plaintext key in receipt/log, next
   revision, and `credential_status=CONFIGURED`. On 409
   `PROVIDER_ROTATION_OPERATION_EXISTS` or unknown, GET the original operation
   ID; verify PREPARED/APPLIED/CONFLICT/UNKNOWN and applied revision semantics.
5. Reject malformed IPC payloads and a sender outside the main frame before a
   sidecar call. Check the new preload channels against registered handlers in
   the emitted desktop build.
6. In the isolated packaged c19 candidate, recheck existing resource location,
   TEMP/Busy/owner guards, renderer freshness, and the R2 sidecar identity
   before any runtime claim. The R2 EXE has no B31 configuration QA receipt.

Static checks performed: source/backup/patch SHA-256 readback, four per-file
`git apply --reverse --check` passes, `git diff --check` on tracked edits,
channel and method mapping readback, and unchanged c19 source SHA-256 readback.
No TypeScript compile, test, emit, Electron run, provider call, or c19 write was
performed in this work window.
