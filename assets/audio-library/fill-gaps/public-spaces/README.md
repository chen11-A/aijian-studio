# 人群循环更新

原三个人群ID现指向 `../../remaining/crowd-loop/` 的17秒实际循环，另有55秒长版。旧3个非循环Ogg已移除；本目录保留来源和初始处理记录，人群当前重建请使用新目录脚本。监护仪与车辆素材不变。

# 人群与监护仪音效补充

6条48kHz单声道Ogg：会议厅人群低声交谈3段，监护仪规律提示、逐渐加速、持续长鸣各1段。每类3条均来自一个CC0原片不同位置，不是3个独立原作。监护仪为第三方制作音效，不是假称医院录音。

许可证原始页面、镜像固定提交及匹配依据见 licenses/；清单见 entries.json。目标-20 LUFS，编码后实测-20.39至-19.95 LUFS，真峰值最高-1.49 dBTP。短淡化只避免切点爆音，不保证无缝循环，loop均为false。

离线重建：先按清单downloadSource准备两个文件（crowd为HTML中AMBIENCE.crowd的base64解码结果），然后：

```sh
python prepare.py --ffmpeg /绝对路径/ffmpeg --ffprobe /绝对路径/ffprobe --crowd /绝对路径/crowd.mp3 --monitor /绝对路径/monitor.mp3
```

脚本不联网，工具路径均通过参数传入，支持中文和空格。医院走廊和连续街道夜景仍需另外采集，不能用本目录会议厅声冒充。

另有3条车辆驶过（vehicle-entries.json）：夜晚郊区街道、汽车路边驶过、乡间公路车辆，均为第三方真实录音，来自3个不同原作者。乡间公路使用数据集12.955秒节选，原始48.439秒的节选位置未知，明确记录在许可说明和清单。48kHz单声道Ogg，实测-20.52至-19.84 LUFS，最高真峰值-1.82 dBTP。

```sh
python prepare-vehicles.py --ffmpeg /绝对路径/ffmpeg --ffprobe /绝对路径/ffprobe --night /绝对路径/night.wav --passing /绝对路径/passing.wav --country /绝对路径/country.wav
```

车辆文件不循环，不扩展为虚构的30秒街道原始录音。

## 本轮检索缺口与受限情况

主整合需同时读取 entries.json（6条人群与监护仪）和 vehicle-entries.json（3条车辆），合计9条，Ogg文件共790931字节。两个离线脚本分别更新对应清单，不会自动修改全库 manifest.json。

已验证但未取得文件的真实医院来源：BigSoundBank 原作者 Joseph SARDIN 的 Motherhood: Corridor，ID0874，149秒产科走廊真实录音，原页 https://bigsoundbank.com/motherhood-corridor-s0874.html 正常读取并标CC0。BigSoundBank 的命令行首次请求403，当前网络白名单不含该域；未重试该下载路线，也未绕过限制。允许访问的 GitHub QuietField 发布包仅含50条其他BigSoundBank音频，无0874医院或对应夜街内容，因此不能用其风声/风扇替代。

继续检索的医院候选有 Freesound bassboybg 的 Hospital corridor / Hospital waiting room，以及 Daphne_in_Wonderland 的医院荧光灯声音；这些尚未形成原始许可验证加对应可下载文件的完整链路，不收录。GitHub搜索未找到对应文件；VocalImitationSet原录音目录无hospital/fluorescent医院素材，仅存在bassboybg的骑车录音，不能混用。

夜街候选 BigSoundBank Paris by Night（约81秒）尚未取得原始页面与音频对应证据，不收录。当前唯一明确夜晚街道来源是robotjay的10.824秒汽车经过，作为单次车辆音效保留；没有拼接、变速或重复冒称30秒原始连续街道底噪。

其他排除：rzen1th/rzen1th-audio-comprendium原作者说明仅允许非商业用途；Wikimedia Restaurant ambience 公有领域原页虽已验证，但所查 GitHub HushMic仅含下载引用，未得到对应原音频。Freesound部分候选原页返回不可访问（233465、262759、209767），未重试绕过，改选另外三个正常可核实CC0的车辆来源。

后续医院候诊室核查：Freesound bassboybg 的 Hospital waiting room（https://freesound.org/people/bassboybg/sounds/201638/）原始页已正常核实 CC0；作者明确 Zoom H4N 内置麦克风录制医院候诊室，83.041秒、48kHz、24位立体声。它是候诊室而非走廊。
论文对应仓库 sunghoon-most/Wheeze_Counter（提交 bbb6a22c98db8a4dffedef595f0203186d9c3416）仅找到 `test_data_hospital_noise_overlapped.wav` 及降噪版本、`validation_combined_audio_hospital_background.wav` 等与呼吸数据叠加的文件，未发现独立候诊室原音频。检查了完整目录和笔记本源码，未下载或提取病患/混合音频，故不收录该仓库音频。
