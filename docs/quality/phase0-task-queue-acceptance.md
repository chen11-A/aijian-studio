# Phase 0 任务队列验收记录

日期：2026-08-04

范围：项目级任务只读投影、FastAPI/OpenAPI 契约、受限 Electron IPC、制作任务队列桌面与手机界面。

## 证据等级

- 真实浏览器：Playwright 驱动 Microsoft Edge Chromium，Windows，本地 Vite 5173 与 FastAPI 8000。
- 数据：取证脚本在忽略提交的 `.aijian-dev` 数据库中幂等建立三个真实 Task Ledger 记录；请求只走项目级 `GET /api/v1/projects/{project_id}/tasks`。
- 本记录不等同于执行器恢复验收，也不等同于真实导演/剪辑岗位验收。任务变更动作、成本账本、长任务 heartbeat 和 Artifact 提交后故障恢复仍是后续硬门禁。

## 浏览器与视觉结果

| 视口     | document 宽/客户宽 | 横向溢出 | 结果                                                         |
| -------- | ------------------ | -------- | ------------------------------------------------------------ |
| 1440×900 | 1440 / 1440        | 0 px     | 项目、汇总、筛选和首个任务同时可见；键盘焦点环清楚           |
| 390×844  | 390 / 390          | 0 px     | 单栏展示；筛选无横向滚动条，版本、成本、错误和下一步不被隐藏 |

真实截图：

- [1440×900 总览](evidence/task-queue-1440x900.png)
- [390×844 总览](evidence/task-queue-390x844.png)
- [390×844 任务卡](evidence/task-queue-card-390x844.png)
- [Web 自动化结果](evidence/task-queue-web-smoke.json)

## 专业任务与可访问性

- 从已选项目进入任务队列只需一次操作；展开 Attempt 技术详情再增加一次操作。
- 每个任务显示制作步骤、责任岗位、上游 Gate、精确输入版本、输入 hash、执行位置、Attempt 次数、优先级、检查点、技术状态、电影团队文案和下一步。
- 成本数据不存在时明确显示“成本账本尚未接入”，不伪造 `¥0`；公开响应预留 `reserved/accrued/billed/currency/budget/retry increment` 字段。
- `storyboard.plan` 映射为导演、上游 G5；`export.master` 映射为剪辑、上游 G7C。技术状态保留为次级信息。
- 浏览器语义树为 `h1 任务队列 → h2 制作任务总览 → h3 任务`，导航、项目轨、统计、筛选、状态和详情均有可访问名称；任务状态加载使用 live region。
- 390 px 下筛选按钮至少 44 px 高；`prefers-reduced-motion` 禁用加载旋转。
- Playwright 捕获控制台 error/warning 为 0。任务请求返回 200；React StrictMode 开发模式会重放只读 effect，但不会创建或修改任务。

## 安全边界

- Renderer 只能调用 `tasks:list`，没有通用 URL、数据库路径或任意 IPC 通道。
- Electron main 在 JSON 解析前执行 16 MiB 限制，并对响应进行 exact-key 运行时验证。
- 响应不包含 `lease_token`、幂等键、请求指纹、供应商账户或原始输入绑定；输入绑定只投影合法 `ver_*` ID。
- 当前唯一允许动作是查看详情。取消、重试、对账尚无受信写端点，因此界面不会显示虚假可用按钮。

真实 Electron 冒烟通过 preload → IPC → main → 随机端口 sidecar 调用 `listProjectTasks`，并断言响应 `project_id` 与请求项目一致；结果记录在 [Electron 自动化结果](evidence/provider-settings-electron-smoke.json) 中。该隔离项目当前任务数为 0，用于证明桌面边界往返，不冒充三任务视觉夹具。

## 自动门禁

- API 契约测试覆盖：有任务、空任务、未知项目、OpenAPI、敏感字段不泄漏、导演/Gate 分类。
- `pnpm test` 统一执行 Studio Web、Desktop 和 Python 门禁；任务队列组件覆盖加载、正常、空、错误与重试状态。
- Desktop 包含 exact-key 响应验证、secret-shaped extra field 拒绝和真实 Electron `listProjectTasks` 往返。
- Prettier、ESLint、Ruff、mypy、TypeScript 和 OpenAPI 生成在提交前统一复验。
- `pnpm evidence:provider-ui` 有 30 秒启动超时，幂等建立取证任务并同时生成 Provider/Task Queue 截图与脱敏 JSON；命令已经真实成功退出。

## 影片团队结论

制片、编剧、导演和剪辑可以在同一队列确认“现在做什么、使用哪个版本、谁负责、运行到哪里、是否安全等待”。但本纵切仍是只读控制台，不能据此宣称已完成正式取消、重试、供应商对账、成本控制或导演/剪辑工作台验收。
