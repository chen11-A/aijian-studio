# Pending native Windows external-media acceptance

Status: NOT RUN. A bounded, zero-upload hosted Windows runner pass is now authorized
on `codex/windows-installer-dev-20261008`. The automated harness is prepared; only
the future run's observed receipts can establish results. Native file/folder/save
picker returns are simulated, while installed IPC, sidecar, probing, encoding and
playback are real. This does not establish manual picker or clean standard-user
acceptance. The proven `ce1a2a4` DEVELOPMENT_CORE commit remains immutable and
recoverable; the new unverified increment is a separate candidate. All uploads stay
disabled until separately approved and bound to a new exact run.

The optional `test-installed-dev-core.py` media phase runs after the unchanged core
smoke and before reinstall-abort/uninstall checks. Test-only tools and synthetic
media stay outside app resources, workspace and delivery. Durable bounded evidence
is `INSTALLED-EXTERNAL-MEDIA-SMOKE.json`; failure preserves the last completed phase
and safe helper diagnostics. Host-only preparation/harness tests do not count as
Windows acceptance. Manual glyph readability, broader adversarial cases and other
unobserved cases below remain pending unless the real run explicitly proves them.

## Inputs and evidence boundary

1. Build/install a new development-core candidate with the neutral artwork
   exclusions and no bundled FFmpeg/FFprobe. Record source hashes, installer hash,
   emitted production closure, Windows build/version and schema 38.
2. Separately supply the already-trusted exact Gyan 8.1.2 full-build pair identified
   in the architecture note. The authorized test helper may fetch only that exact
   official hash-locked archive, using the existing prerequisite machinery. Keep
   the pair outside application resources, workspace, evidence and delivery.
3. Use only synthetic owned media and an isolated disposable workspace. No provider
   credentials, paid service, real AI, personal media, licence approval or formal
   publication are part of this acceptance.
4. Retain JSON receipts, source/output SHA-256 values and cropped UI screenshots.
   Upload no media tools, tool archive, LocalAppData tree, credentials or personal
   paths. Binary/source distribution review remains separate.

## Native selection, lifecycle and loader proof

- First run without tools: all three capabilities unavailable, raw import still
  permitted, no child process launched and no mock success.
- Folder picker cancellation and repeated clicks: one picker, no saved change;
  settings-card close/same-document navigation cancels only an unconfirmed picker
  selection, including before its asynchronous launch. Its late directory result
  cannot submit. The OS modal may require explicit dismissal; no new picker opens
  before it settles. Cross-document navigation/renderer destruction invalidates
  the original sender. Once configuration PUT has started, cancellation must
  report ALREADY_SUBMITTED and use readback, without claiming rollback.
- Select mismatched/newer tools, an incomplete pair, alias/junction/symlink, mapped
  network volume and app-local DLL/manifest directory: reject before execution.
  Existing valid selection must survive an invalid candidate.
- Select the exact pair in a local directory containing Chinese characters and
  spaces. Verify real matching version/configuration, libx264/AAC/required filters,
  AVAILABLE+EXTERNAL, false formal_release_approved and persisted readback after
  application restart.
- Observe real CreateProcess startup policy, Job Object membership and minimal
  child environment/private cwd. Verify needed system DLL loading and actual
  CPU encode/probe operation under all four mitigation bits. Unsupported policy
  must fail explicitly with no generic Popen or weaker-policy fallback.
- Verify FILE_PERSISTENT_ACLS and actual protected owner/SYSTEM DACL from held
  handles on the session directory before any subtitle/temp write. An ACL-less
  filesystem or unexpected/unreadable DACL must fail closed. Do not change ACLs on
  pre-existing user folders to make the test pass.
- While an admitted process is running, attempt executable write/rename/delete,
  writable preopened handles and ancestor rename/reparse replacement in the test
  harness. Admission or mutation must be blocked as applicable. Inspect child
  modules; no unexpected non-system dependency may be loaded. These observations
  are required; mocked helper tests are insufficient.
- Remove/change one selected executable between operations. Status and new probe,
  preview and export admission must become unavailable. Selection changes must not
  retarget an already admitted running job. Clear configuration and restart:
  external pair is untouched and no selection is silently rediscovered.
- Set either legacy draft environment override in a frozen process: reject even
  with a saved selection. Manipulating PATH must not admit another binary.

## Actual synthetic media workflow

After selection succeeds under the real Windows policy, generate two short CFR
24 fps synthetic H.264 clips with visibly different labels/colours and deterministic
audio, plus a separate synthetic BGM WAV with the intended amplitude change baked
into the source samples. The current encoder mixes at unity; this does not test or
claim editable gain automation. Generation must use only the verified
pair under the same guarded execution boundary. Record their hashes.

1. Import both videos and BGM through native UI. Probe each selected video version
   and inspect the persisted exact-version/hash evidence after restarting.
2. Build and save a 1280×720, 24 fps, 96-frame composition: order clip B before clip A,
   select a nonzero source trim from each, use exactly 48 frames from each, add the
   amplitude-varied BGM at unity gain, and add a bounded literal Chinese cue such as
   `第二段草稿 100% [测试]` on a known frame interval.
3. Explicitly declare OWNED_OR_SYNTHETIC and create DRAFT MP4 to a new native
   output path containing Chinese/space characters. Await a real terminal receipt.
   Verify 96 output frames, 4-second duration, H.264 yuv420p, stereo 48 kHz AAC,
   DRAFT title/comment, saved assembly/version/hash and matching output hash.
4. Decode representative frames and play the actual result. Confirm order/trim,
   BGM timing/volume and literal Chinese subtitle glyphs, percent and bracket
   characters. Check no source dialogue/audio appears unless explicitly selected.
5. Generate continuous preview of that exact saved version; await the actual
   verified MP4 and play it. Unpersisted edits must not silently enter this preview.
6. Restart and reopen the project, probe evidence, preview and DRAFT receipt.
   Historical verified output viewing remains possible after clearing tools.
7. Exercise real mid-render cancellation and application shutdown; confirm no
   descendant encoder remains and no unverified final MP4 is published. Retry
   only with a new intended operation after the previous result is known.
8. Existing-output target, changed source bytes, restricted rights, altered tool
   bytes, unsupported layout/dialogue and subtitle font mismatch must fail
   explicitly without overwrite, rights escalation or a success receipt.
9. Attempt formal ProductExport: unchanged RELEASE_TOOLCHAIN_NOT_APPROVED refusal.
   Confirm backup/restore does not transfer machine tool selection; uninstall
   preserves the workspace and separately installed external tools.

Completion needs all observed results tied to the exact new candidate. A passing
synthetic workflow establishes this DRAFT capability only, not a complete bundled
release, AI acceptance, redistribution approval or professional-editor parity.
