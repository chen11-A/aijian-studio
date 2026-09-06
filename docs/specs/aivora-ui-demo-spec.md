# AIVORA Desktop Creator — UI Demo 开发规格

状态：UI Demo Implementation Spec  
适用分支：`aivora/ui-demo-worldview`  
基线：`codex/phase0-ffmpeg-toolchain`  
范围：仅 UI 演示，不代表真实 AI、Provider、数据库、生成、费用、时间线、审片执行或发布能力已经实现。

## 1. 目标

依据《AIVORA Desktop Creator 产品与系统基线 · Conditional Go R2 · 契约与 Skill 收敛版》和已确认 UI 方向，先建立可运行、可点击、可演示的 Desktop Creator UI 壳，用于验证信息架构、普通/专业模式、五阶段导航、页面密度和 Aivora AI 交互位置。

本 UI Demo 的首要原则：

- 五阶段固定：`故事 → 角色与世界 → 分镜 → 制作 → 审片`。
- 普通模式结果优先、每页一个主任务、默认 0 个技术参数。
- 专业模式不是另一套软件；保持当前页面/对象/上下文，只增加 Inspector 控制层。
- 未实现能力必须显示真实 Demo/未就绪状态，禁止假装真实 AI 已完成付费生成。
- 分镜是 Storyboard + Animatic；正式 AI 视频只属于制作阶段。
- 审片是完整看片、多条批注、审核完成后统一规划修改；不边看边改。
- 导出不是第六阶段。

## 2. 第一轮 UI Demo 页面

当前 PR 首先实现“②角色与世界 → 世界观”。页面结构：

1. App Top Bar
   - AIVORA 品牌
   - 当前项目《星夜之城》
   - 普通/专业模式切换
   - 保存状态
   - 当前用户
2. Project Shell 左导航
   - 创作
   - 故事
   - 角色与世界
     - 角色
     - 世界观
     - 场景
   - 分镜
   - 制作
   - 审片
   - 素材
   - 导出
   - AI 服务
   - 设置
3. 五阶段顶部流程
4. 世界观主视觉区域（16:9 Demo Placeholder）
5. 世界关键词 + 简短世界说明
6. 普通模式主操作
   - `哪里不对？`
   - `确认世界观 →`
7. 弱入口 `详细设定 ›`
8. 单一 Aivora AI 面板

## 3. 世界观普通模式规则

普通模式不把完整 WorldBible 六到十几个字段铺满页面。默认只显示：

- 一张大的 16:9 世界主视觉
- 3–5 个世界关键词
- 不超过约三行的核心世界说明
- 一个修改入口
- 一个确认主按钮
- 一个弱化的详细设定入口

详细时代、城市、科技、社会、文化、规则等内容保留在后台模型/未来实现中，普通模式按需展开；专业模式以后通过 World Inspector 默认提供控制层。

### 当前 Demo 行为

`哪里不对？`：打开本地文本修改面板，不调用 AI。  
`确认世界观`：只更新本地 React 状态，并提示下一项为场景。  
`详细设定`：打开 Drawer，展示时代与城市、科技、社会生活、世界规则。  
`普通/专业模式`：当前仅演示 ViewPolicy；专业模式显示 Inspector 占位提示，不创建第二份项目数据。  
Aivora AI：当前只做本地提示和输入演示。

## 4. Simple Mode Complexity Budget

普通模式页面必须遵守：

- Primary Action：每页 1 个。
- Secondary Actions：默认不超过 3 个。
- 同一页面默认最多 1 条主时间线。
- 禁止同时显示两个等价对象列表。
- 技术参数默认 0 个。
- Provider / Seed / PromptPlan / CompiledRequest 默认不可见。
- 新增永久控件前先判断是否可由 Aivora AI 根据上下文完成。

## 5. UI Demo 与生产能力边界

本 Demo **不得**：

- 调用真实 Provider。
- 写入或迁移生产数据库 Schema。
- 修改 Agent/Skill Runtime。
- 创建真实 `SemanticClaim`、`GenerationContract`、`ChangeSet`、费用账本或 ReleaseApproval。
- 将 CSS 占位图描述成真实 AI 生成资产。
- 用假进度、假费用、假 Provider Job 冒充系统状态。

真实能力后续必须按 ADR、Schema、Gate 和 Epic 单独解锁。

## 6. 后续 UI Demo 页面顺序

建议只扩 UI，不接真实后端：

1. 故事理解
2. 角色
3. 世界观（当前）
4. 场景
5. 分镜 / Animatic
6. 制作 · 镜头生成
7. 制作 · 成片组装
8. 审片
9. 修改方案
10. 素材
11. 导出 / Release Preflight
12. AI 服务 / 设置

每个页面先通过视觉与交互评审，再决定对应真实 Epic 是否接入。

## 7. 普通 / 专业模式 UI 契约

两种模式共享：

- Project
- 当前 Stage
- Episode / Scene / Shot（存在时）
- 当前时间码（存在时）
- 选中版本
- Aivora AI 会话上下文

模式属于 `ViewPolicy`，不进入 Project，不参与 Artifact hash。

专业模式后续在同页面增加 Inspector，不复制页面，不复制数据，不重新生成资产。

## 8. 视觉规范

- Desktop Creator 第一阶段示例项目《星夜之城》：16:9。
- 主色：深蓝黑工作台；蓝色主 CTA；紫色仅作 AI/专业能力辅助强调。
- 视觉内容优先于参数。
- 页面主视觉应占主要面积。
- 右侧 Aivora AI 不抢主 CTA。
- 金额若未来进入 UI，默认人民币 `¥0.00`；Provider 原币种只在专业账本明细出现。

## 9. 当前代码入口

- `apps/studio-web/src/aivora-ui-demo.tsx`
- `apps/studio-web/src/aivora-ui-demo.css`
- `apps/studio-web/src/main.tsx`

当前分支临时将 `main.tsx` 指向 UI Demo，目的是快速演示。合并到正式产品壳前，应决定是路由化 Demo、Storybook/Preview，还是正式替换现有 App；不要长期让演示入口覆盖生产入口。

## 10. UI Demo 验收

- 能在现有 Studio Web 工程启动。
- 五阶段名称和顺序正确。
- 左导航不出现旧的“AI生成/声音制作/时间线”一级入口。
- 世界观普通模式没有六张大参数卡。
- `确认世界观` 是页面唯一 Primary Action。
- `详细设定` 为弱入口。
- Aivora AI 只有一个用户可见助手入口。
- 普通→专业→普通切换不改变当前页面。
- 页面不声称真实 AI、真实生成、真实费用已经完成。
- 16:9 主视觉在桌面宽屏下为页面视觉中心。

## 11. 与产品/架构文档的关系

本文件只描述 UI Demo 实现。冲突优先级：

1. Accepted ADR
2. AIVORA Desktop Creator 当前产品硬约束
3. 本 UI Demo Spec
4. 当前 UI 图片

若图片与文字冲突（例如旧图顶部六阶段、旧左导航、美元费用、未生成页面出现完成画面），以文字规格为准。
