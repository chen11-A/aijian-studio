# QA01 DEV05 R2 长路径锁原语独立门

状态：`PREPARED_NOT_APPROVED_NOT_RUN`。此包只测试冻结的 `workspace_owner_lock.py`，不运行旧 EXE，不构建、不写 c19、产品目录或用户数据库。MGR02 审签前不调用运行器。

## 固定源码和原 RED

- MGR04 `SNAPSHOT.json` SHA-256 `EA1B95BD109173C812967E3F7A59F272CACDA8C31DFDAD557D41ECC2ECE8E24E`；旧锁源 `94F62129EE9253425BBFE932D8822B032B7AF587D6DAB16DD0AE6870ABF410F6`，新锁源 `103ED055A19839179977C6792E58619E71ADF724037560106837DCA9B798D427`。来源是 `C:\Users\Administrator\Documents\AIVORA\management\manager-handoffs\release-snapshots\20260928-workspace-owner-lock-longpath-candidate-1`，不复制源码。
- 固定 c19 Python `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe` SHA-256 `461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060`，仅以 `-I -B` 调用。它的 `read_bytes()` 视图中新源为 6672 字节且哈希 `103ED055...`；PowerShell `Get-FileHash` 原始视图为 `01CE52C9D06B827A2F1127179CFADEEED798ACECA5C94F85E163C37F1855610C`。两种视图并列保留，不把 PowerShell 原始字节冒充 Python 执行字节。
- 旧 R2 EXE RED 原始 `RECEIPT.json` SHA-256 `A5B699C08F20AE6C6B53759A1F7CCCB4093A6EBFF06DE63100A7102B932CEA59`、stderr SHA-256 `ED53D2C188380EB0E80E0FAA116101422E338B86D7D15552044269299A77C23B`，位于 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa03-project-name-source-20260928\backend-exe-runtime-shorttemp-gate-v1\run-01`。只核哈希，不修改、不重跑。

## 冻结执行与输入

- 内层 `lock_r2_inner.py` SHA-256 `59EE3DAD4702F39636992A3E22925296CB048B9B211164823C8E94549553494E`；外层单签启动器 `launch_lock_r2_once.py` SHA-256 `36017BFAB98462E29DF11AF75A4A08188ED555BB4836035CBDE0284D2A87E96F`。两文件已用固定 Python AST 解析，未 import 锁源码或执行测试。
- `APPROVAL-REQUEST.json` 是审签请求，非批准。MGR02 若认可，在同目录另建 `MGR02-APPROVAL.json`，沿用请求中全部身份字段，将 `status` 置为 `MGR02_APPROVED_ONCE`。启动器在任何输出目录或子进程创建前核解释器/flags、源码/快照、旧 RED、批准字段和新目录。`run-01` 与批准文件当前均不存在。
- 批准后的**唯一**调用：`& 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe' -I -B 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\dev05-lock-longpath-r2-01\launch_lock_r2_once.py'`。

## 路径及检查

- 新 `run-01/profile` 下由固定填充 `x` 构造 owner 路径恰 199 字符；数据库路径 `owner/workspace/workspace.sqlite3` 恰 227 字符、始终不存在；逻辑锁文件路径恰 287 字符。新源应返回同一数据库规范化 identity/锁文件名，仅文件 I/O 使用 Windows `\\?\` 扩展拼写。
- 负例先拒绝相对、错名、`..`、UNC；再用 QA 内真实 owner 目录 symlink 和另一条 287 字符锁文件 symlink 验证重解析拒绝、sentinel 不变。若 OS 无法创建 symlink，记首个 `RED_REPARSE_FIXTURE_UNAVAILABLE`，不把未测称 PASS。
- 用受控 `Path.stat` 替身在命名文件校验点模拟 fd/name 不一致，应拒绝并清除进程内身份；另在真实获取后比较 fd 与命名文件设备/索引。模拟不等于真实竞争窗口验收。
- 真实获取后同进程重复须 `WorkspaceLockBusyError`；第二个 Python 进程对同一 DB 须抛相同 Busy，QA 子进程将其映射为 exit 73。此处 exit 73 是**QA harness 映射**，不宣称 sidecar/EXE 已验证。父进程正常释放后，子进程再获取释放；父进程随后再获取释放。锁文件零字节、数据库仍不存在。
- 外层保留父/子 PID、退出码、超时、raw stdout/stderr 及 SHA、`RESULT.json`/`INVOCATION.json`、源码/旧 RED 前后哈希。首 RED 停；不自动重试，不进入 QA03 桌面/EXE 输出目录。

本门成功状态仅 `PASS_ISOLATED_LONGPATH_LOCK_PRIMITIVE_ONLY`。它不证明 sidecar Busy73、EXE ready/health、worker/encoder 退出、崩溃恢复、安装或产品验收。
