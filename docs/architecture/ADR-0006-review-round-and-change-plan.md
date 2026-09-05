# ADR-0006：整轮审片批注与统一 ChangePlan

- 状态：Proposed for adoption with the 2026-09 product constitution
- 日期：2026-09-05
- 取代：无。把 PRD FR-10 的时间码评论从“Studio Beta 才做、一条批注一次生成”提前并改成 Creator Beta 核心体验。
- 相关：[`docs/contracts/review-annotation-and-change-plan.md`](../contracts/review-annotation-and-change-plan.md)、[ADR-0002](./ADR-0002-deterministic-workflow.md)、[ADR-0003](./ADR-0003-timeline-timebase.md)

## 背景

普通 AI 生成器往往“改一句就立刻重生成”；传统 NLE 则把评论留在时间线，不负责理解影响范围。Aijian Studio 的差异化应是：用户完整看片、在多个时间点留下自然语言意见、看完后一次性得到可确认的修改方案，再按最小代价执行。

若每条批注独立跑导演/美术/生成 Agent 链，会造成重复上下文、重复扣费、互相覆盖，以及“改表演却把衣服改掉”。

## 决定

### 1. 审片以 Round 为事务边界

一次 `ReviewRound` 从用户开始看某个 `TimelineVersion` 起，到点击“审核完成”止。Round 内保存任意数量 `ReviewAnnotation`。保存批注：

- 必须记录时间码（有理数，见 ADR-0003）、帧、`shot_id` / `clip_id` / `clip_version_id`、当前帧快照引用；
- **不得**创建 GenerationAttempt、不得提交远程任务、不得打断播放超过记录批注所需的时间。

“审核完成”只结束本轮收集，不等于项目锁定，也不等于 G8。

### 2. 修改方案是一等 Artifact，不是聊天回复

用户确认“审核完成”后，审片 Agent 只允许提交一份 `ChangePlan` ArtifactProposal。程序负责：

- Schema 校验、与当前 TimelineVersion 的 If-Match；
- 合并重复批注、标记冲突；
- 计算失效类别：`check | compile | generate | export`；
- 预算预留与费用区间；
- 生成不可变 DRAFT 版本，等待用户确认。

未经用户确认的 ChangePlan 不得执行。执行时每个 ChangeItem 仍走既有任务状态机（含 `SUBMIT_INTENT` / `REMOTE_UNKNOWN`），禁止为“批量”绕过防重复提交。

### 3. 批注是修改输入，生成是执行结果

禁止把播放器上的“批注”按钮绑定到“立即重新生成”。主按钮文案必须是“审核完成 · 生成修改方案”，不能是“立即重新生成”。

### 4. 执行后只替换受影响 ClipVersion

ChangeItem 执行成功后：

- 创建新的 AssetVersion / ClipVersion，不覆盖旧文件；
- 在新的 TimelineVersion 里替换指针；
- 旧版本可回退；
- 若时长、边界或接口变化，必须按现有失效规则扩大到转场、字幕、对白、口型、mix，不得以“只换一个文件”绕过。

完成后产生新的可审片 TimelineVersion，可开下一轮 ReviewRound。

### 5. 与 Gate 的关系

| 动作 | 是不是 Gate |
| --- | --- |
| 保存批注 | 否 |
| 审核完成 → 出 ChangePlan | 否，是分析节点 |
| 用户确认 ChangePlan | 是执行许可，写入审批记录，但不是 G8 |
| 修改导致 PictureLock 失效 | 按现有 G7B 规则 stale |
| 导出正式成片 | 仍必须 G8 |

普通模式把 G7A/G7B 的“看片与补拍”收敛到审片空间；内部状态机仍保留 RoughCut / PictureLock 指针。

### 6. Creator Beta 执行动作白名单

CB 只承诺四种可自动执行的 ChangeItem：

1. `regenerate_video`：重做当前镜头视频，锁定角色/服装/场景/台词版本；
2. `regenerate_audio`：重做指定对白 TTS；
3. `edit_subtitle`：改字幕文本或时间，不重生成画面；
4. `timeline_adjust`：trim / split / replace / ripple 等已实现的时间线命令。

其他（口型、调色、复杂动作迁移、权利变更）标 `needs_human`，进入专业模式清单，不假装已支持局部精确视频编辑。

## 后果

- 优点：一轮 18 条批注可以变成 4 个视频 + 2 条配音 + 若干字幕/剪辑，而不是 18 次全上下文 Agent 链。
- 代价：需要批注聚类、冲突检测和影响图，不能把 LLM 摘要直接当任务列表。
- 边界：ChangePlan 不能发明工作流新节点；只能实例化已有 node_type。

## 验证

- 播放中连续添加 10 条批注，播放不触发任何 Provider 调用。
- 两条语义重复批注合并为 1 个 ChangeItem；一条“改表情”与一条“衣服不能动”同时约束同一 `regenerate_video`。
- 用户拒绝 ChangePlan 后，TimelineVersion 与预算预留恢复，无远程任务。
- 执行中杀死进程：已提交远程任务进入可解释状态且不自动重提；未发出的 ChangeItem 可续执行。
- 黄金夹具：改字幕不重生成视频；改对白使 TTS 与字幕 stale，画面仅在口型节点存在时 stale（CB 无口型则只警告）。
