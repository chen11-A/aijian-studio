# Manual Episode Storyboard v1

This slice is a native desktop editor for an episode-scoped manual draft. It does not replace or weaken the accepted-source rules for `shot_outline`, approve upstream drafts, invoke an AI provider, or claim generated motion.

- Store truth: immutable `episode_storyboard` artifact versions in the existing repository; migration 35 adds scoped idempotency receipts only.
- Identity: explicit project and episode, stable UUID-backed shot IDs, contiguous order separate from identity.
- Timing: positive integer frame durations and integer fps (1–120). Changing fps keeps frame counts and therefore changes duration. This intentionally bounded manual-preview timebase is not a final export format.
- References: optional exact episode-script and project-shared creative-library version pins. Every referenced scene, character and location must exist inside its pinned version and belong to its declared scope. Reads verify the same invariants; dependencies retain the version relationship.
- Writes: authenticated desktop IPC, strict DTO validation, head CAS, idempotency keys and exact immutable-version readback. A pending-write journal contains only the original operation for uncertainty recovery; it is not a second editable content database.
- User interface: empty/create, add/edit/reorder/delete, save/reopen, pinned references, unsaved-navigation warning and a scroll-safe save footer. Text cards play against saved/editor frame timing and are labeled “分镜文字预演”; they are not generated motion or final-media preview.

Endpoints: GET `/api/v1/projects/{project_id}/episodes/{episode_id}/storyboard`, GET `/versions/{version_id}`, POST `/versions` under the same base.

Scope exclusions: source approval, storyboard approval, generated images/video, asset image binding, audio playback, export and release qualification. Those remain separate product work.

## Version 1.3 manual planning

An explicit edit to coverage, continuity or transition notes promotes the editor's
content to 1.3.0. Each shot then has three required bounded Unicode text fields:
`coverage_notes`, `continuity_notes`, `transition_notes`. Empty intent is represented
as empty text, without a made-up success result or automatic finding. These fields
remain manual production instructions rather than approval or verification records.

Opening/reopening old content retains its exact schema and canonical hash. New
planning writes use the same artifact/version/CAS/idempotency receipts and pending
operation journal. Every shot ID, ordering, duration, text, costume/reference choice
and exact visual Bible/library pin survives the explicit upgrade. Adding or changing
a G5 pin and explicitly unlinking it retain 1.3; adding a shot initializes its notes
without downgrading or clearing notes on existing shots. Both editors share the same
fields and authoritative controller, including unsaved/UNKNOWN navigation protection.

Native and renderer guards reject absent/extra/malformed notes; the backend refuses
schema downgrade. Whole-board director projection rejects 1.3 before it could lose
manual planning intent. Existing 1.2 visual-basis behavior and DTO stay intact. G5
authority, approved owned identity references, fresh original evidence, blocking
assembly dependencies, approval replacement impacts and DRAFT encoding preflight
apply identically to 1.2 and 1.3. Historical reads keep their original references.

The saved-media inspector's hash size bound now matches the pre-existing 2,000,000
byte storyboard limit; it no longer imposes an unrelated 1 MiB ceiling. This changes
neither artifact limits nor DRAFT encoding/playback limits. Real-time preview,
automatic script coverage/continuity checking, formal storyboard approval and full
Animatic/creative acceptance remain separate work.
