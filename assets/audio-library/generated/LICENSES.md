# 自制合成音效及授权

本目录九个音效均由本目录 `generate.py` 使用正弦波、包络、确定性伪随机噪声和基础调制数学合成，未采样、下载或改编任何第三方录音、音乐或作品。名称均带「自制」，元数据标记 `origin: self-generated`。这些音效是设计音，不声称为真实心脏、电话或场景的现场录音。

本目录生成脚本与生成音频以 **CC0 1.0 Universal（CC0-1.0）** 提供。在法律允许的最大范围内，作者放弃对这些原创内容的全部著作权及相关权利，使其贡献于公有领域；在无法放弃的范围内，提供 CC0 所规定的无条件、不可撤销、免版税许可。允许复制、修改、商用与再分发，无需署名。不提供担保。

- CC0 授权文本：https://creativecommons.org/publicdomain/zero/1.0/legalcode
- 可核查的生成来源：https://github.com/chen11-A/aijian-studio/blob/gpt/aivora-modules/assets/audio-library/generated/generate.py
- 每个文件的元数据与实际 SHA-256 校验值见 `entries.json`。来源链接在分支推送后可访问。

## 重新生成

只需要 Python 3 标准库、具备 libvorbis 的 FFmpeg 和 FFprobe，无联网服务。显式传入工具绝对路径，不查找 PATH；参数数组支持中文和空格路径。

```sh
python3 assets/audio-library/generated/generate.py --ffmpeg /usr/bin/ffmpeg --ffprobe /usr/bin/ffprobe --target-lufs -20
```

Windows 示例：`python generate.py --ffmpeg "C:\视频工具\ffmpeg.exe" --ffprobe "C:\视频工具\ffprobe.exe" --target-lufs -20`。

过程为数学合成单声道 PCM → 删除首尾静音与短淡变 → 两遍响度统一 → 48kHz Ogg Vorbis → 对最终 Ogg 重新测量响度、真峰值、采样率、声道与时长并计算 SHA-256。算法及伪随机种子固定；FFmpeg 或编码器版本不同可能使压缩文件字节和校验值不同，重新生成时会更新校验值。

三个心跳分别为 62、96、132 次/分；三个低频冲击具有不同扫频、衰减和音长；三个电话铃分别为双频、电子双短音和金属铃调制音。九个文件是不同配方，不是同一录音的换名副本。循环标记保守设为 false。
