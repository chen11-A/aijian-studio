# G5 visual identity approval and exact downstream consumption

Implementation basis: full product P08/P09/P11/P12 and the G5 VisualBible Gate in
workflow-and-agents.md. A G5 approval is a human decision over an immutable visual
version, not a field on a character or a new name for a draft selection.

The visual-bible artifact binds an exact project creative-library version/hash,
explicit character reference IDs, scene references, props, and a user-defined
portrait safe area. Character identity, costume ownership, names and descriptive
constraints resolve from that one library version. Every included character and
costume needs an owned real visual reference. Every library scene must be covered
by an explicit scene entry. Empty props means the human is declaring no separate
props in this version; it must appear in the review checklist. Original artifacts
remain unchanged when another candidate is saved.

Approval reuses review_submissions, role_signoffs, confirmation_challenges,
gate_readiness_reports and gate_decisions. G5 uses the existing trusted human's
continuity_reviewer/producer roles; no actor, credential or permission expansion.
Single-user multi-role self-review is explicit in the native confirmation. Save,
submit, sign and approve are separate user actions. Waivers remain disabled.
Open blocking findings, bad stored content/dependencies, unavailable originals,
missing/restricted or corrupt rights declarations, and unverified technical
content prevent approval. A rejection can preserve a damaged candidate's history.

Readiness evidence must be checked again when a confirmation is consumed, even
when reusing the exact report signed by the human. A rights head, original file,
source pin or review evidence change invalidates the confirmation. Human rights
declarations use the existing manual transaction's validated audit history;
this is not the separate assistant selected-reader/export claim proof, whose
Windows-only platform/security gates stay unchanged. No probe, encoding, provider,
upload, publication or charge is triggered by approval. Technical inspections
must use a separately explicit action and be bound to the original bytes.

A storyboard can explicitly pin an approved visual version/hash. Its creative
library pin must match that version and its shot character/costume/reference
choices must fall within the approved visual scope. The dependency edge to G5
joins the existing graph; assembly dependencies already join the storyboard.
Fresh consumers require current valid approval/evidence. Historical reads retain
their object and show superseded or unavailable authority instead of silently
selecting the newest version. Legacy manual storyboards remain readable without
claiming G5 approval.

Approving another shared visual version records the old/new approval and a change
reason, and reuses accepted-head replacement invalidation. Conservatively list
all affected exact downstream versions and shots; never automatically rewrite a
pin, regenerate, reserve money or execute a task. Editing an episode's costume
choice remains distinct from modifying the shared identity itself.

Required checks include two projects/two episodes, stale A→B→A reads, dirty inputs,
UNKNOWN no-resend and exact recovery, forged receipts/recomputed hashes, old
policies/versions, file and rights changes between prepare and consume, blocking
findings and untrusted actors, approval without signoff, and changed approval to
storyboard/assembly invalidation. Controlled adapter faults are engineering tests;
Windows/player/model acceptance remains separate. This document is the design
under implementation, not a claim that those checks have already passed.

## Concrete implementation and remaining acceptance

The native creative page includes candidate editing and separate save, technical
inspection, submit, role signoff, approve and reject controls. The renderer only
receives an identity/action ticket; the expiring confirmation token stays in main,
is bound to the originating document, and is consumed once after a cancel-default
native dialog. Pending save/review/inspection journals contain the original input
or safe ticket, never tokens. UNKNOWN recovery only reads the exact operation;
a not-consumed challenge is terminal only after expiry and after the writer lock
has settled. A missing receipt remains unknown.

For G5 only, a previously signed readiness report can be reused after its original
five-minute expiry when a fresh transaction recomputes precisely the same evidence
hash. Every subsequent action requires a new unexpired challenge and rechecks the
evidence again inside consumption. Changed rights, bytes, inspection or policy
cannot reuse the old report. G1/G2 expiry behavior remains unchanged.

Storyboard schema 1.2 explicitly retains a nullable visual pin: unlinking clears
its approval claim without downgrading or dropping shot bindings. Whole-board
projection refuses to discard this field. Both storyboard entry points inspect
the current approved visual version read-only and ask before changing the draft's
visual/library pins. Existing selections and affected shot identities are shown;
missing or wrong-owner choices cannot save. New assembly saves and new DRAFT
preflights check current evidence; historic assemblies and receipts remain readable.
Approving a replacement produces blocking graph paths through the exact boards
and assemblies in both episodes, without retargeting or executing them.

Technical inspection currently supports bounded static PNG/JPEG/WebP through
Electron nativeImage. Animated PNG/WebP are rejected because one returned bitmap
cannot attest to all frames. Video inspection and Windows decoding/display remain
open. The tests explicitly use synthetic fixtures and controlled decoder adapters.
G5 findings authoring, complete asset invalidation and
other media consumers remain open product work; this batch does not claim full
product or full historical Word reconciliation.

The history directory projects exact immutable source summaries from the existing artifact store. Pages are bounded to 20 entries, owned by one project/artifact and ordered by version number; physical file checks stay in fresh consumption. The native and renderer guards bind cursor/head/identity. The UI distinguishes an accepted-head pointer from current valid approval, preserves prior pages on unknown/stale continuation, and compares the selected summary with the complete exact version before replacing editor fields. It creates no separate persisted history store.

Completed operation settlement validates the returned action outcome as well as the challenge input hash. Native and renderer checks compare the exact decision/rationale or full signoff role set. The server reconstructs the payload from immutable persisted receipts and matches its bound actor/roles/policy hash; this does not re-open original files or require historical approval to remain current. Contradictions stay unknown. Successful writes or recovery invalidate cached approval/readiness/review displays, which are exposed only for the selected exact version/hash and relevant head revision.

Operation settlement additionally anchors receipts to the existing native local-user subject and its complete ordered writer/continuity_reviewer/producer role vector. A response cannot choose its own subject by recomputing a hash. The server compares challenge roles with its trusted actor. This boundary applies to settlement receipts, not immutable version authors or history-directory reads.

Saved impact paths expose an explicitly requested read-only consumer projection. A single SQLite snapshot verifies the ledger assessment and exact affected artifact/version hash. Storyboards project all authored shots; assemblies project only exact saved storyboard references. Original-file verification remains a fresh-consumption requirement, so historical context survives file loss. The projection identifies current episode metadata separately from immutable shot/version content. Native and renderer guards bind project, operation, path, assessment and version identity, retain prior verified summaries on unknown reads and reject stale responses. Inspection does not retarget an editor or execute work.
