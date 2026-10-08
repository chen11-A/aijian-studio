# QA01 Windows Job 无编码独立门（待 MGR02 签，一次运行）

日期：2026-09-28。状态：`PREPARED_NOT_RUN`。门只验证 D/repo30 冻结源码中的 `ProductExportJobManager` 对一个良性 Python 父进程及其子进程的 Windows Job 归属、停序与 workspace owner lock 释放先后。它不启动 sidecar、encoder、FFmpeg、MLT、provider，不写 c19，不接触用户 DB，也不证明完整产品停序。之前的 D/repo30 隔离 import/schema30/replay 和 route/auth/Busy73 门各按原冻结 152 文件结果保留；本门单独补 Win32 Job 原语。

## 固定输入与运行器

| 项 | 身份 |
| --- | --- |
| 冻结 D/repo30 152 文件 `FILES.json` | `F3775529D3D431D5D914F80FB74552CD23B96402142808970963D75C296160E9`；运行前后逐件核 152/152 |
| `product_export_windows_job.py` | `11A5762844F0C79471DFB46719E00ACC0D951A71FAC4E11F9C58202A2DBACFA2` |
| `workspace_owner_lock.py` | `94F62129EE9253425BBFE932D8822B032B7AF587D6DAB16DD0AE6870ABF410F6` |
| c19 虚拟环境 Python | `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe` SHA-256 `461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060` |
| 良性子进程 Python | `C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe` SHA-256 `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602` |
| 运行器 `verify-d-windows-job-lifecycle-once.py` | SHA-256 `2F1ED73CF9136B4DD518A21BDFB6E0DA060D2F0EE8C12CC47A500A3C3DE3712F`；仅做过 AST 与良性 child 内嵌脚本 AST 静态检查，无 Job 执行 |
| 隔离输出 | `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\d-windows-job-lifecycle-01`，必须运行前不存在 |

MGR02 若批准，须创建同目录 `D-WINDOWS-JOB-LIFECYCLE-ONE-SHOT-APPROVAL.json`，至少含 `mode`, `runner_sha256`, `source_manifest_sha256`, `python_sha256`, `base_python_sha256`, `output_directory`, `run_count: 1`，具体值见同目录 `D-WINDOWS-JOB-LIFECYCLE-APPROVAL-REQUEST.json`。请求文件只是待签封套，**不是批准**。运行器在创建任何输出或产品进程前核签字文件字段、解释器、152 源哈希和新目录。若任一项不符，立即 RED 且不运行。MGR02 签后由 QA01 在相同 Windows 主机执行且只执行一次：

```powershell
& 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe' 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\verify-d-windows-job-lifecycle-once.py'
```

## 一次运行的顺序与首 RED

1. 核冻结输入及独占批准；仅在全绿后建立全新外部 profile。首个版本/审批/目录不符即 `RED_*`，不创建 output，不自动重试。
2. 在外部 profile 持有 `WorkspaceOwnerLock`；创建一个私有 `ProductExportJobManager`，用实际 `spawn` 启动无编码 Python，Python 再起一个只写 PID 的 Python 子进程。观察父 PID 与 Job 返回 PID 一致、孙 PID 不同、私有 Job `ActiveProcesses >= 2`。任一不符即 RED，留原始 PID/异常/堆栈。
3. 调用一次 `shutdown_and_wait`，要求私有 Job `ActiveProcesses == 0` 且父进程已退出；随后 `manager.release` 关闭句柄，再释放 workspace owner lock。事件顺序记录到 `RESULT.json`。任一失败即 RED 并进行 bounded kill-on-close 清理，**不补跑**。
4. 核 profile 未生成 `workspace.sqlite3`、冻结源 152/152 未变；记录 `RESULT.json`、`child-stdout.raw`、`child-stderr.raw`、PID、解释器/源哈希、事件与清理结果。仅全部成立才标 `PASS_ISOLATED_WIN32_JOB_PRIMITIVE_ONLY`。若在子进程停序前 RED，保留当时可获取的异常/堆栈与 PID，原始管道可能无法无阻塞读取，报告该边界。

首 RED 停止条件包括审批缺席/错误、解释器或源码漂移、非 Windows、输出目录已存在、owner lock 异常、Job 创建/归属/Resume 失败、子孙 PID 未出现、`ActiveProcesses < 2`、停序超时/非零残留、锁过早释放、DB 被创建、清理失败。发生任一 RED，保留原始结果，不重用 output、不自动重试、不把清理成功改为 PASS。进程退出会由 OS 释放 owner lock；“异常保锁”只针对活进程中不能过早释放。

## 继承和后续边界

本门只对应冻结 D/repo30 的 Job 与 lock 原字节，不能继承到尚未冻结的 D+长路径+DEV08 安全集成合包；若该两文件在最终合包保持同 SHA，可保留本门对原语的证据，但仍需最终包下 sidecar 真实停序和旧 UNKNOWN/同键回放/新键空许可拒绝的独立门。DEV08 安全集成 `claim.py` 新 `7AD9D77C...` 与 `runtime.py` 新 `1A543BEA...` 必须配对；最终合包不存在时不运行完整进程门。startup recovery 与孤儿 encoder 条件仍关闭；空 allowlist 不由 QA 改成可出单许可。
