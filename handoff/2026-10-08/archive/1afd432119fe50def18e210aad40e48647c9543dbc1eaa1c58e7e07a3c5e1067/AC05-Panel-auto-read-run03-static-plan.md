# AC05 Panel 自动回查：第三次单次窗口静态计划

日期：2026-09-28。状态：`AWAIT_MGR02_NEW_ONE_SHOT_APPROVAL_NO_RUN03`。只修改 QA03 外置测试脚本与其 wrapper 钉住的 SHA；c19 产品源、真实 fixture、外置模块解析配置不改，不启动 Electron/provider。

## 已消费的两次窗口与本轮修正范围

- run01 批准 SHA `368CB9A98EDCB33FC435E296F837B7F4E5F00F53E6CBDCE50A83612ABC605BE3`；原收据 SHA `5E121F35132A7C25F3CF744230568108048CCB0AEF09D97BC7F80648A989DCBB`：外置包解析失败，0 tests，无 Panel 行为结论。原证据保存在 `ac05-panel-auto-read-once-01/`。
- run02 批准 SHA `9149B7B330E0059107A78499ECEC7EA44F200A17198E806EEE25F889153D94A3`；原收据 `ac05-panel-auto-read-once-02/RECEIPT.json` SHA `8BBAD3FD392D1BD85A97B8F1858C54207796C03C96809AB217B61299C05EC6FD`，Vitest JSON SHA `1C9F192E539696406948AE1CA2F9A8111E4B83294D9557F4CD1DEDE8BDA0C1DE`：7 total/2 pass/5 fail，exit 1，停止后续构建。`run02/RESULT.md` SHA `335113C9420981796E5D11F4C040BEAF2C3514FACD79891B636F5BF91D7311E8` 分类：2 项迟到来源/项目回包丢弃通过；5 项因外置 bridge 缺提案读取能力、失败态按钮被 Panel 正常隐藏而测试要求可见，属测试预期/模拟能力不符，不能据此宣称 Panel 整体 PASS 或产品缺陷。原 raw/指纹保留，不覆盖。
- `ac05-auto-read.panel.run02.test.mjs` 保留旧脚本 SHA `E34B497CAE2ABAF205A09555EF1D43605580CC0D67DDDB6ECEF0C795988CF11D`。新外置脚本 `ac05-auto-read.panel.test.mjs` SHA `B404633F4F30E7C313AFD32B2F5C5C99F76F12F9D0D1ED29F0167C00B6210140`：只给 bridge 增加不可实际调用的 `readVersionedSourceExtractionProposal` 能力 stub，并断言调用数 0；四个异常场景改核授权按钮不存在、本地 `CONSUMED` journal 仍含同一 approval ID、提案按钮禁用、无 proposal claim。原一次许可 POST、前置 GET + 自动 GET 总 2、无许可 GET、调用顺序、同 project/run/fingerprint、来源/项目切换迟到丢弃等断言不减。`node --check` exit 0，**未执行 Vitest**。

## 固定输入与执行门

| 输入 | SHA256 / 状态 |
| --- | --- |
| QA01 真实 POST 200/`CONSUMED` 竞态 fixture `run-02-20260928/HTTP-CHAIN.run04-race.json` | `B8570FE14FCF774BAAB7688AF5E4887E5307102BD468AEB4E6DBFCC4078F1251`；隔离 TestClient/假 vault/mock transport，无真实 provider。 |
| MGR04 Panel 单文件 c19 同步回执 | `F4A46BEC5919F1A4323715E636BC904878563053814395D46532A33A2CDE30C4`，状态 `SYNCED_NOT_QA_ACCEPTED`；Panel SHA `61AFFCF1DEC5D555E6D94766DF68967196AFAC63277AA278BB45633089682A4B`。 |
| c19 REL03 adapter、Desktop client、旧 Web dist HTML | `69FAC685BC3667CF3D29BEC480458450B7C4C08F40767AB5616801CD59E5646B`、`D694B1B1C6EF96D55DB941ABF221214634F45065DB07C99207A5C48660E7EA3C`、`6D997E0C719E218B906ED733E39D7E3679272E034741D6033B6987EB1D2BDE62`。 |
| 外置 `vitest.config.mjs`、`fingerprint.mjs` | `C4C97E49A50810A210BC41E74CE3F63C87EB7A0889941A1B9C48FC6063853DDF`、`CA29296D62768C363578F4263F3201878F944917DF376245D8BBCBE41622C0FD`；config `node --check` exit 0。 |
| 一次性 wrapper | `run-ac05-panel-auto-read-once.ps1` SHA `5CBF57311C80B5A932A3A9E06C1F18437DDFCB6559765460965B1BD5F91A9A8E`；run02 原 wrapper SHA `8179CFDD7D13CE18883AE1637190BB64758461DF44679B97BF1F0FCA7C2FAC5E` 保存在 `.run02.ps1`。新 wrapper 只改钉住的新测试 SHA；PowerShell Parser 0 错。 |

新拟输出目录 `ac05-panel-auto-read-once-03` 当前不存在。MGR02 先审本计划、非批准封套及固定哈希，再另签 `maxRuns=1`。获新独占窗口后才调用 wrapper 一次；preflight 须核同步回执/HEAD/status/Panel/adapter/desktop/dist/fixture/test/config/fingerprint 与相关进程。wrapper 二进制保存各步骤 stdout/stderr、PID/exit/timeout/cleanup，before 与 after-component 源/dist 按路径、字节、SHA 比较。组件 Vitest JSON 必须精确 7 total/7 passed/0 failed/0 pending 且 exit 0，才运行 Web typecheck/build；任一 RED 保留原 raw 并停后续，不自动重试。Web 构建不代签原生或真实 provider。

本计划为**静态交审材料，run03 尚未批准或执行**。
