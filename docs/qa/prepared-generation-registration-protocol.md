# Native registration and source-role protocol checkpoint

This handoff is **not** the final API-54 execution. The API, full planned-reference
identity compiler, v2-cache slot assignment and local continuity proof remain work
in progress. Missing capabilities must stay closed before paid prerequisites. This
checkpoint does not close P0 or claim fresh ordinary/pipeline support.

`buildGenerationRegistration(producer, plan, intentRecord, sources)` is the single
native-owned mapping to `GenerationRegistrationInput`; `client.register` now requires
that type. It includes original effective body, declared actual source SHAs, client
frame fields, confirmed slot count, original `first_regenerate`, and native stage
origins/dependencies. It accepts no renderer account, root, digest or dependency set.
The first-slot regenerate flag delegates to the actual original queue selector:
only an existing **done** take counts; failed/cancelled takes do not. Explicit
body regenerate is preserved. Local IDs/counts/this flag are execution facts, not a
new failure bucket.

The current mapping deliberately rejects a consumed missing automatic reference
whose original creator intent is not yet fully compiled. It also rejects local
continuity and side/back portraits without the required original front reference.
Temporary marker URLs are used only in pure consumer selection to detect this
missing capability: no marker is returned, saved, read or treated as an image.
Complete fixed-reference scopes use actual bounded source snapshots. The planned
creator-intent and owned-output dependency compiler must replace these restrictions
before the final fresh flow can be enabled.

The original location-image write fields and queue had-takes rule were narrowly
extracted as `locationImageFields` and `generationHadTakes`. Original consumers
now delegate to those same functions. The closed native producer exports them;
there is no copied location/retry algorithm or runtime source fallback.

`sourcePool.requestSourceRoles(actualBody)` returns the exact one-shot role table:
`{role: still|reference|references, index, source, canonicalPath, sha256, mime}`.
There is one row for every consumed role, including repeated references, in wire
order. Only immutable literal data has null canonicalPath. API video-wire MIME uses
the existing adapter's byte-MIME convention; image-stage snapshots retain their
original image-wire metadata. The source pool still enforces current/shared roots,
owner, actual bytes, 12 MB per image and the existing total bound.

The private arm call now receives `wireBody` and that role table instead of trusting
only a path-containing body hash:

`armVideo(project, execution, target, slot, take, wireBody, sourceRoles, account, current)`

The client derives SHA from the exact body and sends closed snake-case private
source fields. The API producer (separate, not frozen in this checkpoint) pins the
small actual runtime recipe/source-role facts, rechecks them before generation, and
materializes immutable bytes only in its internal dataclass. Legacy HTTP/renderer
500-character source limits and v2 raw-body/arm HMAC stay unchanged. Arm is not
transport admission or provider success.

Each registered image stage now has ordered original reference SHA/MIME facts.
Lineage projection checks those facts as well as prompt/model/aspect and output
bytes; missing older reference facts do not authorize projection. A same-prompt
frame with a changed actual fixed reference cannot be rolled back to another
original intent.

Validation on this checkpoint: native five files **52 tests**, original seven web
files **101 tests**, formal desktop/web types, default desktop build, and the
actual closed CJS producer/native mapping integration **one Node test** all passed.
The Node integration includes post-queue review behavior, mixed old take states,
fixed-reference registration, explicit unsupported future-reference scope, and
changed-reference lineage refusal. Target lint/format and diff checks accompany
freeze. An initial closed-export ordering failure and the old untyped client-fixture
type errors are retained in logs; they were corrected without weakening guards.
No full suite, package candidate or Windows run is claimed for these new bytes.
