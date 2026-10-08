# QA02 project media original preview: isolated native gate

Status: `STATIC_PACKAGE_READY_RUNTIME_NOT_RUN`. This plan is for the current
DEV04 `SceneAndAssets.tsx` candidate SHA-256
`7B9F1842292C101FE5B32E9F0F82A36D6CF5F8AD30FA7A1C7EF22430D9E0C03F`.
It is independent of Stage-A long-path video probe, public assembly routes,
rights approval, MLT, generated media, and product export.

## Start gate and ownership

QA02 owns this external folder and the later isolated QA profile/evidence.
QA02 does not edit c19. Before native execution, require MGR04's exact-source
sync receipt for `SceneAndAssets.tsx`, the post-sync web/desktop build receipt
and dist fingerprints, current c19 target hash, cleanly stopped previous
Electron/sidecar processes, and a fresh named QA profile. Record exact
Electron executable SHA, renderer/dist SHA, profile path, process IDs,
project IDs, and clock times. If any hash, ownership, startup, or sidecar
identity differs, stop before importing. No provider call.

The current static c19 copy hashes to the DEV04 candidate, but source presence
does not prove the pending sync/build or running renderer. `SOURCE-LOCK.json`
pins the currently inspected chain. Recheck it after MGR04 delivers.

## Input and success cases

`INPUT-MANIFEST.json` names existing synthetic WebM/WAV and QA-owned generated
MP3, with exact bytes, SHA-256 and expected MIME. These are synthetic QA media,
not user works. Import each through the product's real file picker into a new
QA project. Save picker target, import response/request ID, project/asset/version
IDs, filename, actual MIME, size, SHA, managed original path/hash, and DB/profile
identity. Read the list again and require version identity and byte hash to
agree with each input. An import receipt alone is not this gate.

For each card, capture the real list request and single original-content GET,
request IDs, ETag, Content-Type, Content-Length, response byte count/hash, and
the `api-client.ts` path that returns READY only after its SHA check. Observe
the real `<video>` or `<audio>` element: loaded metadata, duration, dimensions
for WebM, actual `playing`, `pause`, `seeked`, currentTime progression, decoded
state/networkState/error, and a screenshot or short local capture. Exercise
play, pause and seek through visible controls. `READY`, a visible control, and
an `onPlaying` message by themselves do not establish full playback.

Close the dialog. An observation-only wrapper around the real
`URL.createObjectURL` and `URL.revokeObjectURL` may record URL creation and
revocation; it must call the originals and never supply media bytes. Require
the exact old URL revoked, then reopen and require a fresh original GET and
fresh Blob URL. Normal-close Electron, reopen the same isolated profile, and
read the same versions and hashes again before a second playback check.

## Negative cases and limits

1. Import the valid `oversize-test.wav` (>32 MiB) into the isolated project.
   The listing must persist it. Card preview must show the size notice before
   content GET, create no Blob URL/dialog, and leave asset/version unchanged.
2. Import `decoder-invalid.mp3`. Its ID3 header is enough for the current
   importer classification, but no playable MP3 frames are present. A successful
   original-byte read must not become a playable claim. Record native media
   element error/code, no `playing`, and unchanged asset/version.
3. After the positive run and normal app close, use a separate isolated QA
   profile to remove or alter only a copied managed blob. Preserve before/after
   SHA and DB hash. Reopen and require MISSING/CORRUPT or a bounded read error,
   no player, and no silent asset rewrite. Stop if the target path cannot be
   tied exactly to the QA asset version. Never alter source fixtures or c19.
4. Wrong identity has two different boundaries. Invoke the real preview IPC
   with a foreign project/asset/version in the isolated profile and require
   rejection/no bytes. A controlled contract test may alter listing/ETag/MIME/
   length/body SHA to exercise the main-client and renderer mismatch branches;
   label that result `LOCAL_CONTRACT`, not actual service/native playback.
   Native mismatch remains `NOT_RUN` if no authorized controlled response path
   exists. Never fabricate a real-service receipt.
5. Trigger a preview and switch projects before it resolves. Capture request
   and project epochs, and require no previous-project dialog/blob in the new
   project. If a local response is too fast to reproduce overlap, record
   `NOT_OBSERVED` and request a controlled delay seam; do not claim a pass from
   a sequential switch. The project-scoped preview has no episode ID. A
   wrong-episode case belongs to the separate episode-reference POST and must
   be reported separately.

## First failure and evidence

For each case, save raw requests/responses where available, UI locator/DOM
state, media events, screenshot/capture, profile DB/hash, relevant managed
blob hash, process tree, and normal-close result. Stop on the first product
RED/UNKNOWN in a dependent sequence. Do not automatically repeat imports,
preview GETs, or failed sidecar calls. Preserve partial state and classify
tool/locator failure separately from product behavior. An isolated local run
can prove only the named original-preview behavior, not rights, assembly,
generated motion, lip sync, export, installation, or user acceptance.
