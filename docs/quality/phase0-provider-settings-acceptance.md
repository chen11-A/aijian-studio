# Phase 0 模型与 API 界面验收记录

日期：2026-08-04

范围：全宽工作台重构、Provider 元数据 API、操作系统凭据库边界、Web/Electron transport 和模型连接界面。

## 真实浏览器结果

Playwright 驱动 Microsoft Edge Chromium 连接本地 Vite 与 FastAPI，通过可见表单真实创建一个无密钥的本机 Ollama 配置、从列表读回并在取证后删除；没有调用 Ollama 或任何云模型。

| 视口      | 工作区结果                                                 | 横向溢出 | 控制台              |
| --------- | ---------------------------------------------------------- | -------- | ------------------- |
| 1920×1080 | 224px 侧栏；连接列表与完整 API 表单并列                    | 0px      | 0 error / 0 warning |
| 1440×900  | 224px 侧栏；连接列表与 API 表单并列                        | 0px      | 0 error / 0 warning |
| 390×844   | 品牌与一级导航分行；连接卡单列并提供“新增连接”锚点直达表单 | 0px      | 0 error / 0 warning |

真实截图：

- [1920×1080 模型连接](evidence/provider-settings-1920x1080.png)
- [1440×900 模型连接](evidence/provider-settings-1440x900.png)
- [390×844 模型连接](evidence/provider-settings-390x844.png)
- [1920×1080 项目工作台](evidence/project-workspace-1920x1080.png)
- [Web 自动化结果](evidence/provider-settings-web-smoke.json)

## 真实 Electron 结果

自动化启动打包目标使用的 Electron、随机回环端口 FastAPI sidecar 和隔离用户数据目录，通过 preload → IPC → main → HTTP → SQLite 完成创建、列表和删除往返。1424×881 Renderer 无横向溢出、无控制台错误；`process` 与 `require` 均为 `undefined`，`window.aijian` 必须精确匹配 14 个类型化方法白名单。

- [1424×881 Electron 模型连接](evidence/provider-settings-electron-1424x881.png)
- [Electron 自动化结果](evidence/provider-settings-electron-smoke.json)

## 任务路径与语义

- 从任意状态进入“模型与 API”只需一次一级导航操作，不要求先创建项目。
- 表单顺序为供应商类型、连接信息、写入型 API Key、按能力分类的模型 ID、保存。
- 语义树包含 `h1 模型与 API → h2 统一模型连接 → h3 已配置连接/添加模型供应商`；字段均有关联 label，供应商选择使用 pressed 状态。
- 删除需要卡片内第二次明确确认；密钥输入为 password，关闭自动完成，保存后不回填。
- 会员/API 区别以及凭据存储位置在首屏可见。
- 移动端连接列表标题提供“新增连接”锚点，避免已有连接较多时必须盲目长滚动寻找表单。

## 安全证明

- SQLite 仅有 Provider 元数据；带特征测试密钥不出现在数据库和响应中。
- `SystemCredentialVault` 对写入、读取、删除、后端异常、回读不一致和补偿删除失败都有测试；任何不一致都先尝试删除，补偿失败则保留连接元数据用于恢复。
- Windows 当前用户的真实系统凭据后端完成一次随机测试凭据的写入、读取、删除往返；测试项已删除，未使用用户 API Key。
- [凭据库自动化结果](evidence/credential-vault-smoke.json) 只记录通过状态和删除确认，不记录随机连接 ID 或测试密钥；可用 `pnpm evidence:credential-vault` 重跑。
- Renderer 只得到凭据状态；Electron main 拒绝带 secret-shaped 多余字段的响应，真实 Electron 验收同时证明没有暴露 Node 全局或通用 `invoke/fetch/token/url` 桥接能力。
- 本轮未实现网络连接测试，因此没有以 UI 配置入口绕过 SSRF 策略。

## 边界

这份验收证明配置入口、桌面布局和秘密边界可运行，不证明 OpenAI/xAI 账户有效、模型 ID 可用或媒体生成成功。真实 Provider Spike、密钥轮换、连接测试、限额/费用和 401/429/5xx 处理仍按 Phase 0 Backlog 独立验收。

复现命令：`pnpm evidence:provider-ui`、`pnpm test:e2e:desktop` 和 `pnpm evidence:credential-vault`；等待本地服务的命令均设置 30 秒上限。
