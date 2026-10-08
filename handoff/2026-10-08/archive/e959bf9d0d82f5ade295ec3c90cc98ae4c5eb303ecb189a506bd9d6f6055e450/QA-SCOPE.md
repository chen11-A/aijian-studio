# QA03 DEV07 deadline consumer gate — review draft

State: `DRAFT_SCOPE_NOT_SIGNED_NOT_RUN`. This is a proposed isolated **desktop consumer simulation**, not an API, Electron, provider, migration or same-version UI acceptance gate. MGR01 must fix the exact scope and MGR02 must independently sign the final package before any copy or test call.

## Fixed author inputs

| Input | SHA-256 |
|---|---|
| DEV07 source-only `work/dev07-sub2api-local-mode-20260929/MANIFEST.json` | `E166BC890EF11C843EC9035957B660AB2E84FCE099411D8E957FC3FB92985442` |
| DEV07 `QA-HANDOFF.md` | `9968C41DF6ACB17186CFD667853B8D50C8ED74296D930B2E4E12BBD1A1BFC2FF` |
| `apps/desktop/src/api-client.ts` | `B59AA696E059E64B3167DCBA52993010D21F67F9849ADA74C105282AC189396E` |
| `apps/desktop/src/provider-connection-contract.ts` | `75E341279A7E787EE196940FB637D3534C7B66093D32B5E2A613AC7C37353DBF` |
| `apps/desktop/src/sub2api-connection-mutation-contract.ts` | `17392F8629550F1A6C495E68901721C528C05D6CCB538D49273959DC661151F7` |
| DEV07 unrun `apps/desktop/src/api-client-local-mode-deadline.test.ts` | `B18187304B871B876DCCDF70BA8B1D02CEA196F4A3DDDC15105B5248EC5F80C1` |
| QA-only normal-readback test | `api-client-local-mode-readback.qa.test.ts` SHA-256 `9CF637AD4D4CF9E297BE58B009CCA38DF179152DF9F05888540A30897AEFBCB2` |
| QA-only Vitest config | `vitest.qa.config.mts` SHA-256 `EF7CD6D827106B2668A9E343BADD8B45BFBA0FDEFB24CE10414755F774C657A4` |
| QA-only network guard | `qa-side-effect-guard.ts` SHA-256 `940542A824EDD6B1722E1A21B768FF3B086442AB8F6724C541ED9395BB602499` |

Earlier DEV07 manifest `BC07F041...` and test `7A609AB5...` were intermediate identities and are excluded.

## Independent runner and proposed snapshot

Base is frozen W0-v3 `source-03`, manifest SHA-256 `CDF2C999AFBB77195E2FAF4F6EBA5BC89A8EC619FE3A4843330D26DAF0D67C28`: 13,681 regular files and 771 internal relative links. Root `package.json` SHA-256 `49C29668A12945B3ECEF191FC188585C2F297B2625F06AD087EC7C96043B5821`, desktop `package.json` `B32C71AB978689B3ADBF0F34F68D3A079A4FEE7E91614DCC450478FF641C9E47`, lockfile `B7BAC2466E4F52C7FAF23536041EC6F23BD7B0F7CC05898F4BF0E07A782603D1`.

The proposed QA snapshot copies that base into a **new absent QA directory**, replaces the three DEV07 source files above and adds the two tests, `vitest.qa.config.mts` and the QA network guard. It recreates only the seven desktop `node_modules` relative links in `DESKTOP-NODE-LINKS.json` SHA-256 `4830E0D5DBFD6EFD9305EDD7E428756AB1DC6401FEBD089D54C908C20412DE04`; every link resolves inside the copied source. Expected post-copy count: 13,685 regular files and 778 internal links. The extra regular file is a narrow test-worker guard required by MGR01's side-effect boundary; it does not alter product source. `SNAPSHOT-PLAN.json` SHA-256 `637A31392979131A1D8D89B762107FC815C8598C15E0B48F4D8D2706A19C5807` fixes all seven overlay entries. Hash every input before/after and the complete QA snapshot after copy; reject drift, collisions and external link targets. No author tree, old signed stage, c19 or generated contract is written.

Runner: `C:\Program Files\nodejs\node.exe` v24.15.0 SHA-256 `3331E1FFE19874215472217C5E94F5A0C6D8E18C4AC7111D3937AA0AD5E9B4A5`. Fixed Vitest 4.1.10 entry `node_modules/.pnpm/vitest@4.1.10_@types+node@2_783484011bed6b98f5bd667491dccde6/node_modules/vitest/vitest.mjs` SHA-256 `39DB22F579ACF5639BBB17A261408DEBBDE03F4692C0C439E77E7F13AEBA74D6`; desktop `vitest.config.mts` in the base SHA-256 `3405AF9DBDA41B5BFBA9F5A6507060445EC2E3E4CA15929DE6D403073FB6F760` is superseded for this narrow gate by the QA-only config. Run `vitest run --config vitest.qa.config.mts` from the copied desktop root with no coverage, one worker, zero retries, first-failure bail and only the two named files. The launcher must set `QA_VITE_CACHE_DIR` inside its QA scratch directory before starting Node. The setup file throws on global fetch/WebSocket/EventSource and Node net/TLS/HTTP/HTTPS/datagram/DNS entrypoints; the normal-readback test asserts the guard's marker is active. The launcher separately audits child PIDs and network endpoints and checks the fixed import set for OS Vault/provider modules. The setup file runs in the test process before each test file, **after Vitest startup**; it does not guard Vitest/Node initialization or prove that no native OS Vault access occurred. Any unclassified side effect stays UNKNOWN and stops the gate. Capture exact command, runner and child PIDs, bounded wall-clock time, raw stdout/stderr, exit code, test counts, all snapshot input hashes after run, and allowed QA scratch writes. No automatic rerun after RED/UNKNOWN.

## Assertions and limits

1. Pre-PATCH GET never resolves: virtual 15-second deadline, aborted signal, `REMOTE_UNKNOWN`, exactly one GET and **zero PATCH**.
2. Valid pre-read and one valid PATCH receipt, post-PATCH GET never resolves: aborted post-read signal, `REMOTE_UNKNOWN`, exact method sequence GET/PATCH/GET and **one PATCH total**, no retry.
3. Normal LOCAL metadata edit: explicit `LOCAL_LOOPBACK_HTTP`, current revision, one PATCH, then authoritative list readback of LOCAL mode, same base URL, revision +1 and changed display name; result `UPDATED`.

All fetches are fixed in-memory mocks; this gate cannot prove durable database state, credential reference, approval consumption, Web UI or native Electron behavior. Those require separate same-version packages after MGR04's new composition and migration prerequisites. The old v3 composite and QA stage remain historical.
