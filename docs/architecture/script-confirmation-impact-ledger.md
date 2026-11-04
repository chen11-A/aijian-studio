# Script confirmation replacement: persistent exact impact

Batch 29 design against `d5a5596397337b4d8dd07f8597a7bc2be79223da`.
Total baseline remains `32d014624aad134a6884121a58a26b75088104c9`.
Implementation follows independent design review; this document alone does not
close the remaining product item. The batch28 independent confirmation audit and
actual SQLite gap reproduction are the starting evidence.

## One local workflow

1. Save an episode script, then explicitly confirm its exact version/hash with the
   existing trusted human actor and idempotency key. Confirmation remains separate
   from Gate approval and never updates an accepted head or executes work.
2. The same `BEGIN IMMEDIATE` writes the original immutable receipt and a distinct
   immutable impact report. First confirmation is BASELINE; another receipt for the
   same version/hash is SAME_SOURCE. Both have explicitly zero replacement paths.
   Only a different source is SOURCE_REPLACED.
3. Sound/assembly and Changes share one report component. A project keyset history
   opens an exact report. It shows old/new actual confirmation/source identities,
   the exact affected artifact/version/hash, episode, dependency cause, and saved
   dialogue/subtitle segments with frame intervals. Unknown reads remain unknown.
4. Report readers can inspect immutable old/new script and affected stored source
   facts without media originals, latest heads or new writes. Reports retain event
   facts after later confirmations/assemblies; current editable objects are separate.
5. Users deliberately rebind recordings and replace literal script subtitles using
   the batch27 controls, explicitly adopt the new receipt and separately save.
   Reading an impact report does not rebind, approve sound, clear UNKNOWN or waive
   fresh original/rights/G5/confirmation checks for new consumption.

## Storage, coverage and atomicity

Use the next schema migration, currently 44, in the existing workspace database.
Add a confirmation-impact namespace, preserving Gate ledger DTOs and all old bodies,
hashes and edges. An immutable coverage marker records the pre-migration maximum
confirmation rowid and count as informational coverage metadata. Add receipt column
`impact_coverage_version` with default 0 for existing rows and explicit 1 for new
confirm inserts; a new insert trigger requires 1. Original receipt DTO/hash stays
unchanged. Classify coverage by this immutable marker, never by rowid comparison:
implicit SQLite rowids can be reused after legitimate parent deletion. The original
no-update trigger continues to forbid changing 0 to 1 or 1 to 0.
Existing receipts have no event-time graph snapshot:
do not backfill them or write on GET. Exact lookup distinguishes UNCOVERED_LEGACY
from a missing/corrupt report. Every new receipt after coverage must have one report;
missing a required report is corruption, never a claim of zero impact. A new report
requires a coverage-1 receipt; legacy coverage-0 receipts cannot gain a backfilled
event report.

Report root contains a new `sci_` ID, project and source episode, source kind
EPISODE_SCRIPT_CONFIRMATION, new confirmation ID UNIQUE, nullable old confirmation
ID, schema/algorithm version, event kind, created_at and assessment_hash. Its bounded
canonical JSON holds full old/new receipt identities, exact source hashes, affected
version identities and paths/segments. SQLite FK/insert triggers bind actual receipt
owners, same script artifact, immediate prior receipt and canonical root metadata;
immutable update/delete protection follows existing parent-deletion rules.

The confirmation writer reads the prior actual receipt before inserting the new
receipt; after validation it assesses and persists the report before one commit.
Any graph/projection/size/insert/readback fault rolls back receipt and report together.
Idempotent replay verifies and returns the original exact receipt; its report is read
by exact new confirmation, never recomputed against later graph state. Old precoverage
replays remain old and do not acquire a synthetic historical report.

## Exact graph and segment evidence

Reuse pure exact-version graph identity/edge validation, cycle rejection, ordering
and effective-impact rules from the current invalidation domain. Add a separately
typed source replacement assessment; do not manufacture AcceptedArtifactHead or
Gate decisions, either in SQL or domain input. Historical paths snapshot the real
dependency IDs, complete upstream/downstream artifact/version endpoints, relationship
and impact. Classification is SOURCE_SUPERSEDED for a wholly blocking path, otherwise
REVIEW_REQUIRED; it is a source fact, not formal downstream approval or a new Gate.

The direct lawful script consumers are episode scoped. Traverse real project graph
edges without allowing a direct script reference from a different episode. Shared
environment/world reports may cross episodes, but tests must not fabricate a foreign
script binding just to obtain a two-episode count. Other project/episode data remain
isolated, and legitimate downstream paths preserve actual recorded scope.

For affected assemblies verify immutable stored JSON/schema/canonical hash and the
complete expected dependency set. Snapshot only dialogue/subtitle segments actually
referencing the replaced source; include exact segment IDs, kind, original stored
frame interval/timebase, script version/hash/block, speaker/delivery, media version/
hash and source sample range where present. Preserve literal subtitle text/render
profile and its exact reference; legacy reference-only subtitles remain separately
typed. Include saved storyboard refs and their exact shot IDs where applicable;
do not infer current shot names or recording content QA.

Scan at most 1,000 assembly versions and 32MiB of their stored canonical bodies
before materializing per-consumer projections; refuse atomically above these
control bounds. Legacy assemblies may contain script dialogue/reference-only subtitles without
explicit script_provenance and therefore no edge. A bounded project scan verifies
each stored assembly and snapshots actual old-source segments as
LEGACY_CONTENT_REFERENCE / ADVISORY_LEGACY_REVIEW. Do not invent dependency IDs,
backfill old artifact_dependencies, or automatically migrate old content. New explicit
advisory DRAFT sources retain their real edge and REVIEW_REQUIRED classification.
Duplicate reason paths are rejected; segments are stored once per affected version,
with all exact reasons retained. Detached metadata failure is not silently skipped.

Engineering safeguards: at most 10,000 graph versions, 40,000 exact edges, 10,000
paths, path depth 64, 1,000 affected versions and 2,000 script segments per consumer (the existing
assembly permits 1,000 audio plus 1,000 subtitles); each
consumer canonical projection at most 2,000,000 bytes and total assessment at most
12MiB, below the existing native JSON ceiling. Direct consumer/current script and recursive assembly/storyboard script, creative-library and visual-version loads use SQL byte/span/dependency fences before body materialization, with a shared distinct-source 32MiB budget. Graph reads use limit+1 and
refuse atomically; no truncation. Enforce path/depth budgets during traversal,
before appending or descending; never expand the old unbounded collector and only
then check its output. Reuse a bounded pure collector with unchanged defaults for
the existing Gate algorithm. These are report control bounds, not a claim of
full-product export scale. Existing assembly/DRAFT limits remain unchanged.

## Read contracts and UNKNOWN recovery

Authenticated readonly endpoints provide project keyset summary pages, exact report
detail, exact confirmation coverage/report lookup and original operation lookup.
Reads use query_only/no-store and closed scope, receipt/hash, algorithm, path and
consumer projection guards; detail canonical assessment hash is verified in backend
and native client. Validate event bodies against immutable stored receipts/version/
edges, never against today's head to decide historic membership.

Original confirmation lookup uses the exact original UUID idempotency key, trusted
actor and original payload. The native lookup binds the actual production trusted subject, currently local-user,
from trusted main configuration; renderer supplies no actor override. The server
recomputes the existing request hash and
returns only the matching original receipt plus coverage/report. It uses the trusted
native route, excluded from public OpenAPI, rather than letting renderer impersonate
an actor. Wrong actor/input/key/scope is rejected; response is correlated with the
original operation and full input. A missing lookup does not prove NOT_SUBMITTED
and does not release UNKNOWN; it may race a delayed original write.

Replace the confirmation UI's unattributed "end unknown" path with exact readonly
operation recovery. Persist the original intent before dispatch, retain an in-memory
own intent if local storage disappears/replaces it, remove only the full matching
canonical intent and verify deletion. UNKNOWN/bad receipts, replacement/deletion
failures keep the original lock and block navigation/resubmission. Old pending
records are readable under the existing key and must use this exact lookup. Current
status/source reads alone cannot settle an operation. Definite POST rejection requires the exact native mutation code/status pair and closed canonical-request-ID receipt; GET-only missing-operation codes and unrelated 4xx remain UNKNOWN. Reconcile historical success
even if a later source is confirmed; do not resend or mistake it for current authority.

Changes and the shared Voice/Assembly report component have independent project/read generation fences including
A→B→A, exact detail selection and immutable summary/detail correlation. Unapplied
assembly/script fields remain protected; refreshing a report never discards them.
Ordinary/professional modes use the same controls, data, quality and permissions.

## Required evidence and remaining scope

Test real temporary SQLite, schema migration/coverage and reopen; first/same/different
source, unchanged newer draft, original replay, extra/wrong edges/hash/scope/receipt,
exact blocking/advisory/legacy segments and ranges, later-event preservation, rollback
at each write stage and bounded graph/body refusal. Add actual authenticated HTTP,
closed native contracts/IPC/top-frame checks and real React workflow/recovery tests,
including replaced/missing/delete-no-op journal, bad/unknown results, writes=1, dirty
inputs, dual scope and A→B→A. Reuse valid unchanged export and native evidence by SHA;
new report reads do not execute tools, providers, encoders, publication or fees.

Run affected checks, no-emit type/lint/contracts and independent review, then one local
commit and cumulative transfer proof/Library package. No build/install/native execution,
live model/media/voice, fee, credential/account workspace, remote push/CI or user-PC
action. Formal sound/subtitle review versions, mixing/lip sync, PictureLock/master,
supplier-independent media tasks/candidates, real-time playback, formal review/export
and Windows acceptance remain future batches. Original Word remains unreconciled.
