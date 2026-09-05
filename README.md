# Aijian Studio（阿健漫剧工场，暂定名）

面向小说、漫画和原创故事的 AI 原生漫剧/短剧制作工作台。目标不是“一键抽卡式生成视频”，而是把制片、编剧、导演、美术、摄影、声音和剪辑真正连接成可审阅、可回退、可协作的生产流程。

> 项目目前处于规格与架构阶段。公开仓库已确定为 `chen11-A/aijian-studio`；“阿健漫剧工场”仍是暂定产品展示名。

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

AI Agent 负责提出方案和生成结构化产物；确定性工作流负责状态、依赖、版本、审批、重试和恢复。任何 Agent 都不能绕过审批门直接发布成片。普通用户看到的是故事、角色、分镜、生成、审片、导出；专业用户展开同一份数据。

## 三种使用方式

| 形态 | 面向人群 | 部署方式 | 数据与计算 |
| --- | --- | --- | --- |
| Windows 桌面版 | 个人创作者、小团队单机制作 | Electron 壳 + 本机后端，仅监听随机 `127.0.0.1` 端口 | SQLite、本地素材库、云端 AI API |
| 工作室服务器 | 局域网团队、私有云、公开云 | HTTPS 域名 + 认证 API + Worker | PostgreSQL、S3/MinIO、Redis、集中算力 |
| 手机审片 PWA | 导演、制片、客户、外出审批 | 浏览器或安装到 Android/iOS 桌面 | 连接工作室服务器，只做审阅、批注、审批和轻量上传 |

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

- [产品与系统总体方案（v0.2 overlay）](docs/product/overall-system-proposal.md)
- [产品需求规格](docs/product/PRD.md)
- [系统架构与部署](docs/architecture/system-architecture.md)
- [确定性工作流与 Agent 协作](docs/architecture/workflow-and-agents.md)
- [ADR-0005 普通/专业双视图](docs/architecture/ADR-0005-casual-professional-views.md)
- [ADR-0006 整轮审片与 ChangePlan](docs/architecture/ADR-0006-review-round-and-change-plan.md)
- [审片与修改计划契约](docs/contracts/review-annotation-and-change-plan.md)
- [GitHub 开源项目审计](docs/research/github-landscape-2026-08.md)
- [48 周交付路线图](docs/roadmap/48-week-plan.md)
- [首个 8 周可执行任务](docs/roadmap/phase-0-backlog.md)
- [安全模型](docs/security/security-model.md)
- [质量基线](docs/quality/quality-baseline-v0.md)

## 当前原则

1. 先保证可编辑、可追溯、可重做，再追求“一键全自动”。
2. 小说拆解必须保留段落级来源锚点，不能只生成一份失去出处的剧本。
3. 提示词是编译产物：先保存镜头意图，再针对不同供应商生成具体提示词。
4. ChatGPT 和 Grok 网页会员通常不能替代开发者 API；软件支持用户自带 API Key，也支持 OpenAI-compatible 服务。
5. 桌面、服务器和手机使用同一领域模型与 API 契约，不维护三套业务逻辑。
6. 普通模式与专业模式是同一 `project_id` 的两套 UI；切换不得复制项目或触发重新生成。
7. 审片批注保存后继续播放；整轮审核完成后再生成统一修改方案。发布权始终在人。
