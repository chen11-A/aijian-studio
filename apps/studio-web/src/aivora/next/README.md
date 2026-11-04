# next 组件

按 `docs/design/` 第二版设计稿做的 6 个独立 React 组件，加上把 `project.json` 转成它们
props 的适配层 `adapters/`。软件里还没有任何地方引用它们。数据从 props 进来，操作通过回调
交给调用方；组件和适配层都不调用 IPC（`window.aijian`）、网络或本地存储。

接到专业工作区的哪个面板、由什么事件触发、还缺哪些接口，见 `INTEGRATION.md`。

## 怎么用

- 从 `./index.ts` 引入组件、类型和换算函数。
- 组件要放在 `.pro-root` 里面，颜色和字号变量都来自 `../pro/pro.css`。
- 组件根节点 `.nx-root` 撑满父元素的高度，父元素要给定高度。长列表在组件内部滚动，
  整页不滚动。

## 组件

| 组件            | 做什么                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `TaskCenter`    | 任务列表和进度；整屏最多一个主按钮；意外关闭后的恢复横幅：「查一下，再接着做」→「接着做 N 段」 |
| `ExportCheck`   | 读 aivora-qc 的检查报告；每条问题一个「去修」，底部一个「直接导出」；`detail` 只在「高级」里   |
| `SoundPanel`    | 默认只有配乐情绪和 0–100 的这一场音量；「细调」里是台词、环境声、音效、配乐四层音量            |
| `TakePicker`    | 同一镜头 1–3 个版本并排，AI 选的那版标「AI 选的，可换」，选中后回调                            |
| `SubtitleStyle` | 4 套字幕样式，横屏和竖屏同时预览，竖屏标出平台按钮会挡住的区域                                 |
| `CoverEditor`   | 封面片名、副标题和「AI 生成」开关（默认开），竖屏和横屏封面同时预览                            |

### TaskCenter

- props：`title`、`tasks`、`recovery`、`paused`、`loading`、`error`。
- 回调：`onCheck`、`onResume`、`onPause`、`onRetry(taskId, "same" | "suggestion")`、
  `onRetryFailed`、`onRemove`、`onReload`、`onOpenStoryboard`。
- 每个任务：`id`、`shotId`、`title`、`version`、`kind`（`video` / `image` / `voice` / `lipsync` /
  `export`，后两种有这类任务时才出现在筛选里）、
  `status`、`attempt`、`reason`、`suggestion`、`waitedSeconds`。
- `status` 取值：`queued`、`running`、`uncertain`、`requeued`、`blocked`、`failed`、`done`。
- `blocked` 是没发出去的任务，比如没登录时排下的。它放在「要你处理」里，可以「再试一次」，
  不写「第 N 次」，也不说用了额度。
- 名字先用 `title`；没有 `title` 才从 `shotId`（形如 `scene-2-shot-22`）推出「第 2 场第 22 个镜头」。
- 正文写「第 2 场第 22 个镜头 · A 版」，任务 id 只用小号等宽字显示。

`recovery.phase` 表示意外关闭后的恢复进度：

- `needs-check`：软件关闭时有任务在跑，不知道结果。
- `checking`：正在查。
- `checked`：查完了，`found` 是找回的数量，`lost` 是没发出去的数量。

只要有 `recovery`，排队就按暂停处理。

主按钮按下面顺序取第一个成立的：

1. `loading`：没有主按钮。
2. `error`：「重新读取」。
3. `needs-check`：「查一下，再接着做」，调用 `onCheck`。
4. `checking`：「正在查…」，不能点。
5. `checked` 或 `paused`，并且还有排队的任务：「接着做 N 段」，调用 `onResume`。
   - N 是 `queued` 和 `requeued` 的数量。
   - 单位按种类分：视频「段」、图片「张」、配音「句」，混在一起用「个」。
6. 其他情况没有主按钮。

没有任务时，传了 `onOpenStoryboard` 就显示「去分镜」，这是那时唯一的主按钮。

### ExportCheck

- props：`report`（解析后的 JSON）、`checking`、`error`、`shots`、`fileName`。
- `shots` 是每个镜头在成片里的起止秒，用来把问题的时间换成「第 N 场第 M 个镜头」。
  每一项可以带 `label`，写了就用它当镜头名；没写才从形如 `scene-2-shot-17` 的 id 推出来。
- 回调：`onFix(issue)`、`onExport()`。
- 「去修」只调用 `onFix(issue)`，由调用方按 `issue.action` 打开要改的地方，组件不改任何东西。
- `block` 的问题放在「要先处理」，`warn` 的放在「建议看看」。
- 「直接导出」除了检查中以外都能点。还有要先处理的问题时，按钮下面会说明这些问题会留在成片里。
- 问题的 `detail` 和编号（`id`）只在每条问题的「高级」里显示。
- 报告里的测量（有没有音轨、整片响度、真峰值、`assumptions`）在右侧的「高级」里。

### SoundPanel

- props：`sceneTitle`、`durationLabel`、`mood`、`moodNote`、`music`、`master`、`lanes`、
  `laneNotes`、`duckMusic`、`defaultFineOpen`。
- 回调：`onMoodChange`、`onMasterChange(volume, db)`、`onLaneChange(lane, volume, db)`、
  `onDuckMusicChange`、`onPreview`。
- `mood` 取值：平静、温暖、不安、悬疑、紧张、激烈、悲伤、释然。

还没有的东西不用编一个值，传「没有」：

- `mood` 传 `null`：八个都不选中，下面写「还没有选这一场的配乐情绪。」。`moodNote` 是写在
  情绪下面的一句说明，比如导演写的情绪不在这八个里。
- `music` 的 `reason` 可以不写，不写就不显示「为什么选它」。没有配乐时写「这一场还没有配乐。」。
- `master` 传 `null`：不显示滑块，写「还不能单独调。」。
- `lanes` 里没写的层不显示滑块，写 `laneNotes` 里的说明；没有说明就写「这一场没有…」。
- 不传 `onDuckMusicChange` 就不显示「有人说话时，配乐自动变小」的开关。
- 放进窄的侧栏（宽度不到 560px）时，四层滑块排成两行两列。

### TakePicker

- props：`shotLabel`、`shotCode`、`description`、`takes`、`aiChoiceId`、`selectedId`、`aspect`。
- 回调：`onSelect(takeId)`。
- 超过 3 个版本时只放前 3 个。
- 不传 `selectedId` 时用 AI 选的那版。
- 还在生成或没做成的版本不能选。
- 有两个以上版本时，也能按数字键选，比如 1、2、3。

### SubtitleStyle

- props：`value`、`sampleLine`、`sampleSource`、`styles`、`tallLineLength`（默认 12）。
- 回调：`onChange(styleId)`、`onApply(styleId)`。
- 内置样式：`white` 清楚白字、`bar` 底条字幕、`film` 电影字幕、`yellow` 醒目黄字。这四个 id 和
  GPT 那边的字幕样式 id 一致（任务书「字幕样式 id 统一」）。
- `value` 不是任何一套的 id 时，表示还没选：一套都不选中，预览按清楚白字画，
  「用这个样式」不能点，旁边写「先在左边选一套样式。」。

### CoverEditor

- props：`title`、`subtitle`、`aiMark`、`defaultAiMark`（默认 `true`）、`backgroundUrl`。
- 回调：`onTitleChange`、`onSubtitleChange`、`onAiMarkChange`、`onSave`。
- 传了 `aiMark` 时开关由调用方控制，不传时组件自己记。
- 片名最多 20 个字。没有片名时「用这个封面」不能点。

## 适配层

`adapters/` 里都是纯函数。输入是解析后的 `project.json`：桌面版把每一集存成
`<userData>/films/<seriesId>/episodes/<episodeId>/project.json`，格式是 `film/project.ts`
的 `FilmProject`。输出是组件要的数据 props，回调由调用方补上。

| 函数                                        | 给哪个组件    | 还要什么                                     |
| ------------------------------------------- | ------------- | -------------------------------------------- |
| `taskCenterData(project, options)`          | TaskCenter    | `fromDisk`、`canLookUp`、`paused`、`now`     |
| `exportCheckData(project, report, options)` | ExportCheck   | 检查报告；`checking`、`error`、`clipSeconds` |
| `soundPanelData(project, sceneId)`          | SoundPanel    | 场的 id                                      |
| `takePickerData(project, shotId, options)`  | TakePicker    | 镜头的 id；`mediaUrl`                        |
| `subtitleStyleData(project, options)`       | SubtitleStyle | 屏幕上选了、还没保存的样式                   |
| `coverEditorData(project, options)`         | CoverEditor   | `mediaUrl`                                   |

返回值是 `{ ok: true, props, missing }` 或 `{ ok: false, empty, missing }`：

- `empty` 是该显示的空状态，一个标题加一句说明，比如「这个镜头还没有版本」。
- `missing` 列出 `project.json` 里缺的或读不了的字段，写成路径，比如 `shots[2].seconds`。
  它给日志和排查用，不上屏幕。

规则：

- 不经过 `upgradeFilm`，因为它会补默认值，比如没有场时凭空加一个占位的场。
- 缺的字段读成空，不补值。镜头名用存下来的场号和镜头号，不从 id 猜。
- 「正在用这一版」和导出包含哪些镜头，与 `chosenExport` 用同一条规则。
- `project.json` 里没有的东西不出现在 props 里，组件显示「还没有」：AI 选的版本、这一场的
  音量、字幕样式、封面设置。

## 检查报告的格式

`qcReport.ts` 按 `packages/aivora-qc` 的 v1 报告格式写了类型和校验，组件不依赖那个包。

- 格式来源：`gpt/aivora-qc` 分支，提交 `7c0eea5`。
- 这个包不在当前分支上。

报告顶层：

- `schemaVersion: 1`
- `media {duration, width, height}`
- `audio {present, integratedLufs, truePeakDbtp}`
- `assumptions`
- `issues[]`

每条问题必须有：

- `id`
- `severity`：`warn` 或 `block`
- `time`、`end`：秒
- `timeLabel`
- `type`
- `message`
- `suggestion`
- `action`：`trim`、`regenerate_shot`、`add_audio`、`adjust_volume`、`edit_subtitle` 或 `none`
- `detail`：对象

可选字段：

- `scope: "program"` 表示整片的问题，比如响度、真峰值、没有音轨。界面上写「整片」。
- `cue`、`nextCue`、`estimated` 有就保留。

`type` 不在已知列表里时照样读，标签写「其他」。

`readQcReport` 遇到下面的情况会拒绝整份报告，界面显示「检查结果读不出来」和中文原因：

- 版本不是 1。
- 缺少成片或声音的测量，或缺少 `assumptions`。
- 某条问题缺必填字段。
- `action` 不认识。

缺了的字段不补默认值。

## 音量和 dB

界面上只有 0–100，不出现 dB 或分贝。换算用 `../film/audio.ts` 的 `volumePercentToDb` 和
`dbToVolumePercent`，和时间线上「音乐音量」滑块是同一套：在下面几个点之间按直线换算，
结果保留一位小数。

| 音量 | 增益   |
| ---- | ------ |
| 100  | 0 dB   |
| 70   | −3 dB  |
| 50   | −6 dB  |
| 20   | −14 dB |
| 0    | −40 dB |

软件把 −40 dB 及以下当作静音。

四层的默认值：

| 层     | id         | 音量 | 增益   |
| ------ | ---------- | ---- | ------ |
| 台词   | `dialogue` | 100  | 0 dB   |
| 环境声 | `ambience` | 50   | −6 dB  |
| 音效   | `sfx`      | 70   | −3 dB  |
| 配乐   | `score`    | 20   | −14 dB |

- 默认值换出的增益就是 `../film/audio.ts` 里的 `AUDIO_LANE_GAIN_DB`，`helpers.test.ts` 会核对。
- 层的 id 和顺序与 `../film/audio.ts` 里的 `AUDIO_LANE_ORDER` 一致。
- 回调同时给音量和 dB，调用方不用自己换算。

## 样式规则

- 只用 `../pro/pro.css` 里已有的变量。
- `--accent-strong` 在 6efe12d 的 pro.css 里已经有了。仍然写成
  `var(--accent-strong, var(--accent))`，换成没有这个变量的 pro.css 也有颜色。
- 不写字面颜色，比如十六进制、`rgb()`、`white`、`black`。
  - 需要浅一点的底色时，用 `color-mix()` 混已有变量。
  - 主按钮上的字用 `var(--text)`。
- 所有选择器都以 `.nx-root` 开头，示例页的以 `.pro-root.nx-story` 开头。
  这样能盖过 `.pro-root button` 和 `.pro-root *` 的重置，也不影响软件里其他界面。

`rules.test.ts` 检查上面几条，还检查：

- 没有调用 `window.aijian`、`ipcRenderer`、`fetch`、`XMLHttpRequest`、`localStorage`、
  `sessionStorage`、`WebSocket`。
- import 只用 react 和 next/ 里的文件。例外：`volume.ts` 用 `../film/audio`；`adapters/` 用
  `../../film/` 里的 `audio`、`operations` 和 `project`。

## 示例页

仓库里没有 Storybook，示例页用 Vite 开发服务器打开，不进软件的构建。

```sh
pnpm --filter @aijian/studio-web dev
```

然后打开下面的地址：

```text
http://127.0.0.1:5173/src/aivora/next/stories/index.html?story=task-center
```

- `story` 可以是 `task-center`、`export-check`、`sound-panel`、`take-picker`、`subtitle-style`、
  `cover-editor`。
- `state` 选示例状态，页面顶部也有链接。
- 每页都有一个「按 project.json」状态：拿 `adapters/sampleProject.ts` 里的示例作品走一遍
  适配层，看真实格式的数据画出来是什么样。这个状态不加载图片。

每个示例页顶部都标着「示例数据」：

- 作品、镜头、任务和检查结果都是编的，写在 `stories/sampleData.ts`、
  `adapters/sampleProject.ts` 和各个 `*.story.tsx` 里。
- 点按钮只会在顶部写一句「刚才点了：…」，不会真的去做。

## 布局检查

`stories/check-layout.mjs` 用 Playwright 打开每个示例页的每个状态，再打开整个工作区的八个页面：首页、剧本、角色与场景、分镜、单镜、剪辑、导出对话框、任务中心。工作区里放的是测试小说《晚照书店》（`adapters/novelProject.ts`）：三场、七个人、28 个镜头、149 秒。还没有生成过画面，画面位都是空的。每个页面检查：

- 整页不滚动。
- 没有东西超出窗口。
- 没有内容被截断。单行省略号除外。
- 文字和控件不重叠。画在画面上的字幕和标识除外（`.nx-frame` 或带 `data-layer` 的元素里）。
- 字号不小于 12px。
- 按钮都有名字。
- 控制台没有报错。

有「高级」的页面，展开以后再查一遍。

先开开发服务器，再在仓库根目录运行：

```sh
AIVORA_CHROMIUM=/path/to/chrome AIVORA_SIZES=1280x800,1920x1080 \
  node apps/studio-web/src/aivora/next/stories/check-layout.mjs
```

`AIVORA_SIZES` 不写时只查 1280×800。`AIVORA_ONLY=stories` 或 `pages` 只查一半；`AIVORA_SHOTS=文件夹` 把工作区每个页面截图存下来。

## 验证

在仓库根目录运行：

```sh
pnpm --filter @aijian/studio-web exec tsc -b --force
pnpm exec eslint apps/studio-web/src/aivora/next
pnpm exec prettier --check apps/studio-web/src/aivora/next
pnpm --filter @aijian/studio-web exec vitest run src/aivora/next
pnpm --filter @aijian/studio-web test
```

最后一条跑 studio-web 的全部测试，并检查覆盖率门槛。

## 文件

| 文件                                  | 内容                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| `*.tsx` / `*.css`                     | 6 个组件和各自的样式                                           |
| `*.test.tsx`                          | 组件测试，用 vitest 和 @testing-library                        |
| `*.story.tsx`                         | 示例页，用假 props                                             |
| `next.css`                            | 共用的按钮、面板、标签、横幅、输入框、开关和画面占位           |
| `qcReport.ts`                         | 检查报告的类型、`readQcReport`、问题类型的中文名、`detailRows` |
| `volume.ts`                           | 音量和 dB 的换算、四层默认值                                   |
| `shot.ts`                             | 镜头 id 换成「第 N 场第 M 个镜头」、时间和时长的写法           |
| `radio.ts`                            | 单选组里方向键的移动                                           |
| `stories/`                            | 示例页外框、示例数据、入口页面和布局检查脚本                   |
| `adapters/*.ts`                       | 适配层：读 `project.json`，给出每个组件的数据 props            |
| `adapters/sampleProject.ts`           | 示例作品和它的示例检查报告，给测试和示例页用                   |
| `adapters/novelProject.ts`            | 测试小说《晚照书店》做成的作品，给工作区的布局检查用           |
| `adapters/*.test.ts(x)`               | 适配层的测试，每个都用适配结果把组件画一遍                     |
| `INTEGRATION.md`                      | 接线清单：放在哪、什么事件、还缺什么接口                       |
| `helpers.test.ts`、`qcReport.test.ts` | 换算函数和报告校验的测试                                       |
| `stories.test.tsx`、`rules.test.ts`   | 示例页的测试，和上面「样式规则」的检查                         |

## 和 aivora-next-components.zip 相比

6efe12d 上没有 `next/`，所以这次整个目录一起给。和上一个 zip 相比改了这些：

- `volume.ts` 改用 `film/audio.ts` 的换算。音量 0 现在是 −40 dB，以前是 `-Infinity`；
  70 现在正好是 −3 dB，以前是 −3.1 dB。
- `SoundPanel`：情绪、这一场的音量和各层都可以是「还没有」，见上面 SoundPanel 一节；
  窄的侧栏里四层滑块排成两行。
- `TaskCenter`：加了 `blocked`；名字先用 `title`；认识 `lipsync`（口型）和 `export`（导出）两种任务，
  和 3J-B17 的 `TaskItem` 一致。
- `ExportCheck`：`ShotSpan` 加了 `label`；没有要先处理的问题时，标题写「没有要先处理的」，
  不再写「其中 0 处要先处理」。
- `SubtitleStyle`：没选样式时不能应用；样式 id 改成 `white`、`bar`、`yellow`、`film`（3J-U16）。
- `rules.test.ts`：6efe12d 的 pro.css 有了 `--accent-strong`，这条检查改成「每次用都带回退」；
  import 的例外放开给 `volume.ts` 和 `adapters/`。
- `next.css` 开头的注释跟着改了。
- 示例页每页加了「按 project.json」状态；顶上那句说明改短了，状态多时也放得下。
- 新增 `adapters/` 和 `INTEGRATION.md`。
