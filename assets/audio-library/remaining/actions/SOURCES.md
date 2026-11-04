# 金属管动作补充：来源与限制

本组6条音效均来自真实金属管录音，按适用场景标记“钢管击打/钢管拖地”。**原作者未确认具体钢材，不能将适用场景标签解释为材料鉴定结果。** 没有金属罐替代，没有合成或变速复制，也没有使用Pixabay分发文件。击打3条来自一段录音中的三次不同动作，拖地3条来自同一连续录音的三个不重叠4秒片段；不能称为6次独立录音。尚未进行主观试听。

## 原作者许可与文件链

- [martian：182262，Foley bullet hit metal pipe.wav](https://freesound.org/people/martian/sounds/182262/)：本轮原页正常打开，明确Creative Commons 0、27.660秒、44.1kHz、16bit、单声道；作者描述为子弹击中金属管的拟音。GitHub [P-Shooters 固定提交逐文件出处表](https://github.com/MMMaellon/P-Shooters/blob/bdf721f69a9592f648c767cfe4bf0e49cf565809/Packages/com.mmmaellon.p-shooters/Runtime/Resources/Audio/GunFoley/_readme_and_license.txt) 将同名WAV直接映射该编号。获取的WAV实际格式和时长对应；从0、4.68、9.34秒分别取2.1、2.2、1.8秒，避开间隔噪声并保留击打余音。
- [RutgerMuller：104361，Metal Pipe Scraped on Concrete in Basement.aif](https://freesound.org/people/RutgerMuller/sounds/104361/)：本轮原页正常打开，明确Creative Commons 0、17.062秒、44.1kHz、16bit、立体声；作者描述大房间内拖动金属管经过混凝土地面，用Zoom H4与Rode NT4录制。GitHub [NakoDay 固定提交出处表](https://github.com/Yarnsh/NakoDay/blob/395ee18dfc6edbcf1daef1beacf5ad8dd4270319/attribution.md) 对应原名AIFF；实测17.062517秒及格式一致。取0–4、5–9、10–14秒三个不重叠片段。

entries.json逐条保留固定提交音频镜像地址、原文件及输出SHA-256、截取位置、实际响度及峰值。第三方出处表仅用于文件对应，许可依据是各原作者页面。

## 本地处理和验证

build.py只接受本地源文件，必须显式传入ffmpeg和ffprobe完整路径。转换48kHz单声道Vorbis，裁首尾低于-55dB静音；使用固定增益，以真峰值/采样峰值≤-1dB优先。部分击打峰均比高而达不到-18LUFS，明确标记peakLimited，未假填达标。validation.json保存逐文件重新解码、主检查器validate_levels及SHA-256验证结果，不等同主观试听。

## 本轮未收录的候选

- dheming177782 Pipe_Drag_01原页明确重钢管拖混凝土，但许可是CC BY4.0，排除。
- Zott820271170两根EMT管互击存在Pixabay再分发镜像线索，用户禁止该来源，因此未提取或收录。
- deleted_user_2104797的164674原页明确CC0金属管拖混凝土，但本轮未获取匹配文件，未计数。
- 人体倒水泥仍未取得新的可验证CC0原作者来源及实际文件。此前mlsulli234853原页访问失败限制保留，未重复访问或更换路线；不以木地板/地毯或普通撞击音冒充。
