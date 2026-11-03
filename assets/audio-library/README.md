# 免费音效和配乐素材库

输入：本目录的 `manifest.json`，以及调用方显式传入的 ffmpeg、ffprobe 绝对路径。
输出：本地 Ogg 音频、中文素材元数据，以及 `check.py` 的中文检查报告。运行时不联网。

当前收录 **92 个音效、20 首配乐**。所有音频是有原作者 CC0 声明的第三方作品，经本地转码；固定提交来源见每条 `source`，授权原文见 `licenses/` 与 `LICENSES.md`。

```sh
python3 assets/audio-library/check.py --ffmpeg "/opt/音频 工具/ffmpeg" --ffprobe "/opt/音频 工具/ffprobe"
```

Windows 示例：`python check.py --ffmpeg "C:\音频 工具\ffmpeg.exe" --ffprobe "C:\音频 工具\ffprobe.exe"`。使用参数数组启动工具，不经 shell，不从 PATH 搜索。

每条清单字段：`id` 唯一编号，`path` 相对此目录路径，`type` 为 `sfx` 或 `music`，`category` 分类，`name` 中文名，`tags` 情绪或动作标签，`scene` 场景建议，`duration` 秒数，`loop` 是否已确认无缝循环，`loudness` 编码后实测 LUFS，`source` 原文件来源，`license` 许可证，`sha256` 交付文件校验值。四连步音效另有 `processing` 说明。

例如，读取 `manifest.json`，筛选 `type === 'music' && tags.includes('紧张')`，然后以本目录为根解析 `path` 即可本地播放。配乐的九种情绪标签全部有收录，标签为编辑建议；最终选曲应按实际镜头试听。

音频统一为 48kHz Ogg Vorbis；音效单声道约 -18 LUFS，配乐双声道约 -20 LUFS，容差 ±1 LU。配乐约 79–103 秒。没有未经验证的无缝循环声明，当前 `loop` 均为 false。五种地面的单次脚步过短，无法获得有效的标准积分 LUFS，故加工为每隔 0.85 秒一步的四连步并明确命名；未靠给短素材填充静音伪造响度。

`check.py` 验证文件路径、唯一性、存在性、SHA-256、实测采样率/声道/编码/时长/响度、许可证白名单、素材数量和整个目录的 150MiB 上限，并拒绝未列入清单的 Ogg。它只验证保存的许可证字段和声明，无法自动证明版权归属；许可核实记录在 LICENSES.md。执行检查需要 Python 3.9+ 及带 Vorbis/loudnorm 支持的 ffmpeg。

## 尚未满足的细分类别

虽然素材数量已达标，但此版**没有完成全部指定音效类别**：缺夜晚虫鸣、明确的街道、人群、海浪、森林、手机震动、电话铃、雨伞、钥匙、车辆、心跳和低频冲击。雷声为明确标注的拟音雷声，雨和风为音乐采样包的短环境片段；室内环境以设备底噪为主。不能把这些替代品描述为全套自然环境录音。拳脚收录重拳，摔倒使用标注为软物重落的拟音，杯子提供玻璃碰撞，均需按镜头试听。

当前环境的网络允许列表不含 Freesound/OpenGameArt；找到的其他环境音仓库只有外站下载清单，未复制未取得的音频，也未编造许可证或以生成的声音冒充第三方素材。

Python 检查器辅助测试：`python3 -m unittest discover -s assets/audio-library -p 'test_*.py'`。TypeScript 加载器及 Vitest 测试位于 `packages/aivora-modules/audio-library`；其覆盖率不代表此 Python 检查器的覆盖率。
