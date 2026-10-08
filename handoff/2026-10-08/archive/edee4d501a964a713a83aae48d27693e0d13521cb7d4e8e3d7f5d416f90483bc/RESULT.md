# DemoApp global route: component GREEN, Web typecheck RED

- c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, status 66.
- Synchronized one-file fix snapshot: `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-demoapp-global-route-fix-1\SNAPSHOT.json`, SHA256 `3C39BE8E2CF0F712CD34A3BA95F976CB24A80D8B0B9A038D1FA20A24D6B4ED2D`.
- New DemoApp SHA256 `C3722EBCD17D9E209D3EB59DBD0F01A13434B84CC900C4481094C08DA6940BBE`.

## Component evidence

The pre-fix baseline in `../run-red-01` remains 3/3 failing, exit 1. With the synchronized DemoApp fix, the first original-three rerun (`original-three.stdout.txt`, `.stderr.txt`, `.exit.txt`) was 2/3 because the external assertion found both h2 and h3 named “添加模型供应商.” The real `AI 服务` h1 and the other two pages were present. `original-three-fixed.*` records the corrected h2 locator and 3/3, exit 0. The original test copy remains in `../run-red-01/global-navigation.original.mjs` unchanged.

`all-eight.stdout.txt`/`.stderr.txt`/`.exit.txt` preserve a 6/8 external assertion error: the test used `data.ts` metadata titles for launch and home, which are not their actual DOM headings. The corrected test `../global-navigation.test.mjs` SHA256 `B3A9D5982B06B457E0684A00EADC0E6A3CB00337C4A30AFE7129517FE6CE3EFB` checks the real heading and key button. `all-eight-fixed.*` records **8/8, exit 0**: without a project, services/costs/settings and launch/home are reachable, while source/story/projectSettings remain gated.

## Stop at typecheck

Web typecheck `pnpm --filter @aijian/studio-web typecheck` returned **exit 1**; raw `web-typecheck.stdout.txt`, `web-typecheck.stderr.txt`, `web-typecheck.exit.txt` are preserved. Errors:

- `apps/studio-web/src/aivora/adapters/projectManagement.ts:158`: TS2304, `ProjectUpdateResult` is undefined. The file imports `UpdateProjectResult`.
- `apps/studio-web/src/aivora/HomePages.tsx:194`: TS2322, optional `revision?: number` passed as required `expectedRevision: number`.

`before.json`, `after-tests.json`, `after-red.json`, and `after-web-typecheck.json` record source/status/dist fingerprints. Source and dist hashes and status were unchanged through tests; typecheck produced no source or dist changes. Compared with the earlier PROJECT01 successful build's 69-source manifest, this window differs only in the authorized DemoApp single file; the two error-bearing files were already present byte-for-byte. This is a current typecheck failure despite prior incremental typecheck success.

Per failure stop, Desktop typecheck and both Web/Desktop builds were **not run**. No Electron, provider, network, or native acceptance was run in this window. Product source was not edited by QA03.
