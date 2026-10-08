# Phase 0 Fake Provider 与故障注入规格

状态：实施中（F06）

## 目标

为本地任务执行与后续远程 Provider 协议提供可重复、可审计的故障测试基础设施。测试必须能够证明：进程崩溃不会把“远程已接受但本地未知”误判为“未提交”，同一幂等请求不会生成两个 Provider Job。

## 本阶段范围

- 一个仅供开发和测试使用的 Fake Provider；它在独立子进程中运行，不监听 TCP/HTTP 端口。
- Provider Job 使用独立 SQLite 文件持久化；重启 Fake Provider 后状态仍可查询。
- `submit` 接受 `idempotency_key`、`request_hash`：
  - 首次请求创建一个 Job；
  - 相同 key 与相同 hash 返回同一个 Job；
  - 相同 key 与不同 hash 明确拒绝。
- `query` 按 Job ID 返回已持久化状态。
- 可复现的错误/崩溃注入：
  - `before_persist_error`：写入前返回受控错误；
  - `before_persist_crash`：写入前子进程退出；
  - `after_persist_crash`：提交事务完成、响应写回前子进程退出。
- 父进程主管理启动、请求、崩溃识别、重启和幂等重试；关闭时不遗留子进程。
- 固定种子把 `(seed, checkpoint, occurrence)` 映射为稳定决策，供后续 Q03 复用。

## 明确不在本阶段

- 不调用 OpenAI、xAI 或任何付费/外部 API。
- 不实现 F07 的预算预留、远程对账业务状态机或真实 Provider Adapter。
- 不宣称 Q03 完成。Q03 仍需把注入器接到六个生产边界，并对每个边界运行至少 100 个确定性种子。
- 不开放网络端口，不把 Fake Provider 暴露给最终用户。

## 协议与安全约束

- 父子进程通过逐行 JSON 的 stdin/stdout 通信；stderr 仅用于诊断。
- 请求与响应都带单调递增的本地 request ID；未知字段、未知操作和超过 16 KiB 的消息在有界读取阶段拒绝。
- 幂等键、hash 和 Job ID 使用受限字符与长度；数据库路径由父进程以绝对路径传入。
- 数据库必须位于调用方显式提供的 trusted root 内；父子进程都拒绝相对、UNC、映射网络盘、保留设备名、ADS 和经过 symlink/junction 重解析的路径。
- 子进程命令由固定的 Python 可执行文件和仓库内模块构造，不接受 shell 字符串。
- 不记录凭据、Cookie、授权头或正文，只保存哈希和 Fake Job 元数据。
- 子进程异常退出时，父进程返回明确的 `FakeProviderProcessCrashed`，不得把 EOF 当作成功。
- 损坏、不兼容或被锁定的 SQLite 返回不泄露路径/SQL 的 `STORAGE_UNAVAILABLE`；现有表结构必须与 v1 精确匹配。

## 验收

1. 首次提交和重复提交返回同一 Job ID，数据库中只有一行。
2. 同一幂等键配不同请求 hash 被拒绝，原记录不变。
3. 写入前错误/崩溃后数据库无 Job；主管理可重启。
4. 写入后崩溃时调用端收到“不确定”错误；重启并重试后返回原 Job，数据库仍只有一行。
5. query 在重启后仍返回相同 Job 状态。
6. 相同种子产生相同注入决策，不同 occurrence 可稳定区分。
7. 测试结束后子进程已退出；全量 lint、mypy、Python/TypeScript 测试、build 与证据校验通过。

## Q03 接续契约

后续 Q03 必须复用本规格的确定性种子与崩溃分类，绑定以下六个生产边界：领取 Node 后、远程提交前、远程已接受但本地持久化前、Artifact 写入前、媒体 atomic rename 前、ReleaseManifest 写入中。每个边界至少 100 个种子，并验证 60 秒内可解释恢复、Artifact hash 不变、未知远程任务不自动重提。
