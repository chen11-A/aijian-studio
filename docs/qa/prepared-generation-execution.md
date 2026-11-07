# Automatic prerequisite generation execution

This contract checkpoint is not an implemented native/API consumer. No new bridge is
advertised by preload at this checkpoint. API 53 covers the Grok images, TTS and video
inside StoryFilm; it does not cover the current direct `film:still` prerequisite calls.

## Execution and failure identity

`prepareFilmGenerationExecution` receives the local canonical project ID, its complete
saved raw hash, the existing explicitly confirmed mode, and ordered shot/version scope.
Native resolves actual project/account/creative/reference-byte facts. The returned
execution, image-stage and video-slot IDs are transient, owner/document-bound locators.
They are not saved to FilmProject, history or portable archives and are not authorization
to spend or proof of a successful artifact.

Mode, target grouping, version count, slot IDs and newly queued take IDs constrain this
execution only. They must not enter a target's failure identity. Ordinary generation,
pipeline generation, one versus three versions, and retrying a failed batch subset must
retain the same bucket for the same effective original creative inputs. Existing video
51/52 protection and explicit StoryFilm-creation policy remain separate.

The fifth optional `generateFilmStill` argument identifies an issued image stage, not a
renderer-provided dependency set. Native derives which exact targets depend on it from
the canonical project. Shared prerequisites atomically reserve the affected targets'
first unreserved slots before the first actual POST. Later versions do not pre-reserve
the full version count: a proven successful video settles its target slot before the
next one reserves. Existing UNKNOWN/PENDING prevents a new POST; cache, GET and local
last-frame extraction neither count as POST nor clear existing unresolved holds.

The fourth optional `createStoryFilm` argument identifies an issued video slot plus its
actual canonical shot/take. Its existing third dialogue-evidence argument and HTTP body
remain separate. Binding a future pipeline take occurs once, only after its canonical
queued/running slot exists. Preparing or recording a context never confirms a generation
quantity or replaces the existing membership, fee, cancellation and current-input gates.

`retireFilmGenerationExecution({executionId, videoSlotId?})` invalidates future native
dispatch for the issued slot, or the whole execution when no slot is supplied. Ordinary
TaskCenter cancellation of one take retires only its issued video slot, preserving the
other explicitly confirmed slots; shared image stages serve only still-active native
dependencies. Whole-execution retirement is for leaving the project, owner destruction
or terminating the pipeline/batch. A `RETIRED` acknowledgement is not confirmation
that an HTTP request stopped. Native rechecks retirement after every reserve/materialize
await and immediately before transport; navigation/destroy uses the same invalidation.
Only a proven unsent, exclusively owned hold with no earlier sent child can be released.
Existing sent or uncertain children remain occupied. Pipeline prerequisite cancellation
cannot depend on a future queued take that does not yet exist.
An image known to have completed and been read, followed by cancellation before any
further POST, consumes a known incomplete/failed attempt rather than becoming a
permanent remote unknown. An in-flight or unconfirmed child remains UNKNOWN. Both count
against the original explicitly configured failure limit; retirement does not reset it.

## Durable lineage required before production handoff

The implementation must persist a private association between each original target
intent/attempt, its issued child stage, actual submitted body/reference-byte digests and
observed output bytes. A saved automatic image may be projected back to that original
intent only after this association and current bytes verify. This is not a general
exclusion of posters or references: a user-selected replacement changes actual input.
An in-memory lease alone cannot establish this after a new key or restart.

The stable account must come from the same main-owned `mediaDispatchAccount` pair used
for the real bearer. Refreshing the token does not open a new stable-account bucket.
No account, digest, output path, successful result or parent dependency set is supplied
by the renderer. The next additive migration is expected to be 54; this checkpoint does
not modify schema or claim restart/POST behavior has passed.

Independent manual portraits, four-candidate stills and standalone image requests do
not silently inherit a video execution. Automatic pipeline portrait stages without a
provable target dependency must fail explicitly rather than borrow another target.

## Planned meaningful acceptance evidence

- First real prerequisite POST is protected; unconfigured/zero limits cause zero new
  image/TTS/video POSTs, without changing original quantity or membership confirmation.
- Ordinary/pipeline and grouped/subset retries share per-target failure identity;
  different real user-reference bytes differ; generated saved images do not reset it.
- Same-account refresh, new task key, concurrency and process restart retain UNKNOWN;
  a missing or unverifiable child association never silently authorizes another POST.
- Actual outgoing image body/reference bytes and video adaptive duration/first-frame
  bytes match the current producer, with late edits/cancellation blocking dispatch.
- Shared image dependencies are native-derived; actual request counts remain exact.
- Complete original output files and prior schema rows are retained. No real external
  provider, membership or paid call is needed for these local controlled tests.
