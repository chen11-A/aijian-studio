# 开源生产界面与 Agent/Skill 吸收矩阵（2026-08）

本矩阵补充 [GitHub 开源项目审计](github-landscape-2026-08.md)。本轮只研究公开行为、文档和许可证；没有下载、复制或改写上游源码。任何未来代码复用都必须先固定 commit，并写入 provenance/NOTICE。

| 来源                                                             | 已核对许可证                  | 吸收模式                                                                     | Aijian 改造                                                                                                        | 代码边界                                                             |
| ---------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| [Jellyfish](https://github.com/Forget-C/Jellyfish)               | Apache-2.0                    | 剧本拆解→镜头准备→候选确认→生产就绪→生成；角色/场景/道具/服装；任务跳回镜头  | 加 SourceSpan、不可变 ArtifactVersion、具名 Gate、预算、能力损失和任务恢复                                         | 仅在固定提交、依赖审计、provenance/NOTICE 后隔离复用                 |
| [LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama) | MIT                           | 列表/画布双视图、本地桌面、节点编排、完整短剧入口                            | 独立实现节点进度、刷新恢复、尾帧衔接和分镜表导出；降级必须显式                                                     | 优先行为/测试参考；源码复用需单独审计                                |
| [OpenCut](https://github.com/OpenCut-app/OpenCut)                | MIT                           | 专业剪辑器、跨端编辑器方向、可扩展编辑接口                                   | 采用时间尺、播放头、缩放、可见区波形、分页检查器、多选、吸附与帧精确交互；保留 Aijian TimelineVersion/有理数时间基 | 当前上游正重写；不移植内部模型，先写交互合同和 Ripple 测试           |
| [AI-Storyboard](https://github.com/RainLib/AI-Storyboard)        | GitHub 当前标识 GPL-3.0       | Producer+专业 Agent、9 宫格→4 格→Motion Prompt、Director PASS/FAIL、失败升级 | Markdown 输出改为 JSON Schema ArtifactProposal；自动 QC 最多一次预算内重试，之后升级                               | 只研究行为和方法，不复制 GPL 代码、Skill 文本或模板                  |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app)             | Apache-2.0 加补充商业分发限制 | 决策/执行/监督、事件图、画布、Skill 外置                                     | 三层 Agent、声明式 Skill 和任务事件；不采用动态任意代码执行                                                        | 未取得额外授权前禁止复制受限代码或向两个及以上第三方分发衍生受限部分 |
| LumenX / Wind Comic                                              | MIT                           | 六阶段 SOP、长篇/季/集、类型化 DAG、协作与测试思路                           | 对齐七个业务工作区、确定性图和失效传播                                                                             | 独立实现优先；任何代码进入前审传递依赖                               |

## 明确保留的 Aijian 差异

- `SourceSpan` 让事实、改编、剧本和镜头可回到授权原文；参考项目普遍不具备同等字节级来源链。
- `ArtifactVersion` 不可变，提案接受只形成 DRAFT；AI、监督者和 UI 都不能覆盖 accepted 内容。
- 人工 Gate 是具名审计事件，不是 Agent PASS 或一个无版本按钮。
- Task Ledger、租约、幂等键、预算预留和 `REMOTE_UNKNOWN` 负责恢复与防重复扣费。
- Provider Gateway 与 CredentialRef 隔离模型、密钥和 Renderer；会员网页权益不等于 API。
- `ShotIntent → PromptPlan → CompiledPrompt` 保证供应商可替换且能力损失可见。

## 拒绝清单

- 整仓 Fork 后改名；
- 任意 TypeScript/Python Provider 在线执行；
- 将外部 Skill 文本直接提升为系统指令；
- 静默使用静帧、低清或替代模型冒充完整能力；
- 无限自动重生成或 `REMOTE_UNKNOWN` 自动重提；
- 一键覆盖已批准产物；
- 未核对 LICENSE、传递依赖、素材和模型权重就复制代码。

## 进入代码的门禁

为每个候选记录仓库 URL、固定 SHA、文件路径、SPDX、传递依赖、修改说明、安全扫描、测试、NOTICE 和负责人。只有 `reuse` 决策允许进入代码；`behavior-only` 必须由未接触受限源码的实现者依据本仓库规格和测试独立完成。
