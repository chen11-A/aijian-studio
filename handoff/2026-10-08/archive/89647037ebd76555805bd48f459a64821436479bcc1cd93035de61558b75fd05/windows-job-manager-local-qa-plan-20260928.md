# QA02｜D 整合候选 Windows Job Manager 局部 QA 审门

2026-09-28，只读静审与外置固定输入准备。**没有导入或执行快照源码，没有启动 Python helper，没有写 c19/作者树/产品数据库，没有运行真实 encoder、MLT 或网络工具。**旧 B5CAC 单文件局部计划不批准、不执行。

## 固定快照与精确差异

- 唯一新输入是版本组快照 `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-d-managed-export-integration-candidate-4-1`。`SNAPSHOT.json` SHA256 `839074A0F355D42E5AAC2E309184524E10F90C14817EDECB544FC1AE7B6A6CA4`，`SOURCE.json` SHA256 `8879C124F5F722A734AF185C37B31AA6A4409EE6A8F9ED4B58C4F151D6CCDA9D`。两者钉住快照实体 `services/api/src/aijian_api/product_export_windows_job.py`，18303 B / SHA256 `11A5762844F0C79471DFB46719E00ACC0D951A71FAC4E11F9C58202A2DBACFA2`；只读重算匹配。快照状态 `AUTHOR_CANDIDATE_FROZEN_DEPENDENCY_AUDIT_OPEN_NO_C19_SYNC_NO_QA`。
- 与旧保存副本 B5CAC…/15094 B 做 `git diff --no-index`：底层 `ProductExportJobProcess`、suspended CreateProcess、Job list、`IsProcessInJob`、kill-on-close 的核心路径未变；新增 `ProductExportJobManager`，以 RLock 登记 `_processes`，失败 spawn 标 `_uncertain`，`release()` 只接受本 manager 所有的对象并调用 close，`shutdown_and_wait()` 先禁止新 spawn、终止登记的 Job，再限时等待零活动进程；**shutdown 本身不关闭句柄，仍须由 owner release**。另将 `msvcrt` 移到 `spawn_product_export_job()` 内，并将环境键按不区分大小写排序。新 manager 语义必须单独核，不把旧直接 spawn 用例视为充分。
- 快照同时含 encoder `6DB31BA0…EB59B8`、operation coordinator `696754FF…7E3D09`、single-video service `C627B783…0654DE`，但 main/sidecar/发布路由未接线，release allowlist 为空、启动恢复禁用。本局部用例只加载**快照 Job 源实体**，不导入三项集成模块；测试通过不能代表整合或旧孤儿恢复。c19 基线无该文件。

## 新局部判据

| 用例 | 仅自己创建的固定对象 | PASS 证据与失败处理 |
| --- | --- | --- |
| manager 拒绝失败启动 | 两个新 manager；相对 `relative.exe`，外置运行目录中的无效 `invalid-self-owned.exe` | 均抛 `ProductExportJobError`，未返回 PID/进程，owner 集合为 0；源码保守置 `_uncertain=True`。异常时保存原错误，不能回退 `Popen` |
| manager 归属与自然退出 | 由新 manager 启动 bundled Python 本脚本 `--child-exit`，helper 打固定标志并 2 秒后 exit 0 | 只在返回的确切 process/Job 句柄上独立调用 `IsProcessInJob` 且 ActiveProcesses≥1；另一个 manager 的 `release(process)` 必须拒绝；owner `release` 后集合为 0、Job/进程句柄关闭、exit 0、raw SHA 记录；其后 `shutdown_and_wait()` 与新 spawn 拒绝分别有证据 |
| manager 关闭等待 | 由新 manager 启动 bundled Python 本脚本 `--child-hold`，helper 最多睡 15 秒 | owner `shutdown_and_wait(timeout_seconds=5)` 应只终止自己的私有 Job 并等受管子进程退出；随后 owner `release` 关闭句柄/移出集合；记录 PID、可得 exit、manager `_closing/_uncertain`、stdout/stderr 原字节。若 wait/close 失败，保 raw 与关闭后状态并标 UNKNOWN |
| 顶层卡住 | Node 包装器亲自启动的 Python 测试进程 | 40 秒硬超时只对该 ChildProcess 调 `kill()`，再等 5 秒；记录 timeout、kill 结果、PID/exit/signal/raw。未观察到 close 时标 `TIMEOUT_EXIT_UNKNOWN_RAW_MAY_GROW`，不搜索/杀任何现有 PID |

内部脚本明确断言 manager 登记集合恰为当前 helper 一件、成功 shutdown 后 `_closing=True/_uncertain=False`、release 后集合为零且无不确定状态。helper 启动后立即以两线程持续排空 stdout/stderr。membership、wait、reader 或 owner release 出错时，先释放本次私有 Job，再保存已得到的原始字节、PID、可得 exit、close 后 returncode/句柄状态、reader 状态；无法证明完整退出则停为 UNKNOWN，不自动重试。`ProductExportJobManager.release` 若抛异常会将对象移出登记集合；脚本仅对自己创建的 `process` 句柄再做本地 close，并如实记录双重失败。

本局部测试**不覆盖**两个及以上并发 Job、spawn 与 shutdown 的锁竞争、worker 同时 release、真实 sidecar workspace owner lock、异常注入到 CreateProcess 后/ResumeThread 前、`release`/`shutdown_and_wait` 失败注入、进程树后代与进程崩溃后恢复；也不证明旧未受管孤儿退出。新增 manager 的单 helper 路径若 PASS，也不得称新模块整体或 D 整合验收通过。

## 外置脚本、批准输入与一次性调用

- Python 固定脚本：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-windows-job-manager-local-once-v2.py`，SHA256 `38F7F8CA7E2C7E2434ADBFA28DCF7D713BB6BF935C40D138F452C7A51C2C82C1`。只做 AST 静态解析 `AST_PASS`，没有 import/exec。实际运行时先核快照/来源清单/Job 实体及自身/Python/批准的哈希；以快照字节 `compile/exec` 独立加载 Job 模块，不读取活作者树、不生成快照旁 `__pycache__`。
- Python 固定运行时：`C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` SHA256 `372C2EAE555B344520BF147BE0096E009069AECA4E7F78D6AECEA6D53158056A`。Node 一次性包装器：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\invoke-qa02-windows-job-manager-local-once-v2.mjs` SHA256 `10D38485E2D734E2585B4BD45035A7F73B810516F8CAAE2F596FA77A658BD73F`，包装器还内钉脚本 SHA；仅 `node --check` exit 0，未调用。
- MGR02 签门后才可生成唯一批准 JSON，必须包含 `kind=MGR02_QA02_WINDOWS_JOB_MANAGER_LOCAL_ONCE_APPROVAL`、`scope=SELF_OWNED_PYTHON_ONLY`、`maxAttempts=1`、`runId=qa02-windows-job-manager-local-01`，钉住完整 snapshot/sourceManifest/source/script/wrapper/python SHA 与绝对结果目录 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\windows-job-manager-local-runs\qa02-windows-job-manager-local-01`。包装器调用参数仅 `--approval=<批准JSON绝对路径> --approval-sha256=<实际SHA>`；先核所有字段、原件、两个目标目录不存在，再以 `wx` 建一次性 invocation 目录。
- 顶层原始证据进 `windows-job-manager-local-invocations/qa02-windows-job-manager-local-01`：intent、stdout.raw、stderr.raw、PID/exit/signal/timeout/kill/close/两 raw SHA/内部 receipt SHA。内部证据进上述唯一结果目录：intent、两 helper 的 stdout/stderr raw、包括失败及关闭后状态的 receipt。超时或失败都不复用同一目录、不自动重试。

需要 MGR02 对**此新版**脚本、包装器、快照及风险判据完成审门后才可执行。此处没有测试结果。即使局部 PASS，也仅证明快照 Job Manager 对自建 Python helper 的进程边界；正式整合、真实编码、MLT、旧孤儿、侧车启动恢复与产品验收仍分别待门。
