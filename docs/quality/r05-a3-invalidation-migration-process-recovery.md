# R05-A3：v14→v15 迁移的真实进程退出恢复

状态：R05-A3 专项独立验收通过（2026-09-04）；未整合启动目录、未推送，不代表完整 R05 完成。

## 基线与范围

- 分支 `codex/r03-integration`，精确基线 `6c1ac2b1ea6cc571d191670455725b4306b3aa0c`；编辑前工作树 clean。
- 只新增本记录和 `services/api/tests/test_invalidation_migration_process_recovery.py`。生产逻辑、既有测试、迁移 Schema、配置、依赖和覆盖率门槛均未改。
- 冻结测试文件 SHA-256：`9E61F9BCDF835DD8C2E72FF27F04D9402D51C860D3C080A2DAB3FF74569358EA`。
- 对应 [ADR-0004](../architecture/ADR-0004-recovery-and-migrations.md) 的迁移中断恢复要求，以及 [Phase 0](../roadmap/phase-0-backlog.md) 的迁移/恢复验证；不是新的生产能力。

## 检查点与证据边界

1. 使用既有 `create_current_v14_database` 执行真实 v1 至 v14 迁移，加入一条满足约束的非空项目行。该 helper 在 v15 首条 DDL 后抛异常回滚，仅用于构造合法 v14 fixture，不作为硬退出证据。没有删表或手工降低版本。
2. 崩溃前通过 SQLite backup 创建同源 v14 对照数据库；两者完整结构、逻辑行和版本一致，完整性为 `ok`，外键违规为空，v15 对象不存在。
3. 通过既有 `spawn` 子进程 helper，在生产迁移 hook 的首条 DDL（step 0）后执行 `os._exit(75)`，或最后一条 DDL（`len(MIGRATION_15)-1`）后执行 `os._exit(76)`。当前有 10 条 DDL，最后一步为 9；不硬编码最后索引。父进程断言精确退出码，因此未触发 hook、正常返回或普通异常均不能通过。
4. 这两个 hook 均在真实 DDL 执行之后、`PRAGMA user_version` 更新与事务提交之前；硬退出绕过 Python 异常回滚和 finally 清理，不声称覆盖 commit 之后或断电。
5. 独立新 reader 进程首先直接读取 SQLite，尚未构造任何仓储实例。`user_version=14`、完整旧结构与所有业务表逻辑行必须完全等于退出前快照，因此不能残留部分 v15 对象或靠应用初始化修补来通过。
6. 随后在原中断数据库上普通初始化仓储，真实升级至 v15，并与同源对照的正常升级结果逐项比较。所有旧表完整行和结构保留，新增的两张失效表为空，v15 对象完整存在；每次状态读取都验证 integrity/FK。
7. 再次正常重开要求完整结构、逻辑行和版本不变，并确认 migration hook 没有再次执行任何 DDL 步骤。没有用修复后的副本覆盖中断数据库。

结构快照覆盖 `sqlite_master` 的 type、name、tbl_name、sql，包括表、索引、触发器及 auto-index 身份，只排除物理 rootpage 位置。逻辑行复用 R05-A2 `_snapshot`，读取所有非 SQLite 内部表的完整行。这里仅有项目行非空，不宣称验证了真实小说、Artifact 正文/哈希、媒体或影片数据资格。

进程清理复用 R05-A2 `_run_child`：每个自有子进程 join 上限 30 秒，存活时 terminate/join 5 秒，再 kill/join 5 秒；仅处理本测试创建的进程，关闭句柄，清理错误不覆盖最初失败。没有新增 runner、共享队列或测试框架。

## 负向对照与增量实现

先只实现首条 DDL 检查点并运行，得到 `1 passed in 4.62s`、退出 0，再扩展最后一条和两个负向对照。没有修改生产代码来人为制造红灯。

负向对照分别在独立测试数据库中修改项目名称、增加一个索引。两种变化均仍能通过 SQLite integrity/FK，但会被首次 raw v14 完整状态比较拒绝，且拒绝后仍为 v14、没有迁移或修补；同源对照也保持不变。负向数据库不用于两个硬退出场景。这验证了数据和结构断言的敏感性，不把负向对照本身当成额外崩溃点。

## 作者实测

仅使用已有本机环境，离线、不同步依赖，所有测试串行执行。首次 Ruff 发现新增计时日志一行超出 100 字符，已拆分表达式；没有生产测试失败或门禁豁免。

```powershell
uv run --offline --no-sync pytest services/api/tests/test_invalidation_migration_process_recovery.py -q -rP
# 4 passed in 8.30s；退出 0
uv run --offline --no-sync pytest services/api/tests/test_migrations.py services/api/tests/test_invalidation_process_recovery.py -q
# 44 passed in 20.93s；退出 0
uv run --offline --no-sync ruff check services/api/tests/test_invalidation_migration_process_recovery.py
uv run --offline --no-sync ruff format --check services/api/tests/test_invalidation_migration_process_recovery.py
pnpm exec prettier --check docs/quality/r05-a3-invalidation-migration-process-recovery.md
git diff --check
```

最后四项静态检查的最终结果在冻结交接记录中列出；新增未跟踪文件还须独立完整内容审查，不能只依赖 `git diff --check`。

最终定向的首条/末条检查点分别记录 raw 读取 6.221/5.514 毫秒、完整重试检查 68.394/69.204 毫秒。`raw_v14_read_ms` 包括首次 SQLite 读取、integrity、FK、结构和全业务行比较；`complete_retry_check_ms` 从 raw 读取前累计，另外包括中断库升级、对照升级、全部验证与再次重开。两者均不包含 spawn 启动开销，不是纯迁移耗时、应用 RTO 或性能资格。

本机原始证据保存在忽略目录 `.aijian-dev/r05-a3/`：`author-first-checkpoint.log`、`author-targeted.log`、`author-related.log`。它们不随 Git 提交。最终文件与证据哈希由冻结交接记录保留。

## 独立验收（2026-09-04）

作者冻结后，执行任务 `01a064bd-e70d-7850-ad0a-7d15f594d9d2` 串行运行整体 lint、typecheck、build、diff 检查及唯一一次 `pnpm test:py`，均退出 0；没有并行测试、改动冻结代码或失败后重跑。代码与本文的独立审查未发现必要阻断项。

| 检查                     | 实测结果                                                                       |
| ------------------------ | ------------------------------------------------------------------------------ |
| lint / typecheck / build | ESLint、Ruff、Prettier、TypeScript、mypy 79 个源文件和 Desktop/Studio 构建通过 |
| 全量 Python              | 957 passed / 566.62 秒；包含本文件对应的 4 个新增用例                          |
| 主控重新核算覆盖率       | 行 9365/10007 = 93.58%；分支 2071/2474 = 83.71%                                |
| 关键模块                 | 现有门禁声明的 14 个模块均满足 100% 行/分支覆盖率；检查器退出 0                |
| 范围与冻结               | 测试 SHA-256 在作者冻结和独立运行后均与上文一致；主目录两项保护文件哈希未变    |

独立原始证据位于忽略目录 `.aijian-dev/r05-a3/independent-20260904/`：`01-lint.log`、`02-typecheck.log`、`03-build.log`、`05-full-python.log` 和 `coverage-python.json`。`git diff --check` 为零输出，没有生成 `04-diff-check.log`；不能把不存在的日志列为证据。新增文件另经完整内容审查和主控暂存差异检查。

全量日志 SHA-256：`75DDCF9BD2BD34697446807516C50CF495C198721FCDA7CAB3B77A27995F8217`；覆盖率快照 SHA-256：`10AE9CDCC211FA1C20D431DE60B83829540470E3DD7CE980C0B0B3A7BC45A4C5`。主控核对原始结果与快照、重新执行覆盖率检查器并确认该轮测试进程已退出。最终证据说明更新不改变测试代码，最终文档哈希和提交由本机任务账本记录。

## 尚未验收的范围

本轮没有生产或 UI 行为变更，因此没有重跑 Chrome/Electron，也不将此前 R04 的运行证据写成本次重新验证。作者的结果和上述独立验收分开记账。

这只补充两个迁移事务提交前的真实进程退出证据，不覆盖每条 DDL 的全部硬退出点、版本更新/commit 窗口、断电、磁盘满、损坏介质、N-2 全矩阵或 600 次资格试验，也不是授权影片、CLI 模型生成、K01、完整 R05、Phase 0 或发布验收。现有租约完成时点诊断和未根因化 heartbeat 失败记录不受本专项通过影响。
