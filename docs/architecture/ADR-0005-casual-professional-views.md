# ADR-0005：普通模式与专业模式是同一项目数据的两套 UI 投影

- 状态：Proposed for adoption with the 2026-09 product constitution
- 日期：2026-09-05
- 取代：无。补充 [ADR-0001](./ADR-0001-platform-and-deployment.md) 的客户端形态，不改变桌面 / 工作室服务器 / 审片 PWA 三形态。
- 相关：[`docs/product/overall-system-proposal.md`](../product/overall-system-proposal.md)

## 背景

总体方案要求个人创作者看到“故事、角色、分镜、生成、审片、导出”，导演和生成师看到 ShotIntent、PromptPlan、连续性、供应商能力和版本依赖。若把两套模式做成两套项目、两套素材库或两套生成流水线，会破坏版本、审批和费用对账。

现有 PRD 按岗位拆功能，没有定义“同一 `project_id` 的信息密度切换”。本 ADR 冻结该契约，避免前端各自发明“简易版 / 专业版”。

## 决定

1. **模式是视图，不是项目属性。**  
   `ui_mode ∈ {casual, professional}` 存在于用户/工作区偏好或会话，不写进 Project Schema，不进入 Artifact hash，不作为工作流输入。默认 `casual`。

2. **切换零副作用。**  
   任何时刻切换模式不得：复制项目、重建素材、改变 `accepted_version`、创建 GenerationAttempt、提交远程任务、重编译 Prompt、移动时间线 playhead 之外的持久化状态。只替换当前窗口的信息架构、默认面板和文案密度。

3. **同一份权威数据。**  
   两套 UI 读写同一 `project_id` 下的 ArtifactVersion / ShotIntent / AssetVersion / TimelineVersion / ReviewRound。禁止 `casual_story` 与 `professional_screenplay` 两份平行正文。

4. **质量标准相同。**  
   普通模式不是降质模式。同一 DeliveryProfile、同一 RightsLedger、同一连续性硬规则、同一 G8 不可豁免项。专业模式多的是可观察性和控制粒度，不是更高码率或更强模型。

5. **隐藏不等于绕过。**  
   普通模式可隐藏 Gate 名称、Agent 角色名、Prompt、Seed、模型参数和 JSON。不可隐藏：即将产生的费用、能力缺失导致的结果变化、权利阻断、关键连续性冲突、需要用户做的选择。系统内部仍走完整 Gate 与失效图，见 [Gate 映射](../product/overall-system-proposal.md#appendix-gate-map)。

6. **打断策略按风险，不按模式。**  
   无论哪种模式，下列情况必须打断用户：硬预算将超、供应商缺必需能力、权利不清、`REMOTE_UNKNOWN` 需要对账、发布前 G8、用户明确要求的硬约束将被打破。普通模式用短句和选项；专业模式附加证据、影响镜头和费用分解。

7. **普通模式默认自动化，专业模式默认可覆盖。**  
   编剧 / 导演 / 美术 / 摄影 / 声音 / 剪辑 / 连续性 / 审片作为能力域存在。普通模式不要求用户按角色操作。专业模式可展开该能力域的 ArtifactProposal、覆盖策略和否决理由。用户始终可否决，不可被要求当提示词工程师。

8. **桌面、Web、PWA 共用该契约。**  
   PWA 默认更接近普通模式加审片清单，仍读取同一 ReviewRound；不另建“手机项目”。

## 普通模式必须有的六个空间

| 空间 | 用户能做的事 | 系统自动做的事 | 专业模式额外展开 |
| --- | --- | --- | --- |
| 故事 | 粘贴/编辑故事与对白，接受或改 AI 建议 | 来源解析、改编账本、口语化、时长检查 | SourceSpan、AdaptationLedger、Scene/Beat |
| 角色/资产 | 选角色、换装、听声线、看场景卡 | 建档、参考图规划、版本绑定 | Character Bible、权利、连续性状态 |
| 分镜 | 看漫画式确认人物、构图、顺序、节奏 | ShotIntent、Coverage、Animatic | 镜头参数、首尾状态、构图控制 |
| 生成 | 看进度、比较候选、选中/否决 | 模型选择、编译、预算预留、失败分类 | PromptPlan、CompiledRequest、能力损失、历史 |
| 审片 | 完整播放、打时间码批注、确认修改方案 | 批注聚类、ChangePlan、局部重生成与替换 | 帧证据、影响图、执行策略 |
| 导出 | 选平台预设、确认导出 | DeliveryProfile 检查、ReleaseManifest | 编码、字幕、OTIO/素材包 |

## 禁止

- 用 feature flag 把普通模式做成功能阉割包。
- 在普通模式静默调用付费视频/TTS 而不展示费用区间。
- 把 Prompt 文本当作普通模式的主编辑面。
- 为专业模式单独保存一份“更高质量”的生成结果指针。
- 在模式切换时做 migration 或 schema rewrite。

## 后果

- 优点：个人创作者和工作室成员共享生产图；审片批注在两种模式下都落在同一时间码和 `clip_version_id`。
- 代价：每个面板都要设计“摘要 / 展开”，而不是两套页面树。
- 缓解：信息架构以六个空间为 IA 根；专业控件作为 Inspector 展开，不新增顶层导航。

## 验证

- 同一项目在两种模式下来回切换 50 次：Artifact head、时间线 hash、任务表不变。
- 普通模式完成一集 30–90 秒粗剪，过程中不进入 Prompt 编辑器。
- 专业模式能从任一镜头反查角色版本、ShotIntent、CompiledRequest、GenerationAttempt、批注。
- 普通模式在缺必需视频能力时无法点“开始生成”；文案不出现“G6B”字样，但阻断原因可读。
