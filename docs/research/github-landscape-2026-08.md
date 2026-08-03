# GitHub 开源项目审计（2026-08）

## 结论

不选择一个仓库整包改名，也不把所有好功能直接拼接。新项目采用 Apache-2.0 干净仓库，以 Jellyfish 的领域模型和任务架构为首要参考，以 LumenX、Wind Comic、Toonflow、LocalMiniDrama、ViMax 补齐创作流程、画布、桌面打包和 Agent 分工；许可证不兼容或没有许可证的项目只做产品行为研究。

原因是这些项目各自解决了部分问题，但没有一个同时满足：长篇小说来源追溯、专业剧本/分镜、资产一致性、确定性生产工作流、桌面离线、多人协作、安全密钥、领域剪辑器、开放许可证和可维护测试。

## 分层清单

### A 级：允许在审计后复用代码或依赖

| 项目                                                                          | 许可证     | 取其精华                                                                                              | 不能照搬的部分                                                          | 决策                                           |
| ----------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| [Jellyfish](https://github.com/Forget-C/Jellyfish)                            | Apache-2.0 | Project/Chapter/Shot/ShotDetail、角色/场景/服装/道具、PromptTemplate、统一任务真相层、OpenAPI 客户端  | 无完整鉴权和多租户；API Key 数据库存储方案不达标；缺桌面/NLE/全文来源链 | 主要架构参考，做隔离式提取实验，不整仓 Fork    |
| [LumenX](https://github.com/alibaba/lumenx)                                   | MIT        | 六阶段漫剧 SOP、模型目录、参考图工作流、供应商接入体验                                                | 固定本机端口、宽松 CORS、核心 API/流水线文件过大                        | 复用交互与流程概念，按模块重写                 |
| [Wind Comic](https://github.com/ChrisChen667788/wind-comic)                   | MIT        | 长篇/季/集、类型化 DAG、时间线、Yjs 协作、SQLite/PostgreSQL 双模式、较多测试                          | 存储抽象仍有绕过；部署文档暴露单 Redis 通道和 SQLite 并发问题           | 复用测试思路、图模型和协作协议概念             |
| [Toonflow](https://github.com/HBAI-Ltd/Toonflow-app)                          | Apache-2.0 | 无限画布、章节事件图、三层 Agent、可编辑 Skills、本机随机端口                                         | 可编辑 UI 源码并不完整，主要前端是编译产物；宽松 CORS；动态代码执行风险 | 只选服务端小模块或设计，不能作为 UI 基座       |
| [LocalMiniDrama](https://github.com/xuanyustudio/LocalMiniDrama)              | MIT        | Electron Windows 打包、FFmpeg 探测、桌面本地后端、供应商覆盖                                          | 独立服务器模式缺少可靠鉴权；密钥明文和前端回传风险                      | 只借鉴打包、迁移和媒体探测                     |
| [ViMax](https://github.com/HKUDS/ViMax)                                       | MIT        | 制片人/导演/编剧等 Agent 角色、Idea/Script/Novel 三入口                                               | 研究型编排，不是完整生产系统                                            | 复用提示词与角色边界概念                       |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | Apache-2.0 | 时间线交换模型、FCPXML/AAF/EDL 等适配                                                                 | 不能承载全部 AI 来源/提示词/审批元数据                                  | 作为导入导出层，不作为唯一内部模型             |
| [React Flow / xyflow](https://github.com/xyflow/xyflow)                       | MIT        | 节点画布、工作流和事件图 UI                                                                           | 大型画布仍需虚拟化与状态设计                                            | 作为前端依赖候选                               |
| [HyperFrames](https://github.com/heygen-com/hyperframes)                      | Apache-2.0 | HTML/CSS/GSAP 可寻址逐帧渲染、Puppeteer + FFmpeg、字幕/图表/转场/包装动效、同源确定性输出             | 不是影视时间线、人物视频生成器或资产连续性系统；Chromium 渲染成本需实测 | W4 做渲染 Spike，候选内置 motion-graphics lane |
| [Code2MP4](https://github.com/code2mp4/code2mp4)                              | Apache-2.0 | Brief/Script/Storyboard/Scene/Render Config Schema、七层 Prompt Stack、质量清单、可编辑 motion source | 2026-08 审计时社区和发布成熟度仍很低；偏产品宣传/解释视频，不是漫剧     | 只借鉴契约和测试夹具，暂不做基座或核心依赖     |

任何上游代码进入仓库前，都必须记录源仓库、固定提交、文件路径、许可证、修改说明和 NOTICE 需求。A 级不等于“可随意复制”。

### B 级：只研究行为、架构和测试，不复制代码

| 项目                                                    | 约束     | 可借鉴内容                                                              |
| ------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| [ArcReel](https://github.com/ArcReel/ArcReel)           | AGPL-3.0 | ADR/规格/测试、版本回退、资产指纹、任务检查点、剪映草稿导出、沙箱 Agent |
| [OpenMontage](https://github.com/calesthio/OpenMontage) | AGPL-3.0 | 生产工具/Skills 编排、真实视频合成知识库、Remotion 管线经验             |
| [ComfyUI](https://github.com/comfyanonymous/ComfyUI)    | GPL-3.0  | 节点式生成图、本地模型生态；仅作为外部服务通过 HTTP 调用                |
| Shotcut / Olive / LosslessCut                           | GPL 系列 | 时间线交互、代理媒体、无损切割；不可并入 Apache 核心                    |
| OpenFrame                                               | AGPL-3.0 | FCPXML/EDL 和 Web/桌面剪辑体验                                          |

“只研究”要求独立实现，不复制源代码、独有素材或大量文本。设计文档要记录独立推导过程。

### C 级：无明确许可证或商业条款不兼容

| 项目           | 问题                                                      | 处理                                                       |
| -------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| PrintFilm      | 仓库未提供明确许可证                                      | 仅做公开页面体验观察，不复制代码                           |
| drama-workshop | 未提供许可证                                              | 只观察 React Flow 交互                                     |
| OpenShorts     | 许可证元数据不明确/含自定义条款                           | 不进入核心依赖                                             |
| Remotion       | 当前为分层商业/源可用条款，并非可自由形成 Apache 衍生产品 | 不作为内置渲染核心；将来可做“用户自行安装的外部渲染器”适配 |

## “Deterministic Flow” 应怎样吸收

没有检索到一个成熟、明确名为 “Determin Flow” 且覆盖漫剧生产的主仓库。因此这里把用户提到的 deterministic flow 理解为“确定性生产流”，并补充研究 HyperFrames/Code2MP4 的确定性渲染做法。工作流层适合参考 LangGraph、Prefect、Dagster、Temporal 的概念，但首版不应嵌入一个重量级通用编排平台。

我们的规则是：

- 图结构由产品版本和项目模板决定，AI 不能临时发明流程。
- 每个节点声明输入/输出 JSON Schema、所需能力、幂等键、最大重试和人工审批条件。
- Agent 只输出 `ArtifactProposal`，由验证器检查后形成新版本；不能直接写核心表。
- 节点完成后产生不可变 Artifact 版本、来源关系、模型参数、成本和运行日志。
- 重试只重跑失败节点和受影响下游；已批准产物默认冻结。
- 远程模型超时进入 `REMOTE_UNKNOWN`，先查询供应商任务，禁止盲目重复扣费。
- 人工 Gate 是一等节点，不是 UI 上的一个临时按钮。

长期可以为服务器执行层增加 Temporal/Prefect 适配器，但产品工作流状态仍保存在自己的数据库中，避免被某个队列框架锁定。

## 需要补强的差异化能力

1. **来源账本**：原文段落哈希、字符范围、场景/台词/镜头引用关系和改编理由。
2. **故事一致性**：角色外观、服装、年龄、关系、场景地理、道具状态和时间线的版本化约束。
3. **提示词编译器**：保存供应商无关的镜头意图，再编译成 OpenAI、xAI、Kling、Vidu、ComfyUI 等具体参数。
4. **可回退生产图**：从“改一句台词”准确计算需重做的配音、口型、镜头和时间线，不全片重跑。
5. **本地与团队同构**：个人桌面离线可用，团队通过 HTTPS 服务协作，业务层不分叉。
6. **真正的领域剪辑器**：镜头卡、对白、字幕、角色声线和提示词版本与时间线绑定，而不只是把视频串起来。
7. **供应商可替换**：能力协商、成本预估、速率限制、熔断、导出和数据可携带。

## 开源引入门禁

每个候选依赖必须经过以下检查：

1. SPDX 许可证和仓库 LICENSE 文件一致。
2. 固定提交可复现，记录 SHA 和上游 URL。
3. 检查源代码是否完整；编译产物不能冒充可维护源码。
4. 检查传递依赖、模型权重、训练数据和媒体编解码器的独立许可证。
5. 运行安全扫描、单元测试和最小功能验证。
6. 通过架构适配评审后，才允许进入 `third_party/provenance.yml`。
