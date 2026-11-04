# AIVORA（代码包名 Aijian Studio）

面向小说、漫画和原创故事的 AI 原生漫剧/短剧制作工作台。目标不是“一键抽卡式生成视频”，而是把制片、编剧、导演、美术、摄影、声音和剪辑真正连接成可审阅、可回退、可协作的生产流程。

> 2026-10-08：本仓库 `main` 是个人电脑独立重建起点，不是完整迁移或已验收发行版。399 个受保护版本未上传，其中两个路径保留旧版、397 个路径缺失；先读 [个人电脑接手步骤](PERSONAL_COMPUTER_START.md) 和 [缺口清单](handoff/2026-10-08/TRANSFER-EXCLUSIONS.json)。接手先读 [DOTS_HANDOFF.md](DOTS_HANDOFF.md) 和 [完整产品需求与验收基线](docs/product/AIVORA-完整产品需求与验收基线.md)。目标是同一个可直接使用的 Windows 桌面软件，不另建网页产品。演示残留、真实 AI 调用、完整制作流程和安装交付仍需完成；不能把编译或局部测试通过当成整体验收。

## 当前独立开发检查点

累计更新以 `63c76db96ac64fb3dc960af6bda139aed3a6ec10` 为基线，保留原界面。
云 Linux 的真实 Electron 窗口已验证项目/分集、剧本、角色与场景、手工分镜、
本地多片段与 BGM 保存重开，以及横/竖屏 DRAFT MP4 导出和回看。
分镜与媒体现有精确版本引用和上游变化提示。官方文本提案与手工审片记录
已有独立持久合同；真实账号调用、完整专业制作和 Windows 安装验收仍未完成。
历史缺口说明不代表已还原受保护源码，也不能覆盖这些新实现的实际检查记录。

- 当前验证范围：[原生检查点](docs/quality/native-workbench-checkpoint-2026-10-08.md)
- 页面覆盖与限制：[原生界面覆盖](docs/quality/native-layout-coverage-2026-10-08.json)
- Windows 前置条件：[构建工具状态](packaging/windows/TOOLCHAIN-STATUS.md)

## 产品主流程

```text
小说/创意
  -> 原文结构化与来源锚点
  -> 故事圣经 / 角色档案 / 世界观
  -> 季与分集规划
  -> 场景剧本
  -> 镜头表与分镜
  -> 角色/场景/道具资产
  -> 图片/视频/配音/音乐生成
  -> 时间线组装与精剪
  -> 审片、修改、导出
```

AI Agent 负责提出方案和生成结构化产物；确定性工作流负责状态、依赖、版本、审批、重试和恢复。任何 Agent 都不能绕过审批门直接发布成片。

默认决策岗位是“AI 制片协调员”：只理解制作目标、拆解任务、管理预算/风险/阻塞升级，并提出委派和 Gate 建议；不写专业产物、不审批、不直接调用 Provider、不读取密钥。执行与监督岗位使用编剧 Agent、连续性监督 Agent、导演 Agent、美术与资产 Agent、提示词 Agent、剪辑 Agent 和 QC Agent。显示名未来可以自定义，但持久化的稳定 `definition_id` 不依赖中文名称。

## 历史架构设想（当前交付仅 Windows 桌面）

下面的服务器/PWA 设想保留作背景，不属于当前交付授权，不应据此扩建另一套产品。

| 形态           | 面向人群                   | 部署方式                                            | 数据与计算                                       |
| -------------- | -------------------------- | --------------------------------------------------- | ------------------------------------------------ |
| Windows 桌面版 | 个人创作者、小团队单机制作 | Electron 壳 + 本机后端，仅监听随机 `127.0.0.1` 端口 | SQLite、本地素材库、云端 AI API                  |
| 工作室服务器   | 局域网团队、私有云、公开云 | HTTPS 域名 + 认证 API + Worker                      | PostgreSQL、S3/MinIO、Redis、集中算力            |
| 手机审片 PWA   | 导演、制片、客户、外出审批 | 浏览器或安装到 Android/iOS 桌面                     | 连接工作室服务器，只做审阅、批注、审批和轻量上传 |

桌面版里的随机本机端口只是 Electron 与本机后端的进程间通信，不是给其他人访问的服务器。多人使用必须部署“工作室服务器”，不能把无鉴权的 FastAPI/Express 直接绑定到 `0.0.0.0`。

## 技术方向

- 前端：React + TypeScript + Vite，桌面端使用 Electron；同一组件体系支持 Web/PWA。
- 后端：Python 3.12 + FastAPI + SQLAlchemy + Pydantic，OpenAPI 是前后端契约来源。
- 工作流：自研小型持久化状态机；生成节点可选用 Agent/模型，流程控制不交给模型。
- 数据：桌面 SQLite；服务器 PostgreSQL；素材为内容寻址存储，服务器支持 S3/MinIO。
- 任务：任务真相保存在数据库；桌面本地执行器、服务器分布式执行器实现统一接口。
- 音视频：FFmpeg 执行媒体任务；评估 Apache-2.0 HyperFrames 作为字幕/转场/2D 包装的确定性渲染 lane；OpenTimelineIO 用于跨剪辑软件交换，不把 GPL/AGPL 编辑器代码并入核心。
- 许可证：自有代码采用 Apache-2.0。所有上游仍需固定提交、来源、许可证、NOTICE 和 SBOM 审计，审计通过前不引入第三方代码。

## 设计资料

- [产品需求规格](docs/product/PRD.md)
- [系统架构与部署](docs/architecture/system-architecture.md)
- [确定性工作流与 Agent 协作](docs/architecture/workflow-and-agents.md)
- [GitHub 开源项目审计](docs/research/github-landscape-2026-08.md)
- [48 周交付路线图](docs/roadmap/48-week-plan.md)
- [首个 8 周可执行任务](docs/roadmap/phase-0-backlog.md)
- [安全模型](docs/security/security-model.md)
- [质量基线](docs/quality/quality-baseline-v0.md)

## 本地开发

目标平台为 Windows 11；本开发检查点已在 Linux 验证原生启动，Windows 仍需实测。
准备 Git、Node.js 24、pnpm 11.9.0、Python 3.12 和 uv，遵循锁文件安装：

```powershell
pnpm install --frozen-lockfile
uv sync --frozen
pnpm dev
```

`pnpm dev` 构建并打开 Electron，由主进程启动受控 Python sidecar，使用随机
`127.0.0.1` 端口和一次性令牌。不需要另起网页或 API 服务。先创建合成测试
项目；打开已有数据库前备份。累计更新含向前迁移，不能假定旧程序可回读。
无源码、Python 和构建工具的 Windows 用户仍需等待完成验证的安装器。

本地导出需要匹配固定哈希的 FFmpeg/FFprobe，配置及不支持项见
[DRAFT MP4 说明](docs/architecture/draft-mp4-export.md)。账号授权使用系统安全
凭据库；库不可用时保持禁用，不改用明文或关闭沙箱。首次入口可跳过 AI 登录，
直接配置 API 或进行本地创作；填写凭据与真实调用需要用户自己的授权。

常用质量命令：

```powershell
pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

当前 walking skeleton 的实施边界和验收标准见 [Phase 0 实施规格](docs/specs/phase0-walking-skeleton.md)。

## 当前原则

1. 先保证可编辑、可追溯、可重做，再追求“一键全自动”。
2. 小说拆解必须保留段落级来源锚点，不能只生成一份失去出处的剧本。
3. 提示词是编译产物：先保存镜头意图，再针对不同供应商生成具体提示词。
4. 开发者 API 连接与官方 ChatGPT 账号授权是分开的通道；是否可用以真实授权、模型目录与调用验证为准，不能把一个登录推断为图片、视频或配音均可用。
5. 桌面、服务器和手机使用同一领域模型与 API 契约，不维护三套业务逻辑。
