# 整片响度统一

输入为 ffmpeg 完整路径、输入和输出文件路径、目标响度（短视频 -14、电视 -23 LUFS）。输出包含处理前后的实测响度、真峰值和输出路径。使用两遍 loudnorm，48kHz 音频。MP4/MOV/MKV 输出直接复制画面并使用 AAC；WAV/OGG/M4A/AAC/MP3/FLAC/OPUS 为纯音频输出，即使输入是视频也只映射第一音轨，明确丢弃画面。WAV 使用 24 位 PCM、OGG 使用 Vorbis，其他纯音频输出使用对应容器支持的编码器。输出已存在时不覆盖。所有处理在本地进行，程序路径不从 PATH 查找。

```ts
import { normalizeLoudness } from './index.js';
const result = await normalizeLoudness({
  ffmpegPath: '/usr/bin/ffmpeg', // Windows 示例：C:\\工具 目录\\ffmpeg.exe
  input: '/作品/第一集 原片.mp4', output: '/作品/第一集 完成.mp4', target: -14,
});
console.log(result.after.integrated, result.after.truePeak);
```

真峰值内部留 0.2dB 编码余量，输出重新实测，要求真峰值 ≤ -1dBTP、综合响度距离目标 ≤1 LU；不满足会报中文错误（输出文件保留用于检查）。无声输入报错。只处理第一条音轨，其他音轨不导出；不做混音。需要本地 ffmpeg 对输入和输出编解码器提供支持。测试通过 FFMPEG_PATH 可显式指定程序，默认测试使用 /usr/bin/ffmpeg；包括生成测试音频的真实处理前后测量。

无音轨输入、已有输出文件和不支持的输出扩展名分别返回具体中文错误。真实集成测试还验证视频转 WAV/OGG 只有音频流、视频转 MP4 保留画面。
