# ADR-0006：设置作用域与后端有效值

- 状态：Proposed
- 日期：2026-08-10

## 背景

Aijian Studio 已有模型与 API 连接管理，但尚无完整设置中心。若把全局偏好、项目交付和单镜头创作参数放进同一个通用 JSON 或前端状态，会造成作用域泄漏、密钥暴露、已批准产物被覆盖，以及界面显示“已生效”但 Worker 实际仍使用旧配置。

## 决定

采用三个不可混写的作用域：工作区全局设置、项目设置、领域 Artifact。全局和项目设置按分区独立版本化；镜头参数继续由 ShotIntent、PromptPlan、CompiledPrompt 等不可变 ArtifactVersion 表达。

设置读取返回 `desired + effective + effective_source + revision + validation`。Renderer 只把服务端返回的 `effective` 标为已生效；未提交表单和保存失败内容只能显示为 dirty 草稿。敏感值只存在系统凭据库，设置中仅保存 CredentialRef 和状态。

每个分区独立保存、校验、事务提交和失败回滚。Provider、预算、安全、权利和 Gate 变更进入审计。Electron preload 只开放逐项批准的精确合同，不提供宽泛 settings RPC。390px 不开放复杂设置。

## 替代方案

### 单一 settings JSON

拒绝：无法可靠隔离作用域、并发 revision、分区回滚、审计和迁移，容易让项目覆盖污染全局默认值。

### 前端 LocalStorage 作为配置真相

拒绝：Worker、Sidecar 和其他窗口无法确认同一有效值，清缓存会丢失配置，也无法提供审计和权限边界。

### 把镜头参数全部放入设置中心

拒绝：破坏 ShotIntent 到 CompiledPrompt 的版本链、候选比较、SourceSpan/资产引用和局部失效传播。

### 通用 Electron IPC 转发器

拒绝：扩大 Renderer 权限面，难以对每个 key、作用域和参数做合同测试。

### 先做连接测试再补网络安全

拒绝：用户提供的 OpenAI-compatible 地址是不可信网络输入；在 SSRF、DNS rebinding、重定向和私网策略前不得发送探测请求。

## 后果

- 优点：有效值可证明，作用域明确，密钥不进入 Renderer，分区可以独立交付和回滚。
- 代价：需要分区 Schema、revision、审计、解析器和更多 API/preload 合同。
- 兼容：现有 Provider Connection 保持真相来源，新设置只引用 connection ID；现有 OpenAPI 不做破坏性修改。
- 限制：本 ADR 为 Proposed；在首个纵切通过迁移、API、安全和真实 Electron 验收前，不宣称设置中心已实现。

## 验证

按 [设置中心规格验收](../quality/settings-center-spec-acceptance.md) 检查作用域、敏感值、effective value、保存回滚、失效、迁移和响应式边界。每个未来纵切须有 Schema/repository/API/Web/preload/UI 的纵向合同与真实浏览器/Electron 证据。
