# Phase 0 安全 Sidecar 实施规格

状态：本地实现与验收完成；双平台 CI 待提交验证

对应 Backlog：D01、D02、R01 的首个纵切

## 用户问题

开发固定端口 `127.0.0.1:8000` 不能成为桌面交付架构：端口可能冲突，其他本机进程可以探测无鉴权 API，Renderer 一旦泄露端口或凭据就失去 Electron 进程隔离，Electron 异常退出还可能留下孤儿 Python 进程。

## 协议

1. Electron main 以 stdin/stdout 匿名管道启动 Python sidecar，不在命令行或环境变量传令牌。
2. Python 先绑定 `127.0.0.1:0`，由操作系统分配空闲端口；生成至少 256 bit 随机会话令牌。
3. Python 在 stdout 只写一行 UTF-8 JSON 握手：

```json
{
  "event": "ready",
  "protocol_version": 1,
  "host": "127.0.0.1",
  "port": 43123,
  "token": "一次性随机值",
  "pid": 1234
}
```

4. Electron main 在 20 秒内读取并严格校验握手，令牌只保存在 main 的闭包中；preload 和 Renderer 只获得 `health()` 等窄 IPC 方法。
5. main 代发的每个 HTTP 请求携带 `Authorization: Bearer <token>` 与固定 `Origin: app://aijian`。API 同时校验远端地址、精确 Host、Origin 和恒定时间令牌比较。
6. 缺失/错误令牌返回 401，错误 Host/Origin/客户端地址返回 403；错误体不回显敏感值，所有响应 `Cache-Control: no-store`。
7. Electron 正常退出时关闭 sidecar stdin；Python 监听 EOF 并优雅停止。Electron 崩溃时管道同样关闭，不得留下孤儿 sidecar。

## 开发与交付边界

- `pnpm dev:api` 仍保留无令牌的浏览器开发服务，只绑定 `127.0.0.1:8000`，供 Vite 同源代理使用。
- Electron 开发模式不再连接固定 `8000`，而是自行启动随机端口 sidecar。
- 首版打包前还需把 Python 运行时与后端冻结为受校验资源；本切片使用 `uv` 开发入口，不宣称已经完成安装包。
- 工作室服务器模式使用 HTTPS、用户会话和 RBAC，不复用本地 sidecar 令牌协议。

## 验收标准

- 连续启动 20 次均获得合法且不重复的随机端口/令牌，无端口冲突。
- 未鉴权、错令牌、错 Host、错 Origin、非回环客户端全部被拒绝，错误体和日志不泄露令牌。
- Electron Renderer 源码、DOM、preload 公共对象和环境变量均不包含端口/令牌。
- 关闭桌面窗口后 Python 在 5 秒内退出；强杀 Electron 后也在 5 秒内退出。
- 单元、集成、类型、格式、依赖审计和 Windows/Ubuntu CI 通过。

## 本地验收记录（2026-08-03）

- Windows 连续启动 20 次：20 个随机端口、20 个随机令牌均唯一，未使用固定端口 8000，全部在关闭 stdin 后 5 秒内退出。
- 真实 Electron 窗口：标题为 `Aijian Studio`，窗口可响应；sidecar 仅监听 IPv4 回环地址，端口和令牌未出现在命令行。
- 正常关闭窗口与强制终止 Electron 主进程两条路径均未遗留 Python sidecar。
- Renderer、preload 公共接口与前端源码扫描未发现 sidecar 令牌、Authorization 头或固定交付端口。
- 本地 23 项 Python 测试、26 项桌面测试、5 项前端测试通过；Python 覆盖率 99.33%，桌面覆盖率 95.61%，前端覆盖率 94.59%。
