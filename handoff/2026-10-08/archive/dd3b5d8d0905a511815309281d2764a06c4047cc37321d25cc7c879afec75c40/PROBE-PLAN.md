# QA02 Stage-A long-path video probe r05

Status: `STATIC_ONE_SHOT_CANDIDATE_NOT_APPROVED_NOT_RUN`.

## Exact inputs and ownership

- Read-only source: run04 `profile-04/workspace/workspace.sqlite3` SHA-256
  `65EF2306FD83CFDAA454754A3B6A6E1919431F1C570826ABC37E93A6795A11FC`
  and its four verified managed blobs. Its inner receipt SHA-256 is
  `38DA1A750D7E868681EC27955231799B1FBB5B847C6BA308F444F065BD9D8AC1`.
  The two selected video AssetVersions are pinned in `probe-envelope.json`.
  The two WAV blobs are copied only to keep the cloned workspace coherent;
  they are not probed.
- Frozen product source: MGR04 Stage-A closure-3, 47 `.py` files, `FILES.json`
  SHA-256 `13AF7D305E10126184CB39E9662084C9D3DED6C3670BF6E45C5E03D99F80D4A0`.
  `MediaAssetProbeEvidenceStore.probe_selected_video` needs no rights
  `CLEARED` decision. It runs on a new isolated DB copy and persists at most
  one immutable probe row per named video.
- Existing development tool pair: WinGet Gyan FFmpeg 8.1.2, ffmpeg SHA-256
  `AD8F211BC894755E0061C55AB280AE00E8D3D4F15A8CC4372B24CFA247B5942E`,
  ffprobe SHA-256
  `9DF3B0B5275E830961DF6D94E1F7A71121A7ABD5FF708E9FEC8A0B6084A55015`.
  The existing c19 `media-toolchain-lock.json` SHA-256
  `A4554A71D7942C0706585B609E77059F71634E84EB9A2EDD4072965A9FCFB072`
  lists `windows-x86_64-gyan-full-8.1.2-dev` as GPL and
  `DEVELOPMENT_ONLY`. This is not release approval or permission to bundle.
  Earlier QA02 ffprobe version and both short-source video probes exited 0;
  the long-path product probe itself is untested.

## Proposed single call

1. The wrapper requires MGR02's external exact-hash one-shot, a stopped
   source process, unchanged source/closure/tool hashes, and absent
   `profile-05`/`invocation-05`. It runs one hidden child with a 180-second
   bound, records PID, stdout/stderr, exit and timeout, and stops only its
   own process tree on timeout.
2. The child copies 47 source files, the run04 DB, all four managed blobs,
   and the exact lock into the new profile. The package and profile names
   preserve the run04 managed blob target length of 266 characters. It
   rehashes all copied bytes. `LOCALAPPDATA`, `TEMP` and `TMP` point inside
   the new profile, so product media snapshots are QA-owned.
3. Product `discover_media_toolchain` verifies the existing pair. A QA
   version reader saves raw `-version` stdout/stderr for each binary and
   feeds the unmodified output to product validation. Then
   `MediaAssetProbeEvidenceStore.probe_selected_video` runs once for
   `v1-blue.webm` and once for `v2-red.webm`, sequentially. Each result is
   read back through the store and checked against source SHA/bytes, 25/1
   fps, 75 frames, CFR and no audio.
4. The child checkpoints the isolated DB and records schema/row counts,
   source hashes, tool identity and resulting DB SHA. Expected rows are
   4 assets, 4 versions, 0 rights decisions and 2 probe evidence rows.
   `stdout.bin`, `stderr.bin`, both receipts and version-command raw files
   are preserved. Product ffprobe command output inside `probe_local_media`
   is not separately exposed by that API; persisted probe evidence and the
   child failure traceback remain the product observations.

Any first RED or UNKNOWN stops the call. If the first video succeeds and the
second fails, the partial isolated DB remains as-is. No retry, no second
toolchain discovery, no source DB mutation, no human rights decision, no
MLT, no provider, no installation, and no foreground UI. Success is only a
bounded local two-video probe result pending independent review.
