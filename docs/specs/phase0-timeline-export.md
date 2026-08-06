# Phase 0 基础时间线与 1080p 导出规格

状态：Implemented（M03）

依赖：[媒体时间基线契约](phase0-media-contract.md)、[FFmpeg 工具链与黄金媒体](phase0-ffmpeg-toolchain.md)

## 目标与范围

M03 交付可以进入 Walking Skeleton 的最小剪辑内核：以 Sequence 整数帧为唯一编辑坐标，
支持 Clip 裁剪、重排、替换和 CFR 代理引用，并把一条顺序视频轨导出为 1080×1920 MP4。
每次命令产生新的不可变 `TimelineVersionV1`，旧版本不被原地修改。

本切片不是专业 NLE，也不包含转场、多轨合成、字幕、调色、响度母带、CAS、数据库持久化、
OpenTimelineIO 交换或 VFR 原片在线重连。M03 导出使用已经通过 M02 探测的 CFR 编辑介质；
代理资产必须绑定源/代理 hash 与 `ProxyTimeMapV1` 版本。原片在线重连仍是后续影片交付 Gate，
不能用本切片的代理导出证据代替。

## 版本化领域模型

- `TimelineVersionV1`：schema version、timeline ID、revision、Sequence timebase、1080×1920 画布、
  不可变资产表和顺序 Clip 列表。
- `TimelineAssetV1`：稳定 asset ID、源内容 SHA-256、可编辑帧数；可选代理引用包含代理 SHA-256、
  帧数、Sequence timebase、mapping schema version 1。代理 timebase 必须与 Timeline 完全一致。
- `TimelineClipV1`：稳定 clip ID、asset ID、`source_in_frame` 和 `duration_frames`。区间为
  `[source_in_frame, source_in_frame + duration_frames)`，必须落在资产的可编辑帧范围内。
- 所有 ID 使用有限 ASCII slug；所有帧数、revision 和求和结果均为 JSON safe integer，拒绝 bool、
  浮点数、负数、零时长、重复 ID、悬空资产和溢出。

资产的“可编辑帧数”在有代理时指代理帧数，否则指已确认 CFR 源帧数。领域模型不保存文件路径；
路径仅存在于一次导出调用的受保护 `TimelineMediaBinding` 中，并以内容 hash、探测结果和时间基再次校验。

## 编辑命令

- `trim`：显式给出新的源入点和时长；不得隐式移动其他 Clip 的源区间。
- `reorder`：按 clip ID 移到目标零基索引；不改变任何 Clip 内容区间。
- `replace`：显式给出新 asset ID 与源入点；保持 Timeline 上的 Clip 时长不变，除非调用方先执行 trim。
- 每个命令必须携带 `expected_revision`。revision 不匹配时拒绝，防止界面上的陈旧写入覆盖新版本。
- 成功命令只增加一次 revision；无效目标、越界、重复替换或无效索引均明确失败，不返回部分结果。

## 导出边界

1. 导出只接受绝对、本地、普通文件绑定，拒绝 URL、UNC、设备名、ADS、符号逃逸和输出覆盖。
   M03 同步 worker 固定限制 256 Clips、64 个唯一输入、单输入 512 MiB、总快照 2 GiB、
   60,000 帧、4K 输入像素和 256 KiB filter graph；同一进程只允许一个媒体导出，繁忙时快速失败。
2. 每个绑定先通过 M02 guarded snapshot 与 ffprobe；实际 hash 必须等于 Timeline 选择的源或代理 hash。
3. 视频必须为 CFR、帧率等于 Sequence；音频若存在则必须为 48 kHz。Phase 0 时间线要求所有 Clip
   统一有音频，或统一无音频，避免静默制造未定义的声轨。
4. FFmpeg 用每个 Clip 的整数帧 `trim=start_frame:end_frame` 和源绝对 48 kHz 样本边界 `atrim`；
   同时从 Timeline 累计帧边界计算该 Clip 的输出样本数，以显式 `apad/atrim` 修正 30000/1001
   等帧率下源入点相位造成的一样本差，再 `setpts/asetpts` 归零后 concat。画面等比缩放并居中填充
   到 1080×1920。
5. 输出为 MP4/H.264/AAC、yuv420p、48 kHz（有音频时），帧数必须等于所有 Clip 时长之和。
   逻辑音频必须精确覆盖 `sample(total_frames)`；AAC 编码 frame 的 `nb_samples` 可以包含填充，
   但 packet PTS/duration、`Skip Samples` 与 discard padding 还原出的连续展示区间必须精确等于逻辑长度。
   当前锁定的 GPL 开发工具只生成测试证据，不进入发行包；发行编码器仍由许可证 Gate 决定。
6. 输出在同目录临时文件中完成，重新探测和 hash 后以 no-clobber 原子发布；失败不得留下目标文件。
7. `purpose` 必须由调用方显式提供。当前 GPL `DEVELOPMENT_ONLY` 工具链只接受
   `DEVELOPMENT_EVIDENCE`；`PRODUCT_EXPORT` 在发行编码器完成许可 Gate 前始终失败关闭。

## `timeline-golden` 验收

- 纯模型测试覆盖 trim/reorder/replace、陈旧 revision、所有区间/ID/整数/溢出失败和不可变性。
- 黄金时间线至少组合三个 Clip，并同时证明裁剪、重排、替换和代理引用；规范化 render plan
  具有固定 SHA-256，且所有时间参数来自整数帧/样本计算。
- 使用锁定 FFmpeg 真正输出短 1080×1920 MP4；ffprobe 验证容器、CFR、帧率、帧数、尺寸、
  48 kHz 音频和时长边界，解码帧标记验证 Clip 顺序与边界。
- Unicode/长路径输入、已存在输出、内容 hash 不符、VFR 直入、错误帧率、损坏文件和编码失败
  均有确定失败测试，且不会发布部分目标。
- AAC 后验不以编码 frame 总样本数冒充展示时长；必须从 packet timing 与 skip/discard metadata
  还原展示区间，并精确等于 `sample(total_frames)`。
- 证据报告记录 Timeline hash、render-plan hash、输入/输出 hash、工具链 profile、完整验证结果；
  重放后进入统一 `evidence:check`。
