# 音频包络执行：picker 接线的依赖切片

本切片只补现有共享混音计划、真实 WebAudio 预览及 FFmpeg 导出的可选包络执行能力，不接自动挑选、native 批量复制或新 UI，不声明全部 4B-B05 已完成。原 picker 算法与素材库、QC schema/严重度、归一化开关及原付费路径均未改。

## 创作字段与时间

`AudioClip.envelope` 是可选创作数据：`schemaVersion: 1`、`baseGainDb`、可选 `fades` 及 `gainAutomation`。旧 clip 不带该字段时保持原音量行为。时间统一为相对该 clip 起点的秒数；源 `offsetSeconds` 和循环取模只改变所读声音，不重启包络。裁镜后的 fade 起点允许为负。

- `clip.gainDb` 始终为原本的当前片段绝对增益。`baseGainDb` 只是 picker 原始 cue 的参考，不能再加一次。
- automation 区间内：实际 dB = 当前 clip gain + automation gain − base gain + 整轨 gain；区间外回当前 clip gain + 整轨 gain。例如 base −6、automation −12、用户将 clip 改成 −3、整轨 −2，区内 −11 dB、区外 −5 dB。相邻区间交界以新段值生效。
- 每个 fade 是线性振幅的 `in/out` ramp。镜头片段 fade、场级 music fade 等每组因子相乘，不把 dB 或多个 fade 相加。已有 score 0.3/0.5 秒 duck 仍只作用一次；solo 继续原试听语义。
- 每 clip 至多 8 个 fade、64 个非重叠 automation 区间；字段严格验证、数值有限有界，fade 时长至少一个 48 kHz 样本。坏包络保留为创作数据供处理，不能被 normalization 仅删掉字段后按未加窗的全音量执行；可信 main 拒绝无效数据。

共享纯 JS validator/evaluator 编译为现有 CJS runtime。WebAudio 从同一曲线按真实 film clock/seek/rate 调度 AudioParam step/ramp；多个 GainNode 相乘，循环不重置。当前增益为零的活跃 fade 源仍先加载，避免从零淡入时等声音出现才读文件。FFmpeg 使用同曲线生成有界、平衡求和的数字表达式，放入既有私有 `filter_complex_script`，通过 sample-clock `aeval` 执行；保留原采样时钟修复、mono/stereo 等幅、128-track 与 Windows argv 边界。锁定的 FFmpeg 7.1.5 的 aeval 会使 AAC 仅见“2 channels”，因此显式重申 stereo channel layout，未改变声音增益或 QC 门。

## 实际验证

- desktop 7 文件 58 项通过：新包络点位与原 mix、原 8 媒体及新 2 项真实 FFmpeg、真实 Ogg normalize→实际 ZIP→新工程→可信 resolver→实际音轨、原 QC/owner/runtime。`/tmp/audio-envelopes-native-third.log`，exit 0。真实媒体检查负 fade origin、叠乘全局 fade、短源真实 probe/循环、时窗幅度、64 区间实际执行、原文件 bytes 不变。
- 随后新增 score duck 恰一次的点位/solo 断言；独立纯计划文件 12 项通过，`/tmp/audio-envelopes-duck-final.log`，exit 0；与前述 58 范围重叠，不累加成一个总数。
- web 6 文件 16 项通过：真实组件 fade=0 的读取/节点、seek/rate/solo/断连、调度曲线、normalization 保留及旧 audio/宿主入口，`/tmp/audio-envelopes-web-final.log`，exit 0。
- workspace 正式类型、生产 build、目标 ESLint/Prettier、diff check 通过；contract runtime builder 实际编译并 require 新 evaluator。隔离 app 只放实际 desktop `dist/film-audio-mix.js` 与构建的 contracts CJS，成功 require/构造包络执行参数，不回退仓库 TS 源码。

前两轮真实媒体暴露 AAC channel-layout 故障，修后上述真实链路才通过；没有放宽幅度/严重度/超时/并发门。正常 Electron/Windows 用户试听未在本机实测，亦不声称已经听过素材。

## 后续接线边界

下一切片才将原 picker 的完整 `segments`、场级 ambience master 一次、最终增益 automation、music 总 fade 编译到创作数据，并保留来源/实际时钟、canonical CAS 批量 copy 与外部保存 lease。不能同时叠加场级 ambience 与镜头裁切 views，不能压扁多资源 segments、重复 duck、静默截断 10,000 段或用路径作为授权。ActionNode.at / sound.sfx.atSeconds 只是明确创作计划时间，后续必须核实际镜长；无时间不猜，也不称已经对准实际画面动作。
