# QA03 DemoApp global route and PROJECT revision fix: front/desktop GREEN

- c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`, status 66.
- Preceding DemoApp single-file snapshot SHA256 `3C39BE8E2CF0F712CD34A3BA95F976CB24A80D8B0B9A038D1FA20A24D6B4ED2D`, source SHA256 `C3722EBCD17D9E209D3EB59DBD0F01A13434B84CC900C4481094C08DA6940BBE`.
- PROJECT two-file TS fix snapshot `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-project01-ts-fix-2\SNAPSHOT.json` SHA256 `3665EB78667A594F74AAEF0EFEE2697F117E5393D2068E4EA756C64B4D5399C0`. Final `HomePages.tsx` SHA256 `A1BA0262DD081C27301CD07B5952D9C2E9E9BB89001290107C9E47A0BA47C56F`, `projectManagement.ts` SHA256 `7B549DCDBE7A4E3F4051FD815E98B013A07610D995C24BB135EDEBA656F8CD66`.

## Scenarios and commands

The external real HomePages script `qa03-project01-front-20260924/project-home.test.mjs` SHA256 `7F6016E1736653A8E37D99F67D89BAFE12728F7B449A5DBC48E042864E2EAE9B` passed 6/6, exit 0 (`home-revision.stdout.txt`, `.stderr.txt`, `.exit.txt`). It includes missing or invalid revision blocking project update and a changed authoritative revision while the edit dialog is open disabling save, with zero PATCH calls. The external real DemoApp script `qa03-global-services-20260924/global-navigation.test.mjs` SHA256 `B3A9D5982B06B457E0684A00EADC0E6A3CB00337C4A30AFE7129517FE6CE3EFB` passed 8/8, exit 0 (`global-eight.*`): no-project services/costs/settings/launch/home reach their real pages, while source/story/projectSettings remain gated.

From c19 root, in this order:

1. `pnpm --filter @aijian/studio-web exec tsc -b --force --pretty false`: exit 0 (`web-force-typecheck.*`). This forced a full build-mode check instead of trusting the earlier incremental state.
2. `pnpm --filter @aijian/desktop typecheck`: exit 0 (`desktop-typecheck.*`).
3. `pnpm --filter @aijian/studio-web build`: exit 0 (`web-build.*`).
4. `pnpm --filter @aijian/desktop build`: exit 0 (`desktop-build.*`).

Each `*` above denotes separately retained stdout, stderr, and exit files. Web build reported a bundle-size advisory but completed. The earlier Web typecheck RED and the incremental-cache comparison remain in `../run-green-01`; their raw outputs were not replaced.

## Fingerprints and limit

`before.json` SHA256 `9BA422283C4100CF9E63CD3AC53FD3D69FD6F98546C2868537DFFB38D97ADDAE` and `after-desktop-build.json` SHA256 `981F660FD7BF4EC58731EE6883FE729DC10DF6AC382DA6AF13D52355E669B35D` cover all 69 source entries and dist. Source/status hashes did not change at any QA step. Before build the 76 dist hashes were unchanged. After Web→Desktop build dist still has 76 files: the old Web JS `index-BBBjpMyv.js` was replaced by `index-jctSZlRp.js` SHA256 `4E9CFD50458B3DFF42828322270D66500C1DB200604980C70C3B2889396CED11`, and Web `index.html` changed to SHA256 `54A11C1D1FED514C10CC902AEDC616D105A5CA2552B190EAEB26BAD42B845720`. Desktop `main.js` SHA256 `393763EC007D9AA20E2993A1D6FB39CEB804C4482F49D1BDAC2959AF491AEE65` and `preload.js` SHA256 `23B69A7843B56496F4D19C1A3437563837618A1AAA0A6E55D7518A474E9DF163` remained byte-identical after rebuild.

This is targeted component and type/build QA. No Electron, provider, network, installation, or native acceptance was run by QA03. c19 is ready for MGR02 to release to QA02's new native readback window.
