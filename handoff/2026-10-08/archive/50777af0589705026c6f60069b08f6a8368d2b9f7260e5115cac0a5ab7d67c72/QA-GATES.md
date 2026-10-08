# B31 独立 QA 门序（静态方案，未运行）

对象是 DEV01 的 `D152 + exact3`：保留 D152 152 路径中的 150 项，替换 `repository.py` 与 `provider_connection_repository.py`，新增 `provider_credential_ref_schema.py`，形成独立 153 路径 QA 物理包。schema30→31 的旧 G1/G2 PASS 不能继承。本文件只是门序与预期；没有测试 runner、授权、seed DB、迁移结果或运行证明。DEV05 的服务/worker/Vault 完整消费链未冻结，G6 单独等待。

所有未来运行须采用固定解释器 `-I -B`、独立 clean profile、固定包及依赖前后全量哈希、实际 `__file__` 映射、每例独立 DB 副本和隐藏进程。首个非预期 RED 保留原始 DB/WAL/错误并停止；预期故障必须事先列入 case，不自动重试、不把恢复动作藏在同一失败 case。

| 门 | 输入与观察 | 停止/边界 |
| --- | --- | --- |
| G0 消费身份 | 核 153 项完整消费者字节/SHA、157 项依赖字节/SHA；只导入 repository、provider repository、migration31 所需模块并记录 `__file__`。 | 不能回退作者树、c19 或 core153；导入通过不代表迁移或服务 PASS。 |
| G1 迁移 | 独立空库走 1→31；另用 schema30 种子，覆盖允许的 provider kind、多个 revision、models、disabled、被既有表引用的 connection。逐列比较旧值；新 `credential_ref=connection_id`，rotation 表空；`foreign_key_check` 空、`integrity_check=ok`，显示名唯一及 CPA/SUB2API 约束保持。正常关闭重开 v31 再读回。 | 旧 v30 PASS 不代替；真实旧 Vault 槽可读不在此门。v30 程序打开 v31 应拒绝，不就地降级。 |
| G2 故障回滚 | 固定 13 条 migration31 SQL；在每条语句后的 `migration_hook` 分别注入预期异常，每次从同一只读 v30 seed 复制到新 DB。核 user_version=30、旧表/数据/引用、索引保留、无 v31 临时表/索引/触发器、外键与 legacy_alter_table 恢复。 | 逻辑状态与外键为判断依据；不能仅以 WAL 物理 SHA 变化判丢失。恢复迁移须事先单列独立 case/授权，不能在首 RED 后自发重跑。 |
| G3 元数据 | 旧连接 list/get 得 `ref=id`，新 create 得 `ref=id`；SUB2API metadata CAS 成功 revision+1 且 ref 不变；旧 revision、非法 origin/models、非 SUB2API 更新拒绝且无部分写。 | 不调用 Vault。 |
| G4 轮换仓储 | prepare 后 PREPARED 持久且重开可读；重复 operation、跨连接 ref、非法 id/ref、重复候选 ref 拒绝；apply 在单事务更新 pointer/revision 与 APPLIED；竞争导致 CONFLICT 落库但 pointer 不变；identity 不符、UNKNOWN/终态不重放；有历史时删除 connection 受阻。 | schema 允许 UNKNOWN→APPLIED/CONFLICT 不表示仓储自动恢复；必须查回。 |
| G5 UNKNOWN | 使用单独 QA 事务故障代理分别模拟 commit 前异常和“已提交后向调用者报错”，先验证代理能准确模拟，再用新连接只读查 operation、connection。不得重复 CAS/Vault set；APPLIED 不能被 mark_unknown 降级。 | 仅合成 SQLite 边界，不代表真实磁盘故障或 Vault 原子性。任何泄漏哨兵只在进程内，输出仅布尔与计数。 |
| G6 DEV05 服务消费 | 待 DEV05 固定 provider_connections/routes/readiness/worker/runtime 全链及 Vault adapter 合同后另包。 | 当前 `NOT_READY_NOT_RUN`；真实 Vault、HTTP、provider、IPC/UI、安装/发行不在三源候选范围。 |

迁移31只保存凭据引用，不保存凭据字节。旧行回填 `credential_ref=connection_id` 是数据库引用兼容，不证明旧真实 Vault 内容可读。服务侧应先 prepare、写新槽并回读、再 CAS；任何未知状态先只读查回，旧槽保留供已开始的 worker 使用。这些服务行为属于 DEV05 另门，不由本静态包声称通过。