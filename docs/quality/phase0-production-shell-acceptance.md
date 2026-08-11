# Phase 0 生产工作台 P0 壳验收

状态：PASS（C 阶段 P0 Shell + 2026-08-10 UI 回归修复）；Agent/Skill 后端纵切已存在，但尚未接入本 UI

## 本增量完成

- 一级业务导航固定为“项目 → 故事 → 导演 → 资产 → 生成 → 剪辑 → 发布”。
- 顶部展示 G0–G8 阶段、文字状态、费用/审批人未知状态，以及唯一突出显示的下一步操作；未接服务端合同的 G2–G8 明确标记为未接入或等待上游。
- 桌面采用项目栏、主创作区、属性检查器三栏结构；项目栏和检查器均可折叠，进入剪辑编辑器时项目栏默认收起。
- 任务中心成为全局抽屉；当前唯一配置能力是 Provider 连接管理，因此顶栏入口诚实命名为“模型与 API”，不伪装成尚未实现的通用设置中心，也不进入项目一级导航。
- 导演、资产、生成和发布在未实现时显示明确的计划中空状态，不伪造可用能力或静默降级。
- 属性检查器展示真实项目元数据；提案区明确说明当前 UI 尚未接入 Agent Runtime，不伪造提案或审批。
- 390px 隐藏新建项目、模型与 API、来源导入、Fake 生成、导演、生成与复杂剪辑入口，仅保留项目选择、任务查看及尚未开放评论/批准的审阅壳。

## UI 回归修复

- 项目栏与属性检查器折叠后从内容网格中移除，恢复操作集中到同一条 54px 工作台布局栏；1920、1440 和 Electron 下左右按钮同一基线，不覆盖主内容，也不再形成 50px 贯穿全页的空沟槽。
- 项目名不再拼接到来源空态。普通用户统一看到“来源追踪”，说明文件、章节、段落、引用关系以及原文事实/推断分离；底层仍保留 Source Ledger/SourceSpan 语义。
- 引入 `--font-meta: 12px`、`--font-ui: 14px` 和 16/20/28px 标题层级；普通业务正文、导航和按钮使用 14px，辅助元数据不低于 12px。弱文字颜色提高为 `#9694a2` / `#b7b5c2`，真实浏览器按 `#13141a` 面板背景计算的关键正文和阶段元数据对比度均不低于 4.5:1。
- 所有布局恢复按钮与顶栏操作保持至少 44×44；`aria-expanded` 随折叠状态切换。1440px 在 200% 缩放等效的 720 CSS px 重排下无水平溢出且任务按钮仍为 44px。

## 实机证据

| 运行面   | 视口                           | 结果                                                                                                                                     |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome   | 1440×900                       | 完整三栏与阶段条可用；Fake 工作流、任务抽屉和时间线 REV 1→REV 2 成功；`POST /timeline/trim` 返回 200；控制台无错误；无整页横向溢出       |
| Chrome   | 1920×1080 / 1440×900 回归态    | 项目名“1”；两侧均折叠；恢复按钮同一基线且不少于 44px；布局栏 54px；“来源追踪”正文 14px；无覆盖、空沟槽或横向溢出                         |
| Chrome   | 980×720                        | 工作区降为可审阅布局；无整页横向溢出                                                                                                     |
| Chrome   | 390×844                        | 新建、模型与 API、导入、Fake 生成、导演、生成和剪辑入口逐项验证为不可见；显示 REVIEW ONLY 状态；无整页横向溢出                           |
| Electron | 1440×920 外窗（1424×881 内窗） | 三栏桌面壳、任务抽屉与时间线可用；刷新后 REV 2 持久化；preload 白名单精确；Renderer 无 `process`/`require`；控制台无错误；无整页横向溢出 |

证据：

- [Chrome 1440×900](evidence/web-e2e-skeleton-browser-1440x900.png)
- [用户报告的修复前 1920×1080](evidence/production-shell-regression-before-1920x1080.png)
- [Chrome 修复后 1920×1080](evidence/production-shell-regression-1920x1080.png)
- [Chrome 修复后 1440×900](evidence/production-shell-regression-1440x900.png)
- [Chrome 980×720](evidence/production-shell-browser-980x720.png)
- [Chrome 390×844](evidence/production-shell-browser-390x844.png)
- [Chrome 结构化结果](evidence/web-e2e-skeleton-browser.json)
- [Electron 1440×920](evidence/web-e2e-skeleton-electron-1440x920.png)
- [Electron 修复后工作台 1440×920](evidence/production-shell-regression-electron-1440x920.png)
- [Electron 结构化结果](evidence/web-e2e-skeleton-electron.json)

以上证据由 `evidence/SHA256SUMS` 绑定。

## 诚实边界

- 阶段状态当前仅由当前项目的来源存在性保守映射，只用于 P0 展示；G2 不会根据前端故事缓存冒充已批准。尚未实现服务端 `stage_summary`、阻塞计数、具名审批人和预计费用合同。
- 下一步按钮当前进入故事证据审阅，不触发模型调用、付款或 Gate 签署。
- 后端 Fake Runtime 已能持久化真实 `ArtifactProposal`；工作台可读取并展示来源证据、费用和 QC，Electron 可通过 Sidecar-only exact-key IPC 接受为 DRAFT 或保存具名退回审计。普通 Web 没有决定 capability，390px 不渲染决定控件；提案比较、评论、人工 Gate 和移动端具名批准仍未实现。
- 尚未实现导演画布、资产实体编辑、完整剪辑器或真实 Provider。后续后端增量继续保持 Sidecar 写与普通 Web 读权限分离，并未改变 CredentialRef 边界。
- 本增量不提高 48 周路线图的严格完成项计数；UI01 仍为 18/43，K01 仍未完成。

## 验收命令

```powershell
pnpm --filter @aijian/studio-web test
pnpm --filter @aijian/desktop test
node scripts/e2e/browser-web-e2e-skeleton.mjs
pnpm --filter @aijian/studio-web build
pnpm --filter @aijian/desktop build
node scripts/e2e/electron-web-e2e-skeleton.mjs
pnpm typecheck
pnpm lint
pnpm build
pnpm evidence:check
git diff --check
```
