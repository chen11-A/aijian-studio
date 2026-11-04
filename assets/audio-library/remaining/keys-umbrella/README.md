# 钥匙与雨伞缺口补充

本轮交付三条不同原作者的真实钥匙录音片段。没有把键盘按键、音乐的 key 或掉落道具的游戏提示音算作钥匙。

| 编号 | 原作者 | 录音内容 | 本库时长 |
|---|---|---|---|
| 131437 | sKydran | 摇动钥匙 | 5.387 秒 |
| 173943 | JohnsonBrandEditing | 一串钥匙叮当声 | 5.378 秒 |
| 235564 | SkeetMasterFunk69 | 钥匙晃动声 | 5.838 秒 |

原作者 Freesound 页面分别核实为 Creative Commons 0；详见 `sources.json`。实际文件来自 VocalImitationSet 固定提交 `b77114c43c52f5faa7d0bb69b22e1ebca0632201` 的 `original_recordings/non_reference`，文件名中的作者、编号、录音名与研究库索引对应。后两条是研究库保留的短片段，不是原站38.581秒和12.964秒录音的完整版本。没有使用 `vocal_imitations` 中的口技模仿声音。原站未发布哈希，不宣称完成原站逐字节比对。

处理结果为48kHz单声道OGG，固定增益且峰值安全优先；没有拼接凑时长，没有标可循环。每条的最终实测JSON记录响度、真峰值、采样峰值和文件SHA256；全部峰值≤-1dB。瞬态明显，响度低于-18LUFS属保峰结果。未人工试听。

## 离线构建

`build.py` 是本轮实际构建脚本，共用 `../../fill-gaps/weather/rebuild_common.py` 和素材库 `loop_tools.py`。将合法获得且SHA256与 `sources.json` 一致的三份输入放在同一目录，命名为 `131437.wav`、`173943.wav`、`235564.wav`。

```sh
python3 build.py --ffmpeg "/usr/bin/ffmpeg" --ffprobe "/usr/bin/ffprobe" --input-dir "/本地/钥匙 原件" --output-dir "/本地/新的钥匙输出"
```

Windows使用Python及对应程序完整路径，例如 `C:\工具 目录\ffmpeg.exe`。所有子进程使用参数数组，不经shell；输入输出支持中文和空格，输出目录必须尚不存在。脚本不联网、不运行外部下载程序、不改主manifest；生成OGG、测量报告及待整合entries。Vorbis随机流编号和不同编码器版本可能导致字节哈希不同，复现指处理步骤及技术验收，而非跨版本字节一致。本轮已用含中文和空格的输入输出路径实际运行通过。

## 雨伞仍未交付

本轮新增检索并检查 GitHub `DanielsHappyWorks/ObstacleCourse`：游戏确有 `SC_Umbrella.uasset`，但读取其引用发现对应的是 `702880__crudewax__bottle-rubber-cap-pop`，属于瓶塞弹出声，不是真实雨伞开合，未收录。本地 lavender 的七条 keys_*.ogg 属无包内原作者许可证的旧候选，未使用；Benjamin Burnes 的 Keyboard Sounds 是键盘，不算钥匙。Meta音效目录中无 umbrella 条目。没有重试被拒的 BigSoundBank shell 或 GitHub search API。
