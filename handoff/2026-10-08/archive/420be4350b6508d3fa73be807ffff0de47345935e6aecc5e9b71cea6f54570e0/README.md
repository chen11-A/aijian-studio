# QA02 media original preview r01

Status: `STATIC_PACKAGE_READY_RUNTIME_NOT_RUN`.

This external QA package prepares five synthetic inputs and an isolated native
Electron acceptance plan. No product import, player, provider, or c19 source
write has occurred. `RUNTIME-QA-PLAN.md` defines ordered gates and stopping
conditions. `SOURCE-LOCK.json` and `INPUT-MANIFEST.json` pin the currently
inspected files and test media. `EVIDENCE-TEMPLATE.json` is intentionally all
`NOT_RUN` until an actual product run records the corresponding evidence.

`prepare-fixtures.py` already ran once to create the local MP3, a valid WAV
over the preview cap, and a deliberately undecodable MP3. Its receipt and raw
FFmpeg stdout/stderr are preserved. The WebM and normal WAV are reused from
QA02's existing synthetic four-media manifest. These files may be used only
as test originals; they are not user assets or production media.

Current c19 `SceneAndAssets.tsx` hashes to DEV04's frozen candidate. MGR04's
final sync/build receipt and actual Electron preview remain pending. On receipt
of those inputs, prepare a **new** exact runtime invocation/evidence envelope;
do not edit this indexed static package or claim its current c19 hash proves
the build. Keep all runtime outputs in a separate QA-owned evidence directory.

The preview is project scoped. The current desktop API client reads all
response bytes and computes SHA-256 before returning `READY`; this is a static
source observation. Runtime QA still needs the actual import, content GET,
decoded playback, close/reopen, and negative observations described in the
plan. Stage-A's two-video long-path probe is separate evidence.
