# Saved composition preview in the native editor

The editor now offers compact, on-demand continuous playback of a saved media
assembly. It renders through the existing real DRAFT MP4 worker and verified
output reader. The original selected-source player remains independent and does
not pretend to apply timeline edits. This is not realtime unsaved timeline
playback, an MLT execution path, or a formal export/review approval.

## Immutable input and output

- The editor passes its already validated saved version ID and canonical content
  hash. A visible warning excludes unsaved edits. Saving a newer version resets
  the rights checkbox and closes old playback; an older output cannot appear as
  that newer version's preview.
- New renders require the explicit OWNED_OR_SYNTHETIC declaration. Existing
  `draftExportProblem` and backend guards still apply, including restricted
  media, source availability, supported tracks, dimensions, duration and formats.
  Newly supported literal subtitle cues use the same DRAFT encoder without any
  preview-specific subtitle renderer.
- Imported dialogue audio follows that same saved DRAFT path. Its exact audio
  version, script version, dialogue block, speaker identity, delivery, source
  sample offset and sequence frame interval remain in the saved assembly.
  Reading the saved assembly revalidates its script bindings; refreshing a
  newer script does not rebind older dialogue. The mixed preview is an editing
  aid, not voice generation, word alignment or a lip-sync approval.
- A successful same-version DRAFT output may be reused, including an ordinary
  user-saved DRAFT. It is reverified at playback. Merely opening the panel or
  revisiting a saved version never starts another encode.
- The renderer never supplies an output path. Trusted Electron main derives a
  full-operation-ID filename under its own userData/composition-previews folder:
  `Aivora-PREVIEW-DRAFT-dmp_<32 hex>.mp4`. The helper rejects noncanonical paths,
  links, redirected ancestors and non-directory cache roots. The original
  backend additionally checks local-volume/path safety, reserves the filename,
  verifies exact sources, decodes/hashes output and publishes without overwrite.
- These files remain genuine immutable DRAFT receipts, visibly labelled as
  editor preview caches in the DRAFT history. No fake completed job, release
  claim, rights approval, schema migration or new tool binary was introduced.

## Recovery, cancellation and lifecycle

Preview creation is a second branch of the existing native draft IPC handler,
sharing its admission guard and in-flight operation set. A concurrent Save
picker or preview request cannot proceed. A GET or cancel arriving while native
cache preparation/submission is still running remains unknown instead of
returning a premature not-found result. The top-level sender is rechecked before
submission after asynchronous destination preparation.

`useDraftExports` has an explicit composition-preview mode. Default Save-dialog
behavior remains unchanged. The preview uses a separate pending-command journal,
written before submitting. Lost replies reconcile the original operation and
saved identity through existing list/GET readback. Mismatches or unavailable
journals block fresh submits. A cache-preparation failure is definite and
pre-claim; dropped backend responses are not. Cancel uses the actual operation
ID, preserves success if cancellation arrives too late, and reads back progress.
Interrupted jobs remain interrupted across restart and do not automatically run
again.

The section is collapsed by default. Its compact status and recovery keep
running while collapsed. Expanding exposes the saved version, declaration,
generation/cancel controls and the existing verified output player. Collapsing,
changing the saved version or leaving the editor unmounts playback and revokes
its Blob URL; a late read cannot reopen it. Collapsing never silently cancels an
encoder process.

The native cache persists across page changes and process restarts. Only an
explicit render/regenerate click creates another file. This increment does not
automatically evict or delete any retained output or authoritative receipt.
The UI discloses retention; verified folder reveal lets the user locate a
completed file. If a user removes or changes it, the existing backend getter
marks its receipt failed (`OUTPUT_CHANGED`); regenerating creates a new operation
and filename. There is no cache quota/eviction UI yet. The cache therefore grows
with explicit regeneration and should not be treated as self-cleaning.

Missing or changed original assets block new rendering through the same source
snapshot/hash checks as DRAFT export. A previously verified output can still be
inspected independently of its originals, with its old immutable identity; it
is not evidence that missing originals became available.

## Playback and format limits

The existing reader independently validates the fresh SUCCEEDED receipt, local
path, every ancestor, plain-file identity, MP4 header, byte count and SHA-256.
The editor receives a bounded MP4 Blob, uses standard continuous video/audio
controls, and never autoplays. The 32 MiB embedded playback limit remains explicit;
larger files retain verified native folder reveal for a local external player.
There is no streaming protocol or renderer-controlled filesystem URL.

All DRAFT encoding limits remain shared: at most 32 visual and 32 audio clips,
30 minutes, even canvas dimensions up to 1920, supported CFR at the saved rate,
H.264 yuv420p plus optional 48 kHz stereo AAC. Unsupported edits are rejected,
never silently dropped. Normal video controls do not claim frame-exact review.

## Focused evidence

Run:

    pnpm --filter @aijian/desktop exec vitest run src/composition-preview-cache.test.ts src/draft-export.test.ts src/draft-export-output.test.ts
    pnpm --filter @aijian/studio-web exec vitest run src/aivora/SavedCompositionPreview.test.tsx src/aivora/DraftExportPanel.test.tsx src/aivora/DraftExportOutput.test.tsx src/api/draftExports.test.ts
    .venv/bin/pytest -q services/api/tests/test_saved_composition_preview.py --no-cov

On 2026-10-08: desktop 27 tests and renderer 64 tests passed, including existing
Save-dialog export/output regressions. The real synthetic test passed by saving
a two-clip assembly with a source-sample-trimmed BGM, saving a different newer
head, and rendering the original explicit snapshot into the retained preview
path. Decoded evidence checks 48 frames with red followed by blue, continuous
440 Hz BGM across the cut and exclusion of the source's unwanted 220 Hz lead-in.
The receipt survives runtime reopen and detects changed cache bytes. Both
desktop and studio-web TypeScript checks passed.

This is Linux development evidence using the already pinned local pair. It does
not claim native Windows execution, installer acceptance, formal release
approval or GUI playback acceptance; those remain separate checks.
