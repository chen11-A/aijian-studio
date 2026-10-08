# DEV04 project media original preview handoff

## Exact source

- Author checkout: `C:\Users\Administrator\.codex\worktrees\s2-q1-g1-d00-default-deny-59f-20260923\sp`
- Only changed source: `apps/studio-web/src/aivora/SceneAndAssets.tsx`
- Before SHA-256: `2F405B4E20FEA1AD072B89E7656E569E6D0C65BDC5A3BBDD31ED577DAB7F1B98`
- After SHA-256: `7B9F1842292C101FE5B32E9F0F82A36D6CF5F8AD30FA7A1C7EF22430D9E0C03F`
- Frozen copies: `SceneAndAssets.tsx.before` and `SceneAndAssets.tsx.after` in this directory.
- Backup-to-source `git diff --no-index --check`: exit 0. Developer did not build, run tests, or open product UI.

## Behavior and boundaries

The old video/audio card click stopped at an explanatory notice. The new click uses the existing desktop `readProjectMediaAssetPreview(projectId, assetId, versionId)` read. The API/store verifies the original bytes, and the desktop client checks the listing identity, ETag, MIME, length, 32 MiB cap, and SHA-256. The renderer checks the returned length, SHA-256, and MIME against the selected immutable version again before creating a Blob URL. The dialog uses native WebM video or WAV/MP3 audio controls. `onPlaying` records that the local player started; a decode error reports player failure without changing the asset record. Dialog close and project switch revoke the Blob URL. Project epoch and active-project checks discard late reads. The card now shows the receipt's actual rights status.

This is playback of a stored original. It does not establish a media probe, generated motion, lip sync, a playable episode assembly, or formal export approval.

## Independent QA03 / QA02 evidence contract

1. In an isolated Electron profile and project, import actual small WebM, WAV, and MP3 originals through the product picker. Record exact project, asset, version, SHA-256, byte size, MIME, profile, executable hash, and request IDs. Reopen the library and verify the versions persist.
2. Click each card. Record the single read path (listing plus GET original), returned version identity and byte hash, video/audio loaded metadata, actual play/pause and seek behavior, and a screenshot or capture showing the original player. An API `READY`, an enabled control, or a click alone is not playback acceptance.
3. Close the dialog, reopen the same asset, and show a fresh read; inspect that the old Blob URL was revoked. Switch projects during a delayed read and show that the old project's bytes never appear in the new project's UI.
4. Check a >32 MiB original, missing/corrupt media, mismatched identity/bytes, and decoder failure. Each must avoid a playable claim and preserve the asset/version record. Keep raw failures and request IDs.
5. Preview is project scoped and has no episode ID. For a wrong-episode rejection, test the *separate* existing episode-reference POST with a nonexistent or foreign episode ID; the store queries `(project_id, episode_id)` and returns `EPISODE_NOT_FOUND` (HTTP 404). Do not label a successful project-level preview as proof of an episode reference.

QA results from local/mock or component tests remain separate from the actual Electron playback and persisted reopen evidence.
