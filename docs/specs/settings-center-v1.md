# 规格：设置中心与作用域 V1

状态：Proposed（仅冻结契约，未实现）

日期：2026-08-10

## 目标与非目标

本规格把配置分为全局设置、项目设置和领域/镜头设置，避免模型连接、制作交付和单镜头创作参数互相污染。设置界面只显示后端确认的有效值，不得把前端缓存、未保存表单或乐观更新冒充已生效配置。

本阶段只定义信息架构、Schema 草案、API/IPC 影响、迁移、失效和验收。不会创建设置表、API、Electron IPC、可点击开关或真实连接测试；现有“模型与 API”仍是唯一已经实现的 Provider 连接入口。

## 三种作用域

### A. 全局设置中心

全局设置面向本机工作区和当前用户，不得包含项目交付规格或单镜头创作参数。

| 分区           | 内容                                                                                 | 首版边界                                                                       |
| -------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 通用           | 语言、主题、界面缩放、减少动画、启动行为、更新策略                                   | 缩放必须保留浏览器/系统无障碍缩放；更新策略不等于自动安装                      |
| 模型与 API     | Provider、凭据状态、模型目录、TEXT/IMAGE/VIDEO/SPEECH 能力映射、限流和备用策略       | 只保存 `CredentialRef`；连接测试须等 SSRF、DNS rebinding、重定向和私网策略完成 |
| Agent 与 Skill | 岗位定义、固定版本、启用状态、工具权限、上下文范围、预算、超时、Gate、提示词模板版本 | 禁止任意动态代码；外部 Skill 不得自动成为可信系统指令                          |
| 生成与费用     | 默认并发、超时、最多一次质量重试、预算上限、费用预警                                 | `REMOTE_UNKNOWN` 禁止自动重提；预算不足失败关闭                                |
| 存储与媒体工具 | 工作区、缓存、输出路径、磁盘占用、备份恢复、FFmpeg、ComfyUI、Worker、可选对象存储    | 工具状态由后端探测；路径须做工作区边界校验                                     |
| 隐私与安全     | 云端发送策略、日志脱敏、数据保留、网络/代理边界、凭据状态                            | 降低保护的修改必须审计，不提供显示密钥功能                                     |
| 通知与任务     | 完成、失败、待审批、预算不足通知                                                     | 通知不代替任务账本和 Gate 真相                                                 |
| 关于与诊断     | 版本、环境、日志、诊断包、许可证/NOTICE、更新检查                                    | 诊断包默认脱敏，导出前展示内容清单                                             |

稳定的 section ID 与允许作用域如下；显示名可本地化，ID 不随文案变化：

| section_id         | 允许的 scope.kind |
| ------------------ | ----------------- |
| general            | WORKSPACE         |
| model_api          | WORKSPACE         |
| agent_skill        | WORKSPACE         |
| generation_cost    | WORKSPACE         |
| storage_media      | WORKSPACE         |
| privacy_security   | WORKSPACE         |
| notification_task  | WORKSPACE         |
| about_diagnostics  | WORKSPACE         |
| project_production | PROJECT           |

路由和 Schema 必须按 `scope.kind + section_id` 做判别分派。任何未注册 section 或不匹配组合（例如 PROJECT + privacy_security、WORKSPACE + project_production）均以 `SCOPE_SECTION_MISMATCH` 失败关闭，不得落入通用 JSON 解析器。

### B. 项目设置

项目设置只作用于一个 `project_id`：项目/集、交付平台、画幅、目标时长、帧率、分辨率、语言、来源权利、项目预算、默认风格、项目模型覆盖、具名审批人和 Gate、资产库作用域、导出规格。项目覆盖不得复制凭据，只能引用全局连接和能力映射的稳定 ID。

任何会改变权利、预算、审批或交付规格的修改都产生审计事件。已批准 ArtifactVersion 不被原地改写；设置变更通过失效图影响后续草稿和运行。

### C. 领域与镜头设置

单镜头提示词、运镜、种子、参考图、候选比较和重生成留在导演/生成工作区，并进入 ShotIntent、PromptPlan、CompiledPrompt 或对应 ArtifactVersion。它们不是全局偏好，也不能通过“设置中心”批量覆盖已批准产物。

## Schema 草案

以下是未来实现的结构约束，不是当前 OpenAPI 已提供的类型。

```json
{
  "scope": { "kind": "WORKSPACE", "id": "workspace-id" },
  "section": "generation_cost",
  "schema_version": 1,
  "revision": 12,
  "desired": { "max_concurrency": 2, "quality_retry_limit": 1 },
  "effective": { "max_concurrency": 2, "quality_retry_limit": 1 },
  "effective_source": { "max_concurrency": "WORKSPACE" },
  "pending_restart": false,
  "validation": { "status": "VALID", "issues": [] },
  "updated_at": "2026-08-10T00:00:00Z",
  "updated_by": "principal-id"
}
```

共同约束：

- `scope.kind` 只能是 `WORKSPACE` 或 `PROJECT`，且必须符合上表的 section 白名单；镜头配置使用领域 Artifact，不进入此资源。
- 每个分区有独立 `schema_version`、`revision`、保存事务和失败回滚；不同分区不能用一个宽泛 JSON blob 混写。
- `desired` 是已通过服务端校验并持久化的期望值；`effective` 是后端解析默认值、覆盖、能力和运行条件后的确认结果。
- Renderer 可以保留未提交表单，但必须标为 dirty，离页前警告；未提交值不能写入 `effective`。
- 凭据字段只能是 `{ "credential_ref": "...", "status": "AVAILABLE|MISSING|LOCKED" }`，Schema 禁止 secret、token、api_key 或 cookie 值。
- Provider/模型/策略引用使用稳定 ID 和版本；显示名不得成为持久化主键。
- 并发写使用 `revision`/ETag；冲突返回当前服务端版本，不做最后写入覆盖。

建议的分区 Schema：`GeneralSettingsV1`、`ModelApiSettingsV1`、`AgentSkillSettingsV1`、`GenerationCostSettingsV1`、`StorageMediaSettingsV1`、`PrivacySecuritySettingsV1`、`NotificationTaskSettingsV1`、`AboutDiagnosticsSettingsV1`、`ProjectProductionSettingsV1`。

## API 与 Electron IPC 影响

未来 API 必须是类型化、作用域明确的增量，不破坏现有 Provider Connection OpenAPI。路径中的 `{section}` 不是任意字符串，而是由作用域判别的封闭枚举：

```text
GET /api/v1/workspaces/{workspace_id}/settings/{section}
PUT /api/v1/workspaces/{workspace_id}/settings/{section}  If-Match: revision
GET /api/v1/projects/{project_id}/settings/{section}
PUT /api/v1/projects/{project_id}/settings/{section}      If-Match: revision
GET /api/v1/workspaces/{workspace_id}/settings/effective
GET /api/v1/projects/{project_id}/settings/effective
```

路由先检查 `scope.kind + section_id`，不匹配返回类型化 `SCOPE_SECTION_MISMATCH`，不得进入 repository。写操作仅允许受信桌面 Sidecar 会话或未来明确授权的服务端身份；普通 Web 读权限不得自动获得写权限。每个分区独立保存，服务端先校验、再事务提交、再返回完整 effective envelope。失败时保留旧 revision 和 effective value。

Electron preload 不增加 `settings.invoke(name, payload)` 或任意路径访问。每个获批纵切使用精确方法和精确 key，例如 `settings.general.read` / `settings.general.update`，并有参数、返回值、作用域和拒绝用例的合同测试。Renderer 永远不接触系统凭据库和 Provider 密钥。

## 安全连接测试前置条件

模型与 API 的“连接测试/能力发现”在以下策略实现并验证前保持不可点击且明确说明原因：

1. 一次解析取得全部 A/AAAA 地址，任一地址落入禁区即拒绝；连接通过受控 dialer 固定到已校验地址并核对实际 peer，避免 DNS rebinding/TOCTOU；
2. 默认拒绝 loopback、link-local、私网、云元数据和非预期协议；本机 Ollama 使用独立受控策略；
3. HTTP Host 与 TLS SNI 保持用户获准的原始主机；每次重定向都对新目标重新执行完整解析、地址校验、pin 和 peer 校验；
4. 限制请求方法、头、正文、响应大小、超时和重定向次数；
5. 日志和错误不回显凭据，测试结果不伪造“成功”；
6. 能力目录保留 Provider/模型/策略版本快照和显式 `CapabilityLoss`。

## 保存、审计与有效值

- 分区标题显示 dirty 徽标、缺失配置警告、保存中、失败和已生效状态。
- 保存失败回滚到服务端最后确认 revision；表单可保留为“未保存草稿”，但必须与 effective 值并列区分。
- 离开 dirty 分区、切换项目或关闭窗口前提供保留/放弃选择。
- Provider、能力映射、预算、安全、权利和 Gate 修改写入不可变审计事件，包含主体、前后 revision、字段级摘要和原因；敏感值只记录引用与状态。
- UI 初始化、刷新和重连都以服务端 envelope 为真相；LocalStorage 只可保存非权威 UI 展开状态。

## 迁移策略

S03 不执行数据迁移。未来首个实现采用可回滚的加法迁移：

1. 新建按 `scope_kind + scope_id + section + revision` 唯一的版本化设置记录和审计记录；不改写 ArtifactVersion。
2. 现有 Provider Connection 与系统凭据库继续作为连接真相；设置资源只引用 connection ID，不复制密钥。
3. 首次读取没有记录时由后端返回带来源的默认 effective value；用户保存后才创建 revision 1。
4. 项目覆盖只保存与工作区 effective 的差异，删除覆盖恢复继承，不复制全局快照。
5. 每次 Schema 升级有 dry-run、备份、前向迁移和兼容读取期；失败保持旧 revision 可读。
6. 技术名称、包名、数据库名和安装包名不在本迁移范围内。

## 失效关系

| 变更                          | 失效/后续影响                                           | 不应发生                         |
| ----------------------------- | ------------------------------------------------------- | -------------------------------- |
| 主题、语言、减少动画          | 仅 UI effective state                                   | 影视 Artifact 失效               |
| 凭据轮换或状态变化            | 未来 Attempt 可用性、阻塞状态                           | 改写既有 Artifact 或记录密钥     |
| Provider/模型能力映射         | 新 Attempt 固定新快照；相关未执行 PromptPlan 可标 stale | 静默重编译、自动重复计费         |
| 生成预算/并发                 | 新领取和重试策略                                        | 中断不可安全取消的远端请求       |
| 项目画幅/分辨率/帧率/导出规格 | 相关草稿 Timeline、代理媒体、导出计划 stale             | 修改已批准母版或有理数时间基历史 |
| 来源权利或云发送策略收紧      | 阻止不合规运行并升级 Gate                               | 自动放宽策略                     |
| 项目 Gate/审批人              | 未来审批路由                                            | 伪造或迁移既有签名               |
| 单镜头 ShotIntent/参考资产    | 仅对应镜头下游 Prompt/候选/时间线边                     | 全项目设置被改写                 |

`REMOTE_UNKNOWN` 状态下，任何设置变更都不能触发自动重提。质量 QC 自动失败最多在剩余预算内重试一次。

## 响应式边界

桌面负责编辑设置；980px 可查看 effective 值、缺失配置和审计摘要；390px 仅审片、评论和批准，不显示或允许复杂设置入口。不得通过 CSS 隐藏后仍保留可聚焦的配置控件。

## 未来纵切顺序

1. 通用 + 关于/诊断：真实持久化、有效值和诊断脱敏。
2. 模型与 API：补齐安全连接测试与能力发现。
3. 存储与媒体工具状态。
4. 生成与预算。
5. Agent/Skill 只读注册表，再做受控启停。
6. 隐私安全与通知。
7. 项目设置。

每个纵切必须完整覆盖 `Schema → repository → API/OpenAPI → Web transport → Electron exact whitelist → UI → 真实 Chrome/Electron 验收`。没有真实后端能力时，不得先放可点击开关。

## 验收入口

详细测试矩阵见 [设置中心规格验收](../quality/settings-center-spec-acceptance.md)，架构决定见 [ADR-0006](../architecture/ADR-0006-settings-scope-and-effective-values.md)，开源依据见 [设置模式开源吸收矩阵](../research/settings-open-source-patterns-2026-08.md)。
