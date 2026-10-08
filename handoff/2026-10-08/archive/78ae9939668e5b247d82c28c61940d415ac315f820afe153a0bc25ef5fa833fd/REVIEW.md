# core154 reader：分门静态复审包

状态：`STATIC_PREPARED_NOT_GRANTED_NOT_RUN`。本目录只准备 QA 输入和门禁脚本；**未导入 reader、未调用 reader、未执行 G0/G1 启动器**。两个 grant、attempt、run、launch 均不存在。旧 core153 的 G1/G2 回执仍只绑定 153 文件，不重标为 core154 通过。

## 分门建议

1. **G0 导入身份**：MGR01/MGR02 独立复审后，单独签发一次 G0 grant。固定 Python `-I -B -S`、八键净化环境、QA core154 包与 QA 依赖目录。runner 核对产品 154/154、依赖 157/157 的消费者字节与前后完整库存，实际导入 `aijian_api.media_asset_rights_reader`，回读 reader 与四个直接依赖的 `__file__`、SHA、符号以及全部已加载产品/依赖模块；禁止作者/c19/sys.path 回退、额外文件、`.pth`、写入和外部进程。**不调用 reader，不打开数据库**。
2. **G1 只读行为**：仅在 G0 回执经 MGR02 独立回读后另签一次。grant 必须绑定该 G0 回执实际 SHA；当前 G1 packet 以 `BIND_IN_G1_GRANT_AFTER_G0_ACCEPTANCE` 标示此后置输入。新的隔离进程重新验证导入身份与 154/157 前后库存，使用 14 个独立合成场景验证状态、当前 revision/决议/哈希及数据库与 sidecar 前后字节稳定性。结果只证明合成人类声明链上的 reader 行为，不证明真实法律授权、provider、UI、导出或发布。

## 当前确切字节

| 文件 | SHA256 |
| --- | --- |
| `G0-PACKET.json` | `F37A4A13071217501CC6944EDAEE8F78F20306A80811A27003E9887854B866C8` |
| `G1-PACKET.json` | `3D74E377B9B2D54B796EB7087C2D0320948C74BD5704E255B1257E669622F90F` |
| `g0_import_once.py` | `079506BCE37069D831AF4E1798DCF3216276624C11B49C18E47E5281657C6488` |
| `g1_behavior_once.py` | `23C02D0DF065B079A270A819F088F7B542AB88DDF0592482DD3DFDA2D60949DD` |
| `gate_common.py` | `5AEF0F8DA91EBC73F5EDA689A490F5D4FFCE4E015ADD20F75091116B357251EB` |
| `launch_gate.ps1` | `57A53997230078CB6FC89BB5E682ECDC035AFEEF85E7F7C66756B3B114098CFF` |
| `FIXTURES.json` | `113126C0CBDE0F6FAFC08C2E04A454F564E2E07DADCC94146F5F3B3165D96AC8` |
| `CASES.json` | `95BE659FFB90A6855F491BC39256AAE5199E38C29BA8F6A0E5C874435F4A8AB9` |
| `G0-STATIC-HASH-PROBE.json` | `5DFCE9068AB82096D3AAF0D424832AF06300969A46F902ACBC5B6725872C250C` |
| `G1-STATIC-HASH-PROBE.json` | `49B4F55C5F6DCC072245C5134E579F3A765031C3ACD9C94705FDEF28BD19D510` |

core154 物理复制回执 SHA `1143AC678D4C52F2AFD29AF69845C8D482CA0EBDFCDBAFF1EE88DA85F35DD847`；目标目录为 `C:\Users\Administrator\Documents\Codex\2026-09-23\aivora-git-c-users-administrator-documents\work\native-source-qa-20260924\qa02-core154-reader-copy-20260929\qa-physical-package`。reader 消费者 SHA `BF38C626440888D474872C8C7E6093EC96F41B0211A66EAE1870A8B6D52EE676`，四个直接依赖 SHA 已逐项写入 G0/G1 packet；PowerShell 原始读取视图曾出现 `E-SafeNet LOCK`，因此以固定 Python 消费者视图和实际 `__file__` 作为执行门禁，保留该视图差异。

隔离依赖来自 QA01 已复制的 `qa-deps`，157 个文件、7,767,087 字节，复制回执 SHA `06F94B6B635C38B864B339AB3FA934BA7F7D07071EEE5C84902BF93975A5EB22`。静态准备将该 QA 目录逐文件与冻结候选清单核对 SHA，无 live 作者源回退。

## 独立数据库样本

14 个场景分别使用独立 DB 或明确的缺失/非绝对路径：`NO_DECISION`、`NOT_FOUND`、四种 `CONFLICT`、`VERIFIED/CLEARED`、`VERIFIED/RESTRICTED`、坏链、坏 head、缺 DB、非空 WAL、非绝对路径、超过 256 MiB 读取预算。12 个样本有数据库文件（其中预算文件故意不是有效 SQLite）；另有一个故意非空的 WAL。样本文件总长度 279,609,394 字节。可打开的 11 个库 `user_version=30`、`integrity_check=ok`、`foreign_key_check` 无违反。

种子来自 QA01 G3 原始 `seed/workspace.sqlite3` SHA `1F0939AC387C00ABB30B72A453584FFF21CA28693CD3A10BA0B28D0BD2B992B6`，两条合成决议链源 SHA `37A4208646DAACB778E3A58A60F38E48B6AD2572E89D78ACBD1CFBE148188C31`。静态准备以标准库重新核对两条决议的 evidence/request/content 哈希，复制为本岗独立库，并生成坏链/坏 head 等定向样本。合成 actor 为 `qa-synthetic-actor-no-legal-authority`。QA01 G3 此前因不可变触发器 RED（`run-01/RED.json` SHA `EA9B2CC1DA134A40C2C55CD4D7EDCF4929BD82D8D1DE8542E3C80FDE8E618843`）；这些样本不改变或覆盖该 RED，也不把旧 G3 判为通过。

## 静态验证与执行预算

- Python AST：两个 runner、公共校验和三个准备脚本通过。`launch_gate.ps1` 与 `static_gate_probe.ps1` 的 PowerShell 解析错误各 0。静态净化探针 G0/G1 均只运行固定 Python 哈希计算，观测恰好八个环境键、`-I -B -S`、固定初始 `sys.path`、runner/公共校验 SHA 一致；各 profile 前后为四个子目录、零文件/链接。静态探针首次解析 RED 的原始摘要保存在 `STATIC-PREP-FAILURE-01.txt`；随后刷新包时的静态脚本 RED 保存在 `STATIC-PREP-FAILURE-02.txt`，旧 packet/探针以 `-draft01` 和 `-draft02` 保留；均未运行门禁。
- 两门各有独立 profile、grant、attempt、run、launch 根；启动器只接受 `-Gate G0` 或 `-Gate G1`。已有 grant 文件时，启动前即独占创建相应 `ATTEMPT-USED.json`；首个预检或运行 RED 保留原始 stdout/stderr/EXIT 或 `LAUNCH-RED-STOP.json`，不重试。子进程隐藏、八键净化环境、双流异步读取；哈希探针限 30 秒，runner 限 120 秒，超时杀子进程树并有界收尾。执行时只允许本岗证据目录写入；reader 的数据库输入均为只读测试副本。
- G0 grant 至少绑定 `status=APPROVED_SINGLE_RUN`、`scope=CORE154_READER_G0_IMPORT_IDENTITY`、`approved_by=MGR02`、`mgr01_scope_reviewed=true`、`clean_environment_approved=true`、`one_shot_run=g0-run-01`、packet/runner/common/launcher 四个当前 SHA 和 packet 内的 approval ID。G1 使用自己的 scope、`one_shot_run=g1-run-01` 与四个 SHA，另需绑定经独立接受的 G0 回执 SHA。当前两份 grant 均不存在。

后续 Sub2API 配置与一次许可 QA 须独立交接；未取得真实 provider 参数及许可前不运行真实调用。
