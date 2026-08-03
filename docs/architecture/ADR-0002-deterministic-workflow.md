# ADR-0002：确定性产品工作流包围非确定性 Agent

- 状态：Accepted for Phase 0
- 日期：2026-08-03

## 背景

小说改编和影视创作需要模型的开放性，但任务状态、审批、预算、重试和下游失效必须可预测。把 Agent 框架或队列框架当业务真相会导致流程漂移、重复扣费、难以恢复和供应商锁定。

## 决定

建立自有、持久化、版本化的 DAG 状态机。节点通过输入/输出 Schema、确切 Artifact 版本、幂等键、重试类、预算预留和 Gate 执行。Agent 是一种 Node Executor，只能提交 ArtifactProposal；Schema/业务验证成功后先形成不可变 `ArtifactVersion(status=DRAFT)`。Gate 和批注引用确切 `version_id`；审批通过只追加 `ApprovalDecision` 并推进 `ArtifactHead.accepted_version_id`，不改版本内容。退回后的修订形成新版本。

远程提交先在事务内写 `SUBMIT_INTENT`、唯一请求指纹、本地幂等键和预算预留，再进入 `SUBMITTING`。只有供应商支持幂等键或按客户端请求 ID 查询时才自动恢复提交；否则响应丢失进入 `REMOTE_UNKNOWN/RECONCILIATION_REQUIRED`，禁止自动重提。

产品状态保存在核心数据库，队列只负责唤醒。桌面使用 SQLite Ledger/LocalExecutor，服务器可使用 Redis/Celery 或后续适配器。LangGraph/Temporal/Prefect/Dagster 可用于实验或执行适配，但不能成为项目文件的唯一可解释状态。

## 后果

- 优点：崩溃恢复、局部重做、人工审批、成本和审计可统一证明。
- 代价：需要自己实现一套有限状态机、租约、Outbox 和迁移。
- 边界：不追求通用低代码编排平台；工作流图由产品模板和版本管理，不允许模型任意改拓扑。

## 验证

W8 前完成故障注入：并发领取、提交前崩溃、远程已提交但 ID 未知、重复回调、取消后完成、Gate 退回和上游局部变更。无法解释的状态视为阻断。
