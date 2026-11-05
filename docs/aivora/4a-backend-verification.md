# 4a 后端本轮核对与补修

代码固定提交：`05c59c74ce6a15875a0c39191e8bfb49496d8984`（`gpt/work-4a`）。本轮未合并分支、未调用付费或真实会员生成服务，不是4a阶段通过报告。

## 本轮代码

| 编号 | 提交                                       | 改动及边界                                                                                    |
| ---- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| B08  | `11229ca33f094a8579d884db260650544dc13816` | 表演显式null与主/配角来源保留；不改变实际声音选择或声明帧级执行                               |
| B08  | `528d8509dca92f03b80e42ddd8626d6d3b6851f4` | 同一编剧回复的角色、地点、场景及顶层设计元数据原子确认/撤销；导演来源、节奏与估算声明保留     |
| B09  | `9b3af9472b8d269d6f9a4c669fd2f9a1d79d07de` | 实际导演结果策略、文字审片、视频排队和重试准备迁入actions；宿主保留状态、请求所有权和保存协调 |
| B11  | `cdfc2f5c4bd88cdbee130c534cfa5ac09b94cd9e` | 提示词保存完成重新核对版本与原选择，防迟到提示                                                |
| B11  | `c6d42735522b984267ece63b28b377d360e19598` | 全量发现的保存目录失败分类改为既有SAVE_FAILED，未放宽断言                                     |
| B11  | `05c59c74ce6a15875a0c39191e8bfb49496d8984` | 手动编剧/美术真实请求带选择快照，保持全项目范围，编剧正文不重复                               |

主要实现及回归入口：

- B08：`film/writer-plan.ts`、`film/director-plan.ts`、`film/performance-plan.ts`；`writer-plan.test.ts`、`director-plan.test.ts`、`performance-declarations.test.ts`。
- B09：`pro/actions/director-draft.ts`、`text-review.ts`、`generation-prepare.ts` 及同名测试，`ProWorkspace.test.tsx` 验证实际宿主。
- B11：`pro/actions/editor-host.ts`、`editor-request-context.ts`、`film/notices.ts` 及同名测试，实际编剧/美术请求与迟到保存由工作台回归覆盖。

字段逐项矩阵与静态保存链见 [4a-field-audit.md](4a-field-audit.md)。writer/director已有JSON→upgrade字段相等回归，performance三份设计例完整重建output并hydrate；桌面新增字段专门落盘断言未新增，桌面链为静态复核与原通用保存测试，不冒充真实会员验收。

## 本执行器（Linux）检查

| 范围与固定提交     | 通过 | 失败 | 跳过 | 结论                                      |
| ------------------ | ---: | ---: | ---: | ----------------------------------------- |
| desktop，adff525   | 2001 |    0 |    0 | 114文件，desktop源码后续未变              |
| web审前，adff525   | 3970 |    2 |    0 | 保存分类错误与NOTICE_COPY；原失败保留     |
| web补修后，05c59c7 | 4029 |    1 |    0 | 310文件，唯一失败为NOTICE_COPY缺101业务码 |

05c59c7全仓tsc、ESLint、Prettier通过；adff525的ruff检查/格式及mypy（310源文件）通过。按现有coverage配置范围，desktop覆盖率：行92.21%、分支91.29%、语句90.68%、函数93.36%；最新版web：行93.41%、分支87.32%、语句90.84%、函数92.72%。两者配置覆盖率门槛通过，不等同于全部测试通过。

Python全量重跑最终5138通过、0失败、6跳过，用时2042.59秒；ruff检查/格式、mypy和覆盖率门槛均通过。行覆盖率92.12%（33212/36052），分支83.62%（8016/9586）。源码固定adff且工作树前后干净，Python/desktop/scripts/packages相对最新代码无改动。第一次固定adff运行遭/tmp写满，中断时2507通过、304失败、295错误、6跳过；这组是环境污染的未完成运行，不作为业务通过/失败结果。原日志保留，旧测试临时数据移到workspace留存；第二次指定workspace独立TMPDIR和basetemp从头运行，最终退出码0，不把首轮局部通过拼作全量通过。

本地证据目录：`/workspace/aivora-check-evidence-adff/`、`/workspace/aivora-check-evidence-05c/`、`/workspace/aivora-python-evidence-adff-20261104/`（环境中断）、`/workspace/aivora-python-evidence-adff-clean-20261104/`（重跑）。针对性回归计数存在重叠，最终web全量包含本轮所有新增测试，不将子集数相加虚增。

## 仍需协作或真实供应商验证

- Claude：B01新流水线完整入口、精确目标重试、uncertain核对、人工审片与独立检查点；B10场景参考/画幅入口；B11最终文案及统一差异展示。101个代码的精确名单与测试在 [4a-notice-handoff.md](4a-notice-handoff.md)，未修改其文案表或弱化完整性测试。
- 会员验证：B05看图能力、B06中英文对比及B02/B03/B04/B08/B10实际效果。没有已登录真实会员环境；未用模拟测试宣称供应商已通过。
- B09核心业务迁移按职责完成；剩余保存/所有权/界面生命周期不机械搬出。B08这次要求的writer/director/performance字段缺口已补，未扩大到服装生产或新增智能体。

可直接转Claude的接口交接：[4a-claude-integration-handoff.md](4a-claude-integration-handoff.md)。已只读核对 `claude/work@d1209d1e390dad5e5f965fb10b901aed823b2eea`，旧四笔未合入提交也保留清单；`aivora/dev`仍为`7f7a6ade8890c0bf829d511fc5f7f2bcabd97f11`。没有本轮4a tag、安装包或阶段通过声明。

最终记录另补跑当前工作树的仓库文本/角色约定检查，4项全部通过，覆盖本轮新增文档（`/workspace/4a-final-doc-check.log`）。最终文档经Prettier及git diff --check检查。
