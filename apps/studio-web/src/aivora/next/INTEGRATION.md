# next 组件接线说明

这份说明两边一起维护：第一部分是 GPT 写的逻辑和数据接口，第二部分是 Claude 写的界面接线。两部分说的是同一批组件，接口以第一部分为准，界面放在哪、怎么接以第二部分为准。

# 第一部分：逻辑与界面交接（GPT）

Claude 的六个组件（与 `aivora-next-components.zip` 相同，SHA-256 `0a73fd2f9c0ee88a222fc45f9db67f76c025f12aff8a12254042daa5a23ee394`）和适配层在 `claude/aivora-ui` 上，合并 `gpt/aivora-p3j@79e126d` 以后同在一个分支。下面是 GPT 的原文，只把开头这一段换成了合并后的情况。

## 职责和当前交付边界

- GPT 负责业务函数、数据、任务事件、服务、持久化和测试。Claude 负责 JSX、CSS、显示文案与组件适配。按职责判断，不按改动后漂移的行号判断。
- 旧授权期间已提交的界面修复保留在分支；收到 Claude ZIP 时逐项核对冲突，不整文件覆盖业务函数。
- 本轮只提交并推送 `gpt/aivora-p3j`；按用户最新要求不打 tag、不发布 Release 或安装包。
- 4a/4b 的流水线、声音混合、口型、导出检查接线不在本轮实现。

## 已提供：数据契约

类型入口为 `../film/contracts3j.ts`。运行时接口与对应回归完成后在下表补记，不能把类型声明当成已实现功能。

| 约定 | 类型与语义                                                                                 | 显示方需要处理                               |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| C1   | `TaskItem` 与 `BatchProgress`；任务支持 image/video/voice/lipsync/export，终态 done/failed | 进度显示失败数量；不得把排队或重试显示成成功 |
| C7   | `UiNotice = {code,text,detail?}`，text 是兜底短句                                          | 按 code 替换成最终中文；detail 仅按需展示    |
| C9   | `SceneCoverage = {sceneId,ok,lastLine,missingLines,missingTail}`                           | 缺失台词按原文顺序显示；尾段缺失显示修复入口 |

覆盖校验使用源文证据，不把复制原文生成的占位镜头当成完成。镜头数 16 是目标，完整保留优先；镜头合并仍超目标时须提示，不截尾。自动修补遗漏段落仍保留风险，不能因为每段都有归属就把场景变更误报为通过。

## 已提供：业务接口

- 宿主统一接线入口：`../pro/production-actions.ts` 的 `createProductionActions({current,apply,requestDirector,notify})`。返回 `makeAllPortraits(characterIds?)`、`fixCoverage(sceneId)`、`updateCharacterTraits(characterId,{gender,ageBand})`；`current` 读取当前作品，`apply` 必须更新状态并等待 `saveFilm`，`requestDirector` 使用会员请求，`notify` 接结构化消息。controller 内部核对作品与请求序号。全人物按钮、补尾按钮和属性下拉框等待 Claude 绑定，不自行添加 JSX。
- `window.aijian.onTask((tasks, batches) => …)` 返回退订函数，首次订阅读取当前快照。类型来自 `@aijian/contracts/task-progress`。`version` 是字符串，`running` 是布尔值。
- `../film/task-progress.ts`：`runTask(input, execute)` 在执行前同步发出 queued，成功 done，异常或超时 failed；执行回调接收 AbortSignal。`beginTaskBatch` 管理批次，`publishFilmJobs` 镜像既有任务账本，不另外启动生成。`subscribeTasks` 可供浏览器宿主观察同一数据。
- `../pro/portrait-workflow.ts`：`makeAllPortraits(options)` 支持全人物缺角队列；`characterIds` 可限制为单人。每张失败重试一次、继续后续项；`apply` 可返回 Promise，逐张等待保存。返回 total/done/failed/cancelled/failures，不把部分完成说成全部成功。
- `../film/director-continuity.ts`：`detectDirectorCoverage` 检查逐句顺序与末段；`coverageRepairContext` 生成补漏请求；`directorPlanStatus` 返回覆盖与镜数状态。
- `../pro/director-workflow.ts`：`fixCoverage(film, sceneId, request, current)` 返回更新后的 film 和 coverage；宿主提供真实请求函数、当前作品/请求序号守卫，再持久化返回结果。不是无上下文的全局函数。自动导演流程使用同一修补逻辑，至多补一次。
- `../film/operations.ts`：`assignActionBeats` 返回 shots 和 unassignedBeats，仅接受明确镜头 ID；人物属性归一化位于 `cast-traits.ts`，持久化字段为 gender/ageBand。
- `../film/request-batches.ts`：`completeAgentBatched` 按正文段落分批，保留顺序与编号，合并合法结构；不完整或相互矛盾的模型结构返回 BATCH_RESPONSE_INVALID。格式失败不能解释成正文被截断。

本段描述可调用的逻辑接口，不能代替 Claude 的按钮、角色下拉框、提示面板接线验收；组件 ZIP 已上传，但执行器两次下载失败，未核验或导入。

## 仅类型：不代表已实现或接线

以下均导出自 `contracts3j.ts`，留待 4a/4b 使用。

| 约定 | 类型                                                                                 |
| ---- | ------------------------------------------------------------------------------------ |
| C2   | `ExportCheckReport`、`ExportCheckIssue`、`ShotSpan[]`                                |
| C3   | `SceneSound`：mood、master、lanes.dialogue/ambience/sfx/score、duckMusic；音量 0–100 |
| C4   | `TakeOption`、`TakeSelection`：options、aiChoiceId、selectedId                       |
| C5   | `SubtitleStyleId = "white" \| "bar" \| "yellow" \| "film"`                           |
| C6   | `CoverInput`：title、subtitle、aiMark、backgroundUrl（未选背景时为空串）             |
| C11  | `LipSyncState`：lipSync、lipSyncReason                                               |
| C12  | `PipelineProgress`、`PipelineStep`                                                   |
| C13  | `ContinuityNote`                                                                     |

字幕显示名分别是清楚白字、底条字幕、醒目黄字、电影字幕。`variety` 不再是目标接口 ID；实际 aivora-media 预设替换在 4b 完成，本轮不修改尚未合入的模块。

QC schema 对照 `gpt/aivora-qc@7c0eea58b218456f59d1f3ba93eddc791fdad894` 实际 `checkExport()` 返回值：schemaVersion=1，顶层 media/audio/assumptions/issues；issue 使用 severity=warn/block、time/timeLabel/end/type/message/suggestion/action/detail，另有可选 scope/cue/estimated/nextCue。没有把报告改成虚构的 summary/checks 结构。模块当前未合入，因此没有运行时 QC 调用或自动修复。

## 组件接线位置（等待 Claude 实物）

| 组件          | 位置               | 触发                 | 所需约定     |
| ------------- | ------------------ | -------------------- | ------------ |
| TaskCenter    | 状态栏后台任务入口 | 有真实任务或用户打开 | C1、C7       |
| ExportCheck   | 导出对话框         | 4b 导出前运行检查    | C2、ShotSpan |
| SoundPanel    | 剪辑声音面板       | 用户调音             | C3，4b 接线  |
| TakePicker    | 分镜单镜/剪辑      | 有多个真实版本       | C4           |
| SubtitleStyle | 字幕设置           | 用户选择样式         | C5，4b 接线  |
| CoverEditor   | 封面设置           | 用户编辑封面         | C6，4b 接线  |

## 日志与验收限制

默认日志不含小说、提示词、模型原始响应、完整画风或参考图 URL；只记录长度、状态、耗时、错误码和参考图张数。4a 文档里的完整画风日志要求不得破坏这条默认隐私边界。

真实小说位于 `packages/aivora-prompts/fixtures/test-novel-2000.txt`，SHA-256 为 `acaba10e8752d4730be1391682a3bbc77e6fd37308e545303dba951c28f31b9e`。用户所述 `/workspace/audit/p3i/` 不在当前执行器中，不能用合成数据代称其 project.json 或截图。真实会员生成效果需用户后续实测。

## C7 提示代码目录

以下为当前逻辑层短句兜底，Claude 可按 code 调整显示文案。动态人物名、路径、计数与原始原因在 detail 中。未知旧提示映射 OPERATION_STATUS，并保留 detail，不捏造成功。

| code                          | 当前 text                        |
| ----------------------------- | -------------------------------- |
| `NOTICE_CLEAR`                | （清空）                         |
| `OPERATION_STATUS`            | 请查看操作详情。                 |
| `WORK_INTERRUPTED`            | 上次生成已中断，可以重试。       |
| `WRITING_PROGRESS`            | 正在写作。                       |
| `DIRECTOR_PROGRESS`           | 正在拆镜头。                     |
| `PERFORMANCE_PROGRESS`        | 正在补充表演。                   |
| `STALL_RETRYING`              | 导演等待超时，正在重试。         |
| `TEXT_TIMEOUT`                | 等待超时，可以重试。             |
| `TEXT_STALLED`                | 回复已停顿，可以重试。           |
| `TASK_TIMEOUT`                | 任务等待超时。                   |
| `REQUEST_STALE`               | 输入已变化，本次回复已失效。     |
| `WORK_STALE`                  | 作品已变化，本次操作已停止。     |
| `BATCH_RESPONSE_INVALID`      | 分批结果格式不完整。             |
| `WRITER_FAILED`               | 编剧未完成，可以重试。           |
| `DIRECTOR_FAILED`             | 导演未完成，可以重试。           |
| `ONECLICKFILM_FAILED`         | 连续制作未完成，可以重试。       |
| `PLANACTION_FAILED`           | 动作指导未完成，可以重试。       |
| `PLANART_FAILED`              | 美术未完成，可以重试。           |
| `PLANPERFORMANCE_FAILED`      | 表演指导未完成，可以重试。       |
| `PLANPROMPTER_FAILED`         | 提示词未完成，可以重试。         |
| `PLANQC_FAILED`               | 审片未完成，可以重试。           |
| `COVERAGE_INCOMPLETE`         | 台词或结尾未覆盖，请补齐。       |
| `COVERAGE_REPAIRING`          | 正在补齐台词和结尾。             |
| `DIRECTOR_OVER_BUDGET`        | 已保留全部内容，请核对镜头数。   |
| `ACTION_UNASSIGNED`           | 部分动作未分配，请核对镜头。     |
| `VOICE_EMPTY`                 | 这一镜没有台词，不用配音。       |
| `VOICE_TRAITS_REQUIRED`       | 请先确认人物性别和年龄。         |
| `MULTI_VOICE_REQUIRED`        | 多角色对白需要分别配音。         |
| `VOICE_PROGRESS`              | 正在生成配音。                   |
| `VOICE_FAILED`                | 配音未完成，可以重试。           |
| `VOICE_DONE`                  | 配音已生成。                     |
| `VOICE_PREVIEW_PROGRESS`      | 正在试听。                       |
| `VOICE_PREVIEW_STOPPED`       | 已停止试听。                     |
| `VOICE_PREVIEW_UNAVAILABLE`   | 当前无法试听，请查看详情。       |
| `SOUND_DISABLED`              | 声音已关闭，请先打开。           |
| `DIALOGUE_REQUIRED`           | 请先写一句台词。                 |
| `DURATION_LOCKED`             | 已保留手动设置的时长。           |
| `DURATION_SPLIT_REQUIRED`     | 台词较长，请确认拆镜。           |
| `DURATION_UPDATED`            | 镜头时长已更新。                 |
| `DURATION_ESTIMATED`          | 镜头时长按字数估算。             |
| `GROK_MEMBERSHIP_REQUIRED`    | 请先登录 Grok 会员。             |
| `DESKTOP_REQUIRED`            | 请在桌面版继续。                 |
| `AUTH_BROWSER_OPENING`        | 正在打开浏览器授权。             |
| `AUTH_CONNECTED`              | 会员已连接。                     |
| `ENTITLEMENT_DENIED`          | 当前会员不能使用此功能。         |
| `AUTH_CANCELLED`              | 登录已取消。                     |
| `AUTH_FAILED`                 | 登录未完成，可以重试。           |
| `AUTH_SIGNED_OUT`             | 已退出登录。                     |
| `AUTH_SIGNOUT_FAILED`         | 退出未完成，可以重试。           |
| `REAUTH_REQUIRED`             | 请重新登录会员。                 |
| `MODEL_UNAVAILABLE`           | 当前模型不可用。                 |
| `DRAFT_MODEL_UNAVAILABLE`     | 草稿模型不可用。                 |
| `SCRIPT_APPLIED`              | 剧本已写入。                     |
| `SHOTS_APPLIED`               | 分镜已写入。                     |
| `SHOT_APPLIED`                | 这一镜已写入。                   |
| `ART_APPLIED`                 | 画风和人物资料已写入。           |
| `ALREADY_APPLIED`             | 这一步已经写入。                 |
| `USER_EDIT_PRESERVED`         | 已保留手动修改。                 |
| `SCENES_REQUIRED`             | 还没有可写入的场次。             |
| `SHOTS_REQUIRED`              | 请先拆分镜头。                   |
| `CAST_NOT_FOUND`              | 尚未识别出人物和场景。           |
| `CAST_RECORDED`               | 人物已记下。                     |
| `APPEARANCE_PROGRESS`         | 正在提取人物外貌。               |
| `APPEARANCE_REQUIRED`         | 请先填写人物外貌。               |
| `PORTRAIT_PROGRESS`           | 正在生成定妆照。                 |
| `PORTRAIT_FAILED`             | 定妆照未完成，可以重试。         |
| `PORTRAIT_DONE`               | 定妆照已生成。                   |
| `IMPORT_FAILED`               | 文件未导入，请查看详情。         |
| `IMPORT_EMPTY`                | 文件中没有可用正文。             |
| `IMPORT_FORMAT_UNSUPPORTED`   | 请导入 txt、docx 或 epub。       |
| `IMPORT_TRUNCATED`            | 导入内容超出限制，请分批导入。   |
| `IMPORT_READY`                | 已读入场次，请确认写入。         |
| `TEMPLATE_APPLIED`            | 故事模板已放入。                 |
| `STORYBOARD_PROGRESS`         | 正在制作剧本和分镜。             |
| `STORYBOARD_READY`            | 分镜已准备，请确认下一步。       |
| `STILL_PROGRESS`              | 正在生成画面。                   |
| `FIRST_FRAME_PROGRESS`        | 正在生成带参考图的首帧。         |
| `FIRST_FRAME_FAILED`          | 首帧未完成，可以重试。           |
| `STILL_FAILED`                | 画面未完成，可以重试。           |
| `STILL_DONE`                  | 画面已生成。                     |
| `STILL_CANDIDATES_READY`      | 候选画面已生成，请选择。         |
| `STILL_CONFIRM_REQUIRED`      | 请确认候选画面生成。             |
| `COMPOSITION_SELECTED`        | 构图已选择。                     |
| `GENERATION_CONFIRM_REQUIRED` | 请确认生成范围和版本数。         |
| `GENERATION_QUEUED`           | 生成已排队。                     |
| `GENERATION_PAUSED`           | 生成已暂停。                     |
| `GENERATION_CANCELLED`        | 生成已取消。                     |
| `GENERATION_CANCEL_REQUESTED` | 已请求取消，请核对已发出的任务。 |
| `GENERATION_FAILED`           | 生成未完成，可以重试。           |
| `GENERATION_DONE`             | 这一版已生成。                   |
| `GENERATION_NO_FAILURES`      | 没有需要重试的失败任务。         |
| `ASSEMBLY_FAILED`             | 镜头未接成成片，请重试。         |
| `EXPORT_INCOMPLETE`           | 还有镜头未生成，请核对导出范围。 |
| `EXPORT_FOLDER_REQUIRED`      | 请选择导出文件夹。               |
| `EXPORT_PROGRESS`             | 正在导出成片。                   |
| `EXPORT_FAILED`               | 导出未完成，可以重试。           |
| `EXPORT_DONE`                 | 成片已导出。                     |
| `PROJECT_CREATED`             | 作品已新建。                     |
| `PROJECT_RENAMED`             | 作品名已更新。                   |
| `PROJECT_OPEN_FAILED`         | 作品未打开，请重试。             |
| `PROJECT_OPENED`              | 作品已打开。                     |
| `PROJECT_DELETED`             | 作品已删除。                     |
| `EPISODE_CREATED`             | 新一集已创建。                   |
| `EPISODE_DELETED`             | 这一集已删除。                   |
| `EXAMPLE_OPENED`              | 示例已打开。                     |
| `EDITOR_GUIDANCE`             | 请查看创作步骤说明。             |
| `SHOT_SELECTED`               | 镜头已选择。                     |
| `SHOT_REMOVED`                | 这一段已剪掉。                   |
| `REVIEW_RECORDED`             | 审片意见已记下。                 |
| `REVIEW_TEXT_ONLY`            | 目前只提供文字审片意见。         |
| `AUDIO_MUTED`                 | 这一路已静音。                   |
| `AUDIO_VOLUME_SAVED`          | 音量已记下。                     |
| `AUDIO_MUSIC_IMPORTED`        | 音乐已导入。                     |
| `TAKE_PREVIOUS_KEPT`          | 已保留旧版。                     |
| `TAKE_REPLACED`               | 已用新版替换。                   |
| `TAKE_UNAVAILABLE`            | 还没有可替换的新版本。           |
| `OPERATION_CANCELLED`         | 操作已取消。                     |

服务端补充：`FILM_SAVED` → “成片已保存。”；`AI_GENERATED` → “AI 生成。”；`MULTI_VOICE_REQUIRED` → “这一镜需要分角色配音。”。兼容旧客户端的 message 字段仍保留，新的 user_message 承载结构化提示。

- `COVERAGE_COMPLETE`：台词和结尾已覆盖。

- `PORTRAIT_BATCH_RUNNING`：正在补齐定妆照。

- `PORTRAIT_BATCH_PARTIAL`：部分定妆照未完成，请查看详情。

- `PORTRAIT_BATCH_DONE`：定妆照已补齐。

服务兼容结果还可能返回 `FILM_SUCCEEDED`、`FILM_BLOCKED`、`FILM_FAILED`：text 为原状态消息的前40字，完整原因在 detail。Claude 可为这三个状态提供统一文案，不能只因有该字段就把被拦截任务显示为成功。

现有重配音和导出通过 `../pro/media-tasks.ts` 进入 voice/export 任务，取消/失败为 failed，成功后才 done；仅包裹已有执行路径，没有实现 4b 新导出功能。四候选与视频首帧通过 `still-workflow.ts` 发出 image 任务；已有 HTTPS 镜头首帧直接复用。纯试听属于预览，不是持久化生成任务，当前不承诺试听 metadata 等待也出现在 TaskCenter。

## 停止测试后的接口补充

按用户最新要求，以下追加逻辑未经测试：`fixCoverage(sceneId)` 在等待期间目标场次或镜头被修改/删除时返回 null 并通知 REQUEST_STALE，不覆盖用户的新编辑。定妆照队列保留等待期间已填写的角度，角色或画风变更使旧任务失败且不重试。连续拆镜结束会按实际保存结果发 COVERAGE_INCOMPLETE / DIRECTOR_OVER_BUDGET / STORYBOARD_READY；沿用现有 code 与兜底短句，最终显示由 Claude 决定。

## B08 总体截止与取消（代码已补，未经测试）

`retryDirectorTimeout(request, progress, notify?, options?)` 给 request 传入 `{deadlineAt, signal}`。同一轮导演请求从首次调用起最多5分钟，登录/作品准备、全部文本批次、响应头等待、正文接收以及至多一次停顿重试共用截止时间；重试不会重置时钟。到期返回 TEXT_TIMEOUT，不再发第二次请求；取消返回 TEXT_CANCELLED，不重试。`options.current` 失效时以 REQUEST_STALE 停止，监听和定时器结束时清理。

`completeMembershipAgent` 将绝对截止时间传到 `completeText`，监听 AbortSignal 并调用 `cancelText(idempotencyKey)`；桌面进程在异步准备前登记请求，按该标识取消，避免误停其他请求。现有无参数取消入口保持取消最新文本请求的行为，不改界面。桌面 HTTP 层使用剩余时限，原有响应头超时保护保持有效。

C6 `CoverInput` 仅为输入契约。`aiMark` 对应未来媒体接口的 `aiLabel`；title/subtitle/backgroundUrl 保留用户输入，未选背景不制造占位图。该类型没有实现 `createCovers`、裁切、封面生成或导出接线。上述本次修改遵照用户要求不运行测试、lint、类型检查，不等待CI。

## 3j 排队恢复与跨页建议（本轮已提供）

本轮按用户更新指示恢复后端自测。上文“未经测试”是历史状态，新增验证范围见 `apps/verification/p3j/backend-followup.md`，不代表真实会员端到端验收。

- `film/generation-queue.ts`：视频 job 新增 `takeId`，稳定任务 ID 为 `video:${take.id}`。队列先保存所有待发送版本，再逐个转 running 并保存，最后才请求供应商。按 ID 结算，不能按镜头中的第一个任务结算。
- `interruptStaleWork` 保存 `interruptedFrom`。`canResumeTake` / `resumeQueuedFilm` 只恢复 queued 或 interruptedFrom=queued 的版本，复用原 ID、序号及用户选择；running 后中断的版本不自动重发。没有可靠供应商查询接口，`canLookUp` 仍应为 false，不能虚称“已找回”或“供应商没有此任务”。
- `submitGeneration(undefined, true)` 续做全部未发出的版本。现有 `pauseRef=false; setPaused(false)` 回调由业务 effect 接续，不需要 Claude 重写生成流程；同一作品同时只跑一轮。首帧准备或保存过程中暂停仍保留队列。取消未发送的版本后不会被续做复活。
- `videoTaskTarget(film, id)` 接受精确任务 ID 或版本 ID；`cancelVideoTask(film, id)` 返回 `{film,running,jobId}`，供界面应用状态并调用现有取消桥接。单个失败版本“重试”接线仍需与 Claude 的回调对齐，不能声称 Claude 分支已接入此 helper。
- `useScopedSuggestions` 提供会话内缓存（最多20个作用域），按作品、页面、场次、输入版本隔离，缓存 roleCards、未写入结果、结构化回复和对话。回到原页面恢复；输入变化不显示旧建议，写入后清除。`cache` 与快照 `origin={projectId,page,sceneId}` 可供 Claude 做跨页待处理提示；此轮不增加 JSX 标记，也不持久化建议到磁盘。
- 既有 image/voice/export 任务封装已提供，并非需要4b才可订阅；完整4a流水线、供应商任务找回、4b封面/混音/口型执行均未实现。C6封面仅保留类型。

### Claude 分支只读核对

核对 `claude/aivora-ui@3af1dbf37296a1d6d81bf2ae89835e3045b82f9e`，与本分支共同祖先为79e126d。该分支尚不含1dac5b3的编辑竞争保护及a9b53ca的总体截止/取消修复；后续整合必须同时保留业务逻辑和Claude渲染，不可整文件覆盖 ProWorkspace 或本说明。此轮未合并任何分支、未修改Claude JSX/CSS。

`49c0d93ba1bfb96ee6e27e20ea78663dc0bff7de` 的 next 树确有42个文件；交付分布在72dc12c、8636e0f、781f8f6、7221105、a267d93、c463fc7、8148051、4735ee1、49c0d93九个提交，49c0d93本身只改README/index。未来经授权整合应保留完整历史，不能只摘最后一个提交。两个Library ZIP此前下载受限，未取得原始字节；远端树检查不能替代ZIP SHA-256核验，因此不宣称已原样导入ZIP。

# 第二部分：界面接线（Claude）

把 6 个 next 组件接进专业工作区（`pro/ProWorkspace.tsx`）时，每个组件要回答四件事：放在哪个面板，由什么事件打开或刷新，数据从哪来，回调接到哪。下面逐个写清楚，最后是要 GPT 补的接口，列成可以打勾的清单。

行号按 6efe12d 的 `pro/ProWorkspace.tsx`，改过代码后以函数名为准。对应《给Claude的任务书》3J-U16；GPT 按 3J-B17 提供的接口，填在最后「和 GPT 的接口对照」那张表的「已提供」一栏。

## 总览

| 组件          | 放在哪                                           | 什么时候打开                                   | 数据                               | 现在缺的关键接口                |
| ------------- | ------------------------------------------------ | ---------------------------------------------- | ---------------------------------- | ------------------------------- |
| TaskCenter    | 盖住整个工作区的「任务」页，替换「生成队列」菜单 | 点状态栏「后台生成」；打开作品时发现上次没做完 | `taskCenterData(film, …)`          | 按请求 id 查 Grok 的结果        |
| ExportCheck   | 「导出成片」的第一步，盖住整个工作区             | 点顶栏「导出成片」，拼接完以后                 | `exportCheckData(film, report, …)` | 导出前检查（aivora-qc）的桥接口 |
| SoundPanel    | 剪辑页中间那一栏，替换预览                       | 点时间线「配音」「音乐」轨头的「声音」         | `soundPanelData(film, sceneId)`    | 这一场的音量、环境声和音效文件  |
| TakePicker    | 剪辑页的「对比」，替换并排的视频                 | 点时间线上的视频段；新版本做好时               | `takePickerData(film, shotId, …)`  | AI 审片的结论和 AI 选的版本     |
| SubtitleStyle | 剪辑页中间那一栏，替换预览                       | 点时间线「字幕」轨头                           | `subtitleStyleData(film, …)`       | 导出时把字幕烧进画面            |
| CoverEditor   | 「导出成片」的第二步，或作品菜单里的「封面」     | 检查完、保存前；或点菜单「封面」               | `coverEditorData(film, …)`         | 封面设置字段和出封面图的接口    |

## 通用约定

- 组件放在 ProWorkspace 的 `.pro-root` 里面就能拿到颜色变量，现在的根节点已经是 `.pro-root`。组件自己 import 样式。
- 适配函数是纯函数，参数是 `unknown`。可以直接传 ProWorkspace 里的 `film`，也可以传刚从 `readFilmProject` 读到的原始 JSON。用 `useMemo(() => …, [film])` 每次 `film` 变了就重算，不需要另外的事件。
- 适配函数返回 `{ ok: false, empty }` 时，在组件的位置显示 `empty.title` 和 `empty.detail`，不要渲染组件。`missing` 写进日志就行。
- 图片地址：传 `mediaUrl: fileMediaUrl`（ProWorkspace.tsx:171 已有）。不传时用 `adapters/media.ts` 里规则相同的 `mediaUrl`。
- 组件的根节点撑满父元素高度，父元素要给定高度。1280×800 下各阶段的栏宽（`pro.css` 末尾）：

| 布局                 | 左  | 中     | 右  | 下（时间线） |
| -------------------- | --- | ------ | --- | ------------ |
| 剪辑 `.ws.edit`      | 280 | 约 700 | 300 | 272          |
| 剪辑·对比 `.ws.fix`  | —   | 约 950 | 330 | 232          |
| 分镜 `.ws.board`     | 232 | 约 728 | 320 | —            |
| 单镜工作台 `.ws.gen` | 240 | 约 700 | 340 | —            |

顶栏和状态栏之间的整个工作区是 1280 宽、约 720 高。TaskCenter、ExportCheck 和 CoverEditor 需要整个工作区；SoundPanel 和 SubtitleStyle 放中间那一栏；TakePicker 放「对比」的大栏。

## 1. TaskCenter

**放在哪**

- 换掉状态栏「后台生成：…」按钮（ProWorkspace.tsx:3458）打开的「生成队列」小菜单（:3616）。
- 改成一个盖住整个 `<main>` 的「任务」页，像换阶段一样换掉中间内容。三栏都要放下，至少要 1000×600。
- 顶栏右边可以再加一个「任务」按钮，打开同一页。

**什么时候打开、刷新**

- [ ] 点状态栏「后台生成：…」打开，再点一次或点页里的返回就关掉。
- [ ] 软件启动时（:558–576）读到上次的作品后，先用**原始的** `stored` 算一次：`taskCenterData(stored, { fromDisk: true, canLookUp })`，有中断的就自动打开任务页。
  - 一定要在 `interruptStaleWork` 之前算。它会把「排队」和「正在生成」都改成「已中断」，改完以后就分不清哪些已经发出去了。
- [ ] 从作品菜单打开别的作品时（:2719、:2756）也一样。
- [ ] `film.shots[].takes` 和 `film.jobs` 变化时自动重算，不用额外的事件。

**数据**

```ts
taskCenterData(film, { paused, canLookUp: false, now: Date.now() });
```

- `paused` 用 ProWorkspace 的 `paused` state。
- 3J-B17 的 `window.aijian.onTask(cb(tasks, batches))` 做好以后，任务页直接显示它给的 `TaskItem`。`taskCenterData` 留着两个用处：启动时从 project.json 恢复（`fromDisk`），以及 onTask 还没推第一批数据时先有内容。
- TaskCenter 已经认识 `kind: "lipsync"` 和 `"export"`。`BatchProgress` 还没有显示的地方，定妆照的「5/28」（3J-U06）和一键成片步骤条（4A-U01）会用它。
- 在「按请求 id 查结果」的接口做好之前，`canLookUp` 传 `false`：中断的版本显示成「失败」，原因用保存时的那句，不出「查一下，再接着做」横幅。

**回调**

| 回调                        | 接到哪                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `onPause`                   | 队列菜单里「暂停排队」那段：`pauseRef.current = true; setPaused(true)`（:3625）                                                        |
| `onResume`                  | 现在没有能接上的：见 GPT 清单第 4 条                                                                                                   |
| `onRetry(id, "same")`       | 找到这个版本所在的镜头，`submitGeneration([shot])`（:2183），和「重试失败的」一样；`blocked` 行的 id 是 job id，用 `job.shotId` 找镜头 |
| `onRetry(id, "suggestion")` | 不用接：适配函数不给 `suggestion`，组件不会出「改描述再试」                                                                            |
| `onRetryFailed`             | 队列菜单里「重试失败的」那段（:3634）                                                                                                  |
| `onRemove(id)`              | 现在只能按 job id 取消（:3660），对不上版本：见 GPT 清单第 5 条                                                                        |
| `onReload`                  | `readSaved(film.id)` 后 `applyLive(interruptStaleWork(saved).film)`，和打开作品一样                                                    |
| `onOpenStoryboard`          | `setStage("board")`                                                                                                                    |
| `onCheck`                   | 等 GPT 清单第 1、2 条做好，再把 `canLookUp` 改成 `true`                                                                                |

**要 GPT 补的**

- [ ] 1. 每个版本存下远端请求 id（比如 `take.requestId`）。`createStoryFilm` 的返回里要带上它。
- [ ] 2. 新的桥接口 `getStoryFilmRequest(requestId)`，返回 `{ status: "running" | "done" | "failed" | "unknown", output_path?, message? }`，给「查一下」用。查完把找回的版本标成做好，没记录的标成重新排队。
- [ ] 3. `interruptStaleWork`（film/project.ts）保留中断前的状态，比如加一个 `interruptedFrom: "queued" | "running"`。现在两种都写成「已中断」。
- [ ] 4. 「接着做」：把还在「排队」的版本接着生成。现在暂停后剩下的版本停在「已暂停。点继续再生成剩下的。」，取消暂停也不会重新开始；再点生成会另建新版本，旧的一直排着。
- [ ] 5. 按版本取消：现在 `cancelledJobs` 用的是 job id（`<shotId>-video-<n>`），和版本对不上。
- [ ] 6. 起始画面、定妆照和配音也记成任务（`FilmJob.kind` 已有 `keyframe` 和 `portrait`，可以加 `voice`），不然任务页里看不到它们。现在只有视频有记录。
- [ ] 7. 生成被拒时，如果模型给了改写建议，存到 `take.suggestion`，任务页才会出「改描述再试」。

## 2. ExportCheck

**放在哪**

- 「导出成片」对话框（:3690）改成两步。第一步是导出前检查：ExportCheck 盖住整个工作区，至少 1000×600。第二步是现在的「文件名、保存到」。
- ExportCheck 里的「直接导出」就是现在的「开始导出」。

**什么时候打开、刷新**

- [ ] 点顶栏「导出成片」，先拼接：`joinedCut`（:2470）调用 `assembleFilm`，结果写在 `film.assemblyPath`。
- [ ] 拼好后调用检查接口（GPT 清单第 1 条）。等待时 `checking: true`，拿到报告后填进 `report`。
- [ ] 检查没法运行时，比如找不到 ffmpeg，把原因写进 `error`。

**数据**

```ts
exportCheckData(film, report, { checking, error, clipSeconds });
```

- `report` 是解析后的 aivora-qc JSON，组件自己校验。
- `clipSeconds` 是每段实际时长（GPT 清单第 2 条）。不传就用保存的镜头时长，每段可能差到一秒左右，切点附近的问题可能落到隔壁镜头上。

**回调**

| 回调                              | 接到哪                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| `onExport()`                      | `startExport()`（:2493）                                                                            |
| `onFix(issue)`，`trim`            | `setStage("edit")`，找到问题所在的镜头，`setShot(index)`，再 `setRange(true)`，和点时间线选一段一样 |
| `onFix(issue)`，`regenerate_shot` | `setStage("board")`、`setShot(index)`、`setBench(true)`，打开单镜工作台                             |
| `onFix(issue)`，`add_audio`       | 去剪辑页，打开「导入音乐」或「换配音」                                                              |
| `onFix(issue)`，`adjust_volume`   | 打开 SoundPanel（第 3 节）                                                                          |
| `onFix(issue)`，`edit_subtitle`   | 打开 SubtitleStyle（第 5 节）                                                                       |
| `onFix(issue)`，`none`            | 不做事                                                                                              |

找镜头：用 `issueWhere(issue, props.shots)` 那段对应的 span，`span.id` 就是 `shot.id`。整片的问题（`scope: "program"`）没有镜头。

**要 GPT 补的**

- [ ] 1. 桌面主进程加 `film:qc`，preload 加 `checkFilmExport(path, options)`，返回 aivora-qc v1 报告。aivora-qc 现在只在 `gpt/aivora-qc` 分支（7c0eea5），要合进来，用安装包里的 ffmpeg 和 ffprobe。
- [ ] 2. `assembleFilm` 返回每段的实际时长（用 ffprobe 量），作为 `clipSeconds`。
- [ ] 3. 把台词时间段（`dialogue: [{ start, end }]`）传给检查，静帧的阈值才会按台词放宽。
- [ ] 4. 字幕检查要有字幕文件。现在导出没有字幕（见第 5 节），aivora-qc 的字幕规则用不上。
- [ ] 5. `chosenExport`（film/operations.ts）的问题：生成时 `selectedTakeId` 先指向第一个新版本，这个版本失败了，同一镜头别的版本做好了也不会导出。可以在做好时改选，或者导出时退到第一个做好的。
  - 适配函数照现在的规则显示，所以这种镜头在 TakePicker 里没有「正在用这一版」，导出前检查里也不在时间线上。

## 3. SoundPanel

**放在哪**

- 剪辑页中间那一栏（1280 下约 700×450）。从时间线「配音」或「音乐」轨头（:6155、:6177）点「声音」，SoundPanel 换掉预览，再点一次换回来。
- 也能放右栏（300 宽）做第 4 个页签。四层会排成两行两列，内容在面板里滚动。不过还是建议放中间。

**什么时候打开、刷新**

- [ ] 点轨头的「声音」打开。显示当前镜头所在的那一场：`shots[shot].sceneId`。
- [ ] 换镜头、换场时重算。

**数据**

```ts
soundPanelData(film, currentShot.sceneId);
```

**回调**

| 回调                                   | 接到哪                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `onMoodChange(mood)`                   | 这一场每个镜头的 `shot.sound.musicMood = mood`，和分镜页「配乐情绪」（:5295）是同一个字段                               |
| `onLaneChange("dialogue", volume, db)` | 这一场镜头的配音段：`lane === "dialogue"`，且 `shotId` 属于这一场，设 `gainDb = db`。现在轨头「静音配音」改的是整部片子 |
| `onLaneChange` 其他层                  | 不用接：适配函数不给这些层的滑块                                                                                        |
| `onMasterChange`                       | 不用接：没有这一场的音量，组件不出滑块                                                                                  |
| `onDuckMusicChange`                    | 不要传：没有地方存                                                                                                      |
| `onPreview`                            | 不要传：没有按场试听的接口                                                                                              |

**要 GPT 补的**

- [ ] 1. 按 3J-B17 存 `sound = { mood, master, lanes: { dialogue, ambience, sfx, score }, duckMusic }`，每场一份，0–100，导出时用上：`master` 按段乘上去（`film:assemble` 现在没有按段的增益），`lanes` 是四层的音量，`duckMusic` 管下面第 3 条。有了它，`soundPanelData` 直接读，不再从镜头和 audioClips 推。
- [ ] 2. 环境声和音效的声音文件。现在只有文字（`scene.ambience`、`shot.sound.ambience`、`shot.sound.sfx`），没有音频，导出也不混。
- [ ] 3. 「有人说话时配乐变小」的开关。现在只要有配乐，导出总会压低（`musicMixArgs` 里的 `sidechaincompress`），要能关掉，得加字段和导出参数。
- [ ] 4. 配乐静音：`musicMixArgs`（apps/desktop/src/film-library.ts）把增益下限钳在 0.02，大约 −34 dB，所以点了「静音音乐」，导出时可能还有很小的音乐声。静音时应该不混配乐。这是读代码推断的，没有实测。
- [ ] 5. 按场试听。
- [ ] 6. 配乐情绪现在只存着：生成和导出都不读 `musicMood`。要不要用它挑配乐或写进提示词，需要定下来。

## 4. TakePicker

**放在哪**

- 剪辑页的「对比」：`ws.fix` 布局左边的大栏，1280 下约 950×520。用 TakePicker 换掉 `.cmp` 里并排的 `<video>`（:5845），连同下面的「保留旧版」「用新版替换」。
- 分镜的单镜工作台（:5428）「选一个最好的，会放进剪辑」（:5519）那块也可以用它。

**什么时候打开、刷新**

- [ ] 点时间线上的视频段（`onPickClip`，:3313），或者点「修改这一段」。
- [ ] 一个镜头的新版本做好时（`submitGeneration` 里标成 done 之后）重算；在对比页里就直接看到新版本。

**数据**

```ts
takePickerData(film, shot.id, { mediaUrl: fileMediaUrl });
```

**回调**

| 回调               | 接到哪                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| `onSelect(takeId)` | `shot.selectedTakeId = takeId`，用 `applyLive`，和「用新版替换」（:3337）一样 |

**要 GPT 补的**

- [ ] 1. 看画面审片，给每个版本一个结论和几条理由，比如 `take.review = { verdict: "可用" | "建议重做" | "必须重做", notes: [{ tone, text }] }`。现在的审片只看文字（`QC_REASON`：「审片还不能看图打分」）。
- [ ] 2. AI 选的版本：按 3J-B17 给 `aiChoiceId`（每个镜头一个）。有了它，TakePicker 才会出「AI 选的，可换」。
- [ ] 3. 并排时要播放视频的话，TakeOption 得加视频地址。组件现在只放静帧（`take.stillUrl`）。

## 5. SubtitleStyle

**放在哪**

- 剪辑页中间那一栏（约 700×450）。从时间线「字幕」轨头（:6145）点「字幕样式」，换掉预览。

**什么时候打开、刷新**

- [ ] 点字幕轨头或者一段字幕。

**数据**

```ts
subtitleStyleData(film, { value: selectedStyleOnScreen });
```

- 没有台词时返回空状态「还没有台词」。

**回调**

| 回调                | 接到哪                                                   |
| ------------------- | -------------------------------------------------------- |
| `onChange(styleId)` | 本地 state，只用来预览                                   |
| `onApply(styleId)`  | 存进作品：新字段 `film.subtitleStyle`（GPT 清单第 2 条） |

**要 GPT 补的**

- [ ] 1. 导出时把字幕烧进画面。现在 `film:assemble` 只拼接、换配音、混配乐，导出的视频没有字幕。可以按 `subtitleCues` 生成 ASS，四套样式各对应一个 ASS 样式。
- [ ] 2. 加 `subtitleStyle` 字段，取值是 `white`、`bar`、`yellow`、`film`（和 SubtitleStyle 的 id 一致），并定下没选时用哪一个。
- [ ] 3. 导出字幕要用整句。时间线上的字幕现在只取每镜台词的前 20 个字（`subtitleCues` 里的 `slice(0, 20)`）。
- [ ] 4. 导出的断行和位置要和预览一致：竖屏一行最多 12 个字，避开底部平台按钮那块。

## 6. CoverEditor

**放在哪**

- 「导出成片」的第二步：检查完、选文件夹之前。也可以在作品菜单（:2662）里加「封面」。
- 盖住整个工作区，至少 1000×600：竖屏、横屏两张预览，加右边 300 宽的设置。

**什么时候打开、刷新**

- [ ] 导出流程走到这一步，或者点作品菜单「封面」。

**数据**

```ts
coverEditorData(film, { mediaUrl: fileMediaUrl });
```

- 片名是作品名，副标题是这一集的名字。作品还叫「未命名作品」时，片名给空的，组件会提示「先写片名」。

**回调**

| 回调               | 接到哪                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `onTitleChange`    | 封面单独的片名要新字段 `cover.title`；如果片名就是作品名，走现有的改名（`renameFilm` 加 `applyLive`） |
| `onSubtitleChange` | `cover.subtitle`（新字段），或者改 `episodeTitle`                                                     |
| `onAiMarkChange`   | `cover.aiMark`（新字段）。不传 `aiMark` 时组件默认打开                                                |
| `onSave`           | 出封面图（GPT 清单第 2 条）                                                                           |

**要 GPT 补的**

- [ ] 1. 作品里加封面设置：`cover = { title, subtitle, aiMark, stillPath }`。
- [ ] 2. 出封面图的接口：在选中的静帧上叠片名、副标题和「AI 生成」标识，出竖屏 1080×1920 和横屏 1920×1080 两张 PNG。
- [ ] 3. 导出时把封面写进 mp4（作为封面图），或者放在导出文件夹里。

## 适配函数和现有代码用的是同一套规则

| 规则                         | 现有代码                                                  | 适配层                                                 |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| 导出用哪个版本、包含哪些镜头 | `chosenExport`（film/operations.ts）                      | `takeInUse`、`exportedShots`（adapters/names.ts）      |
| 保存的路径怎么变成图片地址   | `fileMediaUrl`（pro/ProWorkspace.tsx:171）                | `mediaUrl`（adapters/media.ts）                        |
| 打开作品时怎么标记中断       | `interruptStaleWork`（film/project.ts）                   | `INTERRUPTED_TAKE`（adapters/names.ts）                |
| 0–100 和 dB 怎么换算         | `volumePercentToDb`、`dbToVolumePercent`（film/audio.ts） | `volumeToDb`、`dbToVolume`（next/volume.ts，直接调用） |
| 导出文件名                   | `filmFileName`（film/operations.ts）                      | 直接调用                                               |

上面任何一条在现有代码里改了，适配层要跟着改，对应的测试会失败提醒。

## 接好以后怎么验

- [ ] 1280×800 和 1920×1080 下，每个新面板打开后整页不滚动，没有东西被挡住。
- [ ] 按 `docs/qa/acceptance-3j.md` 从导入小说走到导出。
- [ ] 每个面板在作品为空、刚打开、生成到一半这三种情况下各看一次，空状态的话能看懂。

## 和 GPT 的接口对照（3J-B17）

GPT 提供了哪一条，就在「已提供」一栏写上提交号和函数名，界面再接。

| 接口（按任务书）                                                                        | 界面用在哪                                     | 界面现在怎么处理                                                  | 已提供（GPT 填） |
| --------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- | ---------------- |
| `window.aijian.onTask(cb(tasks, batches))`，`TaskItem` 加 `lipsync`、`export`           | TaskCenter（4A-U04），生成画面的进度（3J-U07） | TaskCenter 认识这两种任务；现在从 project.json 算                 |                  |
| `BatchProgress = {batchId, label, done, total, failed, running}`                        | 定妆照「5/28」（3J-U06），一键成片（4A-U01）   | 还没有显示的地方                                                  |                  |
| 提示 `{code, text, detail?}`                                                            | 状态栏和聊天（3J-U04）                         | 文案表 `docs/design/copy-zh.md` 等 code 列表                      |                  |
| 人物 `gender`、`ageBand`                                                                | 角色页性别、年龄段下拉（3J-U05）               | 还没做；适配层也还不读                                            |                  |
| `coverage = {sceneId, ok, lastLine, missingLines, missingTail}`、`fixCoverage(sceneId)` | 场次结尾漏拍的提示和「补上结尾」（3J-U10）     | 还没做                                                            |                  |
| `film.unassignedBeats = [{sceneId, text}]`                                              | 「有 N 个动作没对上镜头」（3J-U10）            | 还没做                                                            |                  |
| aivora-qc v1 报告 + `ShotSpan[]`                                                        | ExportCheck（4B-U05）                          | `exportCheckData` 按这个格式出；`ShotSpan` 多了可选的 `label`     |                  |
| `sound = {mood, master, lanes:{dialogue, ambience, sfx, score}, duckMusic}`             | SoundPanel（4B-U01）                           | `soundPanelData` 现在从镜头和 audioClips 推，没有的显示「还没有」 |                  |
| `TakeOption` + `aiChoiceId` + `selectedId`                                              | TakePicker（4A-U03）                           | `aiChoiceId` 现在给 `null`，`selectedId` 按 `chosenExport` 算     |                  |
| `take.lipSync`、`lipSyncReason`                                                         | 口型标记（4B-U07）                             | 还没做                                                            |                  |
| `pipeline.steps = [{id, label, status, done, total}]`                                   | 一键成片步骤条（4A-U01）                       | 还没做                                                            |                  |
| `shot.continuity = [{kind, text}]`                                                      | 场记提醒（4A-U05）                             | 还没做                                                            |                  |
| 字幕样式 id `white / bar / yellow / film`                                               | SubtitleStyle（4B-U03）                        | 已经改成这四个                                                    |                  |

上面各节「要 GPT 补的」里还有几条不在 3J-B17 里，需要另外排：

- 按请求 id 查 Grok 的结果（第 1 节第 1、2 条）。
- 中断前的状态（第 1 节第 3 条）。
- 接着生成排队的版本、按版本取消（第 1 节第 4、5 条）。
- 拼接时返回每段时长（第 2 节第 2 条）。
- 选中的版本失败后不导出（第 2 节第 5 条）。
- 配乐静音不是真静音（第 3 节第 4 条）。
- 导出不带字幕（第 5 节第 1 条）。
- 封面设置和出封面图（第 6 节）。

## B16 分支整合记录

按用户最新授权，以 --no-ff 合入 claude/aivora-ui@3af1dbf37296a1d6d81bf2ae89835e3045b82f9e，保留全部组件与界面提交历史。唯一文本冲突为本说明，保留 GPT 接口与 Claude 接线两部分；ProWorkspace 自动合并后继续核对业务回调，不整文件覆盖。B16 的分支交付已合入；原始 ZIP 字节哈希仍未核验，不将 Git 合并描述为 ZIP 导入。上文“未合并”描述属于上一轮历史状态。

## 合并后的实际接线（3j）

- 全体角色按钮直接调用同一 `makeAllPortraits` 队列，单人按钮保留；TaskCenter旁显示真实BatchProgress。
- TaskCenter单项重试复用精确takeId，仅重发所选失败版本；未登录而blocked的任务没有版本，走原生成入口重新检查登录。取消同步版本和任务，不把已取消版本自动续做。
- 角色性别/年龄下拉接入稳定的 `createProductionActions.updateCharacterTraits`，显式清空不被原文推断覆盖；手选声音写入userFields并保留。
- 分镜页 `SceneCoverage` 接入 `fixCoverage(sceneId)`，空镜头场次也使用当前选中场次；显示该场缺失内容与未分配动作。保存失败允许重试，不形成未捕获Promise。未分配动作目前展示列表，拖放分配交互未交付，不能宣称支持。
- 4a/4b接口仍只定义类型；没有新增供应商任务查询、口型、混音或新导出实现。

### 发布前恢复边界补充

旧job没有takeId时，只用同一shotId和持久化take.index的唯一匹配升级，不按数组位置猜测。已知未发送的中断版本在任务订阅中显示queued，使重开作品后可继续或取消；发送后结果未知的仍显示failed，不自动重发。批量重试按钮计数和宿主执行集合一致，不给尚未提供重试入口的图片/配音/导出任务显示假操作；版本编号与attempt分别保存。视频IPC等待最多5分钟，取消时尽快释放本地等待和队列锁；超时提示先核对会员端结果，没有自动重发。

## UIR-02 覆盖原因文字

按 aivora/dev@f717e89 的对应条目，仅修改覆盖提示逻辑。聊天、连续拆镜完成通知和补尾结果共用 coverageNotice：从 missingLines/missingTail 给出原文证据与再拆/补镜头的下一步；归属风险仍单独提示。覆盖不足时不声称已保留全部内容。布局检查使用有效正则 `/\b[A-Z]{3,}(?:_[A-Z0-9]+)+\b/` 检查下划线形式的内部代码，修正文档示例 `{3,}*` 的重复量词，避免误报 AIVORA 等产品名称；没有合入整个文档分支。

## UIR-03 出图原因文字

requestShotStill 的 reason 不再拼参考图数量或模型上限，diagnostics 独立提供 referenceCount/imageLimit/videoReferenceLimit，供任务详情使用；实际发送参考张数继续由桌面请求日志记录，不记录原文。状态栏只收到规范的一句话提示，无 detail 重复兜底；新增 STILL_CAST_LIMIT 表示人物太多、应拆镜重试。未修改 Claude 的状态栏 JSX/CSS，也未处理其他 UIR 项。
