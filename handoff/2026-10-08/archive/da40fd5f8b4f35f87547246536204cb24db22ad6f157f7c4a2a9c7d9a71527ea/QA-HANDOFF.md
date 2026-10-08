# B31 最小迁移候选与独立 QA 合同

状态：三源静态候选，未执行迁移/测试/build/Vault/provider。仅在本目录封存 before/after，不修改作者产品源码、c19、core153 或 core154。

## 固定源及最小差异

CANDIDATE.json 是取件索引。基线为 D152 FILES F3775529…，repository C2104917…、provider repository 16004298…。替换 repository 为 4032F9C2…，替换 provider repository 为 96DAE669…，新增 migration31 B170FFC0…。repository 的差异仅新增31的 import/注册、SCHEMA_VERSION=31、31重建期间关闭FK及legacy_alter_table保护/恢复；1..30定义不改。provider repository的两个原有本地依赖（provider_contracts/task_ledger_models）在D152有对应符号，无须为仓储测试引入作者新版provider合同。

## 字段、表与兼容边界

migration31重建 provider_connections，保留旧列/值/显示名唯一索引及provider约束，新增NOT NULL、UNIQUE credential_ref。每条旧行回填 credential_ref=connection_id，revision和时间不因迁移递增。新create也首先使用id槽。迁移只含SQL，不访问Vault、不复制或删除旧密钥。真实旧Vault能否读回须由DEV05独立服务门验证；本候选只能证明数据库引用兼容。

新引用形式 pcn_<32hex>:crd_<32hex> 必须属于同connection；旧id引用仍合法。新增 provider_credential_rotation_operations，operation_id=pcop_<32hex>，保存候选ref、expected_revision、状态、时间和applied_revision，不含凭据字节。operation identity不变，候选ref唯一，初始PREPARED；PREPARED可至APPLIED/CONFLICT/UNKNOWN，UNKNOWN在DDL层可至APPLIED/CONFLICT。仓储apply接口只接受PREPARED，不能把DDL允许转换当作已实现UNKNOWN自动恢复。

rotation行外键ON DELETE RESTRICT且有禁止直接删除历史触发器：有轮换历史的连接删除应冲突，不能丢历史后删除。元数据CAS只针对SUB2API，成功revision+1且credential_ref不变。

## 事务与UNKNOWN

prepare_rotation独立BEGIN IMMEDIATE先验operation不存在、当前revision/类型/新ref，再持久PREPARED。apply_rotation_cas在同一事务中按connection id+revision+old ref更新指针并写APPLIED(expected+1)；CAS不匹配时先提交CONFLICT再抛VersionConflict。身份不匹配或operation非PREPARED不重放。

_write的已知异常回滚；sqlite错误与commit结果不确定返回WriteUnknown。不可自动重复CAS或Vault set；必须新连接只读核operation和connection确定实际结果。mark_rotation_unknown仅PREPARED转UNKNOWN。若commit已经成功但调用者收到错误，APPLIED不可降为UNKNOWN；如果无法查明仍报告UNKNOWN，不能构造成功证据。

Vault不属于SQLite事务。DEV05接口合同：先prepare，再向fresh candidate slot写凭据并回读比对，确认后CAS；任一步不确定只读查回。旧槽保留供已开始的worker使用，不在本候选自动清理。所有远端读凭据者必须按同一已取得connection快照的credential_ref读取，不能混用id和ref；服务/worker未整合时禁止把迁移三源称完整R可用。

## QA 样本与门序（由MGR02独立单签）

所有样本在独立受控DB目录，每例新副本；固定解释器、完整依赖SHA、__file__、输入seed SHA及153基底各源身份。before/after副本可能存在E-SafeNet消费视图差异，目标消费者须重新读完整字节并核SHA，不能回退作者树。首非预期RED停止，保留DB/WAL/raw和原失败，不自动重试。

1. B31-G0：固定D152+三源在全新隔离包的消费身份/导入门。只加载迁移和仓储所需模块，不创建应用、不启动worker/Vault/provider。记录保留依赖和新schema模块的来源；无缺符号不等于行为PASS。
2. B31-G1：有效v30种子包括各允许provider类型、不同revision、models、disabled连接及现有引用连接的操作记录。正常v30→31后每条旧字段逐值相等、ref=id、轮换表空；原引用行保留、FK目标仍provider_connections而非临时v31表，foreign_key_check空、integrity_check ok、显示名唯一/CPA与SUB2API限制仍生效。随后关闭重开31，schema和逻辑行不变。另空库1→31门；历史v30 PASS不能代替。
3. B31-G2：使用现有migration_hook在31每条语句后故障注入（逐case复制同v30库），验证user_version仍30、旧表/索引/数据和引用完整、新31表/索引/trigger无残留；FK恢复ON、legacy_alter_table恢复原值。检查rollback逻辑状态，不以WAL导致的物理hash变化单独判数据丢失。移除注入后重开仅作为事先批准的独立恢复case，不在首RED后自发重试。v30程序打开31应拒绝过新，不做就地降级。
4. B31-G3：仓储旧连接list/get返回ref=id，新create同样ref=id；metadata正确CAS一次revision+1/ref不变，旧revision拒绝且字段不变；非SUB2API/非法origin/models拒绝。此门不访问真实Vault。
5. B31-G4：PREPARED持久化及重开；重复operation不得再次提交；不同连接前缀/非法id/ref/重复候选ref由约束拒绝；正确apply同时落connection新ref/revision与APPLIED；模拟其他metadata更新后的CAS失败落CONFLICT且不改指针；身份不符不写；UNKNOWN/终态不允许仓储apply重放；有历史delete受阻。不得绕过trigger制造这些正例。
6. B31-G5：QA独立事务故障代理在commit前抛错与commit已成功后向调用者抛错，明确标注合成故障，不改产品源码。记录异常类别后用新连接查回：前者不半写，后者可能已APPLIED；任何一类不重复执行。operation查询只读，mark_unknown不得覆盖APPLIED。若proxy不准确模拟SQLite接口先判QA失败，不据此判产品bug。
7. B31-G6（DEV05服务另包）：固定内存/本地合成Vault adapter，绝不真实密钥/系统Vault/provider。验证旧id槽可读、set→get匹配→CAS顺序；Vault写失败/读回不符/CAS冲突及未知/旧worker持有旧ref边界；不得将合成Vault PASS升格真实系统Vault或供应商验收。密钥哨兵只存在测试进程内，不打印值；对stdout/stderr/异常、DB所有文本列、日志/请求审计做泄漏断言，输出只记布尔结果和计数，不保存含哨兵原文的失败日志。测试DB不能有任何secret/key材料列。

## 其他owner接口与未完成项

DEV05：provider_connections、provider_connection_routes、provider_contracts、sub2api_connection_readiness、remote_source_extract_worker/runtime、sub2api_source_extract_worker/runtime。CANDIDATE记录只读观察SHA，不纳入本包、不授权采用其完整最新树；其owner须冻结完整R消费闭包，确认create/delete/metadata/rotation、readiness和所有Vault读者一致。

DEV07：IPC/桌面DTO传递expected_revision/operation_id，UNKNOWN只读查回、不自动重提，凭据不日志。DEV04：UI区分metadata保存、轮换、冲突、未知与只读查回。精确接口由各owner确认，不在本候选跨写。

G1/G2 D repo30证据保留在原包。B31迁移、事务、真实Vault、HTTP、IPC/UI、provider端到端、安装/发行均未在此验收。