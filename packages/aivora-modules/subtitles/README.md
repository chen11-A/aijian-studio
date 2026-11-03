# 字幕

纯本地生成 SRT、ASS 和 ffmpeg 烧录参数。台词输入包含说话人 `speaker`、文字 `text`、开始秒数 `start` 和结束秒数 `end`。输出为 UTF-8 字符串，按开始时间排序；SRT 不显示说话人前缀，ASS 将说话人放入 Name 字段。

```ts
import { generateSrt, generateAss, burnSubtitleArgs } from './index.js';
const lines = [{ speaker: '小明', text: '今天一起去散步吧。', start: 0.3, end: 2.8 }];
console.log(generateSrt(lines));
const ass = generateAss(lines, { portrait: true, preset: 'comic' });
// 将 ass 写入 UTF-8 文件，再将 command.executable / command.args 传给 spawn（shell:false）。
const command = burnSubtitleArgs({ ffmpegPath: '/工具/ffmpeg', videoPath: '/项目/画面.mp4', subtitlePath: '/项目/字幕.ass', outputPath: '/项目/成片.mp4', fontsDirectory: '/仓库/apps/studio-web/src/aivora/assets/v2' });
```

预设：`short-drama` 短剧大字粗描边（默认）、`cinema` 电影细字、`comic` 漫剧彩色描边。默认字体家族为 `Noto Sans CJK SC`，烧录时引用仓库现有字体目录，不修改或复制字体。横屏坐标 1920×1080，竖屏 1080×1920，底部居中；竖屏底部留 240 像素。

`wrapText(text, portrait)` 使用 Node 20+ 的本地 `Intl.Segmenter` 中文分词，每行不超过 16 字（竖屏 12 字，标点也计数）。不拆分分词器识别的词；单个词超长时报中文错误。自动分词无法保证专有名词边界，手动换行可控制。长台词可能超过两行，不自动缩短文字或修改时序。ASS 控制字符会转为全角，避免文字注入样式。

ffmpeg 必须传入完整路径，支持 Windows 和 Linux 中文及空格路径；返回参数应直接交给 spawn，不拼接 shell 命令。过滤器路径做两层转义。程序需支持 libass 和 libx264；此模块只生成命令参数，不执行程序。

测试：上级目录运行 `npm test -- subtitles`。
