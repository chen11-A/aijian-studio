# 第二轮可核实新增素材

本目录的 `entries.json` 供主流程合并；制作时没有修改主 manifest，也没有删除之前的素材。

本轮新增 9 条：三条压扁金属罐碰撞、一条金属罐拖瓷砖、两条刀切划拟音、三条水泥地快步节奏。每条均有原作者 `author`、固定提交 `source`、包内原作者许可 `licenseEvidence`、实测响度和峰值、SHA-256。

| 来源包 | 原作者 | 本地原文 |
|---|---|---|
| Micro Pack - Small Can | Benjamin Burnes | licenses/ben-small-can.txt |
| kenney_rpgaudio | Kenney Vleugels | licenses/kenney-rpg.txt |
| kenney_impactsounds | Kenney Vleugels | licenses/kenney-impact.txt |

来源为 `lavenderdotpet/CC0-Public-Domain-Sounds` 固定提交 `f2b6264f9ab89fabc266914c3654685d68c5a39b`；使用的是包内原作者独立 CC0 声明，而不是合集根目录 LICENSE。

处理：转为 48kHz、单声道、Ogg Vorbis。增益为达到 -18 LUFS 所需增益与峰值安全增益的较小值，给编码留约 2dB 余量，再解码复测；不为达到目标响度而牺牲峰值安全。因此部分短促音效的积分响度明显低于 -18 LUFS，这是有意保留动态的结果。交付九条真峰值最高 -1.73 dBTP，采样峰值最高约 -1.80 dBFS。

内容界限：金属罐不能冒充钢管。刀切划为 Kenney 的 `knifeSlice`，不是厨刀刮擦，但没有把它标为人体划伤录音。水泥快步使用三个不同的原始水泥脚步，分别按每 0.28 秒一步排列八步形成节奏；已在名字和 processing 中说明，不是现场奔跑录音。没有把普通设备底噪标成医院走廊，也没有把车辆发动机标成车辆驶过。

## 尚未收录的候选与阻碍

指定的 `30-cc0-sfx-loops/rain.ogg`、`100-cc0-sfx-2/sfx100v2_footstep_wet_01..03.ogg`、`100-CC0-wood-metal-SFX/keys_01..07.ogg` 等确实存在，已下载研究；但这些包内部未找到原作者 README 或许可文件。按本轮要求核查 OpenGameArt 原页时，网页工具返回：`Blocked by robots.txt`，`opengameart.org`，`non-retryable error`。没有绕过该拒绝，未将合集根目录的 CC0 声明冒充原作者证据。

`Micro Pack - NazdyNate - Electromagnetic Sounds` 有 Benjamin Burnes 随包 CC0 声明，文件包括 `NazdyNate - Cell Phone 1..3.wav`。但这些属于电磁拾音包，不能仅凭文件名断言是手机的物理震动，故未新增为“真实手机震动”。此前已有手机素材仍保留。

真实长雨、雨打伞／雨打窗、真实风和喘息、湿地脚步、钢管击打／拖地、人体水泥倒地、医院底噪／监护仪、街巷底噪、人群低语和车辆驶过仍没有在本轮取得同时满足内容与原作者许可证据的新增录音。刀切划只有两条，未人为复制凑三条。
