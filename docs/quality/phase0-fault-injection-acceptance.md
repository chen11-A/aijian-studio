# Phase 0 F06 故障注入验收

## 验收命令

```powershell
uv run pytest services/api/tests/test_fault_injection.py services/api/tests/test_fake_provider.py services/api/tests/test_fake_provider_worker.py services/api/tests/test_local_executor.py services/api/tests/test_task_ledger_recovery.py
uv run python scripts/fault_injection_evidence.py verify
```

CI 的双平台 `quality (ubuntu-latest/windows-latest)` job 中有独立 `Fault injection` step，避免仅在单一平台证明进程生命周期，同时复用仓库已有且受统一治理的 Action 引用。

## 已证明

- Fake Provider 在独立 Python 子进程中运行，父子进程只通过 stdin/stdout NDJSON 通信，不监听网络端口。
- Provider Job 独立持久化到 SQLite；重启后仍能 query。
- 相同 idempotency key 与 request hash 只生成一个 Job；改变 hash 明确冲突。
- 写入前错误不会落 Job，也不会杀死 Provider。
- 写入前崩溃由父进程明确识别；重启后可以安全提交。
- 写入后、回包前崩溃作为未知结果返回；重启后以同一幂等键重试得到原 Job，数据库只有一行。
- 子进程不继承 API Key 等任意环境变量，只接收运行所需的最小环境白名单。
- 数据库路径受调用方显式 trusted root 约束，并拒绝 UNC、映射网络盘、保留设备名、ADS、symlink/junction；协议双向有 16 KiB 有界读取和严格响应 Schema。
- 损坏、不兼容或被写锁占用的 SQLite 映射为稳定的 `STORAGE_UNAVAILABLE`，不暴露路径与 SQL。
- 固定种子对 checkpoint/occurrence 的决策稳定；证据文件固定记录 100 次决策的摘要。

## 未证明

- 未调用真实 Provider，因此不代表任何供应商的幂等语义已经通过实测。
- 未完成 F07 的预算、提交意图和远程对账闭环。
- 未把注入器接入媒体 atomic rename、ReleaseManifest 等六个生产 kill 点；Q03 仍需每点至少 100 个种子。
