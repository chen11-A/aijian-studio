# QA03 AC05 front/desktop local QA result

## Fixed input

- MGR02 explicitly released c19 after QA01 backend run04, 12/12 offline matrix. QA03 used `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923` at HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`.
- Before and after execution, the 34-item AC05 author snapshot plus the policy and store single-file deltas matched all 34 paths by bytes and SHA256: 0 mismatches. Git status remained 87 entries. The source fingerprint contained 90 records and had 0 hash changes through each gate.
- The prebuild dist contained 76 files. The final Web then Desktop build contained 78 files. `before.json`, `after-*.json`, their comparisons, and both `snapshot-verification*.json` files preserve the complete file evidence.

## Checks

| Gate | Result | Raw evidence |
| --- | --- | --- |
| External AC05 Vitest (contract, IPC, client) | 3 files, 8 tests PASS, exit 0 | `vitest2.stdout.txt`, `vitest2.stderr.txt`, `vitest2.exit.txt` |
| Forced Web TypeScript `tsc -b --force --pretty false` | exit 0 | `web-typecheck.*` |
| Desktop TypeScript typecheck | exit 0 | `desktop-typecheck.*` |
| Web production build | exit 0 | `web-build.*` |
| Desktop build | exit 0 | `desktop-build.*` |
| Postflight three-layer snapshot | 34/34, 0 mismatches, exit 0 | `snapshot-verification-post.json`, `snapshot-post.*` |

The first `python` invocation reached the Windows Store placeholder and exited 9009; `before.*` preserves it. The bundled Python runtime produced `before.json` with exit 0 in `before2.*`. The first root-level `pnpm exec vitest` could not locate the package binary (exit 1, `vitest.*`); `pnpm --filter @aijian/desktop exec vitest` ran the unchanged external tests successfully. Neither was a product test failure.

## New same-source dist

| Artifact | SHA256 |
| --- | --- |
| `apps/studio-web/dist/index.html` | `97B5FA2976B03160D64E63F4AE7484C604286C6BDD35CF19799E95B1DFC7999F` |
| `apps/studio-web/dist/assets/index-CJra9Ctl.js` | `E57BB3F7185ECCEBD6C0D4CE1AD30AFA1C0FBD422CE4BC52A330570B8662416D` |
| `apps/desktop/dist/api-client.js` | `6A557E31A685AF5B0ED25FFCBD17FE359C33CC987F4BE9A9D728EAB2C7F49C81` |
| `apps/desktop/dist/main.js` | `A9467489147DEB47E88D8BEBB0172FE0482933E0AE33296721CEA32552BC2058` |
| `apps/desktop/dist/preload.js` | `B1D5A4F2C4E1552380889CEA1B5EFC1DA0D4F450344C20D23FE87A63ACA708E3` |
| `apps/desktop/dist/remote-source-extract-v2-contract.js` | `38824A553FEB2783A16B04C9D04DC212191960760B821E526C6C7641F1F8FAB5` |
| `apps/desktop/dist/remote-source-extract-v2-ipc.js` | `7F810507B198962D7B1A8BBFAFC9F880658F67DF34108DD4A0565039D916AD23` |

The Web bundle retained Vite's >500 kB chunk warning; the build exited 0. These checks use local contract data, fake fetch, and mocked IPC. They establish local static/client/IPC behavior and the same-source build only. They do not establish real Sub2API provider behavior, Electron UI behavior, installation, or final user acceptance. The prepared client tests cover request shape and fail-closed responses; they do not include a positive 201 queue receipt or positive approval response fixture.
