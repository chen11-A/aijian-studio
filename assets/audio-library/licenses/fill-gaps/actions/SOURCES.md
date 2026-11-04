# 新增动作音效：原作者许可与来源核验

本组新增 7 个不同动作：湿砂地落脚 3 个、小刀挥动 1 个、刀划伤拟音 3 个。三次湿脚步来自同一段实录的不同落脚；三次刀划伤来自同一段拟音录音的不同动作，不能称为三次独立录制。未使用合成音或改变速度复制变体，未进行主观试听。

## 已核实并收录

以下原作者 Freesound 页面通过网页工具正常打开并核实，三个页面均明确标为 Creative Commons 0。没有登录、付费调用或绕过下载限制；实际文件从 GitHub 已有合法镜像取得。原始授权页面和第三方逐文件出处对应表分别验证，镜像不是独立授权依据。条目保留原页、固定提交镜像地址、源及输出 SHA-256。

| 输出 | 原作者 / 原始授权页 | 原作者描述与内容确认 | 下载证据 |
|---|---|---|---|
| knife-whoosh.ogg | [Shamewap · 389690](https://freesound.org/people/Shamewap/sounds/389690/) | 小刀挥动；原 WAV 1.322 秒、48kHz 单声道。镜像是 MP3 转码，裁首尾静音后保留实际短动作。 | [固定提交的出处表](https://github.com/StarKnightt/counter-strike-in-browser/blob/190a277555ff6a1b7112090fc0a2db3189006db8/public/audio/CREDITS.txt) 中 knife_whoosh.mp3 明确对应389690；实际文件在 assets_src/audio_raw。 |
| knife-slash-1..3.ogg | [sillygrizzlies · 635049](https://freesound.org/people/sillygrizzlies/sounds/635049/) | 用黄油刀刺西瓜录制的划伤/刺击拟音；原文件 68.948 秒、48kHz 立体声。不声称是真实伤人声音。 | [同一固定提交出处表](https://github.com/StarKnightt/counter-strike-in-browser/blob/190a277555ff6a1b7112090fc0a2db3189006db8/public/audio/CREDITS.txt) 中 knife_flesh.mp3 对应635049；镜像的三个不同动作分别截取，具体秒数在 entries.json。 |
| wet-step-1..3.ogg | [bruno.auzet · 539175](https://freesound.org/people/bruno.auzet/sounds/539175/) | 湿粗砂地近距离脚步，含部分踩水；作者记录2009年在法国以 Schoeps CMC6 MK41 和 Sound Devices 744T 录音；原文件52.880秒、48kHz单声道。 | [tidewater固定提交出处表](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/public/audio/CREDITS.md) 将 step_wetsand.ogg 直接映射539175；[切片表](https://github.com/dgreenheck/tidewater/blob/4811ba48d795197de5621985f404e765c0b7c0ef/src/audio/soundBank.js) 记录5个动作，本组取其中第2、4、5个。 |

湿脚步镜像本身是经裁切/淡化的 Opus 精灵文件，本组再次导出独立 48kHz 单声道 Vorbis；不是原 WAV，也不是三个完整录音。均沿用 CC0-1.0。

## 处理与验收

所有条目裁掉低于 -55dB 的首尾静音，固定增益优先保证最终解码真峰值和采样峰值均 ≤ -1dB。超过400毫秒的音效朝 -18 LUFS 校准；瞬态峰均比高、必须降低整体响度时标记 `peakLimited`，不强行压缩。低于400毫秒不能取得有效积分响度，`loudness:null` 与 `loudnessNote` 如实说明，改按约 -1.8dB 峰值校准；不添加静音凑测量长度。

`build.py` 仅处理本地输入，显式接受 ffmpeg/ffprobe 完整路径。生成后逐个解码核实声道、采样率、时长、峰值和 SHA-256，结果见 `validation.json`。主清单由集成步骤合入 `entries.json`，此脚本不修改主清单。

## 尚未完成的精准动作

- 水泥地人体倒地找到 [ArmorAlley 的原始出处记录](https://github.com/scottschiller/ArmorAlley/blob/20ffcb8ff05218f79acc568e3d2d3ea45c52227f/README.md)，其五个 WAV 对应 mlsulli 的 Body Hits_Concrete.wav（234853），仓库标记 CC0；但读取原始 `https://freesound.org/people/mlsulli/sounds/234853/` 时网页工具返回“URL ... is not accessible via this tool”。工具类别为 Internal Error，未说明是权限拒绝还是不支持；已停止该页且未换路线。另检查作者正常可访问的个人主页，未见覆盖所有作品的许可声明，不能把其他作品或镜像标记当作本文件授权，所以未收录。
- BigSoundBank 的 Body Fall 2453等描述是室内瓷砖，不是水泥；钢条1772等是薄钢条掉落，不是钢管击打或拖地，均不改标签充数。
- Meta Open Sound 已下载检查，乐器是CC0，但 Oculus 动作音效集合是CC BY 4.0，不符合要求，未收录。
- 尚未找到同时具有准确钢管动作描述、原作者 CC0 证明和可取得音频的钢管击打/拖地素材。
