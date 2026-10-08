# D repo30 core153 G0 复制/回读一签包（待审）

状态：**PREPARED_NOT_RUN**，日期 2026-09-29。仅供 MGR02 审签；MGR01 已共同核范围。`qa-physical-package`、`run-01`、`GRANT.json` 均不存在，见 `TARGET-ROOT-ABSENT.json`。此目录不是产品/c19，也不是已生成的 QA 代码包。

## 固定身份

- `PACKET.json` SHA-256 `4C067726C08639BFEA9BBAB5B98D9F8CF0FD503B8F0E52E563235C8FDAF6DB20`：固定 153 个目标、唯一源路径、bytes/SHA、D repo30 清单、固定输入、解释器、`sys.path` 和唯一目标根。
- `run_once.py` SHA-256 `020102BE3FE0A80DEFBB850BA9591B2DE3CF5D40905586F80ED35107BC5AAE3A`；已用固定解释器仅作 `ast.parse` 语法核验，runner 本体未执行。
- 解释器：`C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe`，SHA-256 `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`，仅 `-I -B`。
- 最终 DEV08 `TARGET-MANIFEST.json` SHA-256 `262C485F782D7B685DDD3D32ECF190DD2DF5B2E6008D9644EF0F6EAFD25E0E64`；QA 固定输入 SHA-256 `AAC037375F751B7B02949540B7D8E354AE31AE18B76C995DC9D2C68A55334C3C`。153 个目标合计 1,892,728 字节。
- 唯一提议目标根：`C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\core153-g0-copy-gate-01\qa-physical-package`。

## 待批准的一次运行

MGR02 如决定批准，需在此 packet 目录新增 `GRANT.json`，包含精确 `status=APPROVED`、`approved_by=MGR02`、`mgr01_scope_reviewed=true`、`scope=CORE153_G0_COPY_READBACK_ONLY`、`one_shot_run=run-01`、非空 `approval_id`、上列 `packet_sha256` 与 `runner_sha256`、以及与 `PACKET.json` 完全相同的 `target_root`。当前无该文件，不可运行。

批准后的唯一命令为：

```powershell
& 'C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe' -I -B 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\core153-g0-copy-gate-01\run_once.py'
```

runner 先核 grant、packet、runner、解释器、`sys.path`、源清单/固定输入及目标根不存在；逐项读取 153 个源，首个不匹配立即 RED；再建 QA 物理根、逐项复读后复制并立即回读；最后记录源与目标的完整后读、解释器 SHA、目标清单及 PASS receipt。任何运行中异常写 `run-01/RED.json`（含首个失败阶段、目标、实际 hash/bytes 或异常），保留已写文件和原始证据，绝不自动重试、换工具、换目录、从作者/c19 补件或清理 RED。`run-01` 已存在时拒绝再次运行。

本包不执行模块导入、`__file__` 消费、迁移、rights、claim、EXE、provider 或产品/c19 写入。导入门目前不可独立签，理由见 `IMPORT-STATIC-AUDIT.md`；复制回读 PASS 只证明这个物理 QA 包的固定字节身份。
