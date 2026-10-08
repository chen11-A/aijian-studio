# QA01｜LAYOUT07 短剧来源到开发 MP4 的一次性原生 QA 方案（离线）

状态：方案及可审一次性执行分支已写入 work 目录；仅做离线语法/模拟，未运行 Electron、provider、Fake 任务或导出。执行须等 QA02 释放 c19、M1 同项目真实来源批准/选源实证及经理重新审签。M2 必须**串行复用 M1 正式受控隔离 profile 及原有 sidecar workspace**；M1 须正常关闭并明确交接。M2 新建独立 attempt ledger/evidence，不复用历史 PID、窗口句柄、操作 UUID 或失败后的提交授权。不复制 DB、不制造批准状态。

## 固定候选与已有证据

- c19 HEAD `211c9e8b9316b2afdf3e35a3966aa192a8dbe7c2`；LAYOUT07 产品 27 文件快照 `20260924-layout07-27/SNAPSHOT.json` SHA256 `569E8B63A2545D7178E18B22348330B10D8E5B628410B4E45732E4B3CCFFC21F`，路径/内容指纹 `E6C0D1673EE9F4228659EEEA8444FC48314737DF91C1570E8B5B9C253D79E201`。六 QA 文件快照 `20260924-build05-qa-overlay-6/SNAPSHOT.json` SHA256 `ED784DE9F7610FBF3D4A767FF2C3B1A716472A72E0AFA5860D33FC66BBD25048`。LAYOUT07 `postbuild.json` SHA256 `5B395E855B8502515741345EFCC35A58CE5172EE1A3829437E2BBDE0E133042F`，web 25 + desktop 48 = 73 dist，两个 build exit 0。运行前仍须逐项重核 27/6/73 哈希、路径、HEAD、脚本、输入和无驻留；任何漂移停止并重新定版。
- QA01 先前 BUILD05 的 API 16、桌面合同 33、Web 适配器 22 项定向 PASS 和 TypeScript exit 0，只证明相应 API/合同/本地 journal 故障边界；LAYOUT07 仅 CSS 变化且有新 build/视觉局部证据，不能把这些结果写成同一 H87 原生媒体链、真实可播放 MP4 或《离别》剧情验收。旧构建 RED、M1 原生焦点阻断和所有 UNKNOWN 原始记录继续保存。

## 代码对应的真实链路及能力边界

`apps/desktop/src/main.ts` 用 `AIJIAN_E2E_USER_DATA_DIR` 设置 Electron userData，再将 sidecar `AIJIAN_DATA_DIR` 指向该 userData 下的 `workspace`；新空 profile 即新的权威工作区，无法重开 M1 项目。它启动带 token 的本地 sidecar，启用 `AIJIAN_ENABLE_FAKE_TIMELINE_RUNTIME=1`，加载 `studio-web/dist/index.html`；renderer 保持隔离，经 preload → 主进程 IPC/API client → sidecar。来源页 `StoryPages.tsx` 经原生审核送审、确认基线后，必须由 `SourceManifest` 权威 GET 读到同一项目 `accepted_version_id = latest_version_id = 已选版本`，来源文档原始哈希与冻结短剧字节相同。`DevelopmentMediaPanel.tsx` 只列已接受清单文档；选择来源后显式预检、提交一次 Fake operation，先保存本地 journal，收到的创建回执只是入队。UNKNOWN 只按原 operation GET；任务成功仍须再读任务、媒体包及真实 Timeline。

当前“Fake”运行由 `FakeTimelineRunFactory`、`LocalFakeTimelineWorker` 和受锁定 FFmpeg/ffprobe 约束的 `FakeMediaPackageGenerator` 实现，非真实供应商调用，也不同于通用 `FakeProviderProcess`。它以来源 ID/hash 绑定包身份，用来源 hash 决定色块/正弦音调，固定 3 镜头 × 125 帧、25 fps = **375 帧/15 秒**；每镜有 PNG、WAV、WebM。它不解析《离别30秒剧本》的六镜剧情、人物动作、对白或口型。因此本轮最多签“该短剧来源绑定的本地开发证据 MP4”，不得签 30 秒剧情片、配音/口型、真实生成或正式导出。

任务成功后，worker 持久化带已接受 SourceManifest `derived_from` 依赖的 Timeline；组装页使用真实 Timeline Workspace。建议只做一次可观察的首镜向右重排并保存/重新读取，保持 375 帧，同时证明编辑版本变化。导出页按当前 `project_id + timeline_version_id + content_hash + revision` 建 journal 和新 operation；preflight 校验 25 fps、媒体包 manifest、文件路径/大小/哈希绑定，再声明操作并同步调用真实 FFmpeg。输出位于 sidecar workspace 的 `exports/development-timeline/<project>/<export_id>.mp4`。导出声明有 PENDING/SUCCEEDED/UNKNOWN；**没有另一个可任意重试的导出 job**。准确的首次 422 `DEVELOPMENT_EXPORT_PREFLIGHT_REJECTED` + `NO_EXPORT_CLAIM` 才可保留审计并显式结案；409、普通 422、503、传输中断、身份不匹配均锁 UNKNOWN，只查原操作，不自动重 POST。

## 一次性顺序与可证伪门

1. **开跑门**：经理确认 c19 独占释放、M1 在固定 LAYOUT07 上同项目真实批准及选源回执、正常关闭与交接。交接须写明原受控 profile 的绝对路径、其 `workspace`、项目/来源/manifest 四身份、冻结剧本 SHA256 `466F23B789B47FA1231B0891E80385A13E530B02DE2F74481C4E98F5732DE008`、M1 原始证据和旧 ledger 哈希。M2 使用**同一 profile**，另建 M2 attempt ledger/evidence；不复制 workspace/DB。先核 profile 实体目录、workspace DB、无 SingletonLock、无 Electron/sidecar/runner 驻留或并发，再核 27/6/73、脚本与输入哈希。缺任一门即 `M2_BLOCKED`。
2. **来源门**：以同一 profile 正常重开同一 H87 项目，UI 显示已批准且已选择的来源；独立 GET `project/source_manifest/source_text` 核项目、最新/接受版本、内容哈希、选中 source ID、完整字节 SHA 和原始文本，须逐项等于 M1 交接。若仍是 draft/review、来源不一致或原生送审 UNKNOWN，停在 M1，不启动 Fake。不能凭 UI pill、旧截图或复制数据库代替。
3. **Fake 门**：在“选择本地 Fake 制作来源”选同一文档，点击“核对来源”，保存可用预检；记录新 operation UUID 与 journal 后，只点击一次“提交本地 Fake 任务”。保存 UI、IPC/HTTP request ID、operation→workflow/node/attempt/task 身份。新操作预期 201；若为 200 重放，须先核是否已有原操作，不能当作本次首次入队。UNKNOWN/404/409/503 或响应丢失只按原 operation GET、保留 journal；不生成第二个 POST。任务列表应显示同 task kind 与本地执行模式，受界限轮询到权威终态；失败或未完成即停。
4. **素材/剪辑门**：任务 SUCCEEDED 后读同一项目 Timeline、版本/修订/content hash、accepted SourceManifest 依赖与 package manifest；逐个校验 3 段 preview 的文件哈希、125 帧、25 fps/音轨及 UI 所示 task 与 timeline ID。执行一次首镜向右重排，保存并重新读取新版本/修订/顺序；预期总长仍 375 帧。若无真实版本变化、包不全、旧任务产物被当作当前版本、编辑失败，停在导出前。
5. **导出门**：导出页记录当前 Timeline 四身份、375 帧/25 fps 和持久 journal；仅点一次“生成开发 MP4”。保存原始 HTTP/IPC 回执、request ID、operation/export ID、状态与输出路径/hash/bytes。UNKNOWN 只能 GET 原操作；准确无声明 422 也只记录并停止本次运行，不在同一 attempt 连续重试。只有 `SUCCEEDED` 且回执四身份与当前编辑版本一致，才进入媒体核验。
6. **文件与播放门**：只读对 sidecar workspace 中回执指定的单个文件算 SHA256/字节，与回执相等；用锁定 ffprobe 独立核 MP4/H.264/yuv420p、1080×1920、25/1 CFR、375 帧/15 秒，音轨若存在为 AAC 48 kHz。页面预览若在 64 MiB 内，要记录 metadata/播放到首、中、末段/ended；否则按 UI“用系统播放器打开”并留真实播放观察。目视应是三段随来源 hash 决定的色块，听到合成音调；黑屏、无法解码、时间轴错、hash/来源链错均失败。单有 `SUCCEEDED` 回执、文件存在或页面加载提示，不算“可播放”。
7. **收尾门**：正常关闭 Electron，保存主/sidecar PID 退出、同一 profile 锁、postflight 27/6/73 与 M1 旧 ledger 哈希；保留交接的原 profile、M2 新 ledger/evidence、媒体、原始日志/截图、ffprobe JSON 和失败现场。任何不能判定的点击/请求/关闭只记 UNKNOWN，先权威读回，不原样重试。

## 判定分层

- `M2_BLOCKED`：M1 正式受控 profile/workspace 交接、批准/选源/全文实证、独占释放或固定候选门任一未齐；不运行 Fake 或导出。
- `M2_FAIL_OR_UNKNOWN`：任一身份、状态、包、Timeline、导出、文件或播放门失败/未知；保留原始证据与操作锁。
- `M2_DEVELOPMENT_MP4_PASS`：同一 H87 原生流程、来源链、任务、编辑版、输出字节与实际播放全部吻合；仅本地 15 秒 Fake 开发证据通过。30 秒剧情质量、真实 provider、正式影片、安装包和最终用户验收仍单列未通过。

代码锚点：`apps/desktop/src/main.ts`、`apps/studio-web/src/aivora/{StoryPages,DevelopmentMediaPanel,DevelopmentExportPanel}.tsx`、`apps/studio-web/src/aivora/adapters/{developmentFakeTimeline,developmentTimeline,developmentExport}.ts`、`services/api/src/aijian_api/{sidecar,fake_timeline_run,fake_media_package,development_timeline_export,timeline_export}.py`。

## 一次性执行分支与开跑合同

`run-m2-native-once.draft.mjs` 的 `--preflight-only=true` 只读候选和 M1 交接，不写 profile、DB 或 ledger。`--preflight-only=false` 先完整重核相同门，再要求单独经理审签 JSON 和锁定 ffprobe，随后在本 work 区新建不可复用的 `evidence/<attempt-id>/events.jsonl`。`m2-once-flow.mjs` 串联来源 GET、唯一 Fake UI 提交、任务/包/Timeline、唯一首镜右移、唯一导出 UI 提交、输出哈希/ffprobe/页面实际播放、正常关闭；`m2-electron-driver.mjs` 把全部写操作限制为可见 UI。它先限时 15 秒等待产品主窗自然显示且主框架不加载，记录逐次采样，再间隔 250 ms 两次核主窗 HWND/PID、可见/聚焦和 Win32 前台 HWND/PID；不调用 `show()`/`focus()`，不满足即停在窗口门。任何点击后身份或结果不明即停，只按原 operation GET，不重复 POST。`m2-offline-simulation.mjs` 只以纯模拟 driver 检查成功和四个 UNKNOWN 停止路径。

M1 交接 JSON 必须是正式实测产物并由运行时用 `--handoff-sha256` 固定原始字节。字段：`kind=M1_CONTROLLED_PROFILE_HANDOFF_V1`、`outcome=ACCEPTED_AND_SELECTED`、`normal_close=true`、`c19_released=true`、固定 `head/product_snapshot_sha256/qa_snapshot_sha256/build_manifest_sha256`、`profile_path`、`workspace_path`、`project_id`、**`project_name`**、`source_document_id`、`selected_source_document_id`、`source_manifest_version_id`、`accepted_version_id`、`latest_version_id`、`source_manifest_content_hash`、`source_sha256`、`source_text_sha256`、`input_path`、`input_sha256`、`evidence.{m1_result,m1_postclose,m1_ledger}.{path,sha256}`。`source_manifest_content_hash` 是清单内容哈希；`source_sha256` 有 `sha256:` 前缀，`source_text_sha256` 是不带前缀的冻结原文字节哈希。目前没有该正式交接，不得从旧截图或 DB 推断填入。

经理另给原始 JSON 与 `--approval-sha256`，字段：`kind=M2_MANAGER_SINGLE_RUN_APPROVAL_V1`、`outcome=APPROVED`、`manager_thread_id=01a0d0ec-1393-7d72-bb98-9913bd2fecca`、`qa01_thread_id=01a0d0ec-c748-7001-a93d-0144770a11bc`、精确 `attempt_id`、`m1_handoff_sha256`、固定 `head/product_snapshot_sha256/qa_snapshot_sha256/build_manifest_sha256`、当前 `runner_sha256/flow_sha256/driver_sha256` 和 `ffprobe_sha256=9DF3B0B5275E830961DF6D94E1F7A71121A7ABD5FF708E9FEC8A0B6084A55015`。审签只能在三份脚本最终哈希、M1 正式交接和 c19 独占释放后填入。CLI 还需 `--ffprobe-path` 指向与锁定哈希匹配的本地 exe；runner 不下载、不安装工具链。缺任一字段、旧 attempt 目录已存在或审签哈希漂移即停。此处没有制造审签文件。

运行依赖最小集：Windows 上现有 Node 24、c19 已安装的 `playwright-core` 与 Electron、同 profile 已部署的 sidecar/Python、固定 LAYOUT07 的 27/6/73 文件、冻结剧本文本、已安装且哈希符合 `config/media-toolchain-lock.json` 的 ffprobe/FFmpeg。执行分支不调用 provider，不安装依赖，不复制 workspace。页面预览限 64 MiB；超限时记录 `PREVIEW_TOO_LARGE`，须另行真实播放器观察后才能改判“可播放”。

静态边界：离线模拟 PASS 只证明编排的单动作与停止次序，不能证明窗口焦点、真实控件定位、sidecar 持久化、媒体生成或播放。正式执行须保存原始 UI/GET/ffprobe/文件/关闭事件及 postflight 哈希；本准备阶段尚无 M1 交接或经理审签，状态维持 `M2_BLOCKED`。
