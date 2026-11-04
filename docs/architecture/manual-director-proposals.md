# Manual director proposal slice

This additive slice is an offline, HUMAN-authored director-plan workflow. It is not an implemented professional AI director, model response import, media generator, storyboard approval, or release gate.

## Usable path and authority

Preparation also returns read-only `script_stored_content` and `production_brief_stored_content` proof objects. Their raw canonical hashes must match the authority pins, and applying only declared missing defaults must reproduce the normalized typed content. Unknown fields, coercion, trimming, and rational reduction are not allowed. Raw script proof is bounded to 2 MB; raw/typed brief proof uses a conservative 1 MB ceiling derived from the existing closed field/count bounds. These proof objects never enter a renderer proposal-write payload.

An existing original production brief is an immutable `production_brief` artifact whose `creative_entry.kind` is `original_idea`. A script pins that exact brief version. The user explicitly confirms the current script version through the existing EpisodeScript confirmation flow. Preparation resolves the actual confirmation ID, version, content hash, and head revision in one database snapshot, alongside the real brief version/hash and current saved storyboard base.

The closed ORIGINAL authority binds those two exact artifacts. It does not invent a SourceSpan. A script with source extraction or source-derived StoryBible bindings cannot use this branch. Scripts without an exact production-brief binding are currently unsupported and receive a clear preparation error; a generic `accepted_version_id` is never substituted for the script confirmation receipt.

ADAPTED authority additionally binds the script's existing SourceExtraction draft acceptance, exact extraction version/hash, and real proposal source-span identities. Its reader reuses the complete existing SourceExtraction lineage, quote, manifest membership, and hash checks. The brief's declared source document/block/manifest must be covered by that evidence. New preparation, proposal creation, and adoption also retain the existing current accepted-manifest membership gate. A prior immutable proposal or adoption remains readable after its inputs become stale.

## Typed plan and review

A plan contains 1–1000 shots with stable IDs and separate contiguous order. Each shot carries scene/block references, narrative purpose, coverage, framing/composition, performance, subject/environment/camera movement, before/after states, positive integer frame duration, integer handles, a half-open safe cut window, rhythm, and sound/dialogue intent. Every script block must be covered with its corresponding ACTION or DIALOGUE coverage. Dialogue intentions must match the dialogue blocks referenced by that shot; wrong-scene, unknown, duplicate, and cross-episode references are rejected.

Timing reuses the existing rational sequence timebase contract. The current V1 manual storyboard only represents integer frame rates. Fractional-rate plans can be saved and reviewed, with a server-derived BLOCKING capability loss; adoption never rounds or retimes them. A projection that exceeds legacy text/byte bounds is likewise blocked visibly, without truncation. Human BLOCKING issues prevent adoption. The saved plan always states HUMAN provenance and UNAVAILABLE generation.

The full typed plan remains in its immutable proposal version. Adoption produces an editable V1 storyboard projection with the same shot IDs, order, durations, exact script pin, scene references, and exact referenced dialogue text. The immutable adoption receipt links the detailed plan to that new storyboard version. The projection contains director intentions, not generated images, executed motion, audio, fulfillment evidence, or creative approval.

## Persistence and recovery

Migration 40 adds scoped proposal-write, adoption, and adoption-request receipts with immutable-update guards and artifact/version foreign keys. It does not alter migration 39 or the existing provider credential cleanup.

Proposal writes use an exact parent/revision CAS plus idempotency key and trusted server-side human actor. Adoption validates the reviewed proposal hash and explicit true confirmation, revalidates current input authority and the saved storyboard base, creates the new storyboard, and writes its receipt in one SQLite transaction. Previously saved storyboard versions are preserved. Repeated or concurrent adoption returns the original receipt and does not create another storyboard. Reusing a key with changed intent is rejected. Synthetic interruptions before/after receipt insertion roll back both the storyboard and receipt.

Uncertain clients must persist the original operation and use read-only write/adoption-status endpoints. They must not automatically replay an unknown mutation, create a fresh key, or discard the pending operation on a failed status read. A valid found receipt reconciles the operation. A missing status receipt does not itself authorize resubmission. The component reports `dirty`, `pending`, and `busy` separately to its host. Missing native gateway or unavailable journal storage has an explicit error state. Local dirty script/storyboard edits and unresolved save journals must disable adoption in the UI; server CAS protects saved state, not unsaved renderer edits.

## API integration

Public read router: `create_shot_plan_public_router`.
Authenticated sidecar-only write router: `create_shot_plan_write_router`.
Migration constant: `SHOT_PLAN_MIGRATION`.

Under `/api/v1/projects/{project_id}/episodes/{episode_id}/shot-plan-proposals`:

- GET `/preparation`: exact current inputs and storyboard base
- GET root / GET `/versions/{version_id}`: immutable review data and capability losses
- GET `/human-operations/{operation_id}`: read-only proposal write receipt lookup
- GET `/versions/{version_id}/adoption`: read-only adoption receipt lookup
- POST `/human`: explicit HUMAN plan creation
- POST `/versions/{version_id}/adopt`: explicit manual adoption into a new storyboard

There is no provider submission or model-completion endpoint. Renderer text cannot establish AI provenance. A future trusted provider-output workflow requires a separate contract and actual consent, budget, execution, response, UNKNOWN recovery, validation, and human-decision evidence.

## Verification and limits

Focused tests exercise 7/11-shot adoption, stable reordered identities, exact dialogue transfer, old-version preservation, original and adapted authority, stale script/brief/storyboard/proposal/source inputs, duplicate/invalid/missing coverage, strict booleans and integer/rational timing, sidecar authentication/origin/key gates, concurrency, crash rollback, and read-only reconciliation.

A separately shippable EpisodeScript bug fix makes exact dependency comparison independent of random dependency UUID order, retaining duplicate/missing/extra/role rejection and exact stored-content serialization.

No dependencies, third-party source, live AI, credentials, media fulfillment claims, release acceptance, or service costs are introduced. Backend tests do not replace actual desktop/UI testing or professional creative review. Registration, generated contracts, the native decoder/IPC bridge, and compact original-style UI integration must pass their own checks before this flow is considered user-facing.
