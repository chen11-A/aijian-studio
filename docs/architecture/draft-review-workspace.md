# Shared manual DRAFT review workspace

Candidate base: `32d014624aad134a6884121a58a26b75088104c9`.

P15/P16/P19 expose one exact selected export operation, scoped by project and
episode, using the existing DRAFT export, notes and revision gateways. Selection
is a UI cursor in the existing workspace-selection record, never a second saved
review database. Legacy selection records remain readable. Fresh scoped GET
readback is required before showing an editor; an absent or invalid selected
operation never falls back to the first/latest export. The latest-20 list is only
a picker; a retained operation outside that list can still be read exactly.

Reuse `DraftExportOutput`, `DraftReviewNotes` and `DraftReviewRevisionPlans` and
their existing pending-write/input recovery. Review and changes open the relevant
editor directly. Export retains its existing history and provides the same
selected workspace. Changing scope/operation destroys the prior editor/player;
per-output inputs and unknown writes remain in their existing recovery journals.
Read epochs prevent late A→B→A replies from being adopted. Invalid selection
storage is preserved and reported; explicit selection requires reliable storage.

An approved exact plan provides navigation to the same episode's assembly and
export. Navigation does not edit, encode or call a provider. The user saves a new
immutable assembly and separately exports it. The existing backend rejects
pre-approval, same-assembly, mismatched-hash or unverified candidate association.
Comparison and manual recheck use the same append-only objects at all entrances.
Missing/changed files retain historical records and block new dependent actions.

Integer frame comments are exact record coordinates. HTML video seeking remains
approximate. Formal review signoff, realtime editing playback, provider execution,
fees and release approval remain unimplemented and are not inferred from DRAFT.

Verification: focused renderer navigation/recovery/lifecycle integration, native
client/IPC contracts, real temporary-file backend review/revision tests, scoped
lint, no-emit typechecks and unchanged OpenAPI generation. Windows native playback,
model quality, install/upgrade and full historical Word reconciliation are pending.
No product build or installer validation is authorized in this task.
