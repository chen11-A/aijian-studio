# 整场连续配声：可信建议与显式整 lane 选用

本片段为原 picker 的整场 master 编译及 native ABI，不含整场选用界面，不调用供应商、TTS 或生成服务。源库仍为现有编译且校验的 206 项，picker 入口和 synonyms 的组合 SHA 继续复核；没有复制新算法或重新处理素材音量。

## 范围与坐标

输入的 `expectedSelection` 必须等于全工程真实已选 done 镜的有序序列，所有实际视频都须可核验。不能以计划 `shot.seconds` 填缺镜或前缀时钟。目标场须连续；全片缺镜返回 `PLAN_UNSUPPORTED/GLOBAL_CLOCK_UNAVAILABLE`，交错场等不支持时钟返回 `PLAN_UNSUPPORTED/SCENE_ORDER_UNSUPPORTED`。旧选版和过期 raw CAS 返回 `PROJECT_CHANGED`。

`suggestBundledFilmSceneAudio` 只读，返回全片实际 clock、场起点/时长、固定说明、完整 clip 计划。placement 始终镜内时间；环境 master 和 music 只编译一次后裁镜，sourceStart 连续推进，负 fade origin 与多个 fade 乘积保留，gain automation 的最终 dB 仍沿既有 base 差值语义。music 的片段增益为原手动 0 dB，整轨设置和 shared duck 只作用一次。场内情绪冲突/缺失/明确无配乐时保留配乐留白；动作时间只认明确计划，不声称画面或语音实测对齐。

`applyBundledFilmSceneAudio` 输入同 scope 加 catalog/picker/plan 指纹和非空唯一 lanes。main 重新编译，整 lane 的全部段一次选用，按资产去重私有 wx copy，并复用原工程事务队列一次 CAS。原 clip/版本/文件不删除。实际写 ACK 后读回缺失、错误工程或旧稿一律 `WRITE_UNCONFIRMED/unchanged=false`，保留可能已引用的 copy；不自动重发。BUSY 从操作开始保留到实际写入/读回 settled。

## 组的一致性和便携

`sceneAudioBinding` 是创作一致性标记，不是素材授权。摘要绑定全片有序镜/选版/场、实际全局前缀时钟和 native/visual 两种角色各自的 SHA；不含工程 ID、路径、保存时间。每次真实 native 操作仍核 roots、owner、所选版和源 SHA；已复制资产实际 SHA 也核与原资产事实相符。

当前选择/时钟/源变更、成员残缺或重复、绑定缺失等使整个场组从共享 plan 排除，并标 `SCENE_AUDIO_BINDING_STALE`。这不会修改 `enabled`、重签组摘要或删除任何引用。预览、QC 导出和本机合成消费相同 plan；assembly/preview 消费 key 包含影响声音的绑定与组结构，排除波形 peaks、许可等普通缓存 metadata。成员 gain 的显式编辑可继续试听，但原组删除摘要校验会拒绝将已改组当作原组移除。

UI 须先在整个工程 `audioClips` 上核完整组与全局 clip ID 唯一，再按场显示/移除；不能先按当前镜过滤后比较跨镜 `memberCount`。移除仅引用且不删除媒体。旧单镜成员未带 binding 时，摘要 JSON bytes 保持原格式。

实际 ZIP 导入会重分配 project/series ID 和路径，保留 shot/take/clip ID。真 ZIP 往返后的完整组可通过原摘要与当前实际 clock 检查；metadata 本身仍不授信，也不携带可消费 receipt 或路径权限。

## 当前实际证据

- 6 个 desktop 目标文件 53 项通过：原单镜建议、共享 mix/preview、IPC/preload，以及整场 master 裁镜、全片前缀 clock、一次 CAS、原文件不变、迟到 project/take/source 拒绝、真 ZIP/normalize/FFmpeg 输出和整组失效。
- 独立 scene 写前失败、写后异常、错误工程读回及实际写 ACK hold 的 4 项通过；原单镜 5 秒测试门未改。
- 2 个 web 文件 17 项通过，包括 binding/组结构改变触发重新检查、普通单镜组 metadata 不触发以及既有 WebAudio seek/rate/solo 行为。
- contracts runtime 已实际编译并在隔离输出目录 require 39 个 public exports；不回退源码 loader。

以上是本机定向证据，不代表 Windows Electron 用户窗口、整场 UI 或完整仓库覆盖门已验证。两端正式类型、web 生产构建和 desktop build 已通过；desktop build 实际生成 206 个资产、464 个资源文件。另原 library/target/真实 mix-media 三文件 58 项通过（与前述独立写入 4 项有重叠，不累加），新增有界输入纯回归 5 项通过（含原 4 项）。隔离 compiled main factory 实际加载同 206 项与已校验 picker，39 个 shipping exports 全部 require，无源码 loader。目标 ESLint/Prettier/diff 已收尾，原 contracts 检查在冻结提交后执行。
