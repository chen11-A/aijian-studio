# Native workbench checkpoint — 2026-10-08

This is an independently reconstructed development checkpoint on the local
`repair/runtime-baseline` branch over `63c76db`. It is not Windows release
acceptance and does not establish completion of the full product.

## Actual native desktop checks

On the cloud Linux graphical desktop, using the official Electron 43.2.0 runtime
with renderer sandbox, context isolation and web security enabled:

1. Opened the existing AIVORA interface and connected its managed Python sidecar.
2. Created the synthetic project `harbor desktop check` through the native UI.
3. Added a scene (`harbor dawn`) and action (`lin finds a letter by the sea.`).
4. Saved and read back script draft version 1, revision 1.
5. Closed the native window, observed the launcher return, restarted the app,
   opened the project and verified the scene and action were unchanged.
6. Created `episode two`; its editor was empty. Switching to the first episode
   restored the saved script, establishing basic episode isolation.
7. Created the project-shared character `lin` (role `lead`), world premise
   `a foggy harbor`, and scene `pier` (location `harbor`). Saved versions 1–3,
   closed the application completely and verified all three entries on reopening.
8. Created two episode storyboard shots, `harbor dawn` (48 frames) and
   `letter closeup` (72 frames), at 24 fps. The first includes a visual description,
   camera description, exact script-v1/scene pin, creative-library-v3 pin, character
   and location references. Saved/read back v1 and verified both shots after a
   full application shutdown/restart. This is a text storyboard, not generated film.
9. Imported a synthetic H.264 MP4 and 48 kHz PCM WAV through the native asset
   picker. Split a 50-frame visual range at frame 25 into two clips, added a
   BGM range starting at frame 0 for 50 frames, and saved/read back the assembly.
   After a full restart the 25 fps, two-second, two-visual/one-audio composition
   was restored. The source WAV player reached its real three-second end.
10. In the native export page, acknowledged that these inputs were synthetic,
    selected the output with the system Save dialog, and exported an actual
    local DRAFT MP4. Native completion showed 50/50 frames and 773,802 bytes.
    Independent ffprobe confirmed H.264 1920×1080, 25 fps, 50 frames/two seconds,
    and AAC 48 kHz stereo/two seconds. Full FFmpeg decoding exited successfully.
11. Reopened the saved export history after restarting the application. The new
    verified-output player loaded the actual MP4 and played from 0:00 to 0:02,
    visibly advancing the encoded test pattern from frame 0 through frame 49.
12. Changed the saved composition's canvas to portrait 1080×1920. Attempting to
    leave showed the native discard prompt; Cancel preserved the edit. Attempting
    to close the window was blocked with a visible unsaved-edit explanation.
    Saving then completed readback, and the forward action opened draft export
    with the exact new portrait version rather than the older landscape version.
13. Exported the portrait version through the native Save dialog. The new output
    had 50 frames, H.264 1080×1920, 25 fps, two seconds and AAC 48 kHz stereo.
    Full decoding passed; the earlier landscape file and receipt remained intact.

The native output was `Aivora-DRAFT-017c8d62.mp4`, SHA-256
`73d841cd7665697e79eb369a076ff69fdff0079c21003aa15810c418356c4723`.
It contains only locally generated test patterns and a test tone; it is not an
AI-generated creative result. The draft path retains the formal export release
gates and does not assert rights approval or distributable encoder licensing.
The portrait output was `Aivora-DRAFT-cc53a72c.mp4`, 388,267 bytes, SHA-256
`15bbde9131103d0c64dba0fc1fa28c2663ed41834ac296f0fe738a9b6b0901e0`.

The verified folder-reveal action launched the cloud Linux file manager, but
that environment displayed the parent `shared` directory rather than selecting
the exact output. The UI accurately says a system request was made. Exact OS
folder/file selection is not accepted yet, especially on Windows.

The separate self-contained Linux checkpoint includes Electron, Python and the
production dependency closure. Its actual native UI started, created a clean
project and imported a locally generated 23,401-character UTF-8 Chinese source
through the system file picker, with verified saved/readback status. The source
is test content, not a user novel or evidence of AI generation. Relocated-path
runtime checks, authenticated sidecar startup/shutdown and archive hashes also
passed. The delivery archive excludes workspaces, credentials and test data.

The package initially showed graphics corruption when two different Electron
copies ran simultaneously on this cloud desktop. Closing both and launching the
packaged copy alone restored rendering without disabling the sandbox. This is a
known environment observation, not a claim that all graphics configurations pass.

## Functional changes in this checkpoint

- Native startup opens the launch screen; the default development command starts
  the desktop app and its managed sidecar, not a separate web/API stack.
- Original/no-source scripts are editable. Project inspiration is visibly an
  unsaved draft until its production brief is saved and read back.
- Dialog submissions await real results and block duplicate submit/close while
  pending. Scripts guard unsaved navigation and preserve unknown-write recovery.
- Script save verification compares JSON values independently of object-key
  order. A real native save no longer becomes falsely unknown after SQLite
  canonicalizes key order; genuine content differences still fail verification.
- Home creation controls no longer overlap. The editor has independent scrolling
  so long scenes and save controls remain reachable in a small window.
- Production assistant shows true context/configuration/task state. Free chat
  and unsupported uploads are explicitly unavailable rather than simulated.
- Project-shared creative settings and episode-scoped manual storyboards use
  stable identities, immutable artifact versions, CAS revisions and verified
  readback. Empty states expose manual creation without requiring AI services.
- Real imported image/video and audio ranges can be assembled, trimmed, split,
  reordered and saved. Audio sample offsets and rational frame rates are explicit.
  Source playback is labeled separately from a mixed composition preview.
- Assembly edits have navigation/unload protection and guarded reload. Saved
  canvas presets include landscape, portrait and square. They produce a new
  immutable version, preserve earlier exports and fit originals with letterboxing.
- The independent draft-export runtime encodes real saved assemblies, verifies
  output, preserves jobs and protects against overwrite. The renderer never
  supplies arbitrary destination paths; the desktop Save dialog owns that step.
- Completed draft playback rechecks the recorded file's size, identity and hash
  in the main process before returning bounded bytes to a revocable video Blob.
  Inline completed-output playback is limited to 32 MiB; it does not claim an
  interactive, frame-accurate multi-track timeline or formal review approval.

## Verification limits

TypeScript checks and desktop/renderer builds passed at this checkpoint. Focused
regressions were used for the changed persistence and UI paths; historical broad
lint/test failures have not been suppressed or relabeled as passes.
The repository-wide `pnpm typecheck` command is **not** green: its TypeScript
stages pass, then Python mypy reports 173 existing errors across 40 files. The
new draft-export modules pass their separate strict checks. A default uv cache
path was read-only in this environment; re-running with a workspace-local cache
reached those actual Python diagnostics rather than hiding them.

Windows installation, upgrade/restore and real provider calls remain unverified.
The prepared Windows dependency cache is not an installer. A real Windows build
and standard-user installation check are still required. The Linux draft encoder
pair is explicitly DEVELOPMENT_ONLY and is not added to a release allowlist.
Formal reviewed/releasable export remains gated, and unsupported subtitle/dialogue
assemblies are rejected rather than silently omitted. An interactive mixed
timeline preview is not yet implemented. The browser renderer launcher is a
development diagnostic only, not desktop acceptance.

## Original interface follow-up (06:39 UTC)

The original desktop interface remains the delivery UI. The optional script /
storyboard workspace experiment was shown and then declined by the user; its
entry and shell integration have been removed. Isolated prototype source is an
archived experiment, not an enabled product surface.

Native inspection covered 21 reachable production routes, including professional
mode. The separate character alias and voice route have no independent current
production navigation entry, so they are not counted as native route passes.
At 1178×814 and the 980×680 minimum, corrected assistant clipping, sidebar labels,
creative-list height, storyboard fps field, asset actions / long hashes, and
footer layout were rechecked. The final native pass verified the source footer,
project-settings scrolling, launch text and initially reachable project Open
button. Production Inspector and changes pages no longer expose fixture fields
as though they were connected functionality.

On the retained original script page, the synthetic action was extended with
`the tide rises.` and saved/read back as version 2, revision 2. After a native
confirmation dialog, cloud keyboard focus once needed explicit dock activation;
no business-data patch was applied based on that automation observation.

The source snapshot also includes Sub2API origin-mode contract corrections and
accepted-summary-to-script binding, plus the initial official ChatGPT adapter
and first-use choice (ChatGPT, API, or offline). These later authentication UI
changes are compile-checked source, not native login acceptance. No OAuth grant,
client registration, real inference, private-source transmission or provider
billing was performed. The new official adapter still requires its focused
security checks and real authorized-service verification before release use.

### First-use connection choice, native UI checks (06:48 UTC)

The original launch now offers official ChatGPT, direct API/Sub2API setup, or
local offline creation. Native Escape dismissal and API skip navigation passed;
returning through launch after choosing API did not repeat onboarding. Existing
API configurations and locally verified official connection status also bypass
the prompt by code; an authorized existing official profile was not available
for live validation. The stored preference is not an authorization record.

The AI Services screen keeps API configuration and official account management
in separate tabs. At 1178×814 and 980×680 the official status card fits, and the
API save button remains reachable in the bounded form. This cloud Linux system
reported its secure credential storage unavailable, so Continue with ChatGPT
was disabled. No fallback to plaintext storage or security weakening was used.
These checks validate navigation and honest unavailable state, not OAuth or
inference success. Three focused first-use preference/dismissal tests passed.

### Stable storyboard / media provenance (07:02 UTC)

In the original native assembly UI, both saved visual clips were linked to their
respective saved storyboard-v2 shots. The saved composition read back, and a
renderer restart restored 2/2 links without changing the 50-frame portrait
composition or its BGM. The native storyboard inspector then compared script-v1
with the already saved script-v2, identified the changed scene content and
explicitly upgraded the script pin while preserving the scene ID, shot IDs,
creative-library-v3 pin and character/location references. Saving created
storyboard-v3. Reopening assembly retained the exact old storyboard-v2 links and
showed an upstream-change warning rather than clearing or silently rebinding
them. No source was deleted, media regenerated, or review approval inferred.

Before introducing schema37's separate official-text operation/proposal ledger,
a consistent SQLite backup of the synthetic native workspace was made and its
integrity check returned `ok`. The updated native app started and reopened the
existing project successfully. Official text generation remains unverified with
an upstream service; its persistent proposal workflow has passed focused synthetic checks, but still needs the authorized end-to-end service run.

### Official text proposal source checkpoint (07:11 UTC)

Schema37 adds scoped durable operations and immutable result/adoption receipts.
The trusted main process records a verified successful response; the renderer
cannot submit arbitrary text as an official completion. Explicit adoption checks
the captured script base and proposal version/hash and creates a new editable,
unconfirmed draft. Results never masquerade as accepted source extraction.
Twenty-one new focused synthetic tests and three existing script regressions
passed with desktop/renderer builds and typechecks. Native generation remains
blocked on credentials/service authorization; fixture tests are not live success.

Two inherited desktop test mismatches were corrected without loosening product
checks: the OpenAI response fixture now includes the required null origin mode,
and the malformed-startup test asserts the specific SidecarStartupError class
and the same redacted message. Both targeted cases pass. A broader earlier run
also exposed a local media-tool lock mismatch; it remains a separate environment
limitation, not a passing full-suite result.

At 07:15 UTC the proposal-enabled native app was restarted, the existing script-v2
opened unchanged, and its collapsed official-text panel expanded. The read-only
history action returned the truthful empty list with a successful local-read
notice. Text/instruction fields stayed empty and generation remained disabled;
no model catalog, external authorization or inference action was invoked.

### Schema38 source checkpoint, native note flow pending (07:31 UTC)

Manual DRAFT comments and one append-only resolution now bind the exact output,
assembly version/hash, episode and original frame rate. They never create a
formal review signoff. Older-output comments are retained with a warning; missing
or changed media preserves history but blocks new notes. The original review
entry links to export history for these records. Unsaved note/frame and resolution
text recover separately per output, survive collapsing/reopening, and are clearly
marked unsaved. Confirmed readback or explicit discard clears only that draft.
Focused backend, desktop boundary and renderer checks and builds passed. The
actual native add/save/reopen/resolve flow is pending because the cloud desktop
is reserved for the user's private keyring setup; no fixture is represented as
native acceptance.

### Native manual review acceptance (08:09 UTC)

The original review entry opened real export history. On the previously verified
portrait MP4 (`Aivora-DRAFT-cc53a72c.mp4`, assembly-v2), a synthetic comment
`check cut at frame 25.` was entered at exact frame 25. Collapsing and reopening
preserved the unsent frame/text; saving returned the authoritative note. A
renderer reload restored it, then the separate resolution `persistence verified.`
was saved. The full native application and managed backend were closed normally
and restarted in the same secure desktop session. Both the original comment and
its resolution reopened unchanged, with the older-assembly warning intact.
No new movie, formal review approval, rights decision or AI call was created.
At the 980×680 minimum, note history, frame input, text area and save controls were
readable/reachable; the window was restored to 1178×814 afterward.

One project-Open click after restart unexpectedly showed the user-settings route;
Return to Project recovered the selected project without changing data. The
cause was not established, so this is a navigation observation, not a diagnosed
storage failure or a suppressed check.

## Saved composition and literal subtitle native check — 09:20 UTC

The original native desktop was reopened in the existing secure desktop session.
The synthetic project and its two-video-clip/BGM portrait assembly were read back.
A literal `harbor test` cue covering frames 0–50 was added through the native form,
applied, saved and verified by the editor's authoritative readback. The saved
version generated a real continuous preview through the native IPC path, with
50/50 frames confirmed after output verification. The in-app player advanced from
0:00 to 0:02 and displayed encoded test-pattern frame 49. Independent decoding of
frame 25 showed the subtitle burned into the portrait frame; the output is H.264,
1080×1920, 25 fps, 50 frames, two seconds, with AAC 48 kHz stereo, 389,603 bytes.
SHA-256: `213185e9e1c887a4212a549b897f78dc8cd195aa81d88655c61d91d9f71c6467`.
This verifies a generated saved-version preview, not real-time timeline playback
or frame-exact professional review. Standard HTML playback controls can cover the
bottom caption while controls are visible. Full restart/recovery and minimum-size
regression for this new combination are still pending.
