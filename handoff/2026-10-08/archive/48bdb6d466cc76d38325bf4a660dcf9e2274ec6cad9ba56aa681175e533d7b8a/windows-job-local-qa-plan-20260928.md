# QA02｜Windows Job 作者候选的局部 QA 计划

2026-09-28，仅静态审与外置脚本准备；**未导入作者模块、未运行局部测试、未启动子进程**。

## 固定候选

- 版本组作者快照：`C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-d-windows-job-source-1\SNAPSHOT.json`，实算 SHA256 `115CC2A26CE77F4AAA7CA05E1C8A89C6AE9B5CA78BC0F697D36D97E016330576`，状态 `AUTHOR_CANDIDATE_SOURCE_FROZEN_NO_C19_SYNC_NO_QA`。快照标记 c19 基线不存在本文件。
- s2 作者源 `services/api/src/aijian_api/product_export_windows_job.py` 与 `work/dev08-product-export-windows-job-20260928/product_export_windows_job.py` 均为 15094 B / SHA256 `B5CAC03653669E35DDF1BB00031618D3C6605024E0A6DECC5CD4D9BBFC99EA40`。`SOURCE.json` SHA256 `EB5C70E707C49AC0E3D00A47B40F4E2FEEF60D9A2DB33C1DF8FDD148FF21AB87`，仍写 `STATIC_CANDIDATE_NO_IMPORT_NO_TEST_NO_PROCESS_EXECUTION`。
- 直接导入项只有 Python 标准库：ctypes/wintypes、msvcrt、os、pathlib、subprocess、time、collections.abc、typing；运行目标 Windows 10+。c19、正式 encoder、sidecar 与工程 MLT worker 均未接入此模块。作者源的 `CreateProcessW` 使用 suspended + job list 属性，先核 `IsProcessInJob` 再恢复线程；Job 设 `KILL_ON_JOB_CLOSE`，无失败回退到 `Popen`。这些是代码路径检查，不是运行证明。

## 风险与局部判据

| 风险 | 只在隔离局部 QA 中检查的证据 | 失败停门 |
| --- | --- | --- |
| 进程先于 Job 归属运行 | 仅自己创建的 Python helper，源模块返回的确切进程/Job 句柄上再次调用 `IsProcessInJob`，`ActiveProcesses >= 1`；候选代码在 `ResumeThread` 前已经核归属 | 无确切 Job 归属、句柄查询失败或父进程异常时立刻关闭本次私有 Job，保留 raw；不启动编码器 |
| 启动失败后偷偷退回普通进程 | 相对路径在前置校验拒绝；新建外置无效 `.exe` 在 `CreateProcessW` 失败，均只得 `ProductExportJobError`，无 PID/成功返回 | 任一失败路径返回可运行句柄、产生未受管子进程即 RED，停止后续用例 |
| 自建受管子进程未退出 | 正常 helper 输出固定标志并 exit 0；另一 helper 最多睡 15 秒，由其**本次私有 Job** terminate，限定 5 秒等待并记录确切 PID、exit、stdout/stderr SHA | membership、等待、读取或 close 失败也先关闭私有 Job，保存已收原始字节及关闭后的 returncode/句柄状态；无法确认则 UNKNOWN，不搜索/杀别的进程 |
| 顶层 Python/WinAPI 卡住 | Node 包装器 40 秒总时限；到时只对自己 `spawn()` 得到的 Python ChildProcess 调用 `kill()`，再等 5 秒 close | 保存 timeout、kill 返回、顶层 PID/exit/signal、raw SHA；若仍未 close，标 `TIMEOUT_EXIT_UNKNOWN_RAW_MAY_GROW`，不假称清理完成或稳定 raw |
| 后代、崩溃恢复或正式接线被局部结果冒领 | 结果标签限定 `LOCAL_SELF_OWNED_JOB_CASES_PASS_NO_PRODUCT_INTEGRATION` | 旧未受管孤儿、真实 encoder/MLT、宿主崩溃与正式启动恢复各另立门，不据此放行 |

## 外置固定脚本与调用门

- 测试脚本 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-windows-job-local-once-v1.py` SHA256 `B18DA59CD50EA491802D715201E1A6FA1BFBE207E8DC253F0DE0047C88080E71`；只作 AST 静态解析 `AST_PASS`，没有 import/exec 测试。它在运行前核快照/作者源/脚本/Python/批准 SHA，并以 source bytes compile/exec 避免向 s2 写 `__pycache__`。两条 reader 线程从 helper 启动即持续排空 stdout/stderr；即使 membership、wait 或 close 失败，仍写入可得 raw、PID、错误、关闭后 returncode/句柄状态及 reader 状态。
- Python 运行时固定为 `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`，当前 SHA256 `372C2EAE555B344520BF147BE0096E009069AECA4E7F78D6AECEA6D53158056A`。调用包装器 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\invoke-qa02-windows-job-local-once-v1.mjs` SHA256 `C7E8D7CBD376F97C5DB082051DECA632DFAFDB7A302ACCBFF354AAFD2BDD3AF9`，仅 `node --check` exit 0，未调用；Node 来自 Codex bundled runtime。
- MGR02 审门后才可另建唯一批准 JSON。必须含 `kind=MGR02_QA02_WINDOWS_JOB_LOCAL_ONCE_APPROVAL`、`scope=SELF_OWNED_PYTHON_ONLY`、`maxAttempts=1`、`runId=qa02-windows-job-local-01`、以下外置结果目录的绝对路径，以及 snapshot/source/script/wrapper/python 的以上完整 SHA。包装器还需命令行传批准绝对路径及其 SHA；任何不匹配拒绝在创建运行目录之前。
- 批准后唯一调用形状：`node <invoke-qa02-windows-job-local-once-v1.mjs> --approval=<批准JSON绝对路径> --approval-sha256=<实算SHA>`。包装器独占新建 `windows-job-local-invocations/qa02-windows-job-local-01`，先写 `intent.json`，将顶层 Python stdout/stderr 直接写 `stdout.raw`/`stderr.raw`，再写顶层 PID/exit/signal/spawnError/timeout/close 状态和 raw/内部 receipt SHA 的 `receipt.json`；不重试。Python 独占新建 `windows-job-local-runs/qa02-windows-job-local-01`，写自身 `intent.json`、两自建子进程 raw 与结果 `receipt.json`。40 秒超时只终止包装器自己启动的 Python ChildProcess；Python 的 Job handle 关闭才负责其 helper，不调用 taskkill 或按 PID 搜索。
- 运行进程只为固定 Python helper。最小环境仅 SystemRoot/WINDIR/TEMP/TMP、Python 所在目录 PATH、`PYTHONNOUSERSITE=1`；不传用户库、实际编码器、MLT、网络程序或 provider。源码输入只读 s2 快照文件，不写 c19、s2 或产品数据库。局部 QA 清理仅走本次脚本握有的无名私有 Job 句柄，不按 PID 搜索/杀既有进程。

## 执行后的判定

先核顶层和内部 receipt、所有 raw SHA、两个失败拒启动分支、两个自己启动的 helper 的确切 Job 归属/退出、Job handle 关闭，再核本轮无存活自建子进程。任何 helper 失败，内部 receipt 必须含它的 PID、可得 exit、关闭状态及已收 raw SHA；若 OS 仍未 close，顶层 raw 可能继续增长且显式 UNKNOWN。任一异常只标失败或 UNKNOWN，保留唯一目录并提交作者定位；绝不二次运行同一批准。即便全部通过，也只证明局部 Windows Job 封装，不能说明 c19 已集成、旧孤儿已退出、真实编码/MLT 或正式恢复已通过。
