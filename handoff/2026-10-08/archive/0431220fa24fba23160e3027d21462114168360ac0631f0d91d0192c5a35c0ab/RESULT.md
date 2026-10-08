# Global pages without a project: baseline RED

- c19 HEAD: `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`.
- Current `apps/studio-web/src/aivora/DemoApp.tsx` SHA256: `8ED2682975EA9980561DF0EC55BF51CB7E1FF49CC0B98A6C6431B73C9BE559D8`.
- External real DemoApp test: `../global-navigation.test.mjs` SHA256 `8FC857211CB7409FE61D95F12B1D207329DB4FB5657660CC9D8762472CB0192B`.
- Command: external Vitest config against the real c19 DemoApp, no fixture project, `window.aijian.listProjects()` returning an empty authoritative list. No Electron, provider, network, build, or product edit.

`red.stdout.txt`, `red.stderr.txt`, `red.exit.txt` preserve the first run. Exit was 1; all three tests failed. The real navigation buttons changed `data-page` to `services`, `costs`, and `settings`, but the app rendered the project-empty panel in place of the actual page. The tests require the actual `AI 服务` heading and provider form, `用量` heading and ledger/budget controls, and `用户设置` heading and save control. This is a product RED, not a click/locator failure. The raw stdout/stderr SHA256 values are `28B0AFC6D89DE468C4608B35266524D2C10D7F47F4DB2B143090198E12EFD641` and `F627F7B182CE876BFACB9DAD70216B6978F8FCAD4C5211138581D28A58D296D7`.

`status-before.txt` and `status-after.txt` each contain 66 entries and compare with zero differences. The DemoApp source hash was unchanged after testing. Keep this baseline raw when the single-file patch is synchronized; rerun the same test, then run typecheck and Web→Desktop build only after the retest passes.
