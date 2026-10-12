# Project-shared manual creative library

This library persists manually edited AIVORA P08/P10/P11 drafts, relationships,
costumes and exact character/environment references. Separate G5 and storyboard
consumers resolve immutable library versions. Saving a library does not approve
creative decisions or execute media; complete episode overrides, environment
consumers and Windows acceptance remain outstanding.

One `project_creative_library` artifact uses the existing immutable artifact store
and explicitly has `episode_id = NULL`. Its typed content contains ordered stable
UUID-based character and location identities plus world fields. Empty libraries
and empty descriptions are valid; names, unique IDs, and contiguous order are
validated. Removing a record only changes the next draft: historical versions
remain readable. There are no fabricated image URLs or approvals.

GET `/api/v1/projects/{project_id}/creative-library` reads the latest draft; GET
`.../versions/{version_id}` reads an exact immutable version. POST `.../versions`
is enabled only in the authenticated desktop sidecar. It requires a bounded
Idempotency-Key and a paired parent version / expected head revision (both null
for the initial save). Content scope must match the URL and be project-shared.

Migration 34 adds only an immutable request-receipt table in the same SQLite DB.
The repository migration runner provides backup/transaction/rollback. Saving
uses BEGIN IMMEDIATE and the existing create_artifact_version transaction, with
CAS validation and content hash/readback checks before committing the version
and receipt together. A retry with the same key and payload returns the original
version even after newer writes; a different payload conflicts. No second truth
store, external call, approval record, or new dependency is introduced.

The desktop bridge validates both directions and distinguishes definite errors
from uncertain transport/storage outcomes. The renderer must retain a pending
write's key and payload for an explicit idempotent retry, verify the returned
version by exact readback, and preserve edits on failure. Replayed historical
versions carry the current head revision; editors must reload the latest head
before creating a subsequent edit from that historical version.

The local candidate preserves content schemas 1.0, 1.1 (relationships/costumes)
and 1.2 (exact character/costume asset references). Schema 1.3 adds bounded scene
state identities with view/time/weather/state/continuity and exact environment
references. A null scene belongs to the shared world; a scene reference can select
its own state or the base location. Closed ownership, IDs, contiguous order and
Unicode are checked in API and shared native/renderer guards. New saves verify
both character and environment originals against owned asset versions, raw hashes
and visual kinds. Historical read/replay keeps immutable evidence after original
loss. Schema downgrade is refused; no new storage or migration is introduced.

World and scene editors expose real state/reference edits and exact original
previews through the existing native asset gateway. Explicit removal changes only
the next version and cascades its owned bindings. State cursors are optional
session metadata, separate from authoritative library content. Character editing,
G5 selection and existing storyboard character consumers accept 1.3 without
dropping state/reference data. Environment storage does not approve G5, authorize
uploads or execute media. Per-shot environment selection, approved state scope
and downstream invalidation are subsequent work; native Windows acceptance is
still outstanding.
