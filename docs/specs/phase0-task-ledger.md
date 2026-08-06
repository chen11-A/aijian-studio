# Phase 0 Task Ledger 与恢复契约

- 状态：F01/F02 已实现，F03 实现中
- 范围：本地 SQLite 任务真相、唯一领取、租约、崩溃恢复和远程未知保护
- 非目标：本阶段不实现 Redis、分布式调度、供应商 SDK 或完整 DAG 编辑器

## 真相边界

`WorkflowRun` 固定工作流定义版本和输入指纹；`NodeRun` 是用户可见的业务状态；每次真实执行形成独立 `TaskAttempt`；`TaskLedger` 只保存短时唤醒与租约。远程发送协议状态只能存在于 Attempt，不能混入 Node 的通用重试状态机。内存队列只负责唤醒，不是状态来源。Artifact 仍是不可变产物真相，任务成功不能改写已经提交的 ArtifactVersion。

同一数据库事务必须完成领取、尝试号递增、租约写入和 Attempt 创建。只有更新到一行的领取者可以启动执行器；任何“先读 PENDING、再写 RUNNING”的实现均不合格。

## 分层状态集合

```text
NodeRun:
BLOCKED / PENDING / RUNNING / RECONCILIATION_REQUIRED / NEEDS_REVIEW /
SUCCEEDED / FAILED / CANCEL_REQUESTED / CANCELLED / SUPERSEDED

TaskAttempt:
READY / LEASED / RUNNING / SUBMIT_INTENT / SUBMITTING / WAITING_REMOTE /
REMOTE_UNKNOWN / SUCCEEDED / FAILED / CANCEL_REQUESTED / CANCELLED / NOT_SUBMITTED
```

- Node 从 `PENDING -> RUNNING` 时绑定唯一 Attempt；Attempt 根据执行模式进入本地运行或远程提交路径。
- 远程 Attempt 必须先持久化 `SUBMIT_INTENT`，再持久化 `SUBMITTING/dispatch_started_at`，之后才允许发出网络请求。
- `WAITING_REMOTE` 必须已经持久化供应商任务 ID。
- 响应是否被供应商接受无法证明时，Attempt 进入 `REMOTE_UNKNOWN`，Node 投影为 `RECONCILIATION_REQUIRED`；二者都绝不自动回到提交或待运行状态。
- 供应商支持幂等键时，只能用同一 Attempt 和同一 key 恢复；只支持客户端请求 ID 查询时必须先查。只有权威确认未受理后，Attempt 才能成为 `NOT_SUBMITTED` 并允许另建 Attempt。
- `FAILED -> PENDING` 仅限持久化重试分类为 `SAFE_LOCAL_RETRY` 或 `PROVIDER_CONFIRMED_NOT_ACCEPTED`，且未耗尽最大尝试次数。
- Attempt 成功、Node 成功与 `output_version_id` 必须在同一事务提交，避免产物已存在却重复执行。
- `SUCCEEDED/CANCELLED/SUPERSEDED` 是 Node 终态；已成功 Node 只能因上游新版本被标为 `SUPERSEDED`，不能原地重做。

## 租约与时钟

- 租约保存 `lease_owner`、随机 `lease_token`、单调递增 `lease_generation`、`lease_expires_at` 和最后心跳，所有时间为 UTC。
- 领取使用数据库当前事务的统一时间值；调用者传入的测试时钟只能用于确定性测试。
- SQLite 领取在 `BEGIN IMMEDIATE` 内使用条件 `UPDATE ... RETURNING`；心跳、取消、输出和完成提交必须同时匹配 token、generation 与 revision，影响 0 行代表租约已丢失。
- 活跃租约不能被第二执行器领取。过期本地租约进入恢复检查：已有已提交输出则对账为成功；只有无已提交输出且重试安全时才重新排队。旧 worker 不能提交晚到结果。
- 远程提交相关状态的租约过期不会触发重新提交。缺少可查询的供应商 ID 时进入 `REMOTE_UNKNOWN`。

## 数据库不变量

- `UNIQUE(workflow_run_id, node_key)` 与 `UNIQUE(node_run_id, attempt_number)`。
- 供应商账户内 `provider_idempotency_key` 唯一。
- 每个 Node 同时最多一个阻断 Attempt；每个 Attempt/任务类型同时最多一个开放 Ledger 项。
- 所有状态变化使用 `expected_revision` 比较交换，并在同一事务追加不可变 transition event。
- `REMOTE_UNKNOWN` Attempt 存在时，数据库约束和 repository 都拒绝创建下一 Attempt。

## 六个故障点

| 故障点                                        | 重启后的可解释结果                                                  | 禁止行为                      |
| --------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| 领取事务提交前                                | 仍为 `PENDING`，无 Attempt                                          | 凭内存猜测已开始              |
| 领取已提交、执行器启动前                      | 租约到期后检查输出；安全时新建下一 Attempt                          | 两个执行器同时运行            |
| 本地临时输出完成、Artifact 提交前             | 丢弃未校验临时文件后安全重试                                        | 数据库引用临时文件            |
| `SUBMIT_INTENT/SUBMITTING` 已提交、网络响应前 | 幂等键可用时恢复同一 Attempt；只可查询时先查；否则 `REMOTE_UNKNOWN` | 新建 Attempt 盲目重新付费提交 |
| 供应商已接受、任务 ID 未落库                  | `REMOTE_UNKNOWN -> RECONCILIATION_REQUIRED`                         | 自动回到 `SUBMITTING`         |
| Artifact 已提交、成功状态提交前               | 按输出哈希对账为 `SUCCEEDED`                                        | 再次生成并覆盖产物            |

每个故障点最终必须满足：60 秒内显示可解释状态、已提交 Artifact hash 不变、`REMOTE_UNKNOWN` 自动重提次数为 0。

## UI 投影

任务队列默认展示制作步骤、输入 Artifact 版本、状态文案、执行位置、本次/最大尝试次数、成本、最近检查点与下一动作。技术状态与用户文案分开：例如 `RECONCILIATION_REQUIRED` 显示为“需要核对供应商任务”，并提供查看证据入口；不能只显示转圈动画。

## F01/F02 验收

1. Node 与 Attempt 状态集合及允许转换由纯领域模块分开定义，关键状态机 100% 行覆盖。
2. 本地与远程 Attempt 路径不同；远程协议状态不能走 Node 的通用重试捷径。
3. `WAITING_REMOTE` 缺少供应商任务 ID 时拒绝提交状态。
4. `REMOTE_UNKNOWN` 到任何可运行/提交状态的转换全部拒绝；只有带权威对账证据的状态转换开放。
5. F03 在 SQLite 上证明并发唯一领取和过期租约恢复，不用进程内互斥锁冒充数据库语义。

## 当前实现证据

- Schema v4 已建立 WorkflowDefinition/Run、NodeRun、Attempt、TaskLedger、transition event 与 remote reconciliation 表；Schema v5 增加项目级 `workflow_enqueue_keys`，同一幂等请求并发入队只返回一个 Run/Node，复用 key 但改变输入则拒绝。每一步迁移都通过故障注入回滚/重试测试。
- 两个独立 SQLite 连接并发领取同一任务时，只有一个 `BEGIN IMMEDIATE + UPDATE RETURNING` 事务成功。
- 心跳和启动提交校验 owner/token/generation/revision；旧 worker 与过期 lease 均被拒绝。
- 过期本地任务保留失败 Attempt，再创建新 Attempt/Task；尝试耗尽时 Node 明确失败。活跃租约和远程租约不会被本地恢复器重排。
- 输出 ArtifactVersion 的项目归属、Attempt/Node/Task 成功状态在同一事务校验并绑定；LocalExecutor 已完成单任务领取、启动、处理、完成以及 handler 崩溃后的租约恢复路径。
- 以上 Task Ledger、恢复、完成和 LocalExecutor 模块保持 100% 行/分支覆盖。
- F06 已增加独立子进程 Fake Provider：本地逐行 JSON 管道、SQLite 幂等 Job、提交前错误/崩溃、提交后回包前崩溃、重启查询与恰好一个 Job 证据；子进程使用最小环境变量白名单且不监听网络。
- 尚未完成：把注入器绑定到全部六个生产 kill 点并对每个点运行 100 个确定性种子；该项仍属于 Q03，不计入 F06 完成度。
