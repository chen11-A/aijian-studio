# 森林、海浪和夜晚虫鸣

九条独立真实录音，三类各三条。每条从原录音取连续约 41 秒，经 1 秒首尾交叉淡化得到 40 秒循环；不重复一段短声音来凑时长，不用蛙鸣冒充虫鸣。

- 森林：风与鸟、小溪与鸟、林中鸟语。
- 海浪：大西洋岸浪、近距离沙滩泡沫、诺曼底轻浪。
- 夜晚虫鸣：法国田野蟋蟀、Lisa Redfern 夜间蟋蟀、sengjinn 午夜蟋蟀。

逐条原网页授权、作者和来源证据见 `LICENSE_EVIDENCE.md`；原输入哈希与目录见 `sources.json`，待合并数据见 `entries.json`。本脚本不修改主 manifest。

```sh
python3 assets/audio-library/fill-gaps/nature/build_nature.py --ffmpeg /usr/bin/ffmpeg --source-root "/本地/QuietField/public"
```

只在本地处理，依赖 Python 3、NumPy 和现有 `round2-loops/build_loops.py`。输入需要对应目录布局，运行前验证源文件 SHA-256；FFmpeg 必须显式传绝对路径，不搜索 PATH，参数数组支持中文及空格，Windows 可传 `C:\视频工具\ffmpeg.exe`。

输出统一为 48kHz 单声道 Ogg。−20 LUFS 为目标，优先保证真峰值和采样峰值均≤−1 dB，必要时整体降低响度；具体数值见报告。最终 Ogg 重新解码检查采样跳变与接缝短窗 RMS，未将首尾淡至静音来假装无缝。

客观接缝检查不是人工试听；报告统一标记未完成主观试听，不声称在每种播放设备和场景下都已听感验收。
