# Official AI director proposal slice

This is an additive schema41 workflow for a typed text proposal. The schema40
HUMAN director template remains separate and unchanged. A saved AI plan is not
generated media, a professional creative acceptance, a storyboard gate signoff,
or a released product.

## Exact preparation and approval

The renderer sends only scope, a new operation UUID, the requested catalog
model, exact authority/storyboard pins, director intent, and bounded planning
options. It cannot submit prompt text, credentials, an alleged AI result, or a
producer identity. The native bridge exposes only list, get, generate, adopt,
and reject.

The server resolves the actual current script confirmation, immutable script
and production brief, and saved storyboard base in one read transaction.
ORIGINAL and ADAPTED authority reuse the established complete source-lineage
and accepted-manifest checks. No invented source spans are introduced.

Preparation builds a versioned closed prompt from that exact evidence. Native
code verifies evidence hashes, scope, intent, options, and the prompt request
hash. The native confirmation dialog shows the account, requested model,
operation, complete input/instructions, and one-request usage terms. Approval
does not authorize automatic retries or adoption.

The current sequence/projection combination only has an adoptable 24fps or
25fps path. A brief requesting another rate, including a fractional rate,
fails preparation with `OFFICIAL_DIRECTOR_DELIVERY_RATE_UNSUPPORTED` before
approval, reservation, or a provider call. It is never silently rounded or
retimed. Prompt evidence exceeding the existing 100,000 UTF-16 input units or
20,000 instruction units is likewise rejected without truncation.

## Durable single-attempt execution

After native approval, `beforeSend` rechecks the main-frame sender, active
profile, requested model, exact prompt hash, and current authority. A newly
confirmed reservation commits the operation together with an actual
`official.director.plan` workflow, node, single remote attempt, exact input
bindings, and Task Ledger wake-up record before provider HTTP begins.

The attempt starts conservatively at `REMOTE_UNKNOWN`, with the node requiring
reconciliation. Its wake-up is parked as `COMPLETED`; this prevents automatic
worker dispatch and does not claim that the model operation finished. The task
queue derives the visible operation truth from the attempt/node. An uncertain
or replayed reservation never licenses another send. One episode cannot start
a new operation while an earlier remote result is unknown.

The fixed official SSE transport checks completed response identity and passes
the received response ID to the main-only completion endpoint. The stored
model is the requested selected catalog slug; it is not an independently
verified returned model identifier. No live account/model acceptance is
established by fixture tests.

Known no-send outcomes settle as `NOT_SUBMITTED`. Network uncertainty remains
unknown. Known responses pass through the non-runnable review-pending state
inside the completion transaction, then settle to success or non-retryable
failure. No generic UNKNOWN-to-runnable transition is added.

## Strict result admission and preservation

Completion identity must match the reserved operation, profile, requested
model, and request hash. The raw UTF-8 response is retained verbatim within a
4MiB ceiling, including its serialized JSON string literal byte ceiling. The
SSE stream itself retains its existing total 4MiB cap. Invalid encodings or
streams beyond that transport cap remain unconfirmed; the application must
not claim that every possible remote byte sequence was saved.

Admission accepts one exact closed JSON object. Markdown fences, duplicate
keys, non-JSON numeric constants, coercion, extra fields, changed authority,
wrong episode/scene/block references, and incomplete script coverage are
rejected. A typed artifact is limited to the existing 2MB shot-plan ceiling.
Bounded malformed or oversized completed text is kept with validation issues
and an `INVALID` failed attempt, without an adoptable proposal.

An admitted immutable proposal has AI provenance, the trusted profile actor,
the exact producer attempt, immutable dependency pins, and the response receipt.
The detailed shot plan contains 1–1000 unique identities with contiguous order,
coverage, composition, performance, movement, before/after intentions, rational
sequence timing, integer duration/handles, safe cut windows, rhythm, and sound
and dialogue intentions. A target count is a planning goal, never permission
to omit script blocks.

Server-derived capability losses add a BLOCKING exact delivery-rate mismatch
and an exact-rational duration warning when the brief explicitly declares a
per-episode target. Other unfulfilled visual-asset, machine continuity, budget,
animatic, motion, audio, media-generation, and professional gate requirements
remain outside this proposal slice.

## Explicit human decisions and recovery

Adoption requires an explicit true confirmation and exact reviewed proposal
version/hash. The server revalidates current authority, the current proposal
head, storyboard base, coverage, and all blocking issues. It atomically creates
a new editable storyboard plus adoption receipt. Old storyboards, old/new
script pins, and the immutable detailed AI proposal remain intact. The new
storyboard is a draft; it is not automatically accepted or rendered.

Rejection requires a nonblank reason and the same exact reviewed identity.
Adoption and rejection are mutually exclusive immutable receipts, with
idempotent replay and transaction/process-crash tests.

The renderer journals the original operation before IPC. A 5xx/storage error,
missing response, or failed status read is uncertain and retains that journal.
Only an exact read receipt reconciles it; absence never authorizes replay.
Epoch and flight fences prevent old-episode responses from changing a new
episode's state. Dirty or unresolved upstream edits block adoption. A remote
generation unknown does not prevent independent manual storyboard work;
pending or unreadable storyboard adoption remains conservatively locked.

Recent full operation reads are bounded to 20 records and a 12MiB serialized
page budget, with explicit `has_more` metadata. Older immutable records remain
available by exact operation ID. This slice does not implement a full paginated
history browser.

## API and verification boundary

Under `/api/v1/projects/{project}/episodes/{episode}/official-director`:

- GET root / GET `/{operation}`: bounded recent history and exact reads
- POST `/preparation`: verified read-only prompt preparation
- POST root: trusted-main reservation
- POST `/{operation}/completion` / `/not-sent`: trusted-main settlement
- POST `/{operation}/adoption` / `/rejection`: explicit human decisions

Mutation routes are registered only for the authenticated sidecar with its
main-held token, exact localhost host, and `app://aijian` origin. The ordinary
API has no corresponding mutation routes. Preload exposes neither completion
nor reservation, credentials, arbitrary HTTP, or result import.

Verification uses isolated synthetic profiles, actual persistence, route and
decoder fixtures, concurrent operations, strict output failures, and real
process exits around reserve/completion/adoption. These checks do not prove a
completed OAuth grant, a live inference, creative quality, the full production
workflow, Windows acceptance for this new source, or release readiness. Broad
repository lint, typing, legacy tests, and coverage have independent existing
failures; focused slice checks must not be reported as a full repository pass.
