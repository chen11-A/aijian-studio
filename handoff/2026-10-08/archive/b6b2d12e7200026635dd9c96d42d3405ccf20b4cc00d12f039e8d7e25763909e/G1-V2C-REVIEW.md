# G1 v2C 静态复审包

状态：MGR01 尚未批准，MGR02 尚未签发单次授权。`GRANT-02C.json`、`run-02`、`launch-02` 均不存在；没有执行 G1 迁移、产品导入或 provider 调用。v1 与 v2B 候选字节保持原样。

| 现用证据 | SHA256 |
| --- | --- |
| `PACKET-02C.json` | `2E8E304725D896791A14F0E944DA0CBDBB14C83814D8414D447D2E456825704E` |
| `g1_v2c_once.py`，固定 Python 消费者视图 | `9D2AFE0F222B86E7F81792980FE45F2B129FD98C530640A382195362104A3D59` |
| `launch_g1_v2c_once.ps1` | `D099C3327368EC7A55E6F98B82C233DBDC12BF55587DFB7E5A15429A306E7080` |
| `LAUNCH-PACKET-02C.json` | `ED14DE04859A260CBEBEA1E49E25304AC0C2EC84D726BD4BAC147D2B1D7FD14F` |
| `CALIBRATION-02.json` | `7A00A33E4DBA741D11E68FBBAE8677B2788A91092E1003DA0B995F784B4EF5FA` |
| `STATIC-REVIEW-02C.json` | `2B319FDBE4E93FDEB97EC3AE3A5DF8D99D68E983B0B001D48565476A17333E72` |

## 复审问题处理

- 哈希探针使用独立 `ProcessStartInfo`，QA 工作目录、`UseShellExecute=false`、`CreateNoWindow=true`、输出与错误重定向、30 秒超时，先 `Environment.Clear()` 再仅写入与主 G1 子进程相同的 8 项环境。探针原始 stdout、stderr、退出码、PID 与净化环境写入获授权后的 `launch-02/PREPARED.json`。独立探针收据 `HASH-PROBE-02C.json` SHA `13BDE152D2DDE85722C2FFBA04EE3AEF0C3594E6F56DFA9D15C82F2CACC48F3A`：退出 0、stderr 空、消费者哈希匹配；另一个净化环境见证进程仅看到 8 个指定环境键，宿主测试键未继承。探针后 profile 仍为 4 目录、0 文件、0 链接。
- 当前进程只要求每个**实际加载**的五个允许依赖根模块位于固定 QA 依赖目录、具有固定 `__file__` 和字节/SHA。`MODULE_MAP.json` 会记录允许根与实际加载根；不要求未使用的根被加载。
- 冻结原始 v26 库仍以 `mode=ro&immutable=1` 只读校准，50 张表与历史完整状态一致。运行库改用 `mode=ro` 读取迁移及复开状态，可看到 WAL 中已提交记录；`UPGRADED.json` 与 `REOPEN.json` 记录数据库、WAL、SHM 在读前后的存在性、字节数和 SHA。合成 QA WAL 检查中，读前 WAL 为 12392 字节，只读快照看到已提交的 1 行；收据 `WAL-READ-PROBE-02C.json` SHA `328E9F17CFD67D3512E3D59558E7181CD06ED3C95B267EAAC9A1CFDF48672E37`。
- 升级目标仍需与历史 `upgraded-v26.state` 的全部 58 张表、逐表数量/SHA 和身份摘要完全一致，再复开比对；MIGRATE、复开后的 `sys.path` 也须等于固定导入路径。启动器退出后仍要求 profile 零文件/零链接。

## 静态检查与授权边界

固定 Python 3.12.13 `-I -B` 解析执行器；PowerShell 解析器 0 错。逐一回读 153 个 QA 产品文件、157 个 QA 依赖文件、24 个历史 closure 模块和固定源证据，均与包一致。`profile-02` 当前为 4/0/0，准备收据 SHA `02DACC00430D06345BBFA56E7C6CDDFED94AF18D41377313D0153542FA68EE27`。

MGR01 复审范围通过后，MGR02 方可针对上述当前 runner、packet、launcher、launch packet、校准和复用证据签发一次性 `GRANT-02C.json`。授权目标是 `run-02` 与 `launch-02`；任何 RED 停止，不自动重试。静态检查和合成 WAL 检查均不是 G1 迁移通过证据。