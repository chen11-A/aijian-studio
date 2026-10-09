# AIVORA 合并审查进度与跨电脑接续

更新日期：2026-10-09（Asia/Shanghai）。当前结论：进度已整理至审查分支，尚未达到合并主分支的全部门槛。

## 分支与提交

- 仓库：<https://github.com/chen11-A/aijian-studio>
- 工作分支：`codex/merge-review-20261009`
- 本轮代码与测试检查点：`7865870a085ffb99d6e3fe95da886ba1d4d7a2e9`；本文件在后续文档提交中加入。
- 推送前核对的远端 `main`：`63c76db96ac64fb3dc960af6bda139aed3a6ec10`。本轮仅推送审查分支，不更新 `main`。
- 新增提交：`05549ec` 项目/分集/剧本接口测试、`a26ad2d` 来源提取/制作简报测试、`7865870` 远端恢复事务/入队身份测试。

## 已验证结果

| 检查                            | 结果                           | 范围与限制                                                          |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| Desktop 全量测试                | 1182 项通过，覆盖率门槛通过    | 沿用本分支此前运行结果；之后未修改 Desktop 源码或测试               |
| Web 全量测试                    | 90 个文件、1080 项通过         | 全局覆盖率仍失败；五个指定关键模块门槛通过                          |
| Python 最近一次全量测试         | 1968 项通过、23 项既有平台跳过 | 本次新增 13 项测试后尚未重跑全量                                    |
| 本次 Python 定向测试            | 13 项通过                      | 真实临时 SQLite、离线授权夹具与明确的故障注入；无真实 Provider 调用 |
| 本批 Web 类型、ESLint、Prettier | 通过                           | 四个新增 Web 测试文件；Web 类型检查为整个包                         |
| 本批 Python Ruff                | 通过                           | 两个新增 Python 测试文件                                            |

Web 全局：行 72.84%（要求 90%）、语句 70.88%（90%）、函数 77.39%（90%）、分支 67.93%（80%）。`localWorkbench.ts` 本批达到行 99.59%、分支 98.13%。

Python 覆盖率将最近全量数据与新增 13 项测试的数据合并，业务源文件未改变；不是一次新的全量执行。合并后行 79.09%（要求 90%）、分支 62.30%（83.5%）。`task_ledger.py`、`task_ledger_recovery.py` 已达到关键模块行/分支 100%。仍未达到 100% 的关键模块：

- `provider_connection_repository.py`：行 88.79%，分支 71.95%。
- `provider_connections.py`：行 85.22%，分支 73.08%。
- `provider_contracts.py`：行 92.86%，分支 77.94%。
- `task_ledger_enqueue.py`：行 99.27%，分支 97.50%；该检查点未覆盖第 385 行及对应分支。

入队测试先前的三个失败属于夹具问题：未遵守数据库版本递增/JSON 约束，以及用冻结后的元组重新构造严格列表契约。现已修正；非法 JSON 分支采用读取边界故障注入，保留数据库约束，不代表正常 API 能写入非法 JSON。

这些检查不等同于真实 Electron 全流程、标准用户安装/升级、真实 Provider、正式媒体授权或最终用户验收。全部门槛通过前，不将该分支视为可发布或可合并。

## 在另一台电脑接续

最稳妥的方式是在一个空目录中克隆该分支，避免覆盖另一台电脑已有的未提交内容：

```sh
git clone --branch codex/merge-review-20261009 --single-branch https://github.com/chen11-A/aijian-studio.git aivora-merge-review
cd aivora-merge-review
git log -5 --oneline
git status --short
```

已有该分支且工作区干净时，可运行 `git fetch origin` 后，在该分支上使用 `git pull --ff-only`。有本地改动时先保留改动，不执行强制重置。

环境基线：Node 24、pnpm 11.9.0、Python 3.12、uv，依赖使用仓库锁文件。原审查环境以 `pnpm install --frozen-lockfile --ignore-scripts`、`uv sync --frozen` 安装；忽略安装脚本不意味着 Electron 运行环境已准备完成。运行时组件须另按项目说明核验。

从仓库根目录复核新增 Python 测试：

```sh
uv run pytest services/api/tests/test_remote_recovery_atomicity.py services/api/tests/test_task_enqueue_boundaries.py -q
```

必需检查入口保留不变：

```sh
pnpm lint
pnpm typecheck
pnpm contracts:check
pnpm --filter @aijian/desktop test
pnpm --filter @aijian/studio-web test
pnpm test:py
pnpm build
pnpm evidence:check
```

`contracts:check` 会重新生成契约后检查差异；请在独立、干净的工作区运行。Web/Python 测试命令目前预期因覆盖率门槛返回非零；不得通过降低门槛、排除模块或跳过测试变绿。

## 下一步与证据边界

1. 补齐上述四个 Python 关键模块的剩余行为分支。
2. 继续补 Web 与 Python 全局覆盖率的有效测试，再运行对应全量检查。
3. 检查新增变更与现有回归、构建、契约和证据门槛。满足全部条件后核对远端并合并、正常推送 `main`，不强制覆盖。

原始运行日志保留在原电脑任务输出目录 `outputs/merge-review-20261009`，未加入 Git；本文件携带摘要与复验入口，不宣称日志随分支同步。对应日志名为 `desktop-coverage-seven.log`、`web-workbench-full.log`、`test-python-three.log`、`python-task-boundaries.log`。凭据、真实工作数据库、工作区锁文件和机器环境不随分支提交。
