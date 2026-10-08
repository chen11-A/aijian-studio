# B31 G2 13 步故障回滚静态方案与冻结包

状态：**QA-only 静态就绪，未运行、未获 G2 授权**。本目录独立于已完成的 G0/G1 prep-02。须先由 MGR01 对此确切包复核范围，再由 MGR02 对 G2 单独签发一次性 GRANT.json，写明 approval_id 并绑定 G1 实际回执 SHA。G0/G1 授权不可复用。

## 固定输入 SHA-256

- PACKET.json：74F119379A8BACFFEF821BD002A850D2B6C92087E9CD7D6653A9120585F8BC69
- g2_once.py 固定解释器 consumer：903D8FF74F9F9F9EDEEE1266B5192A35CC9963CA9DEF473DAA2DFCB1DA890818
- launch_g2_once.ps1：B6041A83D6E2E0330DAF4B78E2DE08163F1752C73FF23C460290A6696BA9A3DD
- LAUNCH-PACKET.json：633C2D037DB57599977ADD18674E30E4B4E7730AE3859A920EFD2CB28CFE0911
- FAULT-SPEC.json：74DF728CD6D1D7D8D7CB6B755873EC4F97A797720008DA1E5074F061366FA4F8
- PROFILE-PREPARED.json：B1BCB7FF2B903C3236EE216D6A9CF8FBB940CD5BD3933DC614CF01A86A7B8BAF
- HASH-PROBE-STATIC.json：3C8890107F8AB3B932A3119B3D91A60541C605A7BB8CA44DF6E2504F507B37B1
- STATIC-NEGATIVE-CHECKS.json：584C0D62E83F5B412E769645BA963E7B9B481CBE6721000B3688410D1D10DD7A
- 前置 G1 run-01/RECEIPT.json：82AD81B7DCC0539B466D6C87CB622ECD8DC12923944A6ADEB40FA7D9A4F7A918；G1 POSTRUN-REVIEW.json：71E346B8539874E83B58C7274391F45A9456B50AC332AD452A9D9DE98D240AE1；只读 schema30 种子 DB：21FECEFCF8DECE3509A1DA8D70FE22F9521E00CEC20164F31FBF282608FD4D24。

B31 QA 目标物理包 153 件、隔离依赖 157 件均已逐件固定；Python 使用固定 CPython 3.12.13 -I -B。产品/c19 无写入授权，真 Vault/provider 不调用。

## 单次启动和输出

launcher 只在固定 GRANT.json 存在后先以 FileMode.CreateNew 独占落盘 ATTEMPT-USED.json，随即在同一次 try/catch 中核授权、G1 回执、所有固定哈希、空 profile、清洁 8 变量环境及隐藏纯哈希探针。已有 attempt、预检 RED、超时或不完整输出均停止，同目录不能重进。子进程原始 stdout/stderr 保存为 .bin；Kill(true)、进程回收及双流等待均有界，未退出或流不完整只能 RED。PREPARED、EXIT、ATTEMPT-RED 和 run-01/RED 按发生阶段留证。

## 13 个受控故障案例

runner 在 G1 已验收的 schema30 种子库上只读核验 user_version、旧 9 列、六条连接、一条 SUB2API 引用、旧外键与 trigger、integrity/FK 后，为 step-00 至 step-12 各复制一份独立 DB。migration_hook 在 schema31 的 13 条 SQL 每条执行后被调用；每个副本只在对应索引 0..12 抛出一次 InjectedMigrationFault。只有捕获到该确切异常且钩子序列为 0..该索引，才进入该案例的回滚核验；其他异常、缺失异常或索引错位立即 RED，不运行后续案例。

每例回读独立副本的 schema30 语义快照，与种子基线比较全部 sqlite_master SQL、旧连接与引用行、列、外键目标、user_version、integrity 和 FK；非空 WAL/journal/SHM 侧车为 RED。记录副本 DB 的前后 SHA，字节相等与否为观察项，**PASS 判据是完整语义回滚及无未处理侧车**。十三例均完成后，才复核 153/157 输入前后与实际模块 __file__/SHA、G1 源种子 SHA，并写仅限 PASS_B31_G2_13_STEP_ROLLBACK_ONLY 的回执。G1 成功迁移已由独立 G1 门证明，本门不做成功重放。

## 已完成静态核验与未完成项

固定解释器 AST、PowerShell parser、产品迁移源码钩子顺序与 13 条语句、13 项规格、153/157 文件、G1 回执与种子 SHA、profile 4 目录/0 文件以及纯数据负例均通过。当前无 G2 grant、attempt、run、launch 或 DB 副本；上述都是预期运行判据，不是故障回滚实测。MGR01 确切范围复核与 MGR02 独立单签之后方可启动一次。G3–G6、CAS/rotation、provider/Vault/native 与整体验收仍独立。
