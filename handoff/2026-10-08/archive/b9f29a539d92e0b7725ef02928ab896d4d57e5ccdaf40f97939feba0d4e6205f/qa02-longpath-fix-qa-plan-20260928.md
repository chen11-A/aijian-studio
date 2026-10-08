# QA02 long-path repair candidate: independent verification plan

Status: `RUN03_ENVELOPE_APPROVED_WAITING_EXTERNAL_ONE_SHOT`.
No new profile, import, probe, audio inspection, or rejection case has run.
The original run01 RED and short-path run02 raw profiles/invocations remain
untouched.
The run03 review package is at
`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-stage-a-longpath-r03-20260928`.
Its approval template remains unsigned and deliberately rejects execution;
MGR02 approved only the envelope status after static review.

## Fixed comparison paths

- Fresh long-path QA package proposed at
  `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-stage-a-longpath-r03-20260928`;
  `profile-03` below it is absent. Its complete first managed blob target is
  266 characters, matching run01's 266-character target; UUID32 staging path
  is 240. This measures constructed absolute path strings, not existing blobs.
- Fresh short control package proposed at
  `C:\Users\Administrator\Documents\Codex\qa02-stage-a-r04`;
  `profile-04` is absent. Complete managed blob target is 163 characters and
  UUID32 staging path is 137.
- Each run needs a new invocation directory and separate exact-source,
  one-call MGR02 approval. Run03 precedes run04. A run03 RED stops that run;
  there is no automatic retry or fallback into run04.

## Source and authority gates before any run

1. Receive DEV01 static review and MGR04's protected, readable source closure
   with per-file SHA/import edges. Do not import live author-tree modules or
   combine source revisions. The author tree currently shows candidate
   `managed_local_paths.py` SHA-256
   `78FCCE4F28FF720F6610AB72EEC2C5C5AB179E7BEB758B980610303B7CA9D7AC`,
   `media_asset_store.py` `2954042D87754211526891A5CC3506DD55DCA78CBB349FC44D19D54FDDC105B8`,
   `media_asset_selected_reader.py`
   `88A2CB4A2C891D717FBACC3D3BB14B195F8B0419431E0AB6A5B05FEBFD34A303`,
   `media_asset_probe_store.py`
   `38CD2EEC6E1BE39620773EFD9D3917A1E93951A86C9CC473E7BB304B9A50CCFA`,
   `media_asset_audio_inspection.py`
   `41B4FB7061DF7928A161F19D14B68B925E3495F678BEADA7E2E979134523DB64`,
   and `episode_media_assembly_store.py`
   `72F72CFA08349396D3853C92CCE63A3A66C77CF531544124563B15E44838AF89`.
   DEV01's static review found no definite blocker. MGR04's unified closure-3
   has 47 files; QA02 independently matched 47/47 to `FILES.json` SHA
   `13AF7D305E10126184CB39E9662084C9D3DED6C3670BF6E45C5E03D99F80D4A0`.
   It includes repo30 and the selected/rights/audio/assembly dependencies.
2. Recheck the original schema-26 QA01 seed SHA-256
   `54533ABEEAC1E45DB3D643303967EFDCF9379024405853DF1B240838B80F90CC`
   and quiescent zero-byte WAL. Recheck the five-input manifest SHA-256
   `EE2166D379C1000D65138C12023209A9D535AEE17D707C04BB907B7823FB04E3`
   and every actual file hash. Copy the seed into each new profile; never
   migrate or write the original QA01 database.
3. Video probe is outside the first long-path gate. A later approved probe
   run would need to pin the media toolchain
   lock and independently hash FFmpeg/ffprobe. Prior frozen TEST evidence used
   FFmpeg 8.1.2 SHA `AD8F211BC894755E0061C55AB280AE00E8D3D4F15A8CC4372B24CFA247B5942E`
   and ffprobe SHA
   `9DF3B0B5275E830961DF6D94E1F7A71121A7ABD5FF708E9FEC8A0B6084A55015`;
   refresh these against the final lock before invocation. The first gate
   must not call FFmpeg/ffprobe, MLT, or a provider and must label video probe
   untested.
4. Freeze the new QA02 script, process wrapper, envelopes, path-length
   records, interpreter SHA, timeout, and empty profile/invocation paths.
   MGR02 must approve each exact final hash. Preserve raw stdout/stderr,
   PID, exit, timeout, source/DB hashes, and any UNKNOWN before another call.

## Long-path run03 checks

- Four distinct `MediaAssetStore.import_local` calls for the two WebM and two
  WAV inputs; SRT stays manifest-only. Capture actual `asset_*`/`asv_*`, kinds,
  byte counts, SHA values, `PENDING_REVIEW`, managed blob path length, and
  verified persisted readback. Check SQLite schema/row counts and checkpoint
  before immutable selected/rights readers. All four selected reads should be
  `VERIFIED`; rights should be `NO_DECISION` because no human decision is
  authorized by this plan.
- Independently derive the two WAV inspections from managed bytes with
  expected samples 48000 and 240000, retaining inspection hashes. This does
  not create a rights clearance or positive selected binding. Video probe is
  deferred.
- The source QA01 seed has only one `episode_script` artifact and no assembly
  artifact. The public assembly `read_version` has no existing version to
  read. If approved, invoke only the private `_availability` helper on already
  imported long managed blobs as a separate helper-level read; do not
  fabricate or write an assembly artifact.
- Verify retained results through the product's public store and selected
  reader using logical AssetVersion IDs; the implementation may use a private
  extended Windows spelling for filesystem I/O. A raw unprefixed
  `Path.stat()` failure at 266 characters is an OS observation, while a
  product store/selected readback failure is the relevant Stage-A RED.

## Negative cases and short control

- In isolated QA-owned clones, verify the path helper rejects relative paths,
  UNC/network roots, `..` traversal, and a symlink/reparse ancestor before
  filesystem access outside the managed root. Record exact exception/status
  and verify no outside file was changed. If a symlink/reparse case cannot be
  created under this host's privileges, mark it untested; do not infer PASS.
- Use a separately approved fresh short profile for the same four imports,
  selected readback, and audio checks. Compare identity
  and status classes, not random `asset_*` IDs. Short-path success is a control
  and does not close a long-path failure.

This plan does not authorize human `CLEARED` rights decisions, provider calls,
MLT runtime, product installation, UI acceptance, or formal export. The
pre-read mtime-only behavior observed in run02 is a recorded reader boundary,
not a defined rejection contract or a new RED in this plan.
The helper's ancestor `lstat` and later I/O are separate operations; these
checks do not establish closure of a junction swap race between them.
