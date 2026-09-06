# AIVORA Desktop Creator — UI Demo 开发规格

状态：UI Demo Implementation Spec  
适用分支：`aivora/ui-demo-worldview`  
基线：`codex/phase0-ffmpeg-toolchain`  
范围：仅 UI 演示，不代表真实 AI、Provider、数据库、生成、费用、时间线、审片执行或发布能力已经实现。

## 1. 目标

依据《AIVORA Desktop Creator 产品与系统基线 · Conditional Go R2 · 契约与 Skill 收敛版》和已确认 UI 方向，建立可运行、可点击、可演示的 Desktop Creator UI 壳，用于验证信息架构、普通/专业模式、五阶段导航、页面密度、几何布局和 Aivora AI 交互位置。

首要原则：

- 五阶段固定：`故事 → 角色与世界 → 分镜 → 制作 → 审片`。
- 普通模式结果优先、每页一个主任务、默认 0 个技术参数。
- 专业模式不是另一套软件；保持当前页面/对象/上下文，只增加 Inspector 控制层。
- 未实现能力显示真实 Demo/未就绪状态，禁止假装真实 AI 已完成付费生成。
- 分镜是 Storyboard + Animatic；正式 AI 视频只属于制作阶段。
- 审片是完整看片、多条批注、审核完成后统一规划修改；不边看边改。
- 导出不是第六阶段。
- AI 开发不得自行重新设计页面几何关系；布局以本文件的 Layout Contract 为实现约束。

## 2. 第一轮 UI Demo 页面

当前 PR 首先实现“②角色与世界 → 世界观”。页面结构：

1. App Top Bar：AIVORA、当前项目《星夜之城》、普通/专业模式、保存状态、当前用户。
2. Project Shell 左导航：故事；角色与世界（角色/世界观/场景）；分镜；制作；审片；素材；导出；AI 服务；设置。
3. 五阶段顶部流程。
4. 世界观主视觉区域（16:9 Demo Placeholder）。
5. 世界关键词 + 简短世界说明。
6. 普通模式主操作：`哪里不对？`、`确认世界观 →`。
7. 弱入口 `详细设定 ›`。
8. 单一 Aivora AI 面板。

## 3. 世界观普通模式规则

普通模式不把完整 WorldBible 六到十几个字段铺满页面。默认只显示：

- 一张大的 16:9 世界主视觉；
- 3–5 个世界关键词；
- 不超过约三行的核心世界说明；
- 一个修改入口；
- 一个确认主按钮；
- 一个弱化的详细设定入口。

详细时代、城市、科技、社会、文化、规则等内容普通模式按需展开；专业模式以后通过 World Inspector 默认提供控制层。

### 当前 Demo 行为

`哪里不对？`：打开本地文本修改面板，不调用 AI。  
`确认世界观`：只更新本地 React 状态，并提示下一项为场景。  
`详细设定`：打开 Drawer。  
`普通/专业模式`：只演示 ViewPolicy；不创建第二份项目数据。  
Aivora AI：只做本地提示和输入演示。

## 4. Simple Mode Complexity Budget

- Primary Action：每页 1 个。
- Secondary Actions：默认不超过 3 个。
- 同一页面默认最多 1 条主时间线。
- 禁止同时显示两个等价对象列表。
- 技术参数默认 0 个。
- Provider / Seed / PromptPlan / CompiledRequest 默认不可见。
- 新增永久控件前先判断是否可由 Aivora AI 根据上下文完成。

## 5. UI Demo 与生产能力边界

本 Demo **不得**调用真实 Provider、迁移生产数据库、修改 Agent/Skill Runtime、创建真实 `SemanticClaim` / `GenerationContract` / `ChangeSet` / 费用账本 / ReleaseApproval，不得将占位视觉、假进度、假费用、假 Provider Job 冒充正式系统状态。

真实能力后续必须按 ADR、Schema、Gate 和 Epic 单独解锁。

## 6. 后续 UI Demo 页面顺序

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

两种模式共享 Project、当前 Stage、Episode / Scene / Shot（存在时）、当前时间码（存在时）、选中版本和 Aivora AI 会话上下文。

模式属于 `ViewPolicy`，不进入 Project，不参与 Artifact hash。专业模式在同页面增加 Inspector，不复制页面、不复制数据、不重新生成资产。

---

# 8. AIVORA UI Layout Contract（几何布局契约）

本章是 AI/Codex/Claude 实现 UI 时的几何约束。除响应式规则外，不得自行改变栏宽、主视觉层级、CTA 层级或导航结构。

## 8.1 基准画布与验收视口

| 项目 | 冻结值 |
|---|---:|
| Desktop 设计基准 | `1600 × 900` |
| 第一验收视口 | `1600 × 900` |
| 第二验收视口 | `1440 × 900` |
| 最低 Desktop 验收宽度 | `1180px` |
| `<900px` | 不属于 Desktop Creator 第一阶段视觉验收目标 |
| 示例项目画幅 | `16:9` |

设计稿为 Reference Frame。实现不要求逐像素复刻内容文字，但**区域位置、视觉权重、主视觉比例、导航层级和 CTA 层级必须一致**。

## 8.2 App Shell 三栏结构

普通模式宽屏采用：

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ TopBar 72px                                                               │
├──────────────┬───────────────────────────────────────┬─────────────────────┤
│ Left Nav     │ Main Workspace                        │ Aivora AI           │
│ 200px        │ min 650px / flex                      │ 320px               │
│              │                                       │                     │
│              │                                       │                     │
└──────────────┴───────────────────────────────────────┴─────────────────────┘
```

冻结尺寸：

| Token | 值 | 说明 |
|---|---:|---|
| `topbarHeight` | 72px | 全局顶部栏 |
| `leftNavWidth` | 200px | 项目导航 |
| `assistantWidth` | 320px | Aivora AI |
| `mainMinWidth` | 650px | 主工作区最低宽度 |
| `pageOuterGap` | 14px | Shell 与主要面板间距 |
| `pagePadding` | 20–24px | 页面内容内边距 |
| `sectionGap` | 16px | 普通 Section 间距 |
| `cardRadius` | 10–13px | 统一卡片圆角 |
| `primaryButtonHeight` | 72px | 大型确认 CTA |

禁止：左栏自行扩成 260px；Aivora AI 普通模式自行扩成 400px+；主内容因辅助面板被压缩到不可阅读。

## 8.3 Top Bar

高度固定 `72px`。从左到右：

```text
AIVORA Brand | Project Switcher | flexible spacer | 普通/专业模式 | Save State | User
```

要求：

- Brand 区约 190–210px，不与左导航文字重复占据大量空间。
- Project Switcher 约 170–210px。
- 模式切换是两段式 Segmented Control，不使用两个巨大按钮。
- 保存状态属于辅助信息，不得比模式切换醒目。
- 用户头像/昵称在最右。

## 8.4 左侧 Project Navigation

宽度固定 `200px`。一级项行高建议 `42–44px`；二级项缩进约 `36–44px`。

第一期导航唯一结构：

```text
创作
故事
角色与世界
  角色
  世界观
  场景
分镜
制作
审片
────────
素材
导出
────────
AI 服务
设置
```

禁止增加旧一级入口：`AI生成`、`声音制作`、`时间线`、`审片修改`、`工作空间`。这些能力属于制作/审片内部或后续 Epic。

当前项用蓝色高亮；父级展开但不与当前子项同时使用同等级高亮。

## 8.5 五阶段 Stage Bar

位于 Main Workspace 顶部，不放进 Top Bar。建议高度 `52–58px`。

```text
① 故事  ›  ② 角色与世界  ›  ③ 分镜  ›  ④ 制作  ›  ⑤ 审片
```

- 名称和顺序固定。
- 当前阶段蓝色强调。
- 已完成阶段只使用弱完成态。
- 不显示第六阶段“导出”。
- 左侧子页面改变时，Stage 名称不得漂移。例如世界观/场景都仍属于“角色与世界”。

## 8.6 Main Workspace 页面骨架

所有普通模式创作页优先复用：

```text
Page Header
├─ H1 页面标题
├─ 1 行或最多 2 行说明
└─ Weak Action（可选）

Primary Visual / Primary Content

Compact Summary / Context

Primary Action Area
```

视觉权重固定为：

1. 当前页面 Primary Visual / Primary Content
2. 页面标题与当前创作对象
3. Primary CTA
4. 必要摘要
5. Aivora AI
6. Weak Action / 详细设定
7. 技术/实现信息（普通模式默认不可见）

## 8.7 世界观页面 Wireframe

```text
┌──────────────────────────────────────────────────────┐
│ 世界观设定                              详细设定 ›   │
│ Aivora 已生成视觉方向与基础设定……                    │
├──────────────────────────────────────────────────────┤
│                                                      │
│              16:9 WORLD HERO VISUAL                  │
│                                                      │
├──────────────────────────────────────────────────────┤
│ 星夜之城                                             │
│ 记忆藏着另一个世界                                   │
│ [近未来] [滨海都市] [记忆科技] [现实主义电影感]      │
│ 2–3 行核心说明                                       │
├──────────────────────┬───────────────────────────────┤
│ 哪里不对？           │        确认世界观 →           │
│ Secondary            │        PRIMARY                │
└──────────────────────┴───────────────────────────────┘
```

冻结规则：

- Hero 必须是中央页面最大单一区域。
- Hero 使用 `aspect-ratio: 16 / 9`，建议占 Main 可用宽度 ≥ 90%。
- Hero 不应被 6 张设定卡切碎。
- 世界关键词最多 5 个，默认单行/必要时换行。
- 核心说明普通模式控制在约 2–3 行。
- `详细设定` 放 Header 右侧，使用文字型弱入口，不作为第三个大按钮。
- `确认世界观` 是唯一 Primary CTA。
- `哪里不对？` 视觉权重低于确认按钮。

## 8.8 Aivora AI 面板

宽屏普通模式固定约 `320px`。

结构：

```text
Aivora AI + 在线状态
简短上下文说明
最多 3 个建议/快捷意图
flex spacer
输入框 + 附件/发送
```

禁止：

- 重复 Main Workspace 已经展示的所有结构化字段。
- 在世界观页再次列 6–10 项完整 WorldBible。
- 使用比 Primary CTA 更亮、更大的主按钮。
- 默认占据超过约 25% 的 1600px 画布宽度。

## 8.9 专业模式 Layout Contract

专业模式仍是同一页面。宽屏优先：

```text
Left Nav 200 | Main min 700 | Inspector 300 | Aivora AI 300
```

但只有在视口足够宽时允许四栏。若宽度不足：

```text
Left Nav | Main | [Inspector / Aivora AI] Tab
```

规则：

- Inspector 默认显示当前对象专业控制。
- Aivora AI 和 Inspector 不得同时把 Main 压缩到 `<650px`。
- 普通→专业→普通切换保持当前页面、选中对象、时间码和本地输入。
- 技术二级层（PromptPlan / CompiledRequest / Provider Raw Params）默认继续折叠。

## 8.10 Responsive

| 视口 | 行为 |
|---|---|
| `≥1440px` | 普通模式完整三栏；专业模式可根据剩余空间显示 Inspector + AI |
| `1180–1439px` | 左导航 + Main + AI；专业 Inspector 与 AI 使用 Tab/切换，不硬挤四栏 |
| `900–1179px` | 左导航允许折叠；Aivora AI 变 Drawer/Overlay；Main 保持优先 |
| `<900px` | 非第一阶段 Desktop 验收目标；只需避免页面完全损坏 |

响应式时**先收辅助区，再缩主创作区**。禁止为了保留所有栏位把 Hero 缩成小缩略图。

## 8.11 Typography

建议值：

| 用途 | 字号 |
|---|---:|
| Page H1 | 30–34px |
| Object / Hero Title | 24–28px |
| Section Title | 18–20px |
| Body | 14–16px |
| Secondary | 12–13px |
| Tiny Status | 10–11px |

中文字体优先系统无衬线字体。不要用超细字重承载关键状态。

## 8.12 Spacing / Radius / Border

- 基础 spacing 单位建议 `4px`。
- 常用间距：`8 / 12 / 16 / 20 / 24 / 32`。
- 主页面卡片 radius：`12px`。
- 小按钮/输入框：`7–9px`。
- 边框使用低对比深蓝灰；Primary CTA 才使用高饱和蓝。
- 紫色主要用于 Aivora/专业能力辅助，不把所有选中状态都做紫色。

## 8.13 Forbidden Layout（AI 实现禁止项）

普通模式禁止：

1. 世界观首页平铺 6 张以上设定卡。
2. 同页出现两个 Primary CTA。
3. 同页出现两条意义相近的时间线。
4. 同时出现两个等价镜头/角色/批注列表。
5. 默认展开 Provider、Model、Seed、Prompt、Reference Weight 等技术字段。
6. 把 Aivora AI 做成比主工作区更抢眼的控制台。
7. 自行把五阶段改成 6 步或把“生成/成片”重新拆成顶部阶段。
8. 把“详细设定”做成与确认按钮同级的大 CTA。
9. 未生成页面使用成片质感图、假视频、假费用、假进度冒充正式结果。
10. 在 Desktop Creator 第一阶段新增团队“工作空间”一级导航。

## 8.14 Layout Tokens

实现建议建立单一 token 源，不在多个组件散落 magic numbers：

```ts
export const aivoraLayout = {
  referenceWidth: 1600,
  referenceHeight: 900,
  topbarHeight: 72,
  leftNavWidth: 200,
  assistantWidth: 320,
  inspectorWidth: 