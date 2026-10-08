# QA01 repo30 隔离迁移 QA 审签计划（未运行）

日期：2026-09-28。目标是验证冻结的最小 schema 30 包，不导入或执行活动作者树，不写 c19、用户数据库或既有 QA 数据库。当前仅完成静态检查；本计划不是迁移通过记录。

## 已固定输入

| 冻结输入 | SHA-256 / 结论 |
| --- | --- |
| `20260928-schema28-30-migrations-4-1/SNAPSHOT.json` | `F9F5A954B2E7A59DE4B6C1FA0A0CE0A69EEB6F64BDEB9EA8E36402401D43913E`；四目标文件逐个重算与清单匹配。 |
| `migration-evidence/repository-v27.py` | `F5809A08198C6D7AC9C3EF8979761803912C59EA9E3B729BF31C8A2F1B241441` |
| `migration-evidence/repository-v28.py` | `DE23D555DB26006959DC0713773F5CC1E382B6B7A5DB565DA505FE412305161C` |
| `migration-evidence/repository-v29.py` | `D60D35D5FEA00B2C0804565FB039135306386669EE4D1A921807F0D085C5D939` |
| `migration-evidence/repository-v30.py` 与目标 `repository.py` | `C21049176963798A3D0DE0748EAFD5FF41F0294C759939A31BDFD694C5C43DD8` |
| 28 / 29 / 30 schema 文件 | `product_export_schema.py` `5FE02402F77DEF10B0DA1CFE4FDEBE548F568EBE42FE3B1A471F7123D4E07EFE`；`episode_script_confirmation_schema.py` `498B350F96D12DEFFE18A05CCECDD3143A2DB0EBEDCA4E1BB8F3FEB942F3AB3E`；`media_asset_probe_schema.py` `BCCC47943DCDCDA87DED8CD218EEEFF20F19F461CD7E85FEFE9BD3E52EB36A4A`。 |
| 27 rights schema | `20260928-rights27-backend-7-1/media_asset_rights_schema.py` `3F875459907319E7365A3D021D2803E5146DDB71C73E99DF44E2E38DF82C91FE`。 |
| 23 / 26 repository | `20260928-schema24-26-migrations-4/baseline/repository.py` 为 schema23 `D210EC7936267BF56B7B8CBB5DE33D30153629CC1D72A63CCF23E44BAADE72E5`；该快照目标 schema26 repository `BB366B214157007E2CB906EEADDC895E1ED60AE95DC97D86BEE686F137710E69`。 |

静态逐版核对：v27 仅含 27 rights；v28 含 27、28 export；v29 含 27、28、29 script confirmation；v30 声明 `SCHEMA_VERSION=30` 并含 27、28、29、30 probe。`StudioRepository._initialize` 对每版独立 `BEGIN IMMEDIATE`、设置 `user_version`、`commit`；异常 `rollback`。这表明可设计分段迁移测试，尚未证明导入闭包或数据库运行结果。

## 预检闭包与执行门

MGR04 后续提供 `20260928-repo30-isolated-migration-preflight-1/SOURCE-CLOSURE.json` SHA `3D996986C7ED080B7994EF91ED17674E3E864C12F5402974AA1F6E90477605AE`，其路径字段指向活动作者树，仅作来源记录。该冻结包实际有 `aijian_api` 的 24 个实质 `.py` 和空 `__init__.py`；QA01 独立重算 `PREFLIGHT.json` 所列 25/25 文件 SHA 全匹配。`PREFLIGHT.json` SHA `66CA4637BAB4104C5C42C9F1ED696F82C806CF3B52B8B3C853BD6F87F77EAFDC` 只是经理预检（空库0→30、v30 step0 注错），不代替旧数据独立 QA。冻结包已有预检 `__pycache__`，本 QA 使用 `-B` 且只复制 `.py` 到新 staging；不写回原快照。

当前没有缺失的 repo30 冻结输入。执行仍须 MGR02 审签脚本与封套，运行前按清单重核 25 个哈希、所有版本 repository 与解释器，且断言每个 `aijian_api` 导入模块的 `__file__` 位于本次隔离 staging。不能从闭包 JSON 的活动作者路径导入。

待审脚本 `verify-repo30-isolated-migrations.py` SHA `51E1C587779AB8F471AA83414A3E6A2FD713C350BD0A17A22EDC7705A6F41F62`，单次封套 `verify-repo30-isolated-migrations-once.mjs` SHA `36DB0D8165277691489EF57AD9B22F2833921969A7A64959AF4ACC42EF723CE9`。仅做过 Python AST 解析与 Node `--check`，均退出 0；**没有运行 QA 脚本或导入产品模块**。封套要求 MGR02 单次 `REPO30-ONE-SHOT-APPROVAL.json` 精确匹配两脚本 SHA、闭包 SHA 与输出路径；该审批文件目前不存在。

## 待审签的最小执行包

1. **固定与封装。** 仅从 MGR04 预检冻结包复制 25 个 `.py` 到全新外置 staging（不覆盖），重算每个实体 SHA，静态检查 `aijian_api` 导入边。为 v23/v26/v27/v28/v29/v30 各建独立 staging 包：其唯一 repository 版本按上表替换，其余模块仅来自闭包。固定 Python 解释器字节 SHA；对未知模块、漂移和 staging 之外的项目导入立即拒绝。每个包和运行前 manifest 都保存 SHA。
2. **独立 profile 与原库。** 输出根拟为本目录下一个运行前不存在的 `repo30-isolated-01`，仅在其子目录创建 `profile-v0`, `profile-v23`, `profile-v26`, `profile-v27`, `profile-v28`, `profile-v29`。所有数据库统一为各 profile 的 `workspace/workspace.sqlite3`。先在冻结 v23 包创建合成项目及默认集，保存闭库原始 DB、WAL/SHM（若有）、在线一致性 backup、原始 SHA、`user_version`、表/行逻辑摘要及 FK/完整性；从该原始库的隔离副本导出各版本起点。v26-29 起点由相应冻结包各自升级独立副本，并保存闭库原始快照。绝不拿现存用户或历史 QA DB 当可写输入。
3. **成功路径。** fresh v0→30；旧 v23/26/27/28/29 的各自隔离副本→30。每个副本只升级一次。结束核 `user_version=30`、`PRAGMA integrity_check='ok'`、`foreign_key_check` 为空、合成项目/集 ID 与非新增表逐表逻辑摘要不变；关闭进程后由新进程再次打开/只读核对，再次构造 v30 repository 只验证幂等不开新迁移。成功不意味着业务路由或用户库升级验收。
4. **失败回滚。** 对 27/28/29/30 每版各用一个新起点副本，以 `migration_hook(version, step)` 在该版第一个 statement 执行后抛出唯一标记异常；保留原始 traceback/exit/stdout/stderr。失败副本核 `user_version` 仍为前一版、该版新表/索引没有部分落地、旧数据逻辑摘要/FK/完整性不变。不在失败副本上自动续迁；如要验证可恢复，另取原始副本作独立一次升级。
5. **拒绝与门槛。** v30 repository 面对 `user_version=31` 的专用合成库，应抛 `SchemaTooNewError`，不降版、不修改其逻辑数据。污染、缺模块、hash 漂移、非法输出路径均在任何库打开前拒绝。只对合成数据证明，无真实资产、rights、provider、MLT 或产品导出调用。
6. **封套与证据。** 单次 wrapper 在 spawn 前校验脚本、解释器、闭包、全部 staging 源、输出目录空和绝对路径，记录命令/参数/cwd/env 允许项、PID、开始/结束、超时与退出码，保存原始 stdout/stderr、每库原始/backup/迁移后 SHA、SQLite readback 与失败证据。子进程有界超时，超时先终止再回收；任何失败停止整包，留现场，不重跑同一 run。测试前和结束后检查无 sidecar、encoder、MLT 子进程；本包本身不启动它们。

## D 生命周期后续独立门（等待新冻结候选）

当前 DEV05 冻结 sidecar `B95B9C4E7638EBE7F32152EDEA8A5911AA2C2AA30721F12D416D6758E83B35AD` 在 `run()` 第408-413行于 listener/repository 前拿锁，同 workspace Busy 打印精确信号并退出 73；第484-506行只在已启动 worker 的 `stop()` 无错误后释放锁。此前锁模块 `94F62129...` 的单模块本地隔离测试已有独立 PASS，但不能替代双 sidecar 或 Job 顺序。

现有 D 4-1 `ProductExportJobManager` `11A57628...`、service `C627B783...` 还未由 B95 sidecar/main 持有或调用；旧 service/coord 是同步执行形态。DEV08 独占新的 claim/执行分离与 `stop_accepting/join`，DEV05 独占 main/sidecar 接线。**整链生命周期唯一当前阻断**是这两位 owner 的新候选尚未冻结并由 MGR04 固定完整依赖。收到后另审双 sidecar Busy73、unsafe 路径、异常保锁、同 operation 不二次调度、claim 后线程失败 UNKNOWN、Job 子进程与 worker 退出先于 owner 锁释放；每种情形使用独立 profile/raw/cleanup，不以当前旧同步包作整链验收。
