# AIVORA 本地 CC0 音频素材库

当前清单 **107 个音效、29 个配乐文件**，其中配乐是 **20 首独立作品＋9 个循环派生版**，不能把派生版计为新增曲目。每条 `manifest.json` 都记录 `author`、具体 `source`、许可证、用途、时长、实测响度、真峰值、采样峰值及 SHA-256。所有处理在本地运行。

## 使用和验收

```sh
python3 assets/audio-library/check.py --ffmpeg /usr/bin/ffmpeg --ffprobe /usr/bin/ffprobe
python3 assets/audio-library/check.py --ffmpeg /usr/bin/ffmpeg --ffprobe /usr/bin/ffprobe --strict-request
python3 -m unittest discover -s assets/audio-library -p 'test_*.py'
```

FFmpeg/ffprobe 必须使用完整路径；可含中文和空格。默认检查验证现有文件的采样率、声道、时长、许可证字段、作者、校验值、响度和两个峰值，可循环条目还逐声道实测接缝。`--strict-request` 额外检查第二轮的类别数量、真实雨风、环境与音乐循环等；仍有素材缺项时返回非零，不能把常规通过当作全部需求已满足。

## 峰值优先

全部 48kHz Ogg Vorbis；音效单声道、配乐双声道。短音效不强行追到 -18 LUFS。修复通过固定衰减保留瞬态，不以大幅压缩/削波换响度；最终编码后重新解码测量，要求真峰值 ≤ -1 dBTP、采样峰值 ≤ -1 dBFS。响度可以低于目标，`peakLimited` 与 `processing` 说明原因，`loudness` 保存实际值。极短音效不足 400 毫秒、无法得到有效积分响度时，可用 `loudness:null` 和中文 `loudnessNote`，峰值检查仍必须通过。

基线129个文件实测62个采样峰值超过0dBFS，最高+15.332722dBFS；80个超过-1阈值的文件重新衰减编码。这些历史处理逐条记在 `PEAK_REPAIR.json`；其中部分文件后来按用户要求删除，最终库峰值以最新 `VALIDATION.json` 为准。方法见 [PEAK_SAFETY.md](PEAK_SAFETY.md)。

## 第二轮新增和删除

新增26个文件：3个金属罐撞击、1个金属罐拖动、2个刀切划拟音、3个水泥脚步快跑节奏拟音、8个独立设备环境循环、9个不同情绪的配乐循环派生版。刀声不是人体受伤实录，金属罐不冒充钢管，节奏构建的奔跑不冒充现场录音。

删除19个文件：9个重复厨刀刮擦、5个相似玻璃碰撞、原雨声/风声/喘息三个音乐包短采样，以及两个基于这些短采样的雨风循环版。原来的真实手机震动等补充仍保留。完整逐条清单见 `ROUND2_CHANGES.json`。

## 循环

8个环境循环来自Benjamin Burnes不同的设备实录：通风口、浴室风扇、电脑风扇、除湿机、微波炉、室外空调、室外底噪、水槽龙头；每条40秒，不靠重复一秒片段凑长度。它们不是医院/雨夜街道等指定场景的替代品。

九种情绪各有一个音乐循环，保留双声道，约40–46秒。`loop`/`loopable` 均为 true，尾首交叉淡化，最终Ogg逐声道接缝测量见 `round2-loops/*.json`。客观边界连续不等于音乐乐句/和声已完成人工验收；本次未完成主观试听，长时间铺底仍需听感确认。细节见 [LOOPS.md](LOOPS.md)。

## 仍未满足

- 真实雨声和风声≥30秒循环、真实喘息、雨打伞、雨打窗仍缺；已撤下不适合的短采样，没有用假标签代替。
- 雨伞开合、街道/小巷夜晚、湿地脚步、钢管击打/拖地、人体摔在水泥地、医院监护仪/走廊底噪、人群低语、车辆驶过尚未补齐。
- 刀切划只有2条，未达到3条；悲伤只有1首独立作品（及其循环版），还缺2首。
- 手机震动、电话铃、心跳、低频冲击各3条沿用上一轮；水泥奔跑拟音和金属撞击本轮各3条。引擎声不计为车辆驶过，普通金属罐不计为钢管。

用户指定的部分lavender子包未找到包内原作者许可，OpenGameArt页面查询遭不可重试的访问限制；未拿合集根许可证代替原作者许可，未绕过限制。已有随包原作者CC0声明的素材正常收录。证据与未收录候选见 `LICENSES.md`、`SOURCE_RESEARCH.md` 和 `round2/README.md`。

所有新素材及派生版可由同目录脚本复现；`round2-loops/build_loops.py` 需额外安装 NumPy，其余工具依各自说明。脚本不联网或自动安装。Windows实机测试按用户要求暂缓。对应 TypeScript 加载器、调度器及详细交付报告在 `packages/aivora-modules/`，各模块覆盖率不代表 Python 检查器覆盖率。

最终136条普通实测通过：最大真峰值-1.05dBTP、最大采样峰值-1.052554dBFS、超标均0；目录约47.8MB。42项Python测试通过。原样输出见 `CHECK_OUTPUT.json`；严格18项缺口见 `STRICT_CHECK_OUTPUT.json`。
