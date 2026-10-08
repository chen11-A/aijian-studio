# ADR-0005：版本化 Agent/Skill 通过提案边界协作

- 状态：Proposed
- 日期：2026-08-10

## 背景

专业影视分工需要多个 Agent 与可复用 Skill，但模型是不确定、可被提示注入且可能产生费用的执行者。若 Agent 能直接修改核心数据、审批或自由选择工具，会破坏现有 SourceSpan、不可变版本、人工 Gate、任务恢复、预算和 Provider 隔离。

## 决定

采用版本化 `AgentDefinition + SkillDefinition + ContextManifest + AgentRun/SkillRun + ArtifactProposal`。Agent 是岗位边界，Skill 是有界能力。每个 Attempt 固定所有定义、策略、模型、能力快照和输入哈希。

Agent 只能向提案仓提交结构化 ArtifactProposal。受控 Worker 在 Schema、业务、证据、权限和预算全部通过后创建不可变 DRAFT；具名人类 Gate 才能推进 accepted head。监督 Agent 只出具 QC，不修改被审内容。

上下文按信任层渐进装配。来源小说和 Provider 响应永远作为不可信内容；它们不能改变系统指令、工具白名单、预算或审批规则。真实 Provider 只能由 Gateway/Worker 调用。

## 替代方案

### 让 Agent 直接写数据库

拒绝：无法统一证明权限、幂等、版本、失效和人工责任。

### 把 Agent 框架状态当产品真相

拒绝：恢复和迁移受框架锁定，并与 ADR-0002 的持久化工作流冲突。

### Skill 作为可下载、任意执行脚本

拒绝：扩大供应链和代码执行面。V1 的 Skill 是声明式合同与受控实现注册项。

### 模型输出直接形成 accepted Artifact

拒绝：绕过人类 Gate，且无法区分提案、草稿和批准事实。

## 后果

- 优点：Agent 可替换，Skill 可测试，输入可复现，预算/恢复/审计与现有工作流一致。
- 代价：需要 Registry、Context Builder、Proposal Validator、渲染器和更多版本迁移。
- 限制：早期 Fake Runtime 看起来比直接调用模型慢，但它先证明最昂贵的安全和恢复边界。
- 兼容：现有 OpenAPI 只做加法；现有 review/approval、Task Ledger 和 ArtifactVersion 继续作为权威真相。

## 验证

D 阶段必须证明幂等、取消、崩溃恢复、并发领取、`REMOTE_UNKNOWN`、提示注入隔离、Agent 无数据库写权限，以及缺证据/预算/批准资产时失败关闭。通过前 ADR 保持 Proposed；真实 Provider 不得接入。
