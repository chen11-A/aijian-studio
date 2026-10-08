# B31 G2 prep-02 13 步故障回滚静态复审包

状态：**独立 QA-only 静态包，未授权、未运行**。MGR01 对旧 prep-01 的确切范围审为 false；旧包原样保留。本 prep-02 修复 attempt claim 写入失败的证据缺口，须按下列新哈希重新进行 MGR01 范围审，再由 MGR02 对 G2 独立单签。G0/G1 授权不可复用。

## 冻结 SHA-256

- PACKET.json：6109B3FCEE3C5F1BFA1E376327B3904FC5A97BAD4A2C5AC1279D7A269DAAC762
- g2_once.py 固定 CPython 3.12.13 -I -B consumer：A27780579CE10C4972DAF877DBEAEB6E509AA0093C5C7BF21672E365D3F1606C
- launch_g2_once.ps1：310CA35CDA0D0206BF95DF879AF9F35A51F2758935958A28C5F0F80665CF8DD9
- LAUNCH-PACKET.json：42FA973C7ACBE31F03E9F419C74E9F7D90B86D68FDD34D1FC62EC9E7E91A7F12
- FAULT-SPEC.json：74DF728CD6D1D7D8D7CB6B755873EC4F97A797720008DA1E5074F061366FA4F8
- PROFILE-PREPARED.json：0A1FB23939A5E239DD5123CDE571FCD1196A0C99B872D67BF5FE718FF34980EA
- HASH-PROBE-STATIC.json：4FF850ACACE031F1B868D1784C1BA06192F5031CBC410145691CDB5846486ACB
- STATIC-NEGATIVE-CHECKS.json：C290B0EECF04B8AA4752B599A161B057F8F0571F124797B467201F34620137F0
- 前置 G1 PASS 回执：82AD81B7DCC0539B466D6C87CB622ECD8DC12923944A6ADEB40FA7D9A4F7A918；G1 POSTRUN-REVIEW：71E346B8539874E83B58C7274391F45A9456B50AC332AD452A9D9DE98D240AE1；只读 schema30 种子库：21FECEFCF8DECE3509A1DA8D70FE22F9521E00CEC20164F31FBF282608FD4D24。

目标 B31 QA 物理包 153 件、隔离依赖 157 件均逐件固定。无产品/c19 写入授权，不访问真 Vault/provider。

## attempt claim 修复

固定 GRANT.json 存在后，launcher 先检查旧 ATTEMPT-USED/ATTEMPT-RED；任一存在即 no-retry，不覆盖。其后在同一 try/catch 中用 FileMode.CreateNew 独占创建 marker，设置本次已占用标志，写完整 v2 JSON、Flush(true)、关闭并回读 claim_version=2 与 claim_complete=true；随后才做 packet、授权、profile、环境与子进程预检。runner 也拒绝部分或旧格式 marker。

CreateNew 已占用后若写、Flush、关闭或回读失败，catch 先保留原始异常并尝试用 CreateNew 写最小 ATTEMPT-RED.json（记录 phase、marker_claimed、marker_complete），再做可选的 launch-01/RED/EXIT 留证。CreateNew 本身失败且非旧 marker 的路径也尝试写独立 RED；二次 RED 写入失败会输出原始错误和次级写入错误，同目录保持 no-retry。独占 marker 或 RED 不会被覆盖。进程超时 Kill(true)、回收与原始双流 .bin 收尾均有界；未退出或流不完整为 RED。

## 13 个独立回滚案例

以 G1 已接受的 schema30 种子 DB 为只读输入，step-00 至 step-12 各复制独立库。每个副本在 schema31 的相应 SQL 执行后由 migration_hook 抛一次受控 InjectedMigrationFault；核对精确钩子序列及异常、原有 schema30 全量语义快照、六条连接和一条 SUB2API 引用、旧 trigger/FK、integrity/FK、无非空侧车。任何非预期错误立即 RED 并停止后续案例。13/13 全部成立后，才复核 153/157 前后哈希、实际模块 __file__/SHA 和 G1 种子身份，回执仅能声明 PASS_B31_G2_13_STEP_ROLLBACK_ONLY。成功迁移不在本门重放。

## 静态核验和运行边界

固定解释器 hash probe、runner AST、PowerShell parser、迁移源码 13 条 statement→hook→rollback 顺序、G1/种子哈希、153/157 文件及纯数据负例均通过。负例覆盖旧 marker/RED、CreateNew、写、Flush、关闭失败和完整 claim，属于源码结构与纯数据模型核验，**不是 launcher 或故障回滚实测**。当前无 G2 grant、attempt、run、launch 或 DB 副本。MGR01 对 prep-02 的范围审及 MGR02 新单签前不得启动；G3–G6 等后续门仍独立。
