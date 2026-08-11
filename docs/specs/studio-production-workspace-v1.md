# 规格：Aijian Studio 生产工作台 V1

状态：P0 Shell Implemented（`source.extract` Electron 纵切已接入；通用 Agent/Skill 与完整审阅仍未实现）

实现证据见 [Phase 0 生产工作台 P0 壳验收](../quality/phase0-production-shell-acceptance.md)和 [UI + Agent + Skill 基础验收](../quality/ui-agent-skill-foundation-acceptance.md)。当前实现覆盖导航、布局、阶段展示、任务抽屉、设置入口，以及 `source.extract` 的 Electron 创建、后台 Fake 执行、提案展示和接受/退回。创建入口显式说明本地 Fake、零付费调用、能力损失和不自动批准；普通 Web 没有创建/决定 capability，390px 不渲染这些控件。服务端阶段摘要、提案比较、评论、人工 Gate、复杂导演/剪辑能力仍是后续范围。

## 目标与假设

面向个人创作者和小型影视团队，建立从来源小说到发布母版的统一桌面工作区。默认工作面为 1440×900 Electron/Web；980px 保留完整审阅能力；390px 只支持审片、评论和具名批准，不提供复杂精剪。

本规格假设现有项目、SourceSpan、不可变 ArtifactVersion、任务账本、Gate、TimelineVersion、Provider Connection 和桌面安全边界继续有效。新增界面必须兼容现有 API；模型与密钥永不由 Renderer 直接访问。

## 一级信息架构

固定顺序为：`项目 → 故事 → 导演 → 资产 → 生成 → 剪辑 → 发布`。

- 项目：项目、集、交付规格、成员与来源概览。
- 故事：原文、故事圣经、改编账本、分集与剧本。
- 导演：导演阐述、镜头表、Coverage、9 宫格、4 格序列和 Motion Prompt。
- 资产：角色、场景、道具、服装、声音及其不可变版本。
- 生成：候选池、能力损失、成本、运行状态和比较。
- 剪辑：Animatic、时间线、声音、字幕、版本与补拍单。
- 发布：权利、技术/连续性/编辑/创意 QC、母版和 ReleaseManifest。

“任务中心”改成所有工作区可唤起的全局底部抽屉；“模型与 API”进入全局设置，不占项目一级导航。

## G0–G8 阶段条

顶部阶段条始终显示九个主阶段。现有子 Gate 映射为：G4 含 G4T，G6 含 G6A/G6B，G7 含 G7A/G7B/G7C。

每个阶段必须显示：`status`、阻塞数、具名审批人或“未指派”、预计费用区间，以及一个由服务端返回的 `next_action`。同一时刻只能突出一个“下一步”按钮；UI 不从局部组件状态推断业务下一步。

状态至少包括 `NOT_STARTED / ACTIVE / BLOCKED / NEEDS_REVIEW / APPROVED / STALE`。颜色不是唯一信息载体。点击阶段进入对应工作区和被阻塞 Artifact，不直接执行付费调用或审批。

## 桌面布局

```text
┌ 全局标题 / 项目切换 / G0-G8 / 下一步 / 设置 ┐
├ 项目树 ┬──────── 主创作区 ────────┬ 属性检查器 ┤
│项目/集 │ 列表、画布、剧本、分镜、时间线 │ 版本/证据/影响 │
│场/镜头 │                              │ 审批/费用     │
├────────┴──────── 任务抽屉 ────────────┴────────┤
```

- 项目树、属性检查器和任务抽屉可独立折叠；进入编辑器时项目树默认折叠。
- 标题栏紧凑，不重复显示已经在树和阶段条出现的信息。
- 任务项可以跳回精确的项目/集/场/镜头/ArtifactVersion。
- 真实空、载入、离线、失败、只读、无权限、预算不足和能力降级状态必须有明确文案和下一步。
- 复杂画布和时间线在窄屏不可用时必须显示原因，不渲染缩水但不可操作的假编辑器。

## 领域工作流交互

故事与导演工作区遵循：`剧本拆解 → 镜头准备 → 候选确认 → 生产就绪 → 生成工作区`。角色、场景、道具和服装均为独立实体，并引用确切 VisualBible/AssetVersion。

导演区提供列表/画布双视图；节点展示状态、进度、阻塞和失效。刷新后从任务账本恢复。尾帧衔接必须显式选择上一镜头的获选尾帧版本；若 Provider 不支持引用尾帧，展示 `CapabilityLoss`，不得静默退化。

剪辑区继续使用 Aijian 有理数时间基和 TimelineVersion。P0 后逐步补齐时间尺、播放头、缩放、仅可见区域波形、分页检查器、多选、吸附和帧精确操作；不移植任何上游内部时间线模型。

## AI 提案卡

所有 AI/Agent 输出先显示为 `ArtifactProposal` 卡片，最小字段：

- 摘要、产生原因、Agent/Skill 和固定版本；
- SourceSpan 证据与“新增创作”标识；
- 与当前 accepted/draft 的结构化 diff；
- 将创建或使其失效的 ArtifactVersion；
- 预计/实际费用、置信度、能力损失和 QC 结果；
- `接受为 DRAFT / 退回并评论 / 与其他提案比较`。

“接受”只创建不可变 DRAFT，不推进 accepted head。Gate 仍必须由具名人类签署；监督 Agent 不能代签或静默修正提案。

## 响应式与无障碍

| 宽度     | 能力                                                                   |
| -------- | ---------------------------------------------------------------------- |
| ≥1280    | 完整三栏、阶段条、任务抽屉和编辑器                                     |
| 980–1279 | 可折叠双栏，保留提案审阅、证据和审批                                   |
| ≤390     | 审片、逐帧/时间码评论、比较、批准/退回；隐藏画布、复杂时间线与批量生成 |

键盘焦点可见，交互目标最小 44px；状态含文字和 ARIA；任何页面不得产生整页横向溢出。

## 测试与验收命令

- 组件：`pnpm --filter @aijian/studio-web test`
- Desktop 合同：`pnpm --filter @aijian/desktop test`
- 类型与格式：`pnpm typecheck && pnpm lint`
- 构建：`pnpm build`
- 实机：新增 `ui-production-shell` Playwright，覆盖 1440×900 Electron/Web、980px 审阅和 390px 审片。

## 边界

- 始终：中文业务名称、真实状态、精确版本、SourceSpan、费用和能力损失可见。
- 实现前先评审：新增依赖、OpenAPI、数据库迁移和 Electron preload 白名单。
- 禁止：把模型设为审批人、静默降级、覆盖 accepted 版本、Renderer 读取密钥、在 390px 提供复杂精剪。

## P0 实施切片

已实现工作台壳、可折叠区、紧凑标题、阶段条、唯一下一步、任务抽屉，以及 `source.extract` 创建运行、可恢复 operation journal、提案读取和 Electron 决定纵切，并保持现有 API 兼容。列表/画布、完整时间线交互和人工 Gate 属于后续独立增量。
