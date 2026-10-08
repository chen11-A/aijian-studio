# AC05 Panel 单次组件 QA：收集阶段 RED

日期：2026-09-28。MGR02 单次批准 `AC05-PANEL-ONE-SHOT-APPROVAL.json` SHA256 `368CB9A98EDCB33FC435E296F837B7F4E5F00F53E6CBDCE50A83612ABC605BE3`。仅调用固定 wrapper 一次；无重试、无 Web typecheck/build、无 Electron/provider。

- 实际 `RECEIPT.json` SHA256 `5E121F35132A7C25F3CF744230568108048CCB0AEF09D97BC7F80648A989DCBB`；state `COMPONENT_RED`，wrapper exit `1`。组件 PID `20984`，exit `1`，未超时，清理状态 `NOT_REQUIRED`。
- Vitest 原始 JSON `component.vitest.json` SHA256 `F6878BCEC524E80A923A942278E5E75BC7DC65BCB43CAB3B1F73D83F3C78297F`：`numTotalTests=0`、`numPassedTests=0`、`numFailedTests=0`，文件收集失败：`Failed to resolve import "@testing-library/react" from .../ac05-auto-read.panel.test.mjs`。组件断言没有执行；不能由此判断 Panel 修复成功或失败。
- 原 `component.stdout.raw` SHA256 `DE8278AD4A981CD4AA8A5159D583AC5353ED4DA9C346D666C97EA087F4CF2DD0`；`component.stderr.raw` 为空，SHA256 `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`。wrapper 没有覆盖或合并二进制原流。
- `before.json` SHA256 `F9C111518FBD61FA6E7A7B167F4F99D061EBF53C2812342674668F4A0D266BDE`；`after-component.json` SHA256 `11139D900C7DCCE65DB6A96DCF03ED7D0929747384474D818A5E5825CC080571`。wrapper 按路径/字节/SHA 比较 source/dist 未发现漂移；后验 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、status `110`、相关进程 `0`，Panel `61AFFCF1…`、adapter `69FAC685…`、desktop `D694B1B1…`。
- 只读定位：外置 QA03 `node_modules` 仅见 `.vite`、`.vite-temp`，没有 `@testing-library/react`；c19 `apps/studio-web/node_modules/@testing-library/react`、`react`、`react-dom`、`jsdom` 均存在。结合 Vitest 的原错误，需先静态修正外置测试模块解析并重新冻结脚本/配置；本单次批准已用，任何新运行均须另行开窗。
