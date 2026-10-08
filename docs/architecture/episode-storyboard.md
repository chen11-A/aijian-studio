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
