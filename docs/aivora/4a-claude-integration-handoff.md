# 4a 给 Claude 的接线交接

本轮只读核对远端，没有合并分支，也没有发起会员或付费生成请求。请先按以下固定基线核对，避免整文件覆盖。

## 基线与职责

- 集成分支 `aivora/dev`：`7f7a6ade8890c0bf829d511fc5f7f2bcabd97f11`，仍是已发布3j-r1代码。
- GPT 代码交接基线 `gpt/work-4a`：`05c59c74ce6a15875a0c39191e8bfb49496d8984`（包含本轮B01、B08、B09、B11补修）。此前完整交付点 `b1afb5958efcaae25b708d57afc411ede2341857`；本轮B01适配为 `a7b5249`，B08设计声明为 `9e8e9dd`。后续GPT提交仍须保留。
- 已发现 `claude/work@caf50e27b50cdbf7571e85d28d5dc4319efa6d82`，它直接基于3j-r1，已经提供 PipelineSteps 和模板入口，**不需要重做组件**。其代码尚未含GPT的4a逻辑。
- 用户更新的旧界面提交分工：`2d7acb7`、`d894dc3` 由用户摘入 `claude/work`；`9d89db8`、`5ba2b82` 由另一会话在 `4A-U09`、`4A-U11` 中处理。GPT 不再从旧 `claude/aivora-readme-docs-sa77rk` 合并或摘取这四笔提交。后续阶段整合只核对实际交付内容及历史，避免重复实现或覆盖；此处分工不代表这些摘取已经完成。
- ProWorkspace 按业务职责拆分，不按旧行号：GPT保留 `pipelineWorkspace`、保存协调、请求守卫、角色事务、generation队列等逻辑；Claude改JSX/CSS/页面props/最终文案。冲突时不整文件取任一边，不复制3j版本的处理函数覆盖4a。`pro/actions/**`、`film/*.ts` 归GPT。

## B01：在现有 PipelineSteps 上补接什么

宿主文件：`apps/studio-web/src/aivora/pro/pipeline-workspace-host.ts`。
`ProWorkspace.tsx` 已通过 `createPipelineWorkspaceHost` 实例化 `pipelineWorkspace`，并接好独立会员请求、`filmRef`、保存租约、视频提交、通知、作品切换取消和打开时恢复。

相关实现：核心 `cb0122247bd6d876c0b312373aed042a78ecd315`；宿主与保存协调 `f0e54bd3f9ca92a2616500e349e6044d9eb88423`；数据适配 `a7b5249f4354a97b73fcbdbc387d6f2c5c5225e1`。

| 界面动作                   | 现有宿主调用                             | 接线约束                                                                      |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| 用户明确开始一键成片       | `pipelineWorkspace.start()`              | 完整交互具备后才替换首页/剧本页旧 `oneClickFilm()`；不能同时启动两套流程      |
| 打开旧作品                 | `pipelineWorkspace.recover()`            | 宿主effect已接，不再重复调用；中断running转uncertain，不自动重发              |
| 用户选中失败目标重试       | `pipelineWorkspace.retry([key])`         | 不是stepId；必须选具体目标，例如 `portraits/character-1@正面`，完成目标不重做 |
| 用户核对结果不确定的目标   | 同上，先明确确认                         | 可能已经消耗会员额度；不得自动重试所有uncertain目标                           |
| 用户实际审过画面并填写结论 | `pipelineWorkspace.acceptReview(reason)` | 非空reason；明确是人工审片，不给AI分数或AI选版；不会自动生成视频              |
| 用户再次确认检查点         | `pipelineWorkspace.continue()`           | 仅有效checkpoint；不能绕过覆盖、风险或人工审片                                |
| 取消                       | `pipelineWorkspace.cancel()`             | 同步发取消；不要自行把所有目标改成done/failed                                 |

这些异步方法的Promise需要处理错误，通过现有 `emitNotice` / 代码文案显示，不把 `Error.message` 中的原始code直接显示。

### 直接可用的数据

新 `pro/pipeline-view.ts`：

- `pipelineView(film)` 返回 `kind: empty | invalid | ready`。empty显示空状态；invalid带错误code，不伪造进度。
- ready有 `status/current/code/steps/checkpoint/busy/canAcceptReview/canContinue`。每步保留真实状态；每个target有 `id/status/attempt/code/detail/key/retryable/requiresOutcomeConfirmation`。副本可供展示，不修改project.json。step没有最终中文label；请由Claude的步骤名称表补label并扩展状态类型，不直接把内部id当界面文字。
- `pipelineRetryKey(film, stepId, targetId, outcomeConfirmed)` 返回精确key或null。只允许当前未完成步骤的可重试目标；uncertain须显式确认；完成目标、运行中、未知目标均返回null。返回值仍需传给宿主，宿主再次验证输入和保存状态。
- `film.productionPipeline` 是完整持久化状态；`film.pipeline` 是C12投影。类型定义在 `film/production-pipeline.ts`、`film/contracts3j.ts`。
- 状态必须支持 `queued/running/done/failed/blocked/needs-input/uncertain/accepted`，整体另有 `checkpoint/cancelled`。`accepted` 是人工确认，不能显示成AI自动完成；`assembly` 是实际合成步骤，也须显示。
- checkpoint字段为 `shotCount/seconds/estimatedRequests/coverage/risks`；不能用 `oneClickReady` 或 `film.shots.length * versions` 伪造新流水线检查点。coverage/risk存在阻挡时不给继续。

### caf50e2 中需要调整的具体差异

1. `next/PipelineSteps.tsx` 的 `PipelineStepView.status` 目前仅四种，缺上述状态和assembly；`onRetryFrom(stepId)` 不足以选择精确目标，需要目标列表/选择回调。
2. 当前 `PipelineCheckpoint={shots,seconds,videos}` 只够显示摘要。接上述实际checkpoint；估算请求数量不是保证生成的视频数量。
3. 当前 `ProWorkspace.continueOneClick` 直接 `queueBatch(live.shots)`，仍旁路新审片与checkpoint；正式接新流程时改为受 `canContinue` 控制的宿主continue。
4. 当前 `showPipeline` 基于 `oneClickReady`，没有人工审片、uncertain确认和取消。保留已完成的布局，补这些状态和独立操作，不把人工审片确认与生成视频合成一个按钮。
5. 新数据适配不启用旧按钮；GPT这边未修改Claude JSX。

### 最小界面验收

空作品不造进度；失败目标仅重试自己；重开uncertain先核对；人工审片与继续生成是两次明确动作；缺台词/尾段或block风险不给继续；切换作品后旧进度、旧完成提示不进入新作品。真实会员看图能力尚未验证，界面不能声称已自动评分。

## 101个提示码

完整清单及每条后端兜底文字：`docs/aivora/4a-notice-handoff.md`。
来源：`apps/studio-web/src/aivora/film/notices.ts` 导出的 `NOTICE_TEXT` 与 `next/wiring/noticeCopy.ts` 的 `NOTICE_COPY` 差集，排除约定的 `OPERATION_STATUS/EDITOR_GUIDANCE`。
此前核对：GPT当时的代码和 `claude/work@caf50e2` 均缺101项，清单逐项完全一致。现Claude已在48a5825交付全部映射，待阶段整合检查。不是101条新缺陷，也不是要求修改后端code名。

Claude已交付 `apps/studio-web/src/aivora/next/wiring/noticeCopy.ts` 和 `docs/design/copy-zh.md` 最终文案；短句与详情分开，不显示内部代码/JSON/模型术语。不要用展开整个NOTICE_TEXT的方式绕过最终文案审阅，不删除完整性或术语检查。

在 `apps/studio-web` 执行：

```sh
pnpm exec vitest run src/aivora/next/wiring/noticeCopy.test.ts
```

具体失败测试：`NOTICE_COPY > has a line for every code GPT can send`（文件22行附近）。本轮11项中10通过、1失败，失败就是完整映射；日志 `/workspace/4a-handoff-notice-recheck.log`。此前全web固定4fcd198为3872通过、1失败；不能把此次单文件检查当最新版全web已通过。

## GPT自查，不把自己的缺口推给Claude

- B01：本轮已独立补状态/精确重试适配，37项流水线相关回归、tsc、ESLint、Prettier通过。剩下是上述界面操作和真实全流程验收。
- B02/B03/B04/B07：逻辑已提供；真实会员画风、人脸、连续画面效果未验。默认日志只记计数/摘要，不记录完整原文，保留用户隐私取舍。
- B05/B06：缺已登录真实会员环境，不能用模拟测试宣称看图可用或英文更好。
- B08：本轮发现并完成独立的美术可选设计字段持久化 `9e8e9dda10146bc8e35ae26088ba20aeb26ccb0f`，52项相关测试和91项完整工作区回归通过，类型/lint/格式通过；未将这项推给Claude。普通字段 `artDesign/artDesignBaseline` 保留设计与声明，实际图片仍只看portraits/referenceImage等真实产物。24份是设计示例，不是已收集的真实Grok回复；sound/continuity六例无独立执行器，不额外引入4b音频或新场记智能体。
- B09/B11：主要异步业务已拆入actions；宿主仍保留状态、生命周期、事务与薄回调。最新编导/拆镜/按页撤销接线 `4b3cc81ec9a608fc60eb532da626b19f480c20f6`，161项相关回归通过。Claude保留 `RoleCard.editorDiff/artDiff/directionDiff/storyDraft` 和原请求页面信息，差异展示读取这些固定建议，不从当前内容重造基线。
- B10：场景参考和双画幅后端已提供，入口、画幅选择器和真实画面验收仍待整合。

本轮不合并、不发版。双方下一次整合以最新提交为准，先核对差异，再按职责解决ProWorkspace冲突；不要移动3j-r1 tag。

## 最后一次远端复核补充

交接整理期间 `claude/work` 又推进到 `ceef82629c22f9fc7e1bab7edb577e501248157d`（4A-U02画风卡），父提交仍为caf50e2。它只改画风卡、样式、测试及接口文档，没有补B01或NOTICE_COPY；该段记录ceef826时的历史状态；最新48a5825已补文案，B01接线差异仍适用。

画风卡在ceef826时用 `styleAtOpen` 判断改变，跨页/重开会重置，不能表示持久失效。请读GPT已保存的 `shot.regenerationRequired`，保留 `setFilmStyle` 的版本与媒体保护；不要在合并时用Claude基于3j的setFilm/处理函数覆盖这些逻辑。最终状态的中文展示仍由Claude决定。本轮没有擅自修改该组件。

### 本轮追加核对

远端 `claude/work` 已到 `d1209d1e390dad5e5f965fb10b901aed823b2eea`，新增U03多版本视频播放；只读核对后未合并。它保持aiChoiceId=null，没有把文字审片当视觉评分，这一边界应保留。旧四笔提交和U01/U02均仍需按历史保留。`aivora/dev`仍为7f7a6ad。

GPT新增：B08 `528d850`编剧/导演声明与原子确认、`11229ca`表演null/主配角；B09 `9b3af94`导演/审片/视频任务准备；B11 `cdfc2f5`迟到保存完成守卫、`c6d4273`保存失败分类、`05c59c7`实际编剧/美术选择快照接线。完整字段矩阵在 `4a-field-audit.md`；无新界面生成入口要求。请保留actions调用和固定事务，不将基于3j的处理函数整段覆盖。

固定adff全web3970通过/2失败（NOTICE_COPY101码和已修的保存分类）；最新代码05c全web4029通过/1失败（仍是101码缺口），类型/lint/格式通过；Python隔离重跑5138通过/6跳过，覆盖率门槛通过。这不是阶段通过，仍需整合已交付的Claude文案、完成流水线交互与真实会员验收。

### 48a5825已交付，尚未阶段整合

只读核对48a5825的101条NOTICE_COPY与交接集合完全对应，已交付而非尚待编写。GPT在`ed83803`仅同步film/notices.ts后端兜底，保留旧文本兼容；246项通知/完整工作台回归、全类型及目标lint/格式通过。固定契约fixture记录原提交和每条文字，不直接从当前实现生成测试期望。两个代码同文案时，纯文字输入保留旧分类，结构化code仍精确选择。

同一分支的`99047c5`已解决styleAtOpen问题：画风卡及分镜读取needsRestyle/regenerationRequired，不需重复修复。B01仍仅四种步骤状态、摘要检查点，continueOneClick仍调用queueBatch；精确目标重试、真实checkpoint、人工审片未接。

阶段整合时需同步扩展film/notices.test.ts的文案表契约：当前旧表118个受支持条目，48a5825新表219个；保留旧118条的纯文字兼容检查，新101条按明确code和旧别名逐条验证（多个code可同一句最终文案，不能反推唯一code）。不要只改小于/大于数量断言或删除语义检查。新增后端notice-copy-contract.test.ts已对101条及碰撞情况覆盖，联合NOTICE_COPY/文案表检查仍需在整合后实际执行。当前不合并分支，不声明4a完成。

### 2026-11-05 3JR 后的最新界面交付核对

`claude/work@ed0409a641156f33a6a8894e9b47feebb33ffffa` 已新增真正支持目标重试、审片和继续回调的 PipelineSteps 组件（`3d1600a`），以及任务抽屉、场记提示、四角度展示和画幅选择。上文“组件仅四种状态”的描述是旧基线记录，不再代表最新交付。该分支 ProWorkspace 仍保留旧流程占位，组件旁的注释和 INTEGRATION 要求阶段整合时接 `pipelineView` 与 `pipelineWorkspace`；当前尚未整合，因此不是用户已经能使用新流水线的证据。

GPT 本轮 3JR 逻辑已经改变的边界，合并时需要保留：

- `FilmShot.action` 是主动作，`actionBeats` 保存完整有序节拍；手动动作确认、存盘、撤销和生成请求都保留序列。不得用旧 `action` 拼接覆盖新序列，也不得重新命名已有素材的镜头 ID。
- 出图/视频前 `prepareShotSceneReferences` 会先保存当前场景参考。首帧最多4张人物图加1张场景图；超过人物容量返回原有 `STILL_CAST_LIMIT`，不偷偷丢掉第五人的参考。视频保持首帧加最多13张参考图。
- 明确不入画的人物不进入视觉身份、服装、正向描述和参考图；画外对白仍有声音。不能把已有用户选定图片当作已验证人物正确。
- 新增 `LOCATION_SOURCE_REQUIRED`，兜底“这一场还没有可用的环境描述。”：这是101条文案交付之后的新代码，需补最终COPY与文案表。
- `sourceReview` 及C13新增的来源风险只检查显式原文段号及顺序，不证明语义无新增；未知/倒序提示保留，不删镜，不给旧作品统一加硬阻挡。
- 导演各步骤共用240秒截止与取消，超时保留已获得的草稿。15秒进度是实际等待时间，不代表供应商完成百分比。

不把本轮本地回归称作会员验收；尚缺这次实测的project.json、导演/动作原始回复和已登录会员环境。没有合并Claude，没有阶段tag。
