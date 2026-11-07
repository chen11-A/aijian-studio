# B07 真实语音超限：服务结构化事实（服务先行）

本切片仅补服务事实、实际 API 回执和生成合同；尚未实现主进程 opaque registry、local scope 绑定、renderer transient 缓存或 native prepare 的强制分句消费。没有新端点、供应商调用、预算/派发绕过或 raw 音频切割。

## 可信产生点

只在 `_live_media` 两处已知的本目标 pre-video speech check 附加 `StoryDialogueLimit`：新取/复用 raw 配音后的真实采样时钟检查，以及完整旧 bundle 的本次复用前检查。它们尚未进入该目标本次 `_live_video`。原 `_check_speech_window`、shot-list 后置检查、normalize 等其他失败仍没有该旗标，不能凭 DIALOGUE_VIDEO_LIMIT code 猜零派发。

`raw_audio_saved` 只在实际 cache 文件的有界读取 bytes 与刚测量的 raw speech 完全一致时为 true，同时返回其 SHA256；文件缺失/变更不能称已保存。读取最多已持有 raw bytes 长度加一，不增加无界文件分配。原 `_image_stem`、provider raw cache、旧 policy、原 artifact/proof、同幂等与 caps 不变。

single 的 shot_index 为 null；shot-list 来自真实 child 的 1-based index。`target_video_submitted:false` 只表示本目标在本次请求尚未派发，绝不表示整个 batch 或此前版本没有视频。早先已完成目标仍可存在。

## API

`StoryFilmResult → StoryFilmData` 新可选 `dialogue_limit`：

```text
schema_version: 1
required_seconds: finite positive seconds (includes the verified speech window)
max_seconds: 10 | 15
shot_index: null | positive 1-based index
speech_window: 1
target_video_submitted: false
request_sha256: internal 64-hex digest
raw_audio_saved: boolean
raw_audio_sha256: internal 64-hex digest | null
```

`request_sha256` 是 UTF-8 SHA256 of compact JSON ordered array：`[video_model, effective_voice_id, delivery, narration, ordered [[speaker,text,voice_id],...], speech_model]`，ensure_ascii=false，分隔符逗号/冒号不加空格，与 main JSON.stringify 对应；不是完整 HTTP/header/cache key。字符串来自真实服务 target request，不从人读提示倒推。签名、raw SHA、正文与 voice ID 不用于用户显示或公开诊断，更不授信文件路径。

旧 user_message/code/detail 保留；消费者不需正则解析中文。新增可选 dataclass 字段放在旧 optional 字段之后，保留旧调用形状。原 `contracts:generate` 更新 OpenAPI 与 generated.ts，没有降低 contracts check。

## 实际验证

`/tmp/dialogue-limit-service-final-tests.log`：12 passed、14 未选，5.94 秒。新 9 项事实/API/producer 回归，加原 3 个实际 48k/cap/raw-cache retry 边界。保留真实旧 10 秒/1.5 15 秒 cap 与 raw bytes，不放宽 fit 容差或原断言。

覆盖：single/null 与 1-based index、raw missing 不伪 saved、请求话音/voice/delivery/视频和 TTS model 变化签名不同、真实 produce 失败转换保事实、同幂等 replay BLOCKED 且无追加上游、真实 cached bundle cap 在本次 0 HTTP、真实 shot-list 先处理本地替身第 1 个视频再第 2 目标超限（不宣称 batch zero）、后置通用检查无旗标、真实 loopback TestClient API 序列化与旧 user_message 同存。仅 scripted/local provider replacements，没有真实会员/付费调用。

目标 mypy 三源文件、Ruff check/format、生成 contracts 类型与 Prettier、提交后原 contracts check 通过；没有改全局覆盖/timeout/worker。原完整 Python/覆盖门仍由总控在 API 冻结后验，不以这 12 项代替全仓通过。

## 后续边界

main 必须在真实 story-film:create 回执中 mint session/owner-bound transient ID，关联已核 canonical local project/shot 与实际 target 请求，不能猜同文本多镜，也不信 renderer 自造 raw/零视频 flags。旧无 scope 调用继续兼容但不 mint。opaque ID 只能在 module 内存/registry，不写 FilmProject/history/ZIP；持久数字历史摘要不是授权，重启/导入不能假消费旧 proof。
