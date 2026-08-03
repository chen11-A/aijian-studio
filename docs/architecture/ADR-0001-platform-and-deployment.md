# ADR-0001：React/Electron + FastAPI 与三形态部署

- 状态：Accepted for Phase 0
- 日期：2026-08-03

## 背景

产品既要让个人 Windows 用户开箱即用，也要让工作室成员和手机审片人访问。单纯将本机 FastAPI 绑定 `127.0.0.1` 无法协作；把无鉴权服务绑定 `0.0.0.0` 又不可接受。Qt/Android 原生会提高多端业务重复度。

## 决定

使用 React/Vite 的共享前端、Electron Windows 桌面壳和 FastAPI 模块化单体。桌面运行本地 sidecar；团队部署相同 API 的服务器形态；PWA 连接服务器。领域契约经 OpenAPI/JSON Schema 共享。

本地 sidecar 由 Electron 监督，只监听随机回环端口并校验每次启动令牌。Renderer 使用 `app://aijian` 和上下文隔离的 preload，只调用类型化 IPC；Electron main 独占端口/令牌并代发请求。服务器只经 HTTPS Gateway 暴露，并增加身份、RBAC、PostgreSQL、对象存储和分布式 Worker。

桌面生命周期固定为：关闭窗口＝托盘常驻；显式退出＝停止领取、到安全检查点后终止本地 worker；远端已提交任务保持可恢复轮询；异常退出＝下次启动按租约恢复。安装器和任务恢复测试必须覆盖四种路径。

## 后果

- 优点：桌面/Web/PWA 复用 UI 与 API；无限画布、协作和管理生态成熟；上游参考充分。
- 代价：Electron 内存较高；Python sidecar 打包、升级和进程恢复必须专项设计。
- 缓解：媒体/Worker 独立进程，UI 虚拟化，制定内存/播放性能预算；只在量测证据表明需要时引入 Rust/C++ 模块。
- 非决定：macOS、原生 Android、离线多人冲突合并和 Qt 媒体模块不属于本 ADR 的 1.0 承诺。

## 验证

W4 前必须同时证明：桌面随机端口/令牌的安全 POC、Renderer 经 IPC transport 调用且无法读取端口/令牌、Web 通过 HTTPS transport 调用同一契约、Renderer 不接触供应商密钥、四种生命周期和 sidecar 强杀后项目无损。如果验证失败，本 ADR 重新进入 Proposed。
