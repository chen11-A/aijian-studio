# Aivora Media 独立媒体模块

仅供 Node.js 调用，不修改或接入 apps。提供字幕、字幕烧录、自动调整音量、封面、片头字卡和项目 ZIP 归档。无 npm 运行时依赖。

## 运行条件

- Node.js 24；仓库使用 pnpm 11。
- 媒体功能需要 FFmpeg（libx264、AAC、libass、loudnorm）和 ffprobe。
- 系统需安装中文字体，默认 `Noto Sans CJK SC`；字幕、封面和字卡可通过 `fontFamily` 指定字体族名称。
- 归档需要 Python 3.10+ 标准库；可以传入 `pythonPath`，默认 `python3`。不依赖 zip/unzip 命令。
- 所有媒体 API 接受 `ffmpegPath`；需要探测输入的 API 同时接受 `ffprobePath`。默认从 PATH 查找，支持绝对路径或相对当前调用目录的路径，包括中文、空格。以参数数组执行，不使用 shell。

## 使用

```js
import { writeFile } from "node:fs/promises";
import {
  generateSubtitles,
  exportVideo,
  createCovers,
  createTitleCard,
  archiveProject,
  restoreProject,
} from "./index.mjs";

const tools = {
  ffmpegPath: "/opt/视频 工具/ffmpeg",
  ffprobePath: "/opt/视频 工具/ffprobe",
};
const { srt, ass } = generateSubtitles(
  [{ shotId: "shot-1", start: 0, end: 3.5, speaker: "旁白", text: "你好，欢迎来到我们的故事。" }],
  { orientation: "portrait", style: "white" },
);
await writeFile("字幕.srt", srt);
await writeFile("字幕.ass", ass);
await exportVideo({
  input: "成片 原始.mp4",
  ass: "字幕.ass",
  output: "字幕 成片.mp4",
  orientation: "portrait",
  autoAdjustVolume: true,
  ...tools,
});
await createCovers({
  input: "字幕 成片.mp4",
  time: 1.2,
  title: "我们的故事",
  outputDir: "封面 输出",
  aiLabel: true,
  ...tools,
});
await createTitleCard({
  title: "我们的故事",
  output: "片头.mp4",
  orientation: "landscape",
  fade: true,
  ...tools,
});
await archiveProject({ projectDir: "我的 项目", output: "项目 备份.zip" });
await restoreProject({ archive: "项目 备份.zip", destination: "恢复 项目" });
```

## API 与行为

- `generateSubtitles(shots, options)` 返回 UTF-8 字符串 `{srt, ass}`。时间单位为秒，要求 `start >= 0`、`end - start >= 0.01`，按开始时间排序，允许重叠台词；空台词忽略。`speaker` 记录在 ASS Name 字段，不自动加到屏幕台词；`shotId` 为输入标识。SRT 毫秒、ASS 厘秒四舍五入。
- `orientation` 为 `portrait`（1080×1920，默认）或 `landscape`（1920×1080）。字幕每行最多 16 / 22 个 Unicode 码点，标点优先断行，没有标点则硬断行。汉字、英文、标点及 emoji 都保守按一个码点计数。保留显式换行。ASS 禁用自动重排；竖屏字幕底边距 420 像素，大于下方 20%（384 像素）。SRT 不包含样式或安全区信息。
- 四套 ASS 样式：`white` 白字黑边、`yellow` 黄字黑边、`bar` 深色底条、`variety` 加粗大字粗描边。为防 ASS 注入，输入文本的反斜杠与花括号转为全角可见字符。
- `exportVideo` 接受视频文件和 ASS 文件，按画幅等比缩放并补黑边，字幕烧录后输出 MP4（H.264/yuv420p + AAC/48kHz，faststart）。使用第一路视频和第一路音频；无音轨时添加静音 AAC。应使用与目标画幅一致的 ASS。
- 音量仅对外提供 `autoAdjustVolume`（默认 false）开关。开启后先测量全片，再用测量值做第二遍 loudnorm；内部目标 −16 LUFS、峰值 −1.5 dBTP，为 AAC 留出余量。成品再次测量，要求 −16±0.5 LUFS 且峰值 ≤−1 dBTP，否则报错且不发布文件。第三次是验证测量，不是第三遍音频处理。全静音保持静音（无法达到有限 LUFS）；关闭时仍编码 AAC，但不做响度处理。
- `createCovers` 从 `time` 秒取帧，叠加标题，输出目录内 `portrait.jpg` 与 `landscape.jpg`，返回两个绝对路径。标题位于画面上部；`aiLabel` 默认 true，右下角显示“AI 生成”，false 关闭。封面是静态海报，不应用字幕的平台按钮安全区。超出时长报错。
- `createTitleCard` 输出 2 秒、30fps、黑底居中标题 MP4，含静音 AAC。`fade` 默认 false，开启后前后各 0.3 秒淡入淡出。标题和封面最多六行，过长时报错。
- 所有媒体输出拒绝覆盖已有文件，失败时清理私有临时目录。封面两张依次发布；第二张失败时第一张可能已存在，调用方需自行处理重试。外部工具每次调用超时 10 分钟。

## 项目归档与安全

`archiveProject` 将项目目录内的 `project.json`、素材、成片以及其他普通文件一起压缩，保留相对路径和空目录。`project.json` 必须是 JSON 对象；不限定上层应用的项目 schema。项目中引用的素材和成片应放在该目录内并使用相对路径；不会追踪外部绝对路径、下载远程素材或改写项目 JSON。

ZIP 输出必须位于项目目录外，且不得存在。`restoreProject` 要求目标目录不存在，先在同级私有目录验证和解压，再发布内容；普通异常会清理临时目录。恢复不会覆盖现有项目；发布阶段不是跨文件的事务，进程被强制终止可能留下部分目标目录。

拒绝绝对路径、`..` / `.` 路径段、反斜杠、冒号、空路径段、大小写折叠后的重复路径、符号链接、特殊文件、加密 ZIP 和非 STORE/DEFLATE 压缩。读取 ZIP 时校验 CRC，限制最多 10,000 个条目、8 GiB 解压内容，并在解压过程中再次计数。源码目录也拒绝符号链接和特殊文件。归档/恢复期间项目及输出父目录应由调用方控制，避免其他进程并发改写；不将返回项目中的脚本或资源自动执行。

## 验证

在仓库根目录执行：

```sh
pnpm --filter @aijian/aivora-media test
pnpm exec eslint packages/aivora-media
pnpm exec prettier --check packages/aivora-media
FFMPEG_PATH=/missing/ffmpeg FFPROBE_PATH=/missing/ffprobe \
  node --test packages/aivora-media/test/*.test.mjs
```

测试支持 `FFMPEG_PATH`、`FFPROBE_PATH`、`PYTHON_PATH`。FFmpeg 或 ffprobe 不存在时，仅跳过真实媒体测试，字幕与归档测试继续运行且成功退出码为 0；工具存在但执行失败不会伪装成跳过。真实媒体素材全部使用本地 lavfi 合成，无网络下载、无真实用户素材。详见 [VALIDATION.md](./VALIDATION.md)。
