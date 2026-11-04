# 音频来源与许可

当前收录为186条 CC0-1.0 和1条 Public Domain，具体以每条清单为准。第三方 manifest.source 链接到固定提交的原始文件，自制条目链接到本分支的生成脚本，sha256 校验交付后的 Ogg。未将第三方合集的根目录许可当成逐包授权，另存原作者随包的许可声明。

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

转为 48kHz Ogg Vorbis，音效单声道、配乐双声道；仅裁去首尾低于 -55dB 的静音，按实测积分响度调整增益后再测量编码输出。本轮雨风交叉淡化版另设 loop/loopable 为 true，客观检查与限制见 LOOPS.md。情绪标签是本项目编辑建议，不是原作者的分类。

CC0 说明：https://creativecommons.org/publicdomain/zero/1.0/

五种地面共 15 条脚步素材为原单次脚步加工的四连步：每隔 0.85 秒重复一次，总计四步；随后仅裁剪首尾静音、归一响度。清单 `processing` 与中文名均有说明。其他文件未人为循环，未把同一音频的重复拷贝当作不同原作。

## 本轮新增

- 自制心跳、电话铃、低频冲击各三条：自制，CC0；[生成脚本原始页面](https://github.com/chen11-A/aijian-studio/blob/40049a9966298aae6c6058673abf945d48fba2b9/assets/audio-library/generated/generate.py)，完整声明见 generated/LICENSES.md。
- Wyzowl 手机震动：[原作者固定提交许可页面](https://github.com/wyzowl/sfx-kit/blob/92780e7ab0cdfb557497a988089c47f46e8c7412/README.md)，原作者声明全部是代码合成且 CC0。三条成品源自两条原始音效，加工重复方式见 manifest.processing。
- Kenney 汽车、摩托引擎：[原作者固定提交许可页面](https://github.com/KenneyNL/Starter-Kit-Racing/blob/2f2e5f2646dda89cb21d4e8539bab60c6e955dc8/README.md)。代码 MIT 与音效 CC0 分开，不以代码授权替代素材授权。
- Dechode 引擎：[原作者固定提交许可页面](https://github.com/Dechode/Godot-Simple-Vehicle/blob/f448b000f896053319938e4f67ddd230623da853/README.md)，明确 enginesound 生成的音频本身 CC0。

原始页面副本及 Wyzowl CC0 原文保存在 additions/phone-vehicle/licenses/。每条 source 指向具体原始文件，originalLicenseUrl 指向其发布者许可页面。新雨风循环版从原有素材派生，来源、许可与处理历史一并保留。

## 第二轮修复与长循环

所有当前清单条目已补原作者 author，固定衰减/转码不改变来源许可。第二轮9条拟音的逐包原作者声明保存在 round2/licenses/，具体来源见 round2/entries.json。8个设备环境循环沿用 Benjamin Burnes Fans and Drones 的独立录音与随包CC0声明；9个音乐循环分别沿用 effacestudios 对应原曲的CC0声明。循环派生版没有被计成新的原曲。

原雨/风/喘息短采样、其两条短循环及重复刮擦/玻璃声已撤下；前文保留历史来源说明，是否在当前库以 manifest.json 为准。完整删除清单在 ROUND2_CHANGES.json。没有将缺失原作者许可的包按合集根授权收录。

## 继续补齐38条

- 真实天气8条：`fill-gaps/weather/README.md` 及每条 `*-source.json`，原作者Joseph SARDIN、Pierre SIBANARCO，CC0；GitHub QuietField正式发布包中的独立WAV与目录SHA对应。
- 森林、海浪、虫鸣9条：`fill-gaps/nature/LICENSE_EVIDENCE.md` 与 `sources.json`，逐项原页核实；Lisa Redfern的SoundBible虫鸣为Public Domain，其余CC0。
- 两条喘息及一条倒吸气：`fill-gaps/weather-extra/README.md`，原作者Nox_Sound、jcdeegs123、jawbutch，Freesound原页CC0。
- 湿脚步、小刀挥动和刀划伤拟音7条：`fill-gaps/actions/SOURCES.md`，Freesound原作者CC0；刀划伤为西瓜拟音。
- 人群、监护仪、车辆9条：`fill-gaps/public-spaces/README.md` 及 `licenses/`，原页CC0，作者与固定镜像逐项关联；医院监护音不是现场医院录音。
- 悲伤音乐2首：`fill-gaps/music/LICENSE_EVIDENCE.md`。依据HoliznaCC0明确整音乐档案的CC0额外授权；Bandcamp通用按钮另指向CC-BY4.0，FMA直接请求403、逐曲CC0依据官方搜索索引，均已披露，不声称只存在CC0标记。

本次没有执行下载包中的应用，只读取其中音频。未进行人工试听；原站未提供原文件哈希时，不声称已完成原站字节比对。下载镜像SHA和最终派生SHA均记录在对应报告。

## 后续12条与音乐许可复核

钥匙3位作者、金属管2位作者、夜街Romano.Tercero的原作者CC0证据在 `remaining/` 及 `licenses/remaining/` 对应目录；同源分段如实标注。音乐新增证据包含Bandcamp平台官方文档、与原作者双向关联的站外CC0声明及作者当前档案授权，见 `remaining/music-review/HOLIZNA_REVIEW.md`，支持额外CC0授权，不忽略BY通用按钮。

人群三个非循环成品已替换，并新增55秒长循环；来源仍为已核实jentlemen432331，不新增原作者或冒称不同录音。证据见 remaining/crowd-loop/ 及 licenses/remaining/crowd-loop/。
