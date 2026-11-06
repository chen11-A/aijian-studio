# 本机语音头尾留白：首个生产切片

本切片对新生成的真实订阅语音启用 `speech-window-48k-v1`：配音经现有响度处理后，48 kHz PCM 加 19,200 个头部静音样本及至少 28,800 个尾部静音样本。完整语音样本保留；较长画面与整秒请求可以留下更长的尾静音，不将多出的画面裁到“刚好 0.6 秒”。画面仍守所用模型的真实单镜上限，新增末帧保持不超过 24 帧（当前本机 CFR 24fps）。不足以容纳完整语音及强制留白时明确失败，不缩短留白、不自动重新生成。

## 生产与兼容边界

- `_live_media` 在已保存原始 TTS 后，以解码实际样本时钟计算完整语音加 1 秒，并在 video 请求前检查上限；同镜自动升整数秒保留。当前 1.5/1.5-lite 为 15 秒，旧 `grok-imagine-video` 带额外参考为 10 秒。超限返回原 `DIALOGUE_VIDEO_LIMIT`，详情明确含头尾留白，图像/原始语音缓存保留，视频调用为零，不将一个视频扩大为两个。
- `_image_stem`、`_saved_bundle`、provider 原始 clip/voice 字节及缓存命名不变。重试使用相同 raw；新窗口只进入本机派生媒体、真实 assembly 音频 SHA 和新的 story-film manifest。旧订阅幂等提交仍被原规则阻止，未改成自动重派发。
- shot-list 每镜独立应用一次；aggregate 复用已处理 PCM，不再重复加窗或做会污染静音边界的响度重采样。各镜独立守 cap，aggregate 上界是各镜 cap 之和，不能按原预计秒数之和裁掉自动升时长后的后镜。
- 旧 `_normalize_film_media` 默认仍无头部、0.5 秒可选尾部。旧 artifact、现存 assembly 及 clean remake 不执行当前新窗口默认；恢复只重用其真实媒体引用。没有真实台词的占位/静音不伪造语音留白策略。
- 字幕仅是布局 cue：按已知头部留白移动整体起点并对齐画面帧，不由 `alignment: true` 推断逐词时间或口型证据。原本的跨镜画面/静音交叉淡化保留；不切原对白来凑时长。

## 离线验收

`test_story_speech_window.py` 使用真实短 FFmpeg 画面及可识别 PCM，验证逐样本前后静音/body 原样、末帧保持上限、强制尾部不足拒绝、legacy 默认、旧/新模型 cap、超限原始缓存重试零 video/不重复 TTS、无台词、单镜及 shot-list 只加窗一次、两镜 2+2 秒预计实际请求 3+4 秒且 join 后 6.6 秒、第二镜 body/cue 完整、实际长回包帧数守 cap、真实 assembly 派生音频 SHA/post-tag proof/无付费恢复原文件不变。

运行范围还包括既有 `test_story_dialogue_audio.py` 与完整 `test_story_film.py`（原恢复、最终 proof、媒体流与错误路径）。所有上游回复均为受控替身，无真实账号、会员或付费调用。实际供应商回包、正常 Electron/Windows 用户窗口未在本机验证。

这不是全部 B07：长对白自动结构建议与重新确认多镜预算、没有逐词时间时的真实音频分段、粗剪与最终共用四轨混音的完整对齐仍属后续切片；本实现不自动拆音频或增加视频调用数。

本切片最终同源码定向验证：

- `python -m pytest services/api/tests/test_story_speech_window.py services/api/tests/test_story_dialogue_audio.py services/api/tests/test_story_film.py -q`：65 passed，163.16 秒，exit 0。新文件 17 项，原两文件 48 项；日志 `/tmp/speech-window-accepted-tests.log`。其中包括只比真实 cap 长 3 帧的旧/新模型回包及无台词参考镜头，最终按 decoded frame count 核验。
- `python -m mypy`：311 source files，exit 0；`ruff check services/api scripts` 与 `ruff format --check services/api scripts`：通过，后者 565 文件，均 exit 0。
- 自有说明 Prettier check、`git diff --check`：通过。未改变 OpenAPI/DTO，未重跑无关 TS 或完整 Python 覆盖率门；完整 CI/覆盖率由总控集成执行。
