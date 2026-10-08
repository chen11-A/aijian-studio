# AC05 Panel 自动回查：第二次单次窗口静态计划

日期：2026-09-28。状态：`AWAIT_MGR02_NEW_ONE_SHOT_APPROVAL_NO_RUN02`。本文件仅准备新的外置组件测试窗口，不修改 c19 产品源、不启动 Electron/provider，也不复用首轮批准。

## 首轮停止证据

首轮批准 SHA256 `368CB9A98EDCB33FC435E296F837B7F4E5F00F53E6CBDCE50A83612ABC605BE3` 已消费。原始 `ac05-panel-auto-read-once-01/RECEIPT.json` SHA `5E121F35132A7C25F3CF744230568108048CCB0AEF09D97BC7F80648A989DCBB`、Vitest JSON SHA `F6878BCEC524E80A923A942278E5E75BC7DC65BCB43CAB3B1F73D83F3C78297F`：收集阶段无法从外置测试文件解析 `@testing-library/react`，0 项测试执行，组件 PID 20984/exit 1。stdout SHA `DE8278AD4A981CD4AA8A5159D583AC5353ED4DA9C346D666C97EA087F4CF2DD0`，stderr 为空 SHA `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`。后验 HEAD/status/Panel/adapter/desktop 未漂移、相关进程 0；未进行 typecheck/build。首轮独立说明在 `ac05-panel-auto-read-once-01/RESULT.md` SHA `2B7948D4B7BA11C4D02BF3B481B1E40D3B83CCDCB8C30E4841BC6712CF645CD4`。这是测试环境解析失败，不是 Panel 行为结论。

## 本轮只修外置解析

- 首轮 `vitest.config.mjs` SHA `6B6A4A923BC2FAE7ECA7835E7DE555F866CA443BB5ADFF76D3D6C045A0E5D9E9` 保存在 `vitest.config.run01.mjs`。新 config SHA `C4C97E49A50810A210BC41E74CE3F63C87EB7A0889941A1B9C48FC6063853DDF`：把测试文件直接使用的 `react`、`react-dom`、`@testing-library/react`、`vitest` 固定映射至 c19 `apps/studio-web/node_modules`；原 `@qa-web`、`@qa-desktop` 源别名不变。外置 `node_modules` 仅有 Vite 缓存，而上述四包在 c19 Web 安装依赖目录均存在。脚本裸依赖已逐行核对，余下为 `node:crypto`、`node:fs` 和原 QA 别名；`node --check vitest.config.mjs` exit 0。未执行 Vite/Vitest 解析 smoke。
- `ac05-auto-read.panel.test.mjs` SHA `E34B497CAE2ABAF205A09555EF1D43605580CC0D67DDDB6ECEF0C795988CF11D` 与 QA01 race fixture SHA `B8570FE14FCF774BAAB7688AF5E4887E5307102BD468AEB4E6DBFCC4078F1251` 均不变。七个 case 和真实 queue/approval operation id 校验不变。Panel 已保护同步：`SYNC-RECEIPT.json` SHA `F4A46BEC5919F1A4323715E636BC904878563053814395D46532A33A2CDE30C4`，目标 Panel SHA `61AFFCF1DEC5D555E6D94766DF68967196AFAC63277AA278BB45633089682A4B`；adapter `69FAC685…`、desktop `D694B1B1…`、Web dist HTML `6D997E0C…`。
- 首轮 wrapper SHA `481D816A25CCD33841A511576CE4BF6713E9D1645D44053DA452AB0419CF729A` 保存在 `run-ac05-panel-auto-read-once.run01.ps1`。新 wrapper `run-ac05-panel-auto-read-once.ps1` SHA `8179CFDD7D13CE18883AE1637190BB64758461DF44679B97BF1F0FCA7C2FAC5E` 仅更新所钉 config SHA；PowerShell Parser 0 错。它仍以二进制流分别保存原 stdout/stderr，设 fingerprint 60 秒、Vitest 600 秒、Web typecheck 600 秒、Web build 900 秒上限，只向本步创建的进程树发终止请求，记录 PID/exit/timeout/cleanup。

## 新批准及执行门

1. 等 MGR02 对本计划、config、wrapper、测试/fixture、同步回执、目标指纹和拟用空目录 `ac05-panel-auto-read-once-02` 签新的 `maxRuns=1` 准入；首轮 `ac05-panel-auto-read-once-01` 不覆盖、不作为重试目录。
2. 独占窗口内一次运行 wrapper。preflight 核同步回执 SHA、c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2` / status 与回执一致、Panel/adapter/desktop/Web dist、测试/fixture/config/fingerprint helper SHA、相关进程 0。任何漂移先停。
3. 先留 before source/dist 指纹，再执行一次目标 Vitest JSON reporter。仅 JSON 精确 7 total/7 passed/0 failed/0 pending 且 exit 0、after-component 源与 dist SHA 未漂移才进入 Web typecheck/build。收集期再次失败仍记 `HARNESS_RED`、保原 raw，停止构建，不重复调用。Panel 断言失败记 `PRODUCT_OR_FIXTURE_RED` 待独立分类，同样停门。
4. 仅 7/7 GREEN 后运行 Web typecheck/build，留每步原 stdout/stderr SHA、PID/exit/timeout/cleanup、before/after source/dist 指纹和最终 `RECEIPT.json`。此处不代签 Electron 原生、真实 provider、费用或整体产品验收。

本计划和新封套是静态交审材料。**第二次运行尚未获批或执行。**
