# Character relationships and costume versions

Product basis: P08 requires saved relationships and shared character identity;
P09 requires saved costume versions. These are mandatory capabilities, not
optional alternatives to the text library. This batch adds their manual editing
and immutable persistence; real reference assets, identity approval, episode
costume selection and downstream invalidation remain subsequent work.

The existing project-shared `project_creative_library` artifact remains the only
truth. Content 1.0.0 is preserved exactly, including its hashes and historical
readback. Content 1.1.0 adds ordered stable relationship and costume IDs. A
relationship explicitly names its source and target characters and a user-written
label; no reciprocal relationship is inferred. A costume names one character,
its user-written name and description. Both resolve membership inside the same
immutable library version. Self-relations, orphan references, duplicate IDs,
unknown fields, invalid Unicode and invalid ordering are rejected at boundaries.

Editing details explicitly creates 1.1.0 content; reading old content does not
rewrite it. Existing CAS, scoped idempotent receipts, exact readback, pending
write journal and UNKNOWN recovery apply unchanged. Removing a character lists
the draft relationship/costume removal count for confirmation and removes only
those current draft references. Historical versions and pinned storyboard
versions remain intact. Shared changes never mutate an existing episode pin.

The native role editor edits these objects using the existing Save action and
navigation protection. No provider, upload, fee, approval, identity lock or
generation is implied by saving a costume description. Normal and professional
modes use the same editor and data permissions. No new database, migration,
dependency or external capability is needed.

Engineering review: versioned closed contracts are required to preserve legacy
bytes; a loose optional-field change would make the schema ambiguous. Whole
library versions are the existing version boundary, so an individual costume is
identified by `(library version, costume ID)` until episode usage pins are added.
Do not advertise this batch as a completed visual identity lock.
