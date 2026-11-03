# 字幕

纯本地生成 SRT、ASS 和 ffmpeg 烧录参数。台词输入包含说话人 `speaker`、文字 `text`、开始秒数 `start` 和结束秒数 `end`。输出为 UTF-8 字符串，按开始时间排序；SRT 不显示说话人前缀，ASS 将说话人放入 Name 字段。

```ts
import { generateSrt, generateAss, burnSubtitleArgs } from './index.js';
const lines = [{ speaker: '小明', text: '今天一起去散步吧。', start: 0.3, end: 2.8 }];
console.log(generateSrt(lines));
const ass = generateAss(lines, { portrait: true, preset: 'comic' });
// 将 ass 写入 UTF-8 文件，再将 command.executable / command.args 传给 spawn（shell:false）。
const command = burnSubtitleArgs({ ffmpegPath: '/工具/ffmpeg', videoPath: '/项目/画面.mp4', subtitlePath: '/项目/字幕.ass', outputPath: '/项目/成片.mp4' });
```

预设：`short-drama` 短剧大字粗描边（默认）、`cinema` 电影细字、`comic` 漫剧彩色描边。默认字体家族为 `Noto Sans CJK SC`。`burnSubtitleArgs` 默认用 `import.meta.url` 定位仓库 `apps/studio-web/src/aivora/assets/v2` 中已有的 Noto 字体，即使改变工作目录也会传入正确的绝对 `fontsdir`，不依赖系统安装中文字体，不修改或复制字体。可用 `fontsDirectory` 明确覆盖目录；若将模块搬离仓库，需要保留该相对布局或传入字体目录。现有目录也有图片，libass 可能记录跳过非字体文件的日志，不影响 Noto 字体加载。横屏坐标 1920×1080，竖屏 1080×1920，底部居中；竖屏底部留 240 像素。

`wrapText(text, portrait)` 使用 Node 20+ 的本地 `Intl.Segmenter` 中文分词，每行不超过 16 字（竖屏 12 字，标点也计数）。优先在完整词之间断行，并避免闭标点（如 `，。！？、）》”`）出现在新行开头、开标点（如 `“（《`）出现在前行末尾。超长英文和数字按 Unicode 字符拆分，不报错。完整词与避头尾规则冲突时，优先尝试不超长的合法字符边界；仍无解（例如连续 17 个闭标点）时保留原文并严格限制行长，允许标点留在边界。显式手动换行和原文开头、末尾已有的孤立标点不重排，因此也可能留下避头尾例外。自动分词无法保证专有名词边界，手动换行可控制。长台词可能超过两行，不自动缩短文字或修改时序。ASS 控制字符会转为全角，避免文字注入样式。

ffmpeg 必须传入完整路径，支持 Windows 和 Linux 中文及空格路径；返回参数应直接交给 spawn，不拼接 shell 命令。过滤器路径做两层转义。程序需支持 libass 和 libx264；此模块只生成命令参数，不执行程序。

测试：上级目录运行 `npm test -- subtitles`。包含横竖屏标点边界、超长英文数字、极端冲突，以及通过空 Fontconfig 配置禁用系统字体后，在中文、空格与特殊字符路径下实际烧录字幕，验证 libass 选择仓库 Noto 字体。
