# Confirmed script provenance for local sound and subtitles

Batch 27 design, against `6dd1fe6f03684e824c6c056e48c5b0aa83e7216f`.
Implementation must follow independent design review. This is the source dependency
part of P14/P18/F01, not voice authorization, generated voice, audition acceptance,
lip sync, formal mastering, or Windows playback acceptance.

## One complete local workflow

1. Save and explicitly confirm an episode script using the existing immutable
   script versions and append-only human confirmation receipts.
2. In sound/assembly, bind an imported recording to an exact saved dialogue. In
   assembly, explicitly select a dialogue and add or replace a real text subtitle
   at an exact frame interval. Its exact script version, block and content hash
   remain with the rendered text; unsupported or overlong text stays blocked.
3. Explicitly adopt the last human-confirmed script receipt for the assembly's
   dialogue and script-derived subtitles. All referenced script versions must
   match it. This is an unsaved, undoable edit until normal CAS save/readback.
4. Reopen the same immutable assembly in either entry. Its dependency status names
   the exact confirmation and affected dialogue/subtitle segment IDs. A newer
   unconfirmed script draft is a warning, not a replacement of confirmed truth.
5. Once the user explicitly confirms a different script version, old confirmed
   bindings are superseded. Historical assembly and export evidence remain
   readable, with their original hashes. New assembly saves and new DRAFT export
   submissions using the superseded confirmed source are refused before encoding.
6. Read the exact old and selected new sources, deliberately rebind each recording
   or replace each script-derived subtitle, explicitly adopt the new confirmation,
   and save a new assembly version. No bulk inferred audio matching. An explicit
   return to unconfirmed DRAFT provenance is allowed for further draft work and
   never counts as formal approval.

## Persistence and authority

Reuse the current project SQLite database, artifact versions/dependencies and
`episode_script_confirmations`. No copied script, second version head or new Gate
decision. Human script confirmation deliberately does not update accepted Gate
heads. Gate replacement invalidation remains its existing separately typed ledger;
confirmation replacement is assessed against append-only actual confirmation truth.
Compare confirmed source identity by version ID and content hash, not receipt ID:
reconfirming the same exact version leaves an existing valid receipt usable. Do not
use the existing `confirmation.current` flag as a consumer freshness gate, because
it intentionally describes equality with the latest draft, not latest confirmation.

Optional assembly `script_provenance` has mode `DRAFT` or `CONFIRMED`. CONFIRMED
contains the exact confirmation ID, script version and immutable content hash.
It is omitted from legacy content, preserving schema 1.0.0 and every old hash.
New explicit provenance records deduplicated artifact `references` dependencies:
advisory for unconfirmed DRAFT sources, blocking for confirmed sources. Legacy
versions are not backfilled. Reads compare the full expected storyboard plus script
dependency set with stored edges; storyboard-only validation must filter only the
script edges actually justified by explicit script provenance, never arbitrary
extra edges.

Literal subtitles optionally carry `script_ref` (version, block, script content
hash). The server verifies exact episode/project, canonical source hash, dialogue
membership and deterministic text formatting: preserve supported one/two-line
text, otherwise wrap a single supported line at 28 Unicode code points when its
length is at most 56. Never truncate, paraphrase, translate or silently relabel.
Manual text changes require explicit removal of this provenance. Frame edits alone
preserve it. Legacy reference-only cues and manual text cues remain available.

Optional response `script_source_status` exists only for explicit provenance.
It distinguishes DRAFT_UNCONFIRMED, CONFIRMED_CURRENT, CONFIRMATION_SUPERSEDED and
AUTHORITY_UNKNOWN, includes the last confirmation and affected segment IDs, and
marks a newer draft separately. This is fresh read-time assessment, not a rewritten
artifact or another stored source of truth. Unknown/corrupt/missing authority cannot
enable confirmed save/export. Exact source integrity remains mandatory for all
existing and new references. Original bytes, latest rights and probes retain their
existing independent checks and DRAFT limits.

## Concurrency and delivery constraints

Confirmation resolution, dependency validation and assembly save use the same
BEGIN IMMEDIATE transaction and existing expected head revision. Export admission
rechecks authority before tools; later approved-source replacement may require a
final writer-side fence if the existing export admission allows a race. Do not
weaken current DRAFT media/rights/version safeguards or claim immutable media
checks are fresh receipts for a future operation.
The existing DRAFT writer already performs `_read_assembly` again inside its final
BEGIN IMMEDIATE transaction. Extend that shared check and add a pre-encode worker
check. A confirmation arriving during encoding cannot produce a successful final
file; the confirmation itself does not launch or cancel any encoding operation.

Renderer reads fence project, episode, content identity, selected source and epoch
including A-B-A. Independent read failure cannot clear a saved pin. Adoption is
explicit and preserves unsaved form/trim input through the existing navigation
guard. Use the existing assembly CAS transport journal; UNKNOWN is never retried.
No new write endpoint or automatic confirmation, Provider, encoder, publication,
charge, credential or account/workspace action is introduced by adoption.

## Required regression evidence

- Dual projects/episodes; exact old source reopen and unchanged hashes; valid and
  foreign/missing/corrupt confirmation, source/block/hash; mixed sources refused.
- New draft alone retains confirmed source; new human confirmation supersedes it;
  duplicate confirmation of the same source does not unnecessarily invalidate it.
- Actual persisted script dependency edges, full edge integrity and existing
  storyboard/G5 dependencies together; old legacy dependency sets unchanged.
- Real script-derived subtitle text/frame provenance through add, explicit replace,
  manual conversion, frame edits, undo/save/readback; overlong/unsupported denied.
- Superseded confirmed new save/export refused before tools; explicit new binding
  and receipt adoption saves a different version. Approval produces no external
  action. Missing/changed media and latest rights checks continue to apply.
- A-B-A, late reads, inconsistent receipts, dirty forms, UNKNOWN/bad write receipt
  remain locked and require read-only recovery; no retry on missing readback.
- Affected Python/desktop/renderer tests, no-emit type checks, scoped lint/format and
  contracts check. No build/install/native/live model testing; Windows held open.
