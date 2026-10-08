# Saved-assembly local DRAFT MP4

Implemented as a separate native desktop workflow. It does not create a formal
ProductExport claim, change a rights decision, approve a release toolchain, or
replace the existing DevelopmentExportPanel fixture workflow.

## Contract and provenance

- A request names a saved EpisodeMediaAssembly version and its canonical hash.
  The server reads that exact version in the project/episode scope. Unsaved UI
  edits cannot silently enter an export.
- The native UI requires an explicit OWNED_OR_SYNTHETIC declaration. Known
  RESTRICTED versions always block. Pending review is preserved in provenance;
  the declaration never marks an asset CLEARED or a release approved.
- Schema 36 stores immutable operation/scope/version/hash/path/request and source
  rights snapshots, toolchain profile and both actual binary hashes. Mutable
  receipt fields contain real progress, cancellation, terminal error, output hash,
  size and the completed media-verification evidence.
- Jobs are idempotent by operation ID and complete request hash. A mismatched
  replay fails. A lost response is reconciled by GET, including while a timed-out
  submit is still checking sources. An active job found at process startup becomes
  INTERRUPTED and is never automatically encoded again.

## Supported edit decisions

Maximum 32 image/video segments and 32 BGM/SFX segments; 30 minutes; saved even
canvas dimensions up to 1920 × 1920. Output is MP4, H.264 yuv420p and, if needed,
48 kHz stereo AAC. Frame rate comes from the saved assembly. Visuals are fitted
with letterboxing, ordered and frame-trimmed exactly as saved. Source videos must
prove CFR at the assembly rate. Native source-sample audio trims are resampled
and placed at the assembly's absolute frame/sample boundaries. BGM, SFX and
explicitly enabled embedded video audio are mixed at unity gain with a peak
limiter. There are no implicit transitions or missing-media replacements.

DIALOGUE, legacy script-bound subtitles without literal text, animated images, ambiguous stream layouts, unsupported
rotation/timestamp gaps and out-of-source ranges fail explicitly. They are never
silently omitted. Imported originals are capped at 1 GiB each and 2 GiB total.

## Files and processes

The renderer sends IDs and the declaration only. Electron's trusted main process
opens the native Save dialog and adds its selected destination to the authenticated
sidecar request. Output must be a local MP4 in an existing plain directory, with
no traversal, links, junctions or network volume. Filenames default to DRAFT.

The backend exclusively reserves the output name, stores the durable claim and
stages private verified snapshots of all exact originals. Original identity and
SHA-256 are checked again before publication. FFmpeg inputs use closed, magic-
selected demuxers and a file-only protocol allowlist, with external MOV references
disabled. Every media process checks the pinned executable, has bounded time,
output and logging, and responds to cancellation. Windows uses the existing
kill-on-close Job Object manager; explicit Linux development QA uses a process
group that is terminated and waited on at every exit.

Before publication, output is hashed, decoded, checked for exact frame count/CFR
timestamps/dimensions/codec/duration and expected audio sample layout, then fully
decoded for errors. Publication uses an atomic no-overwrite hard link in the
chosen directory. The final file hash is checked before the SUCCEEDED receipt.
The final rights check and receipt hold a database write transaction, excluding
intervening rights changes. Cancellation is serialized against publication.

Failure removes only operation-specific temporaries. It never removes a final
user file. A crash after publication but before receipt remains INTERRUPTED rather
than inventing success. Subsequent readback checks completed-file hash and size;
missing or changed files become FAILED. Reattempts use a fresh operation and name.

## Completed-file playback and location

The completed-output controls accept only project, episode and operation IDs.
Each click first fetches the backend's freshly reverified SUCCEEDED receipt.
Electron main then independently checks the exact returned path, every ancestor,
plain-file identity, size, MP4 header and SHA-256 before returning playback bytes
or revealing the file's location. It never accepts a renderer path or launches
the output as an executable. The backend additionally checks Windows local-drive
type; main does not infer mapped-drive type from a drive letter.

Embedded playback is limited to 32 MiB and uses a revocable Blob URL with standard
video controls. Closing, changing selection or leaving the page revokes that URL;
late asynchronous reads cannot reopen a dismissed player. Larger outputs show an
explicit preview limit and retain the separately verified native folder-reveal
action. That action hashes a bounded output stream, then calls showItemInFolder.
Playback does not create a formal review or release approval.

## Toolchain and release boundary

Windows development uses the existing locked development pair when it is locally
available. No media executable is bundled by this feature. Formal release
allowlists and all ProductExport approval checks remain unchanged.

For this Linux development environment only, set both:

    AIJIAN_DRAFT_MEDIA_TOOL_ROOT=/usr/bin
    AIJIAN_DRAFT_MEDIA_TOOLCHAIN_LOCK=/absolute/repo/config/draft-media-toolchain-linux-dev-lock.json

The separate lock pins the inspected Debian 7.1.5 pair and labels it
DEVELOPMENT_ONLY. Both overrides are rejected by frozen runtimes and are forwarded
only by Electron's development launch path. The release packager still consumes
only config/media-toolchain-lock.json. Neither this draft path nor its tests clear
GPL redistribution obligations.

## Focused checks

    .venv/bin/pytest -q services/api/tests/test_draft_export_encoder.py services/api/tests/test_draft_export_runtime.py services/api/tests/test_draft_export_routes.py --no-cov

Native contract/client/IPC tests cover frame authorization, path-injection rejection,
picker cancellation/concurrency and unknown response recovery. Panel tests cover
saved-version binding, required declaration, progress/history, cancellation,
remount and unsupported-track blocks. Runtime tests exercise actual MP4 creation,
reopen, no overwrite, cancellation, interrupted jobs, scope/authentication and
source/rights/destination mutation between encoding and final publication. Real
encoder tests decode image order, trimmed video, source-sample audio and delayed
mixed frequencies, rather than relying only on FFmpeg exit code.

Windows native media execution and installer/release approval remain separate
acceptance work; Linux development evidence is not a claim that Windows QA passed.

## Verified completed-output actions

Completed task rows offer bounded in-app playback and reveal-in-folder. The renderer
passes only canonical project, episode and operation IDs, never a filesystem path.
Main authenticates the top frame before admission, rechecks it after verification,
and allows one output verification at a time (`OUTPUT_BUSY` for another request).
Each action fetches a fresh scoped backend receipt. Only `SUCCEEDED` can proceed;
unknown, failed or mismatched receipts remain explicitly unavailable.

The backend getter performs its existing full hash and local-volume admission,
including Windows GetDriveType. Independently, main requires the exact canonical
absolute receipt path, rejects device/network path syntax, traversal, links,
junctions and redirected ancestors, opens only a single-link regular file, and
checks file-descriptor/path identity, size, mtime and ctime before and after reading.
Reads stream in bounded chunks, must match the receipt's SHA-256 and an MP4 header,
and stop if the between-chunk verification deadline exceeds 120 seconds. No shell
command or media file is launched. Reveal calls only Electron showItemInFolder;
its UI says the OS was requested to show the folder, not that Explorer confirmed it.

Preview returns at most 32 MiB of verified Uint8Array bytes with MP4 MIME and scoped
receipt identity through preload. Larger outputs return `PREVIEW_TOO_LARGE` and
remain eligible for verified reveal up to 2 GiB. The renderer validates the returned
identity and byte limit before creating a Blob video with controls, no autoplay,
and no network source. It revokes the object URL on close, replacement, receipt or
scope change and unmount; late replies cannot reopen a closed or replaced preview.
Missing, changed, corrupt, unsafe and too-large outputs have explicit notices.

A size-limited original-media preview does not itself block encoding: exactly
`VERIFIED` and `UNVERIFIED_SIZE_LIMIT` references can reach the backend's full source
verification. Other availability failures remain blocked. A validated CREATE-only
503 `DRAFT_TOOLCHAIN_UNAVAILABLE` is a definite pre-claim rejection; every other 503
and dropped response remains unknown and requires normal readback reconciliation.

Additional focused tests:

    pnpm --filter @aijian/desktop exec vitest run src/draft-export-output.test.ts src/draft-export.test.ts
    pnpm --filter @aijian/studio-web exec vitest run src/aivora/DraftExportOutput.test.tsx src/aivora/DraftExportPanel.test.tsx src/api/studio.test.ts

These checks cover real temporary files, corruption/missing paths, ancestor links,
mid-read growth/replacement, bounded previews/reveals, timeout, IPC authorization
and concurrent admission, preload, receipt identity and interrupted/repeated UI
lifecycles. They do not claim Windows native playback or formal-release approval.


## Literal subtitle increment

Episode assemblies now retain editable literal subtitle cues alongside unchanged
legacy script/block references. Literal cues carry a stable segment ID, exact
half-open integer frame span, text and the closed `noto-cjk-sc-bottom-v1` render
profile. The editor adds, edits, removes, undoes and saves cues through the existing
immutable assembly version chain. Unapplied form input participates in native
navigation/window-close protection; Apply or Discard is required before Save.
Legacy cues can be explicitly replaced with user-entered literal text; old versions
retain their original bindings. No empty-assembly keys or content hashes change.

Up to 128 nonoverlapping cues render into the real draft MP4. The profile is white
text with a black border, bottom-centered with individually centered lines, no
font fallback, one or two nonblank lines of at most 28 characters each. Supported
input is basic Han, printable ASCII and a bounded Chinese-punctuation repertoire;
emoji, complex scripts, combining marks and unverified glyphs fail explicitly.
Font size is `max(1, min(width // 32, height // 18))`, bottom margin one em, border
`max(1, size // 16)` and line spacing `max(1, size // 4)`. This is a fixed initial
profile, without user-selected fonts, animation or styles.

The trusted Python encoder verifies the already-bundled Noto Sans CJK SC Regular
font and OFL license against fixed SHA-256 values, then checks every text glyph
against that font's actual Unicode cmap. It copies the verified font and literal
UTF-8 cue files into a private temporary directory. FFmpeg runs there using only
controlled ASCII filenames in drawtext filters, `expansion=none`, shaping off and
frame-number enable expressions (`start <= n < end`). User text and paths never
enter shell or filter syntax. Source snapshots remain absolute arguments and all
prior source/output verification remains in place. Temporary font/text hashes are
rechecked after encoding and the files are removed on every normal exit.

Existing export verification JSON records the exact font/license hashes, profile,
resolved pixel style, stable cue IDs/frame spans and text hashes. The main receipt
still binds the complete saved assembly hash and encoded output hash; subtitle
rendering creates no release approval or rights clearance. The native saved
composition preview uses this same encoder.

Font SHA-256: `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`.
OFL file SHA-256: `6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2`.
Source lookup is anchored to the backend module, never its working directory.
Native checkpoint and Windows resource manifests copy the existing font and OFL
file into `fonts/`; frozen Windows resolves only its validated installed resource
root. Missing/changed files block subtitle encoding. No new dependency, media tool,
font download, GPL approval or formal release gate exception was added.

Focused synthetic checks include saved-version reopen/hash compatibility, actual
pixel visibility on exact cue frames at 24, 24000/1001 and 30000/1001 fps, literal
filter/shell-looking text, mutation rejection, durable runtime publication with
font evidence, editor persistence/undo/Apply/Discard and native closed-field guards:

    .venv/bin/pytest -q services/api/tests/test_draft_subtitles.py --no-cov

These are Linux development encoding checks. Native GUI acceptance and Windows
packaged rendering remain separately reported by the workbench owner.
