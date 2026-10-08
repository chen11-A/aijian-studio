# QA01｜真实 AI 文本来源抽取最小独立验证矩阵

日期：2026-09-24。只读基线：c19 工作树 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`，含当时未提交改动。源码定位均相对此工作树：`C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923`。本文件仅是验证方案；未运行产品、测试、网关、Provider 或 FFmpeg，未改 c19 和既有 M2 raw。

## 当前接线判定与进入条件

1. `gateway_transport.py:14-16,106-196,232-315` 固定本机 `127.0.0.1:8317/v1/chat/completions`，单次非流式文本 POST；`remote_source_extract_worker.py:1-6,145-160,190-368` 定义一次性 worker，但文件明示应用尚未接入。
2. `proposal_run_routes.py:75-82,147-200` 的远程创建路由由 `remote_source_extract_enabled` 控制且默认 false；当前 `main.py:1043-1050` 调用未传 true。`proposal_run_factory.py:55-73` 的远程方法只入队，不授权也不派发。
3. 桌面 `api-client.ts:2333-2338` 只 POST 普通 `/proposal-runs`，`preload.ts:225` 只映射普通创建；Web `api/studio.ts:252-253,687-688` 只映射普通能力。在 `apps/studio-web/src/aivora` 的当前页面代码中未找到远程抽取提交或对应提案卡接线。普通 Fake 提案或本地“变更提案”不能算本链验收。
4. `remote_settlement_contracts.py:89-102` 默认结算验证拒绝；`remote_execution_authorization.py:178-198,584-658` 使用此默认值。即使本机文本网关返回 `response_id`，没有独立可信结算来源和验证根也不能形成待审候选。

因此当前只具备离线合同级方案的入口；原生同 UI 和真实付费端到端应等上述接线、可观察读回、可信授权及结算实现经独立审查后再执行。每次执行前重新固定 Git HEAD、未提交差异清单、产品构建 SHA、隔离 profile 与测试数据哈希。

## 最小矩阵

| 编号 / 级别 | 独立验证动作与失败注入 | 必须留存的判定证据 | 能证明的范围 / 停止条件 |
| --- | --- | --- | --- |
| C1 离线合同 | 以本机受控假响应代替真实网关，核对固定地址、POST、Authorization、模型、非流式消息和正文片段边界；注入连接前失败、429、302、畸形/超限响应、发送后断连及超时。 | 捕获的单次请求次数、脱敏请求体哈希、结果枚举及错误码；凭据不进日志。 | 证明序列化与错误分类、没有自动重发/重定向；不证明真实账号、模型可用、质量或费用。定位：`gateway_transport.py:106-196,232-315`；现有静态用例：`tests/test_gateway_transport.py:85-276`。 |
| C2 离线合同 | 对远程创建请求做 exact source version/document/block/byte bounds 与 connection ID/revision/model 校验；同键同输入重放、同键异输入冲突、入队中断恢复；核对冻结 manifest/content/input/context 哈希、稳定 run/task/attempt ID，max_attempts=1。 | 原始请求、Idempotency-Key 哈希、201/200/409、持久 intent/dispatch snapshot 与表读回；逐字段对应，不靠 UI 截图推断。 | 证明“创建并冻结任务意图”，不证明派发。定位：`contracts.py:148-178`、`proposal_run_routes.py:147-200`、`source_extract_run_factory.py:445-505,508-535,680-743`。当前生产路由关闭，合同测须用隔离测试组装。 |
| C3 离线合同 | 伪造或缺失授权证据、变更输入/来源/连接/模型/预算、过期/撤销、重复 CONSUME；精确 grant 和来源才允许从 RUNNING 经 SUBMIT_INTENT 到 SUBMITTING。 | 授权快照、evidence/核心哈希、consume revision、lease generation、工作流事件、零派发计数。 | 证明默认拒绝、事务栅栏和持久化先于调用；SUBMITTING 本身不证明远端收到。定位：`remote_execution_authorization.py:215-249,276-360`、`remote_execution_evidence_verifier.py`、`tests/test_remote_execution_authorization.py:551-905`。 |
| C4 离线合同 | 有效网关 JSON 需匹配所选 model 与唯一 choice/response_id；摘要仅接受单键 summary。结算回执分别注入错 attempt、authorization、consume revision、lease、evidence hash、response_id、connection、model、scope、currency、金额或签名；缺失/超时按 UNKNOWN。 | 网关原始脱敏响应及 response_id，回执 payload/hash/验签判定，候选/提案/claim ID、source span/quote/payload 哈希，USD actual_micros，数据库读回。 | 只有可信授权 + 独立可信结算 + 同一 response_id 才允许 NEEDS_REVIEW；默认 verifier 必须拒绝。定位：`remote_source_extract_worker.py:242-354,423-505`、`remote_settlement_contracts.py:13-102`、`remote_execution_authorization.py:584-823`。 |
| C5 离线合同 | 在入队持久化、CONSUME 前、SUBMITTING 后、发送后响应前、收到 response_id 后及候选事务中断处注入崩溃/重启；检查任务租约到期恢复、UNKNOWN 和错误回执。 | 重启前后 SQLite workflow_attempts/task_ledger/node/events/authorization/settlement/proposal 逐项快照，同一 attempt 的派发计数。 | 明确未派发者才可安全重新入队；已 CONSUME 或无法判定者 REMOTE_UNKNOWN、RECONCILIATION_REQUIRED 且无自动重发、无凭空提案。定位：`task_ledger_recovery.py:130-160,238-294`、`remote_execution_authorization.py:1055-1139`；现有用例：`tests/test_remote_execution_authorization.py:1391-1530`。 |
| U1 原生同 UI | 在已接线的单一 H87 页面、隔离 Electron profile 和同一项目中，选择已接受来源的 exact span 和明确 CPA 文本模型，只点击一次；观察任务、NEEDS_REVIEW 提案卡及人工接受/拒绝动作；正常关闭重开后同页读回，不切至 API 直调代替。 | 构建 SHA/profile/PID、页面定位符、点击前后及重开后截图、IPC/Sidecar 请求与 GET 回执、数据库同一 IDs/hash/response_id/结算链接；逐项核对 UI 与权威数据。分别记录候选、人工决定、Draft 版本及 Head。 | 证明原生产品接线和用户可见恢复；仅在真实路由、worker、提案卡接通后可执行。当前缺口见上，不能用 Fake 或 DOM mock 代替。NEEDS_REVIEW 不等于 Draft，Draft 不等于已接受 Head。 |
| U2 原生同 UI | 注入 POST 回执丢失、API 4xx/5xx、网关发送后断线、结算缺失和进程异常；重开同一页面，确认错误/UNKNOWN 可见、保持原始 operation/attempt、仅只读查询和人工核对，无自动 POST。 | 前后抓取网络/IPC 次数、持久 operation journal、原始错误、任务状态和 UI 文案；不清理现场 raw。 | 证明原生界面错误呈现与恢复策略。现有 `proposal-run-operation-journal.ts:142` 与桌面 `proposal-run-contract.ts` 是普通 Fake 契约，不能直接沿用为远程付费证明。 |
| R1 单独审批后真实付费/正文上传 | 以经授权的真实正文片段、指定账号/网关/模型/连接 revision、成本上限和独立结算信任根，执行一次 one-shot；分别核对受限真实文本调用、可信结算、NEEDS_REVIEW 提案、人工决定及 Draft，错误即停止并隔离 UNKNOWN。 | 审批的 exact 正文范围/哈希、账户/模型/连接绑定、网关请求哈希、真实 response_id、提供方可核的结算 receipt/实际费用、持久化审计、同一 UI 读回；另列 Draft 与 Head 的版本 ID。 | 才能证明该账号、该模型、该正文范围的一次实际文本调用与结算；NEEDS_REVIEW 只表明待审，人工接受形成 Draft 仍非已接受 Head。response_id、登录/模型列表、离线 ALLOW、截图各自都不够。未经新的明确批准不执行。 |

## 执行顺序与验收

1. 先冻结 c19 改动基线与隔离数据，首项核对 `main.py` 的 router 注册及 `remote_source_extract_enabled` 是否实际开启，再核对 worker、UI、查询与结算信任根是否真的接线。任何缺口保持 U/R 为 BLOCKED，不绕过同 UI 条件。
2. C1→C2→C3→C4→C5，使用隔离 SQLite 和本机受控网关；保存原始失败输出及明确的请求计数。只针对改动或未覆盖风险补测；当前文件未执行任何新测试。
3. 接线经审后执行 U1→U2，原生同页面与持久读回一起验收。不可把“点击成功”视为已派发或已结算。
4. R1 需要另行批准正文外发和可能费用，批准对象必须是可审的 exact manifest/哈希与预算；出现 REMOTE_UNKNOWN 时停止自动动作，人工对账。

媒体能力单列 **UNKNOWN**：本矩阵只覆盖 `remote.source.extract` 文本。视频、图像、语音、动作、口型及 FFmpeg 均未验证；文本成功不能推导媒体生成能力。
