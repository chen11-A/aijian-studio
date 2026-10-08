# P23 settings and media preview: separate QA gates

Status: READ_ONLY_PLAN. Both candidates remain outside c19; no build, test, sidecar, Electron, or provider call has run for these candidates.

## Frozen ownership and inputs

- P23 `SettingsPage.tsx`: DEV03 one-file candidate SHA-256 `086C90CCBF3AD20B519CE934DC6A8F0B842E2B8FB5643AFFD54E12F4891E87FA`, c19 old SHA-256 `0DE9968C06088F73BA32FD2489EA9B56A74F5BA0C17AAFEF43C2CBD9982F1516`. MGR04 protected `20260928-p23-settings-c19-overlay-protected-1/BEFORE.json` SHA-256 `35B69BA541FB06A379E84ABD3C697CCFF280D2668D56CF7F0F1A6C80E316B930` says NOT_SYNCED. DEV03's 263 added / 2 removed lines introduce a separate real `projectSettings` branch; existing user settings and fixture branches must remain intact. StoryPages CAS source SHA-256 `34D272A7ED104E2A983BAB774212C17F6CF7F9913198212B7052E7487B67DA60` is already a separate prior gate.
- Media `SceneAndAssets.tsx`: DEV04 one-file candidate SHA-256 `7B9F1842292C101FE5B32E9F0F82A36D6CF5F8AD30FA7A1C7EF22430D9E0C03F`, old SHA-256 `2F405B4E20FEA1AD072B89E7656E569E6D0C65BDC5A3BBDD31ED577DAB7F1B98`. MGR04 protected `20260928-scene-assets-media-preview-protected-1/SNAPSHOT.json` SHA-256 `BA587345604F367079AEBE4FB5F79CAB97306B19F58D762DF6E19324E1531C98` says NOT_SYNCED. The candidate adds 65 lines for original video/audio preview and Blob URL lifecycle; the project-level media read API already exists. DEV04 `HANDOFF.md` SHA-256 `B3D9468E75B907393BC4E4122B858A685B850631118E77CF70D74DBD762210E5` records the native playback boundary.

## Common build prerequisite

MGR04 is the only c19 writer under a MGR02 window. After the exact two one-file source hashes are synchronized, pin HEAD/status and full Web source/dist inputs. One controlled Web typecheck and build may serve both candidates only when its receipt names **both exact files** and confirms all other Web source inputs stable. Any changed dependency or build failure is RED; do not import the earlier StoryPages CAS Web result as this new build.

## P23 QA03 gate

1. Targeted real-mode component: authoritative `getProject` populates the name and read-only project fields; no demo defaults on an invalid/missing response. Preserve existing fixture `projectSettings` and persisted user `settings` branches.
2. Test one explicit name CAS save and authoritative readback; verify project card/title revision update. A 409 shows the newer server record; an uncertain result remains UNKNOWN until a deliberate read, with no automatic resend. Switching projects must discard a late response and keep drafts/journal project-scoped.
3. Test the other project settings as read-only or clearly unavailable according to actual `getProject` fields. The earlier StoryPages CAS overlay and prior dual-sidecar persistence gate are dependencies, not proof of this new page. After targeted success, run a separate isolated two-process sidecar/UI reopen readback for the P23 path before calling it persisted runtime PASS.

## Media QA03 gate

1. Targeted bridge/component checks: existing image preview unchanged; WebM, WAV and MP3 use the single project-level `readProjectMediaAssetPreview(projectId, assetId, versionId)` read with selected immutable version ID, MIME, byte size and SHA-256 checked before a Blob URL. Assert no Blob/player for >32 MiB, wrong identity/hash/MIME, missing/corrupt bytes or late response after project switch.
2. Test dialog open/close, `onPlaying` and decode-error state, Blob URL revoke on close and project switch, and rights label from the actual version receipt. These local checks establish UI gating and URL lifecycle, not media decoding or persisted playback.
3. QA02 must independently use isolated Electron with real imported originals, fresh GET after reopen, actual play/pause/seek and raw PID/profile/binary/hash/screenshot evidence. Preview has no episode ID. A wrong-episode 404 `EPISODE_NOT_FOUND` belongs to a separate episode-reference POST test.

No product DB mutation, provider call, new c19 writer, or native acceptance is part of this read-only plan.
