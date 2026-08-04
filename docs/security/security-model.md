# 安全模型

## 保护目标

- 用户原文、未发布剧本、人物素材和成片。
- OpenAI、xAI 及其他供应商密钥。
- 工作区身份、审批记录、预算和调用账单。
- 供应商返回的任务 ID、签名 URL 和生成内容。
- 桌面本地执行权限与服务器 Worker 权限。

## 信任边界

1. Electron Renderer 不可信：开启上下文隔离，禁用 Node integration，只通过最小 preload API。
2. 本地 API 不是公开服务：仅回环监听、随机端口、会话令牌、严格 Origin；端口本身不是安全措施。
3. 服务器入口必须经过 TLS Gateway 和认证；不允许将调试 Uvicorn/Express 直接暴露互联网。
4. Worker 处理不可信媒体和模型输出，使用低权限账户、工作目录配额和超时。
5. 外部供应商、用户配置的 Base URL 和 ComfyUI 都是外部信任域。

## 密钥管理

- 桌面：Windows Credential Manager/DPAPI；数据库只保存 `credential_ref` 和掩码。
- 服务器：加密 Secrets 表或外部 KMS/Vault；主密钥不与数据库备份存放在一起。
- API 只支持创建、轮换、测试和删除密钥；读取接口永不返回明文。
- 日志、错误、遥测、导出包和截图自动脱敏。
- Provider 子进程按任务获取短期解密值，结束后清除内存引用；不写临时 `.env`。

Phase 0 已实现 Provider 创建/列表/删除的最小安全切片：SQLite 只保存连接与模型能力元数据，API Key 通过 write-only `SecretStr` 输入后写入 Python keyring 对接的操作系统凭据库。公开响应和 Electron Renderer 只看到 `CONFIGURED / MISSING / UNAVAILABLE`。凭据写入后的任何回读不一致都触发补偿删除；若补偿也失败，元数据不得回滚，以稳定连接 ID 保留可定位的恢复入口。连接测试与轮换尚未开放；完成 SSRF 和 Provider Gateway 约束前，不允许用通用 Base URL 发起探测请求。

## 网络与 SSRF

- 内置供应商固定允许的 HTTPS Origin。
- 自定义 OpenAI-compatible 登记只允许 HTTPS，并立即拒绝显式 localhost 和非公网 IP；域名的 DNS 结果必须在未来 Provider Gateway 真正出站前再次校验，禁止环回、链路本地、云元数据和内网网段。
- “本地 ComfyUI”是单独连接类型，只允许桌面本机或管理员许可的私网地址。
- 下载远程媒体限制协议、重定向次数、大小、MIME、超时和解压后体积。
- 通用 OpenAI-compatible 登记首版只允许 HTTPS，并拒绝 URL 内嵌凭据和显式非公网 IP。后续 Provider Gateway 请求必须零重定向、绑定登记 Origin，并拒绝 DNS 解析后落入云元数据、链路本地和内网地址。私网 HTTP 必须使用单独的“受信任本地服务”流程并再次确认。
- 不让用户注入任意 Header、Shell 模板或可执行请求代码；不静默继承系统代理。

## 多租户和授权

当前 Phase 0 Provider 表仅属于单用户桌面数据库，不满足本节的服务器多租户要求。服务器模式不得直接复用该表上线；必须先加入 `workspace_id`、Repository 强制作用域和 Provider 创建/删除/轮换审计事件。

- 所有服务器资源包含 `workspace_id`，查询必须在 Repository 层强制作用域。
- 对象存储 Key 含不可猜测 ID；下载使用短时签名 URL。
- RBAC 与对象级责任分开：有 Creator 角色不表示可访问所有项目。
- 审批、密钥、成员、预算、导出和删除属于高风险操作，写入不可变审计事件。
- 自动化 Agent 使用服务身份，权限小于其发起用户，不能提升权限。

## AI/Agent 风险

- 导入小说、提示词模板和网页内容全部视为不可信输入，防止 prompt injection 触发工具或泄露密钥。
- Agent 工具使用白名单和结构化参数；不提供任意 Shell、SQL、文件系统或网络能力。
- 模型输出先过 Schema、大小、路径、URL 和业务规则校验。
- 可执行 Skill/脚本与普通提示词分仓管理，必须签名/审核；动态 TypeScript/Python 默认禁用。
- 敏感内容和版权判断只生成风险报告，最终由人负责。

## 媒体处理

- FFmpeg/解析器在受限子进程运行，限制 CPU、内存、时长、输出大小和文件路径。
- 文件以服务器生成的 ID 命名，不使用用户文件名拼接路径。
- 上传先隔离，完成病毒/格式/元数据检查后再进入素材库。
- 项目导出防 Zip Slip，导入先验证 manifest、哈希和迁移版本。
- DOCX/EPUB/项目归档在应用控制的暂存目录解析；拒绝绝对路径、`..`、设备名、重解析点、异常压缩比、过深目录和 MIME 不符。
- FFmpeg 使用参数数组直接启动，不经过 Shell；filter graph 来自类型化 AST，不接受用户原始过滤器字符串。

## 发布门禁

### Creator Beta 前

- 桌面本地 API 的 IPC 隔离、Host/Origin/令牌和 DNS rebinding 测试。
- Windows Credential Manager、日志脱敏、备份/诊断包和带特征假密钥泄漏测试。
- 通用 Endpoint 的 SSRF、任意文件读写、Zip Slip、恶意媒体和 FFmpeg 资源滥用测试。
- 第一份安装包就包含完整 SBOM、依赖/字体/模型/FFmpeg 构建许可证与 NOTICE；不能等 GA。
- 安装/更新签名、项目迁移快照和崩溃恢复测试。

### Studio Beta 前

- 服务器跨工作区 IDOR、对象存储 Key、队列消息、缓存、SSE/WebSocket 和审片链接矩阵测试。
- 服务器 Secret、备份恢复、容器镜像和基础设施最小权限测试。
- 威胁模型复审、依赖/容器 SBOM、72 小时负载和第三方渗透测试。
- 使用带特征的假密钥贯穿数据库、日志、崩溃报告、诊断包、备份和导出，自动断言不存在泄漏。
