# AC05 Panel CONSUMED 自动只读回查：静态执行计划

日期：2026-09-28。状态：`STATIC_PREPARED_SYNCED_NOT_QA_RUN`。MGR04 已完成单文件保护同步；MGR02 要求 wrapper/收据先交静审。QA03 未占 c19、未运行组件测试或真实 provider。本计划只覆盖单文件 Panel 修复后的定向本地组件/adapter QA。

## 固定输入与目标

| 输入 | 固定身份 |
| --- | --- |
| QA01 真实 sidecar 竞态 HTTP 链 | `run-02-20260928/HTTP-CHAIN.run04-race.json` SHA256 `B8570FE14FCF774BAAB7688AF5E4887E5307102BD468AEB4E6DBFCC4078F1251`；隔离 TestClient、假 vault、mock transport，无真实 provider。包含 queue 201、原任务读回 200、approval POST 200/`CONSUMED`、proposal ready 200。测试脚本读入前重算 SHA，并核同项目、attempt fingerprint 及状态。 |
| 外置组件脚本 | `ac05-auto-read.panel.test.mjs` SHA256 `E34B497CAE2ABAF205A09555EF1D43605580CC0D67DDDB6ECEF0C795988CF11D`；备份 `ac05-auto-read.panel.v1.test.mjs` SHA256 `8C8EB66729FBCD403F68475C27953EA208340F7C3B948E3F866AFC04948CA898`；`node --check` exit 0，**未执行 Vitest**。 |
| 外置配置 | `vitest.config.mjs` SHA256 `6B6A4A923BC2FAE7ECA7835E7DE555F866CA443BB5ADFF76D3D6C045A0E5D9E9`；`@qa-web` 映射 c19 源。组件运行需 `--environment jsdom`，c19 `apps/studio-web/node_modules/jsdom` 已存在。 |
| 作者 Panel 修复 | MGR04 快照 `20260928-ac05-consumed-auto-read-panel-1/SNAPSHOT.json` SHA256 `B89B0274BFD4D271884C3931DE3CCE3A6571B7043104D605A168E2B1886EF919`；仅 `apps/studio-web/src/aivora/SourceExtractionPanel.tsx`，旧 c19 SHA `DB425445A677B49AC6B181CF6E8D92283A69A73C7287B9DF4C788B1D4DF17CF3` → 目标 SHA `61AFFCF1DEC5D555E6D94766DF68967196AFAC63277AA278BB45633089682A4B`。状态 `AUTHOR_FROZEN_NO_C19_SYNC_NO_QA`。 |
| MGR04 同步回执及 c19 静审指纹 | `20260928-ac05-consumed-auto-read-panel-c19-sync-1/SYNC-RECEIPT.json` SHA `F4A46BEC5919F1A4323715E636BC904878563053814395D46532A33A2CDE30C4`，状态 `SYNCED_NOT_QA_ACCEPTED`。QA03 再读 c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、status 110、Panel SHA `61AFFCF1…`；REL03 adapter `apps/studio-web/src/aivora/adapters/remoteSourceExtract.ts` SHA `69FAC685BC3667CF3D29BEC480458450B7C4C08F40767AB5616801CD59E5646B`；desktop `apps/desktop/src/api-client.ts` SHA `D694B1B1C6EF96D55DB941ABF221214634F45065DB07C99207A5C48660E7EA3C`；Web dist `apps/studio-web/dist/index.html` SHA `6D997E0C719E218B906ED733E39D7E3679272E034741D6033B6987EB1D2BDE62`。这些是静审读数，不代替开窗当时再核。 |

## 一次目标运行的验收与停止门

1. MGR04 单文件保护同步回执与 SHA 核完、MGR02 给独占窗口后，记录开窗时 HEAD/status、Panel/adapter/desktop/fixture/script/config 的 SHA、Web dist 入口 SHA 和相关进程。任何输入漂移先停，不能把不同候选混为一次验收。
2. 仅运行 `ac05-auto-read.panel.test.mjs` 的一次 Vitest 调用，指定上述真实 fixture 环境变量与 `jsdom`。脚本有 7 个有界 case：成功 `CONSUMED` 后原任务 GET 仅一次追加（含前置人工 GET 总数 2）、同 run 的 `PROPOSAL_READY` 引用与本地 `CONSUMED` 锁；自动 GET 的 `REMOTE_UNKNOWN`、`NOT_FOUND`、错 run、错 project scope 均保持锁且不声称提案；等待 GET 时 source context 或 project 改变丢弃迟到结果。所有 case 都断言许可 POST 恰一次、无许可 GET/重 POST；命令参数与真实 queue/approval operation identity 一致，GET 调用顺序为前置 GET → POST → 自动 GET。错 scope 是在真实回包副本上做定向错误注入，原 fixture 字节不改。
3. 保留完整命令、fixture/script/目标 SHA、原 stdout/stderr/exit、每个 case 结果、后验 HEAD/status/SHA 和进程。首个真实 RED 立即停止此候选的后续构建/原生推广，记录失败断言、源输入及最小复现，不将语法检查当组件 PASS。
4. 若 7/7 通过且输入未漂移，因 Panel 源码改变，再运行仅 Web 的 typecheck/build 并记录 exit、源/构建文件哈希；若 bridge、desktop 或 adapter 哈希也改变，重新界定受影响检查，不能套用此单文件窗口。REL03 既有 adapter/client 14/14 可按相同 SHA 与 fixture 复用，Panel 新行为须由本轮新测证明。Web 构建不算 Electron 原生验收；后续原生另排 QA02 窗口。

外置一次性 wrapper `run-ac05-panel-auto-read-once.ps1` SHA256 `481D816A25CCD33841A511576CE4BF6713E9D1645D44053DA452AB0419CF729A`；收据样本 `AC05-Panel-auto-read-RECEIPT-TEMPLATE.json` SHA256 `41087B796AB5809A81AB4F18B8E1E326CEFBE6B8E26FB4497ADA3B7015F762B0`，明确标记 `TEMPLATE_NOT_EXECUTED`。wrapper 的 PowerShell 解析 0 错，模板 JSON 可解析，**wrapper 未执行**。它接受固定同步回执路径及 QA03 外置目录下一个全新输出目录；核回执/目标 SHA/HEAD/status/dist/进程，写前后 `fingerprint.mjs`（SHA `CA29296D62768C363578F4263F3201878F944917DF376245D8BBCBE41622C0FD`），用 Vitest JSON reporter 强制确认为 7/7 后才跑 Web typecheck/build。每步由本 wrapper 创建并记录 PID，原始 stdout/stderr 通过二进制流分别落盘、记录 SHA/exit/timeout/cleanup；fingerprint 最长 60 秒、组件 600 秒、Web typecheck 600 秒、Web build 900 秒。超时时仅向本步创建的进程树发出终止请求，不搜索或终止其他 c19 进程；后验记录相关进程。首 RED 停后续构建；不自动重试。实际运行须等 MGR02 静审签署和独占窗口。
