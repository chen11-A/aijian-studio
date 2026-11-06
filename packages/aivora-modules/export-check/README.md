# 导出前自检

`checkExport(timeline, options)` 输入镜头列表和明确的 ffmpeg / ffprobe 完整路径，输出 `ok`、结构化 `issues` 和中文 `text`。每条问题包含镜头编号（从 1 开始）、整片中的秒数和修改建议。只在本地运行。

```ts
import { checkExport } from './index.js';
const report = await checkExport({ duration: 8, shots: [{
  path: '/作品/镜头 一.mp4', start: 0, end: 8, sourceStart: 0,
  voices: [{ path: '/作品/台词.wav', start: 1, end: 6, sourceStart: 0, speechEnd: 5.4 }],
  music: [{ path: '/作品/配乐.ogg', start: 0, end: 8 }],
}] }, { ffmpegPath: '/usr/bin/ffmpeg', ffprobePath: '/usr/bin/ffprobe' });
console.log(report.text);
```

`start/end` 是整片时间，`sourceStart` 是素材入点（默认 0）。`speechStart/speechEnd` 是原配音中第一/最后一个字的起止秒数；没有逐字信息时不能可靠判断是否截断台词，不做语音识别。视频第一音轨默认参与混音检测；`includeOriginalAudio: false` 可以关闭。若同一镜头 voices/music 显式列出同一视频文件（解析为相同绝对路径），该镜头自动原声被完全替换为显式片段，避免重复计算；因此有意只用一段原声时可显式指定片段。相同素材的不同符号链接别名不自动识别，应统一路径。

检查文件存在、ffprobe 媒体信息、ffmpeg 实际解码，逐片扫描超过 2 秒的黑屏/静帧，黑屏覆盖的静帧区间会扣除以免重复报告，非黑静帧仍正常报告。检查素材时长、画面和配音时间范围、分辨率及像素宽高比。所有列出的音频按时间混合后用 silencedetect 检查连续低于 -50dB 的区段，默认超过 2 秒报告；`silenceSeconds` 可调整。自动检测无法判断艺术性的黑屏或留白，建议人工确认。解码和扫描会完整读取素材，长片可能耗时；本模块不会修改输入文件。

Windows 使用例如 `C:\\工具 目录\\ffmpeg.exe` 的完整路径。所有子进程使用参数数组，不经 shell。测试通过 FFMPEG_PATH / FFPROBE_PATH 指定本机程序；默认集成测试路径 /usr/bin/ffmpeg 和 /usr/bin/ffprobe。
