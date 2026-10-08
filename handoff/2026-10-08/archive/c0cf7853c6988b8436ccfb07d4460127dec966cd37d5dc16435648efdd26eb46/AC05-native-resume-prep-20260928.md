# AC05 原生复验准备清单（QA02，2026-09-28）

状态：**只读准备，未启动 Electron/sidecar，未生成可执行计划或新 profile。** 等 QA03 完成合法 201 入队与许可响应的前桌端正向 fixture、释放 c19 测试窗口并交付新的完整 source/dist SHA 后，再由 MGR02 核冻结输入和运行范围。旧 PROJECT 服务配置 smoke 的 PASS 不能代替 AC05。

## 现场与文件所有者

- 独立 QA 候选：`C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`。本次只读核到 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`、Git status 87 项、两处 dist 共 78 文件、c19 可执行进程 0。Web HTML SHA256 `97B5FA2976B03160D64E63F4AE7484C604286C6BDD35CF19799E95B1DFC7999F`，Desktop main SHA256 `A9467489147DEB47E88D8BEBB0172FE0482933E0AE33296721CEA32552BC2058`，preload SHA256 `B1D5A4F2C4E1552380889CEA1B5EFC1DA0D4F450344C20D23FE87A63ACA708E3`。这些是停工时的 AC05 构建指纹，QA03 今天可能重建，不能直接运行。
- 产品源码、构建及 c19 同步归 MGR04/开发文件 owner；当前定向测试窗口归 QA03。QA02 不写 c19 源码、dist 或旧 profile；仅在外置 `work\native-source-qa-20260924` 的新文件准备 runner/计划/证据。共享文件变更须先经 MGR02 协调。
- QA03 停工报告：`work\qa03-ac05-front-20260924\run-01\RESULT.md`，记录当时 90 个源文件指纹稳定、dist 76→78、8/8 与强制类型检查/构建 exit 0，同时明确缺正向 201/许可 fixture。今天补测后的报告及 SHA 才能成为新原生计划输入。
- 旧 `native-project-services-once.mjs` 是 PROJECT 服务配置 smoke，不是 AC05 runner。它的 Win32 HWND owner→Electron main PID→Playwright launcher 祖先链、独立 profile、截图/DOM/console、正常关闭、进程/锁后验可以复用到外置新 runner，须重新审查当日脚本、helper 与已安装 Playwright/Electron 的 SHA 和路径。禁止拿旧审批/计划启动。

## 无外呼可执行部分

1. 用 QA03 今日最终 source/dist 清单逐项核 SHA/字节、HEAD/status；新 runId 绑定严格 `c19\.aijian-dev\<runId>` profile 和 c19 外证据目录，二者运行前均不存在。MGR02 确认 QA03 释放独占窗口后才启动。
2. 只用真实 Electron 窗口的 Playwright `Page` locator；每次动作前核唯一 BrowserWindow/webContents、Win32 HWND owner、c19 Electron 实体路径及到 Playwright launcher 的进程链。保存导航后的截图、DOM 标题、renderer/main console 和错误，记录 sidecar PID/启动状态；不用全局鼠标键盘或旧 dist。
3. 在隔离 profile 创建一个 QA 合成项目与短的虚构来源文本，走本地来源导入、审核、确认基线，精确读回项目 ID、来源版本、内容哈希和已接受清单。只输入合成内容，不使用用户正文、私有媒体或真实业务 key。
4. 在 AI 服务页仅保存假 `https://qa-native-ac05.invalid` Sub2API origin、假 key 与 TEXT 模型，核连接版本与本地凭据状态；不做连接探测或模型请求。
5. 故事页 `真实远程来源抽取` 选择 Sub2API、当前已接受来源块、连接和 TEXT 模型；最多执行一次 `仅入队原来源抽取`。保存 201/幂等回执、冻结范围、task/attempt/run ID 与 UNKNOWN 费用显示。只用 `查询原 run` 做只读核对；**不勾选未知费用许可，不点击“明确授权一次 Sub2API 调用”**。若排队结果 UNKNOWN，保持原操作锁，不重发 POST。
6. 正常关闭并核 c19 相关进程为零、profile 锁可独占读；同一隔离 profile 重开，核项目/来源/连接及本地排队 journal 和服务端待许可任务一致。最后再次正常关闭，用只读 SQLite 检查项目、来源、任务/尝试、连接、`sub2api_call_approvals` 与 `sub2api_call_consumptions` 均无许可/消耗，且没有提案冒充成功；记录 DB SHA、FK/完整性结果、前后源/dist SHA 与原始 stdout/stderr/exit。

## 关键安全边界与未验收项

`SourceExtractionPanel.tsx` 第 185–220 行将 Sub2API 入队与许可分开，并显示“尚无单次调用许可”；第 464–505 行的许可按钮要求显式接受 UNKNOWN 费用。`sub2api_source_extract_routes.py` 的入队 POST 返回 201，不发供应商请求；sidecar 在 `sidecar.py` 中启动实际 `Sub2APISourceExtractRuntime`，它在 `sub2api_source_extract_runtime.py` 只从 `next_ready` 已许可任务中取数，之后会调用真实 `Sub2APITextTransport`。因此仅入队/查询可作为无外呼本地原生证据；**许可按钮不可作为无外呼测试动作**。若代码、运行时或新构建改变这些门槛，先停止并重新评估。

当前无外呼范围**不能**产生真实 Sub2API 提案、人工接纳或草稿重开读回，也不能签署 AC05 完整场景。QA01 的模拟 transport 后端 12/12、QA03 的客户端/IPC/契约本地测试和本次原生入队证据必须分项报告。真实 provider 调用、未知费用许可、任何用户正文上传与新服务安装仍需具体输入、费用和外部条件授权；取得授权后再冻结独立运行计划，不在本轮 profile 上偷偷续跑。

`.invalid` 只是合成 origin 标识，**不是网络阻断保证**；无外呼依赖于新 profile 中没有许可、测试绝不提交许可，以及 worker 的许可前门槛。不得为补齐 AC05 把产品默认 transport 偷换成 mock、注入假成功或点击可能触发派发的动作。取消动作也须先静态确认不会误派发，否则不纳入本轮。

## 停止条件与第一份运行交付

任一文件/审批 SHA、工作树状态、窗口或 sidecar owner、来源身份、连接/模型修订、响应结构、幂等状态不匹配即停止；保留原始失败，不改断言重跑同一 profile。非 loopback renderer 请求拦截并记录；本地 sidecar 对外行为由“不发许可”门槛保证，执行后只读核没有许可/消耗。运行结果必须附精确构建清单 SHA、plan/runner/helper/approval SHA、新 profile/PID/HWND、每个可见 UI 动作、IPC/sidecar 与 SQLite 读回、两次正常 close 及原始 stdout/stderr/exit。MGR02 再决定是否可进入后续许可门。
