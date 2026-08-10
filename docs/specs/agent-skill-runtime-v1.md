# 规格：Agent/Skill Fake Runtime V1

状态：Proposed（B 阶段合同；D 阶段实施）

## 目标

在接入真实付费模型前，建立可版本化、可恢复、可审计、可预算和不可越权的 Agent/Skill 基础。Agent 负责岗位决策，Skill 是有界能力；二者都只能提交 ArtifactProposal，由受控 Worker 执行和验证。

## 核心契约

### AgentDefinition

包含 `agent_definition_id`、`version`、`role`、`layer`、职责、禁止行为、可调用 `skill_refs[]`、默认策略版本、上下文策略版本和兼容范围。定义不可原地修改；新内容产生新版本。

### SkillDefinition

包含 `skill_definition_id`、`version`、`input_schema_ref`、`output_schema_ref`、可读 Artifact 类型、允许工具、允许 Provider 能力、软/硬预算、超时、最大尝试、Gate、失效边、`ui_renderer`、fixtures 和兼容范围。未声明的读取、工具和 Provider 一律拒绝。

第一批 Skill：

`source.extract`、`story.bible.build`、`adaptation.plan`、`screenplay.generate`、`shot.plan`、`beat-board.build`、`sequence-board.build`、`motion-prompt.build`、`prompt.plan`、`prompt.compile`、`continuity.check`、`candidate.compare`、`animatic.assemble`、`timeline.assemble`、`release.qc`。

### ContextManifest

记录实际装配并哈希后的上下文，而不是保存一个不可解释的大 Prompt。条目按以下固定顺序渐进加载：

1. 岗位不变量；
2. Skill 指令；
3. 相关的已批准 ArtifactVersion；
4. 本场景 SourceSpan 与引用文本；
5. 当前任务和输出 JSON Schema。

每项包含 `kind`、`ref/version`、`content_hash`、`trust_level`、`byte_count` 和裁剪理由。整本小说、无关历史和外部响应不得进入高信任系统指令。小说及 Provider 返回中的“指令”始终是 `UNTRUSTED_CONTENT`。

### ArtifactProposal

包含 `proposal_id`、目标 Artifact 类型、结构化 payload、payload hash、SourceSpan[]、invented claims、结构化 diff、依赖版本、影响预览、费用、置信度、能力损失、QC 和 producer run。提案本身不是 ArtifactVersion，不能成为下游 accepted-only 输入。

### AgentRun / SkillRun / Attempt

- AgentRun：阿健或专业 Agent 的一次可审计委派，引用精确 AgentDefinition。
- SkillRun：一次有界能力执行，引用精确 SkillDefinition、输入版本和 ContextManifest。
- Attempt：执行快照，固定 `agent_version + skill_version + prompt_version + policy_version + provider_connection_id + model_id + capability_snapshot + input_hash + output_schema_version + idempotency_key`。

以上字段与 `project_id`、输出 Artifact 类型共同规范化并计算 `attempt_fingerprint`。只有完整指纹相同的活动/成功 Attempt 才能复用；显式切换 Agent、Prompt、Policy、Provider、模型、能力快照或输出 Schema 必须产生新指纹。相同完整指纹的重复启动不得重复计费或创建冲突版本。

## 三层 Agent

| 层   | 角色                                                | 权限边界                                                 |
| ---- | --------------------------------------------------- | -------------------------------------------------------- |
| 决策 | 阿健·制片统筹                                       | 拆解、派工、预算、冲突、升级；不写专业产物、不审批       |
| 执行 | 编剧、导演、美术/连续性、分镜摄影、生成、声音、剪辑 | 运行获准 Skill，提交提案；不直接写数据库或 accepted head |
| 监督 | 连续性、成本技术 QC、权利发布 QC                    | PASS/FAIL/问题清单；不能静默修改被审产物                 |

单用户可兼任人类岗位，但 UI 和审计必须显示“自审”；Agent 永远不能成为具名人类。

## 运行数据流

```text
UI Intent
  → Workflow Node
  → AgentRun / SkillRun / Attempt
  → ArtifactProposal
  → Schema + 业务 + 预算 + 权限验证
  → ArtifactVersion(status=DRAFT)
  → Human Gate
  → accepted_version_id
  → Dependency invalidation
```

只有 Worker 可调用 Provider；Agent 进程无数据库写凭据。自动 QC 失败最多在剩余预算内重试一次，仍失败则升级给阿健/用户。`REMOTE_UNKNOWN` 禁止自动重提。

## Prompt 三层

`ShotIntent` 是权威创作意图；`PromptPlan` 是供应商无关展开；`CompiledPrompt` 保存供应商参数和 CapabilityLoss。改单次 CompiledPrompt 只创建新的编译版本/Attempt，不污染 ShotIntent；改 ShotIntent 才触发相关 PromptPlan 和 CompiledPrompt 失效。

## 推荐最小 API（合同草案）

全部路径带 `project_id`，列表分页，写操作要求 `Idempotency-Key`，响应沿用现有 `request_id` 和结构化错误：

| 方法与路径                                                                        | 语义                            |
| --------------------------------------------------------------------------------- | ------------------------------- |
| `GET /api/v1/projects/{project_id}/agents`                                        | 读取兼容的 AgentDefinition 目录 |
| `GET /api/v1/projects/{project_id}/skills`                                        | 读取兼容的 SkillDefinition 目录 |
| `POST /api/v1/projects/{project_id}/proposal-runs`                                | 创建 Agent/Skill 提案运行       |
| `GET /api/v1/projects/{project_id}/proposal-runs/{run_id}`                        | 读取运行、Attempt 和任务引用    |
| `POST /api/v1/projects/{project_id}/proposal-runs/{run_id}/cancellations`         | 请求取消，资源化记录取消语义    |
| `GET /api/v1/projects/{project_id}/artifact-proposals/{proposal_id}`              | 读取提案、证据、diff、费用和 QC |
| `POST /api/v1/projects/{project_id}/artifact-proposals/{proposal_id}/acceptances` | 验证后接受为不可变 DRAFT        |
| `POST /api/v1/projects/{project_id}/artifact-proposals/{proposal_id}/rejections`  | 退回并保存具名意见              |

Gate 继续复用现有 review/submission/approval 语义，不另建“AI 自动批准”接口。

### 访问面矩阵

| 调用面                                       | GET 目录/运行/提案 | 创建运行、取消、接受/退回                      | Gate 审批                    |
| -------------------------------------------- | ------------------ | ---------------------------------------------- | ---------------------------- |
| Electron Renderer → preload → main → Sidecar | 允许，需本机会话   | 允许，精确 IPC 白名单；Sidecar token 只在 main | 复用本地具名 review/approval |
| 普通匿名 Web                                 | 允许项目读面       | 拒绝 401/403，不扩大现有匿名写面               | 禁止                         |
| 工作室 Web + 已认证 Producer/Reviewer        | 服务器模式后允许   | 按 RBAC/CSRF/乐观并发允许                      | 按具名角色允许               |

D 阶段只实现第一行和第二行的失败关闭；多租户身份仍是后续目标。D 阶段 Browser E2E 必须证明目录/运行/提案可读且写按钮被禁用、直接 POST 被拒绝；完整“启动→接受→批准”纵切先由 Electron 证明。只有服务器身份规格与认证测试会话落地后，才能把普通浏览器的完整写纵切标为通过。

## 失败关闭规则

- 每个 ArtifactProposal 至少携带一个改编上下文 SourceSpan；事实性 claim 必须逐项绑定直接证据。`invented` claim 可以没有直接事实 span，但仍必须通过 Proposal 的上下文 span 说明它改编自何处。Proposal 完全缺 SourceSpan、Schema 非法、预算不足、引用未批准资产或 Definition 不兼容时不创建 DRAFT。
- 外部文本提示注入、未声明工具、越项目读取、Agent 直写数据库：拒绝并记录安全事件。
- 取消后远程完成：保留结果和费用，但不自动接受。
- 崩溃恢复：从任务账本和固定 Attempt 继续；不得重新构造版本漂移的上下文。

## D 阶段实施任务

1. 合同和 fixtures（≤5 文件）：先写 Python/JSON Schema 失败测试。
2. Registry 与 Context Builder（≤5 文件）：只装配 Fake 内容，验证顺序、信任级和哈希。
3. Proposal Validator（≤5 文件）：失败关闭并创建不可变 DRAFT。
4. Fake Agent/Skill Executor（≤5 文件）：接任务账本、取消、租约、恢复、幂等和一次 QC 重试。
5. 增量 OpenAPI/TS/IPC（每层独立提交）：不破坏既有路由。

## 验收命令

- `uv run pytest services/api/tests -q`
- `pnpm contracts:check`
- `pnpm typecheck && pnpm lint && pnpm build`
- 新增 `agent-skill-contract`、`context-injection`、`proposal-idempotency`、`proposal-gate` 和 `remote-unknown` 定向测试。

## 非目标

不调用真实 GPT/xAI，不安装 Agent 框架，不执行任意 TypeScript/Python Skill，不做动态代码下载，不创建自动审批，不实现多租户服务器身份，也不将 Markdown Agent 输出直接当正式 Artifact。
