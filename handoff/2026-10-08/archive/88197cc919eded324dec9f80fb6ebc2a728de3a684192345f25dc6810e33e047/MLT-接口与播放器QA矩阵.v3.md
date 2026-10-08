# MLT 接口与播放器 QA 矩阵（静态准备）

日期：2026-09-28。唯一合成 TEST 规格：`C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/art04-mlt-test-20260928/MLT-唯一合成TEST工程规格.md`，SHA256 `4323DFEF3EEF9337BAF49A5118DE1397B4C2AFBE2E67768E133F87C950DDF16D`，8414 字节。旧规格 SHA `7D1E…`、`D687…`、`AF56…` 只作历史，不作为执行输入。当前是**外置静态测试设计**；QA02 已在隔离目录生成四件合成媒体，SRT/TEST 脚本身份、最终五输入清单和获审 MLT 工具仍未齐；QA03 未启动 MLT/Electron、同步 c19、运行 MLT 测试或接受成片。本文件上一版 SHA256 `A5CF7EBD5A17AB3DABB7F2C0052859FB41067C8CF4D4206999D2BE3A8199AB04` 保存为 `.v1.md`。

## 输入与范围冻结

1. MGR04 已冻结 D 线四源静态快照 `C:/Users/Administrator/Documents/AIVORA/management/manager-handoffs/release-snapshots/20260928-d-mlt-plan-adapter-worker-4-2/SNAPSHOT.json`，SHA256 `5CB4BFD691A4E24C0D5E3E672EBC10D7011BAE90A2385DCF3ABAB98FFE715719`，四文件实体 SHA/字节 4/4 匹配；状态仍是 `AUTHOR_SOURCE_FROZEN_DEPENDENCY_OPEN_NO_C19_SYNC_NO_QA`。正式 A 合同 SHA `0028DB…` 的 `delivery=None` 可通过静态模型校验，mapper SHA `6E7DFC…` 的 `TEST_SCRIPT_DELIVERY_UNKNOWN` 分支静态可达；独立运行验证尚未完成。最终 QA 还需桥接、前端组件、TEST 脚本/SRT、五素材实际 SHA/字节/ffprobe、MLT 工具二进制/服务清单。作者活树和旧 worker SHA 不替代该快照。
2. 固定工程为 25 fps、48 kHz、125 帧、1080×1920，V1 `[0,75)`、V2 `[50,125)`、视觉叠化 `[50,75)`；两个 1000 Hz TEST 提示音片段 `[25,50)` 与 `[75,100)`，220 Hz BGM `[0,125)`，两轨 `gain_millidb=0`；两条字幕同提示音段。V1/V2 的 320×568 → 1080×1920 仅本 TEST 使用 `STRETCH_TO_CANVAS`，白色边条完整可见。
3. C 线旧 `EpisodeMediaAssemblyContentV1` 只支持视觉顺接。双轨重叠须由独立可回退合同与 MLT 计划表示；在这之前，完整 TEST 工程门为 `BLOCKED`。D 线现有正式产品导出仍是 `BLOCKED/NO_EXPORT_CLAIM`，开发渲染的成功不得升级为正式输出。

### 已生成的四件合成输入

QA02 清单 `C:/Users/Administrator/Documents/Codex/2026-09-23/aivora-git-c-users-administrator-documents/work/qa02-mlt-test-20260928/four-media-20260928T022740Z/four-media-manifest.json` SHA256 `211DDD8872F1DE47A569849C7A6AE9763D125DF6BAE9F8416534976C5B83FF78`，声明 `FOUR_MEDIA_ONLY_NO_SRT_NO_MLT`；QA03 独立回算四文件 SHA/字节 4/4 一致。`v1-blue.webm` SHA `75FCA3022F0D4369175E5341505544D8AED1837C1DCE0899F35BF1D7EDB73947`，`v2-red.webm` SHA `507DB639D74CAEBEAB3DFB9DDAD4EEA328A732D59794BEC7B49C66F51AB78AC4`，`dialogue-test.wav` SHA `E2C5F4AC222A67C22FC548275BB422A45FAEEAAB0A5EBAAED29CB0F1AFA37641`，`bgm-test.wav` SHA `590CC4A39EC6DE15C24C3EDEBB8F5754F3088BAD398932C7C194960453BBD7C4`。QA02 清单附工具版本、生成/ffprobe/解码 raw；此处仅确认静态文件身份，未做 MLT 组合与播放器验收。

## 分层 QA 门

| 门 | 最小可执行检查及成功证据 | 失败/未知处理 |
| --- | --- | --- |
| 接口身份 | 组件/IPC/sidecar 的 project、episode、assembly artifact/version/content hash、head revision、plan hash 与输出 operation/export id 完全同版；旧 generation、跨项目/跨分集、源版本变更回包不能更新当前播放器。保存命令、回包和后验 SHA。 | 身份不符 fail closed，不显示旧画面或伪称成功；保留原始响应。 |
| 时间线合同 | 125 帧和五轨引用能逐字段保存/正常关闭/重开；V1/V2 重叠 `[50,75)`、两提示音/BGM/字幕、单位增益和画布映射读回一致。业务半开区间转 XML 含端点时分别为 `0..74`、`50..124`、`50..74`、`25..49`、`75..99`、`0..124`。 | 旧顺接合同拒绝重叠时记 `BLOCKED`，不硬塞字段或绕过预检。 |
| MLT 合成 | XML/执行计划显式给视频叠化和音轨混合；解码帧 0/49 蓝、62 有红蓝贡献、75/124 红，左右白条完整；实际 PCM 在 1–2 与 3–4 s 同有 220/1000 Hz，其他区间仅 220 Hz。留 XML、原始渲染命令/exit、帧图、stem、PCM/频谱。 | 轨道或 transition 节点存在不算效果通过；实际帧/音失败即 RED。MLT 文档说明 multitrack 需 transition 才混合。 |
| 原生实时预览 | `MltPreviewPanel` 只控制独立 SDL2 原生窗口。以真实 host 回执核 open_request_id、session_id/generation、状态、画面、native audio clock；逐项 play、pause/resume、seek 0/24/25/49/50/62/74/75/99/100/124、close。记录窗口画面、音频、时钟/帧位置与 raw。 | 只有回执/静帧/预渲 MP4 不能宣称实时预览；时钟非 `NATIVE_AUDIO_OUTPUT` 时音画同步仍 UNKNOWN。 |
| 原生控制边界 | open 意图先持久化，结果 UNKNOWN 后按原 request_id 只读查询，不再次 open；旧 generation 控制拒绝；项目/来源/plan 变化期间回包丢弃；关闭正常释放独立窗口。 | 意图记录损坏、host 不可用或缺素材显示具体状态；无自动重派。 |
| 预渲染文件播放 | `DevelopmentExportPanel` 的 MP4 页面 `<video>` 和系统播放器单独验：只从同 operation、timeline version/revision、export id、SHA/字节数相符的输出创建 URL；浏览器 seek、暂停/恢复、首尾播放与错误事件实测；切项目/新版本释放旧 blob URL。 | 这是文件播放，不计原生实时预览。页面解码失败保留 raw 并引导系统播放器，不把播放器打开动作当播放成功。 |
| 输出引用与导出 | 开发输出回执 SHA、路径、125 帧/5 s、25 fps、1080×1920、音轨和字幕与固定工程一致；同版页面预览、系统播放器、另存副本、重开后的再次渲染分开记录 SHA、ffprobe 与实际播放。 | 缺 output、错版/错 hash、超 64 MiB 页面预览上限、预览读取 UNKNOWN 均不暴露不匹配媒体；正式产品导出声明仍受预检阻断。 |
| 字幕与音画边界 | 帧 24/25/49/50、74/75/99/100 截图核文字显隐；48 kHz 下每帧 1920 样本，核提示音首尾相对帧偏移，系统性偏差目标 ≤1 帧。实听无爆音、静音或 BGM 断续，记录峰值/削顶；不更改 `gain_millidb=0` 掩盖失败。 | 容器 duration 或字幕流存在不等于可听/可见；AAC delay 与尾填充单列。 |
| 缺素材和取消 | 素材缺失/哈希变更/权利或 probe 未就绪在启动前可见阻断；渲染中取消只作用原 operation，保留 `CANCELLED`、子进程退出与临时输出清理 raw；timeout/非零 exit/坏 MP4 分类，UNKNOWN 不自动重试。 | 不能通过手改 DB、替换资源或再次提交来“修复”未知结果。 |
| 安装/工具边界 | 仅在获审固定工具和打包输入后核 melt/ffmpeg/ffprobe/SDL2 实际二进制 SHA、版本、服务清单与 Electron 模块结构；同一安装布局执行只读加载及启动 smoke，保留 stdout/stderr/exit。 | 文件存在和 `tsc` 通过不等于运行；缺获审工具/输入即保持 BLOCKED，不安装新工具。 |

## 现有静态候选与后续证据

- 作者前端候选：`MltPreviewPanel.tsx` SHA256 `65FD5A1648ABA18023414EDD17A40D4671D531F3842E4C9FEB09C700DAF38609`；`adapters/mediaPreviewSession.ts` SHA256 `40DE9E60C3E93972D7DA1952B430B7897F8E9B6EC1597795C492629519295502`。前者写明独立 SDL2 窗口，Panel 中的状态文字不能替代实际画面/音频。Desktop `media-preview-session-contract.ts` SHA256 `9F2DB4A16FA3CC2C31C0D7542B39D109D5CB4C733289E2872B6AE6130B1C0D1E`，IPC SHA256 `23FC9DA96AFC40FE20FC3AAE678F350509355E011B8A50A95C2BA759CD16989A`。
- 预渲文件 UI：`DevelopmentExportPanel.tsx` SHA256 `5648BF19B71C79EB6DE97C208D09C955990ACF73479C7B09CBCF4C30B9F35C9E`，有同版 output 校验、blob URL 播放及系统播放器动作。这是开发导出路径；正式产品预检仍另门。
- D 线四源虽已冻结为上述独立快照，完整工程依赖仍未闭合；测试代码与实际运行都等 TEST 脚本/SRT、完整五输入、工具核验与 MGR02 窗口。官方 [MLT XML 文档](https://www.mltframework.org/docs/mltxml/) 描述 playlist in/out、tractor transition、luma 叠化和 mix 音频；静态 XML 通过仍须以实际帧与音频验收。
- 本工程对白状态固定为 `DIALOGUE_SPEECH_NOT_TESTED`，1000 Hz 只作技术提示音；SFX 为 `ABSENT_TEST_SCOPE`。任何技术 PASS 都不能升级为《离别》、真人/合成中文对白、口型、正式发行或完整产品验收。
