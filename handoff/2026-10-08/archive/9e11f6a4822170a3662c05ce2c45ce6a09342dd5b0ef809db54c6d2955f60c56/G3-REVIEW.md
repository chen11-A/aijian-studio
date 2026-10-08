# G3 rights store / assembly 静态交接

状态：`G3_STORE_ASSEMBLY_STATIC_PACKET_READY_READER_GAP_NOT_RUN`。本包只准备固定 core153 + deps157 的 QA 静态材料；没有 `GRANT.json`、`run-01`、`launch-01`，没有执行 G3，没有触碰产品或 c19，也没有调用 provider。MGR01 范围审查及 MGR02 单次授权仍待完成。

## 固定输入与包

- `PACKET.json`：`9E7ED36A095233794DE659377A5F794877967C7B824CB3167A9C089D0E013A56`；固定产品 153 文件、依赖 157 文件、历史闭包 24 模块。
- `g3_once.py`：固定 CPython 3.12 `-I -B` 消费者 SHA-256 `5DBC45B7B65F136E988CB3A8950A91250D8F693EB29CA0EE2B5880D5F92B70A7`；AST 解析通过。PowerShell 对受保护 `.py` 的本地视图可能不同，哈希以固定 Python 读取值为准。
- `launch_g3_once.ps1`：`769F770029CD1754A3E5EAA80CA5AC212E23173967C464018CFD1C7F308904C5`；PowerShell 解析器 0 错误，隐藏进程和隔离的 8 键环境已静态核对。
- `LAUNCH-PACKET.json`：`8152C1B7FD92FEEC54CC65F931AF9AED2C9EBB8EB5B70C61ECAE42F576A578FE`；`HASH-PROBE-STATIC.json`：`70C415B3DA6776AED569C80D59465F340ADC33AEB7CDA2D451898F91003A0D9F`。哈希探针没有导入产品或运行 G3。
- `INPUT-PREPARED.json`：`5F0AB5B2C963CA282A1AA3C865EB48606260BB2DAE937AC95012864A4A75E9A4`。JPEG/WAV 是仅含头部的合成样本；不声称可解码、实际播放、真实授权或真实探针。
- `PROFILE-PREPARED.json`：`CA4D285AD233B38EE1E55E2EB13DDFA4423202222AAC4A67B7D69D9ED317FC6F`；准备时隔离 profile 为 4 目录、0 文件、0 链接。
- `LONG-COPY-STATIC.json`：`80F0081CF8097041B87B5C43C80051901783B87308057BF0B5909F53CB17D20D`；仅验证纯 QA 的 Windows 长路径复制，不是 G3 执行结果。
- `STATIC-REVIEW.json`：`D25B20637453199D59FD2B6D075A7C2EDF10098905AF762A805354BCAA711322`；`EXPORT-STATUS-STATIC.json`：`7C2D88CCF3EEB5577CFD80C141B96C81965F3A9F72362AFC43791C4CB89E08CD`。

## 单次运行计划的局部用例

授权后 runner 只写 `run-01`，从合成种子分别复制五个独立 case DB（共六个 QA DB）。首个 RED 记录原始异常并停止，无自动重试。

| 用例 | 预期局部观察 |
| --- | --- |
| 无人工决定 | store `audit_history` 为空；assembly 为 `PENDING_REVIEW`；rights reader 的 `NO_DECISION` 不运行 |
| 权利链 | 合成 r1 `CLEARED`、同操作重放与冲突、陈旧修订冲突、r2 `RESTRICTED`；旧 assembly 读回 `BLOCKED_RIGHTS`，新建被 `RIGHTS_RESTRICTED` 拒绝 |
| 损坏链 | 单独 DB 篡改合成证据哈希；新建被 `RIGHTS_CHAIN_INVALID` 拒绝且 artifact/head 不变 |
| 缺失资产版本 | 单独 DB 指向不存在的 ASV；`ASSET_VERSION_NOT_FOUND`，artifact/head 不变 |
| 未探测音频 | 单独 DB 中合成 WAV 仅导入，assembly 返回 `BLOCKED_MEDIA_PROBE`，无实际媒体探针 |

当前固定 `episode_media_assembly_contracts.py`（7583 字节，SHA-256 `DBC5661A1721B9CFD8A27B95490DB0DDE759C5439AA9C6A463C51D6023E5B0E8`）的 `EpisodeMediaAssemblyVersionData` 第 170 行定义 `export_status: Literal["NO_EXPORT_CLAIM"] = "NO_EXPORT_CLAIM"`。固定 Python 以源码字节及 AST 核实，runner 第 443、491、596 行的 `export_status` 断言保留；这只是字段存在性的静态证据，不是运行通过证明。

## 证据边界

G1 receipt `C6190EA14BC38CC922B5A6F3DA0260A0F6E53EAD37233F93CE17BAA276F3DC02` 与 G2 receipt `0F5ADCCA4709501A0279DF66A7037632E584EAC06107276683185418EDC40F72` 为当前组合的迁移和受管 ASV 局部门结果。G2 可写 DB 未复用。DEV06 旧阴性结果 `28C1058D4C74D3E8D504816763997E129AB42A3E5777C88EE196601849598488` 只供版本绑定的负例参考，不能推出本次正向权利链通过。

固定 core153 产品包没有 `aijian_api/media_asset_rights_reader.py`。因此 reader 的 `NO_DECISION`、`VERIFIED`、`CONFLICT`、`UNKNOWN` 和公开路由均为 `NOT_RUN`；store 空历史不能替代 reader 状态。局部权利链也不表示法律审核通过。即使以后单次 runner PASS，也只可记为 `PASS_RIGHTS_STORE_ASSEMBLY_LOCAL_SUBGATE_ONLY`，不构成 native、provider、计费、真实播放、导出或最终产品验收。