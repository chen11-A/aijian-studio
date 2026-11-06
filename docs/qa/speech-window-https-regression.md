# 新语音窗口与真实 HTTPS 回包长度回归

原完整 Python 检查在 B07 源 `ea95057`（集成 `4adba35`）报告 3 failed / 5194 passed / 6 skipped，日志 `round19-full-python.log`；pytest 失败使后续原覆盖率门未执行。本补丁只改端到端夹具和本说明，不修改生产 cap、fit、末帧上限、raw 缓存、API 或恢复策略；完整 Python/覆盖率仍需总控重新执行。

## 已核实原因

`test_xai_media_e2e.py` 的本机 HTTPS 替身忽略 POST 的实际 duration，GET metadata 固定为 2，下载始终为约 2.04 秒的真实 FFmpeg h264/24fps 文件，另带 AAC stereo 和 mjpeg attached picture。独立 MP3 原语音约 2.616 秒（24k mono，实际解码采样为准）。

旧默认 helper 没有 0.4 秒头部，0.5 秒尾部可缩短；原 49 帧视频最多增加 24 帧到 73 帧（约 3.042 秒）仍能容纳原语音。因此旧正向虽然没有照请求提供时长，仍碰巧通过。新 mandatory window 需约 3.616 秒、87 帧，超出原 49+24 帧，正确拒绝。生产实际请求是整数 4 秒，不应以固定短回包作为新正向。

三条失败的内部日志 `compose.error_code` 均为 `VIDEO_TOO_SHORT`。CDN403 那条不是不同 hold 算法：图像不能下载，完整 image/clip/voice bundle 不存在，错误文案经既有 `_named_stage_message` 显示通用“合成未成功”；内部 error_code 仍是同一短视频限制。未猜测、更改该生产分支。

## 修正和保留

- 正向 stand-in 根据实际整数请求选择预先生成的真实 4 秒同 codec/附图媒体，poll metadata 与下载一致；未匹配的请求明确 400，不暗用固定短视频。原 MP3 语音不缩短。
- URL 图像、base64、真实 CDN403→仍 POST HTTPS image URL、实际 TLS/urllib 及生产 transport 保留。原 token/prompt/revised-prompt 日志脱敏、TTS 先于 video、缓存/换台词/强制新版本次数、task 结果断言均保留。
- 正向新增实际 raw PCM 解码和最终 voice WAV 样本检查：48k stereo s16，前 19,200 样本静音、完整 body、至少 28,800 样本尾静音，以及实际成片对应请求 4 秒。未单纯放宽成功时长容差。
- 新负向使用原 2.04/2.616 形状：同一 bytes 先证明旧 helper 默认实际 49→73 帧且 MP3 原字节不变，再通过真正 HTTPS 故意返回旧短视频。必须 `VIDEO_TOO_SHORT`，raw voice/clip 留存，重试无额外 image/TTS/video 调用，脱敏仍成立。原损坏视频/FFmpeg 错误阶段与缓存重试端到端用例未删。

全部请求只到本机受控 TLS server，没有实际会员、供应商或付费调用。Windows/Electron 用户现场未在本机验证，定向结果不能替代全仓覆盖率门。

## 本次定向验收

- 首轮完整 HTTPS E2E 5 项通过，34.34 秒；随后加入 legacy 真实帧数对照，一次联合原 65 项与 E2E 5 项：**70 passed / 228.36 秒 / exit 0**。命令 `python -m pytest services/api/tests/test_xai_media_e2e.py services/api/tests/test_story_speech_window.py services/api/tests/test_story_dialogue_audio.py services/api/tests/test_story_film.py -q`，日志 `/tmp/speech-window-e2e-joint-final.log`。
- 正式 `python -m mypy`：311 source files，通过；全 `ruff check services/api scripts`、`ruff format --check services/api scripts`（565 文件）、本说明 Prettier check 及 diff check 均 exit 0。
- 此处 70 包含原 65，不再相加。原完整 Python 3 条失败仍是历史事实，本补丁没有运行/宣称完整覆盖率门通过；由总控接入后重新验收。
