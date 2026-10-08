# 设置与配置：开源模式吸收矩阵（2026-08）

本矩阵补充 [GitHub 开源项目审计](github-landscape-2026-08.md) 与 [生产模式矩阵](open-source-production-patterns-2026-08.md)。本轮只依据公开界面、文档和已记录许可证研究信息架构与行为，没有复制上游源码。许可证结论须在任何代码复用前按固定 commit 重新核对。

| 来源                                                                               | 已记录许可证                        | 观察到的设置模式                                                                    | 决策                              | Aijian 适配                                                                                    | 代码边界                                                                                             |
| ---------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [LumenX](https://github.com/alibaba/lumenx)                                        | MIT                                 | 通用、模型、提示词、API Key、存储、关于                                             | Adapt                             | 按作用域拆分；API Key 改为系统凭据库中的 CredentialRef；提示词模板进入版本化 Skill/Prompt 合同 | 独立实现优先；源码复用前固定提交、审依赖并记 provenance/NOTICE                                       |
| [LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama)                   | MIT                                 | AI 配置、提示词、业务场景模型映射、生成并发、资产服务                               | Adapt                             | 吸收能力映射、并发和资产服务状态；加入 effective value、预算、显式能力损失和项目覆盖           | 仅参考行为和测试；任何源码复用单独审计                                                               |
| [ArcReel](https://github.com/ArcReel/ArcReel)                                      | AGPL-3.0                            | Provider、Agent、媒体、用量/费用、API Keys、关于；分区独立保存、dirty、缺失配置警告 | Absorb behavior / Reject code     | 吸收独立保存、dirty 徽标、离页警告、缺失配置与费用分区；密钥仍只进凭据库                       | AGPL-3.0 与本仓分发边界不兼容，禁止复制代码；仅独立实现公开行为                                      |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app)                               | Apache-2.0 声明并附补充商业分发限制 | Provider、模型/Prompt、Skill、记忆、Agent 部署、文件、数据库、开发、关于            | Adapt IA / Reject unsafe behavior | 仅参考分区信息架构；Skill 使用声明式受控注册表，文件/数据库只显示安全状态                      | 未获授权禁止复制受限代码；拒绝任意 TypeScript Provider 执行、外部 Skill 自动信任和危险数据库清理入口 |
| [PrintFilm（yuanzhongqiao/printfilm）](https://github.com/yuanzhongqiao/printfilm) | 仓库未提供明确许可证文件            | 全局、对话、图片、视频模型及温度、Token、画幅、时长                                 | Adapt concepts / Reject code      | 模型参数按能力分区；Token/预算进入费用策略；画幅和时长属于项目或镜头，不进入全局               | 公开 GitHub 仓库仅作行为观察；无明确许可证时不复制代码或资源                                         |
| [Jellyfish](https://github.com/Forget-C/Jellyfish)                                 | Apache-2.0                          | 基础偏好与模型、提示词、Agent 作为独立一级页面                                      | Absorb principle                  | 不把所有能力塞进“设置”；模型/API 是全局入口，提示词和 Agent 同时在业务工作区保留版本与上下文   | 代码复用必须固定提交、隔离提取、依赖审计并更新 provenance/NOTICE                                     |

## 统一取舍

### Absorb

- 分区独立保存、dirty 徽标、离页警告、缺失配置警告和费用可见性。
- Provider/模型能力映射与媒体工具状态分离。
- 模型、提示词和 Agent 不必全部藏在一个庞大设置页；业务工作区保留任务上下文。

### Adapt

- 所有“已生效”状态改为服务端 effective value，不接受前端缓存自证。
- API Key/Token 一律改成 CredentialRef；模型和 Agent 运行固定版本与能力快照。
- 画幅、时长、帧率、来源权利和审批属于项目；种子、运镜和参考图属于镜头。
- 动态 Skill/Provider 改成声明式 Schema、白名单工具和受控 Worker。

### Reject

- 整仓 Fork 或未经许可证核验复制源码、样式和素材。
- 任意 TypeScript Provider 在线执行、外部 Skill 自动提升为系统指令。
- 密钥明文、回传 Renderer 或写进项目文件。
- 危险数据库清理入口、静默能力降级、无限自动生成和覆盖已批准 Artifact。
- 在网络目标安全策略完成前启用 OpenAI-compatible 连接探测。

## 来源进入代码的 Gate

任何上游代码候选必须记录仓库 URL、固定 commit、文件路径、SPDX/许可证文件、传递依赖、修改说明和 NOTICE 义务；许可证不明确、附加商业限制或与 Apache-2.0 分发不兼容时，只允许独立实现产品行为和测试思路。
