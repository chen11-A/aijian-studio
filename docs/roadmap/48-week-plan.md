# 48 周软件开发与影片生产联合路线图

## 发布口径

- W24：Creator Beta，Windows 11 x64、单机、一个题材、`text/image/video/TTS` 各一个认证供应商、混合 motion-comic、Assembly Editor。
- W36：Studio Beta，增加局域网/私有云、身份/RBAC、任务 Worker、协作和手机审片；不是创作能力 V1.5。
- W48：1.0 GA，仍定位“混合 motion-comic 平台”，支持 30 万字以内作品的可追溯规划和一个故事弧连续 3 集生产，增加 Core Editorial、OTIO 和可靠发布。
- 完整全书/多季、三个题材各连续三集和可使用“全动态”标签属于 V2，不用宣传语言提前透支。

## 团队与容量

基线为 14 名全职：产品 1、技术负责人/架构 1、产品设计 1、前端 2、后端/工作流 2、AI/Provider 2、桌面/媒体 2、QA/SDET 2、DevOps/安全 1。工程 Sprint 只规划 80% 容量，20% 留给评审、故障、文档和技术债。少于 10 名工程人员时，W48 自动重估为 W54–60。

影视试制为 8 个职能，可一人多岗但每 Sprint 有固定验收 SLA：制片、编剧、导演、分镜/摄影、美术/连续性、生成师、声音、剪辑。黄金项目只做回归；W16/W24/W36/W48 都加入未参与 Schema 设计的 held-out 项目，并记录人工修复分钟、重生成率、审批耗时和无法发布镜头数。

W17–W20 由后端、架构和 DevOps/安全并行准备服务器威胁模型与租户契约；W16 完成 Studio go/no-go，所需人员最迟 W20 到岗。若 W20 没有独立服务器/安全/运维小组，W36 降级为内部 Studio Alpha。

## 统一交付规则

- 两周一个 Sprint；每个功能必须同时交付契约、UI、迁移、权限、日志、测试、失败恢复和片场样例。
- Schema 只分阶段冻结：W2 冻结术语/演进规则，W6 冻结 v0，W12 冻结 Creator Beta v1，W36 冻结 GA v1；CI 始终测试 N/N-1/N-2 项目夹具。
- W4 提交 `quality-baseline-v0`：夹具哈希、参考硬件、命令、样本数、阈值和报告格式；发布 Gate 不使用“稳定/正确/达到预设”这类无数值措辞。
- 第一份测试安装包起就要有 SBOM、许可证/NOTICE、密钥和本地 API 安全；不能把安全、FFmpeg/字体/模型许可留到 GA。
- 任一数据损坏、未知状态自动重提、重复计费、Sev-0/1 或破坏性迁移缺陷都重置当前 RC/soak 计时。

## 阶段 0：可恢复骨架（W1–W8）

### Sprint 1（W1–W2）：仓库、时间基线、质量基线

软件：建立 Monorepo、CI、格式化、Apache-2.0/NOTICE、第三方来源表；冻结术语和 Schema 演进规则；定义 Project/Artifact/Task 最小 Schema；实现 Hello Desktop 安装 Spike。完成 rational timebase、VFR conform、48kHz、代理映射、FFmpeg/播放 Spike。
片场：建立一个已授权黄金短篇、一个 held-out 短篇，以及 5 万/15 万/30 万字三级长篇资格语料和人工事实/事件/镜头标注。
验收：固定媒体覆盖 23.976/24/25/29.97/VFR、44.1/48kHz、Unicode/长路径；`quality-baseline-v0` 和 fixture hash 入库。

### Sprint 2（W3–W4）：最小工作流、真实供应商与上游 Gate

软件：最小 WorkflowDefinition/Run/Attempt、SQLite Task Ledger、LocalExecutor、Fake Provider、故障注入；TXT 最小摄取和 Artifact 草稿/审批指针。完成 OpenAI/xAI 文本和限额真实 image/video/TTS Spike，记录 401/429/5xx/超时/审核拒绝/结果 URL 过期。验证 Jellyfish、LumenX、Wind Comic、Toonflow、LocalMiniDrama、HyperFrames，输出“复用/重写/拒绝”和许可证证据。
架构：Electron IPC transport、随机回环端口/令牌、Web HTTPS transport；提交迁移/恢复 ADR 和服务器威胁模型草案。
验收：Renderer 无法读取端口/令牌/密钥；真实异步视频的 `REMOTE_UNKNOWN` 路径可触发且不自动重提。

### Sprint 3（W5–W6）：可安装 Walking Skeleton

软件：干净 Windows 11 标准用户测试安装包；只用公开 UI/API 跑通“2 万字 → 场景计划 → Fake 图/视频/TTS → 基础时间线 → 1080p MP4”。基础 Timeline 已支持帧精确 trim/reorder/replace/代理/导出。
可靠性：六个固定 kill 点——节点领取后、远程提交前、远程提交后未落库、Artifact 写入前、媒体原子 rename 前、ReleaseManifest 写入中；每点至少 100 个确定种子。
验收：60 秒内恢复为可解释状态、已提交 Artifact hash 不变、未知远程任务不自动重提、最终可继续导出；W6 冻结 v0 Schema。

### Sprint 4（W7–W8）：来源账本与完整状态机

软件：TXT/Markdown/DOCX、SourceManifest/SourceBlock/UTF-8 字节 SourceSpan、raw-normalized 映射、章节校对、AdaptationLedger；补齐人工 Gate、并发领取、预算预留、完整失效传播、迁移快照和本地 CAS。
验收：10 万 SourceBlock 基准；N-2→N、更新中断、磁盘满、备份损坏、应用回滚只读拒绝；黄金变更集漏失效为 0。

## 阶段 1：Creator Beta 功能完成（W9–W16）

### Sprint 5（W9–W10）：Provider Gateway 与 Rights 基础

CredentialRef/Windows Credential Manager、`text/image/video/TTS` 能力契约、Prompt/Job/Error/Usage Envelope、限流/熔断/预算预留/对账。建立 Provider conformance harness 和逐资产 RightsLedger 骨架。
验收：密钥不进入 Renderer/数据库/日志/诊断包；合约覆盖 401/403、429+Retry-After、5xx、非法响应、模型下线、取消竞态、重复/乱序回调和 usage 缺失。

### Sprint 6（W11–W12）：故事圣经与 Provider Go/No-Go

分块抽取、证据归并、人物/关系/地点/事件、事实/推断区分、冲突报告和 G2；5 万字资格语料。冻结 Creator Beta Schema v1，并在真实 Provider 上每日 smoke。
验收：来源事实 precision ≥0.90、recall ≥0.85（以冻结夹具为准）；首批供应商 go/no-go；失败模型和能力损失公开。

### Sprint 7（W13–W14）：剧本、视觉圣经、权利与声音前置

AdaptationLedger、单故事弧/分集/场景卡、结构化剧本、G3/G4；VisualBible/AssetVersion 最小实现和 G5；VoicePlan、scratch voice、配音时长检查、RightsLedger、首个 1080×1920/25fps DeliveryProfile。
验收：ShotIntent 批准前已经有批准的资产版本；任何缺失声音/字体/模型条款/素材权利都阻断正式发布。

### Sprint 8（W15–W16）：镜头、Animatic、MotionProof 与功能冻结

ShotIntent/CoveragePlan、PromptPlan/供应商编译、G6A；带临时对白的 Animatic、1–2 秒 MotionProof、Provider Capability Loss 和 G6B；Assembly Editor 补齐多轨声音、字幕、撤销/重做、代理/原片映射和基础混音。认证 image/video/TTS 适配器 feature complete，并连续两周每日 smoke；15 万字故事圣经/分集资格。
验收：未过 G6B 不得提交完整视频；W16 完成 Studio 预算/人员 go/no-go。

## 阶段 2：Creator Beta 集成与发布（W17–W24）

### Sprint 9（W17–W18）：端到端集成

黄金和 held-out 项目完成真实图片/视频/TTS、代理固化、SoundSpotting、环境/SFX/音乐基础轨、CueSheet、MixApproval、RoughCut/PickupList、PictureLock、ReleaseManifest。服务器小组冻结 Workspace/Principal/tenant key/default-deny 授权契约。
验收：媒体长度或边界变化会正确失效转场/字幕/mix；未清权资产无法生成正式 Master。

### Sprint 10（W19–W20）：可靠性、安全与长篇规划

桌面 API、SSRF、恶意归档/媒体、FFmpeg 资源、密钥泄漏、成本/取消/对账、迁移/备份、安装/卸载/更新/孤儿进程回归；30 万字只验收摄取、故事圣经、分集和来源链，不声称全书成片。服务器团队完成 Threat Model 和数据面设计。
验收：Creator Beta 安全门全绿；Studio 人员最迟 W20 到岗。

### Sprint 11（W21–W22）：Feature Freeze 与 RC1

W21 禁止新增功能；只修阻断缺陷、完善诊断和文档。W22 产出签名 RC1，执行标准用户、中文用户名、长路径、Defender、无开发工具、离线打开、N-1→N、更新中断、卸载保留项目和 app rollback 矩阵。
验收：至少 7 天无数据损坏、未知状态自动重提和 Sev-0/1。

### Sprint 12（W23–W24）：邀请试用与 RC2

至少 5 位新用户、50 小时编辑、一个黄金和两个 held-out 项目；只允许 release blocker 修复并重新开始 7 天 soak。
验收：0 数据损坏、0 `REMOTE_UNKNOWN` 自动重提、0 Sev-0/1；具名人类完成 G8；Creator Beta 安装包、SBOM、NOTICE 和已知限制发布。

## 阶段 3：Studio Beta（W25–W36）

### Sprint 13（W25–W26）：租户、身份与数据面同时落地

OIDC/密码或 Passkey、Workspace/Principal/RBAC、Repository tenant scope、PostgreSQL、S3/MinIO Key、加密 Secrets、审计 Outbox。没有匿名远程写路径。
验收：API/数据库/对象存储跨租户 IDOR 基础矩阵全拒绝。

### Sprint 14（W27–W28）：服务器任务与恢复

Redis/Worker、租约、优先级、配额、暂停/取消、远程未知对账、备份恢复；队列不是真相源。
验收：Worker/Redis 重启不丢 Task truth；桌面可通过同一 OpenAPI 连接服务器。

### Sprint 15（W29–W30）：协作和审片

时间码评论、@人、修改单、Gate 在线审批、通知、审计；剧本/卡片协作，时间线单编辑锁。
验收：版本/权限变化后旧审批被拒绝；评论不丢失且可追溯。

### Sprint 16（W31–W32）：PWA 与跨租户/负载资格

低码率代理、圈画/语音意见、参考上传、离线只读/草拟批注；跨租户 API/S3/队列/缓存/SSE/WebSocket/审片链接矩阵；30 万字服务器并发资格。
验收：10 人×3 项目×72 小时，0 数据损坏、0 跨租户泄漏、0 Task truth 丢失；允许的非阻断错误数写入 quality baseline。

### Sprint 17（W33–W34）：Feature Freeze 与 RC1

W33 冻结；完成 OpenTelemetry、健康分解、部署/升级/回滚、威胁模型复审和渗透测试修复。W34 RC1。
验收：72 小时负载和跨租户矩阵复跑，全新局域网服务器两小时内完成安全部署。

### Sprint 18（W35–W36）：RC2 与 Studio Beta

备份恢复、TLS、密钥轮换、事故/运维手册、手机实机审片和 RC2。
验收：0 Sev-0/1、RPO=0（已提交编辑）、Task 状态恢复 ≤60 秒；Studio Beta 发布。若独立服务器小组未就绪，只发布内部 Alpha。

## 阶段 4：1.0 功能完成与 GA（W37–W48）

### Sprint 19（W37–W38）：长篇资格优化 + Core Editorial I

30 万字层级摘要/事件图/锁定重算/跨集 Canon Change 性能优化；insert/overwrite/ripple/roll、source/program 监视、snapping 和帧精确命令模型。
验收：长篇能力不是首次实现而是 W12/W16/W20 结果的优化；真实剪辑师完成素材导入、粗剪和补拍替换。

### Sprint 20（W39–W40）：Core Editorial II + 声音 Finishing

slip/slide、linked selection、markers、J/L cut、轨道 lock/mute/solo、代理回连、手柄检查；ADR/Pickup、stems、ducking、MixMaster、响度和声画同步。
验收：1,000 Clip 参考项目满足 `quality-baseline` 的 UI/seek/内存指标；30 分钟代理→原片导出漂移 ≤1 帧。

### Sprint 21（W41–W42）：OTIO、归档、迁移和 QC，Feature Complete

OTIO/OTIOZ、受测 FCPXML/EDL 子集、完整项目归档/恢复、Rights/Release manifest、Technical/Continuity/Editorial/Creative/Rights QC、一个故事弧连续 3 集 held-out 试制。非 GA 必需的 Provider SDK/插件市场延期。
验收：W42 feature complete；真实 Resolve/FCP 消费者未通过的格式只能标 experimental；盲审 rubric 和手机实机字幕/剧情理解结果入库。

### Sprint 22（W43–W44）：RC1

只修 release blocker；N-2→N、更新中断、磁盘满、备份损坏、应用回滚只读打开、72 小时 soak、200+ 编辑小时累计。
验收：连续两周 0 Sev-0/1、数据损坏、未知状态自动重提和不可恢复项目。

### Sprint 23（W45–W46）：RC2

第二个独立 held-out 三集项目、安装/服务器/归档/OTIO/安全/许可证矩阵；任何阻断修复重置两周。
验收：RC2 两周完整窗口，所有 G8 不可豁免项和人工审批证据齐全。

### Sprint 24（W47–W48）：GA Hold 与发布

不开发功能。验证源码/安装器/容器/签名/SBOM/NOTICE/哈希可复现，完成发布批准、镜像和回滚演练。
验收：1.0 GA 和已知限制发布；明确写“混合 motion-comic、一个题材资格，不是完整全书/全动态/通用专业 NLE”。

## 1.0 之后仍然要完成的产品

### V1.5（建议 W49–W72）

第二个认证供应商/模态、三个题材各一个试播集和 Challenge Matrix、dynamic-first 单题材 Beta、更完整声音/色彩/在线能力、Mac 评估和更强 Core Editorial。都市覆盖手机/UI/品牌，古风覆盖服装/兵器/群像/法术，悬疑覆盖线索公平性/时间线/夜景。

### V2（建议 W73–W96）

全书 Adaptation Ledger、多季/跨卷 Canon、一整季真实生产、三个题材各连续三集并含 held-out 长篇；所有计划动态镜头逐镜头通过身份/动作/方向/手柄/时序，Ken Burns/插帧不计“全动态”；沙箱插件/市场、离线协作和高级 Domain NLE 另设安全与性能 Gate。
