# Version-bound manual DRAFT review notes

This local-only increment records manual comments on a saved, verified DRAFT MP4.
It is separate from formal gate submissions, findings, signoffs and release claims.
Resolving a comment never approves an assembly, rights decision or release.

Schema 38 adds immutable note and resolution rows to the existing workspace SQLite
repository. Each note binds project, episode, export operation, exact assembly
version and canonical hash, output SHA-256 and byte count, original rational frame
rate and a zero-based frame index. Source versions and export records are never
rewritten. One explicit resolution receipt may be appended per note; no deletion,
reopening or automatic carry-forward is provided in this narrow increment.

The authenticated native route derives and verifies the target from the durable
export receipt and exact immutable assembly. Creation requires the output to pass
fresh existing draft-output verification. Reads preserve prior notes after output
loss, clearly mark unavailable output and block new comments. A newer assembly
shows an older-version warning; notes retain their original target. Missing latest
state is unknown, never silently current. Idempotent IDs and verified readback
support unknown-write reconciliation without creating duplicate comments.

The original export-history interface exposes a compact manual-note list/editor.
The entered integer frame is authoritative. Capturing HTML video currentTime is
explicitly approximate and does not claim frame-accurate playback. No approval
button, provider request, external upload, toolchain licensing change or formal
release bypass is part of this feature. Native UI acceptance and Windows release
validation are separate from targeted source tests.

## Source checkpoint — 2026-10-08 07:30 UTC

The original export history now exposes the note editor beside verified output
playback, including historical OUTPUT_CHANGED receipts. The original review-page
entry points to this real workflow. Unsent note/frame and resolution/reason inputs
have separate, bounded per-output local recovery, explicitly labeled unsaved.
Collapse preserves the mounted editor; returning to the output restores inputs.
Explicit discard asks first. Confirmed matching readback clears only the relevant
input. This cache never populates the saved-note list or replaces SQLite storage.

Verification at this source checkpoint:

- 16 backend note tests use real locally encoded output and cover persistence,
  resolution, replay/conflict, scope/hash/frame validation, newer assembly/output
  isolation, missing output, corrupt readback, authenticated routes and schema37
  upgrade/rollback. Notes plus existing draft-route/migration checks: 66 pass.
- 92 new native contract/client/IPC tests and 21 draft regressions: 113 pass.
  These are source-level tests; they are not actual desktop note-entry acceptance.
- Renderer note/recovery and draft-output/export/transport tests: 72 pass.
- Renderer/desktop TypeScript and builds pass. New backend modules pass focused
  strict mypy and Ruff; new renderer/native files pass scoped ESLint/format checks.
- The desktop worker additionally ran its wider suite: 681/682 pass. The unrelated
  actual-sidecar fake-timeline fixture needs binaries matching the existing media
  toolchain lock. This is not relabeled as an all-suite pass.

Actual native manual-note save, application restart/reopen, minimum-window layout,
and Windows acceptance are pending the parent's desktop check. No real provider
call, credential entry, publication, rights clearance or formal review approval
was performed by this increment. Existing output history displays its latest 20
receipts; this increment does not add history pagination, but durable note rows
are not removed when later assemblies/outputs are created.

## Native follow-through

At 08:09 UTC the cloud Linux original interface added a synthetic frame-25 note
on the verified portrait MP4, preserved an unsent note through collapse/reopen,
saved and reloaded it, and appended a separate resolution. After a full native
app/sidecar close and reopen, both records remained with the old-version warning.
Minimum980×680 input/save reachability was checked. This is local native evidence,
not Windows acceptance or formal creative/release approval.
