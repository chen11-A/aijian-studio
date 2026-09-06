# AIVORA UI Demo 实施说明

日期：2026-09-06  
分支：`aivora/ui-demo-worldview`

## 为什么先做 UI Demo

当前产品 UX 已冻结到五阶段与普通/专业双模式，但 Architecture 仍为 Conditional Pass。为了不让视觉验证反向推动未冻结的领域 Schema，本纵切只实现 React/CSS 本地交互。

## 本轮依据

- AIVORA Desktop Creator 产品与系统基线（Conditional Go R2）
- 已确认的简化世界观 UI：大 16:9 主视觉、少量关键词、简短说明、`哪里不对？`、`确认世界观`、弱化 `详细设定`
- 仓库现有 Phase 0 原则：未开放能力不伪装可用；Agent/Provider/Workflow 真相仍由现有架构边界控制

## Scope

- 五阶段：故事 → 角色与世界 → 分镜 → 制作 → 审片。
- 普通模式优先；专业模式当前只演示 ViewPolicy/Inspector 外壳。
- 世界观采用简化构图：大 16:9 世界主视觉、四个关键词、短说明、一个主 CTA、一个修改入口、一个弱化的详细设定入口。
- 项目左导航保持精简：故事、角色与世界（角色/世界观/场景）、分镜、制作、审片、素材、导出、AI 服务、设置。
- 用户只看到一个 Aivora AI，不建立多 Agent 聊天 UI。

## 明确不做

本 PR 不实现真实 AI、Provider、Agent/Skill、数据库迁移、媒体生成、费用、时间线、审片执行和正式导出。

世界主视觉当前由 CSS 生成抽象占位，并带 `UI DEMO · 16:9` 标识，避免把设计稿或假图冒充正式项目 Artifact。

## 开发约束

- 不得把 Demo state 当成 `SemanticClaim`、`GenerationContract`、`ChangeSet` 或 Release 数据。
- 不得因为 UI 已存在就提前创建生产 DDL。
- 未开放页面必须走真实 readiness/空状态设计，不放假头像、假视频、假费用和假进度。
- 当前 `main.tsx` 临时指向 UI Demo，仅用于本分支快速预览；正式集成前需要路由/Preview 决策。

## 下一步

继续 UI 演示时，应逐页遵循 `docs/specs/aivora-ui-demo-spec.md`，每个页面先做本地状态；只有对应 Epic/ADR 准备好后，才把本地 Demo 状态替换为真实契约。
