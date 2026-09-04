# R05-A2：Gate 替换事务的真实进程退出恢复

状态：R05-A2 专项独立验收通过（2026-09-04），纳入本地原子提交；未合入原启动目录、未推送，不是完整 R05 或影片验收。

## 基线与范围

- 分支：`codex/r03-integration`；精确基线：`c3a0977fe9ec6d92a9d07cb54ce6b11838bdc63b`。首次编辑前工作树 clean。
- 仅新增本文件和 `services/api/tests/test_invalidation_process_recovery.py`，不改生产代码、已有测试、依赖、配置、迁移或保护目录。
- 已测试代码 SHA-256：`22B5E3075CF602F8E64428EFF183E8B1A6F7C55BE4D13D1D10BC458CAEAC2508`。独立验证前后相同；本记录所在原子提交标识最终交付，提交 SHA 与文档哈希由主控账本记录。
- 环境：Python `3.12.13`、SQLite `3.53.1`、Windows `10.0.19045`（`Windows-10-10.0.19045-SP0`）。仅用已安装环境，`UV_NO_SYNC=1`、`UV_OFFLINE=1`。
- 需求对应 [48 周计划](../roadmap/48-week-plan.md) 的恢复条件、[Phase 0 F05/W8](../roadmap/phase-0-backlog.md) 的正确影响报告与人工后代保留，以及[只读报告契约](../specs/invalidation-report-read-v1.md)。

## 两个真实检查点

1. `multiprocessing.get_context("spawn")` 子进程在既有 `decide_gate/head_updated` hook 执行 `os._exit(73)`，绕过 Python 异常回滚及清理。此时 challenge、decision、operation、全部 paths 与 head 的修改都还未 commit。独立新进程首先直接读取真实 SQLite 全部业务表逻辑行，再构造仓储：旧 accepted head、未消费 challenge 及完整历史均与退出前相同，无部分 decision/operation/path。
2. 独立子进程调用真实 `decide_artifact_gate` 成功返回后立即 `os._exit(74)`。新进程首次 SQLite 读取已包含新 head、已消费 challenge、唯一新 decision 和完整 operation。仓储初始化与后续 GET 均不得改变这些逻辑行。这证明已提交事务的进程退出持久性，不是 HTTP 回包丢失窗口。

父进程精确断言退出码 73/74；普通退出或无关异常不能通过。每个子进程 join 上限 30 秒；只对本测试创建的存活进程执行 terminate/join 5 秒、kill/join 5 秒并关闭句柄。清理异常作为原始失败的附注，不覆盖首个失败。不存在 multiprocessing Queue：正常 reader 子进程完成临时 JSON 输出并退出 0 后，父进程才读取结果。

## 恢复与不变量

- 小图包含 accepted source、其替换版本、一个 accepted 人工 story 和一个带人工修订内容的子版本。四个版本的完整行（正文、hash、作者、父版本等）及两条精确依赖均保留；不复制 A1 大图。
- 复用 `_prepare_source_replacement_decision` 的已绑定 payload，包括 rationale `闭合失败应回滚`、revision 和 confirmation；各进程均使用生产 UUID 工厂，只固定 fixture 时钟。
- 提交前退出后，由测试显式执行一次合成 fixture approval 重试。真实公开仓储方法成功一次；重复同一请求被拒绝且全表逻辑行不变。它不是实际人类、影片或版权批准。
- 使用真实 `GET /api/v1/projects/{project_id}/invalidation-operations` 发现报告 ID，再 GET 详情；逐字段对应落库根记录与所有路径，包含 Gate/前后版本、assessment hash、路径 ID/归属、ordinal、依赖数组、blocking、accepted 人工版本的 `STALE` 与人工草稿的 `INVALIDATE`。
- 仓储初始化前后、每轮 GET 前后、再次独立进程重开前后均比较完整逻辑行。除明确预期的 Gate 事务行外所有表不变，任务、attempt、人工版本和依赖不会增加、覆盖或自动重生成。
- 两个数据库均在各轮恢复读取后通过 `PRAGMA integrity_check = ok` 和空 `PRAGMA foreign_key_check`。未手工修补数据库，也未使用 mock 或异常注入替代硬退出。

## 实测与命令

首先仅实现提交前检查点，真实运行得到 `1 passed in 1.17s`，然后才扩展第二检查点。未人为制造生产错误来获得红灯。只读审查发现首次仓储初始化前证据不足，候选已补上首次 SQLite snapshot 与初始化零写入断言；最终定向结果如下。

重开计时从 reader 内首次 SQLite 逻辑读取之前开始，到仓储初始化和 accepted head 读取完成为止；包括 SQLite 自身恢复，不包含 spawn 启动、HTTP GET、integrity 检查与全部测试时长。最终候选实测：

| 读取                   |   毫秒 |
| ---------------------- | -----: |
| 提交前退出后的首次重开 | 11.315 |
| 显式重试后的重开       |  8.929 |
| 重试后的再次重开       |  9.214 |
| 提交后退出的首次重开   |  9.157 |
| 提交后再次重开         |  9.448 |

```powershell
$env:UV_NO_SYNC='1'
$env:UV_OFFLINE='1'
uv run --no-sync pytest services/api/tests/test_invalidation_process_recovery.py -q -rP
# 2 passed in 14.64s
uv run --no-sync pytest services/api/tests/test_artifact_invalidation_ledger.py services/api/tests/test_invalidation_api.py services/api/tests/test_migrations.py services/api/tests/test_task_ledger_recovery.py services/api/tests/test_sidecar_security.py -q
# 140 passed in 36.44s
uv run --no-sync ruff check services/api/tests/test_invalidation_process_recovery.py
# All checks passed!
uv run --no-sync ruff format --check services/api/tests/test_invalidation_process_recovery.py
# 1 file already formatted
pnpm exec prettier --check docs/quality/r05-a2-invalidation-process-recovery.md
git diff --check
```

相关回归后仅增强新增测试的首次读取断言，并重新运行定向测试和 Ruff；相关已有文件始终未改。Prettier 和 diff 检查结果见冻结交接记录。作者不自行运行全量覆盖率；由主控安排单一串行 runner，且全量 Python 运行期间不并发 TS/build/test。

## 独立验收（2026-09-04）

独立执行任务 `01a064bd-e70d-7850-ad0a-7d15f594d9d2` 按顺序运行下列命令，全部退出 0。作者不再编辑，且全量测试期间没有并行测试或构建。

| 检查                        | 实测结果                                          |
| --------------------------- | ------------------------------------------------- |
| 新增进程退出测试            | 2 passed / 14.55 秒                               |
| `pnpm lint`                 | ESLint、Ruff、Prettier 和 Python 格式检查通过     |
| `pnpm typecheck`            | Desktop/Studio TypeScript 和 mypy 79 个源文件通过 |
| `pnpm build`                | Desktop/Studio 构建通过                           |
| `git diff --check`          | 通过；新增文件另经完整内容审查和显式暂存差异检查  |
| 唯一一次独立 `pnpm test:py` | 953 passed / 513.14 秒                            |
| 主控独立覆盖率核算          | 行 9364/10007 = 93.57%；分支 2071/2474 = 83.71%   |
| 关键模块                    | 现有门禁声明的 14 个模块均为 100% 行/分支覆盖率   |

主控核对了完整新增测试、两个检查点、首次 SQLite 读取顺序、人工行不变量、进程退出与清理、命令原始日志以及原启动目录保护文件哈希。独立复测的五次重开计时依次为 9.749、9.244、9.085、9.483、10.228 毫秒，适用上文所述计时边界。

本机证据位于 `.aijian-dev/r05-a2/independent-20260904/`（忽略目录，不随 Git 提交）：`01-targeted.log`、`02-lint.log`、`03-typecheck.log`、`04-build.log`、`06-full-python.log` 和冻结的 `coverage-final.json`。全量日志 SHA-256 为 `3E0EC501AA5AB03835A514D41FDAB98D41F227790E0220FFA0AB4A1A5B30F1FD`；覆盖率报告 SHA-256 为 `8D0D8659430B42E66D77D0F5A10777FD34A3E0745A35D115A46A01E1043FB7DA`。

独立审查提出的必要修正已完成：先读取 SQLite 再初始化仓储，并断言初始化和 GET 都没有修补或重写数据。最终验收仅覆盖上述两个 Gate 事务进程退出场景；本轮没有 UI/生产行为变更，不把此前 R04 Chrome/Electron 证据写成这次重新运行。

## 剩余限制

这是两个 Gate 事务检查点的技术证据，不等于路线图 60 秒恢复资格或六个生产 kill 点各 100 个种子的 600 次资格试验；[原故障矩阵的未完成项](phase0-fault-injection-acceptance.md) 不变。未覆盖断电、磁盘满、损坏介质、真实 Provider、远程未知状态、影片继续导出、UI、打包签名、跨平台资格或真实人工 Gate。

既有 heartbeat 失败与单独串行通过的证据都必须保留；本轮未对其根因定性，不以新用例通过消除该未根因化限制。未完成 R05、C04、K01、Phase 0 或 1.0 GA；专项通过不替代迁移中断、授权影片和生产链集成等后续证据。
