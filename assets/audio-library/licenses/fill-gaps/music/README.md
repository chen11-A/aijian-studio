# 新增悲伤配乐循环

两首独立已发表作品：HoliznaCC0 的《All The Way Sad》（一路悲伤）与《Sad Boi》（忧伤少年）。原录音分别来自不同专辑；本目录是原曲长片段的循环派生，不是自制合成示例，也不是同曲切段充数。

先阅读 `LICENSE_EVIDENCE.md`：记录原作者明确 CC0 声明、FMA 逐曲 CC0 资料及 Bandcamp 另有 CC-BY 按钮的不一致，不隐藏证据限制。`entries.json` 为待整合记录，本工具不修改主 manifest。

本地重复生成：

```sh
python3 assets/audio-library/fill-gaps/music/build_music.py --ffmpeg /usr/bin/ffmpeg --source-dir "/本地音乐目录"
```

目录需含 `HoliznaCC0 - All The Way Sad.mp3`、`HoliznaCC0 - Sad Boi.mp3`。脚本不联网；只调用明确提供的 FFmpeg 绝对路径，依赖 Python 3、NumPy 和上级现有 `round2-loops/build_loops.py`。Windows 可传 `C:\视频工具\ffmpeg.exe`，参数数组支持中文和空格。

输出 48kHz 立体声 Ogg。使用能量包络估拍选整拍长度候选、首尾交叉淡化、边界旋转和固定增益；以 -20 LUFS 为目标，优先保证真峰值及采样峰值 ≤−1 dB。逐声道客观接缝、时长、真实响度、峰值、立体声差异与哈希记录在每个同名 JSON 中。

客观边界通过不等于乐句与和声已经人工验收；本次未人工试听。没有将首尾压到静音伪装成循环。
