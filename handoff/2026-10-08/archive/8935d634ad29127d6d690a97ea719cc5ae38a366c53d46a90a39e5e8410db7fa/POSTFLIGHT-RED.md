# QA01 DEV05 R2 锁原语单次门：首 RED

本包按 `MGR02-APPROVAL.json` SHA-256 `353A5592A786C7FEFCBD5409D099615F4BAAE2CA405A080F4C81A76A44B04100` 执行**一次**固定 Python `-I -B` 命令。父 PID `19384`、退出码 `1`、未超时；没有子进程调用。没有重试，也未改签名脚本、c19 或产品。

原始证据均在 `run-01`：

| 文件 | SHA-256 | 结果 |
| --- | --- | --- |
| `INVOCATION.json` | `117E2BF082D8BB0B3BDCB7981A25E55214D476346F03FCAEC23F46104B6D58E6` | `RED_STOPPED`，前后输入 SHA 一致 |
| `RESULT.json` | `C55390B2EA106A354411A93D4358E1A9A9637157E9811922C10F812941AC611C` | 首个异常及堆栈 |
| `parent.stderr.raw` | `0A9830A1CF77E39F8AAB18ADD52DB1CDC674B61481AC8DD0109CCD6B497B5759` | 2129 字节原始 traceback |
| `parent.stdout.raw` | `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855` | 0 字节 |

首 RED 出现在 QA 运行器 `lock_r2_inner.py:194-200` 的 fd/name 错配**模拟替身**。替身返回只含 `st_dev/st_ino` 的 `SimpleNamespace`；产品函数随后在 `_is_link_or_junction()` 中调用 `Path.is_symlink()`，需要 `st_mode`，于是抛 `AttributeError: 'types.SimpleNamespace' object has no attribute 'st_mode'`。这属于 QA 替身字段不完整，不能归类为 DEV05 锁源码的拒绝或长路径失败；真实长锁获取、Busy73、正常释放均未执行。

在首 RED 前，实际固定数据库路径为 227 字符、逻辑锁路径 287 字符；相对、错名、`..`、UNC、真实 owner symlink 和真实 287 字符锁文件 symlink 均得到 `WorkspaceLockUnsafePathError`。锁文件 symlink 的 QA sentinel SHA-256 `83B3F7D2494F1B7BC1A9EE2C61FD13D0408F4B74DFCB9B651FC77C03C2E69642` 前后相同。这些是已执行的局部负例，不把整体门记为 PASS。

后验只读回核：父 PID 已退出；`x/y/z` 三个 QA 数据库均不存在；MGR04 snapshot/new/old Python 消费视图 SHA 分别仍为 `EA1B95BD...`/`103ED055...`/`94F62129...`；c19 锁文件仍缺席。旧 QA03 EXE RED receipt/stderr SHA 在 `INVOCATION.json` 前后相同。原 run-01、stdout/stderr、symlink 与 sentinel 留存。

处理边界：本批准已消费，`run-01` 不复用。若 MGR02 决定继续，应另建修正后的 QA 运行器、全新隔离目录及新的精确单次批准；先静审模拟替身完整字段，再运行。旧 R2 EXE RED 不重跑。
