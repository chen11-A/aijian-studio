# Phase 0 Fake 媒体包合同

状态：Implemented local primitive；尚未接入 Fake Timeline/API/UI，K01 仍在进行

## 目的

K01 的时间线不能继续引用人为派生的“假哈希”：现有导出器要求 `TimelineAssetV1` 引用真实媒体字节的 SHA-256。本合同先建立可验证、可恢复的本地 Fake 媒体包，后续工作流只能把其中 `preview_video.sha256` 写入时间线。

## 冻结输入

- 仅接受合法的 `project_id`、`source_document_id` 和来源 `sha256:<64 lowercase hex>`。
- 固定三个镜头：`fake-shot-01`、`fake-shot-02`、`fake-shot-03`，顺序不可变。
- 每镜头 125 帧，时间基为 25/1 fps，即 5 秒；整个纵切目标为 15 秒。
- 生成定义、生成器版本、媒体配方版本、FFmpeg profile/version、FFmpeg 与 ffprobe 二进制哈希均进入 package identity。
- 不接受调用方提供的输出路径、滤镜、codec、字体、URL、协议、命令参数或展示文案。

## 真实输出

每个镜头必须包含：

1. `still.png`：真实 PNG 文件，320×568，仅作可识别的本地占位分镜。
2. `scratch-voice.wav`：48 kHz、单声道、16-bit PCM、240000 样本的真实 WAV 文件。
3. `preview.webm`：320×568、VP9、CFR 25 fps、125 帧，并带 48 kHz 单声道 Opus 音轨。

每个文件在 canonical `manifest.json` 中记录角色、相对 POSIX 路径、真实字节 SHA-256、字节数及对应媒体参数。时间线可引用的媒体哈希只能是 `preview.webm` 的真实字节哈希；manifest、PNG 或 WAV 哈希均不能代替它。

## 能力降级

包级与每镜头必须同时显示以下闭集，不得把占位内容称为真实生成或正式配音：

- `FAKE_IMAGE_NO_SEMANTIC_GENERATION`
- `STATIC_FRAME_NO_MOTION_GENERATION`
- `PLACEHOLDER_TONE_NO_SPEECH_OR_VOICE_IDENTITY`

## 存储与恢复

- 根目录仅由受信任 Sidecar 组合层提供；当前 primitive 不接受 Renderer 路径。
- 固定布局：`workspace/fake-media/v1/<project_id>/<package_id>/`。
- 生成发生在同父目录随机 staging 中；全部文件生成、哈希、locked ffprobe 校验、canonical manifest 和文件 flush 完成后，才以一次目录 rename 发布。
- final 已存在时重新读取 manifest、逐文件重新哈希与探测；完全一致才幂等返回，任何损坏或多余文件/目录均失败关闭，不覆盖、不修补。
- 同进程生成受单槽限制；跨进程并发同 identity 只允许发布一个完整目录，输家复验赢家结果。
- staging 写入 PID 与进程创建时间组成的租约。项目级 OS 文件锁把清理判定/删除与发布交接线性化；进程退出时锁由 OS 释放。重启清理所属进程已退出或身份不匹配的 staging；无有效租约的 staging 需超过宽限期才清理。活跃 staging 不删除，且 staging 永远不能被识别为完成包。
- 进程在镜头生成后、发布前或目录 rename 后丢失 receipt，重启均恢复为同一完整包；rename 失败不留下可见 final。

## 工具链与安全

- 生成器只能从锁文件和显式工具目录构造；工具根必须为绝对本地普通目录，祖先不得包含 UNC、symlink 或 junction/reparse。只接受经 `discover_media_toolchain` 验证且 `distribution_status=DEVELOPMENT_ONLY` 的工具链。每次 materialize 前后重新验证工具根，并读取 FFmpeg/ffprobe 与发现时的字节哈希比较，发生替换即失败关闭。
- 用途固定为 `DEVELOPMENT_EVIDENCE`；不得用于产品导出、安装包分发或发布声明。
- FFmpeg 使用参数数组、关闭 stdin、禁止覆盖、固定内部 lavfi/codec 配方、单线程和 bitexact 标志；stdout/stderr 不进入日志。
- 工作区必须是绝对本地目录；UNC、远程路径、symlink/reparse 边界、路径逃逸及额外 manifest 字段均拒绝。

## 当前非目标

- 不修改 OpenAPI、Electron preload 或 Web UI。
- 不替换现有 `fake_timeline_workflow` 的派生哈希。
- 不创建 ArtifactVersion、GateDecision 或 accepted head。
- 不调用 Provider，不生成语义画面、真实运动、台词语音或角色音色。
- 不据此把 K01、Sprint 3 或 48 周总进度标记完成。

## 已知边界

- 本增量证明进程崩溃恢复和目录级发布，不宣称 Windows 在突然断电时拥有 POSIX 目录 fsync 语义。
- package identity 锚定冻结输入和工具链，不是 CAS manifest hash。具有本机写权限的攻击者若同时一致替换媒体和 manifest，当前无数据库不可变 receipt 可用于检测；CAS01 将负责可信内容锚点。本增量只保证生成器不覆盖、不修补并在普通损坏时失败关闭。
