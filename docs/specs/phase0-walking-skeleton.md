# Phase 0 Walking Skeleton 实施规格

状态：首个纵切已完成

负责人：技术负责人
对应 Backlog：A02、A03、B01、D01 的最小前置切片

## 目标

建立一个可以在 Windows 开发机上安装依赖、启动、测试和构建的纵向工程骨架。React 工作台通过统一传输接口读取 FastAPI 的版本化健康契约；Electron 只在主进程访问本地 API，Renderer 不接触端口、令牌或 Node API。

本切片证明工程边界和交付链可运行，不宣称已经完成随机端口 sidecar、项目数据模型、小说拆解、AI Provider 或媒体时间线。

## 目录与边界

```text
apps/studio-web/       React + Vite 创作工作台
apps/desktop/          Electron main/preload 桌面壳
services/api/          FastAPI 组合入口与测试
packages/contracts/    OpenAPI 生成的 TypeScript 契约
scripts/               OpenAPI 导出与本地开发入口
```

- Python 是 HTTP 契约的权威实现，并导出 OpenAPI。
- TypeScript 客户端类型从 OpenAPI 生成，不手写第二份响应模型。
- 浏览器开发模式通过 Vite 同源代理访问 API。
- Electron Renderer 通过 preload 暴露的窄接口访问 Electron main；禁用 `nodeIntegration`，启用 `contextIsolation` 和 sandbox。
- API Key、启动令牌、用户小说和媒体均不进入示例、日志、测试夹具或版本库。

## 首个公共契约

`GET /api/v1/health` 返回：

```json
{
  "data": {
    "status": "ok",
    "service": "aijian-api",
    "version": "0.1.0"
  },
  "request_id": "UUID"
}
```

响应头 `X-Request-ID` 与响应体一致。调用方提供合法 UUID 时沿用；非法或缺失时服务端重新生成，以避免日志注入。

## 开发命令

```powershell
pnpm install
uv sync --python 3.12
pnpm contracts:generate
pnpm dev
```

独立入口为 `pnpm dev:api`、`pnpm dev:web` 和 `pnpm dev:desktop`。CI 执行 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 和 Python 对应检查。

## 测试策略

1. FastAPI 合约测试验证状态码、响应体、UUID 传播/净化和 OpenAPI 路由。
2. React 单元测试验证连接中、已连接、失败和重试状态，网络由传输边界替身隔离。
3. TypeScript 编译验证 preload、IPC 和生成契约没有漂移。
4. 真实 Chromium 冒烟验证工作台渲染和 API 连接状态。
5. CI 从干净环境恢复锁文件并重跑上述检查。

## 验收标准

- `pnpm install --frozen-lockfile` 与 `uv sync --frozen` 成功。
- API、Web、Desktop 均可独立启动或构建。
- OpenAPI 重新生成后 Git 工作区无差异。
- Renderer 源码无法直接读取本地 API 地址或 Node/Electron 模块。
- 无密钥、Cookie、`.env`、缓存、构建产物或 `upstreams/` 被纳入提交。
- Windows 本地开发与 GitHub Actions 的 lint、typecheck、unit、build 全部通过。

## 后续切片

下一切片实现 Electron 启动 Python sidecar、操作系统随机回环端口、一次性启动令牌、`app://aijian` scheme 和生命周期恢复；再进入 Project/Source/Artifact/Workflow 领域模型。当前固定端口只用于开发代理，不作为交付架构。
