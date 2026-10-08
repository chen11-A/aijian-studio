# QA03 SOURCE 项目名称：双新进程 sidecar 持久化门 v3

状态：`VENV_LAUNCHER_PROBE_PASS / NOT_APPROVED / SIDECAR_03_NOT_RUN`。v2 已按唯一批准运行一次，`sidecar-gate-v2/sidecar-02/RECEIPT.json` SHA256 `7765A3A626674F6072CC5EBFE51A86CBDC6BE00098603AD624B3DA093C75096C`，首 RED 为握手 PID 17328 与 Node `spawn` 句柄 PID 17548 不同；没有 HTTP 请求、没有 PATCH、没有第二进程。隔离 SQLite 已创建，但不能称持久化测试。v2 原始记录与批准保留，不复用。

外置无产品副作用的 `probe-venv-launcher.mjs` 只启动 venv Python 的 `-c` 小程序并读 stdin。`probe-01/PROBE.json` SHA256 `380E996C21180E150222BD957755C6205B07E861EF476EEC22D1D0E5251B5169`，状态 `PROBE_PASS`：启动器 PID 2388，实际解释器 PID 17540；Python `os.getppid()` 与 Win32_Process `ParentProcessId` 都为 2388；启动器是 c19 `.venv/Scripts/python.exe`，子进程是 uv CPython 3.12 的 `python.exe`。关闭启动器 stdin 后 exit 0，双方 PID 消失。原始 stdout/stderr 和 Win32 进程树已留存。该探针解释 v2 身份误判，不含项目 API 或 provider 调用。

v3 runner 仅改外置身份验证：启动时记录 venv 启动器与握手实际 sidecar 的两个 PID，用 Win32_Process 回读父子关系、可执行路径，并校验底层 Python SHA；正常关闭后有界核对两 PID 均消失。两次实际 sidecar PID 必须不同。前后 c19 源清单使用同一 slash/ordinal/UTF-8+LF 规范，逐项保存；独立 profile `sidecar-03/profile`、SQLite 与 HTTP raw 不复用 v2。

`RUN-APPROVAL.template.json` 为 `NOT_APPROVED`，runId `qa03-source-name-sidecar-03`，输出目录尚不存在。另签一次性封套必须固定本 packet、runner/两个 helper、probe 收据、启动器与实际解释器 SHA、component-02 与 Web v3 收据、c19 HEAD/status/source、六个项目管理直接边界文件。获批后第一实际 sidecar 进程 create→单次 If-Match CAS PATCH→GET→正常关闭；第二实际 PID 以同一隔离 SQLite list/get，并核对 project_id、名称、revision，保存数据库哈希。首 RED 停，不自动重试。通过仍只证明本地隔离 sidecar 新进程持久读回，不代表 Electron、打包安装或最终验收。
