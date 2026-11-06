# 人类呼吸录音补充

交付两条连续真人喘息和一条单次倒吸气。单次倒吸气不能算作第三条连续喘息，雨伞开合本轮仍未补齐。

- `757113`：jcdeegs123 的 Heavy Breathing，作者说明在走人行道时录制。原页时长24.448秒。
- `554906`：Nox_Sound 的 Male_Breath_Scared_Frozen_Loop_Stereo.wav，男性受惊或发冷喘息录音，原页7.047秒。
- `344407`：jawbutch 的 Male Gasp 1.wav，男性单次倒吸气，原页0.666秒。

三条 Freesound 原作者页面均独立确认 Creative Commons 0。每条 `*-source.json` 保存网址、作者和许可摘录。

前两条实际下载来自 GitHub `crafter-games/the-ones-game` v0.7.3 发布包；其 CREDITS.md 在固定提交 `b8d496e2bd0cfe09a29c107e28c111b5f29d8281` 将编号、作者对应到 `assets/audio/vhs/breathing.mp3` 和 `assets/audio/night/breath_scared.mp3`。通过读取未加密 Godot PCK 目录，提取对应 `AudioStreamMP3` 数据；没有运行可执行程序。字节资源名称分别为 `.godot/imported/breathing.mp3-fab3996c358058de512f564b2f53e199.mp3str` 和 `.godot/imported/breath_scared.mp3-8fcfd8ac0b6f2794254b8f4dd8b48710.mp3str`。MP3 头计时与原时长相差约0.03秒，符合编码填充。原站未公布SHA256，不宣称与原站逐字节比对。

倒吸气来自 VocalImitationSet 固定提交的 `original_recordings/non_reference` 原录音目录和编号作者索引，不使用 `vocal_imitations` 模仿录音。文件名：`344407__jawbutch__male-gasp-1.wav`。

仅本地固定增益、单声道48kHz Vorbis转码；没有重复短片延长时长，没有标记可循环。最终真峰值与采样峰值优先。未进行人工试听。

## 本轮进一步研究

- AderuMoro 213289、LittleRainySeasons 345060 原页明确 Attribution 4.0，不符合本库 CC0 要求，已排除。
- artmasterrich 345435、drkvixn91 317478、11linda 350313 页面返回工具不可访问，未取得可核实许可，未收录。
- 雨伞搜索发现 qubodup 的第三方目录条目，但仍无合法镜像与原页双重核实结果，未把第三方标签当授权。
- FoleySet 论文显示含 Umbrella 类，发布在 Zenodo；尚未取得对应原文件与逐项许可证据，不能算交付。

## 离线重建脚本

`rebuild.py` 收录实际使用的处理顺序；共用 `../weather/rebuild_common.py` 和素材库根目录 `loop_tools.py`。输入目录放置已经提取的 breathing.mp3、breath_scared.mp3、jaw-gasp.wav，均须与本目录来源证据的 sourceSha256 一致。脚本不接受或运行下载的 EXE。

```sh
python3 rebuild.py --ffmpeg "/绝对路径/ffmpeg" --ffprobe "/绝对路径/ffprobe" --input-dir "/本地原录音 中文" --output-dir "/新的构建输出"
```

Windows 可将程序路径改成 `C:\工具 目录\ffmpeg.exe`、`C:\工具 目录\ffprobe.exe`，使用 `python` 运行。程序参数用独立数组传给子进程，不经 shell；支持中文和空格。输出目录必须尚不存在；不写现有音频、entries 或主 manifest。新目录产生 OGG 与最终实测 JSON。遇原录音哈希不符、格式、峰值或接缝不合格即失败。

这里的“可复现”指使用已保存校验值的原音频和同一处理步骤重建并实测验证；原始文件需事先合法取得，本脚本不联网。Vorbis 的随机流编号以及 ffmpeg/编码器版本可能使输出文件 SHA256 不同，不承诺跨版本逐字节一致。新增脚本本次仅做语法和命令行检查，没有重新转码已锁定音频。
