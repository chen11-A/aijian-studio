# core153 QA 依赖复制/回读单签包

状态：`PREPARED_NOT_RUN`。此包只准备从 QA03 已存在的 5 个递归发行包复制 157 个列明文件到新的 QA 自有 `qa-deps`。`qa-deps`、`copy-run-01`、`COPY-GRANT.json` 均不存在，见 `TARGETS-ABSENT.json` SHA `96A299282972776097F33AC011A9CECEB900720360C65727BC60FA338E563AEF`。

## 审签身份

- `DEPENDENCY-CANDIDATE.json` SHA `DCD7BF0BF0FB29B7A1247C33C62B4470AD15A89AB8658CC4845E84E7FDAE6AC7`：5 发行版、157 文件、7,767,087 字节，源绝对路径、bytes/SHA、版本、metadata/RECORD 与 `.pth` 排除信息。
- `copy_deps_once.py` SHA `BEF0218C75FD9F7F4A8F9CE9C205CCC62E4060640E91453ADDEA9BDA65E8086C`；`COPY-PACKET.json` SHA `D4267CCCF4C263E3A3200524579558780E2BFCBAC45553E0879698F80DDB689C`。这两个文件在固定 Python 和 PowerShell 读取视图下 SHA 一致。
- 固定 uv CPython 3.12.13 `-I -B` SHA `F598FB950A86A895D8F9B4755FC9B38C48ADC7A15732A342E55C17A3C3499602`。runner 仅用标准库，不导入第三方或产品模块。

MGR02 单签前不得创建 `COPY-GRANT.json` 或运行 runner。签署文件须精确包含：`state=APPROVED_SINGLE_RUN`、`approved_by=MGR02`、`mgr01_scope_reviewed=true`、`cross_task_source_approved=true`、`scope=CORE153_QA_DEPENDENCY_COPY_157_ONLY`、`one_shot_run=copy-run-01`、非空 `approval_id`、上述 `packet_sha256`、`runner_sha256`、`candidate_sha256` 与 `COPY-PACKET.json` 中完全相同的 `target_root`。

批准后的唯一 runner 命令：

```powershell
& 'C:\Users\Administrator\AppData\Roaming\uv\python\cpython-3.12-windows-x86_64-none\python.exe' -I -B 'C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\qa01-mlt-20260928\core153-import-gate-prep-01\copy_deps_once.py'
```

需在外层分别保存 stdout、stderr、退出码及命令/PID/hash。runner 在任何写目标前逐项验证源 157 文件、QA03 原批准/收据、解释器/`sys.path`；然后仅在 QA 根写 `qa-deps` 中列明的 157 个文件及 `copy-run-01` 下 `INVOCATION.json`、`SOURCE_BEFORE.json`、`COPY_PROGRESS.jsonl`、`TARGET_AFTER_COPY.json`、`SOURCE_AFTER_COPY.json`、`TARGET_FINAL.json`、`INTERPRETER_CHECKS.json` 和二选一的 `RECEIPT.json`/`RED.json`。任何首个差异/异常 RED 停止并保留现场；`copy-run-01` 已存在时拒绝重跑。不清理、替换、改用别的来源/目录或以另一 reader 视图绕过差异。

本门 PASS 仅是固定 Python 的 QA 依赖复制/回读身份；独立跨 reader 目标核对与实际导入是后续门。未运行安装、下载、venv 激活、`.pth`、迁移、rights、claim、EXE、provider，也未写 QA03/c19。

## 后续导入门当前未签

`MODULE-STATIC-AUDIT.json` SHA `FD6369160A076A7F1DD167ABEC8B7A13BCCF192E1146B216B74A26911A570CB1` 逐模块覆盖 56 个静态闭包，未见直接的顶层服务/DB/spawn/网络/文件写调用；`DEPENDENCY-TOPLEVEL-AUDIT.json` SHA `8ECEC1F6308CC1D6F4C255853E118A9708EC7EA96A208F5566C3ACD38B0E06EE` 覆盖 113 个候选 `.py`，编译 `.pyd` 不可 AST 审。导入 runner `run_once.py` 与 `IMPORT-PACKET-DRAFT.json` 仅为草稿，依赖目标和复制收据尚不存在，packet 的 `state=WAITING_FOR_QA_DEPENDENCY_COPY_NOT_SIGNABLE`；不得签或运行。该草稿 runner 的固定 Python 读值 SHA `17D8F9FE1817A1362700576BD8DF938CCFCC3413E03F8C554A3DB61BB22BB5B2`，PowerShell raw SHA `C2BAD233790017410BE0EC90A8154C36DD3E3A14E54E875C2CE7961A7FC12B16`，双视图已保留，不能用 PowerShell SHA 冒充实际 Python 消费身份。另签前由 QA01 唯一负责把复制收据、QA 依赖目标哈希和写入边界固定到新 packet；MGR02 决定是否批准单次最小导入/ABI 验证。
