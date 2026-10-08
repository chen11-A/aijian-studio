# QA03 REAL-TEXT01 desktop / H87 定向合同门

日期：2026-09-24。范围：固定 c19 候选的 desktop 受限桥、H87 adapter/组件与本地 Sidecar 回执兼容。测试与证据均放在本目录；未改产品或 QA02/QA01 文件，未启动 Electron 或远程 Provider。

## 固定输入与运行边界

- 九文件冻结快照：`C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-real-text01-desktop-h87-9\SNAPSHOT.json`，SHA-256 `3BBC49183B73D8D3D75B1CC23F34403A50EC7A4ECD1CA62B2BF8F590612FDCCC`。
- desktop 合同单文件修复快照：`C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260924-real-text01-desktop-contract-fix-1\SNAPSHOT.json`，SHA-256 `E559CA3A634CAEF54856439FFED3E21CE9BE4BAB17EA9636084B65D197D5588F`；最终合同 SHA-256 `EF475ED326B93E52FD93EEDC5B4B759EC74211425AB29CAA04D7AAD1140FFC30`。
- c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`；检查前后 Git status 41 路径且没有新增未知路径。构建前 73 个 dist 文件，构建后 75 个；九源文件不漂移，后置指纹在 `final-fingerprint.json`。

## 针对性测试入口与断言

| 层 | 外置测试与主要断言 |
| --- | --- |
| desktop 合同/API/IPC | `desktop-contract.test.mjs`：remote `writer.source-analyst` / `source.extract` 1.1.0 命令及 selection 严格校验；本地 1.0 命令/回执不能混入；主帧身份和非法参数在 client 前被拒；丢失创建响应归 `REMOTE_UNKNOWN`，一次调用的原 operation/idempotency key 不变；真实本地 queue-only 201 回执通过校验。 |
| SourceExtraction 权威读回 | 同测试以 QA01 已验证的本地 accepted-draft 路径生成隔离临时 DB 回执；latest 和 exact GET、ETag、project/version/proposal/producer 一致；跨项目回包或错误 ETag 归 `REMOTE_UNKNOWN`。此 fixture 仅运行本地 Fake/Sidecar，不调用 Provider，也未重跑后端 13+2 套件。 |
| H87 adapter | `h87-adapter.test.mjs`：storage 写/读回失败时零 POST；UNKNOWN 的旧 operation 保持锁定，第二次 queue 不重复 POST；人工 accept 先持久化原 proposal/run 的 UNKNOWN 意图，成功时记录 draft version，再次 accept 只 TRACKED。 |
| H87 组件 | `h87-panel.test.mjs`：切项目后旧异步 queue 回包不可污染新页；人工 accept 后调用 exact `getSourceExtractionVersion(project, draftVersion)`，只展示 project/proposal/producer/hash/source dependency 匹配的草稿，错误 producer 被丢弃。 |

执行命令：从固定 c19 的 `apps/studio-web` 运行其 `node_modules/.bin/vitest.cmd run --config <本目录>/vitest.config.mjs`；从 c19 根运行 `pnpm --filter @aijian/studio-web typecheck/build`、`pnpm --filter @aijian/desktop typecheck/build`。外置 Vitest 配置直接读取 c19 源码，不复制或覆盖产品测试。正式运行前仍须核冻结快照和无并发占用。

## 本次结果与失败保留

- 原九文件态：测试 `run03` 7 过 1 RED，真实 Sidecar queue-only 201 的 context role/skill 为 1.1.0，旧 desktop validator 固定要求 1.0.0。`fixture02.stdout.json`、`run03.stdout.txt/.stderr.txt/.exit.txt` 原样保留。DEV07 单文件修复、MGR04 再冻结后，`fix-retest01` 真实 fixture 定向 1/1 GREEN。
- 最终固定态：外置 `full03` 13/13、exit 0；desktop/web typecheck 各 exit 0；web→desktop 顺序 build 各 exit 0。构建后 75 个 dist 文件清单、九源 SHA、HEAD/status 保存在 `post-build.json` 与 `final-fingerprint.json`；后两次指纹相等，无 c19 相关 Node/Electron/Python/pytest/pnpm 进程。
- QA 工具错误单列：`run01` 同步 IPC 抛错被误写为异步断言，修正后 `run02` 7/7；`fixture01` 仅因 Windows 临时 DB 句柄清理 exit 1，回执已写但不用于签收；`accepted01` 经过 PowerShell 重定向的中文 JSON 乱码使 `full02` 12 过 1 假 RED。改由 Python 直接写 UTF-8 `accepted02.json`，哈希与实际正文相符，`full03` 13/13。上述原始 stdout/stderr/exit 均保留，不覆盖。

## 页面原生 UI 验收另门

此处仅证明固定源码的定向合同、adapter、jsdom 组件和构建。后续 H87 原生验收须使用经理签署的候选、受控 profile/workspace 与真实已接受 SourceManifest，在同一页核连接/模型/块选择、仅入队提示、原 run 查询、提案与人工接纳、exact 草稿读回、切项目和正常关闭；保留 PID、locator、UI 截图、原始 GET/回执和候选前后哈希。远程 Provider 调用、费用/结算与最终媒体能力各有独立门，本次均无实证。
