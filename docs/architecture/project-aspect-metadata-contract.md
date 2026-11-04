# 项目画幅元数据的有限合同

第37批处理生产项目创建、读取与设置快照的独立合同缺陷。PRD说明竖屏优先但领域模型不锁死画幅，创建需选择画幅；完整基线P19/P23仍包含规格与变更影响。父线程明确转交用户16:9写实电影感偏好；本轮没有将它伪称为从原始Word逐页重新核实。

Project/CreateProject/ProjectSettingsDataV1闭合支持 `9:16 | 16:9`。公开创建省略该字段的原默认9:16保持兼容；生产新建窗口明确显示两个选项，本用户上下文的新建默认选择16:9，仍需显式创建。未知值、别名、空白和任意比例不转成默认值。共享 `isProjectAspectRatio` 用于桌面和renderer元数据守卫。

原SQLite列已能保存两值，无schema迁移或数据重写。旧项目、不可变Artifact、accepted heads、旧settings result_json、原UUID/hash和修订均保留。项目设置的画幅继续只读；name/status/description/default timebase沿用既有CAS与原操作GET合同，不能借本批提交画幅变更。Project.aspect_ratio、ProductionBrief.delivery与Assembly.canvas是分别保存的对象，不自动同步或另存。

创建回执画幅必须等于await之前捕获的本次选择。另一合法比例也不能被当成成功：桌面合同拒绝，工作区adapter保持REMOTE_UNKNOWN，既有模型阻止自动重发。此比对不引入新创建归因接口、持久项目创建journal或自动原GET恢复，不将旧创建合同的限制冒称已补齐。

当前VisualBible/G5安全区仍固定9:16，原政策与批准哈希不变。项目元数据16:9不授予横屏视觉审核权威，不解除PictureLock、权利、SoundApproval、SubtitleApproval、MixApproval或正式输出阻断。其他比例、横屏G5版本化政策、完整正式输出和Windows实机另列后续需求。本批不调用Provider、编码、发布、模型或付费服务。

实际UNKNOWN回归同时暴露既有rich设置状态区在980×680窗口裁切。第37批只补缺失的bounded body布局，让主卡片及状态区各自滚动；没有修改CAS、journal、核对handler或自动调用策略。原21源冻结与失败保留，新增两布局源另有23源冻结回执。
