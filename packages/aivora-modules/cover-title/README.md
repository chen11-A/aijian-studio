# 封面和片头

本地调用 FFmpeg 生成 PNG 封面和三秒 H.264 MP4 片头，不联网。需要 FFmpeg 带有 drawtext、libx264 和 PNG 编码支持。

输入 `CoverOptions`：`ffmpegPath`（工具绝对路径）、`imagePath`、`outputPath`、`fontPath`、`title`、`subtitle`、`episode`（正整数）、`format`、`template`、可选 `aiLabel`。片名和副标题各一行，最多四十个 Unicode 字符，超出时返回中文错误；字体随文字长度自动缩小。图片居中裁切铺满。

- `format`：`landscape` 横屏 1920×1080、`portrait` 竖屏 1080×1920、`square` 方图 1080×1080。
- `template`：`cinema` 下方白字电影式、`drama` 居中金色短剧式、`comic` 上方黄色粗描边漫剧式。
- `aiLabel: true`：右下角加「AI 生成」。

输出 `{ path, width, height }`，片头另有 `duration: 3`。片头 25fps，头尾各 0.5 秒淡入淡出，无音轨。输出路径已存在时覆盖；禁止覆盖输入图片、字体和视频工具。

```ts
import path from 'node:path';
import { createCover, createTitleVideo } from './cover-title/index.js';
const options = {
  ffmpegPath: 'C:\\视频工具\\ffmpeg.exe', // Linux 例如 /opt/视频工具/ffmpeg
  imagePath: path.resolve('作品/第一帧.png'),
  fontPath: path.resolve('apps/studio-web/src/aivora/assets/v2/NotoSansCJKsc-Bold.otf'),
  outputPath: path.resolve('作品/封面.png'),
  title: '回到那一天', subtitle: '一场关于重逢的故事', episode: 1,
  format: 'portrait' as const, template: 'drama' as const, aiLabel: true,
};
await createCover(options);
await createTitleVideo({ ...options, outputPath: path.resolve('作品/片头.mp4') });
```

只读取并引用仓库已有字体，不修改，也不新增仓库字体文件。渲染时仅在系统临时工作目录创建字体副本，用于避开滤镜路径转义；结束后连同文本临时文件一起删除。使用无 shell 的参数数组执行，图片及输出路径不会进入滤镜字符串；字体和文本暂存为简单文件名，避免 Windows 盘符、中文及空格的滤镜转义问题。文字禁用 FFmpeg 变量展开，百分号等按原文显示。临时文件自动清理。Linux 有真实集成测试；Windows 使用同一 Node API，尚未在 Windows 实机验收。

在上级目录运行 `npm test -- cover-title`。测试可设置 `FFMPEG_PATH` / `FFPROBE_PATH`；Linux 测试默认绝对路径 `/usr/bin/ffmpeg`、`/usr/bin/ffprobe`，不搜索 PATH。测试检查三种尺寸、三种模板、中文空格路径、真实视频时长与淡入淡出、错误输入。
