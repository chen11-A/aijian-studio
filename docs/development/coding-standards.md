# Aijian Studio 编码规范

本规范是合并 Gate，不是建议清单。任何代码变更都必须同时满足正确性、可读性、架构、安全和性能五个审查维度；自动化检查通过只代表最低门槛。

## 通用规则

- 每个变更只解决一个可描述的问题；优先 100～300 行可审查增量，功能与无关重构分开提交。
- 公共行为先写规格与失败测试，再做最小实现。错误路径、边界值、取消、重试和恢复必须有测试。
- 命名表达业务含义，不使用无上下文的 `data`、`result`、`temp`、`manager`；缩写只限领域词典已有词。
- 函数只做一个层次的工作；第三次真实重复前不建立通用框架，不为“以后可能”制造抽象。
- 外部输入在边界校验，内部使用已验证类型。日志不得包含 API Key、令牌、Cookie、小说正文或签名 URL。
- 新依赖必须记录用途、许可证、锁定版本和替代方案；优先标准库与已有依赖。
- 源文件采用 UTF-8；默认 LF，PowerShell 采用 CRLF；提交不得包含尾随空格、缓存和生成目录。

## TypeScript / React / Electron

- TypeScript 保持 `strict`、`noUncheckedIndexedAccess`；禁止 `any`、非必要断言和用 `!` 掩盖生命周期问题。
- 跨 Python/TypeScript 边界只认 OpenAPI/JSON Schema；类型从契约生成，禁止手写第二份 API DTO。
- 组件通过明确 props 接收依赖；网络、IPC、存储分别放在 transport/repository 边界，展示组件不直接调用 Electron 或供应商 SDK。
- React 状态按 `loading / ready / empty / error` 显式建模；异步 effect 必须考虑卸载、重复请求和过期响应。
- Electron Renderer 禁止 Node 集成、供应商密钥和本地端口；所有能力通过 preload 的最小白名单 IPC 暴露。
- 面向用户的错误使用稳定错误码映射，UI 不解析服务端自然语言来决定行为。

## Python / FastAPI

- Python 3.12，公开函数和领域模型必须完整标注类型，mypy strict 与 Ruff 必须通过。
- HTTP 输入输出使用 Pydantic 严格模型；数据库实体不得直接作为公共响应。
- 路由只做鉴权、校验和用例调用；领域规则放在 domain/application 层，基础设施实现依赖倒置接口。
- 异步路由不得直接执行阻塞文件、FFmpeg 或模型调用；长任务进入持久化执行器。
- 所有响应携带 `request_id`；预期错误使用稳定 `code/message/details/retryable` 结构。

## 测试与覆盖率

- Python 行/分支覆盖率最低 90%；TypeScript 行/函数最低 90%、分支最低 80%，关键状态机与安全边界要求 100% 行覆盖。
- 测试命名描述行为和结果，不测试私有实现细节。网络、时间、UUID、文件系统和模型供应商必须可替换。
- UI 变更除单元测试外必须做真实 Chromium 验收；桌面变更必须验证实际窗口、IPC 或安装包行为。
- 恢复类功能必须有故障注入，不能用“正常关闭后能再打开”代替崩溃恢复证明。

## 提交前命令

```powershell
pnpm contracts:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

审查人按 [UI 工程规范](ui-engineering-standards.md)、[安全模型](../security/security-model.md) 和对应实施规格核对人工 Gate。
