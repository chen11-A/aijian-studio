# Phase 0 Artifact/Gate 与故事圣经纵切规格

状态：规格冻结，实施中

对应 Backlog：B03、F04，以及 G2 `story.extract` 的首个类型化纵切。

## 1. 目标、角色与边界

用户可以把已摄取的小说整理成可追溯的故事圣经草稿，保存多个不可变版本，冻结一个版本送交人工 G2 审阅，处理结构化修改单，并在重启后继续。G2 通过后，系统只向分集、剧本和资产节点提供确切的 `accepted_version_id`。

本纵切的单机可信主体为 Electron main 创建的本地会话。单用户可兼任作者、编剧、连续性审阅和制片，但界面与审计记录必须显示“自审”。Renderer、AI、Fake Provider 和后台任务没有签署或 Gate 决策能力。

本纵切实现手工编辑；后续 AI 适配器必须输出同一 `StoryBibleContentV1` 草稿和证据契约，不能建立旁路结构，也不能直接送审或批准。

### 1.1 G1 SourceManifest 前置路径

既有导入的 `source_documents` 本身不可变，但还没有 G1 accepted head。本纵切先补齐最小 `SourceManifestV1`：每次导入成功后创建/修订项目唯一的 `source_manifest` artifact 草稿，内容固定文档 ID、raw hash、normalized hash、块 ID/字节范围与导入顺序。迁移只为既有来源生成 draft，绝不伪造人工 G1 决定。

来源工作台增加“准备 G1 / 确认来源基线”；API 提供 `GET /source-manifest`、创建 manifest 版本、`:prepare-submit`、`:submit`、`:prepare-decision` 和 G1 decision 的类型化端点。G1 只校验当前不可变来源清单、hash、块边界和明确范围；章节人工校对仍属于 E02。G1 accepted 后才可作为 StoryBible `source_scope` 的 blocking dependency；新来源导入只产生新 manifest draft，不偷换旧 accepted。

## 2. 不变量

1. 一个项目只有一个 `story_bible` artifact；其逻辑身份跨版本稳定。
2. Schema 与领域校验通过后立即保存不可变 `ArtifactVersion`。任何内容修改都创建新版本。
3. `content_json/content_hash` 只覆盖类型化内容。状态、head、签署、finding、submission 和 Gate 决定由事件与 head 查询时投影，不参与内容 hash，不写回版本。
4. 保存仅推进 `latest_version_id`；送审只冻结 `review_version_id`；通过或带豁免通过才推进 `accepted_version_id`。
5. 审批引用 `version_id + content_hash + gate`。AI 只能提出草稿或 finding，不能签署、送审或作 Gate 决定。
6. G3/G4 及其后消费者只能固定读取非 stale 的 `accepted_version_id`，并携带 G2 版本、未关闭 waiver/finding ID；不存在可用 accepted head 时不得运行。
7. `fact_id/entity_id` 是跨版本稳定的逻辑身份。普通编辑保留 ID；删除是在新版本缺席；拆分/合并创建新 ID 并记录 lineage；已删除 ID 不得分配给另一语义对象。

## 3. 类型化故事圣经

### 3.1 顶层内容

`StoryBibleContentV1` 包含：

- `title`：1–120 个 Unicode 字符；去除首尾空白后不得为空。
- `logline`：1–500 个 Unicode 字符。
- `source_scope`：确切 G1 `source_manifest_version_id`、输入文档 ID/raw hash、SourceBlock/章节范围、`full_work/selected_range` 范围类型和明确排除项。
- `entities`：1–2,000 个判别联合实体，`entity_id` 在内容内唯一。
- `facts`：1–20,000 个判别联合事实，`fact_id` 在内容内唯一。
- `questions`：0–2,000 个开放问题。
- `conflicts`：0–2,000 个事实冲突。

所有枚举拒绝未知值；所有永久 ID 由服务端分配。客户端新增项使用本次请求内全局唯一的 `client_key`；请求中的实体、事实、lineage、question/conflict scope 和 span fact 引用使用 `LocalRef={ref_type=permanent_id, permanent_id}|{ref_type=client_key, client_key}` 判别联合。首版自有 ID 只能使用 client key；修订中的永久自有 ID 必须存在于所选父版本且不能改变实体/事实 kind。后端在同一 `BEGIN IMMEDIATE` 事务中复核 accepted G1、分配并解析全部 key，再做领域/证据校验、规范序列化和 hash；响应只返回 client key 到永久 ID 的映射。字符串按原值进入规范 JSON，不做 Unicode NFC/NFD 转换；比较用服务端定义的大小写折叠显示键，但 hash 仍覆盖原值。

### 3.2 实体判别联合

实体 canonical content 只保存身份：`entity_id`、`kind`、`name`、`aliases[]`。人物卡摘要等非权威显示文本进入独立 presentation/review metadata，不进入内容 hash，也不会出现在 Agent、规则、连续性或下游生成 DTO 中。

- `character`
- `location`
- `organization`
- `prop`
- `costume`

目标、动机、秘密、性格、地理、父地点、物理规则、组织成员/目的、道具归属/状态、服装穿戴/状态和所有有效期均属于 typed fact，必须经过来源、canon 和 Gate 规则，不能藏在实体属性里绕过证据。所有实体引用必须指向同一版本中类型匹配的实体。

### 3.3 事实判别联合

所有事实共有：

- `fact_id`、`kind`、`importance=core/supporting/detail`；
- `origin=source_explicit_assertion/source_interpretation/user_decision/ai_inference`；
- `canon_status=proposed/confirmed/contested/rejected`；
- 可空 `extraction_confidence_bps`，只允许 AI/解析产物使用，范围 0–10000；
- `canon_certainty=certain/likely/ambiguous/intentionally_unreliable`，不使用伪精确分数表达世界真值；
- `viewpoint_entity_id?`、`source_reliability=reliable/uncertain/unreliable/not_applicable`；
- `decision_reason?`、`impact_scope[]`、`supersedes_fact_ids[]`、`derived_from_fact_ids[]`。

typed payload 是唯一机器权威；编辑备注进入独立 review metadata，不进入 canonical content 或下游 DTO。UI 从结构化字段生成可读摘要并优先展示结构化字段，不能让制片只审批自然语言说明。

事实载荷为判别联合：

- `character_fact`：`character_id`、`attribute`、`value`、有效期。
- `location_fact`：`location_id`、`attribute`、`value`、有效期。
- `relationship_fact`：`subject_entity_id`、`predicate`、`object_entity_id`、有效期。
- `event_fact`：`participants[]`、`location_id?`、`source_narrative_order` 整数、稳定 `story_time_order`、`temporal_relations[]`、`caused_by_fact_ids[]`、`state_changes[]`。每个 state change 明确 `entity_id/property/before/after`。
- `world_rule_fact`：`rule_scope`、`rule`、`exceptions[]`。
- `organization_fact`：`organization_id`、`attribute`、`value`、有效期。
- `prop_fact`：`prop_id`、类型化 `property_key=holder/location/condition/appearance`、`value`、有效期。
- `costume_fact`：`costume_id`、类型化 `property_key=wearer/location/condition/appearance`、`value`、有效期。

`state_changes`、`prop_fact` 和 `costume_fact` 共用同一状态词汇与类型约束：holder/wearer 只能指向人物，location 只能指向地点，alive 只能是布尔值，condition/relationship_status/appearance 只能是文本，possession 只能指向道具或服装；每个 property 同时约束可承载它的实体种类。有效期通过稳定 event fact ID 表达，不引用裸整数或自由文本。领域校验拒绝悬空引用、未来事件导致过去事件、事件因果/时间环、同一故事时间上的互斥状态、道具/服装状态事实与事件状态变化冲突、无 lineage 的语义 ID 改用，以及同一实体同名同类的明显重复。语义相似但无法确定时生成 conflict，不静默合并。

`effective_canon` 是唯一可供 G3/G4、资产与连续性节点消费的投影，只包含 `canon_status=confirmed` 且不属于 `resolved_as_source_ambiguity` 候选的 typed facts。歧义候选仍保留在 `confirmed_claims` 供审计，但不能当作世界真值；制作需要确定值时必须新增用户决定。`proposed/contested/rejected` 仅供审阅与审计；G2 前所有 core fact 必须 confirmed 或 rejected，任何 contested core fact 必须由 blocking conflict/question 阻断。

### 3.4 来源证据

证据不复制小说正文，单独保存在 `artifact_source_spans`，并通过 `fact_id` 关联内容。每个 span 包含 `role=supports/contradicts/context`、`source_document_id`、`source_block_id`、文档绝对 UTF-8 左闭右开 `start/end`、`claim` 和服务端计算的 `quote_hash`。

偏移基准是持久化 `source_documents.normalized_text.encode("utf-8")`：

```text
block.start_byte <= span.start_byte < span.end_byte <= block.end_byte
```

block、document 和 project 必须匹配；起止必须位于 UTF-8 字符边界。`quote_hash` 为 `sha256:` 加该文档字节切片的 64 位小写十六进制摘要。客户端不能提交引文正文或可信 hash。

提交 G2 时的条件基数：

- `source_explicit_assertion`：1..N 个精确 `supports` span；
- `source_interpretation`：1..N 个 span，且必须说明视角与可靠性；
- `user_decision`：0..N 个 span，但必须有决定理由与影响范围；
- `ai_inference`：1..N 个 span，保留 `origin`，且人工确认前必须为 `proposed`。

草稿阶段允许从整个 SourceBlock 快速建立宽引用；所有进入 `effective_canon` 的来源断言/解释在送审前必须缩小为精确 `supports` 引文，宽引用只能保留在 proposed 或非 canon 审阅项中。单事实 span 数量的 Phase 0 默认软上限为 10，超出时 UI 建议拆分，后端总上限 100，不能丢弃证据。

### 3.5 问题与冲突

`StoryQuestion` 包含稳定 `question_id`、事实/实体/文档级 scope、问题、严重度、负责人角色、`blocking`、状态和解决说明。无证据推断必须作为 question，不能伪装成 fact。

`FactConflict` 包含稳定 `conflict_id`、冲突类型、事实/证据引用、严重度、负责人、状态：

- `unresolved`
- `resolved_as_source_ambiguity`
- `resolved_by_user_decision`

解决项必须有理由。`resolved_by_user_decision` 必须引用一个 `origin=user_decision + canon_status=confirmed` 的 `resolution_fact_id`，并在同一版本明确冲突事实各自的 canon 状态。`resolved_as_source_ambiguity` 若影响 core continuity，仍须 blocking question 或明确制作决定。人物谎言、传闻和不可靠叙述保存为带 viewpoint/reliability 的来源主张；不将其自动合并成世界真值。未解决的 core canon 冲突阻断 G2 且不可豁免。

每个 StoryBibleVersion 必须以 blocking dependency 固定到 `source_scope.source_manifest_version_id`；每个 span 必须属于该不可变 G1 版本列出的文档 hash/范围。G1 accepted head 推进后，旧 G2 进入 stale，G3/G4 不得继续消费。`selected_range` 只允许生成对应范围的分集；只有 `full_work` 可作为整本/整季规划输入。

## 4. Artifact/Gate 持久化

SQLite 使用有序 migration runner 从 `0→1→2`。v2 新增：

- `artifacts`
- `artifact_versions`
- `artifact_heads`（含并发 `revision` 与独立 `review_evidence_revision`）
- `artifact_source_spans`
- `artifact_dependencies`
- `review_submissions`
- `review_findings`
- `review_finding_events`
- `gate_readiness_reports`
- `role_signoffs`
- `gate_decisions`
- `gate_waivers`
- `gate_waiver_events`

关键约束：

- `artifacts UNIQUE(project_id, artifact_type)`；
- `artifact_versions UNIQUE(artifact_id, version_number)`，并保存 `(artifact_id, version_id)` 唯一对；
- `artifact_heads.artifact_id` 为主键，latest/review/accepted 使用复合外键证明版本属于同一 artifact；
- `artifact_dependencies` 禁止自环和有向环，输入必须是确切版本；
- 每个 `(version_id, gate)` 终身最多一个 submission；重新送审必须创建新版本，新 submission 以 `supersedes_submission_id` 指向旧版本 submission；
- 每个 `(version_id, gate, role, review_revision)` 最多一个 signoff，新签署以 `supersedes_signoff_id` 串联；每个 `(version_id, gate)` 最多一个 terminal decision；
- `artifact_versions`、source spans、dependencies、submissions、findings、signoffs、decisions 和 waivers 插入后禁止 UPDATE；修改通过追加 superseding/resolution 事件表达；
- 绕过 Repository 的直接 SQL 也必须触发约束失败。

迁移的全部 DDL、索引、触发器和最后的 `PRAGMA user_version=2` 位于同一个显式 `BEGIN IMMEDIATE` 事务；提交前执行 `foreign_key_check`。失败完整回滚且可重试。`user_version>2` 时在任何 WAL、DDL 或 DML 前拒绝打开，不降级为不可靠的“只读兼容”。

## 5. 规范 JSON 与服务端权威字段

后端先将 Pydantic 模型转为 JSON mode，再唯一执行：

```python
json.dumps(
    value,
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
    allow_nan=False,
).encode("utf-8")
```

`content_hash` 为 `sha256:` 加上述字节的摘要。控制字符按 JSON 规则转义；日期统一 UTC RFC 3339；枚举使用字符串值；禁止 NaN/Infinity。服务端生成 `artifact_id/version_id/version_number/content_hash/created_at`、永久事实/实体 ID、quote hash 和所有审计时间。

actor、role 与 capability 从可信本地会话解析，不能由 Renderer 请求体指定。`self_review` 由版本作者 actor 与 Gate 决策 actor 比较得到。桌面送审、签署和决策采用 prepare/action 两阶段：prepare 在当前 revision 上生成/复用冻结 readiness report 和一次性 challenge，Electron main 显示绑定 `version_id + content_hash + gate + action + readiness_report_id + report_hash + review_evidence_revision` 的原生确认，随后 action 携带凭据与 `If-Match` 原子消费并复核 revision/evidence 未变化。Renderer 不能自行构造凭据。

## 6. 生命周期、并发与 G2 规则

生命周期投影：

```text
create version -> DRAFT
submit current draft -> NEEDS_REVIEW
finding(s) open -> CHANGES_REQUESTED
required signoffs complete + gate decision approved -> APPROVED
gate decision approved_with_waiver -> APPROVED_WITH_WAIVER
gate decision rejected -> REJECTED
accepted upstream changes -> STALE
new submission replaces review head -> SUPERSEDED (old review only)
```

若存在 terminal decision，投影优先为 `REJECTED/APPROVED/APPROVED_WITH_WAIVER`；`CHANGES_REQUESTED` 只表示 submission 仍开放、尚无 terminal decision 且存在 open finding。产品文案统一使用“要求修改”表示 open finding，使用“拒绝此版本”表示 terminal rejection。

送审期间允许继续保存新草稿，但不会偷换 `review_version_id`。用户必须创建并显式提交新版本以 supersede 旧审阅。finding、resolution、waiver、signoff 和 decision 都只能引用当前 `review_version_id` 的开放 submission；terminal decision 后禁止审阅写入。

`ArtifactHead.revision` 是并发 ETag，在以下每次成功事务后严格 `+1`：创建版本、提交/替换审阅、追加 finding、解决 finding、追加/关闭 waiver、签署、批准、带豁免批准和拒绝。`review_evidence_revision` 只在提交/替换审阅、finding、resolution 和 waiver 改变审阅证据时 `+1`；signoff 与 terminal decision 不改变它。决定、事件、head 条件更新与 revision 增长在同一事务完成：

- `approved` 与 `approved_with_waiver`：推进 accepted、清除 review；
- `rejected`：保留旧 accepted、清除 review；
- 替换审阅：保留旧 accepted，新 submission 引用被替换 submission；
- 新 draft：只推进 latest，review/accepted 均不变。

所有 head GET 和改变 head 的成功响应均返回正文 `revision` 与 `ETag: "revision-{n}"`。首版创建不要求 `If-Match`；其余 head mutation 必须带当前 ETag。缺失返回 `428 PRECONDITION_REQUIRED`，过期返回 `412 PRECONDITION_FAILED`；条件 UPDATE 影响 0 行映射为稳定冲突错误。不可变 version GET 用 content hash 作为缓存 ETag。

### 6.1 G2 GatePolicy v1

`:prepare-submit` 在不改变 head 的情况下生成版本化 `G2ReadinessReport(checklist_code="g2.story-bible.v1")` 与短期 challenge；`:submit` 复核 revision 后原子保存 submission 和该报告。append-only `gate_readiness_reports` 至少保存 `report_id/version_id/gate/submission_id?/policy_code/policy_version/head_revision/review_evidence_revision/report_json/report_hash/expires_at`。审阅证据稳定后，`:prepare-signoff` 生成或复用同一 evidence revision 的最终冻结报告；所有 signoff 与 GateDecision 必须引用该同一 report/hash/evidence revision，不在决策时另换报告：

- 标题/logline 与 schema 完整；
- source scope 的精确 G1 版本、文档/章节/块范围、排除项和 full/selected 覆盖率完整；
- 至少一个核心人物；
- 所有 effective canon 事实具有合规精确证据或明确用户改编决定；
- 关键事件的 source narrative 与 story time 均可排序，因果/时间无环，状态无冲突；
- 无悬空实体/事实引用和明显重复；
- 无未解决 core conflict；
- 所有 core fact 已 confirmed 或 rejected；`ai_inference` 的 core/supporting 项均已人工处置；
- blocking questions 已清零；
- 退回 finding 已在新版本中逐项标记 resolved/disputed/open；
- 记录来源覆盖率和宽引用数。

阻断项未清零时 API 拒绝 submit/approve，而不只在 UI 提示。单用户策略要求 `writer`、`continuity_reviewer`、`producer` 三个 RoleSignoff；同一可信人可一次确认满足多个角色，但分别写入记录并标记 self-review。signoff 绑定当前 `review_evidence_revision + readiness_report_id + report_hash`；finding、resolution 或 waiver 改变 evidence revision 后旧签署投影为失效，必须追加 superseding signoff；其他 signoff 只改变 ETag revision，不使同报告上的前序签署失效。团队模式未来只更换 GatePolicy，不另建审批模型。

`ReviewFinding` 必须绑定文档级或 fact/entity/question/conflict ID，包含严重度、期望修改、责任角色；append-only `review_finding_events` 以 `previous_event_id/sequence/actor/time` 投影 open/resolved/disputed。内容类 resolved 事件必须绑定从被审版本派生的 `resolution_version_id`，且新 submission 的 readiness 只接受绑定当前 review version 的处置；纯说明/误报可不改内容，但必须有理由。拒绝必须至少有一个 open finding。新版本 submission 引用被拒版本，并声明每条 finding 的处置。

waiver 必须引用 checklist/finding/question/fact/conflict ID，包含责任人、理由、影响范围和到期或复核 Gate；append-only `gate_waiver_events` 记录 review/closure。只有明确的 creative deviation 可豁免；无来源的 source assertion、未解决 core canon 冲突、未确认关键 AI 推断和阻断安全/权利问题不可豁免。带豁免批准会推进 accepted，但下游 envelope 必须携带未关闭 waiver ID。

## 7. 类型化 API

| 方法   | 路径                                                                               | 结果                                  |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------- |
| `GET`  | `/api/v1/projects/{project_id}/story-bible`                                        | head、projection、版本摘要和 ETag     |
| `GET`  | `/api/v1/projects/{project_id}/story-bible/versions`                               | 分页版本历史                          |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions`                               | 创建首版/修订版，返回 ID 映射和 201   |
| `GET`  | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}`                  | 完整类型化内容、证据和审阅投影        |
| `GET`  | `/api/v1/projects/{project_id}/story-bible/compare?base=...&target=...`            | 结构化版本差异                        |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}:prepare-submit`   | 生成 readiness 和一次性送审 challenge |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}:submit`           | 冻结送审并保存 readiness              |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}/findings`         | 追加结构化修改单                      |
| `POST` | `/api/v1/projects/{project_id}/story-bible/findings/{finding_id}:resolve`          | 追加 finding 处置事件                 |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}:prepare-signoff`  | 冻结最终报告并生成签署 challenge      |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}/signoffs`         | 追加可信角色签署                      |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}:prepare-decision` | 复用最终报告并生成决策 challenge      |
| `POST` | `/api/v1/projects/{project_id}/story-bible/versions/{version_id}/decisions`        | 追加唯一 G2 Gate 决定                 |

`GET /story-bible` 是轻量索引：`latest/review/accepted` 只返回版本 ID、版本号、schema、hash、父版本、变更摘要和时间，不重复返回长篇 `content/source_spans`。完整不可变内容只能通过精确的 `/versions/{version_id}` 按需读取；Renderer 按版本 ID 缓存，并在用户切换角色版本时懒加载。Repository 必须在同一读事务中投影 head 与三份摘要，且索引查询不得解析 `content_json`，避免大项目的一致性竞态和三倍正文传输。

Phase 0 单个 StoryBible 最多包含 20,000 个 `source_spans`；完整创建响应和精确版本响应的最终 UTF-8 JSON（包括 envelope、服务端生成 ID、hash、head 与 ID 映射）均不得超过 16 MiB。创建事务必须先构造并测量最终响应，超限时返回 HTTP 413 且完整回滚，不写入 version 或推进 head；历史读取在同一 SQLite 快照中先以 `content_json` UTF-8 字节、span 数量和 claim 字节下界拒绝明显超限版本，避免完整 `fetchall` 后才失败，临界值再由最终 envelope 精确校验。Electron main 在 `JSON.parse` 前以流式字节计数和严格 UTF-8 解码执行相同上限，不能依赖可伪造或缺失的 `Content-Length`；Renderer 只保留最近 3 个完整版本，命中时刷新 LRU 顺序。更大规模的事实和 spans 将在后续阶段改为不可变分页子资源，不能通过提高内存上限绕过。

compare 至少返回实体/事实新增、删除、修改，provenance/canon 状态、证据、决定理由、问题、冲突、finding 与 Gate 变化。普通修订必须声明 `parent_version_id` 且精确等于 current latest；服务端在同一事务同时验证 ETag、parent、稳定 ID 与 lineage，禁止携带当前 ETag 从旧快照静默改挂 latest。显式历史恢复/分支未来使用独立动作并展示丢弃影响，不复用普通保存。所有审阅写操作由服务端统一检查“当前开放 submission + 当前 review head + 当前 revision”，历史或 terminal 版本写入返回 `REVIEW_INVALID`。

稳定错误码：`STORY_BIBLE_NOT_FOUND`、`STORY_BIBLE_TOO_LARGE`、`ARTIFACT_CONFLICT`、`ARTIFACT_DEPENDENCY_INVALID`、`SOURCE_SPAN_INVALID`、`STORY_BIBLE_INVALID`、`GATE_NOT_READY`、`REVIEW_INVALID`、`APPROVAL_INVALID`、`PRECONDITION_REQUIRED`、`PRECONDITION_FAILED`。错误体不得返回小说正文、引文、内部 SQL 或 Python 异常。

Electron preload 只增加具名 `getStoryBibleIndex/getStoryBibleVersion/list/create/compare/submit/find/resolve/sign/decideStoryBible` 方法；Renderer 不获得通用 artifact 写入、任意 URL、SQL、数据库路径、端口、令牌或可信 actor 字段。

## 8. 专业 UI 验收

故事工作台采用“来源与精确引文 / 结构化故事圣经 / G2 审阅”三栏桌面布局，窄屏改为保持状态可见的分段流程：

- 永久显示项目、G1 输入、latest/review/accepted 版本、hash、Gate 状态和下一步动作。
- 来源栏支持搜索、上下文预览、精确文本选择和 `supports/contradicts/context` 高亮；从事实证据打开上下文时必须定位并聚焦到引用的精确 SourceBlock，即使目标不在默认首屏块窗口；宽引用有明确警告。
- 编辑栏按人物、关系、地点、事件、规则、组织、道具、服装分组；常用编辑一到两步完成，高级 provenance/lineage 渐进披露。
- 审阅栏显示 readiness、结构化冲突/问题/finding、角色签署、自审标记、版本 diff 以及每种决策的确切影响。
- 保存草稿、送审、替换审阅和 Gate 决策是不同动作；AI 建议绝不伪装为已确认 canon。
- 加载、空、错误、冲突、禁用、changes requested、approved、waiver、rejected 和重启恢复均有可执行文案。
- 1440×900、980×680、390×844 无水平溢出；键盘、清晰焦点环、语义标题/live region、WCAG AA 和 reduced-motion 全部验收。

界面遵守 `docs/development/ui-engineering-standards.md`；电影团队验收“能否完成一次 G2 审阅”，技术验收不能代替此结论。

## 9. 失败测试与完成条件

实施必须先写失败测试，并覆盖：

- 规范 JSON 对键顺序、中文、emoji、组合字符、控制字符、空数组稳定；内容变化改变 hash，NaN 拒绝。
- v0→2、v1→2、每个 DDL 后故障注入、完整回滚重试、外键检查和新 schema 拒绝。
- 并发首次创建、版本号冲突、每一种 revision 变化、缺失/过期 ETag 和事务回滚。
- prepare/action 的过期 challenge、revision/evidence 变化、重复消费，以及多个同报告 signoff 不互相失效。
- 直接 SQL UPDATE/DELETE 不可变审计行失败；跨 artifact head、重复 submission/decision/同 revision signoff 失败。
- 中文 UTF-8 span、字符边界、跨块/文档/项目、supports/contradicts/context 和实际切片 hash。
- 实体引用、关系端点、事件顺序/因果环、fact ID lineage、问题/冲突和 readiness 全规则。
- 草稿不影响 review/accepted；同版不可重复送审；新版本替换审阅不偷换；approve/waiver/reject 的原子 head 语义。
- readiness 报告 hash、revision 绑定、finding/waiver 事件、修改后旧 signoff 失效和 terminal 后禁止写入。
- AI/Renderer 伪造 actor、重复消费确认凭据、非 review head 审批和不可豁免项全部拒绝。
- OpenAPI/生成 TypeScript、受限 IPC sender、过期 UI 响应和稳定错误码。
- 真实 Chromium 1440/980/390、零控制台警告、可访问性、键盘与 reduced-motion；真实 Electron 两次冷启动恢复、随机端口和 Renderer 无 Node/令牌。

命令：

```powershell
.\.venv\Scripts\pytest.exe --cov=aijian_api --cov-report=term-missing
.\.venv\Scripts\ruff.exe check services/api scripts
.\.venv\Scripts\mypy.exe
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Python 行/分支和 TypeScript 行/函数覆盖率不低于 90%，TypeScript 分支不低于 80%，Artifact/Gate 状态机与可信审批边界 100% 行覆盖。Windows/Ubuntu CI 均通过。

## 10. 非本纵切范围

不新增第三方依赖；不调用 AI Provider；不做自动实体抽取、长篇分块归并、Canon Change Request UI、通用失效传播 UI、分集/剧本/分镜、服务器 RBAC 或多人在线协作。它们必须复用本纵切的类型化版本、submission、signoff、Gate 和 accepted-only 消费规则。
