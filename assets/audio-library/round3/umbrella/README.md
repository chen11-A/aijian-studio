# 第三轮真实雨伞音效

原件已由用户提供的固定 raw 提交 `72b08644f41a0d62fe11f5708b193450341f41c5` 恢复，之前的代理下载阻碍已不影响本地处理。没有重新请求被拒的原站，也没有合成伞声。

交付6个文件：3个单次开伞、3个收伞片段。收伞按原作者“开合三次”的动作顺序与六个主体事件包络推定，**未试听确认**；名称、classificationBasis均保留此限定。波形/10毫秒RMS标注图及分组分析见 `evidence/197375-envelope.png` 和 `evidence/CLASSIFICATION.md`。

| 文件ID | 原编号 | 原片区间（秒） | 内容 |
|---|---|---|---|
| r3-umbrella-open-1 | 369322 | 0–0.80 | 单次开伞 |
| r3-umbrella-open-2 | 369322 | 3.05–3.95 | 单次开伞 |
| r3-umbrella-open-3 | 369322 | 4.50–5.58 | 单次开伞 |
| r3-umbrella-close-1 | 197375 | 2.60–4.40 | 收伞（按原作者开合顺序切分） |
| r3-umbrella-close-2 | 197375 | 9.80–11.25 | 收伞（按原作者开合顺序切分） |
| r3-umbrella-close-3 | 197375 | 15.80–18.20 | 收伞（按原作者开合顺序切分） |

这是2份真实原录音中的6次动作，不是6份独立录音，也没有复制同一事件凑数。原3个完整开合组不再交付，避免重复计数。628659和502526的许可及原件也已核验，但未对不明确事件定位的片段添加开/收标签。

`sources.json` 保留四个原作者、实际HQ MP3预览URL、原件SHA256及固定raw提交；`evidence/` 是用户原始证据中的许可摘录。`source`使用原页面，`downloadSource`使用明确记录的 `cdn.freesound.org/...-hq.mp3` 地址。四项原页均CC0。源文件来源为有损HQ预览，不声称是无损原WAV。

全部交付文件均为48kHz单声道OGG。通过四倍过采样动态限幅并编码后重测，积分响度在-21至-15LUFS内，真峰值与采样峰值均≤-1dB。详细结果见 `MEASUREMENTS.json`，每条最终SHA256见 `entries.json`。不标记循环。

## 离线复现

`build.py` 是实际构建脚本，读取 `sources.json` 和 `clips.json`，使用素材库 `peak_safety.py` 测量。输入目录为已解出的raw目录，内含 `umbrella/fs-编号.mp3`。脚本验证四个原件SHA256；输出必须是新目录，不修改主清单或原录音。

```sh
python3 build.py --ffmpeg "/usr/bin/ffmpeg" --ffprobe "/usr/bin/ffprobe" --input-dir "/本地/raw 原件" --output-dir "/本地/新的 雨伞输出"
```

Windows同样传工具绝对路径。采用独立参数列表调用工具，支持中文和空格路径；不联网、不执行下载程序。已使用中文和空格输出路径实际运行。Vorbis随机流编号及不同编码器版本可能导致文件字节哈希不同；不承诺跨版本逐字节一致。
