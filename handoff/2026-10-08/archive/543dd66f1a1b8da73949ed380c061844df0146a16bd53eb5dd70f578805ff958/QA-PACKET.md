# QA01 DEV05 R2 长路径锁原语：新隔离门 r2-02

状态：`PREPARED_NOT_APPROVED_NOT_RUN`。r2-01 首 RED 原样保留；本包是全新目录和新单签候选，MGR02 审签前不运行。产品源码、c19、用户数据库、旧 QA03 EXE RED 均不修改。

## 固定身份

- MGR04 `SNAPSHOT.json` SHA-256 `EA1B95BD109173C812967E3F7A59F272CACDA8C31DFDAD557D41ECC2ECE8E24E`；旧锁源码 `94F62129EE9253425BBFE932D8822B032B7AF587D6DAB16DD0AE6870ABF410F6`，新锁源码 `103ED055A19839179977C6792E58619E71ADF724037560106837DCA9B798D427`。
- 固定 `C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe` SHA-256 `461D6E5F9A0DCB724798D2B6DBD57555A9EB3084522CC5DC5B2347934F5A4060`，唯一执行旗标 `-I -B`。其明文 `read_bytes()` 视图读取新源码 6672 字节/SHA `103ED055...`；PowerShell 原始视图 SHA `01CE52C9D06B827A2F1127179CFADEEED798ACECA5C94F85E163C37F1855610C`，不可相互替代。
- 旧 EXE R2 `RECEIPT.json` SHA `A5B699C08F20AE6C6B53759A1F7CCCB4093A6EBFF06DE63100A7102B932CEA59`、stderr SHA `ED53D2C188380EB0E80E0FAA116101422E338B86D7D15552044269299A77C23B`。旧 r2-01 QA `INVOCATION.json` SHA `117E2BF082D8BB0B3BDCB7981A25E55214D476346F03FCAEC23F46104B6D58E6`、`RESULT.json` SHA `C55390B2EA106A354411A93D4358E1A9A9637157E9811922C10F812941AC611C`、stderr SHA `0A9830A1CF77E39F8AAB18ADD52DB1CDC674B61481AC8DD0109CCD6B497B5759`。启动器在新输出目录创建前核全部 SHA，运行后再核；旧证据不复用、不覆盖。

## 仅 QA 模拟替身修正

- r2-01 的替身只返回 `st_dev/st_ino`，`Path.is_symlink()` 的 `lstat().st_mode` 因而抛 `AttributeError`。新 `MismatchedStat` 保存**真实** `os.stat_result`，`__getattr__` 将 `st_mode/st_dev/st_nlink/st_file_attributes/st_reparse_tag` 等未覆盖字段委托给真实对象；仅 `st_ino` 属性及其序列索引 1 改为 `real.st_ino + 1`。不改变产品源码。
- 静态审阅真实 `Path.stat` 副作用：`original_stat = Path.stat` 在 `with patch.object(Path, "stat", ...)` 前捕获。补丁作用域仅包住一次 `acquire_workspace_owner_lock(race_database)`；每个调用先执行 `original_stat(path, *args, **kwargs)`。仅当 `path == race_io` 且 `follow_symlinks=False` 时返回代理；其他路径原样返回真实结果。`Path.is_symlink()/is_junction()` 对同路径可读真实 `st_mode`/reparse 属性；最终 fd/name 的 `st_ino` 不等才触发预期拒绝。补丁退出后恢复 `Path.stat`。这是**受控模拟**，不证明真实竞争窗口关闭。
- 两脚本已由固定 Python 仅作 AST 解析，未 import 锁模块、未创建 QA fixture、未运行。新 `run-01` 和 `MGR02-APPROVAL.json` 均不存在。

## 单次运行设计

- `run-01/profile` 下固定填充 42 个 `x/y/z` 字符，owner/database/逻辑锁路径分别恰 199/227/287 字符；数据库始终不存在。r2-01 路径与目录不复用。
- 先测相对、错名、`..`、UNC、真实 owner symlink、真实 287 字符锁文件 symlink 拒绝，sentinel 哈希不变；无法创建 symlink 则首 RED、不标 PASS。
- 再测 fd/name 模拟错配拒绝与真实 fd/name 相等、同进程 Busy、同 DB 第二 Python 进程 Busy 异常（**QA harness** 映射 exit 73）、父正常释放后子和父分别重获、锁文件零字节、数据库未创建。保留父子 PID、退出码、超时、原始 stdout/stderr、`RESULT.json` 和 `INVOCATION.json`。
- 审签后唯一命令：`& 'C:\Users\Administrator\.codex\worktrees\c19-trim-211c9e8-qa-20260923\.venv\Scripts\python.exe' -I -B 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\dev05-lock-longpath-r2-02\launch_lock_r2_once.py'`。首 RED 停、不自动重试。

本门成功仅可标 `PASS_ISOLATED_LONGPATH_LOCK_PRIMITIVE_ONLY`；QA 子进程 exit 73 不等于 sidecar/EXE Busy73，亦不证明 EXE ready/health、worker/encoder/崩溃恢复或安装验收。
