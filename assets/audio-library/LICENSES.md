# 音频来源与许可

所有收录文件的许可证均为 CC0-1.0。每条 manifest.source 都链接到固定提交的原始文件，sha256 校验交付后的 Ogg。未将第三方合集的根目录许可当成逐包授权，另存原作者随包的许可声明。

## 配乐

作者发布仓库：[effacestudios/Royalty-Free-Music-Pack](https://github.com/effacestudios/Royalty-Free-Music-Pack/tree/2ce8458293fe4eeb91414a19d6d7ecd1562a5949)。仓库 LICENSE 为 CC0 1.0，原文保存在 licenses/effacestudios-CC0.txt。

## 音效

分发仓库固定提交：[lavenderdotpet/CC0-Public-Domain-Sounds](https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds/tree/f2b6264f9ab89fabc266914c3654685d68c5a39b)。逐包原作者授权如下：

- `kenney_rpgaudio`：Kenney Vleugels，CC0，原文 `licenses/pack-01.txt`。
- `kenney_impactsounds`：Kenney Vleugels，CC0，原文 `licenses/pack-02.txt`。
- `Micro Pack - Organic Wooshes`：Benjamin Burnes（随包声明；协作人员见原文），CC0，原文 `licenses/pack-03.txt`。
- `Micro Pack - Kitchen Knives`：Benjamin Burnes（随包声明；协作人员见原文），CC0，原文 `licenses/pack-04.txt`。
- `bb - Books, Paper, Writing (Jan 2021)`：Benjamin Burnes（随包声明；协作人员见原文），CC0，原文 `licenses/pack-05.txt`。
- `bb - Fans and Drones (Jul 2021)`：Benjamin Burnes（随包声明；协作人员见原文），CC0，原文 `licenses/pack-06.txt`。
- `BB_2HTC Samples Vol 4`：Benjamin Burnes（随包声明；协作人员见原文），CC0，原文 `licenses/pack-07.txt`。
- `Micro Pack - Chairmat`：Benjamin Burnes（随包声明；协作人员见原文），CC0，原文 `licenses/pack-08.txt`。

## 处理说明

转为 48kHz Ogg Vorbis，音效单声道、配乐双声道；仅裁去首尾低于 -55dB 的静音，按实测积分响度调整增益后再测量编码输出。没有声明无缝循环，loop 均为 false。情绪标签是本项目编辑建议，不是原作者的分类。

CC0 说明：https://creativecommons.org/publicdomain/zero/1.0/

五种地面共 15 条脚步素材为原单次脚步加工的四连步：每隔 0.85 秒重复一次，总计四步；随后仅裁剪首尾静音、归一响度。清单 `processing` 与中文名均有说明。其他文件未人为循环，未把同一音频的重复拷贝当作不同原作。
