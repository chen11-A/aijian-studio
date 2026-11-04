# next 组件

按 `docs/design/` 第二版设计稿做的 6 个独立 React 组件。软件里还没有任何地方引用它们。
所有数据从 props 进来，所有操作通过回调交给调用方；组件里不调用 IPC（`window.aijian`）、
网络或本地存储。

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
- 每个任务：`id`、`shotId`、`title`、`version`、`kind`（`video` / `image` / `voice`）、
  `status`、`attempt`、`reason`、`suggestion`、`waitedSeconds`。
- `status` 取值：`queued`、`running`、`uncertain`、`requeued`、`failed`、`done`。
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
- 回调：`onFix(issue)`、`onExport()`。
- 「去修」只调用 `onFix(issue)`，由调用方按 `issue.action` 打开要改的地方，组件不改任何东西。
- `block` 的问题放在「要先处理」，`warn` 的放在「建议看看」。
- 「直接导出」除了检查中以外都能点。还有要先处理的问题时，按钮下面会说明这些问题会留在成片里。
- 问题的 `detail` 和编号（`id`）只在每条问题的「高级」里显示。
- 报告里的测量（有没有音轨、整片响度、真峰值、`assumptions`）在右侧的「高级」里。

### SoundPanel

- props：`sceneTitle`、`durationLabel`、`mood`、`music`、`master`、`lanes`、`duckMusic`、
  `defaultFineOpen`。
- 回调：`onMoodChange`、`onMasterChange(volume, db)`、`onLaneChange(lane, volume, db)`、
  `onDuckMusicChange`、`onPreview`。
- `mood` 取值：平静、温暖、不安、悬疑、紧张、激烈、悲伤、释然。

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
- 内置样式：`clear` 清楚白字、`band` 底条字幕、`film` 电影字幕、`bold` 醒目黄字。
- 不认识的样式 id 按清楚白字显示。

### CoverEditor

- props：`title`、`subtitle`、`aiMark`、`defaultAiMark`（默认 `true`）、`backgroundUrl`。
- 回调：`onTitleChange`、`onSubtitleChange`、`onAiMarkChange`、`onSave`。
- 传了 `aiMark` 时开关由调用方控制，不传时组件自己记。
- 片名最多 20 个字。没有片名时「用这个封面」不能点。

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

界面上只有 0–100，不出现 dB 或分贝。0–100 是相对原始音量的百分比（振幅），换成混音增益：

```text
dB = 20 × log10(音量 / 100)
```

音量 0 是静音，对应 `-Infinity`。

| 音量 | 增益     |
| ---- | -------- |
| 100  | 0 dB     |
| 70   | −3.1 dB  |
| 50   | −6.0 dB  |
| 20   | −14.0 dB |

四层的默认值：

| 层     | id         | 音量 | 增益（四舍五入） |
| ------ | ---------- | ---- | ---------------- |
| 台词   | `dialogue` | 100  | 0 dB             |
| 环境声 | `ambience` | 50   | −6 dB            |
| 音效   | `sfx`      | 70   | −3 dB            |
| 配乐   | `score`    | 20   | −14 dB           |

- 四舍五入后的增益和 `../film/audio.ts` 里的 `AUDIO_LANE_GAIN_DB` 一致，`helpers.test.ts` 会核对。
- 层的 id 和顺序与 `../film/audio.ts` 里的 `AUDIO_LANE_ORDER` 一致。
- 回调同时给音量和 dB，调用方不用自己换算。

## 样式规则

- 只用 `../pro/pro.css` 里已有的变量。
- `--accent-strong` 在 pro.css 里没有定义，写成 `var(--accent-strong, var(--accent))`，
  显示的是 `--accent`。
- 不写字面颜色，比如十六进制、`rgb()`、`white`、`black`。
  - 需要浅一点的底色时，用 `color-mix()` 混已有变量。
  - 主按钮上的字用 `var(--text)`。
- 所有选择器都以 `.nx-root` 开头，示例页的以 `.pro-root.nx-story` 开头。
  这样能盖过 `.pro-root button` 和 `.pro-root *` 的重置，也不影响软件里其他界面。

`rules.test.ts` 检查上面几条，还检查：

- 没有调用 `window.aijian`、`ipcRenderer`、`fetch`、`XMLHttpRequest`、`localStorage`、
  `sessionStorage`、`WebSocket`。
- import 只用 react 和 next/ 里的文件。

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

每个示例页顶部都标着「示例数据」：

- 作品、镜头、任务和检查结果都是编的，写在 `stories/sampleData.ts` 和各个 `*.story.tsx` 里。
- 点按钮只会在顶部写一句「刚才点了：…」，不会真的去做。

## 布局检查

`stories/check-layout.mjs` 用 Playwright 打开每个示例页的每个状态，检查：

- 整页不滚动。
- 没有东西超出窗口。
- 没有内容被截断。单行省略号除外。
- 文字和控件不重叠。画面占位框里的字幕和标识除外。
- 字号不小于 12px。
- 按钮都有名字。
- 控制台没有报错。

有「高级」的页面，展开以后再查一遍。

先开开发服务器，再在仓库根目录运行：

```sh
AIVORA_CHROMIUM=/path/to/chrome AIVORA_SIZES=1280x800,1920x1080 \
  node apps/studio-web/src/aivora/next/stories/check-layout.mjs
```

`AIVORA_SIZES` 不写时只查 1280×800。

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
| `helpers.test.ts`、`qcReport.test.ts` | 换算函数和报告校验的测试                                       |
| `stories.test.tsx`、`rules.test.ts`   | 示例页的测试，和上面「样式规则」的检查                         |
