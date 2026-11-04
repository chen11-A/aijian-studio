# next 组件接线清单

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
