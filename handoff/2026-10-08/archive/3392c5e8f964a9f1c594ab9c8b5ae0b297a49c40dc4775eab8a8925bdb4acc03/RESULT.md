# QA03 source-preview CSS local gate, 2026-09-28

## Fixed input

- MGR04 protected one-file snapshot: `20260928-source-preview-css-1/SNAPSHOT.json`, SHA256 `067A35EA00209027F4B49CAB8CEF71826A6DA343311E112AE0142A5FD7A4E729`.
- c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, status 87. Compared with QA03's immediately preceding AC05 postflight, exactly one of 90 source records changed: `apps/studio-web/src/aivora/v2-story.css` from SHA256 `79C6568149AC82D84C1D2FBD4702E60E400AEF32DD38ADFDD477DF86E54448B4` to `FCCB6ACC0476641B0BFBE0D47028D008CF2C0FBCA35956F2B053C5D49EA16523`; the 78 old dist records were unchanged before this build. `before.json` and `input-compare.json` preserve the full comparison. The comparison tool returned 1 because it treats *any* source change as a failure; this CSS change was the authorized input.

## Results

| Gate | Result | Evidence |
| --- | --- | --- |
| Web build, which runs `tsc -b` and Vite | exit 0 | `web-build.stdout.txt`, `web-build.stderr.txt`, `web-build.exit.txt` |
| Build postflight | HEAD/status unchanged; source 90/90 unchanged from build input; only Web dist changed; Desktop dist unchanged | `after-build.json` SHA256 `6922890DF5A3C0ED4E88731FCAEA9D0F0A02FB4D4C6807EA1280750A0FE2F7DE`, `after-build-compare.json` |
| 1424×881 isolated component geometry using actual built CSS in Edge | exit 0 | `geometry3.json` SHA256 `0CE0A185A5088472D39362B809951C40F1230C06898B322CBD3C3C6F634BD559`, `geometry3.png` SHA256 `E96C411DD6ABFF34B574BCAF1EF221A15656BB28CB432A6BE7A9051D1A05D7D4`, raw stdout/stderr/exit |

The component probe used a 440×536 source-side container and long Chinese source text. Its excerpt had scrollHeight 6561 and clientHeight 159, with independent scrolling. The status, refresh and confirmation buttons were within the preview card; the privacy card flowed below. Tab focus proceeded through the scrollable excerpt, refresh, then confirmation. The screenshot was visually inspected and shows both buttons and the privacy card.

The first geometry invocation failed on an unsupported Windows ESM path. The second produced valid geometry but failed the test's incorrect assumption that Tab would skip Chromium's focusable scroll region. Both raw failures remain as `geometry.*` and `geometry2.*`; the corrected test script and `geometry3.*` passed. These were probe defects, not product failures.

## New same-source Web dist

- CSS `apps/studio-web/dist/assets/index-CWS9rU1T.css`: SHA256 `47AAD2754ADE8403412366415DC0EFBF3FC901CA874EA9F0753650EA0BCA193B`.
- HTML `apps/studio-web/dist/index.html`: SHA256 `C6CDCEF5805AD58B3333E63B7B9D14291D14816B624A51E4FB9FCD99DACF9319`.
- JS `apps/studio-web/dist/assets/index-BV9JO5jH.js`: SHA256 `E57BB3F7185ECCEBD6C0D4CE1AD30AFA1C0FBD422CE4BC52A330570B8662416D` (same JS bytes as the preceding build; emitted filename changed).
- Desktop main, preload, and api-client dist SHA256 remained `A9467489147DEB47E88D8BEBB0172FE0482933E0AE33296721CEA32552BC2058`, `B1D5A4F2C4E1552380889CEA1B5EFC1DA0D4F450344C20D23FE87A63ACA708E3`, and `6A557E31A685AF5B0ED25FFCBD17FE359C33CC987F4BE9A9D728EAB2C7F49C81` respectively.

QA03 released c19 to QA02 after these local gates. This probe does not prove the complete Electron page at 1424×881 or a smaller window; QA02 must verify the actual page, scrolling, controls, Tab focus, and normal close in a new isolated profile. No provider request was made.
