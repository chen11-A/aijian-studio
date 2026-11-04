# 3j 逻辑与界面交接

此目录当前只有 GPT 编写的交接文档，不代表 Claude 的组件 ZIP 已导入。用户已上传组件 ZIP（预期 SHA-256 `0a73fd2f9c0ee88a222fc45f9db67f76c025f12aff8a12254042daa5a23ee394`、42 文件）与 `aivora-design-v2.zip`。两个文件下载到本执行器失败，按指定目录重试一次仍失败；没有可读字节可验证。TaskCenter.tsx、qcReport.ts 的实物未核对，也未假定 design-v2 就是 3j 界面交付包。

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
