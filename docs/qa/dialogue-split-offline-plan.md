# B07 离线完整句界拆镜计划（首切片）

当前交付纯 planner 与 action 适配器，供后续 UI 接入。没有编辑 Pro、没有 UI 按钮、结构替换、存盘、试听/TTS、视频派发或原音频切割。旧 `planShotDuration` 两镜流程与带素材 guard 保持不变。

## 接口

- `film/dialogue-split-plan.ts`：`planDialogueSplit(unknown)`，exact `lines / maxVideoSeconds / versions`；行 exact `speaker / text`。上限 100 行、单行 2000 UTF-16 单位、总 20000、128 个新镜，版本整数 1–4；拒绝越界或多余字段，不截断。
- `dialogueVideoCap(model,hasReferences)`：复核现 `_video_cap`，旧 grok-imagine-video 带参考 10 秒，其余已知 1.5/full-lite 15 秒；未知模型返回 null，不猜能力。
- `pro/actions/dialogue-split.ts`：`prepareDialogueSplitPreview(film,shotId,{versions})`，取现 `shotLines` 的实际兼容优先级和当前 film.draft 模型。versions 须传 UI 当前选择；现生成页选项为 1/2/4，`planVideoJobs` 上限 4。
- `dialogueSplitPreviewCurrent(film,shotId,{versions},reviewed)`：重新校验已审输入。输入摘要绑定工程/镜/选版、台词与说话人、相关创作/媒体引用、模型、cap、版本和实际拆分结果，排除 savedAt。只作预览新鲜度，不授权保存或生成。异步 hash 期间输入变化会拒绝；hash 不可用不能返回无绑定 ready。

成功为 `READY`：`timing:'estimate' / requiresSplit:true / sourceLines / parts / modelCapSeconds / versions / estimatedOriginalSeconds / headSeconds / tailSeconds / newShotCount / videoCount / limitations`，action 另加内部 `projectId / sourceShotId / sceneId / selectedTakeId / model / inputFingerprint`。内部 ID 不作 UI 文案。

parts 每项为 `{sourceLineIndex,startOffset,endOffset,speaker,text,estimatedSeconds}`。index 从 0 起；offset 是原 sourceLines 相应行的 UTF-16 索引，不是 codepoint、字幕时码或音频采样位置。每行按各 part.text 拼接严格回原串；空白、标点、CRLF、emoji 不丢。不合并不同说话行或推断未分配说话人。

`UNSUPPORTED` 的固定 code 有 INVALID_INPUT、NO_DIALOGUE、WITHIN_CAP、NO_SAFE_SENTENCE_BOUNDARY、PLAN_LIMIT、SEGMENTER_UNAVAILABLE、INPUT_CHANGED、FINGERPRINT_UNAVAILABLE。WITHIN_CAP 仅代表本次文字估计不提出拆分，不能否定真实语音已超限的后端证据。

## 时间与费用边界

复用原 speechSeconds 文字估计，按语言 sentence segmentation 及明确换行选择完整边界，保护常见英文称谓/首字母，不按字数硬切句子或 raw。完整单句仍超估计上限、无安全句界或超计划数，明确 unsupported。每新镜估计包含 0.4 秒头、0.6 秒尾并向整秒上取；不担保真实配音时长符合 cap，最终生产服务仍按真实采样验证。

`videoCount = parts.length × 当前versions`，是这份新计划的视频总数，不含未来 TTS、失败重试，不包含报价。不继承旧 1 镜确认来授权更多视频；结构接受和新预算必须另行明确确认。当前原镜头/媒体/声音与 provider 缓存均未改。

## 实际验证

- 新 planner/action 15 项 + 原 duration/explicit split 22 项，联合 4 文件 37 项通过，2.54 秒；日志 `/tmp/dialogue-split-accepted-tests.log`。没有 FFmpeg 或大构建。
- 覆盖独立 leading blank/CRLF/trailing 空白、emoji UTF-16 重建、多说话人及重复原行、英文称谓和明确换行、超过两镜、无完整句界拒绝、10/15 真模型合同与 4 版本准确视频数、closed shape/数量上限、保存时间稳定与创作/选版/工程/计数失效、async digest 期间编辑、hash 不可用，以及 0 provider/save/试听调用。
- 正式 web `tsc -b`、目标 ESLint、Prettier/diff 检查通过。没有改旧生成门、覆盖率、timeout 或供应商能力。

## 下一结构切片的必要边界

真正接受需 main 同原 transact 队列作 backup + raw CAS + 精确新 ID 替换，不可把 renderer lease/save 冒充 native CAS。新增准确 before-dialogue-split reason，备份失败零结构变化；完整原镜、音轨、旧 take/媒体/proof 留在原历史与原文件，不新增藏素材容器或解除旧带素材 guard。核心若供 main 使用，先迁为中立可编译模块，不从 desktop import renderer 或复制算法。

真实慢语速超 cap 另需 typed evidence：现 `_check_speech_window` 有 required/max/shot_index/speech_window，但失败转换把它拼入 user_message.detail，后续 applyVideoResponse 只保存展示 text。下一接口必须保留结构化证据而非从中文反向解析；可信超限允许重新提出纯估计分句，不能仅 WITHIN_CAP 关闭入口。未核实际 raw/cache/失败阶段，不宣称已保 raw 或零 video。完整粗剪消费四轨计划是后续 B08，当前不声称已完成。
