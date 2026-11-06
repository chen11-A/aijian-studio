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

**4B-U01 已接（claude/work）**：剪辑页中间那栏标题换成「预览 | 声音」两个切换，点「声音」SoundPanel 换掉预览（暂停播放），点「预览」换回来；显示当前镜头所在那一场，`soundPanelData(film, current.sceneId)` 只在打开时算。「这场的情绪」写这一场每个镜头的 `shot.sound.musicMood`（和分镜页「配乐情绪」同一个字段）；「细调」里只有配音有滑块，写这一场配音片段的 `gainDb`，状态栏「音量已记下」。整场音量、环境音、音效、配乐在面板里写原因，不出假滑块，等 GPT 4B-B04 存 `scene.sound` 以后改成读写它。轨头上没有另加「声音」按钮（4A-U10：一个动作一个入口）。

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

**4B-U03 已接（claude/work）**：剪辑页中间栏「预览 | 声音 | 字幕」的「字幕」，横屏和竖屏两个画面一起看，竖屏把字排在平台按钮那块上面（组件里标出「平台的按钮和标题会挡住这里」）。点选只是预览；「用这个样式」把 id 写进作品的 `subtitleStyle`（`white` / `bar` / `yellow` / `film`），状态栏「已记下字幕样式。」（界面自己的提示码 `SUBTITLE_STYLE_SAVED`）。`upgradeFilm` 是 `...value` 展开，所以这个字段读写作品时已经留得住；GPT 在 C5 把它加进 `FilmProject` 的类型、定下没选时的默认值、导出时按它烧字幕（下面第 1、2、4 条）。轨头没有另加入口（4A-U10）。

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

**4B-U04 已接（claude/work）**：导出对话框里加一行「封面」（「片名」· 第 1 集 · 标「AI 生成」）和「改封面」，点了对话框变宽、换成 CoverEditor，「返回」或「用这个封面」回到导出设置。改动写进作品的 `cover`（C6 `CoverInput` 的形状：`title`、`subtitle`、`aiMark`、`backgroundUrl`），没改过时从作品名、这一集、一张静帧开始，「AI 生成」默认打开；关掉时面板里写「部分平台要求标注 AI 生成，发布前请确认」。状态栏「已记下封面。」（界面自己的提示码 `COVER_SAVED`）。出封面图、导出时放进成片归 GPT（下面第 2、3 条），GPT 把 `cover` 加进 `FilmProject` 类型即可，读写作品时已经留得住。

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

## 状态栏提示（3J-U04）

- 位置：状态栏左边那一句。只有一条，5 秒后淡出；淡出前 0.4 秒变透明。鼠标停上去看全文和 `detail`。
- 数据：`setNotice` 每次都发 `aivora-notice` 事件（`UiNotice`），并把要显示的整句放进 `notice`。`useStatusNotice(notice)`（`wiring/statusNotice.ts`）对上这两样：给了 code 的，按 `wiring/noticeCopy.ts` 的 `NOTICE_COPY` 显示，`detail` 跟在后面用浅色小字；给的是整句话的，原样显示，不按字面猜 code。聊天回复也会发事件，但不改 `notice`，所以不进状态栏。
- 历史：任务中心底部「最近的提示（N）」（`next/NoticeLog.tsx`），最多 30 条，点开才画列表。
- 重试：状态栏里不再有重试按钮。`pendingRetry` 有值时，ScriptPage 和 BoardPage 把 `onRetry` 传给 Assistant，按钮「换个问法再问一次」只出现在最后一条 AI 回复下面；点了以后 `retryPending` 清掉 `pendingRetry`，按钮就没了。
- 要 GPT 配合：新加提示时给 code；新加 code 时在 `noticeCopy.ts` 补一行（不补 `noticeCopy.test.ts` 会失败）。`detail` 里请写给人看的话，比如「雨停：1 个镜头，建议 2 个」，不要只写「雨停：1/2」。

## 角色页：性别年龄和定妆照（3J-U05、3J-U06）

- 性别、年龄段：名字旁边两个下拉，改了调 `createProductionActions().updateCharacterTraits(id, {gender, ageBand})`。统一使用 GPT 的 `useProductionActions` 稳定实例，`apply` 是 `applyLive` 加 `saveFilm`，每次调用都读 `filmRef.current`；不再创建第二个控制器。
- 声音下拉按性别分组（`next/adapters/voices.ts`）：分组靠 GPT 的 `assignVoice` 读出来，不另抄声音表。手选的声音写进 `userFields: ["voiceId"]`，之后改性别年龄 GPT 不会换掉它。
- 「给所有人出定妆照」：角色列表顶上唯一的主按钮，调共享 `confirmPortraits(有外貌的人 ID 列表)`，再由它调用 `makeAllPortraits`；没写外貌的人列在按钮下面，先跳过。进度「5/28 · 失败 1」和四个图位的状态来自任务进度（`next/wiring/portraitFeed.ts`）。
- 「补这个人的」和图位上的「重试」走原来的 `makePortraits`（没外貌时先问编剧写一句）。有任何定妆照在出时，这几个按钮都不能点，避免两条队列同时出同一张。
- 要 GPT 配合：
  - `portraitFeed` 靠任务 id `portraits:<作品 id>:<这一轮>:<人物 id>:<角度>` 认图位。希望 `TaskItem` 加 `characterId`、`view` 两个字段，界面就不用拆 id。
  - `production-actions.ts` 的定妆照进度把 `JSON.stringify(batch)` 放进 `detail`，`text` 是「定妆照队列进度已更新。」。界面不显示 JSON（已经滤掉），请改成给人看的话，比如 `text: "定妆照 5/28"`，`detail` 写失败的是谁的哪一张。
  - 已修：`updateCharacterTraits` 把 `gender`、`ageBand` 记进 `userFields`，明确选择「未写」会保留为空；手选声音仍受保护。

## 分镜页：结尾漏拍和没对上镜头的动作（3J-U10）

- 组件：`next/SceneAlerts.tsx`，只收 props，放在分镜页中间那栏标题下面、镜头卡片上面。都没问题时什么都不画。
- 结尾漏拍：读场次上存的 `scene.coverage`（GPT 在导演写入和 `fixCoverage` 后存），`ok=false` 时黄条写「这一场结尾还没拍到：「…」」；只缺台词时写「这一场还有 N 句台词没拍到」。界面不在每次改动后重算。「补上结尾」调 `production.fixCoverage(sceneId)`，等的时候按钮写「正在补…」。
- 没对上镜头的动作：读 `film.unassignedBeats` 里这一场的，「有 N 个动作没对上镜头」点开是列表。可以拖到镜头卡片上，也可以先选镜头再点「放到镜头 N」。放的时候调 GPT 的 `assignActionBeats(shots, sceneId, [{text, shotId}])`，只有对白的镜头不收打斗动作，这时提示换一个镜头；放进去的镜头 `userFields` 记上 `action`。
- 判定边界：按用户确认的全部对白顺序、重复次数及尾段覆盖检查；不按“意思到了”放宽，也不缩减成只检查最后一句。保留 `coverageNotice` 的缺失证据和下一步提示。

## 首页（3J-U13）

- 组件：`next/HomeStart.tsx`，只收 props，没打开作品时占满工作区。两个大入口「一键成片」「从空白开始」，共用的画幅选择（横屏 16:9 默认，4A-U07 的新建部分），最近的作品，最下面一行「打开示例」。
- 唯一的主按钮：没登录时「用 Grok 会员登录」（调 `signInGrok`），登录后「开始一键成片」。点了以后用 `blankFilm()` 建作品、按选的画幅设 `aspectRatio`、把这句话放进第 1 场，切到剧本页；紧挨 `return (` 的 effect 在新作品显示出来后调一次 GPT 的 `oneClickFilm()`（它从闭包读 `film`，所以要等新作品进了 state）。
- 「导入小说…」：先建作品，再打开原来的文件选择框，走 `importBook`。
- 最近的作品：没打开作品时调 `listFilms()`；打开走 `openSaved(id)`，和「作品」菜单里打开是同一段代码（从菜单的行内处理移出来，没改逻辑）。
- 「打开示例」：内置的 `sampleFilm()` 只有剧本和分镜，没有画面，所以只放一行小字并写明。GPT 将来内置有画面的示例作品（4B-U08）时再做成大入口。
- 要 GPT 配合：`oneClickFilm` 改成读 `filmRef.current` 或接受作品参数，首页就不用等一次 effect。

## 一键成片步骤条和检查点（4A-U01）

- 组件：`next/PipelineSteps.tsx`，只收 props，放在顶栏和工作区之间一条（`.app.with-pipeline` 多一行）。一键成片在跑、停在分镜或有要处理的事时才出现。
- props 按 GPT 4a 的 `pipelineView(film)`（`pro/pipeline-view.ts`）的形状写，`ready` 那一支可以直接传：`steps`（含 `targets`）、`status`→`overall`、`checkpoint`、`busy`、`canContinue`、`canAcceptReview`。
- 显示：
  - 十一步按 `id` 写中文名（编剧、美术、定妆照、导演、动作、表演、画面说明、出图、审片、视频、合成成片），不显示 GPT 的 `label`，也不显示内部 id。
  - 状态各有说法：正在做、✓、「✓ 人工确认」（`accepted`，和自动做完分开）、没做完、卡住了、等你确认、结果不确定。
  - 「要处理的 N 件事」点开：没做完、卡住、结果不确定的目标逐个列出，名字用 `next/adapters/pipelineNames.ts`（「林晚 · 正面」「第 2 场第 6 个镜头」「场景「巷口」」），原因按 code 走 NOTICE_COPY。
  - 检查点写「N 个镜头 · 约 S 秒 · 约需 R 次生成 · 用会员额度」，`estimatedRequests` 说成估计，不说成会出几段视频；漏拍的结尾、台词和风险（block 红、manual 黄、info 灰）也在列表里。
- 操作，每样都是单独一下：
  - 「重试这一项」只出现在 `retryable` 的目标上，调 `onRetryTarget(stepId, targetId, outcomeConfirmed)`；`requiresOutcomeConfirmation` 的要先勾「我核对过，上次没有做成（重试会再用一次额度）」。
  - 人工审片：`canAcceptReview` 时有一个输入框，写了一句结论才能点「记下审片结论」，调 `onAcceptReview(reason)`；写明「审片还不会自己看画面」，不出 AI 分数。
  - 「继续生成」是唯一的主按钮，只在 `canContinue` 时能点；不能点时写原因（先补结尾 / 先处理标红的问题 / 先写审片结论 / 还有东西在做）。
  - `busy` 时有「取消」，调 `onCancel()`；`overall="cancelled"` 时写「已取消，做好的都留着。」
- 本分支（3j-r1）只有旧的一键成片：步骤读 `film.pipeline.steps`，检查点用旧流程停在分镜（`oneClickReady`）时的镜头数和秒数，「继续生成」还是旧的 `queueBatch`。这只是旧流程的显示，整合 `gpt/work-4a` 时换成下面这样，不要保留旧的：

```tsx
const view = pipelineView(film);
{
  view.kind === "ready" ? (
    <PipelineSteps
      steps={view.steps}
      overall={view.status}
      checkpoint={view.checkpoint}
      busy={view.busy}
      canContinue={view.canContinue}
      canAcceptReview={view.canAcceptReview}
      onContinue={() => void pipelineWorkspace.continue().catch(showPipelineError)}
      onAcceptReview={(reason) =>
        void pipelineWorkspace.acceptReview(reason).catch(showPipelineError)
      }
      onRetryTarget={(step, target, confirmed) => {
        const key = pipelineRetryKey(film, step as ProductionStepId, target, confirmed);
        if (key) void pipelineWorkspace.retry([key]).catch(showPipelineError);
      }}
      onCancel={() => void pipelineWorkspace.cancel()}
      targetName={(_, id) => pipelineTargetName(film, id)}
      sceneName={(id) => pipelineSceneName(film, id)}
    />
  ) : null;
}
```

`showPipelineError` 用现有的 `emitNotice` 发 code，不把 `Error.message` 原样显示。`view.kind === "invalid"` 时按 code 在状态栏说一句，不画假的进度。首页和剧本页的「一键成片」等交互齐了再换成 `pipelineWorkspace.start()`，不要两套同时启动。

## 画风卡（4A-U02）

- 位置：角色与场景页中间那栏最上面，「整部作品的画风」：画风预设下拉（还叫「画风」）加一段可改的「画风说明」（就是 `film.styleZh`）。从每个角色的表单里挪出来（也是 UIR-15 的一部分）。
- 改画风仍走 `onFilm({...film, styleZh})`：GPT 4a 的 `setFilm` 看到 `styleZh` 变了会走 `setFilmStyle`，记版本、标镜头，界面不另写一套。
- 「已有 N 个镜头是按原来的画风做的，要重新生成才会变。」读 GPT 存的 `shot.regenerationRequired`（`next/adapters/restyle.ts` 的 `needsRestyle`），只数已经出过画面或视频的镜头；分镜卡上同样的镜头标「画风变了」。关掉软件再开也还在。
- 本分支（基于 3j-r1）的类型里还没有这个字段，所以按可选字段读；整合 `gpt/work-4a` 以后不用改代码。

## 多选一接线（4A-U03）

- 单镜页：大预览不动，下面原来的一排版本按钮换成 TakePicker（`takePickerData(film, shot.id, { mediaUrl: fileMediaUrl })`），选了调原来的 `choose(takeId)`。
- 剪辑页「对比」：并排的 `<video>` 换成同一个 TakePicker，选了调新加的 `onChooseTake(shotId, takeId)`（改 `selectedTakeId`，状态栏「已换成这一版」）。「保留旧版」「用新版替换」先留着，合成一个入口归 4A-U10。
- TakePicker 加了 `videoUrl`：做好的版本放视频（静帧当封面），两个以上有视频时出「一起播放」，从头同时播、不出声，方便对同一个时刻。画幅跟作品走。
- 要 GPT 配合：`aiChoiceId`（AI 选的版本）和每个版本的看图审片结论（`verdict`、`notes`），给了才会出「AI 选的，可换」和结论标签。现在都没有，所以不显示。

## 任务中心抽屉（4A-U04）

- 「后台生成」打开的任务中心改成抽屉：从状态栏左上方弹出（最宽 940、最高 560），不再盖住整个工作区；按 Esc 或在抽屉和状态栏按钮以外按下就关（`useDismiss`，`data-menu="queue"`）。
- 每条任务右键：能停的写「停止」（在做）或「移出队列」（排队），失败或没发出去的写「重试」，都有「看详情」；只出这条任务做得了的，调原来的 `onRemove` / `onRetry`。
- 详情里加一条「排队 → 发给 Grok → 生成 → 存好」，只按任务状态画，停在哪一段就在那一段写「没做成」「不知道做成没有」「没有发出去」；软件看不到 Grok 做到哪里，所以不画假的百分比。
- `next/wiring/dismiss.ts` 和 `d894dc3`（3J-U18）里那一份一字不差，整合时不会冲突。
- 要 GPT 配合：如果以后能拿到每段的时间（发出、开始生成、存好），`TaskItem` 加上就能在这一条上写时间。

## 场记提醒（4A-U05）

- 分镜卡缩略图右上角一个小黄点（悬停看全文），点卡片以后属性栏最上面一块「场记提醒」逐条写白话说明。
- 读 `shot.continuity`（C13），`next/adapters/continuity.ts` 的 `continuityNotes`：3j-r1 是一条、`gpt/work-4a` 是一组，两种都认；按 kind 写标题（外貌没写进这一镜、道具前后对不上、看的方向反了、人物左右换了边、和上一镜接不上），认不得的 kind 写「场记提醒」，不露 id。
- GPT 的 4A-B07 在 `setFilm` 里跑场记检查并写这个字段，界面只读不算。

## 定妆照四角度（4A-U06）

- 角色页右栏：正面一张大图在上，侧面、背面、脸部三张小图在下，中间一句「侧面、背面、脸部按正面这张改出来，脸和衣服跟正面一样。」
- 这句话在 `gpt/work-4a` 上成立（4A-B03：`portrait-workflow` 没有正面图就不出别的角度，别的角度都拿正面图当参考）。本分支的 3j-r1 逻辑还是各出各的，所以这个界面要和 4A-B03 一起合，不能单独发。

## 画幅（4A-U07）

- 新建：首页「从空白开始」「一键成片」下面一行选「横屏 16:9（默认）/ 竖屏 9:16」（3J-U13 已做）。
- 预览：`.pro-root` 带 `data-aspect`（作品的画幅；旧作品没有这个字段按竖屏）。竖屏作品的单镜大预览、剪辑预览、分镜属性里的小预览都按 9:16 的框；分镜卡、素材栏、版本这些缩略图格子不变，画面整张放进去、不裁。
- 导出：对话框加「比例」：作品的画幅 / 另一种（从画面中间裁）/ 两种都要。只在桌面版带着 `cancelFilmExport`（和双画幅导出同一个提交 `9cf4ece` 加的）时才出现，所以 3j-r1 的桌面版看不到这个选项。
- 要 GPT 配合（整合时）：导出处理读 `exportAspects`（"work" | "other" | "both"），按它调 `exportFilmTask(base, paths, dir, host, { aspectRatio })`，「两种都要」调两次（`-16x9.mp4`、`-9x16.mp4`）；导出完成后的「打开文件夹 / 播放」指向第一份。

## 文案表替换（4A-U08）

- 界面这边按 `docs/design/copy-zh.md` 换完，进度和还在 GPT 那边的 50 条清单写在那份文件的「4A-U08 进度」一节。
- 按钮改名会影响 GPT 的提示和测试：「写入分镜」→「放进分镜」、「放入剧本」→「放进剧本」、「已写入」→「已放进去」、「让编剧写」→「让编剧分场」、「写英文提示词」→「写英文画面说明」。本分支已改 `ProWorkspace.test.tsx` 和 `e2e/p3j-regression.mjs` 里按这些名字找按钮的地方；GPT 处理函数里「点「写入分镜」才会写入」这类句子要在 4A-B11 ① 里一起改。
- 渲染部分里几处 `setNotice("…")` 改成了 `setNotice({ code, text })`（作品设置说明 EDITOR_GUIDANCE、换构图 COMPOSITION_SELECTED、暂停 GENERATION_PAUSED、取消 GENERATION_CANCEL_REQUESTED、会员用不了 ENTITLEMENT_DENIED），这样不用改 `film/notices.ts` 按字面认 code 的规则，显示走 NOTICE_COPY。
- `e2e/layout-audit.mjs` 的术语黑名单加了：模型、接口、提示词、离线、写入、画面自带、单独配音。GPT 那边的句子换完以前，这个检查会报出它们。

## 一屏一个主按钮（4A-U09）

- 顶栏「导出成片」由 `next/adapters/primaryAction.ts` 的 `exportLead(film, stage, focused)` 决定样子：平时普通按钮；在剪辑页、或者所有镜头都有选定的视频时变成主按钮（剪辑页选了一段或在对比时，让那一段的「重新生成」「用新版替换」当主按钮）；一个能导出的视频都没有时变灰，旁边灰字「还没有视频可导出」（`aria-describedby`）。点灰的按钮仍会打开导出对话框，里面按场列出还缺哪些镜头，这就是原因说明。
- 导出成为主按钮时，各页把自己的主按钮降成普通按钮（`quiet`）。
- 各页的主按钮：剧本「让导演拆镜头」，每一场有字的都拆好镜头后换成「下一步：角色与场景」；角色与场景「给所有人出定妆照」，每个人外貌和四张定妆照都齐了换成「下一步：分镜」；分镜「生成这一场」，属性栏底部那个（生成画面 / 生成视频）改普通按钮，镜头都有视频后多一个普通的「下一步：剪辑」；单镜「生成 N 个版本」。判断「这一页做完了」用 `next/adapters/stageProgress.ts`（9d89db8 的做法，按新规矩改了分镜页）。
- 助手卡里的「放进分镜」「按意见重做这一镜」改成描边强调色（`.btn.accent`），不算实心主按钮。
- 布局检查每个工作区页面都数一次：对话框以外看得见的 `.btn.primary` 最多一个。
- GPT 接 `pipelineView` 以后，检查点上的「继续生成」（`nx-primary`）出现时，分镜页的「生成这一场」也应降成普通按钮：传 `quiet={exportView.lead || pipelineAtCheckpoint}`。

## 助手建议卡（4A-U11，要 4A-B11 ④）

- 新组件 `SuggestionCard`（`next/SuggestionCard.tsx`，示例页「助手建议」）：标题「现在 6 个 → 建议 4 个」（没有镜头时「建议拆成 4 个镜头」，分场写「现在 3 场 → 建议 4 场」），下面一行「改了 2 · 删掉 2」，每行标「新增 / 改了 / 删掉」，改了的行下面灰字「原来：…」，删掉的行划掉。按钮「放进分镜 / 放进剧本」「换一个」「不要」；放进去以后卡片写「已放进去。」加「撤销」。没有建议时整张卡不画，不再出现「还没有建议 0 条」。
- 「放进」用描边的强调色，不是实心蓝，这样一页仍只有一个实心主按钮（4A-U09）。
- 差别现在由界面按文字算（`adapters/suggestionDiff.ts`：一字不差的行保持位置；两段相同之间，读起来像的一对算「改了」，其余算「删掉」和「新增」）。GPT 给了自己的差别就传 `rows`，组件直接用，不再自己算。
- GPT 在 `gpt/work-4a` 上已经有 4A-B11 ④ 的底子（`pro/actions/editor-changes.ts`、`editor-structure.ts`、`page-history.ts`），整合时这样对上：
  - 字段改动 `diffEditorSuggestion(current, proposed, selection).changes`：同一个镜头（`target.id`）有改动的，算一行 `{ kind: "changed", item: 改后, before: 改前 }`；
  - 增删镜头 `diffEditorStructure(...)`：新增的算 `added`，拿掉的算 `removed`；没动的算 `same`；
  - 拼好的 `rows` 传给 `SuggestionCard`，界面就不再按文字自己猜。
- 三个按钮的回调：

```ts
onApply; // 原来的 onApply / onApplyScenes（gpt/work-4a 上是 applyStoryConfirmation 那一套）
onAnother; // 同一位助手、同一个范围再出一版，现在的镜头不动：重发上一句话
onReject; // 丢掉这条建议，现在的镜头不动：setPending(null)（分场时 setPendingScenes(null)）
onUndo; // 把刚放进去的那一次拿掉：gpt/work-4a 上是 history.undo(film, selection)
// （createEditorPageHistory，按页记），claude/work 上先接 undoEdit
```

- 已接进 `Assistant`（4A-U11）：导演的镜头建议（`card.mode === "shots"` 且是导演，或者 `pending`）和编剧的分场建议（`card.mode === "scenes"` 或 `pendingScenes`）都画成 `SuggestionCard`；`current` 用这一场现在的镜头 / 现在的场次（`currentScenes`）。动作、表演、美术、审片这些只关于一个镜头的卡片保留原来的行，按钮改成「放进分镜 / 换一个 / 不要」（审片仍是「按意见重做这一镜 / 知道了」）。「换一个」= `sendChat`（同一位助手再出一版），「不要」= `markApplied(role)`（它只清掉建议，不改作品）。
- 放进去以后状态栏出「撤销」（读屏名「撤销刚才放进去的」），只在提示码是 SCRIPT_APPLIED / ART_APPLIED / SHOT_APPLIED / SHOTS_APPLIED 且提示还没淡出时出现，现在调 `undoEdit`；整合 gpt/work-4a 后改调按页撤销。
- 右栏每一页都是同一个标签条：剧本、角色与场景只有「AI 助手」（属性分别是中间的正文和表单）；分镜、单镜、剪辑是「属性 | AI 助手」，三页用同一个助手（主组件里的 `shotAssistant`，卡片按这一场筛）。剪辑页的「修改这一段」并进「属性」（描述框在属性里）。`rightTab` 的 "fix" 值照旧可以设，画出来就是属性。
- Ctrl+J（⌘J）：有两个标签的页面在「属性」和「AI 助手」之间切；只有助手的页面进出助手的输入框（`next/wiring/assistantKey.ts`）。
- 开场说明「跟这位助手说说你的想法。放进去之前不会改你写过的字。」是灰色小字，不再画成用户气泡；没有建议时不画卡片（以前的「还没有建议 0 条」去掉了），在写的时候只有一行灰字「正在写…」。
- 「导入小说」从编剧的快捷建议里拿掉，放到「作品」菜单里，剧本还是空的时候正文上面也有一个。

## 一件事一个入口（4A-U10，要 4A-B11 ③）

- 撤销 / 重做只留顶栏一组（提示写快捷键 Ctrl+Z / Ctrl+Shift+Z），剧本工具栏和剪辑时间线上的两组拿掉，`ScriptPage`、`EditPage` 的 `onUndo` / `onRedo` 也删了。
- 登录只留头像：顶栏「未登录 / Grok 会员 · 已连接」小标签拿掉；头像右下角一个小圆点（绿 = 已连接，橙 = 没登录或在等浏览器或要重新登录，红 = 这个会员用不了生成），悬停和账号菜单第一行写同一句话。登录、取消登录、退出都在账号菜单里。
- 声音：顶栏「声音开 / 关」拿掉，单镜页版本区标题栏和剪辑页播放器右边各一个「预览静音 (M)」，按 M 在哪一页都能切（输入框里不算）。仍是原来的 `soundOn`。GPT 处理函数里「声音关着。打开顶栏的声音再试听。」改成「声音关着。按 M 打开声音再试听。」（还认 SOUND_DISABLED），NOTICE_COPY 同步。
- 出视频只有一个入口：剪辑页时间线选段条上只留一个「重新生成」，一个镜头时打开这一镜的单镜面板（`setBench(true)` + `setStage("board")`，在那里出版本、用 TakePicker 选），选了几个镜头时按原来的「只重做这一段」排进确认表。拿掉：选段条上的「改描述」「只重做这一段」，属性里的「回到分镜重新生成」，「修改这一段」里重复的四个磁贴和「生成新版本」（描述框留着）。
- 对比只用 TakePicker 选版本：「保留旧版」「用新版替换」拿掉，换成「关掉对比」；原来 `onReplace` 的逻辑由 `onChooseTake` 代替。
- `fixAction` 状态现在没人读，只留 setter（`const [, setFixAction]`），`runAction` 不用改。
- 要 GPT 提供（4A-B11 ③）：按当前页面分派的撤销。`gpt/work-4a` 的 4b3cc81 已经有了（`createEditorPageHistory()` 的 `undo / redo / canUndo / canRedo`，按 `{ projectId, page }` 分开记，page 是 script / cast / board / edit），顶栏这一组整合后调它，`page` 用当前页签（单镜页算 board）。整合以前顶栏接现在的 `undoEdit` / `redoEdit`（撤的是整部作品的改动，剧本和时间线的改动也在里面），所以拿掉另外两组不会少功能。

## 单镜页的说明文字（4A-U12）

- 拼好的整段说明默认收起，写「看 AI 会收到的完整说明」（3JR-U05 已做，这里核对过）。
- 「包括这一镜的画面和人物外貌」改灰色（去掉 `role-a`），橙红只留给要处理的问题。
- 生成按钮下面那句改成 `next/shot.ts` 的 `videoLine(versions, current.seconds)`：「1 段 2 秒的视频 · 用 Grok 会员额度，不另外收费」。以前用的是 `generationEstimate(1, versions, duration)`，`duration` 是上一次点的时长，换镜头以后会和这一镜选中的秒数对不上（选 2 秒写「约 3 秒」）。`generationEstimate` 在 GPT 的确认和提示里照旧用，没动。上面「Grok 会员 · 成片」那一行去掉了重复的「不另外收费」。
- 左边镜头卡片撑满列宽（`.shotrow` 宽 100%），画面描述框也撑满。

## 剪辑页四条声音轨（4B-U02，要 GPT 在 C3 补波形）

- 时间线从「配音 / 音乐」两轨改成「对白 / 环境音 / 音效 / 配乐」四轨，和声音面板同一套叫法（`next/volume.ts` 的 `LANE_LABEL` 也改成 对白 / 环境音 / 音效 / 配乐）。轨头读屏名跟着改：静音对白、单听对白、对白音量、静音配乐、单听配乐、配乐音量；状态栏「只听对白 / 只听配乐」。
- 轨高：1280 下 字幕 28、视频 54、每条声音轨 30（最小 28），刚好放进 272 高的时间线，不整页滚动；1600 以上 40 / 90 / 40。
- 环境音、音效：`audioClips` 里有这一层的声音文件就按镜头位置画片段；没有文件时，把导演写的字画成虚线块（环境音盖住整个镜头，音效画在它的时间点上），悬停写「只有文字，还没有声音文件」。环境音、音效现在没有静音 / 单听 / 音量，因为 `onLane` 只认对白和配乐，也没有文件可调；GPT 4B-B05 有了声音文件后再加。
- 波形：每个声音片段里留了一条位置（现在是一条淡的虚线）。要 GPT 在 C3 的 `AudioClip` 上加：

```ts
// 均匀取样的峰值，0–1，长度不限（界面按片段宽度拉伸），没有就不画。
waveform?: number[];
```

- 配乐片段上的「导出时让路」改成文案表里的「说话时变小」。

## 导出对话框（4B-U06，4B-U05 的界面部分）

- 对话框从上到下：文件名、比例、清晰度、字幕、封面（4B-U04）、保存到、一行总结、按场列出没做好的镜头、导出进度或「导出好了：路径」、底部按钮。
- 比例：桌面版能裁时（有 `cancelFilmExport`）是下拉「作品的画幅 / 另一种 / 两种都要」（`exportAspects`，4A-U07）；不能裁时只写作品的画幅，悬停说明这个版本只能按作品画幅导出。
- 清晰度：`exportQuality`，"1080p"（默认）或 "720p"。
- 字幕：`exportSubs`，"burn"（烧进画面，默认）/ "srt"（单独一个 .srt）/ "none"。样式用作品的 `subtitleStyle`（4B-U03）。
- 进度：导出时对话框里一条来回走的进度条和一句「正在导出：拼接、混音、写文件」，因为现在拿不到百分比；完成后写「导出好了：路径」，旁边「打开文件夹」「播放」。
- 底部只有一个主按钮，现在叫「导出」（原来「开始导出」，测试和 e2e 跟着改了）。
- 要 GPT 接（4B-B09）：`startExport` / `exportFilmTask` 读 `exportQuality`、`exportSubs`、`film.subtitleStyle`、`film.cover`；能给进度时传一个 0–1 的值，界面把来回走的进度条换成真的；`gpt/work-4a` 的导出带 `signal`，接上以后在进度旁边加「取消导出」（调任务的 abort，等于任务中心里「停止」这一条）。
- 4B-U05 导出前检查：`ExportCheck` 组件和适配函数都在，等 GPT 合入 aivora-qc 并加 `checkFilmExport`（第 2 节第 1 条）。接上以后：点「导出」先检查，有「必须修」时底部唯一的主按钮变成「去修 N 处」（`onFix` 按第 2 节的表跳过去），没有时是「导出」；「一键修好」里会改时间线的修复，先记一次历史再改，状态栏给「撤销」（同 4A-U11 的 `APPLIED_CODES` 做法，加一个提示码）。

## 口型标记（4B-U07，读 C11）

- 分镜卡标题行和剪辑时间线视频片段右下角：正在用的那一版（`selectedTakeId`，没选就第一个做好的，和 `chosenExport` 一样）的 `take.lipSync` 是 done 或 pending 时写「口型」（绿），failed 时写「口型未对上」（橙），悬停「口型未对上，可重试。现在用的是没有口型的版本加单独配音。」。`next/adapters/lipSync.ts` 的 `lipSyncTag`，`lipSync` 是 C11 的对象 `{ lipSync }` 或者直接一个词都认。
- 旁白、画外音、远景、背影不走口型流程（GPT 4B-B06 判断 `lipSyncEligible`），这些镜头的版本没有口型状态，所以什么都不显示，界面不另外判断。
- 「可重试」现在走单镜面板的重新生成（4A-U10 唯一入口）。GPT 如果给口型单独的重试（只重新对口型、不重出视频），给一个 `retryLipSync(shotId, takeId)`，界面在悬停说明旁边加「重试口型」。

## 首页示例（4B-U08）

- 核对过 `aivora/dev`、`gpt/work-4a`、`gpt/aivora-media`：没有内置的、带画面和视频的真实示例作品，所以按任务书不做「看一个做好的例子」这类入口，不放假的。
- 首页现有的「打开示例」打开的是 `sampleFilm()`「雨夜巷战」：只有剧本、角色和分镜，没有画面和视频，打开后每个镜头都写「未生成」，不冒充做好的成片，所以留着当练习作品（测试也靠它）。
- 要 GPT 提供：安装包里带一部做好的示例（project.json 加它引用的静帧、视频、配音、配乐，放在应用资源目录，只读），加一个 `openBundledExample(): Promise<FilmProject | null>`。有了以后首页「从空白开始」「一键成片」下面加一行「看一个做好的例子」，打开后进剪辑页直接能播。

## 入点 / 出点选区（4C-U01，接 GPT 4C-B01）

- 选段条写整段：「已选 镜头 3–5 · 00:12.0–00:21.0 · 9 秒」（以前只写当前镜头）；选区里有台词时多一个橙色小标「这句台词会整句重来」，悬停说明台词不会从中间切开。`next/adapters/takeBadge.ts` 的 `selection(shots, span, shot)` 算的。
- 一个镜头做好两个以上版本时，分镜卡和时间线片段写「版本 2/3」（正在用的是做好的第几版）。`takeBadge(shot)`。
- 现在的选区按整个镜头选（`span` 是镜头下标）。GPT 4C-B01 做镜头里的入点 / 出点后，给每个选区 `{ shotId, inSeconds, outSeconds }`，并告诉界面扩到整句之后的范围（`expandedTo: { inSeconds, outSeconds }`），界面把「这句台词会整句重来」换成具体的时间。

## 历史版本（4C-U02，要 GPT 4C-B02）

- 作品菜单「作品设置」现在打开一个真正的对话框（以前只是一句提示）：「画风」一节写画风在哪里改，带「去改画风」；「历史版本」一节是 `HistoryList`（`next/HistoryList.tsx`，示例页「历史版本」）。按 Esc 或「关闭」关掉。
- `HistoryList`：每条写什么时候存的、为什么存的、当时有多少（都已经是白话），右边「恢复到这里」；点了在原地再问一次「恢复到「今天 14:32」？作品会回到那时的样子；现在的样子会另存一份，想回来还能恢复。」，「恢复」「取消」。`entries` 为 null 时写「这个版本的软件还不能看历史版本」，空数组时写「还没有存过的版本。每次批量生成之前会自动存一份。」。
- 现在传的是 `entries={null}`。要 GPT 提供：

```ts
// 新的在前。when / why / summary 由 GPT 写成白话，比如「今天 14:32」「批量生成前自动存的」「3 场 · 28 个镜头 · 12 个做好了」。
listFilmHistory(projectId: string): Promise<HistoryEntry[]>;
// 恢复前先把现在的样子存一份（界面这样告诉用户），恢复后返回作品，界面 applyLive。
restoreFilmHistory(projectId: string, entryId: string): Promise<FilmProject>;
```

## 设置（4C-U03）

- 头像菜单加「设置」，打开对话框（Esc 或「关闭」关掉）：账号（只写状态和「只能用 Grok 会员登录；登录、退出在头像菜单里」）、默认导出文件夹（可以浏览）、预览有声音（就是 M 切的 `soundOn`）、新封面标「AI 生成」、新手模式（每个镜头只出 1 版，单镜页不显示「一次出几个」）、用量说明（「软件看不到 Grok 会员还剩多少额度」，不显示数字）。
- 这些是这台电脑上的人的偏好，不在作品里：`pro/prefs.ts`，存在 localStorage 的 `aivora.prefs`（`exportDir`、`aiMark`、`beginner`），预览声音还是原来的 `aivora.sound`。导出对话框打开时，导出文件夹空着就先用 `prefs.exportDir`，再退到桌面版的默认文件夹；封面没改过时「AI 生成」按 `prefs.aiMark`。
- 新手模式打开时把 `versions` 设成 1。一键成片和批量生成本来就按 `versions` 出，不用改；GPT 如果有别处读 `film.takesPerShot`，新手模式下也应当按 1。
- 想把这些偏好存到桌面版的应用数据目录（换浏览器也在），GPT 可以给 `readAppPrefs / writeAppPrefs`，`pro/prefs.ts` 换成调它们。

## 分镜属性分组（4C-U05）

- 分镜页属性栏分三组（`<details>`，组件 `PropGroup`）：「画面」（景别、运镜、角度、时长、描述、出场角色、候选画面）默认展开；「声音」（台词、声音来源、环境音、配乐情绪、按台词定时长）和「高级」（这一镜的画风、英文画面说明、审片、站位、朝向、动作要点、表演）默认收起。每组上次开着还是关着记在这台电脑上（`pro/prefs.ts` 的 `readGroupOpen / writeGroupOpen`，localStorage 的 `aivora.board.groups`）。
- 时长：当前值不在 2–10 里时（比如 1.5 秒）「自定义」高亮并显示数值，原来就是这样，这次核对过。
- 「单镜」「返回分镜」两个按钮换成同一个分段切换「全部镜头 | 单个镜头」（`ShotView`），测试、布局检查跟着改了按钮名。
- 分镜卡标题行右边的来源小圆点去掉了，状态只看画面左上角的标签；「原来就有 / 你改过 / 来自哪位助手」写进卡片的悬停说明。

## 作品菜单分组（4C-U06）

- 「作品」菜单分三组：作品（新建作品、新建横屏、打开示例、导入小说、做过的作品）、这一部（各集、新建一集、作品设置）、分隔线以后是「删除这一集」「删除这部作品」，红字，点了还是走原来的确认对话框。
- 改名不在菜单里了，挪进「作品设置」最上面「作品名」（输入框加「保存名字」，回车也行），处理照旧（`renameFilm` + `applyLive`）。
- 布局检查加「作品菜单」一步。

## 作品级设置和剪辑页小问题（4C-U07）

- 旁白声音从单个角色的表单里挪到「角色与场景」页最上面「整部作品的画风」卡里，一行「整部作品的旁白」加「试听旁白」，三个标签页都看得到；字段和处理照旧（`film.narrationVoiceId`、`onPreview`）。画风在 4A-U02 已经放在这张卡里。
- 分镜页这一场还没有镜头时，右栏显示这一场的设置：在哪（`scene.where`）、这一场的环境音（`scene.ambience`），加一句整部作品的画风和在哪里改，以前只有一句「这一场还没有镜头」。
- 剪辑页预览没有视频时，「还没有可以播放的视频。」改成预览区正中的灰字（以前用了字幕样式）。
- 轨道音量：细条加小圆点，旁边写数字（0–100），不再像一个开关。

## 状态栏分区和助手上下文（4C-U08，要 4A-B11 ⑤）

- 状态栏三栏：左边最新一条提示（加 AI 在写时的「取消」、放进去以后的「撤销」）；中间是在做的事，有任务时「后台生成：正在做 3 个」加进度条，没有时只剩一个小图标按钮（读屏名仍是「后台生成：没有在做的」，悬停「任务和提示记录」，点开还是任务抽屉和提示记录）；右边是作品存在哪里。「浏览器里，还没写到应用数据目录」只在开发环境（`import.meta.env.DEV`）显示。
- 助手输入框上方一行「正在看：第 2 场「雨夜旧书店」」（剧本页）或「正在看：第 2 场第 3 个镜头」（分镜、单镜、剪辑），右边「@」按钮列出人物和这一场的镜头（最多 12 个），点了插进输入框，比如「@林晚 」「@镜头 3 」。
- 要 GPT（4A-B11 ⑤）：发消息时把正在看的范围（`{ sceneId, shotId? }`，界面里就是 `scene` 和 `shownShots[shot]`）当上下文交给智能体，并认消息里的「@名字」「@镜头 N」。界面只负责显示范围和插入文字。

## 和 GPT 的接口对照（3J-B17）

GPT 提供了哪一条，就在「已提供」一栏写上提交号和函数名，界面再接。

| 接口（按任务书）                                                                        | 界面用在哪                                     | 界面现在怎么处理                                                                                            | 已提供（GPT 填）                                           |
| --------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `window.aijian.onTask(cb(tasks, batches))`，`TaskItem` 加 `lipsync`、`export`           | TaskCenter（4A-U04），生成画面的进度（3J-U07） | TaskCenter 认识这两种任务；现在从 project.json 算                                                           |                                                            |
| `BatchProgress = {batchId, label, done, total, failed, running}`                        | 定妆照「5/28」（3J-U06），一键成片（4A-U01）   | 还没有显示的地方                                                                                            |                                                            |
| 提示 `{code, text, detail?}`                                                            | 状态栏和聊天（3J-U04）                         | 已接：`wiring/statusNotice.ts` 听 `aivora-notice`，按 `wiring/noticeCopy.ts` 显示，5 秒淡出；历史在任务中心 | `film/notices.ts`（a9b53ca）                               |
| 人物 `gender`、`ageBand`                                                                | 角色页性别、年龄段下拉（3J-U05）               | 还没做；适配层也还不读                                                                                      |                                                            |
| `coverage = {sceneId, ok, lastLine, missingLines, missingTail}`、`fixCoverage(sceneId)` | 场次结尾漏拍的提示和「补上结尾」（3J-U10）     | 已接：`SceneAlerts` 读 `scene.coverage`，按钮调 `fixCoverage`                                               | `director-workflow.ts`、`production-actions.ts`（a9b53ca） |
| `film.unassignedBeats = [{sceneId, text}]`                                              | 「有 N 个动作没对上镜头」（3J-U10）            | 已接：列表可拖到镜头，放的时候用 `assignActionBeats`                                                        | `film/operations.ts`（a9b53ca）                            |
| aivora-qc v1 报告 + `ShotSpan[]`                                                        | ExportCheck（4B-U05）                          | `exportCheckData` 按这个格式出；`ShotSpan` 多了可选的 `label`                                               |                                                            |
| `sound = {mood, master, lanes:{dialogue, ambience, sfx, score}, duckMusic}`             | SoundPanel（4B-U01）                           | `soundPanelData` 现在从镜头和 audioClips 推，没有的显示「还没有」                                           |                                                            |
| `TakeOption` + `aiChoiceId` + `selectedId`                                              | TakePicker（4A-U03）                           | `aiChoiceId` 现在给 `null`，`selectedId` 按 `chosenExport` 算                                               |                                                            |
| `take.lipSync`、`lipSyncReason`                                                         | 口型标记（4B-U07）                             | 还没做                                                                                                      |                                                            |
| `pipeline.steps = [{id, label, status, done, total}]`                                   | 一键成片步骤条（4A-U01）                       | 还没做                                                                                                      |                                                            |
| `shot.continuity = [{kind, text}]`                                                      | 场记提醒（4A-U05）                             | 还没做                                                                                                      |                                                            |
| 字幕样式 id `white / bar / yellow / film`                                               | SubtitleStyle（4B-U03）                        | 已经改成这四个                                                                                              |                                                            |

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

UIR-03 的 STILL_REJECTED 保留供应商明确拒绝的含义，兜底文字为“这张画面未获准生成，请调整画面描述后重试。”；普通网络/出图失败仍为 STILL_FAILED。B18/B19 已按用户新指示移到出包后的下一轮，延后指示前已提交的 UIR-02/03 保留，不继续扩展。

## 98f2ab0 本轮界面整合（当前有效约定）

本次只合入 Claude 固定提交 `98f2ab0` 及其祖先，不合之后延期 UIR 提交。历史“待接线”描述以本节为准。

- 保留 GPT c562530 的精确视频任务 retry/cancel、旧任务唯一匹配、已知未发送恢复、独立 attempt、blocked 单记录单版本以及视频有界等待。TaskCenter 计数与宿主执行均使用 retryableVideoTask；没有供应商查询能力，不声称可找回任务。
- 全体定妆照和单人补全只有一套 confirmPortraits/workOwners 锁；角色页沿用 Claude 单主按钮、缺外貌列表、四角度状态和 portraitFeed。不会同时渲染旧 CharacterTraits 或第二个全体按钮。
- 属性、当前场次补尾统一接 useProductionActions；明确清空性别年龄保持为空，手选 voiceId 不自动覆盖。
- 分镜只渲染 SceneAlerts。场次来自 activeSceneId，即使该场没有镜头也显示覆盖与未分配动作。useCoverageRepair 按作品和场次隔离忙碌/失败；旧请求结束不清除新场请求状态，保存失败可再次点击。
- 动作支持拖放和选中镜头后放入；始终经 assignActionBeats 验证，纯对白镜头拒绝打斗动作；成功后才删除该项并记 action 用户编辑标记。拖放携带作品/场次与动作文本，拒绝跨场或过期索引，不按位置猜。
- 状态栏采用 Claude useStatusNotice/NoticeLog，保留 GPT coverageNotice 和出图失败原因；STILL_REJECTED、STILL_CAST_LIMIT 映射已补，diagnostics 与用户提示分离。跨页面建议缓存与写入清除逻辑保留。
- 双方测试取并集，保留真实持久化、未知属性、重开恢复及任务过滤断言；新增空场补尾、跨场拖放、补尾失败及并发场次状态回归。本次整合未运行测试，最终统一检查由主代理执行。
- 不实现4a/4b；原 ZIP 字节和哈希仍未取得验证，本次是 Git 历史合并，不称 ZIP 导入。

### B17 仅原文归属风险的持久提示

`SceneAlerts.coverageWarning?: string` 接收现有 `coverageNotice(coverage).detail`，仅在当前场 `coverage.ok=false` 且 `missingLines` 为空、`missingTail` 为空时提供。即使没有未分配动作，风险说明也留在分镜页，换页回来仍能看见。它不制造缺失台词，不把归属风险说成结尾漏拍，也不显示“补上结尾”按钮；现有说明给出核对原文与重新拆镜的下一步。对应 SceneAlerts 与 ProWorkspace 回归已通过；最终全量和 CI 结果另见阶段报告。

# 下一轮补充：B19 数值诊断（已提供）

桌面 `agents.log` 的图片请求记录增加 `selectedReferenceImageCount`、`requestDispatched`、`imageLimit`、`videoReferenceLimit`。`referenceImageCount` 只计入已尝试调用传输的参考图；未登录或超限而没有调用传输时为 0，已选数量另存。`requestDispatched=true` 仅表示尝试发起请求，不证明供应商收到、接受或生成成功。重复参考图先去重计数。

这些字段仅为数值/布尔诊断，不加入状态栏、聊天或用户失败文案。原文、提示词、图片地址、凭据和供应商正文仍不写日志。B18 的 `coverageNotice` 和 B19 的 `stillFailureNotice` 保持现有接线；无需新增界面组件。

## 4A-B01 后台流水线（部分提供，尚未替换现有入口）

此节属于 3j-r1 出包后的 4a 工作。现有“一键成片”按钮尚未接下面的新控制器，不能将模块回归通过说成界面全流程完成。

### 已提供

- `pro/film-pipeline-controller.ts` 的 `createFilmPipelineController(host)` 提供 `run(options)`、`recover()`；`film.productionPipeline` 保存逐步、逐目标状态，`film.pipeline` 是 C12 显示投影。步骤为 writer、art、portraits、director、action、performance、prompter、stills、review、video、assembly。
- 编剧分场与角色提取分别保存；定妆照目标是 `${characterId}@${view}`，每个角度保存后才推进。导演逐场，动作只按镜头 ID；表演精确 ID 优先，仅无重复且可一一对应时兼容顺序并保存来源，歧义待核对；提示词逐镜。状态与业务结果同次保存，失败不继续下一个目标。
- `pro/pipeline-media-actions.ts` 提供 `makePipelinePortraits`、`makePipelineStill`、`assemblePipelineFilm`；复用会员出图和现有桌面合成。合成有缺失音轨等部分成功原因时不会标成完整成功。没有引入口型、四层调音或付费服务。
- 重开时 `recover()` 把中断的 running 标成 uncertain，绝不自动重发。完成目标保留；重试必须用 `productionTargetKey(step, target)` 生成的精确键，例如 `portraits/character-1@正面`。`run({retryTargets:[key]})` 只重试用户选中的目标。
- 没有已验证的看图能力时，review 返回 needs-input，不写 AI 评分或 AI 选中版本。用户真的审过后才能调用 `run({acceptInputs:[{key:productionTargetKey("review", "all"),reason}]})`；人工状态记为 accepted，区别于自动完成。
- 审片后仍停在独立 checkpoint，含镜头数、时长、预计请求数、覆盖及风险。用户再次明确确认才调用 `run({continue:true})`。后台不把人工审片和继续视频合成一个自动动作。
- 取消通过 `run({signal})` 传入 AbortSignal；晚到结果不写回。作品切换、源文或业务数据被编辑、相同作品并发执行均有守卫。媒体路径记录与可选 `verifyMedia` 是不同层次，未提供探测时不能声称文件已经实际播放验证。

### 接线前必须处理（GPT 逻辑与 Claude 4A-U01 配合）

1. 已提供并实例化 `pipelineWorkspace`：`start()`、`recover()`、`retry(keys)`、`acceptReview(reason)`、`continue()`、`cancel()`。宿主先完成作品 ID 准备，采用独立会员请求与有效性守卫，不依赖聊天 activeTurn；video 提交复用预先准备的 billingProjectId。
2. 已接 `film-persistence`：按作品排队、流水线取得独占保存租约前排空已发旧写入；自动保存与退出刷新不能覆盖检查点，停止期间的新用户编辑会保存。媒体准备先于摘要和原子写盘；摘要按真实重载规范计算，源文及真实媒体修改仍拒绝续跑。作品打开只恢复 running→uncertain，不重发；切换作品与卸载取消旧宿主。
3. Claude 提供步骤进度、精确目标重试、uncertain 风险确认、真实人工审片及独立 checkpoint 的继续/取消操作。显示文案由 Claude 定，后台 code 不直接显示给用户。
4. 旧 footer 的“继续出视频”当前直接调用 `queueBatch`；启用新入口时必须改接上述 checkpoint 操作，不能旁路审片和原文覆盖。GPT 配合提供业务回调，Claude 修改 JSX。
5. 宿主、保存协调、真实 save→upgrade→hydrate→recover 及 ProWorkspace 打开作品回归已补；真实会员全流程仍待验收。旧入口未切换，需完成第 3、4 项 Claude 交互后再启用，4A-B01 仍为部分完成，不发布 4a tag。

## 4A-B02 画风说明（已提供）

- `styleZh` 为唯一持久化美术说明，保持原文；`styleRevision` 标识修改。角色页既有画风修改与美术写入均经过逻辑层，旧镜头增加 `regenerationRequired={code:"STYLE_CHANGED",styleRevision}`，不删媒体、不覆盖手改。Claude 可据此显示“需要重新生成”；单张图生成不会擅自清除视频过期标记。
- 定妆、场景、首帧、候选、连续镜头和视频请求均带完整画风块。只去重构造器专用块，不删对白和叙述中的同词。视频的单镜说明也完整保留；旧的 400 字截断 style_block 不再发送。描述不能完整容纳时返回 `STYLE_BIBLE_TOO_LONG` 或 `MEDIA_DESCRIPTION_TOO_LONG` 短提示，不截台词或动作尾部。
- 按用户确认的隐私规则，默认日志不记完整画风或原文。桌面从实际请求块计算 `styleCharacters`（Unicode 字符数）与 `styleSha256`；首帧和逐镜视频提交已接线。视频日志仅表示向本地服务提交，不能证明供应商收到；没有伪造模型验收或图片质量证据。

## 4A-B03 正面锚点定妆（已提供）

全体、单人和流水线入口统一使用 `generate(prompt,references)`：先生成并保存正面全身图，侧面/背面/脸部仅用该人物正面图改图。缺正面时，单角补全自动增加一个前置任务并计入总数。正面失败重试一次，依赖角度标失败且不发请求，继续其他角色；正面被更换时丢弃旧回包。错误保留 `PORTRAIT_ANCHOR_REQUIRED` code，详情为“先补好正面照，再生成这个角度。”。画质沿用 medium。回归验证请求确实带同人物参考图；没有以此代替真实会员同脸视觉验收。

## 4A-B04 前镜末帧衔接（已提供）

导演可返回 `connect_previous:true`，解析器在合镜和重编 ID 后解析 `continuityFromShotId`，仅接受同场紧邻前镜；歧义保留提醒，不按错误 ID 猜。实际视频提交前，`ensureContinuityFrame` 通过 `window.aijian.extractFilmLastFrame(seriesId,videoPath)` 提取前镜已选完成版本的最后解码帧，保存 `poster` 和 `continuityFrame={sourceShotId,sourceTakeId,sourceVideoPath,path}` 后才提交视频。前镜失败后重做会选中新完成版本，下一镜据此衔接。预览出图阶段不提取不存在的视频。

本地 FFmpeg 解码与 PNG 校验不调用供应商。拒绝跨场、无完成版本、过期回包和不可信路径；媒体限制为现有短镜头 MP4（最多 80 MiB、60 秒），结果最多 12 MiB。失败返回 `CONTINUITY_*` code 与短提示，界面不显示原始 code。真实 FFmpeg 回归比较实际末帧像素；会员生成视频的视觉连续性仍需实测。

## 4A-B07 场记规则（已提供）

`film/continuity-rules.ts` 提供 `continuityRisks(film)`、`applyContinuityChecks(film)`；每镜 `continuity: ContinuityNote[]`，旧单对象存档自动迁移。工作区业务修改时更新并保存；流水线在准备快照和计算摘要前统一检查，重开不会因派生提醒误判内容变化。修正文本后仅清除本规则生成的提醒，保留导演或用户的其他说明。

五类为 `missing_look / prop / gaze / axis / cut`：固定外貌句遗漏、明确同人物持物换手、明确视线反向、明确轴线侧改变、末帧来源不匹配。只根据文字与记录提出核对建议，不声称已看图或能判定真实镜头物理连续性。模糊描述、否定句与引述不作持物/视线证据。Claude 可按 C13 在镜头卡显示多条提醒；本提交不改其 JSX/CSS。

## 4A-B10 场景参考与画幅（部分提供，任务书重复编号分开记录）

场景参考：`FilmLocation.referenceImage/referenceStyleRevision` 保存真实生成地址和画风版本。新流水线 portraits 阶段在人物之后安排实际场次使用的 `location:<id>`；精确重试键为 `portraits/location:<id>`。逐图保存、失败重试一次、取消不标完成，已有有效图复用。地点只按 `scene.where` 精确匹配，歧义不猜。`makeLocationReferences` 也提供独立宿主接口；旧页面尚无生成场景图入口，需 Claude 接入新流水线后才有可见流程。

首帧最多五张、视频首帧另加最多十三张参考，均人物优先，余位追加场景图；满额时不挤掉人物。过期画风图不作为参考。HTTPS 地址可持久化但不等于已下载本地；实际出图桥返回已保存路径，文件验证仍在桌面边界。真实会员背景一致性未验。

画幅：新建作品数据默认横屏 `16:9`，显式竖屏和新集继承继续支持；旧无画幅存档维持原竖屏解释。生成请求沿已有画幅链传入。Claude 新建选择及预览适配仍未完成；双画幅居中裁切后端见下文补充，不能将此编号整体标已修。

## 4A-B11 选择、差异与撤销（初始接口；实际接线见后文）

- `pro/actions/editor-context.ts`：`resolveEditorContext(film,{projectId,page,sceneId?,shotId?})` 精确解析实际选择；缺选择不代选第一场，跨作品/场镜不符明确拒绝。`editorAgentContext` 仅投影选中原文、镜头文本/台词及人物身份，排除媒体路径、URL、任务及流水线元数据；不截断原文，后续请求继续使用既有分批机制。不要把完整界面快照直接发给供应商。
- `pro/actions/editor-changes.ts`：`diffEditorSuggestion(base,proposed,selection)` 给出按实体字段的 before/after；`applyEditorSuggestion(latest,suggestion)` 在字段仍等于 base 时原子应用并给 receipt。建议产生时保留 base，不可应用时偷换成 latest。结构新增/删/重排显式 unsupported，不能绕过检查。
- `undoEditorReceipt(latest,receipt)` 只恢复仍等于该次写入结果的字段，保留后续手改、生成资产和任务；冲突逐项返回。`createPageUndoHistory()` 按作品和页面 record/canUndo/undo，不跨作品恢复。宿主须在成功保存后登记 receipt，并执行角色选声、画风过期等业务校验。

上述函数与 14 项回归已提供；页面回调、请求接线、redo 和持久化历史尚未实现；结构性事务见下文补充。现有全作品撤销尚未替换，不把这些纯函数说成用户可用入口。Claude 可先据接口准备差异显示，具体宿主接线由 GPT 继续完成。

### 4A-B10 双画幅导出后端（已提供，选择器未接）

`exportFilmTask(base,paths,directory,host,{aspectRatio:"16:9"|"9:16"})` 使用本地 FFmpeg 居中裁切，并原样复制音轨；省略 options 维持原比例复制。分别调用两个比例即可得到 `-16x9.mp4`、`-9x16.mp4`，不会覆盖源视频。底层 `exportFilmCut(source,directory,name?,{aspectRatio?,requestId?})` 与 `cancelFilmExport(requestId)` 已提供。输出在目标目录临时文件生成、校验后原子发布；失败不留下半成品。

取消会阻止最终发布并在进程结束后清理临时文件；现有 FFmpeg 宿主没有中止进程接口，不能声称点击取消立即终止编码。真实 FFmpeg 回归验证两种比例、中心像素、音轨字节一致和源文件不变。Claude 仍需导出比例选择器和“两种都要”交互；本提交不改 JSX，也未新增 4b 声音混合/导出检查。

### 4A-B11 结构事务补充（初始接口；实际接线见后文）

`pro/actions/editor-structure.ts` 提供 `diffEditorStructure`、`applyEditorStructure`、`undoEditorStructure`。仅接受明确审核的连续场/镜头范围，原结构与关联任务、音频、衔接引用均作比较；不删除带资产或依赖的对象，不替换媒体。结构 receipt 必须交给 `undoEditorStructure`，不可塞进字段撤销历史。10 项回归通过；保存协调、页面回调和 Claude 差异呈现仍需接线。

### 4A-B08 场景布局与编剧来源（已提供）

`FilmLocation.layout/referenceLayout` 保存空间关系及参考图生成时的快照；改布局使旧图失效。布局实际进入首帧和视频描述。`FilmScene.elements/sourceParagraphIds/writerParagraphIds/writerSourceText` 保存编剧对白与来源；只有可靠归属供导演可信上下文，正文编辑后旧结构失效，原始段号不与本地重编段号混用。无需界面把这些结构原样显示给用户。

### 4A-B08 表演结构（已提供）

`FilmShot.performancePlan` 保存人物/本镜表演及绑定来源，`FilmScene.performanceState` 保存未分配项。`binding=scope-order` 代表明确的一一对应兼容，不能宣称语义已核实；动作仍禁止顺序回退。手动回复只写建议卡，确认后才保存该镜与对应场景，保留用户锁及动作字段；视频描述实际消费结构。真实会员表演效果未验证。

### 4A-B11 建议宿主协调（已提供，页面接线进行中）

`createEditorHost` 通过 `capture → preview → apply(id)` 固定基线并核对作品、页面、选中镜头、请求序号和字段锁。宿主注入现有保存通道；延后或保存失败返回 `applied_unsaved`，不能显示已保存。`canUndo/undo` 只处理本作品本页 receipt，保留生成媒体和后续修改。现有常规历史仍待迁移，纯接口不等同于所有页面已接。

### 4A-B08 服装范围（部分提供）

`FilmProject.costumes/costumeRisks` 保存真实 ranges 声明及核对风险。只有未改正文、可靠段号完整覆盖整场时，首帧/视频请求注入服装块；用户外貌/服装/镜头锁优先。场内换装仍返回 `COSTUME_WITHIN_SCENE_CHANGE`，不会按镜头序号猜。没有生成对应服装定妆照，不能声称该功能全流程完成。

### 4A-B11 最小工作台接线（部分已接）

提示词请求实际采用固定镜头基线、字段CAS与既有保存队列，RoleCard.editorDiff供界面呈现。普通撤销/重做已使用按作品页面的字段receipt；纯场/镜头结构走结构CAS，混合结构保守阻止，不恢复旧整作品快照。其他角色确认仍逐项接入，不表示所有建议都可展示差异；Claude JSX未改。

### 4A-B08 导演与表演补充

`shot.directorPlan.segments` 保留镜头意图、站位和对白节奏；合镜保留原段，时长变化只停精确时间，自动表演补写不抹掉空间规则。referenceHints仅是声明，verifiedSourceParagraphIds仅是解析时场归属证据。表演 `performanceState.voiceReviews` 保存不唯一说话人的语气核对事项；多人分别配音和精确音频排程仍未实现。

### 4A-B11 美术确认（已接逻辑，差异呈现待Claude）

`RoleCard.artDiff` 保存固定请求基线的美术事务，确认时核对字段、锁及新增实体，任何冲突原子拒绝。新增地点已有参考图后不能由撤销删除；画风过期与服装风险从最新数据重新派生，不拿旧镜头覆盖新媒体。事务通过现有保存队列落盘并进入当前页撤销。

### 4A-B08 审片意见存储（已接，仅文字）

`FilmProject.reviewReports` 保留逐镜/版本问题及建议，`evidence=text-only`、`visualVerified=false`始终明确；模型seen_frames声明不能改变实际证据。只接受输入中的ID，未知和重复项在rejected中保留。镜头、版本或关联原文改变后旧回包不写入；不自动改提示词、选版或裁剪。

### 4a 文案映射缺口（待 Claude）

固定4fcd198全量web为3872通过、1失败、0跳过；唯一失败是NOTICE_COPY缺101个新增代码。完整code与后端短句已列在 `docs/aivora/4a-notice-handoff.md`，请Claude补最终文案及其表格。后端未改界面文案表，完整性测试保留；此项阻挡阶段全绿与4a发布。

### 4A-B11 单镜与结构建议确认（已提供逻辑，差异呈现待 Claude）

- `RoleCard.directionDiff` 是固定请求基线的单镜动作/表演事务；应用时检查身份、用户锁、原字段和场景状态，拒绝把其他镜头或后续修改覆盖掉。
- `RoleCard.storyDraft={transaction,origin}` 同时保留请求时的编剧/导演结构建议和真正发起请求的页面选择；使用 `applyStoryConfirmation` 原子确认。已知场次的多场导演建议作为一个组合执行，一场冲突则全部不写；未知场次或重复镜头 ID 拒绝。
- `prepareExplicitShotSplitTransaction` 专用于用户确认的台词拆镜：保留同场其他镜头，后续编号独立比较，不把两个新镜头当作整场替换。
- 编剧首次从空作品原文框分场时，原文逐字保存到 `sourceText`；替换旧自动分镜须无人工修改、媒体、任务、音轨和衔接依赖。撤销原子恢复场次及被移除的完整镜头。
- `createEditorPageHistory().recordStory(receipt,origin)` 将撤销留在请求原页面；不持久化全作品快照，不恢复旧媒体。返回旧页面的建议恢复沿用现有作用域缓存。
- `editorCompletionCurrent` 仅限制保存完成提示：原页面或作品版本已变就不显示旧成功/失败提示，已授权的落盘仍继续。美术新增地点被其他页面新引用后，撤销保留该地点并返回冲突。

这些接口没有新增 JSX、CSS 或最终文案；助手差异展示仍由 Claude 接线。全量文案契约缺口及 B01 检查点界面仍阻挡阶段验收。

### B01 最新界面适配与交接

`pro/pipeline-view.ts` 的 `pipelineView(film)` 给出真实状态、目标key、retryable、requiresOutcomeConfirmation、canAcceptReview、canContinue；`pipelineRetryKey` 只解析用户明确选定目标，uncertain须先核对。控制器仍在执行时验证输入和保存归属。实现 `a7b5249`，相关37项回归通过。详细按钮映射、`claude/work@caf50e2` 已实现范围与冲突注意事项见 `docs/aivora/4a-claude-integration-handoff.md`，不要把stepId或旧queueBatch直接当新流水线重试/继续。

### B08 美术设计声明（已提供，非生成素材）

`FilmProject.artDesign/artDesignBaseline` 保存色板、年代、光线、镜头、备用英文描述及模型声明的人物/地点/道具/定妆照计划；与真实portraits/referenceImage分离。新图显示仍取实际生成结果，不能因asset_id存在就显示已完成。由applyArtDraft统一合并，artDiff纳入CAS与撤销。实现 `9e8e9dd`，52项相关与91项工作区回归通过；不要求Claude接新的生成入口。

### B08/B09/B11 后端补修与已提供接口

- B08（`528d850`、`11229ca`）：`FilmProject.writerPlan`、`FilmScene.writerPlan`、`FilmCharacter.writerPlan`保存编剧原声明，导演segments保留sceneDeclaration与原no/seconds，表演people.declarations保存主配角来源及显式null。声明不是实际产物或核实过的时长/覆盖率；不要求新增服装生产或智能体。编剧同一回复的人物/地点随原确认事务一起应用和撤销，有并发修改则整笔拒绝。
- B09（`9b3af94`）：导演策略、审片和视频任务准备进一步迁入actions，工作台现有回调名称与职责保留。合并Claude界面时保留这些函数调用，不复制3j旧函数覆盖。
- B11（`05c59c74ce6a15875a0c39191e8bfb49496d8984`）：`actions/editor-request-context.ts`的`globalEditorRequest(base,selection,request)`已接实际手动编剧与美术请求。选择取请求前快照，仅白名单文本；编剧引用场ID而不重传正文，美术附选中内容但仍处理全项目。无效选择不猜第一场。其他角色原有明确当前场/镜头输入保留，自动流水线不读取UI选择。
- B11（`cdfc2f5`）：提示词保存完成后再次验证作品版本及原页面选择；迟到结果不在新页面提示成功，已授权的保存仍继续。按页撤销及固定建议的before/after数据已提供，统一差异展示仍由Claude接线。

### 3JR-B08 场景参考实际入口（已提供）

`pro/actions/scene-references.ts` 的 `prepareShotSceneReferences(base, shots, host)`
由单镜生成、四张候选和视频生成的业务处理函数调用。只准备所选镜头所属场次，
即使角色提取没有给出 locations，也按真实 sceneId 建立场景描述记录；记录本身不算图片完成。
场景记录先存盘，再生成空镜，再立即保存图片。已有且输入未变化的引用直接复用。
单张失败重试一次，仍失败阻止依赖的镜头生成，任务落 failed；不会伪造引用。
`LOCATION_SOURCE_REQUIRED` 表示场次缺少环境原文或地点，兜底短句为“这一场还没有可用的环境描述。”
Claude 可为该 code 定最终文案。未运行真实会员生成，提供的是本地模拟回归证据。

### 5-3 撤销（历史问题单，当前接线状态见下）

合进 r2（aivora/dev 52c1550）以后，按页撤销会拒绝下面这几种改动，Ctrl+Z 时状态栏写「这次改动不能安全撤销，已保留当前内容。」。这是 `actions/page-history.ts` 有意的限制（`diffEditorStructure` 只收焦点镜头、连续一段、剧本 / 分镜页、没有做好的画面和视频的结构改动），界面没有改它：

1. 分镜卡拖动换位置（5-3-05）：`pro/shot-order.ts` 的 `moveShotBy` 连着调 `moveShot`，整场重新编号，并把这一场的镜头挪到 `film.shots` 末尾，落在 `OUTSIDE_SCOPE_STRUCTURE`。想要：同一场内换顺序可以撤销。最好给一个 `moveShotTo(film, shotId, index)`，只动这一场、不挪到末尾。
2. 多选删除（5-3-06）：一次删几个镜头，落在 `SELECTION_MISMATCH`（只认焦点镜头）。想要：删一组镜头（同一场、可以不连续）能整组撤销。
3. 剪辑页「剪掉」和 Delete（5-3-10）：页面是 `edit`，落在 `PAGE_SCOPE_MISMATCH`。想要：剪辑页剪掉的镜头能撤销。
4. 删掉有画面或视频的镜头（分镜页「删除这一镜」、剪辑页「剪掉」）：落在 `DEPENDENT_WORK_EXISTS`。想要：撤销时把镜头连同它的画面和视频一起放回（`removeShot` 只是从作品里拿掉这一镜，文件是否还在请后端确认）。

以上是 r2 时的历史问题，不再代表当前后端能力：`0d8bcbb` 已提供同场排序、多选删除、剪辑删除及带媒体镜头恢复，`actions/page-history-user-shots.test.ts` 有对应回归。`8dde090` 补齐字段撤销/重做的标签及状态栏部分冲突提示。

第二轮收尾前界面有过时兜底：剪辑页 Delete 先确认，再按一次才剪；多选删除写「删了不能撤回」。本轮已更新这些过时否定提示及确认，并补宿主组合测试验证拖放/多选删除/按键剪掉后 Ctrl+Z 的真实接线；不能再把这三项统一写成「等后端支持」。`shot-order.ts` 中关于不能撤销的注释也待同步。

5-3-06 的多选生成入口已经由 `onBatchShots={queueBatch}` 接到确认表，并在确认后调用 `submitGeneration(rows)`；批量时长也已直接修改所选镜头。现有宿主测试到打开生成确认表为止，尚不能证明所选范围的生成提交及旧版本保留全部正确，仍需定向核对。

### 5-3-12 剪辑预览全屏（云端接手）

剪辑页预览使用 `pro/PreviewFullscreen.tsx`：双击画面或按 F 切换全屏，Esc 退出，
也可点画面右上角的「全屏」按钮。原来的播放器、播放位置、声音和控制条保留在同一个容器，
不另建播放器。不在输入框、菜单、对话框中抢占 F；切到声音、字幕或其他页面后释放快捷键。
全屏由浏览器实际状态驱动，拒绝进入时给简短中文提示；设置的快捷键表已同步。

无需新增后端接口或修改作品文件。安全框 `91e838f` 已由 `ce7bea5` 合入云端接手分支，
与全屏实现无文本冲突；`.preview-player` 下保留 `.screen` 和 `.ctrl`，安全框仍在 `.screen` 内，
进入原生全屏时随同原播放器和控制条一起显示。远端主线、发布与安装包状态另行核对。

验证（云端复核）：显示组件全部 6 项测试通过；工作台按
`fullscreen|preview|sound|play|mute|frame|cut` 筛选的宿主定向回归 16 项通过、121 项未选择，
合计 22 项通过，不能称为完整工作台测试通过。studio-web `tsc -b --pretty false`、
全屏组件及测试和工作台及测试的定向 ESLint、组件及测试/工作台/CSS/本文的 Prettier 检查均通过。
测试里的全屏 API 模拟通过辅助函数更新状态，避免触发 `no-this-alias`。

总控独立使用系统 Chromium（`chromiumSandbox: true`）在 Vite 样例工程验证：
双击画面进入原生全屏、Esc 退出、F 进入/F 退出、按钮进入/Esc 退出全部通过，
页面 `pageerror` 为 `[]`。此结果验证浏览器原生 Fullscreen API；Electron、会员生成、
安装包尚未在本项验收，不将其计为通过。

合入安全框后的验证（`ce7bea5`）：5-3宿主目标16项通过、123项未选择，全屏及撤销相关
四文件24项通过，合计40项；类型、目标 ESLint、Prettier 均通过。系统 Chromium 保留沙箱，
1280×800/1920×1080与16:9/9:16四种组合的安全框开关、画幅比例、双击全屏、Esc退出、
F进入/Esc退出全部通过；确认 `.safe-guide` 与 `.ctrl` 同在全屏DOM，覆盖层不接收指针事件，
正常窗口安全框开关和全屏内退出按钮未被遮挡，四组 `pageerror=[]`。使用内置样例数据，
未验证真实生成成片播放、会员调用或Electron；不是全页布局走查通过的声明。

### 5-3 第二轮界面收尾（已集成 `a124c12` / `29fdb8d`）

frontend_round2（Sol medium）已移除同场多选删除与剪辑 Delete/Backspace 的过时否定提示和二次确认，分镜删除及剪辑属性说明 Ctrl+Z。`ProWorkspace.undo-interactions.test.tsx` 的 6 项宿主回归验证拖放、非相邻批删、Delete/Backspace/剪掉后恢复媒体路径、两个旧版本与音轨；输入框、菜单、对话框及未选片段保护仍通过。动作层 7 项与更新后的旧宿主 2 项通过。系统 Chromium 保留沙箱，1280×800、1920×1080 两窗口的拖放/批删/Delete→Ctrl+Z 通过，pageerror=[]。

生成确认按钮已按后端接口接到 `confirmBatchGeneration`，业务实现和生成范围/取消/并发回归归后端。跨场结构、后改字段及依赖冲突仍由既有动作层拒绝，不能把这次用户同场镜头操作的撤销扩展成所有删除都可恢复。工程媒体记录已核验，真实文件、Electron、会员及安装包未验；完整集成检查由总控执行。

### 3JR-U06 原始回复保存与排查导出（已集成 `61f68c5`）

`ReplyCaptureSettings.tsx` 已作为独立显示组件接入「账号 → 设置 → 排查」。主工作台仅增加组件 import 和渲染，`getFilm` 读取 `filmRef.current`，结果由 `onNotice` 进入状态栏；不复制会员或采集业务代码。默认关闭，切换调用真实 `setCaptureEnabled`，关闭会清除本机记录。仅用户点击「导出排查文件」后调用 `captureFile(film)`，无作品、关闭状态、空或无匹配回复均给中文提示，不制造空 JSON。

导出等待期间保存作品 ID、原文及按顺序的场次 ID/正文作为核对依据；等待结束后从 getter 重新读取，任一变化都不下载。关闭再开启或组件卸载也取消旧下载。文件通过 JSON Blob 与下载链接写到浏览器下载位置，链接随后移除，Blob URL 在下一任务释放；不自动上传。后端的工程/正文/场次 hash 及采集 epoch 保护由后端第二轮记录说明。

验证：独立组件/宿主入口 11 项通过，联合既有采集测试共 16 项通过；web `tsc -b --pretty false`、组件及测试目标 ESLint、Prettier 通过。系统 Chromium 保留沙箱，在 1280×800 真实点击设置入口，验证默认关闭、打开、手动下载 JSON、下载内容的原文摘要匹配、关闭清空，`pageerror=[]`。脚本 `.aijian-dev/reply-capture-check.mjs` 使用带归属 scope 的本机合成回复，未调用真实会员，不能作为真实导演回复采集或 Electron 下载验收。全仓集成、远端及发布状态由总控记录。

### 3JR-B11 采集归属接口（后端）

`captureScope(film)` 返回 `Promise<CaptureScope | null>`，其中 `CaptureScope = {projectId, sourceSha256, scriptSha256}`；projectId 使用本机 `film.id`，原文 hash 针对 `sourceText`，场次 hash 针对按顺序的 `[scene.id, scene.text]` 数组。仅开关开启的导演/动作请求计算，原文和上下文不写入采集存储。`recordAgentReply(agent, context, instruction, reply, scope?, requestEpoch = captureEpoch())` 缺 scope 不采集，旧无归属记录清理。`completeMembershipAgent` host 新增可选 `captureFilm: () => CaptureFilm | null`，手动及流水线都读取当前工程；请求开始和回包后核对身份/输入与关闭清理 epoch。

`captureFile(film)` 仍返回 `{name,text,scenes}|null`，film 需要完整的 id/sourceText/scenes/shots/title；按三重身份筛选再组装，正文不匹配返回 null，关闭或清空会使进行中的旧导出失效。界面已经传完整 film，接口返回和下载行为不变。后端 35 项与设置 11 项联合 6 文件 46 项通过，具体证据见 `docs/aivora/3jr-backend-verification.md`；已由 `d0f548b` 接入当前接管分支并推送，真实会员未验。

### 4B-U09 无字幕版本补做入口（已集成当前接管分支 `c3e21e7`）

独立 `CleanCopyRepair` 纯显示组件已接入分镜当前镜头属性、单镜版本页与导出受阻三处。单镜依据 `shotsNeedingCleanCopy(film)` 检查真实所选 take：有台词、有完成视频、没有 `cleanVideoPath` 才显示，切换到已有无字幕副本的版本后入口消失。组件不调用生成接口，主工作台通过后端 `repairCleanCopies(shotIds|null)` 调度，`cleanCopyBusy` 控制补做按钮及导出按钮，避免半成品导出。

导出批次入口仅在 `EXPORT_SUBTITLES_BAKED` 受阻状态下出现，显示当前待补数量；部分成功后按最新工程更新剩余数。成功、缺原合成记录或失败均保留准确说明，不暴露路径和原始错误，不自动重新生成视频，也不自动再次导出。补做使用原合成记录，保留原视频、其他版本及版本选择。工程和选版 stale 保护由后端提供，详见后端验证记录。

验证：显示组件 3 项、新增宿主组合 2 项通过；联合既有 clean-copy 测试共 9 项通过。web `tsc -b --pretty false`、新增组件/测试的目标 ESLint、Prettier（含 CSS）通过。系统 Chromium 保留沙箱，1280×800、1920×1080 × 单镜/导出两流程共四组合通过，`pageerror=[]`：切换已有副本版本隐藏入口、切回缺副本版本手动补做、导出受阻后批量补做 2→部分成功剩 1，以及不自动导出。脚本 `.aijian-dev/clean-copy-ui-check.mjs` 使用替身 IPC，不能作为真实会员、真实视频或完整 Electron 链路通过的声明。总控另行执行的真实本机服务验证与本界面证据分别记录，完整集成和发布由总控登记。

### 4B-B12 无字幕补做宿主与过期保护（后端）

`repairCleanCopies(shotIds: readonly string[] | null): Promise<void>` 为本机业务handler，null按当前所选版本中缺副本的镜头计算；`cleanCopyBusy`按工程防重入，`cleanCopyBlocked`绑定导出受阻时的工程与字幕模式。计费准备后继续按原镜头/takeId/videoPath核对当前选择，不将过期目标重定向到新版本。helper新增 `stale` outcome，明确已跳过变化的作品/版本，不报告done；缺原合成记录继续返回missing，不自动生成。

helper host的可选 `persist(snapshot)`逐镜保存已实际应用的written快照；宿主使用既有队列和本项最后live对象guard，保留切作品前已成功结果，拒绝同工程较旧快照覆盖后改内容。旧工程浏览器延迟写回后恢复当前可见工程activeId；失败中断明确保留已保存版本。后端22项加界面5项，共5文件27项实跑通过，web类型/目标静态通过，具体证据见后端验证记录；已集成当前接管分支 `c3e21e7`，不代表已合远端 dev，也不代表真实会员或 Electron 验收。

### 接管分支 CI 提示文案契约修复（已集成并推送 `d8b15eb`）

总控在 GitHub Actions 公开页面核实 `a6d8b0f` 的 run `42177470800`：Linux/Windows 均失败，`film/notices.test.ts:109` 报新增静态提示「所选镜头已经变化，请重新选择后生成。」落入 `OPERATION_STATUS`。后端已补齐精确业务分类与本轮新增静态提示的回归，界面已补 `next/wiring/noticeCopy.ts` 的 14 个最终中文映射，分别处理生成选择失效/重复生成、无字幕补做结果和排查文件下载；`docs/design/copy-zh.md` 仅追加对应 14 行索引，原 118 条历史与 106 条既有新增记录及其完整性断言保留。新增 16 项纯显示契约覆盖逐码中文、部分成功原因及排查导出数量，不把不明失败归入通用业务码。

本地复跑 `film/notices.test.ts`、`next/wiring/noticeCopy.test.ts`、`next/wiring/statusNotice.test.tsx` 共 113 项通过，原静态提示 CI 失败已在本地复现后修复；界面目标 ESLint、Prettier、diff 检查通过。后端另报包含新增宿主路径的 6 文件 132 项通过。以上是修复时的定向记录；该修复已集成并推送 `d8b15eb`，当前全量检查及远端结果见下，不代表已合入 dev。

### 当前 CI 与本地全量验证位置

上一轮产品修复提交为 `d8b15eb98358406d90f045e983871708be0137a2`，尚未合入 dev。总控核实 [run 42182358298（#683）](https://github.com/chen11-A/aijian-studio/actions/runs/42182358298)：[Windows job 127774675497](https://github.com/chen11-A/aijian-studio/actions/runs/42182358298/job/127774675497) 在 Test 步骤 exit 1（该步骤 27 秒，job 总计 3m22s），公开页没有具体失败注释；Linux 仍在运行，不能将本地通过写成远端全部通过。

历史对照：旧 dev `a4531da` 的 [run 42157717806（#677）](https://github.com/chen11-A/aijian-studio/actions/runs/42157717806)，总控已直接核实 [Windows job 127695727475](https://github.com/chen11-A/aijian-studio/actions/runs/42157717806/job/127695727475) 在 Test 失败（3m6s），[Ubuntu job 127695727812](https://github.com/chen11-A/aijian-studio/actions/runs/42157717806/job/127695727812) 成功（49m39s）。两次 Windows 失败原因是否相同尚不明确。

本地基于 `d8b15eb` 的 TS 全量：桌面 115 文件 2031 项、renderer 377 文件 4662 项、Node 媒体 17 项及 QC 11 项全通过；桌面分支覆盖率 91.29%，renderer 87.45%。总控 `contracts:check → lint → typecheck → build` 整串 exit 0，生产依赖审计和故障证据 verify 通过。Python 全量已退出 0：5166 项通过、6 项跳过；行覆盖率 92.14%、分支覆盖率 83.61%，达到原定门槛。独立故障注入 66 项通过、4 项跳过；媒体契约复现、43 文件证据哈希及故障证据复现均退出 0。界面使用 Windows 单 worker 配置复核 GUI/提示相关 8 文件 141 项通过，但仍在 Linux 运行时，不能作为 Windows 原生验证。

后端（Sol medium）已交付最小 CI 失败注释诊断补丁，总控审查及 8 项回归、真实 pnpm 启动探针、完整 lint 均通过，已推送诊断提交 `5e7f838`，[CI #684](https://github.com/chen11-A/aijian-studio/actions/runs/42185037044) 已启动，正核对远端结果；界面（Sol medium）已完成只读诊断与进度文档更新，未改产品代码。B13/U06 导出真实进度/取消仅有只读显示契约，未开始开发。诊断补丁保留原 pnpm test 命令、输出、退出码及所有覆盖率门槛，独立诊断回归也接入 CI。未涉及新的产品功能、真实会员调用、Electron 验收或 dev 合并。

诊断后续：#684 的 Windows 在新增自测步骤失败，原 Test 未运行；后端已给自测补上不依赖 pnpm 环境的失败摘要，9 项本地回归及隔离失败夹具通过。另修正经本地目录别名复现的 CLI 入口静默跳过，不能据此判定 Windows 原生故障原因。总控准备推送新一轮定位。

CI #685 原生 Windows 摘要定位到诊断自测 32/57 行两处路径字符串比较（ERR_ASSERTION）。后端仅修测试假定：以 BigInt 文件身份及真实 Node 执行返回参数验证入口，保留命令、参数数量、test 参数及别名 CLI probe。9 项本地自测、目标 lint/格式和真实 pnpm 探针均通过；原产品 Test 尚未运行，等待新一轮 Windows 结果。

CI #686：Windows 诊断自测已通过，原 Test 实际执行 35 秒后失败于媒体中文工具路径测试 303/307 行；后端已独立复现裸名查找漏 .exe，正在修正 fixture。此次并非 GUI 测试失败，后续测试尚未执行，不能记为全部原生 Windows 通过。

媒体 fixture 修正已交付：Windows 裸名查找增加 .exe 候选，显式 Windows 路径可识别；中文工具副本带 .exe 并复制，POSIX 保留符号链接。原视频、静音、LUFS、峰值和归档断言、阈值、skip 不变。Linux 媒体包 17 项通过、0 跳过，目标 lint/格式及原/新查找函数前后对照通过；等待总控推送后的 Windows 复验。

当前媒体修正已推送 dfcf8db，CI #687 双平台运行中。产品修复基线 d8b15eb 的 Linux job127774675417 已全部成功；本轮新提交尚不能记为双平台通过或合 dev。当前源码冻结，总控跟进 CI；界面只读准备 5-3 剩余项与下一批任务。

只读 Chromium 补查已归档：dfcf8db、两窗口×两画幅、48/48 页面/状态到达、pageerror=0；实际全屏/安全框、排查下载/关闭清空及补做6→3未自动导出均操作。UI-LAYOUT-01：单镜TakePicker占旧四列网格首列，1280下卡宽73px、标签86px/按钮78px越卡；已列下一批首项，未修改源码。报告位于当前云环境忽略目录ui-page-audit；未覆盖首页/库/新建/作品设置/场景道具、AI异常、真实会员/Electron/完整导出，正式CI布局门未接。

CI #687 当前候选 dfcf8db：Linux job127792946853已全部成功（Test 08:31:54→09:21:15，构建及最终生成文件一致性均成功）；Windows仍在执行，尚未合dev。

最终主批次验收：dfcf8db 的CI #687整体Success，Linux job127792946853/Windows job127792946832均succeeded，完整Test/故障注入/证据/审计/构建/生成一致性全部成功；总控准备按授权合dev。UI-LAYOUT-01的临时样式12组合验证通过，仓库CSS尚未改；主批次合入后实际应用并复验，其他新功能未开工。

主批次已纳入本次 --no-ff 的 dev 合并提交：产品源码与双平台CI整体Success的dfcf8db完全一致，仅增加交接与验收文档；合并提交的新CI另行运行。UI-LAYOUT-01实际CSS补丁尚未应用，下一步由界面执行并复验12组合。

UI-LAYOUT-01接续实际交付：主批次已推送dev@6c247e7；仅pro.css新增4行让.cands的直接TakePicker跨满网格。无候选样式注入的真实Vite CSS复验12/12（1/2/3版×两窗口×两画幅）通过，标题/标签/按钮、实际选版持久化及其他take元数据保留均已验，前端生产构建exit0。CSS源SHA256=aa60e4c2158a5dfb15c9f4ad878a663b1c0ee9a548d90c1444e5abb17e94e52c；忽略目录ui-layout-fix保存实际报告/截图/补丁，base/candidate证据未改。本次局部变更交总控补充合dev，新自动CI另行核对，不能冒充已取得新提交双平台结果。其他新功能未开工。

最终接入：主批次dev合并6c247e7已远端核对；局部CSS实现da15683经 --no-ff 合并0f8f4bd已推送dev并读回。实际CSS哈希及12组合/生产构建证据与合入源码一致；后续仅更新进度文档。完整双平台绿灯来自代码基线CI #687，补充CSS及合并提交的新CI单独运行，未把旧run冒充新结果。两位代理当前批次均已交付，其他新功能尚未开始。
