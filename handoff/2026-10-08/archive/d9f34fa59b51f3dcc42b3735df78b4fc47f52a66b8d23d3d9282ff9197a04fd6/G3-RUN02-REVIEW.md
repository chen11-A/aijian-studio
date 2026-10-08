# G3 run-02 静态复审包

状态：`G3_RUN02_STATIC_PACKET_READY_REVIEW_REQUIRED_NOT_RUN`。本目录没有 `GRANT.json`、`run-02` 或 `launch-02`；未启动 G3。MGR01 范围复审及 MGR02 新单次授权仍是下一步门槛。旧 run-01 的授权、runner、数据库、原始 RED 与 EXIT 均留在原目录，不覆盖、不重跑。

## run-01 RED 与原因

- 原始 `run-01/RED.json` SHA-256 `EA9B2CC1DA134A40C2C55CD4D7EDCF4929BD82D8D1DE8542E3C80FDE8E618843`：`RED_STOP_NO_RETRY`，G3 阶段，第 542 行直接更新不可变的 `media_asset_rights_decisions.evidence_sha256`，被 schema27 触发器以 `sqlite3.IntegrityError: media asset rights decisions are immutable` 拒绝。
- 原始 `launch-01/EXIT.json` SHA-256 `AA0C6353E1750F507EA37BF8FCBA999B27630C9DE8585B8DAEAF89F125841D07`：pid 18168，退出码 1，未超时、进程已退出、无 receipt，隔离 profile 仍为 4 目录/0 文件/0 链接。
- 两个先于 RED 写出的局部 case 不改变整体 RED 结论。该 RED 是 QA 坏链种子不可达，不能反推产品的 `RIGHTS_CHAIN_INVALID` 成败。

## 新坏链种子及两阶段门

DEV01/DEV06 独立只读复核 schema27：decisions 的更新与直接删除有不可变触发器；head 到 decision 有复合外键。正常 store 建立一条有效 decision/head 后，在**新独立 QA case DB** 中保持外键启用、CHECK 未忽略和不可变触发器存在，仅用参数化 SQL 删除匹配的 head。没有发现正常用户 API 可达的删除路径；此例明确属于离线逻辑坏链故障注入。

纯 SQLite 探针 `HEAD-DELETE-PROBE.json` SHA-256 `E9489EA34430C370595C2FF66BD4921E49DFF1A92ED26F51A491F90421349E39`；探针 DB SHA-256 `03B62699C90DA2D3203D760C02B02C6B916B5A0FADF441CCFDF5BBBE66D5EAF3`。独立副本删除前有 1 条 decision/1 个 head，删除后仍有 1 条 decision/0 个 head；decision 与 ASV 行不变，外键检查为空，`integrity_check=ok`，不可变触发器保留。此探针未导入产品、未运行 G3。

新 runner 在独立 bad-chain DB 中：

1. 通过产品 store 正常追加 r1，检查 decision/head、外键、CHECK、触发器与数据库完整性基线。
2. 只在该 QA DB 删除恰好一个 head 并提交，关闭连接；重新只读打开，验证 decision/ASV 行不变、head 为 0、外键/CHECK/触发器/完整性仍符合预期，先写 `CASE-BAD-CHAIN-FIXTURE.json`。
3. 再调用产品 assembly，预期 `RIGHTS_CHAIN_INVALID`，并对比 artifact/head/decision 表在拒绝前后不变。若任何一步失败，记原始 RED 并停止，不关闭约束、不换种子自动重试。源码 `_validated_history` 对“有历史而无 head”预期 `CORRUPT_HISTORY`，assembly 映射 `RIGHTS_CHAIN_INVALID`；该行为尚未由 run-02 验证。

## 包绑定与验证

| 文件 | SHA-256 |
| --- | --- |
| `PACKET.json` | `3532741366F51A45A4A6C1180BB3C887DA994C4F6018C570D1F2EC773EA9A233` |
| `g3_once.py`（固定 Python 消费者） | `2998521940496230424361950861E93964182486AEAF035D8F33CB0EFA105EB0` |
| `launch_g3_once.ps1` | `20D3C94D6A4FBD3A1A6E5218AE205009A406634CDC94A4AC28E876EF5E6BD342` |
| `LAUNCH-PACKET.json` | `8AA7886C991B9B15CB485B0321D15FC1C33391DFA5EC07BF8017EA47AC1745CE` |
| `STATIC-REVIEW.json` | `7FB675B359E195A6DC98750759AC60D4893ED8E0E19E6FB9D51F4FAB50CF02A4` |

固定 Python `-I -B` 静态回读产品 153 文件、依赖 157 文件、历史闭包 24 模块；runner AST 可解析。PowerShell launcher 解析 0 错误。隐藏、清洁 8 键环境中的纯哈希探针退出码 0，stderr 空，新 runner 哈希匹配；`HASH-PROBE-STATIC.json` SHA-256 `6EC5933350F890CCF61DACA57F9AE88A6703802D55E271FAADCB6DDB6083CC16`。新 profile 保持 4 目录、0 文件、0 链接，未导入产品或执行 runner。

run-02 仍限定 core153 的 rights store/assembly 本地子门；reader 缺件，`NO_DECISION` 等 reader 状态与公开路由继续 `NOT_RUN`。合成权利声明不代表法律审核，header-only 媒体不代表真实播放或探针。即使后续 PASS，也不构成 native、provider、真实导出或最终产品验收。
## 受保护 runner 的读取视图

同一路径 `g3_once.py` 在 PowerShell 原始读取视图中为 42,917 字节、SHA-256 `2D1A728DB6B0104D1C4EDFE41C741E0F7EB4852739C2709E689020CEDECB06DB`，头部包含 `E-SafeNet`；固定 Python `-I -B` 消费者读取同为 42,917 字节的可解析源码，SHA-256 `2998521940496230424361950861E93964182486AEAF035D8F33CB0EFA105EB0`。后者同时匹配 PACKET、LAUNCH-PACKET 与隐藏清洁环境哈希探针，故当前不是 runner 漂移。原始双视图证据见 `RUNNER-VIEW-AUDIT.json`，SHA-256 `AB88A7CA61B01D0AEB659A99DD8DFA5C43EC39C4311B92237977177BBE0757DE`；未修改 runner、packet 或 launcher。