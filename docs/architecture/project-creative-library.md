# Project-shared manual creative library

This bounded slice implements manual draft text persistence for AIVORA P08/P10/P11.
It does not approve creative decisions, lock identities, generate imagery, or claim
coverage of relationships, costumes, episode overrides, or downstream usage yet.

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
