# B31 最小迁移独立 QA 静态包

状态：`B31_STATIC_QA_PACKAGE_READY_FOR_SCOPE_REVIEW_NOT_RUN`。本包仅组装与静态核查 DEV01 的 schema30→31 三源候选；没有 runner、launcher、grant、seed DB，也没有导入产品或执行迁移。未修改 D152、core153/core154、c19 或作者源码。

## 取件身份

- DEV01 `CANDIDATE.json` SHA-256 `18FD5608A46D0F3AB2DC17A38F05D777FD33A3D48127420CCD965520C20EC37B`；`QA-HANDOFF.md` SHA-256 `DA40FD5F8B4F35F87547246536204CB24DB22AD6F157F7C4A2A9C7D9A71527EA`。
- D152 `FILES.json` SHA-256 `F3775529D3D431D5D914F80FB74552CD23B96402142808970963D75C296160E9`，152/152 固定源哈希及目录逐项匹配。新 QA 物理包位于本目录 `qa-physical-package`，153/153 消费者字节/SHA 回读通过：保留 150、替换 2、增加 1。`PHYSICAL-COPY.json` SHA-256 `60D0CCE37C426979986F70EE7DB1C82784ECD8A66550BC4F585053F264B90CF8`。
- 精确变化：`repository.py` C2104917→4032F9C2；`provider_connection_repository.py` 16004298→96DAE669；新增 `provider_credential_ref_schema.py` B170FFC0。完整 SHA 在 `STATIC-ANALYSIS.json`（`EE4E999D67772A9F299EF03ED7FA6F67534D18AECDE547ED658AD4476760E85B`）。153 个源码 AST 均可解析，静态 `aijian_api` import 目标无缺项。
- 仓储直接依赖 `provider_contracts.py` SHA `045985B9E227DFEDBE26601669BD6410EF8C6D81F7A99E1E6A961861DC4D4762`、`task_ledger_models.py` SHA `FFFA34375CBB491F111725AC330E848CF62130D12299F19C69103E2C7AA4776E` 已在 D152；复用只读依赖包 157/157 字节/SHA 核对通过，但**尚无 B31 运行时 import 或 `__file__` 证明**。

## 静态合同结论

`repository.py` 的差异限定为 schema version 31、migration31 注册及重建期间的 FK/legacy_alter_table 管理；现有 1..30 迁移定义未在该差异中修改。migration31 共 13 条 SQL：重建 provider_connections，保留旧字段值并把每条旧行 `credential_ref` 回填为 `connection_id`；创建新唯一索引、轮换表和五个触发器。空库 1→31、非空 v30→31、旧引用外键和每步故障回滚均仅有待测设计，没有运行结果。

provider repository 静态包含 metadata CAS、prepare/apply rotation、UNKNOWN 标记及只读 operation 查询。apply 仅接受 PREPARED，成功时 pointer/revision 与 APPLIED 同事务；竞争时 CONFLICT 提交后抛错。DDL 允许 UNKNOWN→APPLIED/CONFLICT，不表示仓储自动恢复。写入/提交结果不确定时应返回 UNKNOWN 并用新连接只读查回，不能自动重交 CAS 或 Vault set。这些是源码路径与 QA 预期，尚非行为验收。

[QA 门序](<C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa01-mlt-20260928/b31-minimal-migration-prep-01/QA-GATES.md>)覆盖 G0 消费身份、G1 空库/非空迁移、G2 13 步故障回滚、G3 metadata CAS、G4 轮换、G5 UNKNOWN；G6 DEV05 服务/Vault 消费链为 `NOT_READY_NOT_RUN`。旧 schema30 G1/G2 PASS 不继承为 schema31 PASS。真实 Vault、HTTP/provider、worker、IPC/UI 与发行验收均不在本三源静态包。

`PACKET.json` SHA-256 `A51BE3037084A92D9F2BF9E35C6FACD114FD908A7EA1CC6A1749638873EFFBC3`；`STATIC-REVIEW.json` SHA-256 `0A3463CB1998FA3ED2708E1C5252B1DA78C91A89D89DF43A8D8AAD61B59EAD3B`。后续须先冻结各门 runner、独立 DB 样本和实际消费映射，再由 MGR01/MGR02 分门复审与单次授权；本目录当前不可启动测试。