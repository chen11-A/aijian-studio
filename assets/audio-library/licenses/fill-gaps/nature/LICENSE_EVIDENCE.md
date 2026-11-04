# 自然录音来源与授权

2026-11-03 通过网页工具逐条读取以下**原发布页面**，核实许可、作者和录音内容。BigSoundBank 页面明确显示 CC0（公有领域），并允许改编及再分发；Freesound 明确显示 Creative Commons 0；SoundBible 明确显示 Public Domain。不是仅凭镜像标题判断授权。

| 编号 | 录音与原发布页 | 原作者 | 原页明确内容 | 授权 |
| --- | --- | --- | --- | --- |
| 2749 | [Forest #4](https://bigsoundbank.com/forest-4-s2749.html) | Joseph SARDIN | 森林鸟声、风声，户外真实录音 | CC0-1.0 |
| 2713 | [Forest and Stream #1](https://bigsoundbank.com/forest-and-stream-1-s2713.html) | Pierre SIBANARCO | 法国阿登森林小溪、鸟声和飞虫 | CC0-1.0 |
| 2715 | [Forest #3](https://bigsoundbank.com/forest-3-s2715.html) | Pierre SIBANARCO | 森林鸟声，户外真实录音 | CC0-1.0 |
| 0698 | [Sea Waves](https://bigsoundbank.com/sea-waves-s0698.html) | Joseph SARDIN | 法国 Soulac-sur-Mer 与 Lacanau 之间的大西洋岸浪 | CC0-1.0 |
| 1447 | [Small Waves, Froth and Beach](https://bigsoundbank.com/small-waves-froth-and-beach-s1447.html) | Joseph SARDIN | 距离沙滩约十厘米记录小浪和泡沫 | CC0-1.0 |
| 1046 | [Small Waves Facing the Ocean](https://bigsoundbank.com/small-waves-facing-the-ocean-s1046.html) | Joseph SARDIN | 法国诺曼底 Houlgate 海滩面向海面的小浪 | CC0-1.0 |
| 1880 | [Campaign at Night #4](https://bigsoundbank.com/campaign-at-night-4-s1880.html) | Joseph SARDIN | 法国草地晚间田野蟋蟀，偶有蛙声 | CC0-1.0 |
| 2083 | [Crickets Chirping At Night](https://soundbible.com/2083-Crickets-Chirping-At-Night.html) | Lisa Redfern | 夜间蟋蟀鸣叫 | Public Domain |
| 175020 | [AMBIENCE NIGHT FIELD CRICKET 01.wav](https://freesound.org/people/sengjinn/sounds/175020/) | sengjinn | 午夜蟋蟀实地录音 | CC0-1.0 |

每个交付循环使用一个不同原文件，森林、海浪、虫鸣各三条，不将同源不同段计作独立录音。原页 0691 的池塘内容是蛙、鸟、风，故未冒充虫鸣；1445 页无法读取，未选用，也未重试或绕过。

## 文件取得与校验

原文件来自 [QuietField v1.8.1 公开发布包](https://github.com/Gary06868/QuietField/releases/download/v1.8.1/QuietField-1.8.1-Windows-x64-public.zip)及其中随源码提供的 175020 HQ MP3。固定版本目录：[catalog.public.json](https://github.com/Gary06868/QuietField/blob/1b54955db94baa59571bb0ae3e56fcad190f2087/src/catalog.public.json)。目录关联原录音编号、作者、来源和 SHA-256；本次九个输入全部重新计算并与该目录校验值一致。选用记录保存在 `sources.json`。

175020 使用 Freesound 公布的 HQ MP3 副本，不声称是无损 WAV；其时长与原发布页面 60.433 秒吻合。其余输入为 WAV。交付全部重新编码为 48kHz 单声道 Ogg，仅添加交叉淡化和固定增益，不生成或伪造场景声音。

每个 `.ogg` 同名 JSON 保存输入/输出哈希、作者、原发布页、实测 LUFS、真峰值、采样峰值及接缝指标。CC0 文本：https://creativecommons.org/publicdomain/zero/1.0/legalcode 。未联系作者，未声称获得超出原页声明的第三方权利保证。未人工试听。
