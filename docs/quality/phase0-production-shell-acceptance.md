# Phase 0 生产工作台 P0 壳验收

状态：PASS（C 阶段 P0 Shell）；Agent/Skill Fake Runtime 尚未实现

## 本增量完成

- 一级业务导航固定为“项目 → 故事 → 导演 → 资产 → 生成 → 剪辑 → 发布”。
- 顶部展示 G0–G8 阶段、文字状态、费用/审批人未知状态，以及唯一突出显示的下一步操作；未接服务端合同的 G2–G8 明确标记为未接入或等待上游。
- 桌面采用项目栏、主创作区、属性检查器三栏结构；项目栏和检查器均可折叠，进入剪辑编辑器时项目栏默认收起。
- 任务中心成为全局抽屉；模型与 API 保留在全局设置，不进入项目一级导航。
- 导演、资产、生成和发布在未实现时显示明确的计划中空状态，不伪造可用能力或静默降级。
- 属性检查器展示真实项目元数据；提案区明确说明 Agent Runtime 尚未接入，不伪造提案或审批。
- 390px 隐藏新建项目、模型设置、来源导入、Fake 生成、导演、生成与复杂剪辑入口，仅保留项目选择、任务查看及尚未开放评论/批准的审阅壳。

## 实机证据

| 运行面   | 视口                           | 结果                                                                                                                                     |
| -------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome   | 1440×900                       | 完整三栏与阶段条可用；Fake 工作流、任务抽屉和时间线 REV 1→REV 2 成功；`POST /timeline/trim` 返回 200；控制台无错误；无整页横向溢出       |
| Chrome   | 980×720                        | 工作区降为可审阅布局；无整页横向溢出                                                                                                     |
| Chrome   | 390×844                        | 新建、模型设置、导入、Fake 生成、导演、生成和剪辑入口逐项验证为不可见；显示 REVIEW ONLY 状态；无整页横向溢出                             |
| Electron | 1440×920 外窗（1424×881 内窗） | 三栏桌面壳、任务抽屉与时间线可用；刷新后 REV 2 持久化；preload 白名单精确；Renderer 无 `process`/`require`；控制台无错误；无整页横向溢出 |

证据：

- [Chrome 1440×900](evidence/web-e2e-skeleton-browser-1440x900.png)
- [Chrome 980×720](evidence/production-shell-browser-980x720.png)
- [Chrome 390×844](evidence/production-shell-browser-390x844.png)
- [Chrome 结构化结果](evidence/web-e2e-skeleton-browser.json)
- [Electron 1440×920](evidence/web-e2e-skeleton-electron-1440x920.png)
- [Electron 结构化结果](evidence/web-e2e-skeleton-electron.json)

以上证据由 `evidence/SHA256SUMS` 绑定。

## 诚实边界

- 阶段状态当前仅由当前项目的来源存在性保守映射，只用于 P0 展示；G2 不会根据前端故事缓存冒充已批准。尚未实现服务端 `stage_summary`、阻塞计数、具名审批人和预计费用合同。
- 下一步按钮当前进入故事证据审阅，不触发模型调用、付款或 Gate 签署。
- 尚无真实 `ArtifactProposal` 数据、接受为 DRAFT、退回/比较、Agent/Skill Runtime、评论或移动端具名批准。
- 尚未实现导演画布、资产实体编辑、完整剪辑器或真实 Provider。本增量不改变已有 API、Sidecar/Web 写权限和 CredentialRef 边界。
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
