# Explicit G5 environment scope and persistent downstream impact

Batch 28 design against `ed1f9bb781502516970b855b3df887da50c42b3e`.
Implementation starts after independent design review. P10/P11/F01 require actual
human approval and persistent affected-version reports, not an environment label.

## Complete local flow

1. Use the existing immutable creative library 1.3 to save world text, locations,
   location states and real environment references with owned asset/version/hash.
2. In the existing visual review editor, explicitly extend a candidate into visual
   content 1.1. Its environment_scope declares inclusion of the pinned world's
   text and selected state/reference IDs. The UI shows full pinned world and state
   descriptions, continuity, ownership and exact reference identities. It never
   substitutes the latest library or current asset version. New scope is initially
   an unsaved candidate, never an extension of an existing approved version.
3. Separately save, explicitly inspect originals, submit, sign and approve using
   the existing native cancel-default confirmation and trusted continuity_reviewer/
   producer roles. Existing findings, rights audit, native static-image evidence
   and fresh originals checks all apply. No provider, encoder, publisher, fee or
   automatic task runs from any human approval action.
4. Both storyboard editors explicitly inspect and adopt the exact current approved
   environment-aware G5 and its exact library. This promotes only the next edited
   storyboard to 1.5; existing 1.0 through 1.4 bodies/hashes do not change. Preserve
   all shot text/planning/character/environment selections. Missing or out-of-scope
   selected states/references prevent adoption; never clear them to fit approval.
5. For a 1.5 pinned board, each shot can select only approved states and applicable
   approved world/location/state references. Each state's location and each ref's
   scope must match the exact library. Old G5 cannot authorize any independent
   environment choice. Explicit unpin leaves selections as DRAFT without downgrading.
6. Save through the existing board CAS and read back the exact immutable version.
   New assembly/DRAFT/native-plan consumption rechecks current G5 evidence. Historic
   board/assembly bodies remain readable after approval replacement or original loss.
7. Approving a replacement visual version uses the actual G5 accepted-head change
   and existing immutable invalidation_operations/reason paths in the same writer
   transaction. Reopen the saved report in both the visual and Changes entries;
   show old/new approval, change reason, exact downstream boards and assemblies,
   current episode metadata separately from historic affected shot identities.
   No retargeting, regeneration or automatic money reservation.

## Exact approval and compatible versioning

VisualBibleContentV1 (schema1.0) and its G5 policy1 retain exact old behavior and
readiness report shape/hash. Add a closed discriminated VisualBibleContentV2
(schema1.1) with environment_scope {world_included:true, scene_variant_ids:[scv],
environment_reference_ids:[erf]}. Lists are unique and bounded by the existing
library limits. Only selected IDs are approved; empty state/reference lists are
an explicit review declaration, not authority for all library entries.

The exact library must be 1.3 for a new scope. Selected states exist in that library
and belong to declared visual locations. Every selected reference resolves to the
same library, declared scene and, if state-specific, a selected state. Each selected
state needs at least one selected reference specifically bound to that state;
world/base references cannot stand in for a distinct state's original evidence.
This extends existing G5 reference completeness checks while preserving its
character/costume/base-scene/prop/safe-area requirements.

Resolution adds only selected environment originals to the existing deduplicated
visual_sources inventory, refusing conflicting hashes. The readiness report for
policy2 includes an exact environment projection: the declaration plus full pinned
world text, selected immutable states and selected reference identities. Original,
latest validated rights and native inspection evidence remain in the same report.
The trusted native confirmation must display this real projection; readiness and
source content must be correlated, not accepted solely on a rehashed foreign report.
The existing trusted review inventory budget remains 6000 distinct original versions.
New scope beyond it is explicitly blocked instead of minting an unreadable ready
report. This is a remaining bounded review capability, not a full export limit change.

Use a separate explicit G5 policy2 snapshot/readiness contract for visual schema1.1,
selected by the actual immutable version row inside each review transaction and
read-only authority/readiness route. Do not globally replace policy1, silently
invalidate legacy approvals, infer new policy from renderer input, or allow policy1
challenges/signoffs to approve policy2 content. Required roles/permissions remain
unchanged. Unknown/nonregistered policy/schema combinations fail closed.

Storyboard 1.5 uses existing shot planning/environment DTOs and an explicit nullable
visual pin. Non-null pin must refer to environment-aware visual schema1.1. The pairing
is bidirectional: visual1.1 adoption requires storyboard1.5, while legacy visual1.0
remains valid for its existing storyboard1.2 through1.4 scopes. Compatibility prechecks
may inspect an older candidate before explicit adoption promotes it. Validate
state/reference membership against both scope and pinned library before approval
claim/new save. Storyboard1.4 keeps its existing rejection of nonempty environment
choices with any G5 pin. Shared native/renderer guards accept the new closed schema,
and editing/projection/clone/shot-add operations preserve 1.5 instead of downgrading.
Use the existing artifact graph edge from board to visual; no separate environment
approval database, gate boolean, copied asset or shadow library head.

## Recovery, races and evidence

Retain the current CAS/operation identities, challenge expiry, trusted main-held
tokens, current document fencing and exact historical operation recovery. UNKNOWN
never resends. Every write journal must persist before dispatch, clear only the
exact original record and verify deletion, retain a missing/replaced unresolved
original, and protect dirty/busy/unknown navigation and closing. New scope reads do
not clear any save/review/inspection pending operation. Out-of-order A-B-A data,
foreign scope/hash, missing originals, changed rights/inspection, changed head or
policy challenge between prepare and consume fail closed. Reads preserve pins and
unsaved fields until an explicit compatible adoption/save.

Required tests: old schema/policy/report/hash; exact new scope and actual SQLite
approval; wrong library/state/ref/hash/rights/original/inspection and foreign project;
no signature or out-of-scope old G5 rejection; prepare/consume races and rollback;
two actual episode boards/assemblies with persistent replacement report after reopen;
both UI entries, actual state/ref edits and adoption, preservation/projection;
UNKNOWN replacement/removal/bad receipt/read-only recovery/no resend, dirty input,
late ABA. Affected unit/integration, no-emit types, lint and additive contracts only.
Do not build/install/launch Windows or native binaries or call paid/live providers.

## Separate confirmation impact work must remain visible

Batch27 stores real script dependency edges and compares last actual human script
confirmation during new save/export. It does not persist a confirmation replacement
event, an exact affected-version/segment snapshot, or a pageable reopenable report.
Existing invalidation roots require an actual approved Gate decision and accepted
head; script confirmation does not create either. Never fabricate a Gate decision
or accepted head to reuse that root. Reuse graph traversal/hash/keyset/immutable
receipt patterns through an explicitly typed confirmation cause ledger and real
project/episode/source identity, tied atomically to the original confirmation.
Same-source reconfirmation has no replacement impact; unconfirmed drafts do not
invalidate. The next dependency batch must connect those stored reports to the
existing sound/subtitle and Changes flows before claiming full confirmation impact.
Episode-scoped script sources cannot be forged across episodes for a two-episode
test; shared environment G5 legitimately has consumers in both episodes.

Static image inspection remains the current evidence capability. Video/animation,
Windows decoder/window/playback, formal environment visual quality and original
Word page-by-page reconciliation remain unverified. DRAFT limits, native unavailable
policy lists, safety/licensing/CI/coverage gates and previous evidence remain intact.
