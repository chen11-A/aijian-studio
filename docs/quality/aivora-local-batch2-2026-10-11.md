# 第二批本地检查点：费用页接入项目任务读取

父提交：`27c02a19672967d4bae88c4f67994cd4df48c599`。
总基线：`32d014624aad134a6884121a58a26b75088104c9`。

`UtilityPages` 的原生 costs 路由进入 `NativeCostsPage/ProjectCosts`，直接复用
model 的同一项目任务队列，不建新账本、不写预算、不派发任务。原 fixture 仍
只在 fixture 路由存在，普通/专业模式读取相同对象。

页面展示任务、模型、尝试、状态、输入版本与检查点，刷新仅做既有 GET。
`NOT_RECORDED` 金额始终未知；成功、取消、本地执行和空列表都不推导为0。
没有换币、合计或虚构账单。现有队列不覆盖全部官方账号/网关/上游收费，
界面明确披露费用证据缺口。预算设置仍禁用并保留为最终必需要求。

验证结果（云 Linux，仅代码/本地测试）：

- 4个定向 renderer文件28通过：新 ProjectCosts、native costs route、原
  UtilityPages fixture/服务回归、现有 useTaskQueue 恢复/作用域。
- 2个后端任务查询/presentation文件17通过：现有持久记录和状态来源。
- 全TS类型检查及新增route后 renderer no-emit 检查通过。
- 变更TS/TSX的ESLint及TS/TSX/CSS/文档格式检查通过，git diff --check通过。
- 合同、后端源码、依赖锁、lint/覆盖率配置未变；复用第一批 contracts:check、
  Python mypy/Ruff/格式和原桌面IPC证据，不重复无关全量测试。

日志及SHA256在 `evidence/aivora-batch2-20261011/`。没有重新计算整仓覆盖率，
不代表所有CI、模型、发行或Windows实机验收通过。

预算合同范围与身份锁定方向已提出设计问题，尚未收到回复。预算执行强制检查、
完整费用/结算合同、角色关系/服装/参考资产/集内引用/失效、正式媒体生成、Voice、
动态预演、实时装配、正式签发/输出和Windows安装恢复仍未完成。完整产品范围
不缩水；不能将本批读取接线称为费用功能已完整实现。
