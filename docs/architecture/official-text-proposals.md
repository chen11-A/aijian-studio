# Official text proposals and explicit script adoption

This additive schema-37 slice keeps the original AIVORA interface. It does not
claim live official authentication or inference acceptance; tests use synthetic
fixtures only.

A trusted Electron main-process adapter validates project/episode and a saved
script base (version, hash, revision; or no script). After native approval, but
before an official HTTP request, it durably reserves one UUID operation with
exact prompt/model/profile/request-hash. Its initial state is deliberately
REMOTE_UNKNOWN: process death must not authorize another paid request. Existing
operation IDs are read-only recovery and are never resubmitted.

Only the main process receives the provider completion and can post it to the
authenticated sidecar. There is no renderer IPC for importing arbitrary text as
an official result. A completion creates an immutable `official_text_proposal`
artifact version with input and output provenance. A changed script does not
discard the completed proposal; it blocks adoption. NOT_SENT is recorded only
when the trusted runtime establishes that no request was made.

The user reviews persisted bytes and explicitly adopts their exact proposal
version/hash. In one transaction, the store verifies the captured script CAS,
appends the exact result as a clearly labeled action-text scene, creates a normal
editable script draft and an immutable adoption receipt linking both artifact
identities/hashes. Text is not parsed as commands, rich HTML or source extraction.
No source acceptance or script confirmation is created. Existing scenes and
upstream references remain unchanged. Subsequent manual edits use normal parent
version lineage. Repeated adoption returns the original receipt rather than
appending twice; stale bases are rejected without overwriting work.

Public read routes expose project/episode-scoped results. Reservation, settlement
and adoption exist only in the authenticated desktop composition. Credentials
never enter these contracts, SQLite, renderer state, or logs. Unknown remote or
local outcomes have read-only recovery; there is no automatic inference retry.

## Focused verification, 2026-10-08

All test model names, account IDs, prompts, results and timestamps are synthetic.
No login, authorization, model-list request or inference was performed.

- Seven Python tests cover durable restart, exact saved-base adoption, old-version
  preservation, later manual editing, absent source acceptance/confirmation,
  mismatched identity/hash rejection, UNKNOWN submission blocking, episode
  isolation, transaction rollback, immutable receipts, authenticated routing and
  interrupted schema-37 migration recovery.
- Nine desktop tests cover native adapter ordering, exact request/reservation
  identity, duplicate/replayed operations, malicious result fields, sender-frame
  rejection, post-inference write failure, restart UNKNOWN protection, sidecar
  request identity and preload channel parity.
- Five renderer tests cover persisted review, explicit adoption, dirty/stale-base
  lockout, duplicate actions, unmount interruption, UNKNOWN read recovery and
  cancelled native consent retaining the typed prompt. Three existing source
  summary/editor regressions also pass.
- Desktop and renderer typechecks/production builds, targeted ESLint, new-module
  Ruff/mypy and diff whitespace checks pass. The existing renderer bundle-size
  warning remains; these focused checks are not a repository-wide test pass.

Before-send native cancellation deliberately does not create a remote operation:
there is no durable reservation yet. It returns NOT_SENT and preserves the form.
After reservation, unknown/terminal receipts and proposal artifacts are durable.
A remote completion whose local write cannot be verified remains UNKNOWN; it is
not automatically generated again. User-authorized live account/inference
acceptance and full native review of a genuine model result remain outstanding.

At 07:15 UTC, the native original editor opened the existing saved script-v2 and
successfully read the empty local proposal history. Prompt fields remained empty,
no model list or generation was requested, and the generation action stayed
disabled. This verifies the native read-only seam, not a real model result.
