# 导出前检查 @aijian/aivora-qc

独立的本地 MP4 质检模块，仅读取素材，输出 JSON，不依赖 apps 或 npm 第三方库。需要 Node.js 24、PATH 中的 `ffmpeg`/`ffprobe`（验证版本 FFmpeg 7.1.5；需 blackdetect/freezedetect/silencedetect/loudnorm 滤镜）。不上传素材。

## 使用

仓库根目录运行：

```sh
node packages/aivora-qc/cli.mjs /path/final.mp4 > report.json
node packages/aivora-qc/cli.mjs /path/final.mp4 --srt /path/captions.srt --dialogue /path/dialogue.json --layout /path/layout.json > report.json
node --test packages/aivora-qc/test/*.test.mjs
# 或：pnpm --dir packages/aivora-qc test
```

台词 JSON 为秒区间数组：`[{"start": 1.2, "end": 4.6}]`。仅整个静帧区间被台词区间并集覆盖时，阈值从 1 秒放宽到 2 秒。不做语音识别，不自动将 SRT 当作台词。

布局 JSON 可含：`{"safeMargin":0.1,"bottomMargin":0.12,"fontSizePx":43.2,"lineHeight":1.2,"maxLineUnits":20}`。边距为画面尺寸比例，字号为像素；仅支持底部居中、不自动折行。未传时字号为画高 4%。

```js
import { checkExport } from "./packages/aivora-qc/index.mjs";
const report = await checkExport("/path/final.mp4", {
  srtPath: "/path/captions.srt", // 可选
  dialogue: [{ start: 1.2, end: 4.6 }], // 可选
  timeoutMs: 600000, // 每次工具调用上限，默认10分钟
  signal: new AbortController().signal, // 可取消
});
```

成功（即使有问题）退出码为 0；执行失败、工具缺失、输入损坏或参数错误为 1，stderr 输出 JSON 错误。stdout 仅输出报告；自动门禁可读取 `issues.length` 决定是否阻止导出。不会输出不完整的成功报告，修复输入或环境后可安全重试。

## 报告与阈值

`schemaVersion: 1`；`media` 含 duration/width/height；`audio` 含 present/integratedLufs/truePeakDbtp；`assumptions` 记录规则及字幕布局。`issues` 按秒时间排序，每条有 `time`、`end`、`type`、中文 `message` 和 `suggestion`，例如：

```json
{
  "time": 2,
  "end": 2.7,
  "type": "black",
  "message": "画面出现持续黑屏。",
  "suggestion": "检查素材缺失或转场，裁去黑帧或补齐画面。"
}
```

| type                 | 判断                                                    |
| -------------------- | ------------------------------------------------------- |
| black                | 黑屏 ≥0.5秒；片头或片尾且持续 ≤0.5秒豁免                |
| freeze               | 静止 ≥1秒；完整台词覆盖时 ≥2秒                          |
| silence              | 全声道低于 −50dB 持续 ≥2秒；缺音轨视为全片静音          |
| loudness             | 全片综合响度不在 [−17, −15] LUFS，或无法测量            |
| true_peak            | 全片输入真峰值 >−1 dBTP                                 |
| subtitle_safe_area   | 按声明的布局估算超出安全区，`estimated: true`           |
| subtitle_line_length | 单行 >20 全角等效字符，可配置；ASCII 计0.5，其余码点计1 |
| subtitle_overlap     | 按开始时间排序后与下一条时间重叠；首尾相接不报          |

响度/真峰值是全片量，`scope: "program"`、`time: 0`、`end: duration`，**不代表异常发生在第0秒**。静音导致的负无穷、过短音频的不可用测量用 `null` 表示，仍报告响度问题，JSON 中没有 Infinity/NaN。

## 假设与限制

- SRT 通常没有可靠布局坐标。安全区是**预检估算而非实际渲染测量**：默认四边10%安全边距、底边距12%、底部居中、字号画高4%、行高1.2，不自动换行，ASCII 字宽估为0.6em、其他 Unicode 码点1em。组合字符/emoji、字体字形、字距、描边、标签坐标及播放器自动换行都可能使估算失真。基础 HTML/ASS 标签被忽略；不读取烧录字幕、不做 OCR。必须用最终样式复核。JSON 保存这些假设与限制。
- 黑区间是短淡入淡出的代理判断，无法知道创作意图；非常暗的镜头可能被判为黑屏。黑像素阈值0.10、占比0.98。静帧噪声阈值−60dB；有意静态镜头也会提示。
- 时间以首条非封面视频轨起点为0，分析首条音轨（不分析其他语言音轨）；音轨开头/结尾空缺补静音。画面分辨率考虑90度旋转，但非方形像素与其他角度旋转不做字幕几何校正。建议方形像素、恒定帧率的最终导出 MP4。
- 黑屏/静帧边界受帧采样限制；片尾黑屏以平均帧时长补足末帧，变帧率素材的末帧边界可能存在误差。音频边界受采样及编码延迟影响。响度是 FFmpeg 报告精度，不声称无限精度。
- 检测串行解码视频与音频，内存中的工具输出每次最多32MiB；超时、取消、超限或解码失败会报错而非误报通过。仅用于可信本地成片，不是处理不可信媒体的沙箱。

## 测试与来源

测试使用 `node:test`，用 FFmpeg lavfi 即时合成运动测试图、纯色/黑画面、正弦音及静音，临时目录自动清理，无真实素材或外部下载。覆盖阈值边界、片头片尾豁免、EOF、台词覆盖、缺轨/静音、响度/峰值、正常无问题素材、字幕和 CLI/取消/超时/损坏输入。

本模块及合成测试代码为原创，采用仓库 Apache-2.0 许可；没有新增 npm 依赖，也不分发 FFmpeg 二进制。需求、公共报告契约与设计取舍见 [DESIGN.md](./DESIGN.md)。本次仅增加此目录，不集成 UI，不修改工作区锁文件。
