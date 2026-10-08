# QA02 MLT 单工程静态 QA 矩阵

状态：`FOUR_SOURCE_FROZEN_STATIC_REVIEW`。依据唯一 TEST 规格 SHA `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D`；作者 s2 工作树当前四源：`media_execution_plan_contracts.py` SHA `3499EFFC8983BC3EF2EF666B55C33116779458FA1EA8748302AC811F8B3A45B2`，`episode_media_execution_plan.py` 新 SHA `6E7DFC0DAF5534947269C0824658E381293D0D4742145F2DBD7DB5E686C756F1`，`mlt_execution_adapter.py` SHA `318E7DC93678851D6415BCCED39DAE782DDFEF56D24F8C681528C0E9051269AD`，`mlt_execution_worker.py` SHA `1B262570AEF12D7DDBD08CE593A330E73A7498058A2E3EE751EE8FC30C9CB20C`。早期 mapper 82FF、adapter D6A86 与 worker DCE419 是中间源，仅历史。MGR04 尚未将四源同步 c19，亦未 import/build/test 或运行 MLT。

| 检查点 | 静态观察 | 后续 QA 证据/门 |
| --- | --- | --- |
| 独立 TEST 身份 | 计划源限定 `FROZEN_ENGINEERING_TEST`、规格 SHA 4323DF、项目/分集/脚本版本和两块身份；不填 assembly 身份。新 mapper 明确拒缺 `delivery`，对旧脚本保留原 JSON hash 判断。 | A 完整运行包同步后，QA01 真实 API 保存及 GET 读回，再固定 IDs/content hash、生成 SRT；另测缺 delivery、显式 delivery、原字典篡改三种输入。 |
| 媒体版本与权利 | `ExecutionMediaRefV1` 需要 rights `CLEARED` 及决定 ID，视频需要成对 probe ID/SHA；适配器 server resolver 核 SHA/字节与本地普通文件。 | 四媒体 manifest 211DDD 只是生产证据，须另有选定 AssetVersion、权利决定、probe/inspection 实际收据。 |
| 半开帧与样本 | 适配器锁 V1 `[0,75)`、V2 `[50,125)`、叠化 `[50,75)`、两提示音和 BGM；XML `out=end-1`，音频 1920 样本/帧且 gain 0。 | 读回 XML `0..74`、`50..124`、`50..74`、`25..49`、`75..99`；原生/MP4 解码帧与 PCM 边界独立核验。 |
| 画布映射 | 合同与适配器锁 `STRETCH_TO_CANVAS`，冻结 adapter 在视频 producer 显式加 `affine` 的 distort/rect 滤镜；尚无经 QA 验证的实际拉伸像素结果。 | MLT 运行后帧 0/49/62/75/124 核满屏、无裁切/留边、白条完整；XML 属性不能判实际视觉 PASS。 |
| 视觉叠化与双轨混音 | XML 有 `luma` 50..74、两条 `mix` 0..124 和 burn-in `qtext` 滤镜。 | 经批准 melt runtime 服务探测、真实渲染及播放后验蓝红贡献、220/1000Hz 分段共存、字幕显隐；XML 元素存在不等于生效。 |
| 五输入 manifest | 冻结 adapter 解析严格 kind/status/spec/usage/TEST 身份与五具名文件，校验每个 QA 原件的路径、字节、SHA 并与 server resolver 选定版本/SRT 对齐；worker 再持有原件和工具锁。 | 真实 TEST 脚本身份/SRT/五输入 manifest 尚缺；四媒体历史 manifest 必须被拒。后续以独立负例证明缺项、换字节、换路径和混版本拒绝。 |
| 输出与失败 | 冻结 worker 静态包含 runtime 全目录 inventory、version/query 服务门、只读资源句柄、进度/取消/超时、退出码与 MP4 验证及哈希回执。 | MGR04 同版冻结同步后再做定向测试；MLT 工具未批准，不能声称取消/timeout 无孤儿、进度或输出验证已经成立。UNKNOWN 不自动重试由外层状态机另验。 |

静态可见合同锁定了规格和边界，但没有真实播放器、MLT、MP4、中文对白或最终 UAT 证据。当前阶段仅四技术媒体已生成且可解码。A 线现有 c19 脚本合同缺 `delivery`，真实 TEST 脚本 API fixture、SRT 与五输入 manifest 均阻断，需完整 A 运行包同步及 QA 读回后才能继续。
