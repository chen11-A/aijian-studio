# 免费音效和配乐素材库

输入：本目录的 `manifest.json`，以及调用方显式传入的 ffmpeg、ffprobe 绝对路径。
输出：本地 Ogg 音频、中文素材元数据，以及 `check.py` 的中文检查报告。运行时不联网。

当前收录 **109 个音效、20 首配乐**。其中本轮新增 15 个音效及 2 个雨风循环版；包含明确标注的自制 CC0 音效、第三方 CC0 合成音效和原有第三方素材。来源见每条 `source`，新增第三方原始许可页见 `originalLicenseUrl`，授权原文见 `LICENSES.md`。

```sh
python3 assets/audio-library/check.py --ffmpeg "/opt/音频 工具/ffmpeg" --ffprobe "/opt/音频 工具/ffprobe"
```

Windows 示例：`python check.py --ffmpeg "C:\音频 工具\ffmpeg.exe" --ffprobe "C:\音频 工具\ffprobe.exe"`。使用参数数组启动工具，不经 shell，不从 PATH 搜索。

每条清单字段：`id` 唯一编号，`path` 相对此目录路径，`type` 为 `sfx` 或 `music`，`category` 分类，`name` 中文名，`tags` 情绪或动作标签，`scene` 场景建议，`duration` 秒数，`loop` 是否已确认无缝循环，`loudness` 编码后实测 LUFS，`source` 原文件来源，`license` 许可证，`sha256` 交付文件校验值。四连步音效另有 `processing` 说明。

例如，读取 `manifest.json`，筛选 `type === 'music' && tags.includes('紧张')`，然后以本目录为根解析 `path` 即可本地播放。配乐的九种情绪标签全部有收录，标签为编辑建议；最终选曲应按实际镜头试听。

音频统一为 48kHz Ogg Vorbis；音效单声道约 -18 LUFS，配乐双声道约 -20 LUFS，容差 ±1 LU。配乐约 79–103 秒。本轮雨、风派生版 `loop` 和 `loopable` 为 true，已完成交叉淡化及最终 Ogg 客观接缝检查；其余为 false（旧条目缺少 loopable 时按 loop 读取）。五种地面的单次脚步过短，无法获得有效的标准积分 LUFS，故加工为每隔 0.85 秒一步的四连步并明确命名；未靠给短素材填充静音伪造响度。

`check.py` 验证文件路径、唯一性、存在性、SHA-256、实测采样率/声道/编码/时长/响度、许可证白名单、素材数量和整个目录的 150MiB 上限，并拒绝未列入清单的 Ogg。它只验证保存的许可证字段和声明，无法自动证明版权归属；许可核实记录在 LICENSES.md。执行检查需要 Python 3.9+ 及带 Vorbis/loudnorm 支持的 ffmpeg。

## 本轮补充结果与未完成项

| 要求类别 | 本轮新增 | 说明 |
| --- | ---: | --- |
| 手机震动 | 3 | Wyzowl 原作者 CC0 合成音，2 个源文件，连续来电为明确加工变体，并非 3 份独立录音 |
| 车辆 | 3 | Kenney 汽车、摩托引擎与 Dechode 原作者 CC0 合成引擎 |
| 电话铃 | 3 | 自制，CC0；可重复生成 |
| 心跳 | 3 | 自制，CC0；可重复生成 |
| 低频冲击 | 3 | 自制，CC0；可重复生成 |
| 虫鸣、街道、人群、海浪、森林、雨伞、钥匙 | 各 0 | 原始授权未完成核验或没有合格内容，不以近似声音凑数 |

新增雨声、风声循环版各 1 个，约 5.26 秒与 1.61 秒；街道、人群、海浪、森林、虫鸣循环版尚未完成。雨风沿用既有原作者随包 CC0 声明及来源，不声称重新获得原站录音。短循环可能听出重复，播放器须连续重复解码样本而不插空隙。

本轮新增文件全部 48kHz 单声道 Ogg，目标约 -20 LUFS；旧文件保留原目标。`targetLufs` 明确本轮目标，兼容旧条目。最终编码文件实际检查时长、采样率、声道、响度、SHA-256；两个循环另有样本跳变/相邻差分百分位和接缝 RMS 检查，见 [LOOPS.md](LOOPS.md) 和 `loops/*.json`。没有完成主观试听，不把客观检查声称为人工听感验收；合成内容由生成算法与原作者说明确认，第三方内容尚需在实际镜头中试听。

生成与加工脚本均纯本地，并要求显式 ffmpeg 路径：`generated/generate.py`、`additions/phone-vehicle/prepare.py`、`loop_tools.py`。自制音效声明见 `generated/LICENSES.md`；新增第三方许可证据在 `additions/phone-vehicle/licenses/`。

默认 `check.py` 验收现有文件质量；加 `--strict-request` 会额外检查本轮十二类各三条及七类环境循环版，因上述缺项应返回失败，不能把默认通过解释为任务全部完成。

```sh
python3 assets/audio-library/check.py --ffmpeg /usr/bin/ffmpeg --ffprobe /usr/bin/ffprobe --strict-request
python3 -m unittest discover -s assets/audio-library -p 'test_*.py'
```

原站访问限制与排除的候选详见 [SOURCE_RESEARCH.md](SOURCE_RESEARCH.md)。没有用 CC-BY 或 Pixabay，也没有绕过网络限制。Windows 实机测试按用户最新要求暂不执行；没有修改其他目录的测试报告。

本轮验收：默认检查退出码 0，严格需求检查退出码 1（仅上述缺项），37 项 Python 测试通过；记录见 [VALIDATION.json](VALIDATION.json)。音频本体 38,071,256 字节，整个目录约 38.3MB，低于 150MB。
