# Phase 0 模型与 API 连接规格

日期：2026-08-04

## 用户结果

创作者无需先打开项目即可进入“模型与 API”，登记 OpenAI、xAI、OpenAI-compatible 或本地 Ollama 连接，并至少按文本、图片、视频、配音中的一种能力填写模型 ID。ChatGPT/Grok 会员不是 API 凭据；云供应商必须填写开发者 API Key。

本切片只建立安全配置和能力目录，不调用真实模型，也不声称连接已测试。网络探测必须等 Provider Gateway 的 SSRF、防重定向、DNS 解析后地址复验和超时策略完成。

## 数据与秘密边界

SQLite `provider_connections` 只保存：

- `connection_id`、供应商类型、显示名称、Base URL、启用状态；
- 模型 ID 与能力列表；
- revision 与时间戳。

API Key 使用 Python `SecretStr` 在写请求边界接收，由 `SystemCredentialVault` 写入操作系统凭据库，账户名为不可猜用途之外的连接 ID；列表和创建响应只返回 `CONFIGURED / MISSING / UNAVAILABLE`。数据库、OpenAPI 响应、Electron IPC、日志和前端状态均没有读取密钥的字段。

写入顺序为“先建元数据、再写凭据”；凭据写入或回读校验失败时先尝试补偿删除凭据，再删除元数据并返回稳定 503。如果补偿删除也失败，则保留带稳定连接 ID 的元数据，使凭据仍可见、可定位和可重试清理，禁止把可能存在的密钥变成孤儿。删除顺序为“先确认资源存在、再删凭据、最后删元数据”，防止 UI 删除后遗留秘密。系统凭据库不可用时列表仍可读取元数据并明确显示 `UNAVAILABLE`。

## URL 规则

- OpenAI 只允许精确地址 `https://api.openai.com/v1`，xAI 只允许 `https://api.x.ai/v1`。
- OpenAI-compatible 必须使用 HTTPS；显式 localhost、非公网 IP、URL 内嵌用户名/密码、query、fragment、空白和非法端口一律拒绝。域名解析后的地址仍由未来 Provider Gateway 在真正出站前复验。
- Ollama 只允许 `localhost`、`127.0.0.1`、`::1` 回环地址；远程地址即使是 HTTPS 也拒绝。
- Renderer 和 FastAPI 两侧都做结构校验；后端是权威边界。
- 当前只存储 URL，不发起网络请求，因此不会形成 SSRF 执行路径。
- 后续连接测试不得静默继承代理或跟随重定向，且必须对 DNS 解析后的每个地址重复执行网络策略。

## 类型化接口

```http
GET    /api/v1/provider-connections
POST   /api/v1/provider-connections
DELETE /api/v1/provider-connections/{connection_id}
```

OpenAPI 生成 TypeScript 契约。Electron preload 只暴露上述三项明确 IPC；main 对请求和响应做 exact-key 运行时校验，若响应出现 `api_key` 等 secret-shaped 额外字段则拒绝交给 Renderer。

## 部署范围

Phase 0 的 `provider_connections` 是单用户桌面本地表，不含 `workspace_id`，也不作为工作室服务器多租户实现复用。服务器模式开放前必须另行完成工作区作用域、RBAC、不可变审计事件、服务端 Secret/KMS 和跨租户矩阵测试；任一项未完成都阻断 Studio Beta。

## 界面状态

- loading：读取系统配置；
- ready：连接卡显示 URL、模型能力和凭据状态；
- empty：说明可接入的四类 Provider；
- error：提供重新读取；
- saving：保存按钮禁用并显示安全写入状态；
- delete：卡片内两步确认，同时明确会删除系统凭据。

## 验收

- 云 Provider 缺少 API Key、没有模型、重复模型 ID、远程 HTTP、内嵌凭据/query/fragment 均返回 422。
- 本机 Ollama 可以无密钥保存，状态为 `MISSING`，界面翻译为“无需密钥 / 未配置”。
- 凭据库明确失败返回 503 并回滚元数据；写入结果不确定且补偿删除失败时返回 503 但保留元数据恢复身份。重复名称返回 409；重复删除返回 404。
- OpenAPI、Web transport、真实 Edge Chromium、真实 Electron IPC/Renderer 均通过；截图、尺寸和机器可读结果见 `docs/quality/phase0-provider-settings-acceptance.md`。
