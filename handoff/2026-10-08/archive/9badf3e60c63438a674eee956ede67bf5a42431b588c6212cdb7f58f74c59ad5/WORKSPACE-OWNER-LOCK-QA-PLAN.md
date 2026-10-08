# Workspace owner lock 独立加载审计与一次局部测试计划

日期：2026-09-28。此计划供 MGR02 静态审门；脚本**尚未运行或导入**锁模块。输入只取 MGR04 已冻 `20260928-workspace-owner-lock-source-1/SNAPSHOT.json` SHA `B8ACA81524289F9F5A55363A2A60731693ABE602B290CE521185473064A921E6` 对应源码 `workspace_owner_lock.py` SHA `94F62129EE9253425BBFE932D8822B032B7AF587D6DAB16DD0AE6870ABF410F6`。作者活动源码已只读核同 SHA；c19 不含此文件，sidecar 尚未集成。DEV05 后续 sidecar 接线另门，不属于本测试。

## 独立加载与隐藏依赖

源码顶层仅用 Python 标准库 `errno/hashlib/os/stat/threading/pathlib/types`；获取锁时 Windows 分支延迟导入 `msvcrt`，非 Windows 分支延迟导入 `fcntl`。没有 `aijian_api` import、数据库连接、provider、网络或 MLT 调用；可用 `importlib.util.spec_from_file_location` 从受保护快照单文件加载，不依赖作者工作树或 c19。实际可加载性仍要用本次隔离进程结果证明。

隐含平台/目录条件：Python/Windows 的 `msvcrt.locking(fd, LK_NBLCK, 1)`、NTFS 本地文件锁和 inode/device 比对、`Path.is_junction`（缺时有 fallback）、`stat.st_nlink==1`、父目录可写、路径解析稳定。源码只以**同一规范化数据库路径**计算锁文件名，拒绝相对路径、UNC、名字非 `workspace.sqlite3`、符号链接/联接点、非普通或多硬链接文件。映射网络盘、目录在核验与打开间被并发替换、非合作 sidecar、残留编码器子进程均未被此局部测试证明安全；sidecar 必须在 listener/repository/worker/ready 前占锁并在全部子进程退出后释放，另需集成与故障恢复测试。

## 待签的一次隔离执行

- 全新输出 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\workspace-lock-local-01` 及三个 wrapper raw/receipt 运行前必须不存在；仅在该目录下创建 `profile/workspace`。数据库 `profile/workspace/workspace.sqlite3` 始终不存在。锁文件按模块算法位于新 `profile`，保留零字节作证据；不触用户库或 c19。
- 入口 `node verify-workspace-owner-lock-once.mjs`，wrapper 冻脚本与源码 SHA，且先核外置解释器 `C:\Users\Administrator\Documents\sp\.venv\Scripts\python.exe` 字节 SHA `5912D0884B23C0343983A864C6064242391E2265536F50B88624857E353882C9`，把解释器 SHA 写入 invocation 后启动 Python `-B`，总上限25秒；Python 独立 import 快照，拒绝相对路径/错误数据库名；父进程获取后同进程第二次调用须 `WorkspaceLockBusyError`。
- 父进程持锁时启动**自建**子进程一次 `child-busy`，须退出0并回 `BUSY_REJECTED`；父进程释放后另一个子进程一次 `child-acquire`，须退出0并取得后释放。父进程再取得并释放一次，证明跨进程拒绝与释放后可重取。子进程各设5秒上限，超时 kill+回收，全部 stdout/stderr 原始字节、PID、命令、exit、哈希保存到新输出；wrapper 同样留原始 stdout/stderr、PID/exit。
- 结束核数据库仍不存在、锁文件为普通零字节、父子均已退出。任何失败或超时保留原始证据并停止，不重跑本 run，不升级为 sidecar 启动/恢复验收。

本局部门只测试合作锁模块的本机排他行为；不运行 sidecar、不证明正式 export 幂等或孤儿编码器清理。
